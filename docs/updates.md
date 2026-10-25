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

## Publishing (maintainers)

```bash
aegis rules keygen --out-dir ~/aegis-keys --key-id aegis-2026   # private key stays on this machine, offline
aegis rules bundle --key ~/aegis-keys/aegis-2026.private.pem --key-id aegis-2026 \
  --bundle-version 0.2.0 --out aegis-rules-0.2.0.json            # signs and self-verifies
```

Then host the file over HTTPS (for example a GitHub release asset). `keygen` and `bundle` never overwrite files, never print the private key, and `bundle` refuses to sign rules that do not validate. Keep the private key out of Git, CI logs and chat; anyone who has it can publish rules that every user who trusts the key will accept.

Remember to bump `BASELINE_RULES_VERSION` when the rules shipped inside a release change, so installed updates are compared against the right baseline.

## What is not implemented

- No automatic or scheduled checking: updates run only when you run the command.
- No key revocation list or key-rotation workflow beyond editing the trusted list.
- No delta updates: a bundle is the whole rule set.
- No hosted update server: you publish the file wherever you like.
