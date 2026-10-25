import { generateKeyPairSync } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  activateStaged,
  canonicalize,
  compareSemver,
  discardStaged,
  generateSigningKey,
  resolveRulesInUse,
  signBundle,
  stageBundle,
  verifyBundle,
  type BundleManifest,
  type TrustedKey,
} from "../src/index.js";
import { repoRoot, withTempDir } from "./helpers.js";

const dataDir = path.join(repoRoot, "packages/rules/data");

async function bundledRules(): Promise<BundleManifest["rules"]> {
  const out: BundleManifest["rules"] = [];
  for (const cat of await readdir(dataDir)) {
    for (const f of await readdir(path.join(dataDir, cat))) {
      out.push({
        path: `${cat}/${f}`,
        content: await readFile(path.join(dataDir, cat, f), "utf8"),
      });
    }
  }
  return out;
}

async function manifest(over: Partial<BundleManifest> = {}): Promise<BundleManifest> {
  return {
    bundleVersion: "0.2.0",
    minAegisVersion: "0.0.0",
    createdAt: "2026-10-25T12:00:00.000Z",
    keyId: "test-key",
    rules: await bundledRules(),
    ...over,
  };
}

const key = generateSigningKey();
const trusted: TrustedKey[] = [{ id: "test-key", publicKey: key.publicKey }];
const opts = { trustedKeys: trusted, aegisVersion: "1.0.0", currentVersion: "0.1.0" };
const sign = async (over: Partial<BundleManifest> = {}) =>
  JSON.stringify(signBundle(await manifest(over), key.privatePem));

