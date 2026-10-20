import { chmod, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { aegis, fixture, makeRuntime, repoRoot, withTempDir } from "./helpers.js";

describe("meta", () => {
  it("prints help and version with exit code 0", async () => {
    const c = makeRuntime(repoRoot);
    expect(await aegis(["--help"], c)).toBe(0);
    expect(c.stdout()).toContain("Exit codes");
    for (const cmd of ["init", "scan", "check", "rules", "doctor"])
      expect(c.stdout()).toContain(cmd);
    const v = makeRuntime(repoRoot);
    expect(await aegis(["--version"], v)).toBe(0);
    expect(v.stdout().trim()).toBe("9.9.9");
  });

  it("exits 2 with a clear message for unknown commands and options", async () => {
    const a = makeRuntime(repoRoot);
    expect(await aegis(["frobnicate"], a)).toBe(2);
    expect(a.stderr()).toContain("unknown command");
    const b = makeRuntime(repoRoot);
    expect(await aegis(["scan", "--level", "paranoid"], b)).toBe(2);
    expect(b.stderr()).toContain("Allowed choices are standard, advanced, maximum");
  });

  it("does not offer an 'update' command that does not exist yet", async () => {
    const c = makeRuntime(repoRoot);
    expect(await aegis(["rules", "update"], c)).toBe(2);
  });
});

describe("scan and check", () => {
  it("scan reports the detected project and exits 3 (incomplete) because no check can run yet", async () => {
    const c = makeRuntime(fixture("nextjs-sample"));
    expect(await aegis(["scan"], c)).toBe(3);
    expect(c.stdout()).toContain("next.js (high)");
    expect(c.stdout()).toContain("INCOMPLETE");
    expect(c.stdout()).not.toContain(repoRoot);
  });

  it("scan --format json prints valid JSON, and --level overrides the config", async () => {
    const c = makeRuntime(fixture("nextjs-sample"));
    expect(await aegis(["scan", "--format", "json", "--level", "maximum"], c)).toBe(3);
    const report = JSON.parse(c.stdout()) as {
      protectionLevel: string;
      verdict: string;
      tool: { version: string };
    };
    expect(report.protectionLevel).toBe("maximum");
    expect(report.verdict).toBe("incomplete");
    expect(report.tool.version).toBe("9.9.9");
  });

  it("scan accepts a path and exits 2 for a missing one", async () => {
    const ok = makeRuntime("/");
    expect(await aegis(["scan", fixture("python-sample")], ok)).toBe(3);
    expect(ok.stdout()).toContain("python (high)");
    const bad = makeRuntime(repoRoot);
    expect(await aegis(["scan", "does-not-exist"], bad)).toBe(2);
    expect(bad.stderr()).toContain("not a folder");
  });

  it("scan reports an invalid config as an error (exit 2) with a line number", async () => {
    await withTempDir(async (dir) => {
      await writeFile(
        path.join(dir, "aegis.config.json"),
        '{\n  "version": 1,\n  "protectionLevel": "x"\n}',
      );
      const c = makeRuntime(dir);
      expect(await aegis(["scan"], c)).toBe(2);
      expect(c.stdout()).toContain("aegis.config.json:3");
    });
  });

  it("check prints compact output and also exits 3", async () => {
    const c = makeRuntime(fixture("nextjs-sample"));
    expect(await aegis(["check"], c)).toBe(3);
    expect(c.stdout()).toContain("AEGIS check");
    expect(c.stdout()).toContain("[SKIPPED]");
    expect(c.stdout()).toContain("Incomplete is not clean");
    expect(c.stdout().split("\n").length).toBeLessThan(15);
  });

  it("check --allow-incomplete exits 0 but still says INCOMPLETE", async () => {
    const c = makeRuntime(fixture("nextjs-sample"));
    expect(await aegis(["check", "--allow-incomplete"], c)).toBe(0);
    expect(c.stdout()).toContain("INCOMPLETE");
    expect(c.stdout()).toContain("--allow-incomplete was set");
  });
});

describe("rules list", () => {
  it("lists the bundled rules and explains the proposed status", async () => {
    const c = makeRuntime(repoRoot);
    expect(await aegis(["rules", "list"], c)).toBe(0);
    expect(c.stdout()).toContain("AEGIS-SEC-0001");
    expect(c.stdout()).toContain("6 rule(s)");
    expect(c.stdout()).toContain("proposed");
  });

  it("filters by category and supports --json", async () => {
    const c = makeRuntime(repoRoot);
    expect(await aegis(["rules", "list", "--category", "coding-errors", "--json"], c)).toBe(0);
    const rows = JSON.parse(c.stdout()) as { id: string }[];
    expect(rows.map((r) => r.id)).toEqual(["AEGIS-COD-0001"]);
  });
});

describe("rules validate", () => {
  const goodRule = "packages/rules/data/security/AEGIS-SEC-0001.yaml";
  const master = "packages/rules/templates/AEGIS.aegis";

  it("validates the bundled rules by default", async () => {
    await withTempDir(async (dir) => {
      const c = makeRuntime(dir);
      expect(await aegis(["rules", "validate"], c)).toBe(0);
      expect(c.stdout()).toContain("bundled rules (6 valid rule(s))");
      expect(c.stdout()).toContain("structure only");
    });
  });

  it("validates a single rule, a master file and a folder", async () => {
    const c = makeRuntime(repoRoot);
    expect(await aegis(["rules", "validate", goodRule], c)).toBe(0);
    expect(await aegis(["rules", "validate", master], c)).toBe(0);
    expect(await aegis(["rules", "validate", "packages/rules/data"], c)).toBe(0);
  });

  it("reports the file, field and line of a broken rule and exits 2", async () => {
    await withTempDir(async (dir) => {
      await writeFile(path.join(dir, "bad.yaml"), "id: AEGIS-SEC-0001\nseverity: catastrophic\n");
      const c = makeRuntime(dir);
      expect(await aegis(["rules", "validate", "bad.yaml"], c)).toBe(2);
      expect(c.stdout()).toMatch(/error: bad\.yaml:2:1 \[severity\]/);
      expect(c.stdout()).toContain("Invalid:");
    });
  });

  it("reports unknown rule references in a master file", async () => {
    await withTempDir(async (dir) => {
      const { readFile } = await import("node:fs/promises");
      const text = (await readFile(path.join(repoRoot, master), "utf8")).replace(
        "- collection: dependencies",
        "- rule: AEGIS-SEC-9999",
      );
      await writeFile(path.join(dir, "M.aegis"), text);
      const c = makeRuntime(dir);
      expect(await aegis(["rules", "validate", "M.aegis"], c)).toBe(2);
      expect(c.stdout()).toContain("unknown rule 'AEGIS-SEC-9999'");
    });
  });

  it("handles missing files and unsupported file types", async () => {
    await withTempDir(async (dir) => {
      await writeFile(path.join(dir, "notes.txt"), "hi");
      const c = makeRuntime(dir);
      expect(await aegis(["rules", "validate", "missing.yaml"], c)).toBe(2);
      expect(c.stdout()).toContain("not found");
      const d = makeRuntime(dir);
      expect(await aegis(["rules", "validate", "notes.txt"], d)).toBe(2);
      expect(d.stdout()).toContain("unsupported file type");
    });
  });

  it("also validates this project's config and master file when present", async () => {
    await withTempDir(async (dir) => {
      await writeFile(path.join(dir, "package.json"), "{}");
      await aegis(["init", "--yes", "--level", "standard"], makeRuntime(dir));
      const c = makeRuntime(dir);
      expect(await aegis(["rules", "validate"], c)).toBe(0);
      expect(c.stdout()).toContain("aegis.config.json");
      expect(c.stdout()).toContain("AEGIS.aegis (master file)");
    });
  });
});

describe("doctor", () => {
  it("passes in a freshly initialized project and warns about missing tools without failing", async () => {
    await withTempDir(async (dir) => {
      await writeFile(path.join(dir, "package.json"), "{}");
      await aegis(["init", "--yes", "--level", "standard"], makeRuntime(dir));
      const c = makeRuntime(dir);
      expect(await aegis(["doctor"], c)).toBe(0);
      expect(c.stdout()).toContain("[ok]   Bundled rules: 6 rules loaded and valid");
      expect(c.stdout()).toContain("[warn] gitleaks: not found");
    });
  });

  it("fails (exit 2) for a broken config and a broken master file", async () => {
    await withTempDir(async (dir) => {
      await writeFile(path.join(dir, "package.json"), "{}");
      await writeFile(path.join(dir, "aegis.config.json"), "{ nope");
      await writeFile(path.join(dir, "AEGIS.aegis"), "kind: master\n");
      const c = makeRuntime(dir);
      expect(await aegis(["doctor"], c)).toBe(2);
      expect(c.stdout()).toContain("[FAIL] aegis.config.json");
      expect(c.stdout()).toContain("[FAIL] AEGIS.aegis");
    });
  });

  it("fails for a Node.js version that is too old", async () => {
    const c = makeRuntime(fixture("nextjs-sample"), { nodeVersion: "v18.19.0" });
    expect(await aegis(["doctor"], c)).toBe(2);
    expect(c.stdout()).toContain("[FAIL] Node.js");
  });

  it("warns (does not fail) when no config exists", async () => {
    const c = makeRuntime(fixture("python-sample"));
    expect(await aegis(["doctor"], c)).toBe(0);
    expect(c.stdout()).toContain("[warn] aegis.config.json: not found");
  });

  it("supports --json", async () => {
    const c = makeRuntime(fixture("python-sample"));
    await aegis(["doctor", "--json"], c);
    const parsed = JSON.parse(c.stdout()) as { ok: boolean; items: { name: string }[] };
    expect(parsed.ok).toBe(true);
    expect(parsed.items.some((i) => i.name === "Bundled rules")).toBe(true);
  });

  it.skipIf(process.platform === "win32")("finds tools on PATH without running them", async () => {
    await withTempDir(async (dir) => {
      const bin = path.join(dir, "bin");
      await mkdir(bin);
      const marker = path.join(dir, "was-executed");
      const fake = path.join(bin, "gitleaks");
      await writeFile(fake, `#!/bin/sh\ntouch "${marker}"\n`);
      await chmod(fake, 0o755);
      const c = makeRuntime(fixture("python-sample"), { env: { PATH: bin } });
      await aegis(["doctor"], c);
      expect(c.stdout()).toContain("[ok]   gitleaks: found on PATH");
      const { access } = await import("node:fs/promises");
      await expect(access(marker)).rejects.toThrow(); // never executed
    });
  });
});
