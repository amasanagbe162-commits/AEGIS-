import { execFile, spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Runs the REAL agent command-line tools (pinned versions, installed from npm into a temporary
 * folder) against files that AEGIS generated. None of them is given credentials, so these tests
 * check what can be checked WITHOUT a model: that settings are accepted, and that instruction files
 * are discovered and loaded. They cannot show that a model obeys the instructions.
 *
 * Needs network access to the npm registry. When it is unreachable the tests are skipped, and the
 * integration is then reported as untested rather than assumed to work.
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const aegisBin = path.join(root, "packages/cli/bin/aegis.js");
const VERSIONS = { claude: "2.1.310", codex: "0.164.0", copilot: "1.0.103" } as const;

const reachable = await fetch("https://registry.npmjs.org/-/ping", {
  signal: AbortSignal.timeout(8000),
}).then(
  (r) => r.ok,
  () => false,
);

interface Out {
  code: number;
  stdout: string;
  stderr: string;
}
function run(cmd: string, args: string[], cwd: string, env: Record<string, string>): Promise<Out> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, env: { PATH: process.env["PATH"] ?? "", ...env } });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${cmd} did not finish in time`));
    }, 60_000);
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
    child.stdin.end();
  });
}

let tools = "";
let home = "";
const made: string[] = [];
const env = () => ({
  HOME: home,
  CODEX_HOME: path.join(home, ".codex"),
  CLAUDE_CONFIG_DIR: path.join(home, ".claude-config"),
});
const bin = (name: string) => path.join(tools, "node_modules/.bin", name);

async function project(files: Record<string, string> = {}): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "aegis-cli-proj-"));
  made.push(dir);
  await run("git", ["init", "-q", "."], dir, {});
  await writeFile(path.join(dir, "package.json"), "{}");
  for (const [name, text] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(dir, name)), { recursive: true });
    await writeFile(path.join(dir, name), text);
  }
  return dir;
}
const sync = (dir: string, args: string[]) =>
  run(process.execPath, [aegisBin, "agents", "sync", "--yes", ...args], dir, {});

describe.skipIf(!reachable)(
  "real agent CLIs against AEGIS-generated files",
  { timeout: 300_000 },
  () => {
    beforeAll(async () => {
      tools = await mkdtemp(path.join(os.tmpdir(), "aegis-agent-tools-"));
      home = await mkdtemp(path.join(os.tmpdir(), "aegis-agent-home-"));
      made.push(tools, home);
      await mkdir(path.join(home, ".codex"), { recursive: true }); // Codex refuses to start without it
      await writeFile(
        path.join(tools, "package.json"),
        JSON.stringify({ name: "agent-tools", private: true }),
      );
      await new Promise<void>((resolve, reject) =>
        execFile(
          "npm",
          [
            "install",
            "--no-audit",
            "--no-fund",
            `@anthropic-ai/claude-code@${VERSIONS.claude}`,
            `@openai/codex@${VERSIONS.codex}`,
            `@github/copilot@${VERSIONS.copilot}`,
          ],
          { cwd: tools, timeout: 240_000 },
          (err) => (err ? reject(err) : resolve()),
        ),
      );
    }, 280_000);
    afterAll(async () => {
      for (const d of made.splice(0)) await rm(d, { recursive: true, force: true });
    });

    it("Claude Code accepts the Stop hook settings AEGIS writes, and the same check does reject a malformed hook", async () => {
      const dir = await project();
      expect((await sync(dir, ["--agent", "claude-code", "--hooks"])).code).toBe(0);
      const good = await run(
        bin("claude"),
        ["-p", "hi", "--settings", ".claude/settings.json"],
        dir,
        env(),
      );
      // Not logged in is expected: the point is that settings validation raised nothing.
      expect(good.stdout + good.stderr).toContain("Not logged in");
      expect(good.stdout + good.stderr).not.toMatch(
        /settings entries were skipped|Invalid settings|must be an array/i,
      );

      // Canary: proves the validation above is active, so the clean result is meaningful.
      await writeFile(
        path.join(dir, "bad.json"),
        JSON.stringify({ hooks: { Stop: "not-an-array" } }),
      );
      const bad = await run(bin("claude"), ["-p", "hi", "--settings", "bad.json"], dir, env());
      expect(bad.stdout + bad.stderr).toContain('Hook event "Stop" must be an array of matchers');
    });

    it("Codex loads the AEGIS block into the model-visible prompt, after the user's own AGENTS.md text", async () => {
      const mine = "# Team notes\n\nAlways use tabs.\n";
      const dir = await project({ "AGENTS.md": mine });
      expect((await sync(dir, ["--agent", "codex", "--merge-existing"])).code).toBe(0);
      expect(await readFile(path.join(dir, "AGENTS.md"), "utf8")).toContain("<!-- aegis:begin");
      const out = await run(bin("codex"), ["debug", "prompt-input", "hello"], dir, env());
      const text = out.stdout.replaceAll("\\n", "\n");
      expect(text).toContain("Always use tabs.");
      expect(text).toContain("## AEGIS protection rules");
      expect(text).toContain("AEGIS-SEC-0001");
      expect(text.indexOf("Always use tabs.")).toBeLessThan(
        text.indexOf("## AEGIS protection rules"),
      );
    });

    it("GitHub Copilot CLI discovers the AEGIS instructions file next to the user's own", async () => {
      const dir = await project({ ".github/copilot-instructions.md": "# mine\n" });
      expect((await sync(dir, ["--agent", "github-copilot"])).code).toBe(0);
      const out = await run(bin("copilot"), ["instruction", "list", "--json"], dir, env());
      const sources = JSON.parse(out.stdout) as { sourcePath: string }[];
      const paths = sources.map((s) => s.sourcePath);
      expect(paths).toContain(".github/instructions/aegis.instructions.md");
      expect(paths).toContain(".github/copilot-instructions.md");
      expect(await readFile(path.join(dir, ".github/copilot-instructions.md"), "utf8")).toBe(
        "# mine\n",
      );
    });
  },
);
