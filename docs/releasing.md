# Releasing AEGIS

AEGIS is **not published yet**. Do not release until every item below is true. This list exists so that "ready" is a checked fact.

## Before the first release

- [ ] **Choose and reserve the npm name.** `aegis-guard` and `aegis` already exist on npm and belong to unrelated projects (checked 2026-10-25), so `npx aegis-guard init` would run someone else's code. `aegis-ai-guard` and `aegis-engineering` were free on that date. Names can be taken at any time: check again, then publish promptly. Packages are currently `private: true` so they cannot be published by accident.
- [ ] **Review the starter rules.** All six are `status: proposed`. A maintainer must check each rule's description, severity, examples, references and limitations against `docs/rule-authoring.md`, then set `status: approved` in a reviewed commit.
- [ ] **Create the signing key** (`aegis rules keygen`), keep the private key offline, and add the public key to `TRUSTED_KEYS` (see [updates.md](updates.md)), or decide not to ship official updates yet.
- [ ] Decide the license holder line in `LICENSE` (MIT is in place).
- [ ] Make the packages publishable: remove `private`, set `files`, `repository`, `engines`, bundle or publish the workspace packages the CLI depends on (`@aegis/core`, `@aegis/rules`, `@aegis/integrations`) or merge them into one published package.
- [ ] Run the checklist below on the exact commit to be released.

## Every release

1. `npm ci && npm run lint && npm run format:check && npm run typecheck && npm run build && npm test`
2. Run the real-tool tests with the scanners installed (CI job `real-tools`, or locally with the versions in [installation.md](installation.md)).
3. Update `BASELINE_RULES_VERSION` if bundled rules changed, and `CHANGELOG.md`.
4. Bump versions, tag, and publish with provenance (`npm publish --provenance`) from CI, not from a laptop.
5. If rules changed, build and sign a bundle (`aegis rules bundle`) and publish it over HTTPS.
6. In a fresh folder, install the published package and run `aegis doctor` and `aegis init --dry-run`.

## What a release does not claim

AEGIS reduces risk. It does not guarantee software is secure or bug-free, and its checks have documented gaps ([scanner-accuracy.md](scanner-accuracy.md)).
