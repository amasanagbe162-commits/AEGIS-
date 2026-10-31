import { lstat, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { createGitignoreMatcher } from "../project-detection/index-files.js";
import type { Finding } from "../findings/model.js";
import type { CheckRunner } from "../verification/checks.js";
import {
  MAX_FINDINGS,
  launch,
  relativeToRoot,
  stderrSnippet,
  toolError,
  type ScannerDeps,
} from "./common.js";

const leakSchema = z
  .object({
    RuleID: z.string(),
    Description: z.string().optional(),
    File: z.string(),
    StartLine: z.number().int().optional(),
  })
  .passthrough();
const reportSchema = z.array(leakSchema);

/**
 * Secret detection with Gitleaks. Runs in directory mode with --redact, so secret values never
 * leave the tool. Findings in .gitignore'd files are reported as warnings: they are not committed,
 * but the value still lives on disk.
 *
 * Exit codes: 0 no leaks, 1 leaks found OR a fatal error (so the output decides which).
 */
/** Gitleaks's own default rules, and nothing the project adds. */
const AEGIS_GITLEAKS_CONFIG = 'title = "AEGIS secret detection"\n\n[extend]\nuseDefault = true\n';

type Context = Parameters<CheckRunner>[0];
type RunResult = Awaited<ReturnType<CheckRunner>>;

export function createGitleaksRunner(deps: ScannerDeps): CheckRunner {
  return async (ctx) => {
    // A private folder per run holds AEGIS's own Gitleaks config.
    const scratch = await mkdtemp(path.join(os.tmpdir(), "aegis-gitleaks-"));
    try {
      await writeFile(path.join(scratch, "aegis.toml"), AEGIS_GITLEAKS_CONFIG, { flag: "wx" });
      return await detect(ctx, scratch);
    } finally {
      await rm(scratch, { recursive: true, force: true }).catch(() => undefined);
    }
  };

  async function detect(ctx: Context, scratch: string): Promise<RunResult> {
    // In directory mode Gitleaks ALWAYS reads <project>/.gitleaksignore, whatever flags are given
    // (verified with Gitleaks 8.28.0), and any entry in it hides a finding. Because anyone, including
    // an AI agent, can add an entry, AEGIS cannot trust a scan that ran with one present, and it
    // cannot disable the file. So it refuses to report a result, and says why.
    const ignoreFile = await lstat(path.join(ctx.root, ".gitleaksignore")).then(
      () => true,
      () => false,
    );
    if (ignoreFile) {
      return toolError(
        "the project has a .gitleaksignore file. Gitleaks always honors it and AEGIS cannot turn it off, so entries in it could hide real secrets and this check was not trusted. Remove or rename the file to run the check",
      );
    }
    const launched = await launch(
      ctx,
      deps,
      {
        label: "gitleaks",
        command: await deps.which("gitleaks"),
        installHint:
          "Install Gitleaks (https://github.com/gitleaks/gitleaks) to enable secret detection.",
      },
      [
        "dir",
        ctx.root,
        // The PROJECT must not configure the scanner that checks it. Without these flags a project's
        // own .gitleaks.toml or an inline "gitleaks:allow" comment can hide a real secret, and an AI
        // agent can add either in seconds. (A .gitleaksignore file cannot be switched off this way:
        // see the check at the start of detect().)
        "--config",
        path.join(scratch, "aegis.toml"),
        "--ignore-gitleaks-allow",
        "--report-format",
        "json",
        "--report-path",
        "-",
        "--redact",
        "--no-banner",
        "--no-color",
      ],
    );
    if ("done" in launched) return launched.done;
    const { exitCode, stdout, stderr } = launched.result;

    // Older Gitleaks (for example 8.18) has no `dir` command or no --ignore-gitleaks-allow flag.
    if (/unknown (command|flag)/i.test(stderr)) {
      return toolError(
        "this Gitleaks is too old: it lacks the 'dir' command or the --ignore-gitleaks-allow flag (8.28.0 works). Upgrade Gitleaks to run secret detection",
      );
    }
    if (exitCode !== 0 && exitCode !== 1) {
      return toolError(`gitleaks exited with code ${exitCode}: ${stderrSnippet(stderr)}`);
    }
    let parsed: z.infer<typeof reportSchema>;
    try {
      const result = reportSchema.safeParse(JSON.parse(stdout));
      if (!result.success) throw new Error("unexpected report format");
      parsed = result.data;
    } catch {
      return toolError(
        exitCode === 1
          ? `gitleaks failed: ${stderrSnippet(stderr) || "no readable report was produced"}`
          : "gitleaks produced no readable report",
      );
    }
    if (exitCode === 1 && parsed.length === 0) {
      return toolError(
        `gitleaks reported a problem: ${stderrSnippet(stderr) || "exit code 1 without any leaks listed"}`,
      );
    }
    if (parsed.length === 0) return { outcome: "passed", findings: [] };

    const isIgnored = await createGitignoreMatcher(ctx.root);
    const findings: Finding[] = parsed.slice(0, MAX_FINDINGS).map((leak) => {
      const file = relativeToRoot(ctx.root, leak.File);
      const ignored = isIgnored(file);
      return {
        ruleId: "AEGIS-SEC-0003",
        title: `Possible secret detected (${leak.RuleID})`,
        message: ignored
          ? `A secret-like value was found in ${file}, which is listed in .gitignore, so it is probably not committed. Make sure the file stays untracked.`
          : `A secret-like value was found in ${file}. If it is a real credential, treat it as exposed: rotate it and load it from the environment instead.`,
        // The rule that governs this check (AEGIS-SEC-0003) is critical: an exposed credential must block
        // at every protection level. Confidence stays "medium" because a pattern cannot prove a value is real.
        severity: ignored ? "low" : "critical",
        confidence: "medium",
        status: ignored ? "warning" : "finding",
        location: { file, ...(leak.StartLine ? { line: leak.StartLine } : {}) },
      } satisfies Finding;
    });
    const extra =
      parsed.length > MAX_FINDINGS
        ? `${parsed.length - MAX_FINDINGS} more finding(s) not shown`
        : undefined;
    return { outcome: "findings", ...(extra ? { reason: extra } : {}), findings };
  }
}
