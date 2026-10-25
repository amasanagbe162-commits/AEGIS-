import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
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

  it("with a scanner that finds a secret it blocks (exit 2), stops after the attempt limit, and stores only a number", async () => {
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
  });
});
