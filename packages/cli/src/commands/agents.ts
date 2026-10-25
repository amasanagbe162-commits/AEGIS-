import path from "node:path";
import {
  AGENTS,
  detectProject,
  formatDiagnostic,
  hasErrors,
  loadProjectConfig,
  loadRecords,
  loadRulesFromDir,
  parseMasterFile,
  selectRules,
  type AegisConfig,
  type ProtectionLevel,
} from "@aegis/core";
import {
  ADAPTERS,
  applyPlan,
  planFiles,
  verifyFiles,
  type AgentId,
  type FileSpec,
  type InstructionInput,
  type PlannedFile,
} from "@aegis/integrations";
import { RULES_DIR, TEMPLATES_DIR } from "@aegis/rules";
import type { Runtime } from "../runtime.js";
import { exists, readRegularFile } from "../util/fs.js";
import { resolveRoot } from "../util/resolve-root.js";

export const DEFAULT_CLI_COMMAND = "npx --no-install aegis";
/** The command ends up inside instruction files and a JSON hook, so shell metacharacters are refused. */
const CLI_COMMAND_PATTERN = /^[A-Za-z0-9_@./: -]{1,80}$/;

export function validateCliCommand(value: string): string | undefined {
  return CLI_COMMAND_PATTERN.test(value) && value.trim() !== ""
    ? undefined
    : "may only contain letters, digits, spaces and _ @ . / : -";
}

export interface InputOptions {
  level?: ProtectionLevel;
  /** Master file text to use instead of reading the project's file (init uses this before the file exists). */
  masterText?: string;
  /** Config to use instead of reading the project's file (init uses this before the file exists). */
  config?: AegisConfig;
  cliCommand?: string;
}

export type InputOutcome =
  | {
      ok: true;
      input: InstructionInput;
      config: AegisConfig;
      level: ProtectionLevel;
      notes: string[];
    }
  | { ok: false; message: string };

/** Gather everything needed to render instructions: master file, selected rules, level. */
export async function buildInstructionInput(
  rt: Runtime,
  root: string,
  opts: InputOptions = {},
): Promise<InputOutcome> {
  void rt;
  const notes: string[] = [];
  let config = opts.config;
  if (!config) {
    const loaded = await loadProjectConfig(root);
    if (hasErrors(loaded.diagnostics)) {
      return {
        ok: false,
        message: `the project's aegis.config.json is invalid: ${loaded.diagnostics.map(formatDiagnostic).join("; ")}`,
      };
    }
    config = loaded.config;
  }
  const level = opts.level ?? config.protectionLevel;

  let masterText = opts.masterText;
  let masterName = config.masterFile;
  if (masterText === undefined) {
    const file = path.join(root, ...config.masterFile.split(/[\\/]/));
    if (await exists(file)) {
      try {
        masterText = await readRegularFile(file);
      } catch (err) {
        return {
          ok: false,
          message: `${config.masterFile} could not be read: ${err instanceof Error ? err.message : "unknown error"}`,
        };
      }
    } else {
      masterText = await readRegularFile(path.join(TEMPLATES_DIR, "AEGIS.aegis"));
      masterName = "AEGIS.aegis";
      notes.push(
        `${config.masterFile} was not found, so the bundled master instructions are used. Run 'aegis init' to create it.`,
      );
    }
  }
  const parsed = parseMasterFile(masterText, masterName);
  if (!parsed.ok) {
    return {
      ok: false,
      message: `${masterName} is invalid: ${parsed.diagnostics.map(formatDiagnostic).join("; ")}`,
    };
  }

  const loadedRules = await loadRulesFromDir(RULES_DIR);
  if (hasErrors(loadedRules.diagnostics)) {
    return {
      ok: false,
      message: `the bundled rules could not be loaded: ${loadedRules.diagnostics.map(formatDiagnostic).join("; ")}`,
    };
  }
  const profile = await detectProject(root, { exclude: config.scan.exclude });
  const selection = selectRules(
    loadedRules.rules.map((r) => r.rule),
    { profile, level, config },
  );

  const learned = await loadRecords(root);
  const lessons = learned.records
    .filter((r) => r.status === "approved" && r.correction)
    .map((r) => ({ id: r.id, title: r.title, guidance: r.correction ?? "" }));

  const cliCommand = opts.cliCommand ?? DEFAULT_CLI_COMMAND;
  return {
    ok: true,
    level,
    config,
    notes,
    input: {
      master: parsed.value,
      rules: selection.selected.map((s) => s.rule),
      level,
      maxAttempts: config.selfCorrection.maxAttempts,
      cliCommand,
      checkCommand: `${cliCommand} check`,
      masterFileName: masterName,
      ...(lessons.length > 0 ? { lessons } : {}),
    },
  };
}

