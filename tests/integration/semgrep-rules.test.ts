import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { SEMGREP_RULES_FILE, RULES_DIR } from "../../packages/rules/src/index.js";
import { loadRulesFromDir, ruleIdSchema, severitySchema } from "../../packages/core/src/index.js";

interface SemgrepRule {
  id: string;
  languages: string[];
  severity: string;
  message: string;
  metadata: { aegis_rule_id: string; aegis_severity: string; confidence: string };
}
const file = parse(readFileSync(SEMGREP_RULES_FILE, "utf8")) as { rules: SemgrepRule[] };

describe("AEGIS Semgrep rule file", async () => {
  const { rules } = await loadRulesFromDir(RULES_DIR);
  const ruleIds = new Set(rules.map((r) => r.rule.id));

  it("has rules, each with a stable 'aegis.<lang>.<name>' id", () => {
    expect(file.rules.length).toBeGreaterThan(0);
    for (const r of file.rules) expect(r.id).toMatch(/^aegis\.[a-z]+\.[a-z0-9-]+$/);
    expect(new Set(file.rules.map((r) => r.id)).size).toBe(file.rules.length);
  });

  it("links every Semgrep rule to an existing AEGIS rule with a valid severity", () => {
    for (const r of file.rules) {
      expect(ruleIdSchema.safeParse(r.metadata.aegis_rule_id).success).toBe(true);
      expect(ruleIds.has(r.metadata.aegis_rule_id)).toBe(true);
      expect(severitySchema.safeParse(r.metadata.aegis_severity).success).toBe(true);
      expect(["HIGH", "MEDIUM", "LOW"]).toContain(r.metadata.confidence);
    }
  });

  it("is referenced correctly: every AEGIS rule that names a Semgrep ruleRef points at a real rule", () => {
    const semgrepIds = new Set(file.rules.map((r) => r.id));
    for (const { rule } of rules) {
      if (rule.scanner?.tool === "semgrep" && rule.scanner.ruleRef) {
        expect(semgrepIds.has(rule.scanner.ruleRef)).toBe(true);
      }
    }
  });

  it("never loads rules from the Semgrep registry or uses remote configuration", () => {
    const text = readFileSync(SEMGREP_RULES_FILE, "utf8");
    expect(text).not.toMatch(/semgrep\.dev|https?:\/\//);
  });
});
