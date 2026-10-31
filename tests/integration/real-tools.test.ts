import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import {
  createEslintRunner,
  createGitleaksRunner,
  createNpmAuditRunner,
  createOsvScannerRunner,
  createSemgrepRunner,
  createTscRunner,
  defaultScannerDeps,
  detectProject,
  findExecutable,
  type CheckContext,
} from "../../packages/core/src/index.js";
import { SEMGREP_RULES_FILE } from "../../packages/rules/src/index.js";

/**
 * These tests run the REAL scanners. A test is skipped (and named as skipped) when its tool is not
 * installed, so a machine without the tools still passes, but it then verified nothing about that
 * tool. Install gitleaks, semgrep and osv-scanner to run them all.
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const deps = defaultScannerDeps();
const has = async (name: string) => (await findExecutable(name, process.env)) !== undefined;
const [hasGitleaks, hasSemgrep, hasNpm, hasOsv] = await Promise.all(
  ["gitleaks", "semgrep", "npm", "osv-scanner"].map(has),
);

const temps: string[] = [];
afterAll(async () => {
  for (const t of temps) await rm(t, { recursive: true, force: true });
});
async function temp(): Promise<string> {
  const d = await mkdtemp(path.join(os.tmpdir(), "aegis-real-"));
  temps.push(d);
  return d;
}
async function context(dir: string, over: Partial<CheckContext> = {}): Promise<CheckContext> {
  return {
    root: dir,
    profile: await detectProject(dir),
    allowProjectTools: false,
    timeoutMs: 120_000,
    ...over,
  };
}

describe.skipIf(!hasGitleaks)("real gitleaks", () => {
  // Built at run time so this repository never contains a secret-looking value.
  const fakeKey = ["k3Jd9sLq", "2xVn8WpR", "4tYb7ZcA", "5mHe1UfG", "0aB"].join("");

  it("finds a high-entropy key in source and does not echo its value", async () => {
    const dir = await temp();
    await writeFile(path.join(dir, "app.js"), `const apiKey = "${fakeKey}";\n`);
    const r = await createGitleaksRunner(deps)(await context(dir));
    expect(r.outcome).toBe("findings");
    expect(r.findings[0]).toMatchObject({
      status: "finding",
      location: { file: "app.js", line: 1 },
    });
    expect(JSON.stringify(r)).not.toContain(fakeKey);
  });

  it("reports a gitignored secret file as a warning, and skips node_modules", async () => {
    const dir = await temp();
    await writeFile(path.join(dir, ".gitignore"), ".env\n");
    await writeFile(path.join(dir, ".env"), `KEY=${fakeKey}\n`);
    await mkdir(path.join(dir, "node_modules", "pkg"), { recursive: true });
    await writeFile(path.join(dir, "node_modules", "pkg", "index.js"), `const k = "${fakeKey}";\n`);
    const r = await createGitleaksRunner(deps)(await context(dir));
    expect(r.findings.map((f) => [f.location?.file, f.status])).toEqual([[".env", "warning"]]);
  });

  it("passes on a project without secrets", async () => {
    const dir = await temp();
    await writeFile(path.join(dir, "a.js"), "console.log('hello');\n");
    expect((await createGitleaksRunner(deps)(await context(dir))).outcome).toBe("passed");
  });

  // The project must not be able to configure, or silence, the scanner that checks it. Each of
  // these is something a careless person or an AI agent could add in seconds to make a leak vanish.
  describe("cannot be silenced by the project it scans", () => {
    const leak = `const apiKey = "${fakeKey}";`;

    it("an inline gitleaks:allow comment does not hide a secret", async () => {
      const dir = await temp();
      await writeFile(path.join(dir, "app.js"), `${leak} // gitleaks:allow\n`);
      const r = await createGitleaksRunner(deps)(await context(dir));
      expect(r.outcome).toBe("findings");
      expect(r.findings[0]).toMatchObject({ status: "finding", severity: "critical" });
    });

    it("a project .gitleaks.toml allowlist does not hide a secret", async () => {
      const dir = await temp();
      await writeFile(path.join(dir, "app.js"), `${leak}\n`);
      await writeFile(path.join(dir, ".gitleaks.toml"), "[allowlist]\npaths = ['''.*''']\n");
      expect((await createGitleaksRunner(deps)(await context(dir))).outcome).toBe("findings");
    });

    it("a project .gitleaksignore file cannot hide a secret: the check refuses to give a result instead", async () => {
      const dir = await temp();
      await writeFile(path.join(dir, "app.js"), `${leak}\n`);
      const first = await createGitleaksRunner(deps)(await context(dir));
      expect(first.outcome).toBe("findings");
      const line = first.findings[0]?.location?.line ?? 1;
      // Gitleaks matches entries as <path>:<rule>:<line> using the absolute path AEGIS passes, so
      // these entries really would hide the finding if the file were trusted (checked below).
      const ruleIds = first.findings.map(
        (f) => f.title.match(/\((.+)\)/)?.[1] ?? "generic-api-key",
      );
      const root = await realpath(dir);
      const entries = ruleIds.flatMap((id) => [
        `${dir}/app.js:${id}:${line}`,
        `${root}/app.js:${id}:${line}`,
      ]);
      await writeFile(path.join(dir, ".gitleaksignore"), entries.join("\n") + "\n");
      const r = await createGitleaksRunner(deps)(await context(dir));
      expect(r.outcome).toBe("tool-error"); // never "passed"
      expect(r.findings).toEqual([]);
      expect(r.reason).toContain(".gitleaksignore");
    });
  });
});

describe.skipIf(!hasSemgrep)("real semgrep with the AEGIS rules", { timeout: 120_000 }, () => {
  // Fixtures are copied out of 'tests/': Semgrep ignores folders named 'tests' by default.
  async function scan(kind: "vulnerable" | "corrected") {
    const dir = await temp();
    await cp(path.join(root, "tests/fixtures", kind), dir, { recursive: true });
    return createSemgrepRunner(deps, { rulesFile: SEMGREP_RULES_FILE })(await context(dir));
  }

  it("flags every deliberately vulnerable sample", async () => {
    const r = await scan("vulnerable");
    expect(r.outcome).toBe("findings");
    const hits = r.findings.map((f) => `${f.location?.file}:${f.location?.line} ${f.title}`).sort();
    expect(hits).toEqual([
      "react.jsx:3 Possible issue (aegis.js.dangerously-set-inner-html)",
      "sql.js:13 Possible issue (aegis.js.sql-tainted-variable)",
      "sql.js:3 Possible issue (aegis.js.sql-string-concat)",
      "sql.js:6 Possible issue (aegis.js.sql-string-concat)",
      "sql.js:9 Possible issue (aegis.js.sql-string-concat)",
      "xss.js:3 Possible issue (aegis.js.inner-html-assignment)",
      "xss.js:4 Possible issue (aegis.js.document-write)",
      "xss.js:5 Possible issue (aegis.js.insert-adjacent-html)",
    ]);
    expect(r.findings.find((f) => f.title.includes("sql-string-concat"))).toMatchObject({
      ruleId: "AEGIS-SEC-0001",
      severity: "critical",
    });
  });

  it("does not flag the corrected samples (no false positives on this fixture set)", async () => {
    const r = await scan("corrected");
    expect(r.outcome).toBe("passed");
    expect(r.findings).toEqual([]);
  });

  it("reports a tool error, not a pass, when the rule file is invalid", async () => {
    const dir = await temp();
    await writeFile(path.join(dir, "a.js"), "x = 1;\n");
    const bad = path.join(dir, "bad.yaml");
    await writeFile(bad, "rules:\n  - id: broken\n    pattern: <$T a={{ b: $X }} />\n");
    const r = await createSemgrepRunner(deps, { rulesFile: bad })(await context(dir));
    expect(r.outcome).toBe("tool-error");
  });
});

describe.skipIf(!hasNpm)("real npm audit", { timeout: 120_000 }, () => {
  it("reports the real advisories for a vulnerable lockfile (and a clear error when the registry is unreachable)", async () => {
    const dir = await temp();
    await cp(path.join(root, "tests/fixtures/vulnerable-deps"), dir, { recursive: true });
    const reachable = await fetch("https://registry.npmjs.org/-/ping", {
      signal: AbortSignal.timeout(8000),
    }).then(
      (r) => r.ok,
      () => false,
    );
    const r = await createNpmAuditRunner(deps)(await context(dir));
    // Never a pass, whatever the network does.
    expect(["findings", "tool-error"]).toContain(r.outcome);
    if (reachable) {
      expect(r.outcome).toBe("findings");
      const lodash = r.findings.filter((f) => f.title === "Vulnerable dependency: lodash");
      expect(lodash.length).toBeGreaterThan(0);
      expect(lodash.some((f) => f.severity === "high" || f.severity === "critical")).toBe(true);
    } else {
      expect(r.reason).toMatch(/npm audit failed|no readable report/);
    }
  });
});

describe.skipIf(!hasOsv)("real osv-scanner", { timeout: 120_000 }, () => {
  it("never reports a vulnerable lockfile as passed (findings with network, a tool error without)", async () => {
    const dir = await temp();
    await cp(path.join(root, "tests/fixtures/vulnerable-deps"), dir, { recursive: true });
    const r = await createOsvScannerRunner(deps)(await context(dir));
    expect(["findings", "tool-error"]).toContain(r.outcome);
    if (r.outcome === "tool-error") expect(r.reason).toContain("osv-scanner exited with code");
  });
});

describe("real tsc from the project's own node_modules", { timeout: 120_000 }, () => {
  it.skipIf(process.platform === "win32")(
    "reports a type error as a confirmed failure",
    async () => {
      const dir = await temp();
      await writeFile(
        path.join(dir, "package.json"),
        '{ "devDependencies": { "typescript": "*" } }',
      );
      await writeFile(
        path.join(dir, "tsconfig.json"),
        '{ "compilerOptions": { "strict": true, "noEmit": true }, "include": ["*.ts"] }',
      );
      await writeFile(path.join(dir, "bad.ts"), 'export const n: number = "not a number";\n');
      await cp(
        path.join(root, "node_modules/typescript"),
        path.join(dir, "node_modules/typescript"),
        { recursive: true },
      );
      await mkdir(path.join(dir, "node_modules/.bin"), { recursive: true });
      await symlink("../typescript/bin/tsc", path.join(dir, "node_modules/.bin/tsc"));

      const ctx = await context(dir, { allowProjectTools: true });
      const r = await createTscRunner(deps)(ctx);
      expect(r.outcome).toBe("failed");
      expect(r.findings[0]).toMatchObject({
        title: "TypeScript error TS2322",
        status: "confirmed-failure",
        location: { file: "bad.ts", line: 1 },
      });

      const skipped = await createTscRunner(deps)({ ...ctx, allowProjectTools: false });
      expect(skipped.outcome).toBe("skipped");
    },
  );
});

/**
 * ESLint is installed into a temporary project from the npm registry, so this needs network access.
 * If the install fails the test is reported as failing, never silently passing.
 */
