# Scanner accuracy and limitations

AEGIS must not claim comprehensive detection, so this page records what was actually measured and what is known to be missing.

## What was measured

The fixture set is **small** (a handful of samples), so these numbers show that the rules work as designed. They are not statistics about real-world accuracy.

| Check         | Fixture                                                                                     | Result                                                            |
| ------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Semgrep rules | `tests/fixtures/vulnerable` (6 deliberately unsafe lines: 3 SQL, 2 HTML insertion, 1 React) | 6 of 6 reported                                                   |
| Semgrep rules | `tests/fixtures/corrected` (6 safe equivalents)                                             | 0 of 6 reported                                                   |
| Gitleaks      | generated file with a high-entropy fictional key                                            | reported, value not shown                                         |
| Gitleaks      | same key in a `.gitignore`d `.env`                                                          | reported as a warning                                             |
| Gitleaks      | same key under `node_modules`                                                               | not reported (Gitleaks skips it)                                  |
| npm audit     | lockfile pinning `lodash 4.17.15`                                                           | reported with advisories (needs network)                          |
| OSV-Scanner   | same lockfile                                                                               | needs network; without it the check is a tool error, never a pass |
| tsc           | a project with one type error                                                               | reported as a confirmed failure                                   |

The tests that run the real tools are in `tests/integration/real-tools.test.ts`. They are skipped when a tool is not installed, so a machine without the tools verifies nothing about them.

## Not verified

- **OSV-Scanner's vulnerable-result format** was not captured from a real vulnerable run, because the development environment could not reach `api.osv.dev`. The parser follows the documented format and is tested with a synthetic sample. Check it against a real run before relying on it.
- **ESLint** was tested with fake tool output and its documented JSON format, not with a real ESLint run.
- Windows and macOS were not tested.

## Known gaps in the Semgrep rules

- **SQL injection:** only a string or template literal passed directly to `.query()` or `.execute()` is found. SQL assembled in a variable first, query builders, and other languages are not detected.
- **XSS:** only `innerHTML`, `outerHTML`, `document.write` and `dangerouslySetInnerHTML` with non-constant values. Sanitized input is flagged too (false positive). Server-side templates are not covered.
- **Not detectable by scanners at all:** broken authorization (rule `AEGIS-SEC-0004`), unverified packages, most logic errors. These rely on tests, review and the agent instructions.
- Semgrep skips folders named `tests` and `test` by default, so code there is not scanned.
- Secret detection depends on Gitleaks's rules. Low-entropy or unusual secrets can be missed, and harmless test values can be flagged.

## Treat results as leads

A finding is something to investigate. "No findings" means these specific checks found nothing, not that the code is secure.
