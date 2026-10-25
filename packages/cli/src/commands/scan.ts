import {
  inspectProject,
  renderJson,
  renderText,
  type ProtectionLevel,
  type ScanReport,
} from "@aegis/core";
import { rulesInUse } from "../util/rules-source.js";
import type { Runtime } from "../runtime.js";
import { resolveRoot } from "../util/resolve-root.js";

export interface ScanOptions {
  level?: ProtectionLevel;
  format?: "text" | "json";
  allowProjectTools?: boolean;
}

async function inspect(rt: Runtime, pathArg: string | undefined, opts: ScanOptions) {
  const resolved = await resolveRoot(rt, pathArg);
  if (!resolved.ok) {
    rt.err(`aegis: ${resolved.message}\n`);
    return undefined;
  }
  const use = await rulesInUse(resolved.root);
  if (use.warning) rt.err(`aegis: note: ${use.warning}\n`);
  return inspectProject({
    root: resolved.root,
    rulesDir: use.dir,
    toolVersion: rt.version,
    ...(opts.level ? { level: opts.level } : {}),
    ...(opts.allowProjectTools ? { allowProjectTools: true } : {}),
    ...(rt.runners ? { runners: rt.runners } : {}),
  });
}

/** Full report: project detection, selected rules, planned checks, findings and result. */
export async function scanCommand(
  rt: Runtime,
  pathArg: string | undefined,
  opts: ScanOptions,
): Promise<number> {
  const report = await inspect(rt, pathArg, opts);
  if (!report) return 2;
  rt.out(opts.format === "json" ? renderJson(report) : renderText(report));
  return report.exitCode;
}

/** Compact text for the "verify after coding" step: checks, findings and the result only. */
export function renderCheckText(report: ScanReport): string {
  const lines = [
    `AEGIS check  |  level: ${report.protectionLevel}  |  result: ${report.verdict.toUpperCase()}`,
  ];
  for (const c of report.checks) {
    lines.push(`  [${c.outcome.toUpperCase()}] ${c.name}${c.reason ? `: ${c.reason}` : ""}`);
  }
  if (report.checks.length === 0) lines.push("  no checks were planned");
  for (const f of report.findings) {
    const where = f.location
      ? ` ${f.location.file}${f.location.line ? `:${f.location.line}` : ""}`
      : "";
    lines.push(`  ${f.severity}/${f.status}${where}: ${f.title}`);
  }
  for (const d of report.rules.diagnostics) lines.push(`  ${d.severity}: ${d.source} ${d.message}`);
  lines.push(
    `  ${report.summary.checksPerformed}/${report.summary.checksPlanned} checks performed, ${report.summary.blockingFindings} blocking finding(s).`,
  );
  if (report.verdict === "incomplete")
    lines.push("  Incomplete is not clean: some planned checks did not run.");
  return lines.join("\n") + "\n";
}

export interface CheckOptions extends ScanOptions {
  allowIncomplete?: boolean;
}

/**
 * Verification step for hooks and CI. Same engine as 'scan', shorter output.
 * --allow-incomplete turns exit code 3 into 0, but the output still says INCOMPLETE.
 */
export async function checkCommand(
  rt: Runtime,
  pathArg: string | undefined,
  opts: CheckOptions,
): Promise<number> {
  const report = await inspect(rt, pathArg, opts);
  if (!report) return 2;
  rt.out(opts.format === "json" ? renderJson(report) : renderCheckText(report));
  if (opts.allowIncomplete && report.verdict === "incomplete") {
    if (opts.format !== "json")
      rt.out(
        "  --allow-incomplete was set, so the exit code is 0 even though the result is incomplete.\n",
      );
    return 0;
  }
  return report.exitCode;
}
