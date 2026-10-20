# AEGIS — AI Engineering Guard & Inspection System

![status: early development](https://img.shields.io/badge/status-early%20development-orange)
![license: MIT](https://img.shields.io/badge/license-MIT-blue)

> **Inspect before coding. Protect during coding. Verify after coding.**

AEGIS is an open-source protection framework for AI coding agents such as Claude Code and GitHub Copilot. It is **not** an AI model and does not replace your agent. It aims to give your agent structured rules, safe/unsafe code examples, and deterministic checks, so that mistakes are caught with evidence instead of promises.

## Status: early development

This repository currently contains **only the project foundation** (tooling, CI, and community files). No scanning, rules, or CLI commands exist yet.

| Area                              | Status      |
| --------------------------------- | ----------- |
| Monorepo, lint, typecheck, tests  | Implemented |
| CI workflow                       | Implemented |
| `.aegis` format and parser        | PLANNED     |
| Protection rule library           | PLANNED     |
| Core engine and project detection | PLANNED     |
| CLI (`aegis init`, `scan`, ...)   | PLANNED     |
| Scanner integrations              | PLANNED     |
| Claude Code / Copilot integration | PLANNED     |
| Optional signed rule updates      | PLANNED     |

See [docs/roadmap.md](docs/roadmap.md) for the phase plan.

## What AEGIS cannot guarantee

AEGIS reduces risk. It cannot guarantee bug-free or vulnerability-free software. Instruction files are advisory and an agent may ignore them. Passing checks does not prove code is secure.

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
