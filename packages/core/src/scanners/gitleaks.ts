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
export function createGitleaksRunner(deps: ScannerDeps): CheckRunner {
  return async (ctx) => {
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

    // Older Gitleaks (for example 8.18) has no `dir` command and answers with this message.
    if (/unknown command/i.test(stderr)) {
      return toolError(
        "this Gitleaks is too old: it has no 'dir' command (8.28.0 works). Upgrade Gitleaks to run secret detection",
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
        severity: ignored ? "low" : "high",
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
  };
}
