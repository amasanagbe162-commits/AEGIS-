import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ADAPTERS } from "../src/adapters.js";
import { applyPlan, planFiles, verifyFiles } from "../src/plan.js";
import type { FileSpec } from "../src/types.js";
import { makeInput, withTempDir } from "./helpers.js";

const read = (dir: string, rel: string) => readFile(path.join(dir, ...rel.split("/")), "utf8");

async function specsFor(...ids: (keyof typeof ADAPTERS)[]): Promise<FileSpec[]> {
  const input = await makeInput();
  return ids.flatMap((id) => ADAPTERS[id].files(input, { hooks: true }));
}

describe("planning and writing", () => {
  it("creates files, then reports 'unchanged' on a second run", async () => {
    await withTempDir(async (dir) => {
      const specs = await specsFor("claude-code", "github-copilot", "codex", "chatgpt");
      const first = await planFiles(dir, specs);
      expect(first.every((f) => f.action === "create")).toBe(true);
      const written = await applyPlan(dir, first);
      expect(written.every((r) => r.written)).toBe(true);

      const second = await planFiles(dir, specs);
      // the hook settings file is create-only: once it exists AEGIS never touches it
      expect(second.map((f) => [f.spec.path, f.action])).toEqual(
        specs.map((s) => [s.path, s.mode === "create-only" ? "keep" : "unchanged"]),
      );
      expect(await read(dir, ".github/instructions/aegis.instructions.md")).toMatch(
        /^---\napplyTo: "\*\*"\n---\n<!-- aegis:generated sha256=[0-9a-f]{64} -->\n/,
      );
    });
  });

  it("refreshes a file AEGIS wrote when the rules change, and leaves hand-edited files alone", async () => {
    await withTempDir(async (dir) => {
      const [spec] = await specsFor("claude-code");
      if (!spec) throw new Error("no spec");
      await applyPlan(dir, await planFiles(dir, [spec]));

      const changed = { ...spec, body: spec.body + "\nA new rule.\n" };
      const plan = await planFiles(dir, [changed]);
      expect(plan[0]?.action).toBe("update");
      await applyPlan(dir, plan);
      expect(await read(dir, spec.path)).toContain("A new rule.");

      // now the user edits it
      const file = path.join(dir, ...spec.path.split("/"));
      await writeFile(file, (await read(dir, spec.path)) + "\nmy own note\n");
      const after = await planFiles(dir, [spec]);
      expect(after[0]?.action).toBe("keep");
      expect(after[0]?.reason).toContain("edited by hand");
      await applyPlan(dir, after);
      expect(await read(dir, spec.path)).toContain("my own note");
    });
  });

  it("never overwrites a file with the same name that AEGIS did not write", async () => {
    await withTempDir(async (dir) => {
      const [spec] = await specsFor("claude-code");
      if (!spec) throw new Error("no spec");
      await mkdir(path.join(dir, ".claude/rules"), { recursive: true });
      await writeFile(path.join(dir, spec.path), "my rules\n");
      const plan = await planFiles(dir, [spec]);
      expect(plan[0]?.action).toBe("keep");
      await applyPlan(dir, plan);
      expect(await read(dir, spec.path)).toBe("my rules\n");
    });
  });

  it("AGENTS.md: kept without --merge-existing, appended with it, and the user's text is byte-identical", async () => {
    await withTempDir(async (dir) => {
      const [spec] = await specsFor("codex");
      if (!spec) throw new Error("no spec");
      const mine = "# Team notes\r\n\r\nUse tabs.\r\n";
      await writeFile(path.join(dir, "AGENTS.md"), mine);

      const kept = await planFiles(dir, [spec]);
      expect(kept[0]?.action).toBe("keep");
      expect(kept[0]?.reason).toContain("--merge-existing");

      const merged = await planFiles(dir, [spec], { mergeExisting: true });
      expect(merged[0]?.action).toBe("append");
      await applyPlan(dir, merged);
      const text = await read(dir, "AGENTS.md");
      expect(text.startsWith(mine)).toBe(true);
      expect(text).toContain("<!-- aegis:begin");

      // later refresh replaces only the block and keeps text before and after it
      await writeFile(path.join(dir, "AGENTS.md"), text + "\n## After\nmore\n");
      const refreshed = await planFiles(dir, [{ ...spec, body: spec.body + "\nNew line.\n" }]);
      expect(refreshed[0]?.action).toBe("update");
      await applyPlan(dir, refreshed);
      const final = await read(dir, "AGENTS.md");
      expect(final.startsWith(mine)).toBe(true);
      expect(final.endsWith("\n## After\nmore\n")).toBe(true);
      expect(final).toContain("New line.");
    });
  });

  it("an edited or damaged AEGIS block is kept, never repaired by guessing", async () => {
    await withTempDir(async (dir) => {
      const [spec] = await specsFor("codex");
      if (!spec) throw new Error("no spec");
      await applyPlan(dir, await planFiles(dir, [spec]));
      const text = await read(dir, "AGENTS.md");
      await writeFile(path.join(dir, "AGENTS.md"), text.replace("Verify", "Verify (edited)"));
      expect((await planFiles(dir, [spec]))[0]?.reason).toContain("edited by hand");
      await writeFile(path.join(dir, "AGENTS.md"), text + text);
      expect((await planFiles(dir, [spec]))[0]?.reason).toContain("damaged or duplicated");
    });
  });

  it("hook settings are created only when absent and never edited afterwards", async () => {
    await withTempDir(async (dir) => {
      const settings = (await specsFor("claude-code")).find(
        (s) => s.path === ".claude/settings.json",
      );
      if (!settings) throw new Error("no settings spec");
      await mkdir(path.join(dir, ".claude"), { recursive: true });
      await writeFile(path.join(dir, ".claude/settings.json"), '{"permissions":{"allow":[]}}\n');
      const plan = await planFiles(dir, [settings], { mergeExisting: true });
      expect(plan[0]?.action).toBe("keep");
      await applyPlan(dir, plan);
      expect(await read(dir, ".claude/settings.json")).toBe('{"permissions":{"allow":[]}}\n');
    });
  });

  it("does not write through symbolic links", async () => {
    await withTempDir(async (dir) => {
      await withTempDir(async (outside) => {
        const [spec] = await specsFor("claude-code");
        if (!spec) throw new Error("no spec");
        await symlink(outside, path.join(dir, ".claude"));
        const plan = await planFiles(dir, [spec]);
        expect(plan[0]?.action).toBe("keep");
        expect(plan[0]?.reason).toContain("symbolic link");
        await applyPlan(dir, plan);
        await expect(readFile(path.join(outside, "rules/aegis.md"), "utf8")).rejects.toThrow();
      });
    });
  });

  it("does not overwrite a file that appears between planning and writing", async () => {
    await withTempDir(async (dir) => {
      const [spec] = await specsFor("claude-code");
      if (!spec) throw new Error("no spec");
      const plan = await planFiles(dir, [spec]);
      await mkdir(path.join(dir, ".claude/rules"), { recursive: true });
      await writeFile(path.join(dir, spec.path), "arrived late\n");
      const results = await applyPlan(dir, plan);
      expect(results[0]?.written).toBe(false);
      expect(await read(dir, spec.path)).toBe("arrived late\n");
    });
  });

  it("refuses paths that could escape the project", async () => {
    await withTempDir(async (dir) => {
      const bad: FileSpec = { path: "../evil.md", mode: "owned", body: "x", purpose: "test" };
      await expect(planFiles(dir, [bad])).rejects.toThrow("unsafe path");
      await expect(planFiles(dir, [{ ...bad, path: "/etc/passwd" }])).rejects.toThrow(
        "unsafe path",
      );
    });
  });
});

describe("verification", () => {
  it("reports missing, current, stale, modified and foreign files", async () => {
    await withTempDir(async (dir) => {
      const [rules] = await specsFor("claude-code");
      if (!rules) throw new Error("no spec");
      expect((await verifyFiles(dir, [rules]))[0]?.status).toBe("missing");

      await applyPlan(dir, await planFiles(dir, [rules]));
      expect((await verifyFiles(dir, [rules]))[0]?.status).toBe("current");
      expect((await verifyFiles(dir, [{ ...rules, body: rules.body + "more\n" }]))[0]?.status).toBe(
        "stale",
      );

      const file = path.join(dir, ...rules.path.split("/"));
      await writeFile(file, (await read(dir, rules.path)) + "edit\n");
      expect((await verifyFiles(dir, [rules]))[0]?.status).toBe("modified");

      await writeFile(file, "not ours\n");
      expect((await verifyFiles(dir, [rules]))[0]?.status).toBe("foreign");
    });
  });
});
