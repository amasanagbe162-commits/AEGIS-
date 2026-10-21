import { z } from "zod";
import type { Finding } from "../findings/model.js";
import type { Severity } from "../schemas/common.js";
import type { CheckRunner } from "../verification/checks.js";
import { MAX_FINDINGS, launch, stderrSnippet, toolError, type ScannerDeps } from "./common.js";

const vulnerabilitySchema = z
  .object({
    id: z.string(),
    summary: z.string().optional(),
    database_specific: z.object({ severity: z.string().optional() }).passthrough().optional(),
  })
  .passthrough();
const reportSchema = z
  .object({
    results: z
      .array(
        z
          .object({
            source: z.object({ path: z.string().optional() }).passthrough().optional(),
            packages: z
              .array(
                z
                  .object({
                    package: z
                      .object({ name: z.string(), version: z.string().optional() })
                      .passthrough(),
                    vulnerabilities: z.array(vulnerabilitySchema).default([]),
                  })
                  .passthrough(),
              )
              .default([]),
          })
          .passthrough(),
      )
      .default([]),
  })
  .passthrough();

const SEVERITY_MAP: Record<string, Severity> = {
  LOW: "low",
  MODERATE: "medium",
  MEDIUM: "medium",
  HIGH: "high",
  CRITICAL: "critical",
};

const LOCKFILE =
  /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lock|poetry\.lock|uv\.lock|Pipfile\.lock|requirements\.txt)$/;

/**
 * Dependency vulnerability scan with OSV-Scanner (v2 command line). Network: osv-scanner sends
 * package names and versions to api.osv.dev. No source code is sent.
 * Exit codes: 0 no vulnerabilities, 1 vulnerabilities found, 127 error, 128 no packages found.
 * IMPORTANT: on a network failure it exits 127 but still prints an empty JSON result, so an empty
 * report is only trusted together with exit code 0.
 */
export function createOsvScannerRunner(deps: ScannerDeps): CheckRunner {
  return async (ctx) => {
    const lockfiles = [
      ...new Set(
        ctx.profile.packageManagers
          .flatMap((m) => m.evidence.map((e) => e.file))
          .filter((f) => LOCKFILE.test(f)),
      ),
    ];
    if (lockfiles.length === 0) {
      return {
        outcome: "skipped",
        reason: "no lockfile that osv-scanner supports was found",
        findings: [],
      };
    }
    const launched = await launch(
      ctx,
      deps,
      {
        label: "osv-scanner",
        command: await deps.which("osv-scanner"),
        installHint:
          "Install OSV-Scanner v2 (https://google.github.io/osv-scanner/) to enable the vulnerability scan.",
      },
      ["scan", "source", "--format", "json", ...lockfiles.flatMap((f) => ["--lockfile", f])],
    );
    if ("done" in launched) return launched.done;
    const { exitCode, stdout, stderr } = launched.result;

    if (exitCode === 128) {
      return {
        outcome: "skipped",
        reason: "osv-scanner found no packages it could check",
        findings: [],
      };
    }
    if (exitCode !== 0 && exitCode !== 1) {
      return toolError(`osv-scanner exited with code ${exitCode}: ${stderrSnippet(stderr)}`);
    }
    let report: z.infer<typeof reportSchema>;
    try {
      const result = reportSchema.safeParse(JSON.parse(stdout));
      if (!result.success) throw new Error("unexpected report format");
      report = result.data;
    } catch {
      return toolError("osv-scanner produced no readable report");
    }

    const findings: Finding[] = [];
    for (const res of report.results) {
      for (const pkg of res.packages) {
        for (const v of pkg.vulnerabilities) {
          findings.push({
            title: `Vulnerable dependency: ${pkg.package.name}${pkg.package.version ? ` ${pkg.package.version}` : ""}`,
            message: `${v.id}${v.summary ? `: ${v.summary}` : ""}. Whether the vulnerable code is reachable in this project is not checked.`,
            severity: SEVERITY_MAP[(v.database_specific?.severity ?? "").toUpperCase()] ?? "medium",
            confidence: "high",
            status: "finding",
            location: { file: res.source?.path ? res.source.path : "lockfile" },
          });
        }
      }
    }
    if (exitCode === 1 && findings.length === 0) {
      return toolError(
        "osv-scanner reported vulnerabilities but none could be read from its output",
      );
    }
    if (findings.length === 0) return { outcome: "passed", findings: [] };
    const reason =
      findings.length > MAX_FINDINGS
        ? `${findings.length - MAX_FINDINGS} more finding(s) not shown`
        : undefined;
    return {
      outcome: "findings",
      ...(reason ? { reason } : {}),
      findings: findings.slice(0, MAX_FINDINGS),
    };
  };
}
