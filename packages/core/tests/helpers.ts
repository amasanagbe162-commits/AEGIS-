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
  path.join(repoRoot, "templates/AEGIS.aegis"),
  "utf8",
);
export const configTemplateText = readFileSync(
  path.join(repoRoot, "templates/aegis.config.json"),
  "utf8",
);
