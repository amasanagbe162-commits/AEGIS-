# AEGIS User Guide

**AEGIS (AI Engineering Guard & Inspection System)** helps you build software that is safer and more reliable when an AI coding agent writes some of the code. This guide names every feature, says what it is for, and shows how to use it.

> **Status:** AEGIS is built and tested but **not published yet**. Until it is, install it from source (see [installation.md](installation.md)). Where this guide shows `aegis ...`, that is the command from a source install.

> **The one-line idea:** _Inspect before coding. Protect during coding. Verify after coding._

---

## 1. What AEGIS is, and what it is not

An AI agent reads instructions, but instructions alone cannot make it careful, and cannot prove its work is safe. AEGIS gives you three layers that work together:

| Layer            | What it does                                                                                              | Strength                            |
| ---------------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| **Instructions** | Generates rule files your AI agent reads (Claude Code, Copilot, Codex, ChatGPT)                           | Advisory: the agent may ignore them |
| **Checks**       | Runs real scanners (Gitleaks, Semgrep, npm audit, OSV-Scanner, tsc, ESLint) and reports honestly what ran | Deterministic evidence              |
| **Enforcement**  | A Claude Code hook that sends the agent back to fix blocking findings                                     | Real, but limited to Claude Code    |

AEGIS is **not** an AI model, a replacement for your agent, or a guarantee. It reduces risk. A clean AEGIS report never means "secure", and the tool tells you so.

---

## 2. Five-minute start

```bash
cd my-project
aegis doctor                              # is my setup OK? changes nothing
aegis init --agent claude-code            # preview, confirm, create config + master file + agent files
aegis scan                                # full report
aegis agents sync --hooks                 # optional: Claude Code Stop hook
aegis agents verify                       # are my agent files installed and current?
```

Everything that writes files **shows you the plan first** and asks. Add `--dry-run` to see the plan only, or `--yes` to skip the question (required without a terminal).

---

## 3. Reading results: the four exit codes

Every check command uses the same codes, so scripts and CI can rely on them.

| Code  | Meaning                                                                                                   | What to do                                                                       |
| ----- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| **0** | Every planned check ran and nothing blocking was found                                                    | Good. Still not proof of safety                                                  |
| **1** | Blocking findings                                                                                         | Fix the root cause, run again                                                    |
| **2** | Invalid input or setup                                                                                    | Read the message; `aegis doctor` helps                                           |
| **3** | **Incomplete**: nothing blocking, but some checks did **not** run (for example Gitleaks is not installed) | This is **not** a pass. Install the tool, or pass `--allow-incomplete` knowingly |

The reports separate **findings**, **warnings**, **confirmed failures**, **tool errors**, **skipped checks** and **unverified suggestions**. A missing scanner is never silently reported as clean.

---

## 4. Every command and what it is for

### Setup and diagnosis

| Command               | Use it to                                                                                                                                                                                             |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `aegis doctor [path]` | Check Node.js, your config, your master file, the rules in use, the optional scanners, agent files and learning records. Changes nothing                                                              |
| `aegis init [path]`   | Create `aegis.config.json`, `AEGIS.aegis` and agent files. Options: `--level standard\|advanced\|maximum`, `--agent <agent...>`, `--dry-run`, `--yes`, `--merge-existing`, `--hooks`, `--cli-command` |

### Checking a project

| Command              | Use it to                                                                                                                                                                                              |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `aegis scan [path]`  | Detect the project, select rules, run the planned checks, print the **full** report. `--format json` for tools, `--level` to override, `--allow-project-tools` to also run your own `tsc` and `eslint` |
| `aegis check [path]` | Same checks, **compact** output, built for hooks and CI. Adds `--allow-incomplete`                                                                                                                     |

### The rule library

| Command                         | Use it to                                                                                              |
| ------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `aegis rules list`              | See the protection rules in use (`--category`, `--json`)                                               |
| `aegis rules validate [target]` | Validate a rule, a folder of rules, an `.aegis` file or `aegis.config.json`. Checks **structure only** |
| `aegis rules status`            | See whether the shipped rules or an installed update are in use, and the update settings               |

### Working with AI agents

