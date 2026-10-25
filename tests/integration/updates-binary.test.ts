import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const bin = path.join(root, "packages/cli/bin/aegis.js");

function aegis(
  args: string[],
  cwd: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [bin, ...args], { cwd, env: { PATH: "" } });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("aegis did not finish in time"));
    }, 30_000);
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
    child.stdin.end();
  });
}

const made: string[] = [];
afterEach(async () => {
  for (const d of made.splice(0)) await rm(d, { recursive: true, force: true });
});

describe("signed rule updates through the built binary", () => {
  it("keygen -> bundle -> verify -> install, then refuses a tampered copy", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "aegis-upd-bin-"));
    made.push(dir);
    const pub = path.join(dir, "publisher");
    const proj = path.join(dir, "project");
    await mkdir(pub);
    await mkdir(proj);
    await writeFile(path.join(proj, "package.json"), "{}");

    const kg = await aegis(["rules", "keygen", "--out-dir", ".", "--key-id", "e2e-key"], pub);
    expect(kg.code).toBe(0);
    const key = JSON.parse(kg.stdout.slice(kg.stdout.indexOf("{"))) as {
      id: string;
      publicKey: string;
    };

    const b = await aegis(
      [
        "rules",
        "bundle",
        "--key",
        "e2e-key.private.pem",
        "--key-id",
        "e2e-key",
        "--bundle-version",
        "0.2.0",
        "--out",
        "b.json",
      ],
      pub,
    );
    expect(b.code).toBe(0);

    await writeFile(
      path.join(proj, "aegis.config.json"),
      JSON.stringify({ version: 1, updates: { enabled: true, trustedKeys: [key] } }),
    );
    const bundle = path.join(pub, "b.json");
    const ok = await aegis(["rules", "update", "--source", bundle, "--yes"], proj);
    expect(ok.code).toBe(0);
    expect(ok.stdout).toContain("Verified: rules 0.2.0, signed by key 'e2e-key'");
    expect((await aegis(["rules", "status"], proj)).stdout).toContain("installed 0.2.0");
    expect((await aegis(["scan"], proj)).stdout).toContain("INCOMPLETE");

    const doc = JSON.parse(await readFile(bundle, "utf8")) as {
      manifest: { bundleVersion: string };
    };
    doc.manifest.bundleVersion = "0.3.0";
    await writeFile(path.join(pub, "t.json"), JSON.stringify(doc));
    const bad = await aegis(
      ["rules", "update", "--source", path.join(pub, "t.json"), "--yes"],
      proj,
    );
    expect(bad.code).toBe(2);
    expect(bad.stderr).toContain("signature does not match");
  });
});
