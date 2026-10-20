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

### Changed

- Supported Node.js versions are now 22 and 24 (Node 20 is end of life). CI matrix and `engines` updated.
