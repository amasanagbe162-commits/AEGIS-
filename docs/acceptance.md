# Acceptance criteria: where AEGIS stands

This maps section 29 of the master specification to evidence. "Met" means a test or a documented procedure shows it. Anything else says exactly what is missing. As of this page, **AEGIS v1.0 is not ready for release** (see the open items).

Verified on 2026-10-25: Node 22, Linux x86-64, fresh clone, `npm ci`, lint, format check, typecheck, build and tests all pass (369 passed, 7 skipped on a machine without scanners; 376 passed, 0 skipped with Gitleaks 8.28.0, Semgrep 1.182.1 and OSV-Scanner 2.2.2 installed).

## Core engine

| Criterion                                       | Status                                             | Evidence                                                             |
| ----------------------------------------------- | -------------------------------------------------- | -------------------------------------------------------------------- |
| `.aegis` format documented                      | Met                                                | `formats/aegis-file-spec.md`, JSON schemas in `formats/`             |
| Master instructions reference specialized rules | Met                                                | master references checked by `aegis rules validate`                  |
| Rules parsed and validated                      | Met                                                | parser/loader tests, hostile-input tests in `tests/security`         |
| Project technologies detected                   | Met for JS/TS, Node, Next.js, Python/SQL selection | detection tests. Rust and Go files are recognized but have no rules. |
| Relevant rules selected                         | Met                                                | selection tests                                                      |
| Findings represented consistently               | Met                                                | findings model and tests                                             |
| Reports generated                               | Met                                                | text and JSON reports                                                |
| Offline operation works                         | Met                                                | baseline rules ship in the package; updates are off by default       |

## CLI

| Criterion                          | Status | Evidence                                                                             |
| ---------------------------------- | ------ | ------------------------------------------------------------------------------------ |
| Initialization works               | Met    | `aegis init`, tests, fresh-clone run                                                 |
| Scanning works for supported cases | Met    | real Gitleaks and Semgrep end to end; see [scanner-accuracy.md](scanner-accuracy.md) |
| Rule validation works              | Met    | `aegis rules validate`, CI workflow `rule-validation.yml`                            |
| Diagnostics work                   | Met    | `aegis doctor`                                                                       |
| Errors and exit codes meaningful   | Met    | exit codes 0/1/2/3 documented in [troubleshooting.md](troubleshooting.md) and tested |

## Protection library

| Criterion                                  | Status              | Evidence                                                                                                |
| ------------------------------------------ | ------------------- | ------------------------------------------------------------------------------------------------------- |
| Initial security rules                     | Partly met          | 4 security rules (SQL injection, XSS, hardcoded credentials, server-side ownership)                     |
| Initial coding-error rules                 | Partly met          | 1 rule (asynchronous errors); the spec's list is far longer                                             |
| Bad and corrected examples                 | Met for the 6 rules | each rule has both, plus fixtures in `tests/fixtures`                                                   |
| Rules tested or have documented validation | Partly met          | Semgrep-backed rules measured on fixtures; rules with no scanner (e.g. ownership checks) rely on review |
| Vulnerable fixtures isolated               | Met                 | `tests/fixtures/vulnerable` is never executed or imported                                               |
| **Human review of rules**                  | **Not met**         | all 6 rules are `status: proposed`; a maintainer must approve them                                      |

## Agent integrations

| Criterion                             | Status           | Evidence                                                           |
| ------------------------------------- | ---------------- | ------------------------------------------------------------------ |
| Claude Code instructions generated    | Met (file level) | `.claude/rules/aegis.md`; Stop hook tested through the real binary |
| GitHub Copilot instructions generated | Met (file level) | `.github/instructions/aegis.instructions.md`                       |
| OpenAI Codex and ChatGPT              | Met (file level) | `AGENTS.md` block; paste-in text                                   |
| Existing instruction files preserved  | Met              | tests, including byte-for-byte preservation                        |
| Limitations documented                | Met              | [integrations.md](integrations.md), `aegis agents list`            |
| **Tested inside live agent sessions** | **Not met**      | no live session with any of the four agents was available          |

## Security

| Criterion                                    | Status | Evidence                                                                              |
| -------------------------------------------- | ------ | ------------------------------------------------------------------------------------- |
| No secrets embedded                          | Met    | fixtures use fictional values; Gitleaks scan of the repo is part of release checklist |
| Untrusted rules cannot execute code          | Met    | YAML aliases and tags refused, no eval, rules are data (`tests/security`)             |
| Safe subprocess handling                     | Met    | argument arrays, no shell, timeouts, minimal environment                              |
| Missing scanners reported honestly           | Met    | skipped checks make the result INCOMPLETE (exit 3)                                    |
| Online updates optional and validated        | Met    | [updates.md](updates.md); Ed25519 signatures, version and compatibility checks        |
| Sensitive data not uploaded by default       | Met    | the only network request is the optional update download                              |
| Writes refuse symbolic links under `.aegis/` | Met    | `tests/security/hardening.test.ts` (each guard mutation-checked)                      |

## Quality

| Criterion                          | Status                        | Evidence                                                                      |
| ---------------------------------- | ----------------------------- | ----------------------------------------------------------------------------- |
| Automated tests pass               | Met                           | see numbers above                                                             |
| Type checking passes               | Met                           | `npm run typecheck`                                                           |
| Linting passes                     | Met                           | `npm run lint`                                                                |
| Production build passes            | Met                           | `npm run build`                                                               |
| Limitations documented             | Met                           | README, scanner-accuracy, integrations, updates, learning                     |
| Installation instructions verified | Met for a repository checkout | fresh clone followed `docs/installation.md`                                   |
| **Installable from npm**           | **Not met**                   | not published; the planned names are taken (see [releasing.md](releasing.md)) |

## Open items before a 1.0 release

1. Choose and reserve an npm package name, and make the workspace packages publishable.
2. A maintainer reviews and approves the rules; the library needs to grow well beyond six rules.
3. Create the update signing key (or decide not to ship official updates yet).
4. Test the integrations in live Claude Code, Copilot, Codex and ChatGPT sessions.
5. Verify OSV-Scanner and `npm audit` vulnerable-result parsing against a run with network access.
6. Test on macOS and Windows.
7. The public website was deliberately deferred.
