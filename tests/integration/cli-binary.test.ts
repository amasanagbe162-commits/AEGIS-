import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { beforeAll, describe, expect, it } from "vitest";

const exec = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const bin = path.join(root, "packages/cli/bin/aegis.js");

/** Runs the real, built `aegis` binary in a child process. */
async function aegis(
  args: string[],
  cwd = root,
): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await exec(process.execPath, [bin, ...args], {
      cwd,
      timeout: 30_000,
    });
    return { code: 0, stdout, stderr };
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string };
    return {
      code: typeof e.code === "number" ? e.code : -1,
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? "",
    };
  }
}

beforeAll(() => {
  if (!existsSync(path.join(root, "packages/cli/dist/main.js")))
    throw new Error("The CLI is not built. Run 'npm run build' (npm test does this for you).");
});

describe("built aegis binary", () => {
  it("starts with a node shebang", () => {
    expect(readFileSync(bin, "utf8").startsWith("#!/usr/bin/env node")).toBe(true);
  });

  it("prints its package version", async () => {
    const pkg = JSON.parse(readFileSync(path.join(root, "packages/cli/package.json"), "utf8")) as {
      version: string;
    };
    const r = await aegis(["--version"]);
    expect(r.code).toBe(0);
    expect(r.stdout.trim()).toBe(pkg.version);
  });

  it("scans a fixture project: exit code 3, report on stdout, nothing on stderr", async () => {
    const r = await aegis(["scan", "tests/fixtures/nextjs-sample"]);
    expect(r.code).toBe(3);
    expect(r.stdout).toContain("INCOMPLETE");
    expect(r.stdout).toContain("next.js (high)");
    expect(r.stderr).toBe("");
  });

  it("emits JSON that parses", async () => {
    const r = await aegis(["scan", "tests/fixtures/python-sample", "--format", "json"]);
    expect(r.code).toBe(3);
    expect((JSON.parse(r.stdout) as { verdict: string }).verdict).toBe("incomplete");
  });

  it("returns exit code 2 and a message for bad input", async () => {
    const r = await aegis(["scan", "--level", "paranoid"]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("Allowed choices");
  });

  it("init refuses to write without a terminal or --yes, then works with --yes and keeps files on a rerun", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "aegis-bin-"));
    try {
      await writeFile(path.join(dir, "package.json"), "{}");
      const refused = await aegis(["init"], dir);
      expect(refused.code).toBe(2);
      expect(existsSync(path.join(dir, "AEGIS.aegis"))).toBe(false);

      const created = await aegis(["init", "--yes", "--level", "standard"], dir);
      expect(created.code).toBe(0);
      const before = await readFile(path.join(dir, "AEGIS.aegis"), "utf8");

      await writeFile(path.join(dir, "AEGIS.aegis"), before + "# edited by me\n");
      const again = await aegis(["init", "--yes"], dir);
      expect(again.stdout).toContain("keep    AEGIS.aegis");
      expect(await readFile(path.join(dir, "AEGIS.aegis"), "utf8")).toBe(
        before + "# edited by me\n",
      );

      expect((await aegis(["doctor"], dir)).code).toBe(0);
      expect((await aegis(["rules", "validate"], dir)).code).toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
