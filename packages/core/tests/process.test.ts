import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findExecutable, runProcess, sanitizeEnv, type RunOptions } from "../src/index.js";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "aegis-proc-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const node = process.execPath;

/** A killed process that nobody has reaped yet (a zombie, state Z) counts as dead. */
async function isAlive(pid: number): Promise<boolean> {
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  try {
    const stat = await readFile(`/proc/${pid}/stat`, "utf8");
    return stat.slice(stat.lastIndexOf(")") + 2, stat.lastIndexOf(")") + 3) !== "Z";
  } catch {
    return true; // no /proc: it answered kill(0), so assume it is alive
  }
}
const base = (over: Partial<RunOptions>): RunOptions => ({
  command: node,
  args: [],
  cwd: dir,
  timeoutMs: 10_000,
  maxOutputBytes: 1024 * 1024,
  env: { PATH: process.env.PATH ?? "" },
  ...over,
});

describe("runProcess", () => {
  it("captures output and the exit code", async () => {
    const r = await runProcess(
      base({ args: ["-e", "console.log('out'); console.error('err'); process.exit(3)"] }),
    );
    expect(r).toEqual({ kind: "exited", exitCode: 3, stdout: "out\n", stderr: "err\n" });
  });

  it("passes arguments literally, with no shell interpretation", async () => {
    const nasty = [
      "a b",
      "$(touch pwned)",
      "; touch pwned",
      "`touch pwned`",
      "x && touch pwned",
      "*",
      "'q'",
      '"d"',
    ];
    const r = await runProcess(
      base({ args: ["-e", "console.log(JSON.stringify(process.argv.slice(1)))", ...nasty] }),
    );
    expect(r.kind).toBe("exited");
    if (r.kind === "exited") expect(JSON.parse(r.stdout)).toEqual(nasty);
    await expect(readFile(path.join(dir, "pwned"))).rejects.toThrow();
  });

  it("runs in the given working directory", async () => {
    const r = await runProcess(base({ args: ["-e", "console.log(process.cwd())"] }));
    expect(
      r.kind === "exited" && (await import("node:fs/promises")).realpath(r.stdout.trim()),
    ).toBeTruthy();
    if (r.kind === "exited") {
      const { realpath } = await import("node:fs/promises");
      expect(await realpath(r.stdout.trim())).toBe(await realpath(dir));
    }
  });

  it("stops a process that exceeds the timeout", async () => {
    const started = Date.now();
    const r = await runProcess(base({ args: ["-e", "setTimeout(()=>{}, 60000)"], timeoutMs: 300 }));
    expect(r.kind).toBe("timeout");
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it.skipIf(process.platform === "win32")(
    "also stops child processes of a timed-out process",
    async () => {
      const pidFile = path.join(dir, "grandchild.pid");
      const script = `
      const { spawn } = require("node:child_process");
      const c = spawn(process.execPath, ["-e", "setTimeout(()=>{}, 60000)"], { stdio: "ignore" });
      require("node:fs").writeFileSync(${JSON.stringify(pidFile)}, String(c.pid));
      setTimeout(()=>{}, 60000);`;
      const r = await runProcess(base({ args: ["-e", script], timeoutMs: 800 }));
      expect(r.kind).toBe("timeout");
      const pid = Number(await readFile(pidFile, "utf8"));
      await new Promise((res) => setTimeout(res, 300));
      expect(await isAlive(pid)).toBe(false);
    },
  );

  it("stops a process that prints too much", async () => {
    const r = await runProcess(
      base({
        args: ["-e", "for(;;) process.stdout.write('x'.repeat(65536))"],
        maxOutputBytes: 100_000,
      }),
    );
    expect(r).toEqual({ kind: "output-limit", stream: "stdout" });
  });

  it("reports a program that cannot be started", async () => {
    const r = await runProcess(base({ command: path.join(dir, "does-not-exist") }));
    expect(r.kind).toBe("spawn-error");
  });

  it("does not let the child see secrets from the parent environment", async () => {
    const r = await runProcess(
      base({
        args: ["-e", "console.log(JSON.stringify(Object.keys(process.env).sort()))"],
        env: {
          PATH: process.env.PATH ?? "",
          GITHUB_TOKEN: "x",
          AWS_SECRET_ACCESS_KEY: "x",
          SEMGREP_APP_TOKEN: "x",
          NODE_OPTIONS: "--require /tmp/evil.js",
          LC_ALL: "C",
          NODE_EXTRA_CA_CERTS: "/etc/ca.pem",
          npm_config_registry: "https://registry.example",
        },
      }),
    );
    expect(r.kind).toBe("exited");
    if (r.kind === "exited") {
      const keys = JSON.parse(r.stdout) as string[];
      for (const secret of [
        "GITHUB_TOKEN",
        "AWS_SECRET_ACCESS_KEY",
        "SEMGREP_APP_TOKEN",
        "NODE_OPTIONS",
      ]) {
        expect(keys).not.toContain(secret);
      }
      expect(keys).toEqual(
        expect.arrayContaining(["PATH", "LC_ALL", "NODE_EXTRA_CA_CERTS", "npm_config_registry"]),
      );
    }
  });
});

describe("sanitizeEnv", () => {
  it("keeps only allowlisted variables", () => {
    const out = sanitizeEnv({ PATH: "/bin", HOME: "/h", FOO: "1", TOKEN: "t", HTTPS_PROXY: "p" });
    expect(Object.keys(out).sort()).toEqual(["HOME", "HTTPS_PROXY", "PATH"]);
  });
});

describe("findExecutable", () => {
  it("finds a runnable file on an absolute PATH entry without running it", async () => {
    const marker = path.join(dir, "ran");
    const tool = path.join(dir, "mytool");
    await writeFile(tool, `#!/bin/sh\ntouch "${marker}"\n`, { mode: 0o755 });
    expect(await findExecutable("mytool", { PATH: dir })).toBe(tool);
    await expect(readFile(marker)).rejects.toThrow();
  });

  it("ignores non-executable files, relative PATH entries and names containing path separators", async () => {
    await writeFile(path.join(dir, "plain"), "x", { mode: 0o644 });
    expect(await findExecutable("plain", { PATH: dir })).toBeUndefined();
    await writeFile(path.join(dir, "tool"), "#!/bin/sh\n", { mode: 0o755 });
    expect(await findExecutable("tool", { PATH: "." })).toBeUndefined();
    expect(await findExecutable("../tool", { PATH: dir })).toBeUndefined();
    expect(await findExecutable(path.join(dir, "tool"), { PATH: dir })).toBeUndefined();
  });
});
