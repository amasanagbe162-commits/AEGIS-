import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseConfig, parseMasterFile } from "@aegis/core";
import { aegis, makeRuntime, withTempDir } from "./helpers.js";

const names = async (dir: string) => (await readdir(dir)).sort();

describe("aegis init", () => {
  it("--dry-run shows the plan and writes nothing", async () => {
    await withTempDir(async (dir) => {
      await writeFile(path.join(dir, "package.json"), "{}");
      const c = makeRuntime(dir);
      expect(await aegis(["init", "--dry-run", "--level", "maximum"], c)).toBe(0);
      expect(c.stdout()).toContain("create  aegis.config.json");
      expect(c.stdout()).toContain("Dry run: no files were written");
      expect(await names(dir)).toEqual(["package.json"]);
    });
  });

  it("--yes creates a valid config and master file with the chosen level and agents", async () => {
    await withTempDir(async (dir) => {
      await writeFile(path.join(dir, "package.json"), "{}");
      const c = makeRuntime(dir);
      const code = await aegis(
        ["init", "--yes", "--level", "advanced", "--agent", "claude-code", "github-copilot"],
        c,
      );
      expect(code).toBe(0);
      expect(await names(dir)).toEqual(["AEGIS.aegis", "aegis.config.json", "package.json"]);
      const cfg = parseConfig(await readFile(path.join(dir, "aegis.config.json"), "utf8"));
      expect(cfg.ok && cfg.value.protectionLevel).toBe("advanced");
      expect(cfg.ok && cfg.value.agents).toEqual(["claude-code", "github-copilot"]);
      const master = parseMasterFile(await readFile(path.join(dir, "AEGIS.aegis"), "utf8"));
      expect(master.ok && master.value.defaultProtectionLevel).toBe("advanced");
      expect(c.stdout()).toContain("Diagnostic:");
      expect(c.stdout()).toContain("NOT generated yet");
    });
  });

  it("never overwrites existing files", async () => {
    await withTempDir(async (dir) => {
      await writeFile(path.join(dir, "package.json"), "{}");
      const mine = '{ "version": 1, "protectionLevel": "maximum" }';
      await writeFile(path.join(dir, "aegis.config.json"), mine);
      await writeFile(path.join(dir, "AEGIS.aegis"), "# my own file, not even valid\n");
      const c = makeRuntime(dir);
      expect(await aegis(["init", "--yes", "--level", "standard"], c)).toBe(2); // master is invalid: doctor fails
      expect(await readFile(path.join(dir, "aegis.config.json"), "utf8")).toBe(mine);
      expect(await readFile(path.join(dir, "AEGIS.aegis"), "utf8")).toBe(
        "# my own file, not even valid\n",
      );
      expect(c.stdout()).toContain("keep    aegis.config.json");
      expect(c.stdout()).toContain("keep    AEGIS.aegis");
    });
  });

  it("refuses to continue with an invalid existing config and leaves it untouched", async () => {
    await withTempDir(async (dir) => {
      await writeFile(path.join(dir, "package.json"), "{}");
      const bad = '{ "version": 1, "protectionLevel": "paranoid" }';
      await writeFile(path.join(dir, "aegis.config.json"), bad);
      const c = makeRuntime(dir);
      expect(await aegis(["init", "--yes"], c)).toBe(2);
      expect(c.stderr()).toContain("invalid");
      expect(await readFile(path.join(dir, "aegis.config.json"), "utf8")).toBe(bad);
      expect(await names(dir)).toEqual(["aegis.config.json", "package.json"]);
    });
  });

  it("writes nothing and exits 2 without a terminal or --yes", async () => {
    await withTempDir(async (dir) => {
      await writeFile(path.join(dir, "package.json"), "{}");
      const c = makeRuntime(dir);
      expect(await aegis(["init"], c)).toBe(2);
      expect(c.stderr()).toContain("--yes");
      expect(await names(dir)).toEqual(["package.json"]);
    });
  });

  it("uses 'standard' and says so when it cannot ask", async () => {
    await withTempDir(async (dir) => {
      await writeFile(path.join(dir, "package.json"), "{}");
      const c = makeRuntime(dir);
      await aegis(["init", "--dry-run"], c);
      expect(c.stdout()).toContain("'standard' is used");
    });
  });

  it("asks for level and agent in a terminal, then asks to confirm", async () => {
    await withTempDir(async (dir) => {
      await writeFile(path.join(dir, "package.json"), "{}");
      const c = makeRuntime(dir, {
        interactive: true,
        script: { selects: [1, 1], confirms: [true] },
      });
      expect(await aegis(["init"], c)).toBe(0);
      expect(c.asked).toEqual([
        "Which protection level do you want?",
        "Which AI coding agent do you use?",
        "Create these files?",
      ]);
      const cfg = parseConfig(await readFile(path.join(dir, "aegis.config.json"), "utf8"));
      expect(cfg.ok && cfg.value.protectionLevel).toBe("advanced");
      expect(cfg.ok && cfg.value.agents).toEqual(["github-copilot"]);
    });
  });

  it("writes nothing when the person declines the confirmation", async () => {
    await withTempDir(async (dir) => {
      await writeFile(path.join(dir, "package.json"), "{}");
      const c = makeRuntime(dir, {
        interactive: true,
        script: { selects: [0, 3], confirms: [false] },
      });
      expect(await aegis(["init"], c)).toBe(0);
      expect(c.stdout()).toContain("Nothing was changed");
      expect(await names(dir)).toEqual(["package.json"]);
    });
  });

  it("finds the project root from a subfolder", async () => {
    await withTempDir(async (dir) => {
      await writeFile(path.join(dir, "package.json"), "{}");
      await mkdir(path.join(dir, "src/deep"), { recursive: true });
      const c = makeRuntime(path.join(dir, "src/deep"));
      expect(await aegis(["init", "--yes", "--level", "standard"], c)).toBe(0);
      expect(await names(dir)).toContain("aegis.config.json");
      expect(await names(path.join(dir, "src/deep"))).toEqual([]);
    });
  });

  it("accepts an explicit path and rejects a missing one", async () => {
    await withTempDir(async (dir) => {
      const c = makeRuntime("/");
      expect(await aegis(["init", dir, "--yes", "--level", "standard"], c)).toBe(0);
      expect(await names(dir)).toContain("AEGIS.aegis");
      const bad = makeRuntime(dir);
      expect(await aegis(["init", "no-such-folder", "--yes"], bad)).toBe(2);
      expect(bad.stderr()).toContain("not a folder");
    });
  });

  it("refuses to initialize the home folder by accident", async () => {
    await withTempDir(async (dir) => {
      const c = makeRuntime(dir, { homeDir: dir });
      expect(await aegis(["init", "--yes"], c)).toBe(2);
      expect(c.stderr()).toContain("refusing");
      expect(await names(dir)).toEqual([]);
    });
  });

  it("leaves existing agent instruction files untouched", async () => {
    await withTempDir(async (dir) => {
      await writeFile(path.join(dir, "package.json"), "{}");
      await writeFile(path.join(dir, "CLAUDE.md"), "# my instructions\n");
      const c = makeRuntime(dir);
      await aegis(["init", "--yes", "--level", "standard", "--agent", "claude-code"], c);
      expect(await readFile(path.join(dir, "CLAUDE.md"), "utf8")).toBe("# my instructions\n");
    });
  });
});
