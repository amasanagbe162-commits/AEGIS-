# Offline rules and optional signed updates

AEGIS works fully offline. The rules it needs ship inside the package (the **baseline**). Updates are optional, **off by default**, and verified before anything is written.

## What the update mechanism does

`aegis rules update`:

1. Refuses to run unless `updates.enabled` is `true` in `aegis.config.json`.
2. Gets a signed bundle from `updates.source` (an `https://` URL) or from `--source` (an `https://` URL or a local file).
3. Verifies it, in this order: size limit, JSON shape, **signature** against keys you trust, compatibility (`minAegisVersion`), and that it is **newer** than the rules in use.
4. Writes the rules to a temporary folder and runs the normal rule validation on them.
5. Shows what is added, changed and removed. `--dry-run` stops here.
6. Asks for confirmation (`--yes` to skip it; required without a terminal), then swaps the new rules in. The rules in use stay in place until the swap, and are restored if it fails.

On any failure nothing changes and the message says why.

## Network requests

Exactly one: an HTTPS `GET` of the bundle URL, with headers `accept: application/json` and `user-agent: aegis-rules-update`. No project files, file names, code, or identifiers are sent. Redirects to non-HTTPS addresses are refused, the download is limited to 5 MB and 15 seconds. Nothing else in AEGIS contacts the network.

## Why a checksum is not enough

A checksum published next to a download proves nothing if an attacker can change both. A bundle carries an **Ed25519 signature** over its manifest (version, compatibility, key id, and every rule's text). AEGIS accepts it only if the signing key is one **you** trust. Changing a single character of any rule, or the version, invalidates the signature.

## What a bundle can and cannot contain

Rule YAML text only, at paths like `security/AEGIS-SEC-0001.yaml` (anything else is rejected, so path traversal is impossible). Every rule must pass the same validation as bundled rules. A bundle cannot carry code, scanner configurations, or commands, and nothing in it is executed. A signed bundle is a complete snapshot: it replaces the baseline rule set, so removing a rule from a bundle removes it for the project.

A rule can still be technically wrong while being validly signed. Signing proves who published it, not that it is correct: review rules before signing them.

## Installed state and fallbacks

Installed rules live in `.aegis/rules/` with an `installed.json` recording the version, key id and a hash of every file. On every scan AEGIS checks that the installed rules are intact and newer than the baseline. If not (edited, damaged, or a newer AEGIS ships a newer baseline) it **falls back to the baseline and says so** (`aegis rules status`, `aegis doctor`, and a note on `scan`). A damaged install never breaks scanning and never silently weakens it. To remove an update, delete `.aegis/rules/`.

Downgrades and replays are refused: a bundle must be strictly newer than the rules in use.

## Trusting a key

There is **no built-in official signing key yet**. `TRUSTED_KEYS` in `packages/rules/src/index.ts` is empty on purpose, so out of the box no update can be accepted. Two ways to trust a key:

- **Per project or team:** add the publisher's public key to `aegis.config.json`:

  ```json
  {
    "version": 1,
    "updates": {
      "enabled": true,
      "source": "https://example.com/aegis-rules.json",
      "trustedKeys": [{ "id": "aegis-2026", "publicKey": "MCowBQYDK2VwAyEA..." }]
    }
  }
  ```

  Only add a key you received from the publisher through a channel you trust (not from the same server as the bundle).

- **Built in (project owner):** after generating the official key, add its public key to `TRUSTED_KEYS` in a reviewed commit.

There is no revocation list yet. If a key is compromised, remove it from `trustedKeys` (and from `TRUSTED_KEYS` in a release); bundles signed after rotation use a new key id.

## The official signing workflow

This is the process for the project owner. It is implemented and tested, but the key itself does not exist yet, because a signing key must be created and held by a person you trust, not generated inside a development sandbox or a repository.

1. **Create the key on a trusted machine, outside any repository.**

   ```bash
   aegis rules keygen --out-dir ~/aegis-keys --key-id aegis-2026
   ```

   The private key is written to `~/aegis-keys/aegis-2026.private.pem` with owner-only permissions and is never printed. `keygen` **refuses to write inside a Git repository** (override only with `--allow-in-repo`, which you should not use) and never overwrites an existing key. Keep a backup in a password manager or hardware vault. If you lose the key you cannot sign updates; if someone else gets it they can.

2. **Trust the public key in the code.** Add the public key that `keygen` printed to `TRUSTED_KEYS` in `packages/rules/src/index.ts` and merge it through a reviewed pull request. Only this public key is ever committed.

3. **Give the release workflow the private key, and nobody else.** In GitHub: create an environment named `release-signing`, require reviewers for it, then add the private key file's text as the environment **secret** `AEGIS_RULES_SIGNING_KEY` and the key id as the environment **variable** `AEGIS_RULES_KEY_ID`. Do not use a repository-wide secret.

4. **Sign a release.** Run the "Sign rule bundle" workflow (`.github/workflows/sign-rules.yml`) with the new `bundle_version`. It validates the rules, signs them, verifies the result with `aegis rules check-bundle` against the keys built into AEGIS, and attaches the bundle to that workflow run as an artifact. It **never publishes, pushes or tags anything**.

5. **Publish deliberately.** Download the artifact, check the version, and host it over HTTPS wherever you choose. Users who set `updates.source` to that address (and trust your key) receive it.

What protects the key:

| Risk                              | Control                                                                                                                                                                                                                                              |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Key committed to Git              | `keygen` refuses to write inside a repository; `.gitignore` blocks `*.pem`, `*.private.pem`, `*.key`, `*.p12`; a test fails if any file in the repository contains a private-key block; CI scans the working tree and the full history with Gitleaks |
| Key leaked from CI logs           | The workflow reads the secret only through an `env` block, writes it to an owner-only temporary file, deletes it on exit, and never echoes it (a test checks this and fails if the workflow is changed to print it)                                  |
| Anyone running the workflow       | It runs only on manual dispatch, in an environment that requires reviewer approval, with read-only repository permissions                                                                                                                            |
| A workflow that quietly publishes | A test fails if any workflow contains `npm publish`, `git push`, a release action or a write permission                                                                                                                                              |
| A bundle signed by the wrong key  | `check-bundle` runs in the workflow against the keys compiled into AEGIS and fails otherwise                                                                                                                                                         |

**Rotation and compromise.** Create a new key with a new id, add its public key to `TRUSTED_KEYS`, sign with it, and remove the old public key in the next release. If a key may be compromised, remove its public key immediately and release a new AEGIS version; users on older versions keep trusting the old key until they upgrade (there is no revocation list yet), and teams that listed the key in their own `updates.trustedKeys` must remove it themselves.

## Other ways to publish a bundle (maintainers)

You can also sign by hand on your trusted machine:

```bash
aegis rules bundle --key ~/aegis-keys/aegis-2026.private.pem --key-id aegis-2026 \
  --bundle-version 0.3.0 --out aegis-rules-0.3.0.json
aegis rules check-bundle aegis-rules-0.3.0.json    # needs the key in TRUSTED_KEYS, or --trust aegis-2026=<public key>
```

`bundle` never overwrites files, refuses to sign rules that do not validate, and checks its own output. Remember to bump `BASELINE_RULES_VERSION` when the rules shipped inside a release change, so installed updates are compared against the right baseline.

## What is not implemented

- No automatic or scheduled checking: updates run only when you run the command.
- No key revocation list or key-rotation workflow beyond editing the trusted list.
- No delta updates: a bundle is the whole rule set.
- No hosted update server: you publish the file wherever you like.
