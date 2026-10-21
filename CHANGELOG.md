# Changelog

All notable changes are documented here. Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Project foundation: npm workspaces monorepo (`core`, `cli`, `rules`), strict TypeScript, ESLint, Prettier, Vitest.
- GitHub CI workflow, issue templates, and pull request template.
- MIT license, README, contributing guide, code of conduct, and security policy.
- Roadmap document.
- Architecture document (`docs/architecture.md`): package boundaries, data flow, trust model, constraints, decisions.

- `.aegis` format specification (`formats/aegis-file-spec.md`) and generated JSON Schemas (`npm run schemas`).
- Zod schemas for rules, the master file and `aegis.config.json`.
- Safe YAML/JSON parser with line-numbered diagnostics (size limit; no aliases, custom tags or duplicate keys).
- Rule loader with symlink, size, naming and uniqueness checks; master-file rule reference checks; Markdown renderer.
- Master template `templates/AEGIS.aegis` and config template.
- Six starter rules (SQL injection, XSS, hardcoded credentials, server-side ownership checks, async errors, package verification), all marked `proposed` pending human review.
- Rule authoring guide.

- Core engine: evidence-based project detection (Node.js, TypeScript, Next.js, Python, SQL; manifests for Rust and Go), `.gitignore`-aware indexing, secret files never read.
- Rule selection by language, framework, status and protection level, with a recorded reason for every choice.
- Findings model that separates findings, confirmed failures, warnings and unverified suggestions; check outcomes that separate passed, findings, failed, skipped and tool errors.
- Protection levels (standard, advanced, maximum) as real settings; documented in `docs/protection-levels.md`.
- Secret redaction applied to every report; text and JSON reports; exit codes 0 (clean), 1 (findings), 2 (error), 3 (incomplete).
- `inspectProject()` entry point that never throws on bad input.

- CLI (`aegis`): `init` (dry run, preview, confirmation, never overwrites), `scan`, `check`, `rules list`, `rules validate`, `doctor`, with `--help` and documented exit codes.
- Installation and troubleshooting guides.

- Scanner integrations: Gitleaks (secrets), Semgrep with AEGIS's own local rules (static analysis), `npm audit`, OSV-Scanner, and the project's own `tsc` and ESLint (opt-in). Missing tools are reported as skipped, failures as tool errors.
- Safe subprocess runner (no shell, argument arrays, fixed working directory, timeout, output cap, process-group kill, filtered environment).
- Four Semgrep rules for AEGIS-SEC-0001 and AEGIS-SEC-0002; `scan.allowProjectTools` and `scan.toolTimeoutSeconds` config; `--allow-project-tools` flag.
- Scanner documentation, accuracy notes and fixtures (vulnerable, corrected, vulnerable dependencies).

### Changed

- A confirmed failure (type error, lint error) now always blocks, at every protection level.
- Templates moved to `packages/rules/templates/` so the CLI can ship them.
- `npm run build` builds packages in dependency order; `npm test` and `npm run typecheck` build first.

- Supported Node.js versions are now 22 and 24 (Node 20 is end of life). CI matrix and `engines` updated.
