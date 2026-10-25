# Versioning policy

AEGIS follows [Semantic Versioning](https://semver.org). Before 1.0.0 (the current state) minor versions may contain breaking changes, which are always listed in [CHANGELOG.md](../CHANGELOG.md).

Four things have versions, and they move independently:

| What                 | Where                                                                                                                             | Rule                                                                                                                          |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| The AEGIS tool       | package version                                                                                                                   | MAJOR: breaking CLI or file-format changes. MINOR: new commands or checks. PATCH: fixes.                                      |
| The shipped rule set | `BASELINE_RULES_VERSION` in `packages/rules/src/index.ts`                                                                         | Bump whenever a bundled rule is added, removed or changed. Installed update bundles must be strictly newer than it.           |
| One rule             | `version` field in the rule file                                                                                                  | Bump when its meaning changes. Changing a rule's severity or what it blocks counts as a change worth a note in the changelog. |
| File formats         | `.aegis` (`aegis: "1.0"`), `aegis.config.json` (`version: 1`), learning records (`version: 1`), rule bundles (`formatVersion: 1`) | A new incompatible format gets a new version number; AEGIS reads the old one or says exactly why it cannot.                   |
