import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  assertPlainFolderPath,
  isBlocking,
  redactText,
  type Finding,
  type ScanReport,
} from "@aegis/core";

/** The part of Claude Code's Stop hook input that AEGIS uses. */
export interface StopHookInput {
  sessionId: string;
  /** True when Claude is already continuing because an earlier Stop hook blocked it. */
  stopHookActive: boolean;
  cwd?: string;
}

const MAX_INPUT_BYTES = 256 * 1024;

/** Parse the JSON that Claude Code sends on stdin. Returns undefined for anything unexpected. */
export function parseStopHookInput(text: string): StopHookInput | undefined {
  if (Buffer.byteLength(text, "utf8") > MAX_INPUT_BYTES) return undefined;
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) return undefined;
  const o = data as Record<string, unknown>;
  const session = typeof o["session_id"] === "string" ? o["session_id"] : "";
  const cwd = typeof o["cwd"] === "string" && o["cwd"] !== "" ? o["cwd"] : undefined;
  return {
    sessionId: session,
    stopHookActive: o["stop_hook_active"] === true,
    ...(cwd ? { cwd } : {}),
  };
}

/** A file-name-safe key. Session ids are not trusted: odd ones are hashed instead of used as a path. */
export function sessionKey(sessionId: string): string {
  if (/^[A-Za-z0-9_-]{1,64}$/.test(sessionId)) return sessionId;
  return "s-" + createHash("sha256").update(sessionId).digest("hex").slice(0, 32);
}

const STATE_DIR = path.join(".aegis", "state");

function stateFile(root: string, sessionId: string): string {
  return path.join(root, STATE_DIR, `claude-stop-${sessionKey(sessionId)}.json`);
}

/** Attempts used so far in this session. Missing or damaged state counts as zero. */
export async function readAttempts(root: string, sessionId: string): Promise<number> {
  try {
    const parsed: unknown = JSON.parse(await readFile(stateFile(root, sessionId), "utf8"));
    const n = (parsed as { attempts?: unknown } | null)?.attempts;
    return typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 1000 ? n : 0;
  } catch {
    return 0;
  }
}

/**
 * Remember how many times the hook sent Claude back. The state holds a number only: no code,
 * findings or paths. The folder ignores itself in Git so it never shows up as a change.
 */
export async function writeAttempts(
  root: string,
  sessionId: string,
  attempts: number,
): Promise<void> {
  const file = stateFile(root, sessionId);
  await assertPlainFolderPath(root, STATE_DIR);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(path.join(path.dirname(file), ".gitignore"), "*\n", { flag: "a" }).catch(
    () => {},
  );
  if (attempts <= 0) {
    await rm(file, { force: true });
    return;
  }
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify({ attempts }) + "\n", { mode: 0o600 });
  await rename(tmp, file);
}

export interface StopDecision {
  /** 2 sends Claude back to work (the message in `stderr` is shown to Claude). 0 lets it finish. */
  exitCode: 0 | 2;
  stderr?: string;
  /** Plain note for the person, sent as the hook's `systemMessage`. */
  notice?: string;
  /** Attempts to remember for the next time the hook runs. */
  attempts: number;
}

const MAX_MESSAGE_CHARS = 3500;
const MAX_LISTED_FINDINGS = 8;

function describe(f: Finding): string {
  const where = f.location
    ? ` (${f.location.file}${f.location.line ? `:${f.location.line}` : ""})`
    : "";
  return `- [${f.severity}] ${f.title}${where}`;
}

/**
 * Decide what the Stop hook does. Pure function, so every branch is easy to test.
 *
 * - Blocking findings send Claude back, but only `maxAttempts` times: then the hook lets Claude
 *   finish and says the problem is unresolved, so a stubborn finding can never trap the agent.
 * - Incomplete checks (a scanner is missing) never block, because Claude cannot install tools
 *   for you. The notice says plainly that the result is not clean.
 * - A check that could not run at all never blocks. The hook fails open and says so.
 */
export function decideStop(args: {
  report: ScanReport;
  attemptsSoFar: number;
  maxAttempts: number;
}): StopDecision {
  const { report, attemptsSoFar, maxAttempts } = args;

  if (report.verdict === "error") {
    return {
      exitCode: 0,
      attempts: 0,
      notice:
        "AEGIS could not run its checks (invalid configuration or rules), so nothing was verified. Run `aegis doctor`.",
    };
  }

  if (report.verdict === "incomplete") {
    return {
      exitCode: 0,
      attempts: 0,
      notice: `AEGIS check is INCOMPLETE: ${report.summary.checksNotPerformed} of ${report.summary.checksPlanned} planned checks did not run. This is not a clean result. Run \`aegis check\` for details.`,
    };
  }

  if (report.verdict === "clean") return { exitCode: 0, attempts: 0 };

  const blocking = report.findings.filter((f) => isBlocking(f, report.policy.blockThreshold));
  const attempts = attemptsSoFar + 1;

  if (attempts > maxAttempts) {
    return {
      exitCode: 0,
      attempts: 0,
      notice: `AEGIS: ${blocking.length} blocking finding(s) are still unresolved after ${maxAttempts} attempt(s). Claude was allowed to finish. Review them with \`aegis check\`.`,
    };
  }

  const listed = blocking.slice(0, MAX_LISTED_FINDINGS).map(describe);
  const more =
    blocking.length > listed.length ? [`- ...and ${blocking.length - listed.length} more`] : [];
  const message = [
    `AEGIS check found ${blocking.length} blocking finding(s) (attempt ${attempts} of ${maxAttempts}):`,
    ...listed,
    ...more,
    "",
    "Investigate the root cause of each one and fix it with a targeted change. Do not disable the check, suppress the finding, or edit a test just to make it pass.",
    "Then run `aegis check` again and report the result honestly. If you cannot resolve a finding, say so in your final message.",
  ].join("\n");

  return {
    exitCode: 2,
    attempts,
    stderr: redactText(message).slice(0, MAX_MESSAGE_CHARS),
  };
}
