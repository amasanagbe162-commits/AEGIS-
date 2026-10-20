# Protection levels

AEGIS has three protection levels. They change which rules are selected, which checks are planned, and how severe a finding must be to change the result. No level guarantees security.

Set the level in `aegis.config.json` (`"protectionLevel": "standard"`). The defaults live in `packages/core/src/rule-matching/levels.ts`.

|                                 | Standard                                         | Advanced                                            | Maximum                                                  |
| ------------------------------- | ------------------------------------------------ | --------------------------------------------------- | -------------------------------------------------------- |
| For                             | Personal projects, beginners                     | Production-oriented work                            | High-risk applications                                   |
| Rule categories                 | universal, security, coding-errors, dependencies | Standard + configuration, testing                   | Advanced + architecture                                  |
| Minimum rule severity           | medium                                           | low                                                 | informational                                            |
| A finding changes the result at | critical                                         | high                                                | medium                                                   |
| Planned checks                  | secrets, static analysis, type check, lint       | Standard + npm audit, dependency vulnerability scan | Same as Advanced (more arrive with scanner integrations) |

Checks are only planned when the project needs them. A TypeScript type check is planned only if a `tsconfig.json` exists.

## What the result means

| Result     | Exit code | Meaning                                                                         |
| ---------- | --------- | ------------------------------------------------------------------------------- |
| clean      | 0         | Every planned check ran and found nothing at or above the threshold.            |
| findings   | 1         | At least one blocking finding.                                                  |
| error      | 2         | Invalid configuration, unreadable rules, or a missing project folder.           |
| incomplete | 3         | Nothing blocking was found, but some planned checks did not run. **Not clean.** |

Only a finding or confirmed failure at or above the threshold blocks. Warnings, unverified suggestions and low-confidence scanner findings are reported but never block on their own, because a scanner hit is evidence to investigate, not proof.

## Trade-offs of stricter levels

- More rules and checks mean longer runs and more false positives.
- Lower thresholds make normal work more likely to be flagged. Use `Maximum` for code where a mistake is costly.
- Changing a level never silently removes security settings: lowering the level is an explicit edit to `aegis.config.json`.

## Current limitation

Scanner integrations are not implemented yet (Phase 5). Until then every planned check is reported as skipped, so every scan ends as `incomplete` (exit code 3). That is intended: a scan must not look clean when nothing ran.
