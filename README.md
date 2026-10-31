# AEGIS — AI Engineering Guard & Inspection System

![status: pre-release](https://img.shields.io/badge/status-pre--release-orange)
![license: MIT](https://img.shields.io/badge/license-MIT-blue)

> **Inspect before coding. Protect during coding. Verify after coding.**

AEGIS is an open-source protection framework for AI coding agents such as Claude Code, GitHub Copilot, OpenAI Codex and ChatGPT. It is **not** an AI model and does not replace your agent. It aims to give your agent structured rules, safe/unsafe code examples, and deterministic checks, so that mistakes are caught with evidence instead of promises.

## Status: pre-release (not published)

The foundation, the `.aegis` format, the core engine, the CLI, agent integrations, learning records and signed rule updates are built and tested. It is **not published**. It is feature-complete for the first version and well tested on Linux, but four things need a person before a public release (a human review of the rules, the signing key, the npm name, and macOS/Windows runs): see [docs/acceptance.md](docs/acceptance.md) for exactly what is met and what is open. New here? Start with the [user guide](docs/USER-GUIDE.md). The CLI (`init`, `scan`, `check`, `rules`, `agents`, `learn`, `hook`, `doctor`) runs real scanners (Gitleaks, Semgrep, npm audit, OSV-Scanner, and your project's own tsc and ESLint when allowed). A scan is only `clean` when every planned check actually ran.

| Area                                                      | Status                                                                                                                                                                                                |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Monorepo, lint, typecheck, tests                          | Implemented                                                                                                                                                                                           |
| CI workflow                                               | Implemented                                                                                                                                                                                           |
| `.aegis` format and parser                                | Implemented and tested                                                                                                                                                                                |
| Protection rule library                                   | 6 rules, approved on an AI-assisted review; a human has not yet confirmed them. Each rule's examples are executed in tests                                                                            |
| Core engine and project detection                         | Implemented and tested                                                                                                                                                                                |
| CLI (`aegis init`, `scan`, `check`, `rules`, `doctor`)    | Implemented and tested                                                                                                                                                                                |
| Scanner integrations                                      | Implemented; verified against real Gitleaks, Semgrep, ESLint, tsc, npm audit and OSV-Scanner (OSV from a local advisory database; live service unreachable). See [accuracy](docs/scanner-accuracy.md) |
| Agent integrations (Claude Code, Copilot, Codex, ChatGPT) | Implemented. Checked with the real Claude Code, Codex and Copilot CLIs (no login, so no live model session); ChatGPT is paste-in and untestable. See [docs/integrations.md](docs/integrations.md)     |
| Learning records (`aegis learn`)                          | Implemented and tested; see [docs/learning.md](docs/learning.md)                                                                                                                                      |
| Optional signed rule updates (`aegis rules update`)       | Implemented and tested; no official signing key exists yet. See [docs/updates.md](docs/updates.md)                                                                                                    |

See [docs/roadmap.md](docs/roadmap.md) for the phase plan and [docs/acceptance.md](docs/acceptance.md) for the release checklist.

## What AEGIS cannot guarantee

AEGIS reduces risk. It cannot guarantee bug-free or vulnerability-free software. Instruction files are advisory and an agent may ignore them. Passing checks does not prove code is secure.

## The idea in four commands

```bash
aegis init --agent claude-code codex   # config, master file and agent instruction files (previewed, never overwritten)
aegis scan                             # real scanners; clean only if every planned check ran
aegis agents sync --hooks              # optional Claude Code Stop hook: sends the agent back to fix blocking findings
aegis learn add ...                    # record a mistake; verified by a real check, approved by a person
```

## Try it

See [docs/installation.md](docs/installation.md). In short: `npm install && npm run build && npx aegis doctor`.

## Development

Requires Node.js 22 or newer.

```bash
npm install
npm run lint
npm run typecheck
npm run build
npm test
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Report security issues privately as described in [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
