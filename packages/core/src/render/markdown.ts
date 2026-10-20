import type { MasterFile, Rule } from "../schemas/index.js";

const SEVERITY_ORDER = ["critical", "high", "medium", "low", "informational"] as const;

/**
 * Convert a validated master file into Markdown that an AI agent can read
 * (for example as the body of CLAUDE.md or a Copilot instructions file).
 * Phase 6 builds the agent-specific files on top of this.
 */
export function renderMasterMarkdown(master: MasterFile, rules: readonly Rule[] = []): string {
  const out: string[] = [];
  out.push(
    `# ${master.name}`,
    "",
    master.description,
    "",
    `**Principle:** ${master.principle}`,
    "",
  );

  out.push("## Operating rules", "");
  for (const rule of master.operatingRules) {
    out.push(`### ${rule.id}: ${rule.title}`, "");
    for (const line of rule.instructions) out.push(`- ${line}`);
    out.push("");
  }

  out.push("## Self-correction protocol", "");
  out.push(`Maximum attempts per problem: ${master.selfCorrection.maxAttempts}.`, "");
  master.selfCorrection.steps.forEach((s, i) =>
    out.push(`${i + 1}. **${s.name}**: ${s.description}`),
  );
  out.push("");
  for (const note of master.selfCorrection.notes) out.push(`- ${note}`);
  if (master.selfCorrection.notes.length > 0) out.push("");

  out.push("## Severity and expected actions", "");
  for (const level of SEVERITY_ORDER) {
    out.push(`### ${level[0]?.toUpperCase()}${level.slice(1)}`, "");
    for (const action of master.severityActions[level]) out.push(`- ${action}`);
    out.push("");
  }

  if (master.dangerousOperations.length > 0) {
    out.push("## Operations that require explicit user confirmation", "");
    for (const op of master.dangerousOperations) out.push(`- ${op}`);
    out.push("");
  }

  if (rules.length > 0) {
    out.push("## Protection rules in effect", "");
    for (const r of rules) {
      out.push(`- **${r.id}** (${r.severity}): ${r.title}. Applies when: ${r.appliesWhen}`);
    }
    out.push("");
  }

  if (master.limitations.length > 0) {
    out.push("## Limitations", "");
    for (const l of master.limitations) out.push(`- ${l}`);
    out.push("");
  }

  return out.join("\n").trimEnd() + "\n";
}