describe.skipIf(!hasNpm)("real eslint", { timeout: 180_000 }, () => {
  it.skipIf(process.platform === "win32")(
    "reports lint problems from the project's own ESLint and config, and passes clean code",
    async () => {
      const dir = await temp();
      await writeFile(
        path.join(dir, "package.json"),
        JSON.stringify({
          name: "lint-demo",
          private: true,
          type: "module",
          devDependencies: { eslint: "^9" },
        }),
      );
      await writeFile(
        path.join(dir, "eslint.config.js"),
        'export default [{ files: ["**/*.js"], rules: { eqeqeq: "error", "no-unused-vars": "warn" } }];\n',
      );
      await new Promise<void>((resolve, reject) =>
        execFile(
          "npm",
          ["install", "--no-audit", "--no-fund", "--ignore-scripts"],
          { cwd: dir, timeout: 150_000 },
          (err) => (err ? reject(err) : resolve()),
        ),
      );
      await writeFile(
        path.join(dir, "bad.js"),
        "const unused = 1;\nexport const same = (a, b) => a == b;\n",
      );

      const ctx = await context(dir, { allowProjectTools: true });
      const bad = await createEslintRunner(deps)(ctx);
      expect(bad.outcome).not.toBe("passed");
      expect(bad.outcome).not.toBe("tool-error");
      const ids = bad.findings.map((f) => `${f.location?.file}:${f.location?.line}`);
      expect(ids).toContain("bad.js:2");
      expect(bad.findings.some((f) => f.title.includes("eqeqeq"))).toBe(true);

      await writeFile(path.join(dir, "bad.js"), "export const same = (a, b) => a === b;\n");
      const good = await createEslintRunner(deps)(ctx);
      expect(good.outcome).toBe("passed");

      const skipped = await createEslintRunner(deps)({ ...ctx, allowProjectTools: false });
      expect(skipped.outcome).toBe("skipped");
    },
  );
});
