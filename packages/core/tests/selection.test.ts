import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  LEVEL_POLICIES,
  detectProject,
  loadRulesFromDir,
  selectRules,
  type ProjectProfile,
  type Rule,
} from "../src/index.js";
import { repoRoot } from "./helpers.js";

const rulesDir = path.join(repoRoot, "packages/rules/data");
const loadRules = async () => (await loadRulesFromDir(rulesDir)).rules.map((r) => r.rule);
const fixture = (n: string) => detectProject(path.join(repoRoot, "tests/fixtures", n));

function emptyProfile(): ProjectProfile {
  return {
    root: "/x",
    languages: [],
    frameworks: [],
    packageManagers: [],
    tools: [],
    uncertainties: [],
    filesIndexed: 0,
    truncated: false,
  };
}
const ids = (s: { selected: { rule: Rule }[] }) => s.selected.map((x) => x.rule.id);

describe("selectRules", () => {
  it("selects JavaScript/TypeScript rules for a Next.js project and records why", async () => {
    const rules = await loadRules();
    const sel = selectRules(rules, { profile: await fixture("nextjs-sample"), level: "standard" });
    expect(ids(sel)).toEqual([
      "AEGIS-COD-0001",
      "AEGIS-DEP-0001",
      "AEGIS-SEC-0001",
      "AEGIS-SEC-0002",
      "AEGIS-SEC-0003",
      "AEGIS-SEC-0004",
    ]);
    const secEx = sel.selected.find((s) => s.rule.id === "AEGIS-SEC-0004");
    expect(secEx?.match).toBe("language"); // express rule, but express was not detected
    const dep = sel.selected.find((s) => s.rule.id === "AEGIS-DEP-0001");
    expect(dep?.match).toBe("framework"); // node.js detected
  });

  it("selects only the rules matching a Python project", async () => {
    const rules = await loadRules();
    const sel = selectRules(rules, { profile: await fixture("python-sample"), level: "standard" });
    expect(ids(sel)).toEqual(["AEGIS-SEC-0003"]); // the only rule listing python
    expect(sel.skipped.find((s) => s.id === "AEGIS-SEC-0001")?.reason).toContain(
      "no matching language",
    );
  });

  it("selects no language-specific rules when no language was detected", async () => {
    const sel = selectRules(await loadRules(), { profile: emptyProfile(), level: "maximum" });
    expect(sel.selected).toEqual([]);
  });

  it("selects language-agnostic rules for every project", async () => {
    const universal = { ...(await loadRules())[0]!, languages: [] } as Rule;
    const sel = selectRules([universal], { profile: emptyProfile(), level: "standard" });
    expect(sel.selected[0]?.match).toBe("language-agnostic");
  });

  it("honors disabledRules and ruleCollections", async () => {
    const rules = await loadRules();
    const profile = await fixture("nextjs-sample");
    const a = selectRules(rules, {
      profile,
      level: "standard",
      config: { disabledRules: ["AEGIS-SEC-0001"], ruleCollections: undefined },
    });
    expect(ids(a)).not.toContain("AEGIS-SEC-0001");
    expect(a.skipped.find((s) => s.id === "AEGIS-SEC-0001")?.reason).toContain("disabled");
    const b = selectRules(rules, {
      profile,
      level: "standard",
      config: { disabledRules: [], ruleCollections: ["security"] },
    });
    expect(ids(b).every((id) => id.includes("-SEC-"))).toBe(true);
  });

  it("never selects rejected or superseded rules", async () => {
    const base = (await loadRules())[0]!;
    const profile = await fixture("nextjs-sample");
    for (const status of ["rejected", "superseded"] as const) {
      const sel = selectRules([{ ...base, status }], { profile, level: "maximum" });
      expect(sel.selected).toEqual([]);
    }
  });

  it("applies the level's minimum severity and categories", async () => {
    const base = (await loadRules()).find((r) => r.id === "AEGIS-SEC-0001")!;
    const profile = await fixture("nextjs-sample");
    const lowRule = { ...base, severity: "low" as const };
    expect(selectRules([lowRule], { profile, level: "standard" }).selected).toHaveLength(0);
    expect(selectRules([lowRule], { profile, level: "advanced" }).selected).toHaveLength(1);
    const arch = { ...base, category: "architecture" as const };
    expect(selectRules([arch], { profile, level: "advanced" }).selected).toHaveLength(0);
    expect(selectRules([arch], { profile, level: "maximum" }).selected).toHaveLength(1);
  });
});

describe("protection levels", () => {
  it("get strictly broader and stricter", () => {
    const s = LEVEL_POLICIES.standard;
    const a = LEVEL_POLICIES.advanced;
    const m = LEVEL_POLICIES.maximum;
    expect(a.categories.length).toBeGreaterThan(s.categories.length);
    expect(m.categories.length).toBeGreaterThan(a.categories.length);
    expect(s.checkIds.length).toBeLessThan(a.checkIds.length);
    expect(s.blockThreshold).toBe("critical");
    expect(a.blockThreshold).toBe("high");
    expect(m.blockThreshold).toBe("medium");
  });
});
