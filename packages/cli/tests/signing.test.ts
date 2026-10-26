import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { aegis, makeRuntime, withTempDir } from "./helpers.js";

/** A "trusted machine" folder with a fresh key, and a bundle signed with it. */
async function signed(dir: string, version = "1.0.0") {
  const keys = path.join(dir, "keys");
  await mkdir(keys, { recursive: true });
  const kg = makeRuntime(keys);
  expect(await aegis(["rules", "keygen", "--out-dir", ".", "--key-id", "official-test"], kg)).toBe(
    0,
  );
  const pub = JSON.parse(kg.stdout().slice(kg.stdout().indexOf("{"))) as {
    id: string;
    publicKey: string;
  };
  const out = path.join(dir, "bundle.json");
  const b = makeRuntime(dir);
  expect(
    await aegis(
      [
        "rules",
        "bundle",
        "--key",
        path.join(keys, "official-test.private.pem"),
        "--key-id",
        "official-test",
        "--bundle-version",
        version,
        "--out",
        out,
      ],
      b,
    ),
  ).toBe(0);
  return { keys, pub, out, trust: `${pub.id}=${pub.publicKey}` };
}

describe("aegis rules check-bundle (what the release workflow runs)", () => {
  it("accepts a bundle signed by a trusted key and says what it checked", async () => {
    await withTempDir(async (dir) => {
      const s = await signed(dir);
      const c = makeRuntime(dir);
      expect(await aegis(["rules", "check-bundle", s.out, "--trust", s.trust], c)).toBe(0);
      expect(c.stdout()).toContain("OK: bundle 1.0.0 is signed by trusted key 'official-test'");
      expect(c.stdout()).toContain("6 rules validate");
    });
  });

  it("with no built-in key and no --trust it refuses to say anything is fine", async () => {
    await withTempDir(async (dir) => {
      const s = await signed(dir);
      const c = makeRuntime(dir);
      expect(await aegis(["rules", "check-bundle", s.out], c)).toBe(2);
      expect(c.stderr()).toContain("no trusted signing key");
    });
  });

  it("rejects a tampered bundle, a different key, and malformed --trust values", async () => {
    await withTempDir(async (dir) => {
      const s = await signed(dir);
      const doc = JSON.parse(await readFile(s.out, "utf8")) as {
        manifest: { rules: { content: string }[] };
      };
      doc.manifest.rules[0]!.content += "\n# injected\n";
      const tampered = path.join(dir, "tampered.json");
      await writeFile(tampered, JSON.stringify(doc));
      const t = makeRuntime(dir);
      expect(await aegis(["rules", "check-bundle", tampered, "--trust", s.trust], t)).toBe(2);
      expect(t.stderr()).toContain("signature does not match");

      const other = await signed(path.join(dir, "other"), "1.0.0").catch(async () => {
        await mkdir(path.join(dir, "other"), { recursive: true });
        return signed(path.join(dir, "other"), "1.0.0");
      });
      const wrong = makeRuntime(dir);
      expect(await aegis(["rules", "check-bundle", s.out, "--trust", other.trust], wrong)).toBe(2);
      expect(wrong.stderr()).toContain("signature does not match");

      const bad = makeRuntime(dir);
      expect(await aegis(["rules", "check-bundle", s.out, "--trust", "no-equals-sign"], bad)).toBe(
        2,
      );
      expect(bad.stderr()).toContain("--trust must look like");
    });
  });

  it("changes nothing on disk", async () => {
    await withTempDir(async (dir) => {
      const s = await signed(dir);
      const before = (await readdir(dir)).sort();
      await aegis(["rules", "check-bundle", s.out, "--trust", s.trust], makeRuntime(dir));
      expect((await readdir(dir)).sort()).toEqual(before);
    });
  });
});

describe("the private signing key is protected from being committed", () => {
  it("keygen refuses to write inside a Git repository unless explicitly forced", async () => {
    await withTempDir(async (dir) => {
      await mkdir(path.join(dir, ".git"));
      const inside = path.join(dir, "some", "folder");
      const c = makeRuntime(dir);
      expect(await aegis(["rules", "keygen", "--out-dir", inside, "--key-id", "k1"], c)).toBe(2);
      expect(c.stderr()).toContain("inside the Git repository");
      await expect(readdir(inside)).rejects.toThrow();

      const forced = makeRuntime(dir);
      expect(
        await aegis(
          ["rules", "keygen", "--out-dir", inside, "--key-id", "k1", "--allow-in-repo"],
          forced,
        ),
      ).toBe(0);
      expect(await readdir(inside)).toEqual(["k1.private.pem"]);
    });
  });
});