/** Files for the chosen agents. Two agents never write the same path twice. */
export function collectSpecs(
  agents: readonly AgentId[],
  input: InstructionInput,
  hooks: boolean,
): { agent: AgentId; spec: FileSpec }[] {
  const seen = new Set<string>();
  const out: { agent: AgentId; spec: FileSpec }[] = [];
  for (const id of agents) {
    for (const spec of ADAPTERS[id].files(input, { hooks })) {
      if (seen.has(spec.path)) continue;
      seen.add(spec.path);
      out.push({ agent: id, spec });
    }
  }
  return out;
}

export function formatPlanLine(f: PlannedFile): string {
  const verb = f.action.padEnd(9);
  return f.action === "keep"
    ? `  ${verb} ${f.spec.path}: ${f.reason}\n`
    : `  ${verb} ${f.spec.path} (${f.spec.purpose})\n`;
}

export function describeLimits(agents: readonly AgentId[]): string {
  const lines: string[] = [];
  for (const id of agents) {
    const a = ADAPTERS[id];
    lines.push(`${a.label} (${a.enforcement}): ${a.mechanism}`);
    for (const l of a.limitations) lines.push(`  - ${l}`);
  }
  return lines.join("\n") + "\n";
}

export async function agentsListCommand(rt: Runtime, opts: { json?: boolean }): Promise<number> {
  if (opts.json) {
    rt.out(
      JSON.stringify(
        AGENTS.map((id) => {
          const a = ADAPTERS[id];
          return {
            id,
            label: a.label,
            enforcement: a.enforcement,
            mechanism: a.mechanism,
            limitations: a.limitations,
          };
        }),
        null,
        2,
      ) + "\n",
    );
    return 0;
  }
  rt.out("Supported agents (use the id with --agent):\n\n");
  for (const id of AGENTS) {
    const a = ADAPTERS[id];
    rt.out(`${id}  [${a.enforcement}]\n  ${a.label}: ${a.mechanism}\n`);
    for (const l of a.limitations) rt.out(`    - ${l}\n`);
    rt.out("\n");
  }
  rt.out(
    "Enforcement: 'hook' = a program can send the agent back to fix findings; 'advisory' = the agent may ignore the instructions; 'manual' = you paste the text yourself.\n",
  );
  return 0;
}

export interface SyncOptions {
  agent?: AgentId[];
  dryRun?: boolean;
  yes?: boolean;
  mergeExisting?: boolean;
  hooks?: boolean;
  cliCommand?: string;
  level?: ProtectionLevel;
}

async function resolveAgents(
  rt: Runtime,
  root: string,
  chosen: AgentId[] | undefined,
): Promise<AgentId[] | undefined> {
  if (chosen && chosen.length > 0) return [...new Set(chosen)];
  const cfg = await loadProjectConfig(root);
  if (cfg.config.agents.length > 0) return cfg.config.agents;
  rt.err(
    "aegis: no agent chosen. Pass --agent (for example --agent claude-code), or list agents in aegis.config.json.\n",
  );
  rt.err(`Available: ${AGENTS.join(", ")}. Run 'aegis agents list' for details.\n`);
  return undefined;
}

/** Generate agent instruction files. Never overwrites anything it did not write itself. */
export async function agentsSyncCommand(
  rt: Runtime,
  pathArg: string | undefined,
  opts: SyncOptions,
): Promise<number> {
  const resolved = await resolveRoot(rt, pathArg);
  if (!resolved.ok) {
    rt.err(`aegis: ${resolved.message}\n`);
    return 2;
  }
  const { root } = resolved;
  const agents = await resolveAgents(rt, root, opts.agent);
  if (!agents) return 2;
  if (opts.cliCommand) {
    const bad = validateCliCommand(opts.cliCommand);
    if (bad) {
      rt.err(`aegis: --cli-command ${bad}\n`);
      return 2;
    }
  }

  const built = await buildInstructionInput(rt, root, {
    ...(opts.level ? { level: opts.level } : {}),
    ...(opts.cliCommand ? { cliCommand: opts.cliCommand } : {}),
  });
  if (!built.ok) {
    rt.err(`aegis: ${built.message}\n`);
    return 2;
  }
  for (const n of built.notes) rt.out(`Note: ${n}\n`);

  const specs = collectSpecs(agents, built.input, opts.hooks === true);
  const plan = await planFiles(
    root,
    specs.map((s) => s.spec),
    { mergeExisting: opts.mergeExisting === true },
  );

  rt.out(`Agent files (protection level: ${built.level}, ${built.input.rules.length} rules):\n`);
  for (const f of plan) rt.out(formatPlanLine(f));
  rt.out("\n");

  const writes = plan.filter((f) => f.next !== undefined);
  if (opts.dryRun) {
    rt.out("Dry run: no files were written.\n");
    return 0;
  }
  if (writes.length > 0) {
    if (!opts.yes) {
      if (!rt.interactive) {
        rt.err(
          "aegis: not running in a terminal, so nothing was written. Re-run with --yes to write these files, or --dry-run to preview.\n",
        );
        return 2;
      }
      if (!(await rt.prompter.confirm("Write these files?"))) {
        rt.out("Nothing was changed.\n");
        return 0;
      }
    }
    for (const r of await applyPlan(root, plan)) {
      if (r.written) rt.out(`Wrote ${r.path}\n`);
      else if (r.note) rt.out(`Skipped ${r.path}: ${r.note}\n`);
    }
  } else {
    rt.out("Nothing to write.\n");
  }
  rt.out("\n" + describeLimits(agents));
  printAgentNextSteps(rt, agents, plan, built.input);
  return 0;
}

