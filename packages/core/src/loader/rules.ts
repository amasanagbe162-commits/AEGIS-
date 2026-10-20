import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { parseRule, MAX_FILE_BYTES, type Diagnostic } from "../parser/index.js";
import { RULE_ID_PREFIXES, type Rule } from "../schemas/index.js";

export interface LoadedRule {
  rule: Rule;
  /** Path relative to the rules directory, using "/" separators. */
  file: string;
}

export interface RuleLoadResult {
  rules: LoadedRule[];
  diagnostics: Diagnostic[];
}

const RULE_EXTENSIONS = new Set([".yaml", ".yml"]);

async function* walk(dir: string): AsyncGenerator<string> {
  const entries = await readdir(dir, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else yield full;
  }
}

function isInside(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

/**
 * Load and validate every rule file under a directory.
 *
 * - Symbolic links are refused (they could point outside the rules directory).
 * - Oversized files are refused before reading.
 * - Invalid files produce diagnostics and are left out; valid files still load.
 * - Checks that the file name, category folder and ID prefix agree with the rule's own fields.
 * - Rule content is parsed as data and never executed.
 */
export async function loadRulesFromDir(dir: string): Promise<RuleLoadResult> {
  const diagnostics: Diagnostic[] = [];
  const rules: LoadedRule[] = [];
  const seen = new Map<string, string>();

  let root: string;
  try {
    root = await realpath(dir);
  } catch {
    return {
      rules,
      diagnostics: [
        { severity: "error", source: dir, path: "", message: "rules directory does not exist" },
      ],
    };
  }

  for await (const file of walk(root)) {
    const rel = path.relative(root, file).split(path.sep).join("/");
    if (!RULE_EXTENSIONS.has(path.extname(file).toLowerCase())) continue;

    const info = await lstat(file);
    if (info.isSymbolicLink() || !isInside(root, file)) {
      diagnostics.push({
        severity: "error",
        source: rel,
        path: "",
        message: "symbolic links are not allowed in the rules directory",
      });
      continue;
    }
    if (info.size > MAX_FILE_BYTES) {
      diagnostics.push({
        severity: "error",
        source: rel,
        path: "",
        message: `file is larger than the ${MAX_FILE_BYTES / 1024} KB limit`,
      });
      continue;
    }

    const parsed = parseRule(await readFile(file, "utf8"), rel);
    if (!parsed.ok) {
      diagnostics.push(...parsed.diagnostics);
      continue;
    }
    const rule = parsed.value;

    const problems: string[] = [];
    const expectedPrefix = `AEGIS-${RULE_ID_PREFIXES[rule.category]}-`;
    if (!rule.id.startsWith(expectedPrefix)) {
      problems.push(`id must start with '${expectedPrefix}' for category '${rule.category}'`);
    }
    if (path.basename(file, path.extname(file)) !== rule.id) {
      problems.push(`file name must match the rule id '${rule.id}'`);
    }
    if (rel.split("/")[0] !== rule.category) {
      problems.push(`file must be inside the '${rule.category}' folder`);
    }
    const earlier = seen.get(rule.id);
    if (earlier) problems.push(`duplicate rule id (already defined in ${earlier})`);

    if (problems.length > 0) {
      for (const message of problems) {
        diagnostics.push({ severity: "error", source: rel, path: "id", message });
      }
      continue;
    }
    seen.set(rule.id, rel);
    rules.push({ rule, file: rel });
  }

  rules.sort((a, b) => a.rule.id.localeCompare(b.rule.id));
  return { rules, diagnostics };
}