| Command                      | Use it to                                                                                                              |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `aegis agents list`          | See each supported agent, how the integration works, and what it **cannot** do                                         |
| `aegis agents sync [path]`   | Generate or refresh agent instruction files. `--agent`, `--dry-run`, `--yes`, `--merge-existing`, `--hooks`, `--level` |
| `aegis agents verify [path]` | Check the files are installed and up to date (`current`, `stale`, `missing`, `modified`, `foreign`). Changes nothing   |
| `aegis agents print <agent>` | Print the instructions for one agent, ready to paste (the way to use ChatGPT)                                          |
| `aegis hook claude-stop`     | The Claude Code hook entry point. Claude Code calls it; you normally never do                                          |

### Learning from mistakes

| Command                                | Use it to                                                                                                                    |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `aegis learn add`                      | Record a mistake your agent made (`--title`, `--issue`, `--category`, optional `--root-cause`, `--correction`, `--language`) |
| `aegis learn list / show`              | Browse lessons and their evidence                                                                                            |
| `aegis learn amend`                    | Add or change the root cause or correction (clears earlier verification)                                                     |
| `aegis learn verify <id>`              | Run the **real** checks and record the result. Only a clean, complete run verifies a lesson                                  |
| `aegis learn review <id>`              | **You** approve or reject a verified lesson (needs a terminal and a confirmation)                                            |
| `aegis learn supersede <id> --by <id>` | Replace an old approved lesson with a newer one                                                                              |

### Optional signed rule updates

| Command                           | Use it to                                                                                 |
| --------------------------------- | ----------------------------------------------------------------------------------------- |
| `aegis rules update`              | Fetch a signed rule bundle, verify it, and install it. **Off by default**                 |
| `aegis rules keygen`              | _Maintainers:_ create a signing key (the private key goes to a file, never to the screen) |
| `aegis rules bundle`              | _Maintainers:_ sign a folder of rules into a bundle                                       |
| `aegis rules check-bundle <file>` | _Maintainers and CI:_ confirm a bundle is signed by a trusted key and its rules validate  |

---

## 5. The features, one by one

### 5.1 Project detection

AEGIS looks at `package.json`, lockfiles, `tsconfig.json`, framework config, `pyproject.toml`, `requirements.txt`, `Cargo.toml`, `go.mod` and similar files to work out the language, framework and package manager. It reports **uncertainty** instead of guessing, never reads secret values, and skips `node_modules` and build output. Rules and checks are chosen from this.

### 5.2 Three protection levels

Set `protectionLevel` in `aegis.config.json`, or pass `--level`:

| Level        | For                          | Adds                                                                           |
| ------------ | ---------------------------- | ------------------------------------------------------------------------------ |
| **standard** | personal projects, beginners | secrets, static analysis, type check, lint, common rules                       |
| **advanced** | production work              | + `npm audit`, dependency vulnerability scan, broader rules, stricter blocking |
| **maximum**  | high-risk applications       | everything, with the strictest blocking and reporting                          |

Stricter levels run more tools and take longer. No level guarantees security. See [protection-levels.md](protection-levels.md).

### 5.3 The master file: `AEGIS.aegis`

The policy your agents follow: ten operating rules (inspect before modifying, preserve existing behavior, select relevant rules, avoid unsafe patterns, least privilege, minimal changes, verify, correct failures, **never fabricate verification**, respect the user), the self-correction workflow (Detect → Investigate → Diagnose → Correct → Verify → Report), what each severity means, and which dangerous operations need your confirmation. It is a restricted, validated YAML format: parsed safely, no code execution. Edit it to fit your project, then `aegis agents sync` to pass changes to your agents. Format reference: [formats/aegis-file-spec.md](../formats/aegis-file-spec.md).

### 5.4 The protection rule library

Six rules ship today, each with a **bad example, a corrected example, the risk, how to prevent it, how to verify it, limitations, and tests**:

| Rule             | Protects against                            |
| ---------------- | ------------------------------------------- |
| `AEGIS-SEC-0001` | SQL injection                               |
| `AEGIS-SEC-0002` | Cross-site scripting                        |
| `AEGIS-SEC-0003` | Hardcoded credentials                       |
| `AEGIS-SEC-0004` | Missing server-side ownership checks (IDOR) |
| `AEGIS-COD-0001` | Unhandled asynchronous errors               |
| `AEGIS-DEP-0001` | Installing unverified or mistyped packages  |

Each rule's examples are actually run in tests, so "the corrected example solves the problem" is checked, not assumed. All six are approved, but by an **AI-assisted review**; a human maintainer has not yet confirmed them. Add your own: [rule-authoring.md](rule-authoring.md).

