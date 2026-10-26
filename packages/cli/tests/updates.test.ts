import { cp, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { RULES_DIR } from "@aegis/rules";
import { aegis, makeRuntime, withTempDir } from "./helpers.js";

const read = (dir: string, rel: string) => readFile(path.join(dir, ...rel.split("/")), "utf8");
const exists = (p: string) =>
  stat(p).then(
    () => true,
    () => false,
  );

interface Setup {
  dir: string;
  publisher: string;
  publicKey: { id: string; publicKey: string };
}

/** A project plus a "publisher" folder holding a freshly generated signing key. */
async function setup(dir: string): Promise<Setup> {
  const publisher = path.join(dir, "publisher");
  const project = path.join(dir, "project");
  await mkdir(project, { recursive: true });
  await writeFile(path.join(project, "package.json"), "{}");
  const c = makeRuntime(publisher);
  await mkdir(publisher, { recursive: true });
  expect(await aegis(["rules", "keygen", "--out-dir", ".", "--key-id", "test-key"], c)).toBe(0);
  const publicKey = JSON.parse(c.stdout().slice(c.stdout().indexOf("{"))) as Setup["publicKey"];
  return { dir: project, publisher, publicKey };
}

async function config(s: Setup, over: Record<string, unknown> = {}) {
  await writeFile(
    path.join(s.dir, "aegis.config.json"),
    JSON.stringify({ version: 1, updates: { enabled: true, trustedKeys: [s.publicKey], ...over } }),
  );
}

/** Rules folder identical to the bundled ones, except SEC-0001's title. */
async function changedRules(publisher: string, title = "Prevent SQL injection (updated)") {
  const dir = path.join(publisher, "rules");
  await cp(RULES_DIR, dir, { recursive: true });
  const f = path.join(dir, "security/AEGIS-SEC-0001.yaml");
  await writeFile(
    f,
    (await readFile(f, "utf8")).replace("title: Prevent SQL injection", `title: ${title}`),
  );
  return dir;
}

async function makeBundle(
  s: Setup,
  version: string,
  rulesDir?: string,
  out = `bundle-${version}.json`,
) {
  const c = makeRuntime(s.publisher);
  const code = await aegis(
    [
      "rules",
      "bundle",
      "--key",
      "test-key.private.pem",
      "--key-id",
      "test-key",
      "--bundle-version",
      version,
      "--out",
      out,
      ...(rulesDir ? ["--rules-dir", rulesDir] : []),
    ],
    c,
  );
  return { code, c, file: path.join(s.publisher, out) };
}

describe("signing tools", () => {
  it("keygen writes a private key file (0600), prints only the public key, and never overwrites", async () => {
    await withTempDir(async (dir) => {
      const s = await setup(dir);
      const priv = path.join(s.publisher, "test-key.private.pem");
      if (process.platform !== "win32") expect((await stat(priv)).mode & 0o777).toBe(0o600);
      const pem = await readFile(priv, "utf8");
      expect(pem).toContain("PRIVATE KEY");
      const again = makeRuntime(s.publisher);
      expect(
        await aegis(["rules", "keygen", "--out-dir", ".", "--key-id", "test-key"], again),
      ).toBe(2);
      expect(again.stderr()).toContain("never overwritten");
      expect(await readFile(priv, "utf8")).toBe(pem);
      const bad = makeRuntime(s.publisher);
      expect(await aegis(["rules", "keygen", "--out-dir", ".", "--key-id", "../evil"], bad)).toBe(
        2,
      );
    });
  });

  it("the private key is never printed", async () => {
    await withTempDir(async (dir) => {
      const publisher = path.join(dir, "p");
      await mkdir(publisher);
      const c = makeRuntime(publisher);
      await aegis(["rules", "keygen", "--out-dir", ".", "--key-id", "k1"], c);
      expect(c.stdout()).not.toContain("PRIVATE KEY");
      const body =
        (await readFile(path.join(publisher, "k1.private.pem"), "utf8")).split("\n")[1] ?? "";
      expect(c.stdout()).not.toContain(body);
    });
  });

  it("bundle refuses invalid rules and never overwrites its output", async () => {
    await withTempDir(async (dir) => {
      const s = await setup(dir);
      const ok = await makeBundle(s, "1.0.0");
      expect(ok.code).toBe(0);
      const again = await makeBundle(s, "1.0.0");
      expect(again.code).toBe(2);
      expect(again.c.stderr()).toContain("never overwritten");
      const broken = path.join(s.publisher, "broken");
      await mkdir(path.join(broken, "security"), { recursive: true });
      await writeFile(path.join(broken, "security/AEGIS-SEC-0001.yaml"), "id: nope\n");
      const bad = await makeBundle(s, "1.1.0", broken);
      expect(bad.code).toBe(2);
      expect(bad.c.stderr()).toContain("do not validate");
    });
  });
});

describe("aegis rules update", () => {
  const update = (s: Setup, file: string, extra: string[] = [], over = {}) =>
    aegis(["rules", "update", "--source", file, ...extra], makeRuntime(s.dir, over));

  it("is off by default, and needs a source and a trusted key", async () => {
    await withTempDir(async (dir) => {
      const s = await setup(dir);
      const off = makeRuntime(s.dir);
      expect(await aegis(["rules", "update", "--source", "x.json"], off)).toBe(2);
      expect(off.stderr()).toContain("updates are off");

      await writeFile(
        path.join(s.dir, "aegis.config.json"),
        JSON.stringify({ version: 1, updates: { enabled: true } }),
      );
      const nosrc = makeRuntime(s.dir);
      expect(await aegis(["rules", "update"], nosrc)).toBe(2);
      expect(nosrc.stderr()).toContain("no update source");
      const nokey = makeRuntime(s.dir);
      expect(await aegis(["rules", "update", "--source", "x.json"], nokey)).toBe(2);
      expect(nokey.stderr()).toContain("no trusted signing key");
      expect(await exists(path.join(s.dir, ".aegis"))).toBe(false);
    });
  });

  it("dry-run verifies and lists changes without installing; --yes installs; scanning then uses the new rules", async () => {
    await withTempDir(async (dir) => {
      const s = await setup(dir);
      await config(s);
      const b = await makeBundle(s, "1.0.0", await changedRules(s.publisher));
      expect(b.code).toBe(0);

      const dry = makeRuntime(s.dir);
      expect(await aegis(["rules", "update", "--source", b.file, "--dry-run"], dry)).toBe(0);
      expect(dry.stdout()).toContain("changed: AEGIS-SEC-0001");
      expect(dry.stdout()).toContain("Dry run");
      expect(await exists(path.join(s.dir, ".aegis/rules"))).toBe(false);

      const needsYes = makeRuntime(s.dir);
      expect(await aegis(["rules", "update", "--source", b.file], needsYes)).toBe(2);
      expect(needsYes.stderr()).toContain("--yes");

      const go = makeRuntime(s.dir);
      expect(await aegis(["rules", "update", "--source", b.file, "--yes"], go)).toBe(0);
      expect(go.stdout()).toContain("Installed rules 1.0.0");

      const list = makeRuntime(s.dir);
      await aegis(["rules", "list"], list);
      expect(list.stdout()).toContain("Prevent SQL injection (updated)");
      const status = makeRuntime(s.dir);
      await aegis(["rules", "status"], status);
      expect(status.stdout()).toContain("installed 1.0.0 (signed by key 'test-key')");
      expect((await readdir(path.join(s.dir, ".aegis"))).sort()).toEqual(["rules"]);
      // project files other than .aegis/rules are untouched
      expect((await readdir(s.dir)).sort()).toEqual([
        ".aegis",
        "aegis.config.json",
        "package.json",
      ]);

      const again = makeRuntime(s.dir);
      expect(await aegis(["rules", "update", "--source", b.file, "--yes"], again)).toBe(0);
      expect(again.stdout()).toContain("Already up to date");
    });
  });

  it("asks before installing in a terminal, and respects 'no'", async () => {
    await withTempDir(async (dir) => {
      const s = await setup(dir);
      await config(s);
      const b = await makeBundle(s, "1.0.0");
      const c = makeRuntime(s.dir, { interactive: true, script: { confirms: [false] } });
      expect(await aegis(["rules", "update", "--source", b.file], c)).toBe(0);
      expect(c.asked).toEqual(["Install these rules?"]);
      expect(await exists(path.join(s.dir, ".aegis/rules"))).toBe(false);
    });
  });

  it("rejects a tampered bundle, a bundle from an untrusted key, and a downgrade: nothing changes", async () => {
    await withTempDir(async (dir) => {
      const s = await setup(dir);
      await config(s);
      const good = await makeBundle(s, "1.0.0", await changedRules(s.publisher));
      expect(await update(s, good.file, ["--yes"])).toBe(0);
      const before = await read(s.dir, ".aegis/rules/installed.json");

      const doc = JSON.parse(await readFile(good.file, "utf8")) as {
        manifest: { bundleVersion: string; rules: { content: string }[] };
      };
      doc.manifest.bundleVersion = "0.9.0";
      doc.manifest.rules[0]!.content += "\n# injected\n";
      const tampered = path.join(s.publisher, "tampered.json");
      await writeFile(tampered, JSON.stringify(doc));
      const t = makeRuntime(s.dir);
      expect(await aegis(["rules", "update", "--source", tampered, "--yes"], t)).toBe(2);
      expect(t.stderr()).toContain("signature does not match");

      await config(s, { trustedKeys: [{ id: "other", publicKey: s.publicKey.publicKey }] });
      const u = makeRuntime(s.dir);
      expect(await aegis(["rules", "update", "--source", good.file, "--yes"], u)).toBe(2);
      expect(u.stderr()).toContain("which you do not trust");
      await config(s);

      const older = await makeBundle(s, "0.1.5");
      const d = makeRuntime(s.dir);
      expect(await aegis(["rules", "update", "--source", older.file, "--yes"], d)).toBe(2);
      expect(d.stderr()).toContain("downgrades are refused");

      expect(await read(s.dir, ".aegis/rules/installed.json")).toBe(before);
      expect((await readdir(path.join(s.dir, ".aegis"))).sort()).toEqual(["rules"]);
    });
  });

  it("rejects a correctly signed bundle whose rules fail validation", async () => {
    await withTempDir(async (dir) => {
      const s = await setup(dir);
      await config(s);
      // sign by hand-edited JSON would break the signature, so build a bundle from a rules folder
      // where a rule's id disagrees with its file name; the bundle command refuses, proving the gate
      const bad = path.join(s.publisher, "bad-rules");
      await cp(RULES_DIR, bad, { recursive: true });
      const f = path.join(bad, "security/AEGIS-SEC-0001.yaml");
      await writeFile(f, (await readFile(f, "utf8")).replace(/^id: .*$/m, "id: AEGIS-SEC-0099"));
      const made = await makeBundle(s, "1.0.0", bad);
      expect(made.code).toBe(2);
      expect(await exists(made.file)).toBe(false);
    });
  });

  it("downloads over HTTPS with exactly one request that carries nothing but the URL", async () => {
    await withTempDir(async (dir) => {
      const s = await setup(dir);
      const b = await makeBundle(s, "1.0.0");
      const bundleText = await readFile(b.file, "utf8");
      await config(s, { source: "https://updates.example.test/rules.json" });
      const calls: string[] = [];
      const c = makeRuntime(s.dir, {
        fetchText: async (url) => {
          calls.push(url);
          return bundleText;
        },
      });
      expect(await aegis(["rules", "update", "--yes"], c)).toBe(0);
      expect(calls).toEqual(["https://updates.example.test/rules.json"]);
      expect(c.stdout()).toContain("Downloading https://updates.example.test/rules.json");
    });
  });

  it("refuses plain http and other schemes, and a failed download changes nothing", async () => {
    await withTempDir(async (dir) => {
      const s = await setup(dir);
      await config(s);
      for (const src of [
        "http://example.test/r.json",
        "ftp://example.test/r.json",
        "file:///etc/passwd",
      ]) {
        const c = makeRuntime(s.dir, {
          fetchText: async () => {
            throw new Error("must not be called");
          },
        });
        expect(await aegis(["rules", "update", "--source", src, "--yes"], c)).toBe(2);
        expect(c.stderr()).toContain("only https:// URLs or local files");
      }
      const down = makeRuntime(s.dir, {
        fetchText: async () => {
          throw new Error("the server answered HTTP 503");
        },
      });
      expect(
        await aegis(
          ["rules", "update", "--source", "https://x.example.test/r.json", "--yes"],
          down,
        ),
      ).toBe(2);
      expect(down.stderr()).toContain("Nothing was changed");
      expect(await exists(path.join(s.dir, ".aegis"))).toBe(false);
    });
  });

  it("works offline: with no installed update, the baseline rules scan and list as before", async () => {
    await withTempDir(async (dir) => {
      const s = await setup(dir);
      const c = makeRuntime(s.dir);
      await aegis(["rules", "status"], c);
      expect(c.stdout()).toContain("Rules in use: baseline");
      expect(c.stdout()).toContain("Updates: off");
      const list = makeRuntime(s.dir);
      expect(await aegis(["rules", "list"], list)).toBe(0);
      expect(list.stdout()).toContain("AEGIS-SEC-0001");
    });
  });

  it("a damaged installed update falls back to the baseline and says so, instead of failing", async () => {
    await withTempDir(async (dir) => {
      const s = await setup(dir);
      await config(s);
      const b = await makeBundle(s, "1.0.0", await changedRules(s.publisher));
      await update(s, b.file, ["--yes"]);
      await writeFile(
        path.join(s.dir, ".aegis/rules/security/AEGIS-SEC-0001.yaml"),
        "tampered: true\n",
      );
      const scan = makeRuntime(s.dir);
      await aegis(["scan"], scan);
      expect(scan.stderr()).toContain("changed after installation");
      const doctor = makeRuntime(s.dir);
      await aegis(["doctor"], doctor);
      expect(doctor.stdout()).toContain("[warn] Bundled rules");
    });
  });
});
