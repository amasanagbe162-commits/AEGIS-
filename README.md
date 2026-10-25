# AEGIS — AI Engineering Guard & Inspection System

![status: early development](https://img.shields.io/badge/status-early%20development-orange)
![license: MIT](https://img.shields.io/badge/license-MIT-blue)

> **Inspect before coding. Protect during coding. Verify after coding.**

AEGIS is an open-source protection framework for AI coding agents such as Claude Code, GitHub Copilot, OpenAI Codex and ChatGPT. It is **not** an AI model and does not replace your agent. It aims to give your agent structured rules, safe/unsafe code examples, and deterministic checks, so that mistakes are caught with evidence instead of promises.

## Status: early development

This repository currently contains the project foundation, the `.aegis` format (specification, schemas, safe parser and rule loader), six starter rules, and the core engine (project detection, rule selection, reports). A working CLI (`init`, `scan`, `check`, `rules`, `agents`, `hook`, `doctor`) runs real scanners (Gitleaks, Semgrep, npm audit, OSV-Scanner, and your project's own tsc and ESLint when allowed). A scan is only `clean` when every planned check actually ran.

| Area                                                      | Status                                                                                                                                    |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Monorepo, lint, typecheck, tests                          | Implemented                                                                                                                               |
| CI workflow                                               | Implemented                                                                                                                               |
| `.aegis` format and parser                                | Implemented and tested                                                                                                                    |
| Protection rule library                                   | Started: 6 starter rules, pending human review                                                                                            |
| Core engine and project detection                         | Implemented and tested                                                                                                                    |
| CLI (`aegis init`, `scan`, `check`, `rules`, `doctor`)    | Implemented and tested                                                                                                                    |
| Scanner integrations                                      | Implemented; OSV-Scanner and ESLint output not verified against real vulnerable runs (see [accuracy](docs/scanner-accuracy.md))           |
| Agent integrations (Claude Code, Copilot, Codex, ChatGPT) | Implemented and tested at the file and CLI level; not tested inside live agent sessions. See [docs/integrations.md](docs/integrations.md) |
| Learning records (`aegis learn`)                          | Implemented and tested; see [docs/learning.md](docs/learning.md)                                                                          |
| Optional signed rule updates                              | PLANNED                                                                                                                                   |

See [docs/roadmap.md](docs/roadmap.md) for the phase plan.

## What AEGIS cannot guarantee

AEGIS reduces risk. It cannot guarantee bug-free or vulnerability-free software. Instruction files are advisory and an agent may ignore them. Passing checks does not prove code is secure.

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
