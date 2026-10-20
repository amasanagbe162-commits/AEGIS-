# Installation

AEGIS is in early development and is **not published to npm yet**. Install it from source.

> **Do not run `npx aegis-guard`.** A package with that name exists on npm, but it is an unrelated project (not this one). The final published name for AEGIS has not been chosen yet.

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
node /path/to/aegis/packages/cli/dist/main.js scan

# or link the command globally (undo with: npm unlink -g @aegis/cli)
npm link -w @aegis/cli
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

Agent instruction files (`CLAUDE.md`, Copilot instructions) are **not generated yet**. Your existing ones are never touched.

## Manual setup (no CLI)

Copy the templates and edit them:

- `packages/rules/templates/AEGIS.aegis`
- `packages/rules/templates/aegis.config.json`

Then check them: `aegis rules validate AEGIS.aegis` and `aegis rules validate aegis.config.json`.

## Commands

| Command                         | What it does                                                                                  |
| ------------------------------- | --------------------------------------------------------------------------------------------- |
| `aegis init [path]`             | Create the config and master file (`--dry-run`, `--yes`, `--level`, `--agent`).               |
| `aegis scan [path]`             | Full report: detection, rules, planned checks, findings, result (`--level`, `--format json`). |
| `aegis check [path]`            | Same checks, compact output, for hooks and CI (`--allow-incomplete`).                         |
| `aegis rules list`              | List bundled rules (`--category`, `--json`).                                                  |
| `aegis rules validate [target]` | Validate a rule, a rules folder, an `.aegis` file, or a config file.                          |
| `aegis doctor [path]`           | Diagnose Node.js, config, master file, bundled rules and optional tools. Changes nothing.     |

Not implemented yet: `aegis rules update` (planned for a later version).
