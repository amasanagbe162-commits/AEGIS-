# Troubleshooting

Start with `aegis doctor`. It checks your Node.js version, your AEGIS files, the bundled rules and the optional scanners, and it changes nothing.

## Exit codes

| Code | Meaning                                                                                                      |
| ---- | ------------------------------------------------------------------------------------------------------------ |
| 0    | Success. For `scan` and `check`: every planned check ran and nothing blocking was found.                     |
| 1    | Findings at or above the protection level's threshold.                                                       |
| 2    | Usage error, invalid file, or the command could not run.                                                     |
| 3    | Incomplete: nothing blocking was found, but some planned checks did not run. This is **not** a clean result. |

## Common problems

**The scan ends with exit code 3 (INCOMPLETE).**
Some planned checks did not run. Each skipped check says why: the tool is not installed, it timed out or failed, or it is a project tool that needs `--allow-project-tools`. Install the missing tools (see [installation.md](installation.md)), or use `aegis check --allow-incomplete` in CI if you accept the gap. The output still says INCOMPLETE.

**`[TOOL-ERROR] npm dependency audit: npm audit failed: ... certificate ...`**
npm could not reach the registry, often behind a proxy that inspects traffic. AEGIS passes proxy and certificate settings (`HTTPS_PROXY`, `NODE_EXTRA_CA_CERTS`, `SSL_CERT_FILE`, `npm_config_*`) to scanners but nothing else from your environment.

**`osv-scanner exited with code 127`**
OSV-Scanner could not reach `api.osv.dev`. The dependency vulnerability scan needs network access.

**Semgrep finds nothing in my `tests/` folder.**
Semgrep ignores folders named `tests` and `test` by default.

**A finding says "a lead to investigate".**
Scanner findings are not confirmed vulnerabilities. Check the location, decide whether the code is really unsafe, and fix or dismiss it.

**`aegis: not running in a terminal, so nothing was written.`**
`aegis init` will not create files without confirmation. Add `--yes`, or use `--dry-run` to preview.

**`the existing aegis.config.json is invalid`**
AEGIS never rewrites your files. The message shows the line and field. Fix the file, or move it away and run `aegis init` again.

**`refusing to initialize your home folder or the filesystem root`**
Run `aegis init` inside a project folder, or pass the project path: `aegis init ./my-project`.

**`Node.js ... is too old`**
Install Node.js 22 or newer.

**`[warn] gitleaks: not found` (or semgrep, osv-scanner)**
These optional tools are not on your PATH. The matching checks are reported as skipped. Doctor only looks for the tools; it does not run them.

**A rule file fails validation.**
`aegis rules validate path/to/rule.yaml` shows the file, line and field. Validation checks structure only, not whether the advice is correct.
