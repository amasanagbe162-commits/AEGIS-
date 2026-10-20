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

**Every scan ends with exit code 3.**
Expected for now. Scanner integrations are not implemented yet, so each planned check is reported as skipped. In CI you can use `aegis check --allow-incomplete`, but the output still says INCOMPLETE.

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
