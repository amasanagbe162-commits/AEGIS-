import { z } from "zod";
import type { Finding } from "../findings/model.js";
import type { Severity } from "../schemas/common.js";
import type { CheckRunner } from "../verification/checks.js";
import { MAX_FINDINGS, launch, stderrSnippet, toolError, type ScannerDeps } from "./common.js";

const advisorySchema = z
  .object({
    title: z.string(),
    url: z.string().optional(),
    severity: z.string().optional(),
    range: z.string().optional(),
  })
  .passthrough();
const vulnSchema = z
  .object({
    name: z.string(),
    severity: z.string(),
    range: z.string().optional(),
    via: z.array(z.union([z.string(), advisorySchema])).default([]),
    fixAvailable: z.unknown().optional(),
  })
  .passthrough();
const errorReportSchema = z
  .object({
    message: z.string().optional(),
    error: z.object({ code: z.string().optional(), summary: z.string().optional() }).passthrough(),
  })
  .passthrough();
const vulnReportSchema = z
  .object({ vulnerabilities: z.record(z.string(), vulnSchema) })
  .passthrough();

const SEVERITY_MAP: Record<string, Severity> = {
  info: "informational",
  low: "low",
  moderate: "medium",
  high: "high",
  critical: "critical",
};

/**
 * npm dependency audit from the lockfile (no node_modules needed). Network: npm sends the list of
 * package names and versions from the lockfile to the npm registry. No source code is sent.
 * Note: npm audit exits 1 both for "vulnerabilities found" and for failures, so the JSON decides.
 */
export function createNpmAuditRunner(deps: ScannerDeps): CheckRunner {
  return async (ctx) => {
    const launched = await launch(
      ctx,
      deps,
      {
        label: "npm",
        command: await deps.which("npm"),
        installHint: "Install Node.js/npm to enable the dependency audit.",
      },
      ["audit", "--json", "--package-lock-only"],
    );
    if ("done" in launched) return launched.done;
    const { exitCode, stdout, stderr } = launched.result;

    let json: unknown;
    try {
      json = JSON.parse(stdout);
    } catch {
      return toolError(
        `npm audit produced no readable report (exit code ${exitCode}): ${stderrSnippet(stderr)}`,
      );
    }
    const failure = errorReportSchema.safeParse(json);
    if (failure.success) {
      const e = failure.data.error;
      // The summary can be an empty string, so prefer the first non-empty explanation.
      const detail =
        e.summary?.trim() || failure.data.message?.trim() || stderrSnippet(stderr) || "no details";
      return toolError(`npm audit failed${e.code ? ` (${e.code})` : ""}: ${detail}`);
    }
    const parsed = vulnReportSchema.safeParse(json);
    if (!parsed.success)
      return toolError(`npm audit produced an unexpected report format (exit code ${exitCode})`);

    const vulns = Object.values(parsed.data.vulnerabilities);
    if (vulns.length === 0) {
      return exitCode === 0
        ? { outcome: "passed", findings: [] }
        : toolError(`npm audit exited with code ${exitCode} without a report`);
    }
    const findings: Finding[] = vulns.slice(0, MAX_FINDINGS).map((v) => {
      const advisories = v.via.filter(
        (x): x is z.infer<typeof advisorySchema> => typeof x !== "string",
      );
      const transitive = v.via.filter((x): x is string => typeof x === "string");
      const detail =
        advisories.length > 0
          ? `Advisories: ${advisories
              .slice(0, 3)
              .map((a) => (a.url ? `${a.title} (${a.url})` : a.title))
              .join("; ")}.`
          : `Vulnerable through ${transitive.join(", ")}.`;
      const fix = v.fixAvailable
        ? "A fix is available; review it before upgrading."
        : "No fix is available yet.";
      return {
        title: `Vulnerable dependency: ${v.name}`,
        message:
          `${v.name} ${v.range ?? ""} is affected. ${detail} ${fix} Whether the vulnerable code is reachable in this project is not checked.`
            .replace(/\s+/g, " ")
            .trim(),
        severity: SEVERITY_MAP[v.severity] ?? "medium",
        confidence: "high",
        status: "finding",
        location: { file: "package-lock.json" },
      } satisfies Finding;
    });
    const reason =
      vulns.length > MAX_FINDINGS
        ? `${vulns.length - MAX_FINDINGS} more finding(s) not shown`
        : undefined;
    return { outcome: "findings", ...(reason ? { reason } : {}), findings };
  };
}