export function printAgentNextSteps(
  rt: Runtime,
  agents: readonly AgentId[],
  plan: readonly PlannedFile[],
  input: InstructionInput,
): void {
  const keptHook = plan.find((f) => f.spec.path === ".claude/settings.json" && f.action === "keep");
  if (keptHook) {
    rt.out(
      "\n.claude/settings.json already exists and AEGIS never edits it. To enable the Stop hook, merge this into it:\n" +
        keptHook.spec.body,
    );
  }
  if (agents.includes("chatgpt")) {
    rt.out(
      "\nChatGPT: run 'aegis agents print chatgpt', then paste the text into Customize ChatGPT or a Project's instructions.\n",
    );
  }
  const keptAppend = plan.filter((f) => f.action === "keep" && f.spec.mode === "block");
  for (const k of keptAppend) {
    rt.out(
      `\n${k.spec.path} exists without an AEGIS block. Re-run with --merge-existing to append one after your text.\n`,
    );
  }
  void input;
}

export async function agentsVerifyCommand(
  rt: Runtime,
  pathArg: string | undefined,
  opts: { agent?: AgentId[]; json?: boolean; cliCommand?: string },
): Promise<number> {
  const resolved = await resolveRoot(rt, pathArg);
  if (!resolved.ok) {
    rt.err(`aegis: ${resolved.message}\n`);
    return 2;
  }
  const { root } = resolved;
  const agents = await resolveAgents(rt, root, opts.agent);
  if (!agents) return 2;
  const built = await buildInstructionInput(rt, root, {
    ...(opts.cliCommand ? { cliCommand: opts.cliCommand } : {}),
  });
  if (!built.ok) {
    rt.err(`aegis: ${built.message}\n`);
    return 2;
  }
  const specs = collectSpecs(agents, built.input, false);
  const results = await verifyFiles(
    root,
    specs.map((s) => s.spec),
  );
  const bad = results.filter((r) => r.status !== "current" && r.status !== "present");
  if (opts.json) {
    rt.out(JSON.stringify({ ok: bad.length === 0, files: results }, null, 2) + "\n");
  } else {
    for (const r of results) rt.out(`  [${r.status}] ${r.path}: ${r.detail}\n`);
    rt.out(
      bad.length === 0
        ? "\nAll agent files are installed and up to date. This checks the files only; it cannot tell whether an agent follows them.\n"
        : `\n${bad.length} file(s) need attention. 'aegis agents sync' refreshes files AEGIS wrote and never overwrites yours.\n`,
    );
  }
  return bad.length === 0 ? 0 : 1;
}

export async function agentsPrintCommand(
  rt: Runtime,
  agent: AgentId,
  pathArg: string | undefined,
  opts: { cliCommand?: string },
): Promise<number> {
  const resolved = await resolveRoot(rt, pathArg);
  if (!resolved.ok) {
    rt.err(`aegis: ${resolved.message}\n`);
    return 2;
  }
  const built = await buildInstructionInput(rt, resolved.root, {
    ...(opts.cliCommand ? { cliCommand: opts.cliCommand } : {}),
  });
  if (!built.ok) {
    rt.err(`aegis: ${built.message}\n`);
    return 2;
  }
  const spec = ADAPTERS[agent].files(built.input, { hooks: false })[0];
  if (!spec) return 2;
  rt.out(spec.printable ?? spec.body);
  return 0;
}
