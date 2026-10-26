import { spawn } from "node:child_process";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { existsSync } from "node:fs";
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const bin = path.join(root, "packages/cli/bin/aegis.js");

interface Result {
  code: number;
  stdout: string;
  stderr: string;
}

/** Run the real, built binary. `pathDirs` is the whole PATH: the test decides which tools exist. */
function aegis(
  args: string[],
  cwd: string,
  opts: { stdin?: string; pathDirs?: string[] } = {},
): Promise<Result> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [bin, ...args], {
      cwd,
      env: { PATH: (opts.pathDirs ?? []).join(path.delimiter) },
    });
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
    child.stdin.end(opts.stdin ?? "");
  });
}

const made: string[] = [];
async function tempProject(files: Record<string, string> = {}): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "aegis-agents-bin-"));
  made.push(dir);
  await writeFile(path.join(dir, "package.json"), JSON.stringify({ name: "demo" }));
  for (const [name, text] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(dir, name)), { recursive: true });
    await writeFile(path.join(dir, name), text);
  }
  return dir;
}

beforeAll(() => {
  if (!existsSync(path.join(root, "packages/cli/dist/main.js")))
    throw new Error("The CLI is not built. Run 'npm run build' (npm test does this for you).");
});
afterEach(async () => {
  for (const d of made.splice(0)) await rm(d, { recursive: true, force: true });
});

describe("agents commands through the built binary", () => {
  it("sync installs every agent file, verify passes, and a second sync changes nothing", async () => {
    const dir = await tempProject({ "CLAUDE.md": "# mine\n" });
    const sync = await aegis(
      ["agents", "sync", "--yes", "--agent", "claude-code", "github-copilot", "codex", "chatgpt"],
      dir,
    );
    expect(sync.code).toBe(0);
    expect(sync.stderr).toBe("");
    expect(await readFile(path.join(dir, "CLAUDE.md"), "utf8")).toBe("# mine\n");

    const verify = await aegis(
      ["agents", "verify", "--agent", "claude-code", "github-copilot", "codex", "chatgpt"],
      dir,
    );
    expect(verify.code).toBe(0);
    expect(verify.stdout).toContain("[current] .claude/rules/aegis.md");

    const again = await aegis(["agents", "sync", "--yes", "--agent", "claude-code", "codex"], dir);
    expect(again.stdout).toContain("Nothing to write");
  });

  it("generated files contain no absolute paths from this machine", async () => {
    const dir = await tempProject();
    await aegis(
      ["agents", "sync", "--yes", "--agent", "claude-code", "github-copilot", "codex", "chatgpt"],
      dir,
    );
    for (const f of [
      ".claude/rules/aegis.md",
      ".github/instructions/aegis.instructions.md",
      "AGENTS.md",
      ".aegis/chatgpt-instructions.md",
    ]) {
      const text = await readFile(path.join(dir, f), "utf8");
      expect(text).not.toContain(dir);
      expect(text).not.toContain(os.homedir());
    }
  });
});

describe("Claude Code Stop hook through the built binary", () => {
  it("with no scanners installed it lets Claude finish and says the result is INCOMPLETE", async () => {
    const dir = await tempProject();
    const r = await aegis(["hook", "claude-stop"], dir, {
      stdin: JSON.stringify({
        session_id: "e2e-1",
        cwd: dir,
        hook_event_name: "Stop",
        stop_hook_active: false,
      }),
    });
    expect(r.code).toBe(0);
    const out = JSON.parse(r.stdout.trim()) as { systemMessage: string };
    expect(out.systemMessage).toContain("INCOMPLETE");
    expect(out.systemMessage).toContain("not a clean result");
  });

  it("fails open (exit 1) on garbage, empty input and an array", async () => {
    const dir = await tempProject();
    for (const stdin of ["not json", "", "[]"]) {
      const r = await aegis(["hook", "claude-stop"], dir, { stdin });
      expect(r.code).toBe(1);
      expect(r.stderr).toContain("nothing was verified");
    }
  });

  it.skipIf(process.platform === "win32")(
    "with a scanner that finds a secret it blocks (exit 2), stops after the attempt limit, and stores only a number",
    async () => {
      const dir = await tempProject({
        "aegis.config.json": JSON.stringify({
          version: 1,
          protectionLevel: "advanced",
          selfCorrection: { maxAttempts: 2 },
        }),
        "src/config.js": "// nothing real here\n",
      });
      // A stand-in for gitleaks: same command line, reports one leak in src/config.js (a made-up value).
      const bin2 = await mkdtemp(path.join(os.tmpdir(), "aegis-fakebin-"));
      made.push(bin2);
      const fake = path.join(bin2, "gitleaks");
      await writeFile(
        fake,
        '#!/bin/sh\nprintf \'[{"RuleID":"generic-api-key","File":"%s/src/config.js","StartLine":3}]\' "$2"\nexit 1\n',
      );
      await chmod(fake, 0o755);

      const input = JSON.stringify({ session_id: "e2e-2", cwd: dir, stop_hook_active: false });
      const hook = () => aegis(["hook", "claude-stop"], dir, { stdin: input, pathDirs: [bin2] });

      const first = await hook();
      expect(first.code).toBe(2);
      expect(first.stderr).toContain("Possible secret detected (generic-api-key)");
      expect(first.stderr).toContain("src/config.js:3");
      expect(first.stderr).toContain("attempt 1 of 2");
      expect(first.stderr).not.toContain(dir);

      expect((await hook()).code).toBe(2);
      const last = await hook();
      expect(last.code).toBe(0);
      expect(last.stdout).toContain("unresolved after 2 attempt(s)");

      const state = await readdir(path.join(dir, ".aegis/state"));
      for (const f of state.filter((n) => n.endsWith(".json"))) {
        expect(JSON.parse(await readFile(path.join(dir, ".aegis/state", f), "utf8"))).toEqual({
          attempts: 0,
        });
      }
    },
  );
});

