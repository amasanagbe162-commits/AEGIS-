import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { detectProject, indexProject, type ProjectDetector } from "../src/index.js";
import { repoRoot } from "./helpers.js";

const fixture = (name: string) => path.join(repoRoot, "tests/fixtures", name);
const names = (items: { name: string }[]) => items.map((i) => i.name);

describe("detectProject on fixtures", () => {
  it("detects a Next.js TypeScript project with evidence", async () => {
    const p = await detectProject(fixture("nextjs-sample"));
    expect(names(p.languages)).toEqual(["javascript", "typescript"]);
    const next = p.frameworks.find((f) => f.name === "next.js");
    expect(next?.confidence).toBe("high"); // dependency AND config file
    expect(next?.evidence.map((e) => e.file).sort()).toEqual(["next.config.mjs", "package.json"]);
    expect(p.packageManagers.map((m) => m.name)).toEqual(["npm"]);
    expect(names(p.tools).sort()).toEqual(["eslint", "tsc"]);
  });

  it("detects Python, SQL and a framework from declared dependencies only", async () => {
    const p = await detectProject(fixture("python-sample"));
    expect(names(p.languages)).toEqual(["python", "sql"]);
    const django = p.frameworks.find((f) => f.name === "django");
    expect(django?.confidence).toBe("medium"); // a dependency alone is not proof
    expect(p.frameworks.find((f) => f.name === "flask")).toBeUndefined();
  });

  it("reports uncertainty instead of guessing", async () => {
    const p = await detectProject(fixture("ambiguous-sample"));
    expect(p.frameworks.find((f) => f.name === "express")?.confidence).toBe("medium");
    expect(p.uncertainties.join("\n")).toContain("no lockfile");
    expect(p.uncertainties.join("\n")).toContain("nested package.json");
    expect(names(p.languages)).not.toContain("typescript");
  });
});

describe("detection safety and boundaries", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "aegis-detect-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  const put = async (rel: string, text = "x") => {
    const full = path.join(dir, rel);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, text);
  };

  it("reports no language for an empty project", async () => {
    const p = await detectProject(dir);
    expect(p.languages).toEqual([]);
    expect(p.uncertainties.join(" ")).toContain("No supported language");
  });

  it("skips dependency and build directories", async () => {
    await put("node_modules/pkg/index.ts");
    await put("dist/out.ts");
    await put("src/real.ts");
    const idx = await indexProject(dir);
    expect(idx.files).toEqual(["src/real.ts"]);
  });

  it("respects .gitignore and configured exclusions", async () => {
    await put(".gitignore", "generated/\n*.secret.ts\n");
    await put("generated/a.ts");
    await put("keep.ts");
    await put("x.secret.ts");
    await put("extra/b.ts");
    const idx = await indexProject(dir, { exclude: ["extra/"] });
    expect(idx.files).toEqual([".gitignore", "keep.ts"]);
  });

  it("does not follow symbolic links", async () => {
    const outside = await mkdtemp(path.join(os.tmpdir(), "aegis-out-"));
    try {
      await writeFile(path.join(outside, "leak.ts"), "x");
      await symlink(outside, path.join(dir, "linked"));
      await symlink(path.join(outside, "leak.ts"), path.join(dir, "leak.ts"));
      await put("ok.ts");
      expect((await indexProject(dir)).files).toEqual(["ok.ts"]);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("stops at the file limit and says so", async () => {
    for (let i = 0; i < 5; i++) await put(`f${i}.ts`);
    const p = await detectProject(dir, { maxFiles: 3 });
    expect(p.truncated).toBe(true);
    expect(p.uncertainties.join(" ")).toContain("file limit");
  });

  it("never lets detectors read secret files", async () => {
    await put(".env", "API_KEY=do-not-read-me");
    await put("config/.env.production", "TOKEN=nope");
    await put("keys/server.pem", "nope");
    await put("package.json", "{}");
    const reads: (string | undefined)[] = [];
    const spy: ProjectDetector = {
      name: "spy",
      async detect(ctx) {
        for (const f of [".env", "config/.env.production", "keys/server.pem", "package.json"]) {
          reads.push(await ctx.readText(f));
        }
        return {};
      },
    };
    await detectProject(dir, { detectors: [spy] });
    expect(reads).toEqual([undefined, undefined, undefined, "{}"]);
  });

  it("reports an unparsable package.json instead of crashing", async () => {
    await put("package.json", "{ not json");
    const p = await detectProject(dir);
    expect(p.uncertainties.join(" ")).toContain("could not be parsed");
    expect(names(p.languages)).toContain("javascript");
  });

  it("keeps going when one detector fails", async () => {
    const broken: ProjectDetector = {
      name: "broken",
      async detect() {
        throw new Error("boom");
      },
    };
    await put("go.mod", "module x");
    const p = await detectProject(dir, {
      detectors: [broken, (await import("../src/index.js")).manifestDetector],
    });
    expect(names(p.languages)).toEqual(["go"]);
    expect(p.uncertainties.join(" ")).toContain("Detector 'broken' failed");
  });

  it("does not put absolute paths into evidence", async () => {
    const p = await detectProject(fixture("nextjs-sample"));
    const all = JSON.stringify([p.languages, p.frameworks, p.tools, p.packageManagers]);
    expect(all).not.toContain(repoRoot);
  });
});
