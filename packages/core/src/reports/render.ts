import { formatDiagnostic } from "../parser/diagnostics.js";
import type { ScanReport } from "./types.js";

export function renderJson(report: ScanReport): string {
  return JSON.stringify(report, null, 2) + "\n";
}

const RESULT_LINE: Record<ScanReport["verdict"], string> = {
  clean: "CLEAN: every planned check ran and found nothing blocking.",
  findings: "FINDINGS: at least one finding is at or above the blocking threshold.",
  incomplete:
    "INCOMPLETE: nothing blocking was found, but some checks did not run. This is not a clean result.",
  error: "ERROR: the inspection could not run.",
};

function names(items: { name: string; confidence: string }[]): string {
  return items.length === 0
    ? "none detected"
    : items.map((i) => `${i.name} (${i.confidence})`).join(", ");
}

export function renderText(report: ScanReport): string {
  const out: string[] = [];
  out.push(`AEGIS report  |  protection level: ${report.protectionLevel}`);
  out.push(`  ${report.policy.summary}`);
  out.push("");

  const p = report.project;
  out.push(
    `Project: ${p.name} (${p.filesIndexed} files indexed${p.truncated ? ", truncated" : ""})`,
  );
  out.push(`  Languages:        ${names(p.languages)}`);
  out.push(`  Frameworks:       ${names(p.frameworks)}`);
  out.push(`  Package managers: ${names(p.packageManagers)}`);
  out.push(`  Tools:            ${names(p.tools)}`);
  for (const u of p.uncertainties) out.push(`  Uncertain: ${u}`);
  out.push("");

  if (report.rules.diagnostics.length > 0) {
    out.push("Problems:");
    for (const d of report.rules.diagnostics) out.push(`  ${formatDiagnostic(d)}`);
    out.push("");
  }

  out.push(`Rules: ${report.rules.selected.length} selected of ${report.rules.loaded} loaded`);
  for (const r of report.rules.selected) out.push(`  ${r.id} [${r.severity}] ${r.title}`);
  out.push("");

  out.push("Checks:");
  if (report.checks.length === 0) out.push("  none planned");
  for (const c of report.checks) {
    out.push(
      `  [${c.outcome.toUpperCase()}] ${c.name} (${c.tool})${c.reason ? `: ${c.reason}` : ""}`,
    );
  }
  for (const c of report.checksNotApplicable) out.push(`  [N/A] ${c.name}: ${c.reason}`);
  out.push("");

  out.push(`Findings: ${report.findings.length === 0 ? "none" : report.findings.length}`);
  for (const f of report.findings) {
    const where = f.location
      ? ` ${f.location.file}${f.location.line ? `:${f.location.line}` : ""}`
      : "";
    out.push(`  [${f.severity}/${f.status}, confidence ${f.confidence}]${where} ${f.title}`);
    out.push(`    ${f.message}`);
    if (f.evidence) out.push(`    evidence: ${f.evidence}`);
  }
  out.push("");

  // "CLEAN" must never sit next to a list of findings. Findings below the blocking threshold are
  // still findings: say so in the headline.
  const nonBlocking = report.findings.filter(
    (f) => f.status === "finding" || f.status === "confirmed-failure",
  ).length;
  const result =
    report.verdict === "clean" && nonBlocking > 0
      ? `NO BLOCKING FINDINGS: every planned check ran, but ${nonBlocking} non-blocking finding(s) are listed above. This is not a clean result.`
      : RESULT_LINE[report.verdict];
  out.push(`Result: ${result} (exit code ${report.exitCode})`);
  for (const n of report.notes) out.push(`  Note: ${n}`);
  return out.join("\n") + "\n";
}