// POSIX shell and symbolic links: not run on Windows (see docs/acceptance.md).
describe.skipIf(process.platform === "win32")(
  "the exact command AEGIS registers as the Claude Code hook",
  () => {
    const command = "npx --no-install aegis hook claude-stop";
    const nodeDir = path.dirname(process.execPath);

    /**
     * A plain hook environment: only what a shell needs, plus the certificate and npm settings this
     * machine needs to reach the registry. Nothing inherited from the test runner.
     */
    const cleanEnv = () =>
      Object.fromEntries(
        [
          "NODE_EXTRA_CA_CERTS",
          "SSL_CERT_FILE",
          "REQUESTS_CA_BUNDLE",
          "NPM_CONFIG_USERCONFIG",
          "HTTPS_PROXY",
          "HTTP_PROXY",
          "NO_PROXY",
        ]
          .filter((k) => process.env[k] !== undefined)
          .map((k) => [k, process.env[k] as string]),
      );

    /** Run a shell command line the way Claude Code does: through a shell, with the hook JSON on stdin. */
    function shell(
      cmd: string,
      cwd: string,
      stdin: string,
      extraEnv: Record<string, string> = {},
    ): Promise<{ code: number; stdout: string; stderr: string }> {
      return new Promise((resolve, reject) => {
        const child = spawn("sh", ["-c", cmd], {
          cwd,
          env: {
            ...cleanEnv(),
            PATH: `${nodeDir}:/usr/bin:/bin`,
            HOME: cwd,
            npm_config_cache: path.join(cwd, ".npm-cache"),
            npm_config_update_notifier: "false",
            ...extraEnv,
          },
        });
        let stdout = "";
        let stderr = "";
        const timer = setTimeout(() => {
          child.kill("SIGKILL");
          reject(new Error(`the command did not finish in time. stderr: ${stderr.slice(0, 600)}`));
        }, 30_000);
        child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
        child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
        child.on("close", (code) => {
          clearTimeout(timer);
          resolve({ code: code ?? -1, stdout, stderr });
        });
        child.stdin.end(stdin);
      });
    }

    it("runs the locally installed AEGIS through npx, the way the generated settings.json says", async () => {
      const dir = await tempProject();
      await mkdir(path.join(dir, "node_modules/.bin"), { recursive: true });
      await symlink(bin, path.join(dir, "node_modules/.bin/aegis")); // what 'npm install' does for a package's bin
      const r = await shell(command, dir, JSON.stringify({ session_id: "npx-1", cwd: dir }));
      expect(r.stderr).toBe("");
      expect(r.code).toBe(0);
      expect(JSON.parse(r.stdout.trim())).toHaveProperty("systemMessage");
    });

    // A local stand-in for the npm registry that offers a "malicious" package called aegis. If npx ever
    // downloaded and ran it, the tarball would be requested and its script would write a marker file.
    it(
      "never downloads or runs another package named aegis when AEGIS is not installed",
      { timeout: 40_000 },
      async () => {
        const requests: string[] = [];
        const server = createServer((req, res) => {
          requests.push(`${req.method} ${req.url}`);
          if (req.url === "/aegis") {
            const port = (server.address() as AddressInfo).port;
            res.setHeader("content-type", "application/json");
            res.end(
              JSON.stringify({
                name: "aegis",
                "dist-tags": { latest: "9.9.9" },
                versions: {
                  "9.9.9": {
                    name: "aegis",
                    version: "9.9.9",
                    bin: { aegis: "run.js" },
                    dist: {
                      tarball: `http://127.0.0.1:${port}/aegis/-/aegis-9.9.9.tgz`,
                      integrity: "sha512-AAAA",
                    },
                  },
                },
              }),
            );
          } else {
            res.statusCode = 404;
            res.end("{}");
          }
        });
        await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
        try {
          const dir = await tempProject();
          const r = await shell(command, dir, JSON.stringify({ session_id: "npx-2", cwd: dir }), {
            npm_config_registry: `http://127.0.0.1:${(server.address() as AddressInfo).port}/`,
            npm_config_fetch_retries: "0",
            npm_config_update_notifier: "false",
          });
          expect(r.code).not.toBe(0);
          expect(r.stderr).toContain("npx canceled due to missing packages and no YES option");
          // npm may ask for METADATA about the name "aegis" (one GET), but must never fetch the package itself.
          expect(requests.filter((q) => !q.startsWith("GET "))).toEqual([]);
          expect(requests.filter((q) => q.includes(".tgz"))).toEqual([]);
          // ...and nothing is installed anywhere: not in the project, not in npx's own cache.
          await expect(access(path.join(dir, "node_modules"))).rejects.toThrow();
          const cached = await readdir(path.join(dir, ".npm-cache/_npx"), {
            recursive: true,
          }).catch(() => [] as string[]);
          expect(cached.filter((f) => /(^|\/)node_modules\/aegis(\/|$)/.test(String(f)))).toEqual(
            [],
          );
        } finally {
          await new Promise<void>((resolve) => server.close(() => resolve()));
        }
      },
    );
  },
);
