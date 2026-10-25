import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(here, "..", "..", "..");

/** Text of a known-good bundled rule, used as a base for mutation tests. */
export const validRuleText = readFileSync(
  path.join(repoRoot, "packages/rules/data/security/AEGIS-SEC-0001.yaml"),
  "utf8",
);

export const masterTemplateText = readFileSync(
  path.join(repoRoot, "packages/rules/templates/AEGIS.aegis"),
  "utf8",
);
export const configTemplateText = readFileSync(
  path.join(repoRoot, "packages/rules/templates/aegis.config.json"),
  "utf8",
);

export async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "aegis-core-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
