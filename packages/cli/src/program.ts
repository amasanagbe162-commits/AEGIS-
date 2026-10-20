import { Command, CommanderError, Option } from "commander";
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

const levelOption = () =>
  new Option("--level <level>", "protection level (overrides aegis.config.json)").choices(
    PROTECTION_LEVELS,
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
      "set up AEGIS in a project (creates aegis.config.json and AEGIS.aegis; never overwrites)",
    )
    .addOption(levelOption())
    .addOption(new Option("--agent <agent...>", "AI coding agent(s) you use").choices(AGENTS))
    .option("--dry-run", "show what would be created without writing anything")
    .option("-y, --yes", "create the files without asking for confirmation")
    .action(
      async (
        p: string | undefined,
        o: {
          level?: ProtectionLevel;
          agent?: (typeof AGENTS)[number][];
          dryRun?: boolean;
          yes?: boolean;
        },
      ) =>
        set(
          await initCommand(rt, p, {
            ...(o.level ? { level: o.level } : {}),
            ...(o.agent ? { agent: o.agent } : {}),
            ...(o.dryRun ? { dryRun: true } : {}),
            ...(o.yes ? { yes: true } : {}),
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
    .action(
      async (p: string | undefined, o: { level?: ProtectionLevel; format: "text" | "json" }) =>
        set(await scanCommand(rt, p, { format: o.format, ...(o.level ? { level: o.level } : {}) })),
    );

  program
    .command("check [path]")
    .description("verification step for hooks and CI: same checks as scan, compact output")
    .addOption(levelOption())
    .addOption(formatOption())
    .option(
      "--allow-incomplete",
      "exit 0 even when some checks did not run (the output still says INCOMPLETE)",
    )
    .action(
      async (
        p: string | undefined,
        o: { level?: ProtectionLevel; format: "text" | "json"; allowIncomplete?: boolean },
      ) =>
        set(
          await checkCommand(rt, p, {
            format: o.format,
            ...(o.level ? { level: o.level } : {}),
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
