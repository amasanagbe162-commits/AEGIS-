import { Command, CommanderError, InvalidArgumentError, Option } from "commander";
import {
  CATEGORIES,
  AGENTS,
  PROTECTION_LEVELS,
  type Category,
  type ProtectionLevel,
} from "@aegis/core";
import type { Runtime } from "./runtime.js";
import { doctorCommand } from "./commands/doctor.js";
import { initCommand } from "./commands/init.js";
import { checkCommand, scanCommand } from "./commands/scan.js";
import { rulesListCommand, rulesValidateCommand } from "./commands/rules.js";
import {
  agentsListCommand,
  agentsPrintCommand,
  agentsSyncCommand,
  agentsVerifyCommand,
  validateCliCommand,
} from "./commands/agents.js";
import { hookClaudeStopCommand } from "./commands/hook.js";

type AgentId = (typeof AGENTS)[number];
const agentOption = () =>
  new Option("--agent <agent...>", "AI coding agent(s) to set up").choices(AGENTS);
const cliCommandOption = () =>
  new Option(
    "--cli-command <command>",
    "how agents should start AEGIS (default: npx --no-install aegis)",
  ).argParser((v: string) => {
    const bad = validateCliCommand(v);
    if (bad) throw new InvalidArgumentError(bad);
    return v;
  });

const levelOption = () =>
  new Option("--level <level>", "protection level (overrides aegis.config.json)").choices(
    PROTECTION_LEVELS,
  );
const projectToolsOption = () =>
  new Option(
    "--allow-project-tools",
    "allow running tsc and eslint from the project's node_modules (this executes code that ships with the project)",
  );
const formatOption = () =>
  new Option("--format <format>", "output format").choices(["text", "json"]).default("text");

/**
 * Exit codes:
 *   0  success (for scan/check: every planned check ran and nothing blocking was found)
 *   1  findings at or above the protection level's threshold
 *   2  usage error, invalid files, or the command could not run
 *   3  incomplete: nothing blocking found, but some planned checks did not run
 */
