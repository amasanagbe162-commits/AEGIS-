import { z } from "zod";
import type { Finding } from "../findings/model.js";
import type { CheckRunner } from "../verification/checks.js";
import {
  MAX_FINDINGS,
  PROJECT_TOOLS_DISABLED,
  findProjectTool,
  launch,
  relativeToRoot,
  stderrSnippet,
  toolError,
  type ScannerDeps,
} from "./common.js";

const TSC_LINE = /^(.+?)\((\d+),\d+\): (error|warning) (TS\d+): (.*)$/;

/** Parse `tsc --pretty false` output into findings. Exported for tests. */
export function parseTscOutput(root: string, output: string): Finding[] {
  const findings: Finding[] = [];
  for (const line of output.split(/\r?\n/)) {
    const m = TSC_LINE.exec(line.trim());
    if (!m || m[3] !== "error") continue;
    findings.push({
      title: `TypeScript error ${m[4]}`,
      message: (m[5] ?? "").slice(0, 900),
      severity: "high",
      confidence: "high",
      status: "confirmed-failure",
      location: { file: relativeToRoot(root, m[1] ?? ""), line: Number(m[2]) },
    });
  }
  return findings;
}

/**
 * TypeScript type check using the project's own node_modules/.bin/tsc.
 * Runs project-installed code, so it only runs when allowProjectTools is on.
 */
export function createTscRunner(deps: ScannerDeps): CheckRunner {
  return async (ctx) => {
    if (!ctx.allowProjectTools)
      return { outcome: "skipped", reason: PROJECT_TOOLS_DISABLED, findings: [] };
    const command = await findProjectTool(ctx.root, "tsc");
    const launched = await launch(
      ctx,
      deps,
      {
        label: "tsc",
        command,
        installHint: "Install TypeScript in the project (npm install typescript --save-dev).",
      },
      ["--noEmit", "-p", "tsconfig.json", "--pretty", "false"],
    );
    if ("done" in launched) return launched.done;
    const { exitCode, stdout, stderr } = launched.result;
    if (exitCode === 0) return { outcome: "passed", findings: [] };
    const findings = parseTscOutput(ctx.root, stdout);
    if (findings.length === 0) {
      return toolError(
        `tsc exited with code ${exitCode} but no errors could be read: ${stderrSnippet(stdout || stderr)}`,
      );
    }
    const reason =
      findings.length > MAX_FINDINGS
        ? `${findings.length - MAX_FINDINGS} more error(s) not shown`
        : undefined;
    return {
      outcome: "failed",
      ...(reason ? { reason } : {}),
      findings: findings.slice(0, MAX_FINDINGS),
    };
  };
}

const eslintReportSchema = z.array(
  z
    .object({
      filePath: z.string(),
      messages: z.array(
        z
          .object({
            ruleId: z.string().nullable().optional(),
            severity: z.number(),
            message: z.string(),
            line: z.number().optional(),
          })
          .passthrough(),
      ),
    })
    .passthrough(),
);

/** Parse ESLint JSON output into findings. Errors are confirmed failures; warnings never block. */
export function parseEslintOutput(root: string, json: unknown): Finding[] | undefined {
  const parsed = eslintReportSchema.safeParse(json);
  if (!parsed.success) return undefined;
  const findings: Finding[] = [];
  for (const file of parsed.data) {
    for (const m of file.messages) {
      const isError = m.severity >= 2;
      findings.push({
        title: `ESLint ${isError ? "error" : "warning"}${m.ruleId ? `: ${m.ruleId}` : ""}`,
        message: m.message.slice(0, 900),
        severity: isError ? "medium" : "low",
        confidence: "high",
        status: isError ? "confirmed-failure" : "warning",
        location: {
          file: relativeToRoot(root, file.filePath),
          ...(m.line ? { line: m.line } : {}),
        },
      });
    }
  }
  return findings;
}

/**
 * Lint using the project's own node_modules/.bin/eslint and the project's own ESLint config.
 * Runs project-installed code (and the config is code), so it only runs when allowProjectTools is on.
 * Exit codes: 0 clean, 1 lint errors, 2 configuration or fatal error.
 */
export function createEslintRunner(deps: ScannerDeps): CheckRunner {
  return async (ctx) => {
    if (!ctx.allowProjectTools)
      return { outcome: "skipped", reason: PROJECT_TOOLS_DISABLED, findings: [] };
    const command = await findProjectTool(ctx.root, "eslint");
    const launched = await launch(
      ctx,
      deps,
      {
        label: "eslint",
        command,
        installHint: "Install ESLint in the project (npm install eslint --save-dev).",
      },
      ["--format", "json", "."],
    );
    if ("done" in launched) return launched.done;
    const { exitCode, stdout, stderr } = launched.result;
    if (exitCode !== 0 && exitCode !== 1)
      return toolError(`eslint exited with code ${exitCode}: ${stderrSnippet(stderr || stdout)}`);

    let findings: Finding[] | undefined;
    try {
      findings = parseEslintOutput(ctx.root, JSON.parse(stdout));
    } catch {
      findings = undefined;
    }
    if (!findings) return toolError(`eslint produced no readable report: ${stderrSnippet(stderr)}`);
    if (findings.length === 0) return { outcome: "passed", findings: [] };
    const capped = findings.slice(0, MAX_FINDINGS);
    const reason =
      findings.length > MAX_FINDINGS
        ? `${findings.length - MAX_FINDINGS} more message(s) not shown`
        : undefined;
    const hasErrors = capped.some((f) => f.status === "confirmed-failure");
    return {
      outcome: hasErrors ? "failed" : "findings",
      ...(reason ? { reason } : {}),
      findings: capped,
    };
  };
}
