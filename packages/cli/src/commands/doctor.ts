import path from "node:path";
import {
  CONFIG_FILE_NAME,
  checkMasterReferences,
  formatDiagnostic,
  hasErrors,
  loadProjectConfig,
  loadRecords,
  loadRulesFromDir,
  parseMasterFile,
  type Diagnostic,
  type Rule,
} from "@aegis/core";
import { RULES_DIR } from "@aegis/rules";
import type { Runtime } from "../runtime.js";
import { exists, findExecutable, readRegularFile } from "../util/fs.js";
import { resolveRoot } from "../util/resolve-root.js";
import { ADAPTERS, verifyFiles } from "@aegis/integrations";
import { buildInstructionInput, collectSpecs } from "./agents.js";

export type DoctorStatus = "ok" | "warn" | "fail";
export interface DoctorItem {
  status: DoctorStatus;
  name: string;
  detail: string;
}
export interface DoctorResult {
  items: DoctorItem[];
  /** False when any item failed. Warnings do not fail the diagnosis. */
  ok: boolean;
}

const MIN_NODE_MAJOR = 22;
/** Tools AEGIS can use. Their absence is a warning: the matching checks are reported as skipped. */
const OPTIONAL_TOOLS: { name: string; purpose: string }[] = [
  { name: "gitleaks", purpose: "secret detection" },
  { name: "semgrep", purpose: "static analysis" },
  { name: "osv-scanner", purpose: "dependency vulnerability scan" },
  { name: "npm", purpose: "npm dependency audit" },
];

function firstLines(diags: readonly Diagnostic[], n = 3): string {
  return diags
    .slice(0, n)
    .map((d) => formatDiagnostic(d))
    .join("; ");
}

/** Inspect the environment and a project's AEGIS setup. Never modifies anything. */
export async function runDoctor(rt: Runtime, root: string): Promise<DoctorResult> {
  const items: DoctorItem[] = [];
  const add = (status: DoctorStatus, name: string, detail: string) =>
    items.push({ status, name, detail });

  const major = Number(/^v(\d+)\./.exec(rt.nodeVersion)?.[1] ?? "0");
  if (major >= MIN_NODE_MAJOR)
    add("ok", "Node.js", `${rt.nodeVersion} (needs ${MIN_NODE_MAJOR} or newer)`);
  else
    add(
      "fail",
      "Node.js",
      `${rt.nodeVersion} is too old. Install Node.js ${MIN_NODE_MAJOR} or newer.`,
    );

  add("ok", "Project folder", root);

  // Bundled rules
  const loaded = await loadRulesFromDir(RULES_DIR);
  let rules: Rule[] = [];
  if (hasErrors(loaded.diagnostics) || loaded.rules.length === 0) {
    add(
      "fail",
      "Bundled rules",
      `could not be loaded: ${firstLines(loaded.diagnostics) || "no rules found"}`,
    );
  } else {
    rules = loaded.rules.map((r) => r.rule);
    add("ok", "Bundled rules", `${rules.length} rules loaded and valid`);
  }

  // Project config
  const cfg = await loadProjectConfig(root);
  let masterFile = cfg.config.masterFile;
  if (!cfg.found) {
    add("warn", CONFIG_FILE_NAME, "not found; defaults are used. Run 'aegis init' to create it.");
  } else if (hasErrors(cfg.diagnostics)) {
    add("fail", CONFIG_FILE_NAME, `invalid: ${firstLines(cfg.diagnostics)}`);
    masterFile = "AEGIS.aegis";
  } else {
    add("ok", CONFIG_FILE_NAME, `valid (protection level: ${cfg.config.protectionLevel})`);
  }

  // Master file
  const masterPath = path.join(root, ...masterFile.split(/[\\/]/));
  if (!(await exists(masterPath))) {
    add("warn", masterFile, "not found. Run 'aegis init' to create it.");
  } else {
    try {
      const parsed = parseMasterFile(await readRegularFile(masterPath), masterFile);
      if (!parsed.ok) {
        add("fail", masterFile, `invalid: ${firstLines(parsed.diagnostics)}`);
      } else {
        const refs = rules.length > 0 ? checkMasterReferences(parsed.value, rules, masterFile) : [];
        if (hasErrors(refs))
          add("fail", masterFile, `invalid rule references: ${firstLines(refs)}`);
        else if (refs.length > 0) add("warn", masterFile, `valid, with notes: ${firstLines(refs)}`);
        else add("ok", masterFile, "valid; all rule references resolve");
      }
    } catch (err) {
      add("fail", masterFile, err instanceof Error ? err.message : "could not be read");
    }
  }

  // Agent instruction files for the agents listed in aegis.config.json
  if (cfg.found && !hasErrors(cfg.diagnostics) && cfg.config.agents.length > 0) {
    const built = await buildInstructionInput(rt, root);
    if (!built.ok) {
      add("warn", "Agent files", `could not be checked: ${built.message}`);
    } else {
      for (const id of cfg.config.agents) {
        const specs = collectSpecs([id], built.input, false).map((s) => s.spec);
        const results = await verifyFiles(root, specs);
        const bad = results.filter((r) => r.status !== "current" && r.status !== "present");
        const label = ADAPTERS[id].label;
        if (bad.length === 0) add("ok", `${label} files`, "installed and up to date");
        else
          add(
            "warn",
            `${label} files`,
            `${bad.map((b) => `${b.path} is ${b.status}`).join("; ")}. Run 'aegis agents sync --agent ${id}'.`,
          );
      }
    }
  }

  // Learning records
  const learned = await loadRecords(root);
  if (learned.problems.length > 0) {
    add(
      "warn",
      "Learning records",
      `${learned.problems.map((p) => `${p.file} ${p.message}`).join("; ")}`,
    );
  } else if (learned.records.length > 0) {
    const approved = learned.records.filter((r) => r.status === "approved").length;
    add("ok", "Learning records", `${learned.records.length} valid (${approved} approved)`);
  }

  // Optional tools: found on PATH, never executed here
  for (const tool of OPTIONAL_TOOLS) {
    const where = await findExecutable(tool.name, rt.env);
    if (where) add("ok", tool.name, `found on PATH (${tool.purpose}); not executed by doctor`);
    else
      add("warn", tool.name, `not found. The ${tool.purpose} check will be reported as skipped.`);
  }

  return { items, ok: !items.some((i) => i.status === "fail") };
}

const MARK: Record<DoctorStatus, string> = { ok: "[ok]  ", warn: "[warn]", fail: "[FAIL]" };

export function renderDoctor(result: DoctorResult): string {
  const lines = result.items.map((i) => `${MARK[i.status]} ${i.name}: ${i.detail}`);
  const fails = result.items.filter((i) => i.status === "fail").length;
  const warns = result.items.filter((i) => i.status === "warn").length;
  lines.push(
    "",
    fails > 0
      ? `Doctor found ${fails} problem(s) to fix and ${warns} warning(s).`
      : `No problems found${warns > 0 ? `, ${warns} warning(s)` : ""}.`,
  );
  return lines.join("\n") + "\n";
}

export async function doctorCommand(
  rt: Runtime,
  pathArg: string | undefined,
  opts: { json?: boolean },
): Promise<number> {
  const resolved = await resolveRoot(rt, pathArg);
  if (!resolved.ok) {
    rt.err(`aegis: ${resolved.message}\n`);
    return 2;
  }
  const result = await runDoctor(rt, resolved.root);
  rt.out(opts.json ? JSON.stringify(result, null, 2) + "\n" : renderDoctor(result));
  return result.ok ? 0 : 2;
}
