import path from "node:path";
import { realpath, stat } from "node:fs/promises";
import { findExecutable } from "../process/which.js";
import { runProcess, type ProcessRunner, type RunResult } from "../process/run.js";
import type { CheckContext, CheckOutcome } from "../verification/checks.js";

/** Everything an adapter needs from the outside, so tests can replace it. */
export interface ScannerDeps {
  run: ProcessRunner;
  which: (name: string) => Promise<string | undefined>;
  env: NodeJS.ProcessEnv;
}

export function defaultScannerDeps(env: NodeJS.ProcessEnv = process.env): ScannerDeps {
  return { run: runProcess, which: (name) => findExecutable(name, env), env };
}

export const MAX_OUTPUT_BYTES = 20 * 1024 * 1024;
export const MAX_FINDINGS = 200;

export type Exited = Extract<RunResult, { kind: "exited" }>;

/** Last non-empty line of stderr, shortened. Used in error reasons (the engine redacts it). */
export function stderrSnippet(stderr: string, max = 200): string {
  const lines = stderr
    .split(/\r?\n/)
    // eslint-disable-next-line no-control-regex
    .map((l) => l.replace(/\u001b\[[0-9;]*m/g, "").trim())
    .filter(Boolean);
  const last = lines[lines.length - 1] ?? "";
  return last.length > max ? `${last.slice(0, max)}...` : last;
}

export function relativeToRoot(root: string, file: string): string {
  const abs = path.isAbsolute(file) ? file : path.join(root, file);
  const rel = path.relative(root, abs);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) return path.basename(file);
  return rel.split(path.sep).join("/");
}

export type Launch = { done: CheckOutcome } | { result: Exited };

/**
 * Locate and run a tool. Returns either a finished outcome (tool missing, timeout, crash)
 * or the process result for the adapter to interpret.
 */
export async function launch(
  ctx: CheckContext,
  deps: ScannerDeps,
  tool: { label: string; command: string | undefined; installHint: string },
  args: readonly string[],
): Promise<Launch> {
  if (!tool.command) {
    return {
      done: {
        outcome: "skipped",
        reason: `${tool.label} was not found on PATH, so this check was not performed. ${tool.installHint}`,
        findings: [],
      },
    };
  }
  const result = await deps.run({
    command: tool.command,
    args,
    cwd: ctx.root,
    timeoutMs: ctx.timeoutMs,
    maxOutputBytes: MAX_OUTPUT_BYTES,
    env: deps.env,
  });
  switch (result.kind) {
    case "exited":
      return { result };
    case "timeout":
      return {
        done: {
          outcome: "tool-error",
          reason: `${tool.label} did not finish within ${Math.round(ctx.timeoutMs / 1000)} seconds and was stopped`,
          findings: [],
        },
      };
    case "output-limit":
      return {
        done: {
          outcome: "tool-error",
          reason: `${tool.label} produced more than ${MAX_OUTPUT_BYTES / 1024 / 1024} MB of ${result.stream} output and was stopped`,
          findings: [],
        },
      };
    case "spawn-error":
      return {
        done: {
          outcome: "tool-error",
          reason: `${tool.label} could not be started: ${result.message}`,
          findings: [],
        },
      };
  }
}

export function toolError(reason: string): CheckOutcome {
  return { outcome: "tool-error", reason, findings: [] };
}

/**
 * Find a tool installed inside the project (node_modules/.bin/<name>). Running it executes code
 * that ships with the project, so callers must check ctx.allowProjectTools first. The real path
 * must stay inside the project, and it must be an actual file.
 */
export async function findProjectTool(root: string, name: string): Promise<string | undefined> {
  if (process.platform === "win32") return undefined; // .cmd shims are not supported yet
  try {
    const candidate = path.join(root, "node_modules", ".bin", name);
    const real = await realpath(candidate);
    const rootReal = await realpath(root);
    const rel = path.relative(rootReal, real);
    if (rel.startsWith("..") || path.isAbsolute(rel)) return undefined;
    if (!(await stat(real)).isFile()) return undefined;
    return candidate;
  } catch {
    return undefined;
  }
}

export const PROJECT_TOOLS_DISABLED =
  "running tools installed in the project (node_modules/.bin) is not enabled. Set scan.allowProjectTools in aegis.config.json or pass --allow-project-tools to allow it.";
