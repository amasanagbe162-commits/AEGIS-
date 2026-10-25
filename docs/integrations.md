# Agent integrations

AEGIS does not replace your AI coding agent. It gives the agent instructions generated from your master file and rules, and it adds deterministic checks the agent can be held to. Integrations are **layered**: instructions (advisory), then checks (evidence), then, where the agent supports it, a hook (enforcement).

Run `aegis agents list` for the current list. Each integration was written against the agent's documented configuration mechanism. Agent features change between versions: see "What is and is not tested" below.

| Agent          | Mechanism AEGIS uses                                                                          | Enforcement   | Files                                                          |
| -------------- | --------------------------------------------------------------------------------------------- | ------------- | -------------------------------------------------------------- |
| Claude Code    | Project rules file loaded at session start, plus an optional Stop hook                        | hook (opt-in) | `.claude/rules/aegis.md`, `.claude/settings.json` (`--hooks`)  |
| GitHub Copilot | Path-specific instructions with `applyTo: "**"`                                               | advisory      | `.github/instructions/aegis.instructions.md`                   |
| OpenAI Codex   | A marked AEGIS block in `AGENTS.md` (also read by Copilot's CLI and other tools)              | advisory      | `AGENTS.md`                                                    |
| ChatGPT (chat) | Paste-in text for Customize ChatGPT or a Project. ChatGPT cannot read your repo or run checks | manual        | `.aegis/chatgpt-instructions.md`, `aegis agents print chatgpt` |

## Quick start

```bash
aegis init --agent claude-code codex      # config, master file and agent files in one confirmed step
aegis agents sync --agent github-copilot  # add or refresh agent files later
aegis agents verify                       # are the files installed and current?
aegis agents print chatgpt                # text to paste into ChatGPT
```

Every write is previewed first. Use `--dry-run` to see the plan, `--yes` to skip the confirmation (required without a terminal).

## How AEGIS treats your files

| Situation                                        | What AEGIS does                                                                                    |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| File does not exist                              | Creates it (exclusive create: a file that appears mid-run is never overwritten).                   |
| File AEGIS wrote, unchanged since                | Refreshes it when rules or the master file change.                                                 |
| File AEGIS wrote, **edited by you**              | Keeps it. Reported as `modified` by `aegis agents verify`.                                         |
| File with the same name that AEGIS did not write | Keeps it.                                                                                          |
| `AGENTS.md` exists without an AEGIS block        | Keeps it. With `--merge-existing`, appends one marked block after your text; nothing else changes. |
| `.claude/settings.json` exists                   | Never edited. AEGIS prints the hook snippet for you to merge.                                      |
| Path is, or sits inside, a symbolic link         | Left alone.                                                                                        |

Your `CLAUDE.md` and `.github/copilot-instructions.md` are never touched: Claude Code loads `.claude/rules/*.md` and Copilot loads `.github/instructions/*.instructions.md` alongside them. AEGIS never creates `AGENTS.override.md`, because Codex would use it **instead of** your `AGENTS.md`.

Generated files carry a hash marker so AEGIS can tell its own output from yours. Do not edit them by hand: change `AEGIS.aegis` or the rules and run `aegis agents sync`.

## Claude Code Stop hook

Instructions can be ignored. The Stop hook is the one place AEGIS can act deterministically. Enable it with `--hooks` (written only if `.claude/settings.json` does not exist):

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "npx --no-install aegis hook claude-stop",
            "timeout": 300
          }
        ]
      }
    ]
  }
}
```

When Claude is about to finish, the hook runs the same checks as `aegis check`:

| Result                         | Hook behavior                                                                                                |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| Clean                          | Exit 0. Claude finishes.                                                                                     |
| Blocking findings              | Exit 2. The findings (redacted, capped) go to Claude, which must fix them and verify.                        |
| Same problem keeps failing     | After `selfCorrection.maxAttempts` (default 3) the hook lets Claude finish and reports it as **unresolved**. |
| Incomplete (a scanner missing) | Exit 0 with a notice that the result is **not clean**. Claude cannot install tools, so it is never trapped.  |
| Hook cannot run                | Exit 1 (non-blocking). It never traps the agent.                                                             |

The attempt counter lives in `.aegis/state/` (a number only, self-ignored by Git) because `stop_hook_active` alone has been reported to be unreliable in some Claude Code versions.

Costs and limits: the hook runs your scanners at the end of every Claude turn, so it adds time (see `scan.toolTimeoutSeconds`). It does not stop Claude from running commands or editing files. It only sends Claude back before it finishes.

`npx --no-install` is deliberate. Without it, `npx` could download an unrelated npm package called `aegis`. If you installed AEGIS another way, pass `--cli-command "node path/to/aegis.js"` (letters, digits, spaces and `_ @ . / : -` only).

## ChatGPT

ChatGPT in the browser cannot read your repository or run commands, so AEGIS cannot verify its work. The pasted text (under 1,500 characters, the smallest limit AEGIS knows of) tells ChatGPT to say so, to never claim something is fixed or tested, and to work from `aegis check` output you paste back. AEGIS cannot see what is configured in your account and sends nothing anywhere.

## What the generated instructions contain

- The operating rules, self-correction protocol, severity actions and limitations from your `AEGIS.aegis`.
- The rules selected for your project and protection level, each with what to do, how to verify, and (while the size budget allows) an unsafe and a safe example.
- How to run `aegis check` and what exit codes 0, 1, 2 and 3 mean. Exit 3 (incomplete) is explicitly **not a pass**.
- A closing report the agent must give: Changed / Verified / Not verified / Open risks.

Size budgets (enforced by tests): Claude and Copilot files up to 24 KiB, `AGENTS.md` block up to 6 KiB (Codex shares one 32 KiB budget across all `AGENTS.md` files), ChatGPT text under 1,500 characters. When a project selects more rules than fit, detail is reduced first (unsafe examples, then all examples, then per-rule guidance), and only then are the least severe rules left out, with their count stated.

## What is and is not tested

- Tested: file generation, preservation of your files, symlink and race safety, refresh and verification logic, the hook's decisions, and the built `aegis` binary driving the hook over real standard input, including a blocking run against a stand-in scanner.
- **Not tested:** a live session in Claude Code, Copilot, Codex or ChatGPT. File locations and the hook settings format follow each vendor's documentation at the time of writing. If an agent version ignores a file, `aegis agents print <agent>` gives you the text to place by hand.
- Nothing here proves an agent follows its instructions. `aegis agents verify` checks files, not behavior.

## Enforcement outside the agent

For Copilot, Codex and ChatGPT there is no AEGIS hook. Put the check in CI so it applies to whatever tool wrote the code:

```yaml
- run: npx --no-install aegis check --level advanced
```

Exit code 1 (findings) and 3 (incomplete) fail the job unless you pass `--allow-incomplete`.
