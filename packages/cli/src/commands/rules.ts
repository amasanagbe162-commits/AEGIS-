import path from "node:path";
import { lstat } from "node:fs/promises";
import {
  CATEGORIES,
  checkMasterReferences,
  formatDiagnostic,
  hasErrors,
  loadRulesFromDir,
  loadProjectConfig,
  CONFIG_FILE_NAME,
  parseConfig,
  parseMasterFile,
  parseRule,
  type Category,
  type Diagnostic,
  type Rule,
} from "@aegis/core";
import { RULES_DIR } from "@aegis/rules";
import type { Runtime } from "../runtime.js";
import { exists, isDirectory, readRegularFile } from "../util/fs.js";
import { resolveRoot } from "../util/resolve-root.js";

export async function rulesListCommand(
  rt: Runtime,
  opts: { category?: Category; json?: boolean },
): Promise<number> {
  const loaded = await loadRulesFromDir(RULES_DIR);
  if (hasErrors(loaded.diagnostics)) {
    rt.err("aegis: the bundled rules could not be loaded:\n");
    for (const d of loaded.diagnostics) rt.err(`  ${formatDiagnostic(d)}\n`);
    return 2;
  }
  const rules = loaded.rules
    .map((r) => r.rule)
    .filter((r) => !opts.category || r.category === opts.category);
  if (opts.json) {
    rt.out(
      JSON.stringify(
        rules.map((r) => ({
          id: r.id,
          title: r.title,
          category: r.category,
          severity: r.severity,
          confidence: r.confidence,
          status: r.status,
          languages: r.languages,
        })),
        null,
        2,
      ) + "\n",
    );
    return 0;
  }
  if (rules.length === 0) {
    rt.out("No rules found.\n");
    return 0;
  }
  const w = (s: string, n: number) => s.padEnd(n);
  rt.out(`${w("ID", 16)}${w("SEVERITY", 10)}${w("STATUS", 10)}${w("LANGUAGES", 34)}TITLE\n`);
  for (const r of rules) {
    rt.out(
      `${w(r.id, 16)}${w(r.severity, 10)}${w(r.status, 10)}${w(r.languages.join(", "), 34)}${r.title}\n`,
    );
  }
  rt.out(
    `\n${rules.length} rule(s). Status 'proposed' means a maintainer has not approved the rule yet.\n`,
  );
  return 0;
}

interface Checked {
  label: string;
  diagnostics: Diagnostic[];
}

async function validateTarget(rt: Runtime, target: string, bundled: Rule[]): Promise<Checked> {
  const abs = path.resolve(rt.cwd, target);
  if (await isDirectory(abs)) {
    const r = await loadRulesFromDir(abs);
    return {
      label: `${target} (${r.rules.length} valid rule(s))`,
      diagnostics: r.diagnostics,
    };
  }
  const info = await lstat(abs).catch(() => undefined);
  if (!info) {
    return {
      label: target,
      diagnostics: [
        { severity: "error", source: target, path: "", message: "file or folder not found" },
      ],
    };
  }
  const lower = abs.toLowerCase();
  let text: string;
  try {
    text = await readRegularFile(abs);
  } catch (err) {
    return {
      label: target,
      diagnostics: [
        {
          severity: "error",
          source: target,
          path: "",
          message: err instanceof Error ? err.message : "cannot read file",
        },
      ],
    };
  }
  if (lower.endsWith(".aegis")) {
    const parsed = parseMasterFile(text, target);
    if (!parsed.ok) return { label: target, diagnostics: parsed.diagnostics };
    return {
      label: `${target} (master file)`,
      diagnostics: checkMasterReferences(parsed.value, bundled, target),
    };
  }
  if (lower.endsWith(".yaml") || lower.endsWith(".yml")) {
    const parsed = parseRule(text, target);
    return { label: `${target} (rule)`, diagnostics: parsed.ok ? [] : parsed.diagnostics };
  }
  if (lower.endsWith(".json")) {
    const parsed = parseConfig(text, target);
    return { label: `${target} (config)`, diagnostics: parsed.ok ? [] : parsed.diagnostics };
  }
  return {
    label: target,
    diagnostics: [
      {
        severity: "error",
        source: target,
        path: "",
        message: "unsupported file type (use .aegis, .yaml, .yml, .json, or a folder of rules)",
      },
    ],
  };
}

/**
 * Validate rules, a master .aegis file, or a config file.
 * Without an argument: the bundled rules plus this project's config and master file, if present.
 * Exit code 0 when valid, 2 when any error is found. Validation only proves the files are
 * well formed, not that a rule's advice is correct.
 */
export async function rulesValidateCommand(
  rt: Runtime,
  target: string | undefined,
): Promise<number> {
  const bundled = await loadRulesFromDir(RULES_DIR);
  const bundledRules = bundled.rules.map((r) => r.rule);
  const checked: Checked[] = [];

  if (target) {
    checked.push(await validateTarget(rt, target, bundledRules));
  } else {
    checked.push({
      label: `bundled rules (${bundled.rules.length} valid rule(s))`,
      diagnostics: bundled.diagnostics,
    });
    const resolved = await resolveRoot(rt, undefined);
    if (resolved.ok) {
      const cfg = await loadProjectConfig(resolved.root);
      if (cfg.found) checked.push({ label: CONFIG_FILE_NAME, diagnostics: cfg.diagnostics });
      const master = path.join(resolved.root, cfg.config.masterFile);
      if (await exists(master)) {
        checked.push(
          await validateTarget({ ...rt, cwd: resolved.root }, cfg.config.masterFile, bundledRules),
        );
      }
    }
  }

  rt.out("Validated:\n");
  for (const c of checked) rt.out(`  ${c.label}\n`);
  const all = checked.flatMap((c) => c.diagnostics);
  for (const d of all) rt.out(`${formatDiagnostic(d)}\n`);

  if (hasErrors(all)) {
    const n = all.filter((d) => d.severity === "error").length;
    rt.out(`\nInvalid: ${n} error(s) found.\n`);
    return 2;
  }
  rt.out(
    `\nValid${all.length > 0 ? ` (${all.length} warning(s))` : ""}. This checks structure only, not whether a rule's advice is correct.\n`,
  );
  return 0;
}

export const CATEGORY_CHOICES = CATEGORIES;
