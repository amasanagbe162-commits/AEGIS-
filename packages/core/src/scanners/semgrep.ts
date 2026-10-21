import { z } from "zod";
import { confidenceSchema, severitySchema } from "../schemas/common.js";
import { ruleIdSchema } from "../schemas/rule.js";
import type { Finding } from "../findings/model.js";
import type { CheckRunner } from "../verification/checks.js";
import {
  MAX_FINDINGS,
  launch,
  relativeToRoot,
  stderrSnippet,
  toolError,
  type ScannerDeps,
} from "./common.js";

const resultSchema = z
  .object({
    check_id: z.string(),
    path: z.string(),
    start: z.object({ line: z.number().int().optional() }).passthrough().optional(),
    extra: z
      .object({
        message: z.string().optional(),
        severity: z.string().optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
      })
      .passthrough(),
  })
  .passthrough();
const reportSchema = z
  .object({ results: z.array(resultSchema), errors: z.array(z.unknown()).default([]) })
  .passthrough();

const FALLBACK_SEVERITY = { ERROR: "high", WARNING: "medium", INFO: "low" } as const;

/** Semgrep prefixes rule ids with the config path. Keep only the stable "aegis...." part. */
export function normalizeRuleId(checkId: string): string {
  return /^.*?\b(aegis\.[a-z]+\.[A-Za-z0-9_-]+)$/.exec(checkId)?.[1] ?? checkId;
}

export interface SemgrepOptions {
  /** Path of the AEGIS Semgrep rule file. Registry rules are NOT used (no network, no uploads). */
  rulesFile: string | undefined;
}

/**
 * Static analysis with Semgrep using only AEGIS's own local rules. Metrics and version checks
 * are disabled. Semgrep prints code excerpts only for logged-in users, so findings carry no excerpt.
 */
export function createSemgrepRunner(deps: ScannerDeps, options: SemgrepOptions): CheckRunner {
  return async (ctx) => {
    if (!options.rulesFile) return toolError("no Semgrep rule file was provided to AEGIS");
    const launched = await launch(
      ctx,
      deps,
      {
        label: "semgrep",
        command: await deps.which("semgrep"),
        installHint:
          "Install Semgrep (https://semgrep.dev/docs/getting-started/) to enable static analysis.",
      },
      [
        "scan",
        "--json",
        "--quiet",
        "--metrics=off",
        "--disable-version-check",
        "--config",
        options.rulesFile,
        ctx.root,
      ],
    );
    if ("done" in launched) return launched.done;
    const { exitCode, stdout, stderr } = launched.result;
    if (exitCode !== 0)
      return toolError(`semgrep exited with code ${exitCode}: ${stderrSnippet(stderr)}`);

    let report: z.infer<typeof reportSchema>;
    try {
      const result = reportSchema.safeParse(JSON.parse(stdout));
      if (!result.success) throw new Error("unexpected report format");
      report = result.data;
    } catch {
      return toolError("semgrep produced no readable report");
    }

    const findings: Finding[] = report.results.slice(0, MAX_FINDINGS).map((r) => {
      const meta = r.extra.metadata ?? {};
      const severity =
        severitySchema.safeParse(meta.aegis_severity).data ??
        FALLBACK_SEVERITY[(r.extra.severity ?? "") as keyof typeof FALLBACK_SEVERITY] ??
        "medium";
      const confidence =
        confidenceSchema.safeParse(
          typeof meta.confidence === "string" ? meta.confidence.toLowerCase() : undefined,
        ).data ?? "medium";
      const ruleId = ruleIdSchema.safeParse(meta.aegis_rule_id).data;
      const semgrepId = normalizeRuleId(r.check_id);
      const file = relativeToRoot(ctx.root, r.path);
      return {
        ...(ruleId ? { ruleId } : {}),
        title: `Possible issue (${semgrepId})`,
        message: `${r.extra.message ?? "Semgrep reported a possible problem."} (Semgrep rule ${semgrepId}). This is a lead to investigate, not a confirmed vulnerability.`,
        severity,
        confidence,
        status: "finding",
        location: { file, ...(r.start?.line ? { line: r.start.line } : {}) },
      } satisfies Finding;
    });

    const notes: string[] = [];
    if (report.results.length > MAX_FINDINGS)
      notes.push(`${report.results.length - MAX_FINDINGS} more finding(s) not shown`);
    if (report.errors.length > 0) {
      notes.push(
        `${report.errors.length} file(s) or rule(s) could not be fully analyzed by semgrep`,
      );
    }
    const reason = notes.length > 0 ? notes.join("; ") : undefined;
    return findings.length > 0
      ? { outcome: "findings", ...(reason ? { reason } : {}), findings }
      : { outcome: "passed", ...(reason ? { reason } : {}), findings: [] };
  };
}