describe("bundle verification", () => {
  it("accepts a correctly signed, newer, compatible bundle", async () => {
    const r = verifyBundle(await sign(), opts);
    expect(r.ok).toBe(true);
  });

  it("rejects any change to a signed bundle", async () => {
    const doc = JSON.parse(await sign()) as { manifest: BundleManifest };
    const tampered = (f: (m: BundleManifest) => void) => {
      const copy = structuredClone(doc);
      f(copy.manifest);
      return verifyBundle(JSON.stringify(copy), opts);
    };
    for (const change of [
      (m: BundleManifest) => (m.rules[0]!.content += "\n# injected"),
      (m: BundleManifest) => (m.bundleVersion = "9.9.9"),
      (m: BundleManifest) => (m.minAegisVersion = "0.0.1"),
      (m: BundleManifest) => m.rules.pop(),
    ]) {
      const r = tampered(change);
      expect(r.ok).toBe(false);
      expect(!r.ok && r.code).toBe("bad-signature");
    }
  });

  it("does not trust a key it was not given, or a signature from the wrong key", async () => {
    const other = generateSigningKey();
    const wrongKey = JSON.stringify(signBundle(await manifest(), other.privatePem));
    const bad = verifyBundle(wrongKey, opts);
    expect(!bad.ok && bad.code).toBe("bad-signature");
    const unknown = verifyBundle(await sign({ keyId: "someone-else" }), opts);
    expect(!unknown.ok && unknown.code).toBe("unknown-key");
    const none = verifyBundle(await sign(), { ...opts, trustedKeys: [] });
    expect(!none.ok && none.code).toBe("unknown-key");
  });

  it("a checksum is not authenticity: re-signing with an attacker's key does not help", async () => {
    const attacker = generateSigningKey();
    const forged = signBundle(await manifest({ keyId: "test-key" }), attacker.privatePem);
    expect(verifyBundle(JSON.stringify(forged), opts).ok).toBe(false);
  });

  it("refuses replays, downgrades and incompatible bundles", async () => {
    const same = verifyBundle(await sign({ bundleVersion: "0.1.0" }), opts);
    expect(!same.ok && same.code).toBe("same-version");
    const older = verifyBundle(await sign({ bundleVersion: "0.0.9" }), opts);
    expect(!older.ok && older.code).toBe("not-newer");
    const tooNew = verifyBundle(await sign({ minAegisVersion: "2.0.0" }), opts);
    expect(!tooNew.ok && tooNew.code).toBe("incompatible");
  });

  it("rejects malformed input safely", async () => {
    const good = JSON.parse(await sign()) as Record<string, unknown>;
    const cases: unknown[] = [
      "not json",
      "[]",
      { ...good, extra: 1 },
      { ...good, format: "other" },
      { ...good, signature: "short" },
      {
        ...good,
        manifest: { ...(good.manifest as object), rules: [{ path: "../evil.yaml", content: "x" }] },
      },
      {
        ...good,
        manifest: {
          ...(good.manifest as object),
          rules: [{ path: "security/AEGIS-SEC-0001.sh", content: "x" }],
        },
      },
      { ...good, manifest: { ...(good.manifest as object), rules: [] } },
    ];
    for (const c of cases) {
      const r = verifyBundle(typeof c === "string" ? c : JSON.stringify(c), opts);
      expect(r.ok).toBe(false);
      expect(!r.ok && r.code).toBe("malformed");
    }
    const huge = verifyBundle("x".repeat(5 * 1024 * 1024 + 1), opts);
    expect(!huge.ok && huge.code).toBe("too-large");
  });

  it("only signs with an Ed25519 key, and canonical JSON ignores key order", async () => {
    const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 })
      .privateKey.export({ type: "pkcs8", format: "pem" })
      .toString();
    expect(() => signBundle({ ...({} as BundleManifest) }, rsa)).toThrow();
    await expect(async () => signBundle(await manifest(), rsa)).rejects.toThrow("Ed25519");
    expect(canonicalize({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe(
      canonicalize({ a: [2, { c: 2, d: 1 }], b: 1 }),
    );
    expect([
      compareSemver("1.2.3", "1.10.0"),
      compareSemver("2.0.0", "2.0.0"),
      compareSemver("0.1.1", "0.1.0"),
    ]).toEqual([-1, 0, 1]);
  });
});

describe("staging, activation and use", () => {
  const baseline = { dir: dataDir, version: "0.1.0" };

  it("a valid bundle stages cleanly, activates, and is then used instead of the baseline", async () => {
    await withTempDir(async (root) => {
      expect((await resolveRulesInUse(root, baseline)).source).toBe("baseline");
      const staged = await stageBundle(root, await manifest());
      expect(staged.load.diagnostics).toEqual([]);
      await activateStaged(root, staged);
      const use = await resolveRulesInUse(root, baseline);
      expect(use).toMatchObject({ source: "installed", version: "0.2.0", keyId: "test-key" });
      expect(use.dir).toBe(path.join(root, ".aegis/rules"));
      expect(
        (await readdir(path.join(root, ".aegis"))).filter(
          (n) => n.includes("tmp") || n.includes("prev"),
        ),
      ).toEqual([]);
    });
  });

  it("rules that fail normal validation are caught at staging, even when correctly signed", async () => {
    await withTempDir(async (root) => {
      const rules = await bundledRules();
      const first = rules[0]!;
      // right place, but the content is some other rule's id: file name no longer matches
      const bad = { ...first, content: first.content.replace(/^id: .*$/m, "id: AEGIS-SEC-0099") };
      const staged = await stageBundle(root, await manifest({ rules: [bad, ...rules.slice(1)] }));
      expect(staged.load.diagnostics.length).toBeGreaterThan(0);
      await discardStaged(staged);
      expect(await readdir(path.join(root, ".aegis"))).toEqual([]);
    });
  });

  it("a replacement keeps the old rules until the new ones are in place, and replaces them", async () => {
    await withTempDir(async (root) => {
      await activateStaged(
        root,
        await stageBundle(root, await manifest({ bundleVersion: "0.2.0" })),
      );
      await activateStaged(
        root,
        await stageBundle(root, await manifest({ bundleVersion: "0.3.0" })),
      );
      expect((await resolveRulesInUse(root, baseline)).version).toBe("0.3.0");
    });
  });

  it("falls back to the baseline, with a reason, when the installed rules were changed or are not newer", async () => {
    await withTempDir(async (root) => {
      await activateStaged(root, await stageBundle(root, await manifest()));
      const file = path.join(root, ".aegis/rules/security/AEGIS-SEC-0001.yaml");
      await writeFile(file, (await readFile(file, "utf8")) + "\n# edited\n");
      const use = await resolveRulesInUse(root, baseline);
      expect(use.source).toBe("baseline");
      expect(use.warning).toContain("changed after installation");
    });
    await withTempDir(async (root) => {
      await activateStaged(
        root,
        await stageBundle(root, await manifest({ bundleVersion: "0.1.0" })),
      );
      const use = await resolveRulesInUse(root, baseline);
      expect(use.source).toBe("baseline");
      expect(use.warning).toContain("not newer");
      expect((await resolveRulesInUse(root, { ...baseline, version: "0.0.1" })).source).toBe(
        "installed",
      );
    });
  });
});
