import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { CheckRunner, Finding } from "@aegis/core";
import { aegis, makeRuntime, withTempDir } from "./helpers.js";

const read = (dir: string, rel: string) => readFile(path.join(dir, ...rel.split("/")), "utf8");
const exists = (dir: string, rel: string) =>
  read(dir, rel).then(
    () => true,
    () => false,
  );

async function project(dir: string): Promise<void> {
  await writeFile(path.join(dir, "package.json"), JSON.stringify({ name: "demo" }));
}

describe("aegis agents list", () => {
  it("lists every agent with its enforcement level and limits", async () => {
    const c = makeRuntime(process.cwd());
    expect(await aegis(["agents", "list"], c)).toBe(0);
    for (const id of ["claude-code", "github-copilot", "codex", "chatgpt"]) {
      expect(c.stdout()).toContain(id);
    }
    expect(c.stdout()).toContain("[hook]");
    expect(c.stdout()).toContain("[manual]");
    expect(c.stdout()).toContain("advisory");
    const j = makeRuntime(process.cwd());
    await aegis(["agents", "list", "--json"], j);
    expect(JSON.parse(j.stdout())).toHaveLength(4);
  });
});

describe("aegis agents sync", () => {
  it("--dry-run shows the plan and writes nothing", async () => {
    await withTempDir(async (dir) => {
      await project(dir);
      const c = makeRuntime(dir);
      expect(
        await aegis(["agents", "sync", "--agent", "claude-code", "codex", "--dry-run"], c),
      ).toBe(0);
      expect(c.stdout()).toContain(".claude/rules/aegis.md");
      expect(c.stdout()).toContain("AGENTS.md");
      expect(c.stdout()).toContain("Dry run");
      expect(await readdir(dir)).toEqual(["package.json"]);
    });
  });

  it("refuses to write without a terminal or --yes", async () => {
    await withTempDir(async (dir) => {
      await project(dir);
      const c = makeRuntime(dir);
      expect(await aegis(["agents", "sync", "--agent", "claude-code"], c)).toBe(2);
      expect(c.stderr()).toContain("--yes");
      expect(await readdir(dir)).toEqual(["package.json"]);
    });
  });

  it("asks for confirmation in a terminal and respects a 'no'", async () => {
    await withTempDir(async (dir) => {
      await project(dir);
      const c = makeRuntime(dir, { interactive: true, script: { confirms: [false] } });
      expect(await aegis(["agents", "sync", "--agent", "claude-code"], c)).toBe(0);
      expect(c.asked).toEqual(["Write these files?"]);
      expect(await readdir(dir)).toEqual(["package.json"]);
    });
  });

  it("needs an agent: from --agent or from aegis.config.json", async () => {
    await withTempDir(async (dir) => {
      await project(dir);
      const none = makeRuntime(dir);
      expect(await aegis(["agents", "sync", "--yes"], none)).toBe(2);
      expect(none.stderr()).toContain("no agent chosen");

      await writeFile(
        path.join(dir, "aegis.config.json"),
        JSON.stringify({ version: 1, agents: ["github-copilot"] }),
      );
      const fromConfig = makeRuntime(dir);
      expect(await aegis(["agents", "sync", "--yes"], fromConfig)).toBe(0);
      expect(await exists(dir, ".github/instructions/aegis.instructions.md")).toBe(true);
    });
  });

  it("installs every agent, leaves CLAUDE.md and copilot-instructions.md alone, and is idempotent", async () => {
    await withTempDir(async (dir) => {
      await project(dir);
      await mkdir(path.join(dir, ".github"), { recursive: true });
      await writeFile(path.join(dir, "CLAUDE.md"), "# mine\n");
      await writeFile(path.join(dir, ".github/copilot-instructions.md"), "# copilot mine\n");
      const args = [
        "agents",
        "sync",
        "--yes",
        "--agent",
        "claude-code",
        "github-copilot",
        "codex",
        "chatgpt",
      ];

      const first = makeRuntime(dir);
      expect(await aegis(args, first)).toBe(0);
      for (const f of [
        ".claude/rules/aegis.md",
        ".github/instructions/aegis.instructions.md",
        "AGENTS.md",
        ".aegis/chatgpt-instructions.md",
      ]) {
        expect(await exists(dir, f)).toBe(true);
      }
      expect(await read(dir, "CLAUDE.md")).toBe("# mine\n");
      expect(await read(dir, ".github/copilot-instructions.md")).toBe("# copilot mine\n");
      expect(first.stdout()).toContain("advisory");

      const second = makeRuntime(dir);
      expect(await aegis(args, second)).toBe(0);
      expect(second.stdout()).toContain("Nothing to write");
      expect(second.stdout()).not.toContain("Wrote ");
    });
  });

  it("keeps an existing AGENTS.md until --merge-existing, then appends without touching the user's text", async () => {
    await withTempDir(async (dir) => {
      await project(dir);
      await writeFile(path.join(dir, "AGENTS.md"), "# My agents file\n\nBe nice.\n");
      const keep = makeRuntime(dir);
      expect(await aegis(["agents", "sync", "--yes", "--agent", "codex"], keep)).toBe(0);
      expect(await read(dir, "AGENTS.md")).toBe("# My agents file\n\nBe nice.\n");
      expect(keep.stdout()).toContain("--merge-existing");

      const merge = makeRuntime(dir);
      expect(
        await aegis(["agents", "sync", "--yes", "--agent", "codex", "--merge-existing"], merge),
      ).toBe(0);
      const text = await read(dir, "AGENTS.md");
      expect(text.startsWith("# My agents file\n\nBe nice.\n")).toBe(true);
      expect(text).toContain("AEGIS protection rules");
      expect(Buffer.byteLength(text)).toBeLessThan(8 * 1024);
    });
  });

  it("--hooks creates .claude/settings.json once and never edits an existing one", async () => {
    await withTempDir(async (dir) => {
      await project(dir);
      const c = makeRuntime(dir);
      expect(await aegis(["agents", "sync", "--yes", "--agent", "claude-code", "--hooks"], c)).toBe(
        0,
      );
      const settings = JSON.parse(await read(dir, ".claude/settings.json")) as {
        hooks: { Stop: { hooks: { command: string }[] }[] };
      };
      expect(settings.hooks.Stop[0]?.hooks[0]?.command).toBe(
        "npx --no-install aegis hook claude-stop",
      );

      await writeFile(path.join(dir, ".claude/settings.json"), '{"mine":true}\n');
      const again = makeRuntime(dir);
      expect(
        await aegis(["agents", "sync", "--yes", "--agent", "claude-code", "--hooks"], again),
      ).toBe(0);
      expect(await read(dir, ".claude/settings.json")).toBe('{"mine":true}\n');
      expect(again.stdout()).toContain("merge this into it");
      expect(again.stdout()).toContain("claude-stop");
    });
  });

  it("rejects a --cli-command that could carry shell syntax", async () => {
    await withTempDir(async (dir) => {
      await project(dir);
      for (const bad of ["aegis; rm -rf /", "aegis $(whoami)", "aegis `id`", 'aegis "x"', "a|b"]) {
        const c = makeRuntime(dir);
        expect(
          await aegis(
            ["agents", "sync", "--yes", "--agent", "claude-code", "--cli-command", bad],
            c,
          ),
        ).toBe(2);
      }
      expect(await readdir(dir)).toEqual(["package.json"]);
      const ok = makeRuntime(dir);
      expect(
        await aegis(
          [
            "agents",
            "sync",
            "--yes",
            "--agent",
            "claude-code",
            "--cli-command",
            "node bin/aegis.js",
          ],
          ok,
        ),
      ).toBe(0);
      expect(await read(dir, ".claude/rules/aegis.md")).toContain("node bin/aegis.js check");
    });
  });

  it("uses the project's own master file and protection level", async () => {
    await withTempDir(async (dir) => {
      await project(dir);
      await aegis(["init", "--yes", "--level", "maximum"], makeRuntime(dir));
      const master = (await read(dir, "AEGIS.aegis")).replace(
        "Inspect before modifying",
        "Inspect carefully before modifying",
      );
      await writeFile(path.join(dir, "AEGIS.aegis"), master);
      await aegis(["agents", "sync", "--yes", "--agent", "claude-code"], makeRuntime(dir));
      const rules = await read(dir, ".claude/rules/aegis.md");
      expect(rules).toContain("Inspect carefully before modifying");
      expect(rules).toContain("protection level: maximum");
    });
  });

  it("explains an invalid master file instead of generating from it", async () => {
    await withTempDir(async (dir) => {
      await project(dir);
      await writeFile(path.join(dir, "AEGIS.aegis"), "aegis: '1.0'\nkind: master\n");
      const c = makeRuntime(dir);
      expect(await aegis(["agents", "sync", "--yes", "--agent", "claude-code"], c)).toBe(2);
      expect(c.stderr()).toContain("AEGIS.aegis is invalid");
      expect(await exists(dir, ".claude/rules/aegis.md")).toBe(false);
    });
  });
});

