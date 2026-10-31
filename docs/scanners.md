# Scanner integrations

AEGIS does not reimplement security scanners. It runs existing tools, normalizes their output into findings, and reports honestly when a tool did not run. AEGIS does **not** bundle or redistribute any of these tools: you install them yourself.

Versions verified by running the real tools (2026-10-26): Gitleaks 8.28.0, Semgrep 1.182.1, OSV-Scanner 2.2.2, npm 10.9.7. Other versions may work but were not tested. Tool command lines change between versions, so a different major version may need an update. Gitleaks 8.18.4 is known NOT to work (no `dir` command).

## The checks

| Check id                     | Tool                                                  | What it looks for                             | Planned when                | Level           |
| ---------------------------- | ----------------------------------------------------- | --------------------------------------------- | --------------------------- | --------------- |
| `secrets`                    | [Gitleaks](https://github.com/gitleaks/gitleaks)      | Secret-like values in files                   | always                      | standard and up |
| `static-analysis`            | [Semgrep](https://semgrep.dev) with AEGIS's own rules | SQL built from strings, unsafe HTML insertion | always                      | standard and up |
| `typecheck`                  | the project's own `tsc`                               | TypeScript errors                             | a `tsconfig.json` exists    | standard and up |
| `lint`                       | the project's own ESLint                              | Lint errors from the project's config         | ESLint is configured        | standard and up |
| `dependency-audit`           | `npm audit`                                           | Known advisories for npm packages             | an npm lockfile exists      | advanced and up |
| `dependency-vulnerabilities` | [OSV-Scanner](https://github.com/google/osv-scanner)  | Known vulnerabilities in lockfiles            | a supported lockfile exists | advanced and up |

## Exactly what runs

Every program is started by one function (`packages/core/src/process/run.ts`): no shell, arguments as an array, a fixed working directory, a time limit (`scan.toolTimeoutSeconds`, default 120), an output size cap (20 MB), and the whole process group is stopped on timeout. Scanners do not inherit your environment: only an allowlist of variables is passed (`PATH`, `HOME`, temp and locale settings, proxy and CA-certificate settings, `npm_config_*`). API tokens, cloud credentials and `NODE_OPTIONS` are not passed.

| Tool        | Command (arguments)                                                                                                                               |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Gitleaks    | `gitleaks dir <project> --config <AEGIS-owned file> --ignore-gitleaks-allow --report-format json --report-path - --redact --no-banner --no-color` |
| Semgrep     | `semgrep scan --json --quiet --metrics=off --disable-version-check --config <AEGIS rules file> <project>`                                         |
| npm         | `npm audit --json --package-lock-only`                                                                                                            |
| OSV-Scanner | `osv-scanner scan source --format json --lockfile <lockfile> ...`                                                                                 |
| tsc         | `node_modules/.bin/tsc --noEmit -p tsconfig.json --pretty false`                                                                                  |
| ESLint      | `node_modules/.bin/eslint --format json .`                                                                                                        |

## Network requests and what is sent

| Tool        | Network                                                                                                                               | Data sent                                                      |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Gitleaks    | none                                                                                                                                  | none                                                           |
| Semgrep     | none from AEGIS's command line: metrics and version checks are off, and only the local rule file is used (never the Semgrep registry) | none                                                           |
| `npm audit` | npm registry                                                                                                                          | Package names and versions from your lockfile. No source code. |
| OSV-Scanner | `api.osv.dev`                                                                                                                         | Package names and versions from your lockfile. No source code. |
| tsc, ESLint | none                                                                                                                                  | none                                                           |

If the network is unavailable, the two dependency checks end as `tool-error` with the reason. They never report "passed" in that case.

## The secret check cannot be silenced by the project it scans

Gitleaks can be told to ignore things from inside the project it scans, and so can anyone who edits that project, including an AI agent that wants a clean result. Each of these was tested against the real Gitleaks 8.28.0 and each hid a real secret from a plain scan:

| Way to hide a secret                         | What AEGIS does                                                                                                                                                                                                                        |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A `// gitleaks:allow` comment on the line    | Ignored. AEGIS passes `--ignore-gitleaks-allow`                                                                                                                                                                                        |
| A project `.gitleaks.toml` with an allowlist | Not read. AEGIS passes its own config (Gitleaks's default rules and nothing else) from a private temporary folder that is deleted afterwards                                                                                           |
| A project `.gitleaksignore` file             | Gitleaks always reads it in directory mode and no flag turns that off, so AEGIS **refuses to trust the scan**: the check is a tool error, the overall result is INCOMPLETE (exit 3), and the message says to remove or rename the file |

Exposed credentials are reported at the severity of the rule that governs them (`AEGIS-SEC-0003`, critical), so they block at **every** protection level, including the default. The report's confidence stays "medium", because a pattern cannot prove a value is a real credential.

If you have a legitimate false positive (for example a fake key in a test), change the value so it no longer looks like a secret (build it from parts at run time) rather than suppressing it. This repository does exactly that. For scanning git history in CI, keep a reviewed ignore file outside the source folder and pass `--gitleaks-ignore-path` yourself.

## Tools from your project are opt-in

`tsc` and ESLint come from your project's `node_modules`. Running them executes code that ships with the project (and an ESLint config is code). So they are **skipped by default**, with a message saying so. Allow them with `--allow-project-tools` or `"scan": { "allowProjectTools": true }` in `aegis.config.json`. Only the project's own copy is used: a global install is ignored, and a tool whose real path leaves the project folder is refused.

## How results are interpreted

| Situation                                                             | Outcome                                                               |
| --------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Tool not installed                                                    | `skipped`, with an install hint. The scan is `incomplete`.            |
| Timeout, crash, unreadable or unexpected output, unexpected exit code | `tool-error`, with the reason. The scan is `incomplete`.              |
| Ran, nothing found                                                    | `passed`                                                              |
| Ran, found something                                                  | `findings` or `failed` (a deterministic failure such as a type error) |

Details that matter, all covered by tests:

- Gitleaks exits 1 both for "leaks found" and for fatal errors, so AEGIS reads the report to tell them apart.
- `npm audit` exits 1 for vulnerabilities and for failures. AEGIS reads the JSON, and shows the real reason for a failure.
- OSV-Scanner prints an empty result when it cannot reach its server, together with exit code 127. AEGIS trusts an empty result only with exit code 0.
- Semgrep findings are labeled as possible issues to investigate, never as confirmed vulnerabilities.
- Findings in `.gitignore`d files (for example a local `.env`) are warnings, not findings.

## Platform notes and licenses

- Linux is the tested platform. On Windows, running `tsc` and ESLint from `node_modules/.bin` is not supported yet, and the other tools are untested.
- Licenses (checked in each project's repository): Gitleaks is MIT, OSV-Scanner is Apache-2.0, Semgrep is LGPL-2.1. AEGIS calls them as separate programs. The Semgrep registry's rules have their own license and are not used.

## Known limitations

See [scanner-accuracy.md](scanner-accuracy.md). In short: the Semgrep rules are small heuristics for JavaScript and TypeScript, so they miss many real problems and can flag safe code.
