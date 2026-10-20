import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MAX_FILE_BYTES, loadRulesFromDir } from "../src/index.js";
import { validRuleText } from "./helpers.js";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "aegis-loader-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function put(rel: string, text: string) {
  const full = path.join(dir, rel);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, text);
}

describe("loadRulesFromDir", () => {
  it("loads a valid rule", async () => {
    await put("security/AEGIS-SEC-0001.yaml", validRuleText);
    const r = await loadRulesFromDir(dir);
    expect(r.diagnostics).toEqual([]);
    expect(r.rules.map((x) => x.rule.id)).toEqual(["AEGIS-SEC-0001"]);
  });

  it("ignores non-rule files", async () => {
    await put("security/AEGIS-SEC-0001.yaml", validRuleText);
    await put("README.md", "# not a rule");
    expect((await loadRulesFromDir(dir)).diagnostics).toEqual([]);
  });

  it("reports an invalid file but still loads the valid ones", async () => {
    await put("security/AEGIS-SEC-0001.yaml", validRuleText);
    await put("security/AEGIS-SEC-0002.yaml", "id: nope\n");
    const r = await loadRulesFromDir(dir);
    expect(r.rules).toHaveLength(1);
    expect(r.diagnostics.some((d) => d.source === "security/AEGIS-SEC-0002.yaml")).toBe(true);
  });

  it("rejects a file name that does not match the rule id", async () => {
    await put("security/wrong-name.yaml", validRuleText);
    const r = await loadRulesFromDir(dir);
    expect(r.rules).toHaveLength(0);
    expect(r.diagnostics.some((d) => d.message.includes("file name must match"))).toBe(true);
  });

  it("rejects a rule placed in the wrong category folder", async () => {
    await put("coding-errors/AEGIS-SEC-0001.yaml", validRuleText);
    const r = await loadRulesFromDir(dir);
    expect(r.diagnostics.some((d) => d.message.includes("inside the 'security' folder"))).toBe(
      true,
    );
  });

  it("rejects an id prefix that does not match the category", async () => {
    const text = validRuleText.replaceAll("AEGIS-SEC-0001", "AEGIS-COD-0001");
    await put("security/AEGIS-COD-0001.yaml", text);
    const r = await loadRulesFromDir(dir);
    expect(r.diagnostics.some((d) => d.message.includes("must start with 'AEGIS-SEC-'"))).toBe(
      true,
    );
  });

  it("rejects duplicate ids", async () => {
    await put("security/AEGIS-SEC-0001.yaml", validRuleText);
    await put("security/extra/AEGIS-SEC-0001.yaml", validRuleText);
    const r = await loadRulesFromDir(dir);
    expect(r.rules).toHaveLength(1);
    expect(r.diagnostics.some((d) => d.message.includes("duplicate rule id"))).toBe(true);
  });

  it("refuses symbolic links", async () => {
    const outside = await mkdtemp(path.join(os.tmpdir(), "aegis-outside-"));
    try {
      await writeFile(path.join(outside, "AEGIS-SEC-0001.yaml"), validRuleText);
      await mkdir(path.join(dir, "security"), { recursive: true });
      await symlink(
        path.join(outside, "AEGIS-SEC-0001.yaml"),
        path.join(dir, "security", "AEGIS-SEC-0001.yaml"),
      );
      const r = await loadRulesFromDir(dir);
      expect(r.rules).toHaveLength(0);
      expect(r.diagnostics.some((d) => d.message.includes("symbolic links"))).toBe(true);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("refuses oversized files", async () => {
    await put("security/AEGIS-SEC-0001.yaml", "a: " + "x".repeat(MAX_FILE_BYTES + 10));
    const r = await loadRulesFromDir(dir);
    expect(r.diagnostics.some((d) => d.message.includes("larger than"))).toBe(true);
  });

  it("reports a missing directory", async () => {
    const r = await loadRulesFromDir(path.join(dir, "does-not-exist"));
    expect(r.diagnostics[0]?.message).toContain("does not exist");
  });
});