describe("aegis agents verify and print", () => {
  it("verify: missing -> current -> stale -> modified, with exit codes 1, 0, 1, 1", async () => {
    await withTempDir(async (dir) => {
      await project(dir);
      const base = ["agents", "verify", "--agent", "claude-code"];
      const missing = makeRuntime(dir);
      expect(await aegis(base, missing)).toBe(1);
      expect(missing.stdout()).toContain("[missing]");

      await aegis(["agents", "sync", "--yes", "--agent", "claude-code"], makeRuntime(dir));
      const ok = makeRuntime(dir);
      expect(await aegis(base, ok)).toBe(0);
      expect(ok.stdout()).toContain("[current]");
      expect(ok.stdout()).toContain("cannot tell whether an agent follows them");

      // a different attempt limit makes the generated text different: stale
      await writeFile(
        path.join(dir, "aegis.config.json"),
        JSON.stringify({ version: 1, selfCorrection: { maxAttempts: 5 } }),
      );
      const stale = makeRuntime(dir);
      expect(await aegis(base, stale)).toBe(1);
      expect(stale.stdout()).toContain("[stale]");

      const file = path.join(dir, ".claude/rules/aegis.md");
      await writeFile(file, (await readFile(file, "utf8")) + "my edit\n");
      const modified = makeRuntime(dir);
      expect(await aegis(base, modified)).toBe(1);
      expect(modified.stdout()).toContain("[modified]");
      const j = makeRuntime(dir);
      await aegis([...base, "--json"], j);
      expect((JSON.parse(j.stdout()) as { ok: boolean }).ok).toBe(false);
    });
  });

  it("print outputs the paste-ready ChatGPT text and nothing else", async () => {
    await withTempDir(async (dir) => {
      await project(dir);
      const c = makeRuntime(dir);
      expect(await aegis(["agents", "print", "chatgpt"], c)).toBe(0);
      const text = c.stdout();
      expect(text.length).toBeLessThanOrEqual(1501);
      expect(text).toContain("You cannot run code");
      expect(text).not.toContain("aegis:generated");
      expect(text).not.toContain("```");
      expect(await readdir(dir)).toEqual(["package.json"]);
    });
  });

  it("print rejects an unknown agent", async () => {
    const c = makeRuntime(process.cwd());
    expect(await aegis(["agents", "print", "emacs"], c)).toBe(2);
    expect(c.stderr()).toContain("unknown agent");
  });
});

