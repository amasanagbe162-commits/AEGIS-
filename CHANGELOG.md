# Changelog

All notable changes are documented here. Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Security

- **The secret check could be silenced by the project it scans.** Found while running AEGIS on its own repository. With real Gitleaks 8.28.0, a `// gitleaks:allow` comment or a project `.gitleaks.toml` allowlist hid a real secret and the scan reported CLEAN. AEGIS now runs Gitleaks with its own config and `--ignore-gitleaks-allow`, and refuses to trust a scan when the project has a `.gitleaksignore` (which Gitleaks always honors). Regression tests run against the real binary and fail when each protection is removed.
- **A leaked secret did not block at the default level.** The adapter reported exposed credentials as `high`, but the default `standard` level blocks only `critical`, so a committed token produced exit 0. They are now reported at the governing rule's severity (critical) and block at every level.
- **`Result: CLEAN` is no longer printed next to a list of findings.** Findings below the blocking threshold now produce "NO BLOCKING FINDINGS ... This is not a clean result" (exit code unchanged).

### Added

- Rule review records: a rule can only be `approved` when its file records who reviewed it, whether that was a person or an AI-assisted review, and every spec quality gate. All six starter rules are approved on that basis (AI-assisted; a human has not yet confirmed them) and each rule's bad and corrected examples are run in tests. Added a Semgrep taint rule for SQL assembled in a variable and an `insertAdjacentHTML` rule.
- Package renamed to `aegis-engineering` (still private; bins `aegis` and `aegis-engineering`).
- Release signing workflow: `aegis rules check-bundle`, key creation refused inside a Git repository, a manual `sign-rules` workflow that reads the key only from a protected environment secret, and tests that lint that workflow.
- Real agent CLI tests (Claude Code 2.1.310, Codex 0.164.0, Copilot CLI 1.0.103), a test of the exact registered hook command through `npx` against a decoy registry, real `npm audit` and OSV-Scanner output fixtures, and CI jobs for macOS and Windows.
- Hardening: all writes under `.aegis/` (learning records, hook state, rule installs) refuse symbolic links; the Claude Stop hook fails open when it cannot record its attempt count, so the attempt limit can never be bypassed. Parser-abuse and symlink regression tests in `tests/security`.
- Real-tool verification (Gitleaks 8.28.0, Semgrep 1.182.1, OSV-Scanner 2.2.2, ESLint 9); a real ESLint test; a clear error when Gitleaks is too old to have the `dir` command.
- CI: a `real-tools` job with checksum-pinned scanners, and a rule-validation workflow.
- Docs: acceptance checklist, versioning policy, release checklist.
- Signed, optional rule updates (`aegis rules update|status|keygen|bundle`): Ed25519-signed bundles verified against keys you trust, version and compatibility checks, no downgrades, full rule validation before install, atomic swap with fallback to the shipped baseline. Off by default; one HTTPS GET, no project data sent. No official signing key exists yet.
- Learning records (`aegis learn add|list|show|amend|verify|review|supersede`): observed -> proposed -> verified -> approved lifecycle. Verification is recorded by AEGIS from a real clean, complete check; approval needs a person at a terminal. Approved lessons are included in generated agent instructions. Secrets are redacted and pasted code is refused.
- Agent integrations (`@aegis/integrations`, `aegis agents list|sync|verify|print`): Claude Code (`.claude/rules/aegis.md`), GitHub Copilot (path-specific instructions), OpenAI Codex (`AGENTS.md` block) and ChatGPT (paste-in text). Generated from the project's master file and selected rules, within enforced size budgets.
- Safe file handling for generated files: hash markers, never overwrite user files, `--merge-existing` appends one marked block, symlink and race protection.
- Claude Code Stop hook (`aegis hook claude-stop`, `--hooks`): sends Claude back for blocking findings up to `selfCorrection.maxAttempts`, never blocks on incomplete checks, fails open.
- `aegis init` now generates agent files; `aegis doctor` reports whether they are installed and current.
- Config `agents` accepts `codex` and `chatgpt`.

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
