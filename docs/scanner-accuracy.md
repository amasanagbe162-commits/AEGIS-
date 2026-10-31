# Scanner accuracy and limitations

AEGIS must not claim comprehensive detection, so this page records what was actually measured and what is known to be missing.

## What was measured

The fixture set is **small** (a handful of samples), so these numbers show that the rules work as designed. They are not statistics about real-world accuracy.

| Check         | Fixture                                                                                                                           | Result                                                            |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Semgrep rules | `tests/fixtures/vulnerable` (8 deliberately unsafe lines: 3 direct SQL, 1 SQL assembled in a variable, 3 HTML insertion, 1 React) | 8 of 8 reported, each once                                        |
| Semgrep rules | `tests/fixtures/corrected` (the safe equivalents)                                                                                 | 0 reported                                                        |
| Gitleaks      | generated file with a high-entropy fictional key                                                                                  | reported, value not shown                                         |
| Gitleaks      | same key in a `.gitignore`d `.env`                                                                                                | reported as a warning                                             |
| Gitleaks      | same key under `node_modules`                                                                                                     | not reported (Gitleaks skips it)                                  |
| npm audit     | lockfile pinning `lodash 4.17.15`                                                                                                 | reported with advisories (needs network)                          |
| OSV-Scanner   | same lockfile                                                                                                                     | needs network; without it the check is a tool error, never a pass |
| tsc           | a project with one type error                                                                                                     | reported as a confirmed failure                                   |

The tests that run the real tools are in `tests/integration/real-tools.test.ts`. They are skipped when a tool is not installed, so a machine without the tools verifies nothing about them. CI has a `real-tools` job that installs pinned versions (checksum-verified) so they run on every change.

Last verified against real tools (Linux x86-64, 2026-10-25): **Gitleaks 8.28.0, Semgrep 1.182.1, OSV-Scanner 2.2.2, ESLint 9, TypeScript (project's own), npm audit**. Results: Gitleaks 3 of 3 behaviors as in the table; Semgrep 6 of 6 vulnerable samples reported and 0 of 6 corrected samples reported; ESLint reported a real `eqeqeq` violation at the right line, passed clean code, and was skipped when project tools were not allowed.

**Gitleaks needs the `dir` command.** Gitleaks 8.18.4 does not have it, so AEGIS reports a tool error telling you to upgrade (it never reports a pass). 8.28.0 works; versions in between were not tested.

## Not verified

- **The live OSV service.** The sandbox could not reach `api.osv.dev`. OSV-Scanner 2.2.2 was run for real in its offline mode against a small advisory database built by hand (one lodash advisory), and its real JSON report is saved in `tests/fixtures/osv-real/` and parsed by AEGIS's tests. The report format is therefore real. Which advisories the live service returns, and how it grades severity, was not observed.
- **Other tool versions.** Only the versions listed above were run. The Gitleaks `dir` command exists in 8.28.0 and not in 8.18.4; versions in between were not tested.
- **Windows and macOS.** Not run by the author. CI jobs exist to test them (see [acceptance.md](acceptance.md)).

## Known gaps in the Semgrep rules

- **SQL injection:** a string or template literal passed directly to `.query()` or `.execute()`, and SQL assembled in a variable from `req.query`, `req.body` or `req.params` before being passed, are found. SQL built from other sources or in another function, query builders and ORMs' raw-query helpers, and other languages are not detected.
- **XSS:** only `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write` and `dangerouslySetInnerHTML` with non-constant values. Sanitized input is flagged too (false positive). Server-side templates are not covered.
- **Not detectable by scanners at all:** broken authorization (rule `AEGIS-SEC-0004`), unverified packages, most logic errors. These rely on tests, review and the agent instructions.
- Semgrep skips folders named `tests` and `test` by default, so code there is not scanned.
- Secret detection depends on Gitleaks's rules. Low-entropy or unusual secrets can be missed, and harmless test values can be flagged.

## Treat results as leads

A finding is something to investigate. "No findings" means these specific checks found nothing, not that the code is secure.
