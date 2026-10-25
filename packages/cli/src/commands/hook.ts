import { inspectProject, loadProjectConfig } from "@aegis/core";
import { rulesInUse } from "../util/rules-source.js";
import { decideStop, parseStopHookInput, readAttempts, writeAttempts } from "@aegis/integrations";
import type { Runtime } from "../runtime.js";
import { resolveRoot } from "../util/resolve-root.js";

/**
 * Claude Code Stop hook. Claude Code runs this when Claude is about to finish and sends a JSON
 * description on standard input.
 *
 * Exit codes follow Claude Code's rules for hooks:
 *   0  let Claude finish (a plain note may be shown to the person)
 *   2  block the stop; the message on stderr is shown to Claude so it can fix the findings
 *   1  the hook itself failed; Claude is NOT blocked
 * A broken hook must never trap the agent, so every failure to run ends in 0 or 1, never 2.
 */
export async function hookClaudeStopCommand(rt: Runtime): Promise<number> {
  const raw = rt.readStdin ? await rt.readStdin() : "";
  const input = parseStopHookInput(raw);
  if (!input) {
    rt.err("aegis hook: could not read the hook input, so nothing was verified.\n");
    return 1;
  }

  const resolved = await resolveRoot(rt, input.cwd);
  if (!resolved.ok) {
    rt.err(`aegis hook: ${resolved.message}, so nothing was verified.\n`);
    return 1;
  }
  const root = resolved.root;

  const report = await inspectProject({
    root,
    rulesDir: (await rulesInUse(root)).dir,
    toolVersion: rt.version,
    ...(rt.runners ? { runners: rt.runners } : {}),
  });
  const maxAttempts = (await loadProjectConfig(root)).config.selfCorrection.maxAttempts;

  const attemptsSoFar = await readAttempts(root, input.sessionId);
  const decision = decideStop({ report, attemptsSoFar, maxAttempts });

  let notice = decision.notice;
  let exitCode = decision.exitCode;
  try {
    await writeAttempts(root, input.sessionId, decision.attempts);
  } catch {
    // Without a saved counter the attempt limit cannot be enforced, so blocking could repeat
    // forever. Fail open instead: let Claude finish and say why.
    if (exitCode === 2) {
      exitCode = 0;
      notice =
        "AEGIS found blocking findings but cannot record its attempt count (is .aegis a symbolic link or read-only?), so it did not block. Run `aegis check` to see them.";
    }
  }

  if (notice) rt.out(JSON.stringify({ systemMessage: notice }) + "\n");
  if (exitCode === 2 && decision.stderr) rt.err(decision.stderr + "\n");
  return exitCode;
}
