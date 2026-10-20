import path from "node:path";
import { realpath } from "node:fs/promises";
import { emptySeverityCounts, sortBySeverity, type Finding } from "../findings/model.js";
import { hasErrors, type Diagnostic } from "../parser/diagnostics.js";
import { loadRulesFromDir } from "../loader/rules.js";
import { detectProject } from "../project-detection/detect.js";
import { redactDeep, redactText } from "../redaction/redact.js";
import { LEVEL_POLICIES } from "../rule-matching/levels.js";
import { selectRules } from "../rule-matching/select.js";
import type { ProtectionLevel } from "../schemas/common.js";
import {
  CHECK_DEFINITIONS,
  checkOutcomeSchema,
  notImplementedRunner,
  type CheckResult,
  type CheckRunner,
} from "../verification/checks.js";
import { computeVerdict, isBlocking, VERDICT_EXIT } from "../verification/verdict.js";
import { REPORT_VERSION, type ScanReport } from "../reports/types.js";
import { loadProjectConfig } from "./config.js";

export interface InspectOptions {
  /** Project directory to inspect. */
  root: string;
  /** Directory of rule files (for example the bundled baseline). */
  rulesDir: string;
  /** Overrides the protection level from aegis.config.json. */
  level?: ProtectionLevel;
  /** Check runners by check id. Missing entries use the "not implemented" runner. */
  runners?: Readonly<Record<string, CheckRunner>>;
  toolVersion?: string;
  now?: () => Date;
}

const CLEAN_CAVEAT =
  "A clean result means only that the checks listed as performed found nothing. It does not prove the code is secure.";

/**
 * Inspect a project end to end: config, rules, detection, selection, planned checks,
 * normalized findings, verdict. Never throws for bad input: problems become an 'error' verdict.
 * A check that did not run is always reported as such, never as a pass.
 */