### 5.5 Real scanner integration

AEGIS does not reimplement scanners. It runs the real tools, safely (argument lists, no shell, timeouts, minimal environment), and normalizes their output:

| Check                      | Tool                        | Looks for                                   |
| -------------------------- | --------------------------- | ------------------------------------------- |
| Secrets                    | Gitleaks                    | API keys, tokens, passwords in files        |
| Static analysis            | Semgrep (AEGIS's own rules) | SQL injection, XSS patterns                 |
| Dependency audit           | `npm audit`                 | known-vulnerable npm packages               |
| Dependency vulnerabilities | OSV-Scanner                 | known-vulnerable packages across ecosystems |
| Type check, lint           | your `tsc`, ESLint          | type errors, lint problems                  |

Missing tools are **reported as skipped** (exit code 3), never hidden. The secret check **cannot be silenced by the project it scans**: `gitleaks:allow` comments and a project `.gitleaks.toml` are ignored, and a `.gitleaksignore` file makes the check refuse to give a result. Exposed credentials block at every level. Your own `tsc`/ESLint run only if you allow it, because they execute your project's code. Tested versions and known gaps: [scanner-accuracy.md](scanner-accuracy.md).

### 5.6 Agent integrations

| Agent                     | What AEGIS writes                                                                    | Strength       |
| ------------------------- | ------------------------------------------------------------------------------------ | -------------- |
| **Claude Code**           | `.claude/rules/aegis.md`; with `--hooks`, a **Stop hook** in `.claude/settings.json` | Hook can block |
| **GitHub Copilot**        | `.github/instructions/aegis.instructions.md`                                         | Advisory       |
| **OpenAI Codex**          | A marked block in `AGENTS.md` (also read by other tools)                             | Advisory       |
| **ChatGPT** (chat window) | Paste-in text (`aegis agents print chatgpt`)                                         | Manual         |

Your own `CLAUDE.md`, `copilot-instructions.md` and `AGENTS.md` are **never overwritten**. AEGIS writes separate files, or one marked block it can find again. Files you edit by hand are kept. Details and what was tested with the real agent tools: [integrations.md](integrations.md).

### 5.7 The Claude Code Stop hook

With `--hooks`, when Claude is about to finish, AEGIS runs the checks. Blocking findings send Claude back to fix them, **at most `selfCorrection.maxAttempts` times (default 3)**, then Claude is allowed to finish and the problem is reported as unresolved, so it can never loop forever. Incomplete checks, or a hook failure, **never** block. It adds scan time to each Claude turn.

### 5.8 Self-correction protocol

Built into the instructions every agent receives: when a check fails, read the whole error, decide whether the change caused it, find the cause, make the smallest fix, re-run, and report honestly. Never edit a test just to make it pass. Stop after the attempt limit and say what is unresolved. Every task ends with a report: **Changed / Verified / Not verified / Open risks**.

### 5.9 Learning records

Record a mistake once so every future session knows about it. A lesson moves through **observed → proposed → verified → approved**. "Verified" is recorded by AEGIS from a real clean, complete check, never typed in by the agent. **Approval needs you**, at a terminal. Approved lessons are added to the generated agent instructions. Secrets are redacted and pasted code is refused. Everything stays on your machine. This is a reviewed record keeper, not machine learning. See [learning.md](learning.md).

### 5.10 Safe, optional rule updates

Off by default. When you turn it on, AEGIS downloads one signed bundle, verifies the **Ed25519 signature** against keys you trust, refuses downgrades, validates every rule, shows you what changes, and swaps it in atomically (old rules stay if anything fails). Sends no project data. If the installed rules are damaged, AEGIS falls back to the shipped ones and tells you. See [updates.md](updates.md).

### 5.11 Safety guarantees AEGIS keeps about itself

- Never overwrites your files; creates exclusively; previews first.
- Never follows symbolic links when writing under `.aegis/`.
- Never executes rule content or project scripts during scanning (unless you allow project tools).
- Never stores secrets in reports or lessons.
- No network access unless you enable updates.
- Refuses malformed or hostile input (YAML aliases, custom tags, oversized files, prototype pollution).

---

## 6. Common workflows

**Solo developer using Claude Code**

```bash
aegis init --agent claude-code --level advanced
aegis agents sync --hooks          # Claude is sent back to fix blocking findings before it finishes
```

**Team on GitHub Copilot or Codex**

```bash
aegis init --agent github-copilot codex
```

Then put `aegis check --level advanced` in CI. Copilot and Codex can ignore instructions, so CI is the enforcement.

**Using ChatGPT in the browser**

```bash
aegis agents print chatgpt         # paste into Customize ChatGPT or a Project
```

ChatGPT cannot run commands: it will ask you to run `aegis check` and paste the output, then fix from that.

**A mistake keeps happening**

```bash
aegis learn add --title "Raw SQL from request data" --issue "The agent built SQL from a query parameter." \
  --category security --root-cause "Input was concatenated into SQL." --correction "Always use bound parameters."
aegis learn verify LR-0001
aegis learn review LR-0001 --approve --reviewer you --reason "Matches AEGIS-SEC-0001"
aegis agents sync --yes
```

**Add AEGIS to CI**

```yaml
- run: npx --no-install aegis check --level advanced # exit 1 findings, 3 incomplete
```

---

## 7. Configuration reference (`aegis.config.json`)

| Setting                      | Default       | Meaning                                                         |
| ---------------------------- | ------------- | --------------------------------------------------------------- |
| `version`                    | `1`           | Format version (required)                                       |
| `protectionLevel`            | `standard`    | `standard`, `advanced`, `maximum`                               |
| `masterFile`                 | `AEGIS.aegis` | Your master policy file                                         |
| `agents`                     | `[]`          | Agents to keep in sync                                          |
| `disabledRules`              | `[]`          | Rule ids to turn off                                            |
| `scan.exclude`               | `[]`          | Extra paths to skip                                             |
| `scan.maxFileSizeKb`         | `1024`        | Skip larger files                                               |
| `scan.allowProjectTools`     | `false`       | Allow running your own `tsc` and ESLint (executes project code) |
| `scan.toolTimeoutSeconds`    | `120`         | Per-tool time limit                                             |
| `selfCorrection.maxAttempts` | `3`           | Hook and instructions: attempts before reporting unresolved     |
| `updates.enabled`            | `false`       | Allow `aegis rules update`                                      |
| `updates.source`             | none          | HTTPS address of the signed bundle                              |
| `updates.trustedKeys`        | `[]`          | Public keys you trust to sign bundles                           |

Validate it any time: `aegis rules validate aegis.config.json`.

---

## 8. Troubleshooting quick answers

| Symptom                                 | Answer                                                                                              |
| --------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Exit code 3                             | A tool is missing or failed. Read which check was skipped. Install it, or accept the gap knowingly  |
| "Gitleaks is too old"                   | Upgrade to a version that has the `dir` command (8.28.0 tested)                                     |
| `agents verify` says `stale`            | Run `aegis agents sync` (it refreshes only files AEGIS wrote)                                       |
| `agents verify` says `modified`         | You edited a generated file. AEGIS keeps your edit. Delete the file to regenerate it                |
| An existing `AGENTS.md` was not touched | Intended. Add `--merge-existing` to append the AEGIS block after your text                          |
| Hook does nothing                       | Is `aegis` installed in the project? `npx --no-install aegis` runs only a local install, on purpose |
| Anything else                           | `aegis doctor`, then [troubleshooting.md](troubleshooting.md)                                       |

---

## 9. What AEGIS cannot do

- It cannot prove your software is secure or bug-free.
- It cannot make an agent obey. Only the Claude Code hook can send an agent back, and only before it finishes.
- It does not detect every vulnerability. Broken authorization, for example, needs tests and review. See [scanner-accuracy.md](scanner-accuracy.md).
- ChatGPT's web chat cannot be configured or inspected by AEGIS.
- It has not been run on macOS or Windows by its author.
- No live AI session has been run against it; see [integrations.md](integrations.md) for what was checked with the real agent tools.

---

## 10. Where to go next

| I want to...                   | Read                                     |
| ------------------------------ | ---------------------------------------- |
| Install it                     | [installation.md](installation.md)       |
| Understand the design          | [architecture.md](architecture.md)       |
| Set up my agent                | [integrations.md](integrations.md)       |
| Write or change a rule         | [rule-authoring.md](rule-authoring.md)   |
| Understand updates and signing | [updates.md](updates.md)                 |
| Check what is finished         | [acceptance.md](acceptance.md)           |
| Contribute                     | [../CONTRIBUTING.md](../CONTRIBUTING.md) |
| Report a vulnerability         | [../SECURITY.md](../SECURITY.md)         |