describe("aegis init with agents", () => {
  it("creates config, master and agent files in one confirmed step, and still keeps user files", async () => {
    await withTempDir(async (dir) => {
      await project(dir);
      await writeFile(path.join(dir, "CLAUDE.md"), "# keep me\n");
      const c = makeRuntime(dir);
      expect(
        await aegis(
          ["init", "--yes", "--level", "advanced", "--agent", "claude-code", "codex", "chatgpt"],
          c,
        ),
      ).toBe(0);
      for (const f of [
        "aegis.config.json",
        "AEGIS.aegis",
        ".claude/rules/aegis.md",
        "AGENTS.md",
        ".aegis/chatgpt-instructions.md",
      ]) {
        expect(await exists(dir, f)).toBe(true);
      }
      expect(await read(dir, "CLAUDE.md")).toBe("# keep me\n");
      expect(await read(dir, ".claude/rules/aegis.md")).toContain("protection level: advanced");
      expect(c.stdout()).not.toContain("NOT generated yet");
      expect(c.stdout()).toContain("aegis agents print chatgpt");
    });
  });

  it("init --dry-run lists the agent files and writes nothing", async () => {
    await withTempDir(async (dir) => {
      await project(dir);
      const c = makeRuntime(dir);
      expect(await aegis(["init", "--dry-run", "--agent", "github-copilot"], c)).toBe(0);
      expect(c.stdout()).toContain(".github/instructions/aegis.instructions.md");
      expect(await readdir(dir)).toEqual(["package.json"]);
    });
  });

  it("doctor warns when an agent file is missing, then reports it installed", async () => {
    await withTempDir(async (dir) => {
      await project(dir);
      await aegis(["init", "--yes", "--agent", "claude-code"], makeRuntime(dir));
      await (await import("node:fs/promises")).rm(path.join(dir, ".claude"), { recursive: true });
      const bad = makeRuntime(dir);
      await aegis(["doctor"], bad);
      expect(bad.stdout()).toContain("Claude Code files: .claude/rules/aegis.md is missing");
      await aegis(["agents", "sync", "--yes"], makeRuntime(dir));
      const good = makeRuntime(dir);
      await aegis(["doctor"], good);
      expect(good.stdout()).toContain("[ok]   Claude Code files: installed and up to date");
    });
  });
});