export async function run(argv: readonly string[], rt: Runtime): Promise<number> {
  let code = 0;
  const set = (n: number) => {
    code = n;
  };

  const program = new Command();
  program
    .name("aegis")
    .description(
      "AEGIS: AI Engineering Guard & Inspection System. Inspect before coding, protect during coding, verify after coding.",
    )
    .version(rt.version, "-v, --version")
    .exitOverride()
    .showHelpAfterError("(run with --help for usage)")
    .configureOutput({ writeOut: (s) => rt.out(s), writeErr: (s) => rt.err(s) })
    .addHelpText(
      "after",
      "\nExit codes: 0 ok, 1 findings, 2 error or invalid input, 3 incomplete (some checks did not run).",
    );

  program
    .command("init [path]")
    .description(
      "set up AEGIS in a project (creates aegis.config.json, AEGIS.aegis and agent instruction files; never overwrites)",
    )
    .addOption(levelOption())
    .addOption(agentOption())
    .option("--dry-run", "show what would be created without writing anything")
    .option("-y, --yes", "create the files without asking for confirmation")
    .option(
      "--merge-existing",
      "append an AEGIS block to an existing AGENTS.md that has none (your text is kept)",
    )
    .option(
      "--hooks",
      "also register the Claude Code Stop hook (only if .claude/settings.json is absent)",
    )
    .addOption(cliCommandOption())
    .action(
      async (
        p: string | undefined,
        o: {
          level?: ProtectionLevel;
          agent?: AgentId[];
          dryRun?: boolean;
          yes?: boolean;
          mergeExisting?: boolean;
          hooks?: boolean;
          cliCommand?: string;
        },
      ) =>
        set(
          await initCommand(rt, p, {
            ...(o.level ? { level: o.level } : {}),
            ...(o.agent ? { agent: o.agent } : {}),
            ...(o.dryRun ? { dryRun: true } : {}),
            ...(o.yes ? { yes: true } : {}),
            ...(o.mergeExisting ? { mergeExisting: true } : {}),
            ...(o.hooks ? { hooks: true } : {}),
            ...(o.cliCommand ? { cliCommand: o.cliCommand } : {}),
          }),
        ),
    );

  program
    .command("scan [path]")
    .description(
      "inspect a project: detect its type, select rules, run planned checks, print a full report",
    )
    .addOption(levelOption())
    .addOption(formatOption())
    .addOption(projectToolsOption())
    .action(
      async (
        p: string | undefined,
        o: { level?: ProtectionLevel; format: "text" | "json"; allowProjectTools?: boolean },
      ) =>
        set(
          await scanCommand(rt, p, {
            format: o.format,
            ...(o.level ? { level: o.level } : {}),
            ...(o.allowProjectTools ? { allowProjectTools: true } : {}),
          }),
        ),
    );

  program
    .command("check [path]")
    .description("verification step for hooks and CI: same checks as scan, compact output")
    .addOption(levelOption())
    .addOption(formatOption())
    .addOption(projectToolsOption())
    .option(
      "--allow-incomplete",
      "exit 0 even when some checks did not run (the output still says INCOMPLETE)",
    )
    .action(
      async (
        p: string | undefined,
        o: {
          level?: ProtectionLevel;
          format: "text" | "json";
          allowIncomplete?: boolean;
          allowProjectTools?: boolean;
        },
      ) =>
        set(
          await checkCommand(rt, p, {
            format: o.format,
            ...(o.level ? { level: o.level } : {}),
            ...(o.allowProjectTools ? { allowProjectTools: true } : {}),
            ...(o.allowIncomplete ? { allowIncomplete: true } : {}),
          }),
        ),
    );

  const rules = program.command("rules").description("work with protection rules");
  rules
    .command("list")
    .description("list the bundled protection rules")
    .addOption(new Option("--category <category>", "only this category").choices(CATEGORIES))
    .option("--json", "machine-readable output")
    .action(async (o: { category?: Category; json?: boolean }) =>
      set(
        await rulesListCommand(rt, {
          ...(o.category ? { category: o.category } : {}),
          ...(o.json ? { json: true } : {}),
        }),
      ),
    );
  rules
    .command("validate [target]")
    .description(
      "validate a rule file, a folder of rules, an .aegis master file, or aegis.config.json (default: bundled rules and this project's files)",
    )
    .action(async (t: string | undefined) => set(await rulesValidateCommand(rt, t)));

  const agents = program
    .command("agents")
    .description("set up and check instruction files for AI coding agents");
  agents
    .command("list")
    .description("list supported agents, how each integration works, and what it cannot do")
    .option("--json", "machine-readable output")
    .action(async (o: { json?: boolean }) =>
      set(await agentsListCommand(rt, { ...(o.json ? { json: true } : {}) })),
    );
  agents
    .command("sync [path]")
    .description(
      "generate or refresh agent instruction files (only files AEGIS wrote; yours are never overwritten)",
    )
    .addOption(agentOption())
    .addOption(levelOption())
    .option("--dry-run", "show what would change without writing anything")
    .option("-y, --yes", "write the files without asking for confirmation")
    .option(
      "--merge-existing",
      "append an AEGIS block to an existing AGENTS.md that has none (your text is kept)",
    )
    .option(
      "--hooks",
      "also register the Claude Code Stop hook (only if .claude/settings.json is absent)",
    )
    .addOption(cliCommandOption())
    .action(
      async (
        p: string | undefined,
        o: {
          agent?: AgentId[];
          level?: ProtectionLevel;
          dryRun?: boolean;
          yes?: boolean;
          mergeExisting?: boolean;
          hooks?: boolean;
          cliCommand?: string;
        },
      ) =>
        set(
          await agentsSyncCommand(rt, p, {
            ...(o.agent ? { agent: o.agent } : {}),
            ...(o.level ? { level: o.level } : {}),
            ...(o.dryRun ? { dryRun: true } : {}),
            ...(o.yes ? { yes: true } : {}),
            ...(o.mergeExisting ? { mergeExisting: true } : {}),
            ...(o.hooks ? { hooks: true } : {}),
            ...(o.cliCommand ? { cliCommand: o.cliCommand } : {}),
          }),
        ),
    );
  agents
    .command("verify [path]")
    .description(
      "check that agent instruction files are installed and up to date (changes nothing)",
    )
    .addOption(agentOption())
    .addOption(cliCommandOption())
    .option("--json", "machine-readable output")
    .action(
      async (
        p: string | undefined,
        o: { agent?: AgentId[]; cliCommand?: string; json?: boolean },
      ) =>
        set(
          await agentsVerifyCommand(rt, p, {
            ...(o.agent ? { agent: o.agent } : {}),
            ...(o.cliCommand ? { cliCommand: o.cliCommand } : {}),
            ...(o.json ? { json: true } : {}),
          }),
        ),
    );
  agents
    .command("print <agent> [path]")
    .description("print the instructions for one agent, ready to copy (nothing is written)")
    .addOption(cliCommandOption())
    .action(async (a: string, p: string | undefined, o: { cliCommand?: string }) => {
      if (!(AGENTS as readonly string[]).includes(a)) {
        rt.err(`aegis: unknown agent '${a}'. Choose one of: ${AGENTS.join(", ")}\n`);
        set(2);
        return;
      }
      set(
        await agentsPrintCommand(rt, a as AgentId, p, {
          ...(o.cliCommand ? { cliCommand: o.cliCommand } : {}),
        }),
      );
    });

  program
    .command("hook")
    .description("entry points that AI agents call (not for manual use)")
    .command("claude-stop")
    .description(
      "Claude Code Stop hook: run the checks and send Claude back to fix blocking findings (limited by selfCorrection.maxAttempts)",
    )
    .action(async () => set(await hookClaudeStopCommand(rt)));

  program
    .command("doctor [path]")
    .description("diagnose your environment and AEGIS setup (changes nothing)")
    .option("--json", "machine-readable output")
    .action(async (p: string | undefined, o: { json?: boolean }) =>
      set(await doctorCommand(rt, p, { ...(o.json ? { json: true } : {}) })),
    );

  try {
    await program.parseAsync([...argv], { from: "user" });
  } catch (err) {
    if (err instanceof CommanderError) {
      // help and version exit with code 0; anything else is a usage error
      return err.exitCode === 0 ? 0 : 2;
    }
    rt.err(`aegis: unexpected error: ${err instanceof Error ? err.message : String(err)}\n`);
    return 2;
  }
  return code;
}