export async function inspectProject(options: InspectOptions): Promise<ScanReport> {
  const now = options.now ?? (() => new Date());
  const notes: string[] = [];
  const diagnostics: Diagnostic[] = [];

  let root: string;
  try {
    root = await realpath(path.resolve(options.root));
  } catch {
    return errorReport(options, now(), "standard", [
      {
        severity: "error",
        source: options.root,
        path: "",
        message: "project directory does not exist",
      },
    ]);
  }

  const configResult = await loadProjectConfig(root);
  const level = options.level ?? configResult.config.protectionLevel;
  const policy = LEVEL_POLICIES[level];
  diagnostics.push(...configResult.diagnostics);

  const loaded = await loadRulesFromDir(options.rulesDir);
  diagnostics.push(...loaded.diagnostics);

  if (hasErrors(diagnostics)) {
    return errorReport(options, now(), level, diagnostics, path.basename(root));
  }

  const profile = await detectProject(root, { exclude: configResult.config.scan.exclude });
  const allRules = loaded.rules.map((r) => r.rule);
  const selection = selectRules(allRules, {
    profile,
    level,
    config: configResult.config,
  });

  // Plan and run checks
  const checks: CheckResult[] = [];
  const checksNotApplicable: ScanReport["checksNotApplicable"] = [];
  const findings: Finding[] = [];

  for (const id of policy.checkIds) {
    const def = CHECK_DEFINITIONS.find((d) => d.id === id);
    if (!def) continue;
    if (!def.appliesTo(profile)) {
      checksNotApplicable.push({
        id: def.id,
        name: def.name,
        reason: "the project does not appear to use what this check needs",
      });
      continue;
    }

    const runner = options.runners?.[id] ?? notImplementedRunner;
    let result: CheckResult;
    try {
      const raw = checkOutcomeSchema.safeParse(await runner({ root, profile }));
      if (!raw.success) {
        result = {
          id: def.id,
          name: def.name,
          tool: def.tool,
          outcome: "tool-error",
          reason: "the check returned data in an unexpected format",
          findings: [],
        };
      } else {
        const { outcome, reason, findings: fs } = raw.data;
        const tagged = fs.map((f) => ({ ...f, checkId: def.id }));
        let finalOutcome = outcome;
        let finalReason = reason;
        if (outcome === "passed" && tagged.length > 0) finalOutcome = "findings";
        if ((outcome === "failed" || outcome === "findings") && tagged.length === 0) {
          finalOutcome = "tool-error";
          finalReason = `the check reported '${outcome}' without any details`;
        }
        result = {
          id: def.id,
          name: def.name,
          tool: def.tool,
          outcome: finalOutcome,
          ...(finalReason ? { reason: finalReason } : {}),
          findings: tagged,
        };
      }
    } catch (err) {
      result = {
        id: def.id,
        name: def.name,
        tool: def.tool,
        outcome: "tool-error",
        reason: `the check crashed: ${err instanceof Error ? err.message : "unknown error"}`,
        findings: [],
      };
    }
    checks.push(result);
    findings.push(...result.findings);
  }

  const sorted = sortBySeverity(findings);
  const verdict = computeVerdict({
    findings: sorted,
    checks,
    threshold: policy.blockThreshold,
    fatalError: false,
  });

  const performed = checks.filter(
    (c) => c.outcome !== "skipped" && c.outcome !== "tool-error",
  ).length;
  const notPerformed = checks.length - performed;
  const counts = emptySeverityCounts();
  for (const f of sorted) counts[f.severity] += 1;

  notes.push(CLEAN_CAVEAT);
  if (notPerformed > 0) {
    notes.push(
      `${notPerformed} of ${checks.length} planned check(s) were not performed. The result is incomplete, not clean.`,
    );
  }
  if (!configResult.found) notes.push("No aegis.config.json found; default settings were used.");

  const report: ScanReport = {
    reportVersion: REPORT_VERSION,
    tool: { name: "aegis", version: options.toolVersion ?? "0.0.0" },
    generatedAt: now().toISOString(),
    protectionLevel: level,
    policy: {
      summary: policy.summary,
      minRuleSeverity: policy.minRuleSeverity,
      blockThreshold: policy.blockThreshold,
    },
    project: {
      name: path.basename(root),
      languages: profile.languages,
      frameworks: profile.frameworks,
      packageManagers: profile.packageManagers,
      tools: profile.tools,
      uncertainties: profile.uncertainties,
      filesIndexed: profile.filesIndexed,
      truncated: profile.truncated,
    },
    rules: {
      loaded: allRules.length,
      selected: selection.selected.map((s) => ({
        id: s.rule.id,
        title: s.rule.title,
        severity: s.rule.severity,
        match: s.match,
        reason: s.reason,
      })),
      skipped: selection.skipped,
      diagnostics,
    },
    checks,
    checksNotApplicable,
    findings: sorted,
    summary: {
      findingsBySeverity: counts,
      blockingFindings: sorted.filter((f) => isBlocking(f, policy.blockThreshold)).length,
      checksPlanned: checks.length,
      checksPerformed: performed,
      checksNotPerformed: notPerformed,
    },
    verdict,
    exitCode: VERDICT_EXIT[verdict],
    notes,
  };
  return redactDeep(report);
}

function errorReport(
  options: InspectOptions,
  when: Date,
  level: ProtectionLevel,
  diagnostics: Diagnostic[],
  name = "unknown",
): ScanReport {
  const policy = LEVEL_POLICIES[level];
  return redactDeep({
    reportVersion: REPORT_VERSION,
    tool: { name: "aegis" as const, version: options.toolVersion ?? "0.0.0" },
    generatedAt: when.toISOString(),
    protectionLevel: level,
    policy: {
      summary: policy.summary,
      minRuleSeverity: policy.minRuleSeverity,
      blockThreshold: policy.blockThreshold,
    },
    project: {
      name,
      languages: [],
      frameworks: [],
      packageManagers: [],
      tools: [],
      uncertainties: [],
      filesIndexed: 0,
      truncated: false,
    },
    rules: { loaded: 0, selected: [], skipped: [], diagnostics },
    checks: [],
    checksNotApplicable: [],
    findings: [],
    summary: {
      findingsBySeverity: emptySeverityCounts(),
      blockingFindings: 0,
      checksPlanned: 0,
      checksPerformed: 0,
      checksNotPerformed: 0,
    },
    verdict: "error" as const,
    exitCode: VERDICT_EXIT.error,
    notes: [
      "The inspection could not run because of the problems listed under rule/config diagnostics.",
      redactText("No checks were performed."),
    ],
  });
}