describe("aegis hook claude-stop", () => {
  const pass: CheckRunner = async () => ({ outcome: "passed", findings: [] });
  const ids = [
    "secrets",
    "static-analysis",
    "typecheck",
    "lint",
    "dependency-audit",
    "dependency-vulnerabilities",
  ];
  const allPass = Object.fromEntries(ids.map((id) => [id, pass]));
  const finding: Finding = {
    title: "Possible SQL injection",
    message: "SQL text is built by concatenation.",
    severity: "critical",
    confidence: "high",
    status: "finding",
    location: { file: "app.js", line: 5 },
  };
  const failing = {
    ...allPass,
    "static-analysis": (async () => ({
      outcome: "findings" as const,
      findings: [finding],
    })) satisfies CheckRunner,
  };
  const stdin = (data: unknown) => async () =>
    typeof data === "string" ? data : JSON.stringify(data);

  it("blocks Claude (exit 2, message on stderr) while blocking findings remain, then lets it finish after the attempt limit", async () => {
    await withTempDir(async (dir) => {
      await project(dir);
      await writeFile(
        path.join(dir, "aegis.config.json"),
        JSON.stringify({ version: 1, selfCorrection: { maxAttempts: 2 } }),
      );
      const input = { session_id: "sess-1", cwd: dir, stop_hook_active: false };
      const run = async () => {
        const c = makeRuntime(dir, { runners: failing, readStdin: stdin(input) });
        const code = await aegis(["hook", "claude-stop"], c);
        return { code, c };
      };
      const one = await run();
      expect(one.code).toBe(2);
      expect(one.c.stderr()).toContain("attempt 1 of 2");
      expect(one.c.stderr()).toContain("Possible SQL injection");
      expect((await run()).code).toBe(2);
      const third = await run();
      expect(third.code).toBe(0);
      expect(third.c.stdout()).toContain("unresolved after 2 attempt(s)");
      expect(JSON.parse(third.c.stdout().trim()) as { systemMessage: string }).toHaveProperty(
        "systemMessage",
      );
      // the counter reset, so a later turn gets fresh attempts
      expect((await run()).code).toBe(2);
    });
  });

  it("lets Claude finish and clears the counter once checks pass", async () => {
    await withTempDir(async (dir) => {
      await project(dir);
      const input = { session_id: "sess-2", cwd: dir };
      const bad = makeRuntime(dir, { runners: failing, readStdin: stdin(input) });
      expect(await aegis(["hook", "claude-stop"], bad)).toBe(2);
      const good = makeRuntime(dir, { runners: allPass, readStdin: stdin(input) });
      expect(await aegis(["hook", "claude-stop"], good)).toBe(0);
      expect(good.stderr()).toBe("");
      expect(
        (await readdir(path.join(dir, ".aegis/state"))).filter((f) => f.endsWith(".json")),
      ).toEqual([]);
    });
  });

  it("never blocks on an incomplete result and says it is not clean", async () => {
    await withTempDir(async (dir) => {
      await project(dir);
      const runners = {
        ...allPass,
        secrets: (async () => ({
          outcome: "skipped" as const,
          reason: "gitleaks was not found on PATH",
          findings: [],
        })) satisfies CheckRunner,
      };
      const c = makeRuntime(dir, { runners, readStdin: stdin({ session_id: "s3", cwd: dir }) });
      expect(await aegis(["hook", "claude-stop"], c)).toBe(0);
      expect(c.stdout()).toContain("INCOMPLETE");
      expect(c.stdout()).toContain("not a clean result");
    });
  });

  it("fails open (exit 1, not 2) when its input is broken or the folder is gone", async () => {
    await withTempDir(async (dir) => {
      const garbage = makeRuntime(dir, { readStdin: stdin("not json") });
      expect(await aegis(["hook", "claude-stop"], garbage)).toBe(1);
      expect(garbage.stderr()).toContain("nothing was verified");
      const none = makeRuntime(dir);
      expect(await aegis(["hook", "claude-stop"], none)).toBe(1);
      const gone = makeRuntime(dir, {
        readStdin: stdin({ session_id: "s4", cwd: path.join(dir, "nope") }),
      });
      expect(await aegis(["hook", "claude-stop"], gone)).toBe(1);
    });
  });

  it("does not store findings, code or paths in its state", async () => {
    await withTempDir(async (dir) => {
      await project(dir);
      const c = makeRuntime(dir, {
        runners: failing,
        readStdin: stdin({ session_id: "s5", cwd: dir }),
      });
      await aegis(["hook", "claude-stop"], c);
      const state = await read(dir, ".aegis/state/claude-stop-s5.json");
      expect(JSON.parse(state)).toEqual({ attempts: 1 });
    });
  });
});
