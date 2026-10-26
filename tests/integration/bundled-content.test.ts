import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  CATEGORIES,
  RULE_ID_PREFIXES,
  checkMasterReferences,
  configSchema,
  hasErrors,
  loadRulesFromDir,
  masterFileSchema,
  parseConfig,
  parseMasterFile,
  renderMasterMarkdown,
  resolveMasterRules,
  ruleSchema,
} from "../../packages/core/src/index.js";
import { RULES_DIR } from "../../packages/rules/src/index.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

describe("bundled rule library", async () => {
  const { rules, diagnostics } = await loadRulesFromDir(RULES_DIR);

  it("loads with no diagnostics", () => {
    expect(diagnostics).toEqual([]);
  });

  it("contains the starter rules", () => {
    expect(rules.map((r) => r.rule.id)).toEqual([
      "AEGIS-COD-0001",
      "AEGIS-DEP-0001",
      "AEGIS-SEC-0001",
      "AEGIS-SEC-0002",
      "AEGIS-SEC-0003",
      "AEGIS-SEC-0004",
    ]);
  });

  it("uses the id prefix that matches each category", () => {
    for (const { rule } of rules) {
      expect(rule.id).toContain(`-${RULE_ID_PREFIXES[rule.category]}-`);
      expect(CATEGORIES).toContain(rule.category);
    }
  });

  it("has a bad example that differs from the good example", () => {
    for (const { rule } of rules) {
      expect(rule.badExample.code).not.toEqual(rule.goodExample.code);
    }
  });

  it("is honest about review status: every approved rule names its reviewer and who that was", () => {
    for (const { rule } of rules) {
      if (rule.status !== "approved") continue;
      expect(rule.review?.reviewer, rule.id).toBeTruthy();
      expect(["human", "ai-assisted"], rule.id).toContain(rule.review?.reviewerKind);
      if (rule.review?.reviewerKind === "ai-assisted") {
        expect(rule.review.notes, rule.id).toContain("A human maintainer has not yet confirmed it");
      }
    }
  });

  it("contains no realistic secret formats", () => {
    const patterns = [
      /AKIA[0-9A-Z]{16}/,
      /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
      /sk_live_/,
      /ghp_[A-Za-z0-9]{20,}/,
    ];
    for (const { file } of rules) {
      const text = readFileSync(path.join(RULES_DIR, file), "utf8");
      for (const p of patterns) expect(text).not.toMatch(p);
    }
  });

  it("only references scanners by allowlisted name, never by command", () => {
    for (const { rule } of rules) {
      if (rule.scanner)
        expect(Object.keys(rule.scanner).every((k) => k === "tool" || k === "ruleRef")).toBe(true);
    }
  });
});

describe("master template and config template", async () => {
  const { rules } = await loadRulesFromDir(RULES_DIR);

  it("master template is valid and all references resolve", () => {
    const parsed = parseMasterFile(
      read("packages/rules/templates/AEGIS.aegis"),
      "packages/rules/templates/AEGIS.aegis",
    );
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
    const refs = checkMasterReferences(
      parsed.value,
      rules.map((r) => r.rule),
    );
    expect(hasErrors(refs)).toBe(false);
    expect(refs).toEqual([]);
    expect(
      resolveMasterRules(
        parsed.value,
        rules.map((r) => r.rule),
      ),
    ).toHaveLength(6);
    expect(renderMasterMarkdown(parsed.value)).toContain("OP-09: Do not fabricate verification");
  });

  it("config template is valid", () => {
    expect(parseConfig(read("packages/rules/templates/aegis.config.json")).ok).toBe(true);
  });
});

describe("published JSON Schemas", () => {
  const cases: [string, z.ZodType][] = [
    ["formats/rule-schema.json", ruleSchema],
    ["formats/aegis-master-schema.json", masterFileSchema],
    ["formats/config-schema.json", configSchema],
  ];
  for (const [file, schema] of cases) {
    it(`${file} is in sync with the Zod schema (run 'npm run schemas' if this fails)`, () => {
      const published = JSON.parse(read(file));
      const generated = JSON.parse(JSON.stringify(z.toJSONSchema(schema, { io: "input" })));
      expect(published).toEqual(generated);
    });
  }
});
