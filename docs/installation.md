# Installation

AEGIS is in early development and is **not published to npm yet**. Install it from source.

> **Do not run `npx aegis-guard` or `npx aegis`.** Packages with those names exist on npm, but they are unrelated projects (not this one). AEGIS's chosen package name is **`aegis-engineering`** (free on npm when last checked, not yet published or reserved), so `npx aegis-engineering` will only work after it is published. Until then, install from source.

## Requirements

- Node.js 22 or newer
- Git (to clone the repository)

## Install from source

```bash
git clone <your-repository-url> aegis
cd aegis
npm install
npm run build
```

Check that it works:

```bash
npx aegis --help
npx aegis doctor
```

Inside the repository, `npx aegis` runs the CLI. To use it in another project, run it by path, or link it once:

```bash
# one-off, from your own project folder
node /path/to/aegis/packages/cli/bin/aegis.js scan

# or link the `aegis` command globally (the package also installs an `aegis-engineering` alias) (undo with: npm unlink -g aegis-engineering)
npm link -w aegis-engineering
cd /path/to/your/project
aegis scan
```

## Set up a project

```bash
cd /path/to/your/project
aegis init --dry-run     # preview what would be created
aegis init               # asks for a protection level and agent, then asks to confirm
```

`aegis init` creates two files and nothing else:

| File                | Purpose                                                   |
| ------------------- | --------------------------------------------------------- |
| `aegis.config.json` | Protection level, agents, scan boundaries, attempt limit. |
| `AEGIS.aegis`       | The master policy for AI coding agents.                   |

It never overwrites an existing file. If a file already exists it is kept as it is. In a script or CI (no terminal) it writes nothing unless you pass `--yes`.

`aegis init --agent <agent>` also generates instruction files for your AI agent (Claude Code, GitHub Copilot, OpenAI Codex, ChatGPT). Your existing `CLAUDE.md`, `.github/copilot-instructions.md` and `AGENTS.md` are never overwritten. See [integrations.md](integrations.md).

## Optional scanners

Without scanners, `aegis scan` works but ends as INCOMPLETE. Install the ones you want, then run `aegis doctor` to confirm AEGIS can find them:

| Tool                                        | Install (see each project for your platform)                       |
| ------------------------------------------- | ------------------------------------------------------------------ |
| Gitleaks (secrets)                          | https://github.com/gitleaks/gitleaks                               |
| Semgrep (static analysis)                   | `pip install semgrep` or https://semgrep.dev/docs/getting-started/ |
| OSV-Scanner v2 (dependency vulnerabilities) | https://google.github.io/osv-scanner/                              |
| npm (dependency audit)                      | comes with Node.js                                                 |

AEGIS never installs or upgrades anything for you. TypeScript and ESLint checks use your project's own copy and need `--allow-project-tools`. Details, network requests and licenses: [scanners.md](scanners.md).

## Manual setup (no CLI)

Copy the templates and edit them:

- `packages/rules/templates/AEGIS.aegis`
- `packages/rules/templates/aegis.config.json`

Then check them: `aegis rules validate AEGIS.aegis` and `aegis rules validate aegis.config.json`.

## Commands

| Command                         | What it does                                                                                  |
| ------------------------------- | --------------------------------------------------------------------------------------------- |
| `aegis init [path]`             | Create the config, master file and agent files (`--dry-run`, `--yes`, `--level`, `--agent`).  |
| `aegis scan [path]`             | Full report: detection, rules, planned checks, findings, result (`--level`, `--format json`). |
| `aegis check [path]`            | Same checks, compact output, for hooks and CI (`--allow-incomplete`).                         |
| `aegis rules list`              | List bundled rules (`--category`, `--json`).                                                  |
| `aegis rules validate [target]` | Validate a rule, a rules folder, an `.aegis` file, or a config file.                          |
| `aegis doctor [path]`           | Diagnose Node.js, config, master file, bundled rules and optional tools. Changes nothing.     |
| `aegis agents list              | sync                                                                                          | verify                                                                                      | print`                                                                                   | Generate, check and print instruction files for AI agents ([integrations.md](integrations.md)). |
| `aegis hook claude-stop`        | Claude Code Stop hook entry point (not for manual use).                                       |
| `aegis learn add                | list                                                                                          | show                                                                                        | amend                                                                                    | verify                                                                                          | review | supersede` | Reviewed project lessons ([learning.md](learning.md)). |
| `aegis rules status             | update`                                                                                       | Which rules are in use; optional signed updates, off by default ([updates.md](updates.md)). |
| `aegis rules keygen             | bundle                                                                                        | check-bundle`                                                                               | Maintainers: create a signing key, sign a bundle, verify one ([updates.md](updates.md)). |

Run `aegis --help` and `aegis <command> --help` for every option.

## Optional scanners and the versions AEGIS was tested with

AEGIS reports a check as **skipped** (never clean) when its tool is missing. To enable them:

| Tool               | Used for                   | Tested with                        | Notes                                                                                |
| ------------------ | -------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------ |
| Gitleaks           | secret detection           | 8.28.0                             | Needs the `dir` command: 8.18.4 does not have it and AEGIS says so.                  |
| Semgrep            | static analysis            | 1.182.1                            | AEGIS passes its own rules file.                                                     |
| OSV-Scanner        | dependency vulnerabilities | 2.2.2                              | Needs network access to `api.osv.dev`; without it the check is a tool error.         |
| npm                | `npm audit`                | bundled with Node 22               | Needs network access.                                                                |
| ESLint, TypeScript | lint, type check           | ESLint 9, project's own TypeScript | Run only with `scan.allowProjectTools: true`, from the project's own `node_modules`. |

Other versions may work but were not tested.
