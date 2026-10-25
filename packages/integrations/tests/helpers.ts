import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadRulesFromDir,
  parseMasterFile,
  selectRules,
  type MasterFile,
  type Rule,
} from "@aegis/core";
import { RULES_DIR, TEMPLATES_DIR } from "@aegis/rules";
import { readFile } from "node:fs/promises";
import type { InstructionInput } from "../src/types.js";

export const here = path.dirname(fileURLToPath(import.meta.url));

export async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "aegis-int-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function realMaster(): Promise<MasterFile> {
  const parsed = parseMasterFile(
    await readFile(path.join(TEMPLATES_DIR, "AEGIS.aegis"), "utf8"),
    "AEGIS.aegis",
  );
  if (!parsed.ok) throw new Error("bundled master file is invalid");
  return parsed.value;
}

export async function realRules(): Promise<Rule[]> {
  const loaded = await loadRulesFromDir(RULES_DIR);
  return loaded.rules.map((r) => r.rule);
}

export async function makeInput(over: Partial<InstructionInput> = {}): Promise<InstructionInput> {
  const rules = await realRules();
  const selected = selectRules(rules, {
    level: "maximum",
    profile: {
      languages: [{ name: "javascript", confidence: "high", evidence: [] }],
      frameworks: [],
      packageManagers: [],
      tools: [],
      uncertainties: [],
      filesIndexed: 0,
      truncated: false,
    } as never,
  }).selected.map((s) => s.rule);
  return {
    master: await realMaster(),
    rules: selected,
    level: "standard",
    maxAttempts: 3,
    cliCommand: "npx --no-install aegis",
    checkCommand: "npx --no-install aegis check",
    masterFileName: "AEGIS.aegis",
    ...over,
  };
}
