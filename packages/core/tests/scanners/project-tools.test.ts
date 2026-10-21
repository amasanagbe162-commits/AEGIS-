import { chmod, mkdir, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createEslintRunner,
  createTscRunner,
  findProjectTool,
  parseEslintOutput,
  parseTscOutput,
} from "../../src/index.js";
import { ctx, exited, fakeDeps, withTempDir } from "./helpers.js";

async function installTool(root: string, name: string) {
  const real = path.join(root, "node_modules", name, "bin", name);
  await mkdir(path.dirname(real), { recursive: true });
  await writeFile(real, "#!/usr/bin/env node\n", { mode: 0o755 });
  await mkdir(path.join(root, "node_modules", ".bin"), { recursive: true });
  await symlink(path.join("..", name, "bin", name), path.join(root, "node_modules", ".bin", name));
}

describe("findProjectTool", () => {
  it.skipIf(process.platform === "win32")(
    "finds a tool whose real path stays inside the project",
    async () => {
      await withTempDir(async (root) => {
        await installTool(root, "tsc");
        expect(await findProjectTool(root, "tsc")).toBe(
          path.join(root, "node_modules", ".bin", "tsc"),
        );
      });
    },
  );

  it.skipIf(process.platform === "win32")(
    "rejects a tool that resolves outside the project",
    async () => {
      await withTempDir(async (root) => {
        await withTempDir(async (outside) => {
          const evil = path.join(outside, "evil.js");
          await writeFile(evil, "#!/usr/bin/env node\n", { mode: 0o755 });
          await mkdir(path.join(root, "node_modules", ".bin"), { recursive: true });
          await symlink(evil, path.join(root, "node_modules", ".bin", "tsc"));
          expect(await findProjectTool(root, "tsc")).toBeUndefined();
        });
      });
    },
  );

  it("returns nothing when the tool is not installed", async () => {
    await withTempDir(async (root) => {
      expect(await findProjectTool(root, "tsc")).toBeUndefined();
    });
  });

  it.skipIf(process.platform === "win32")("rejects directories", async () => {
    await withTempDir(async (root) => {
      await mkdir(path.join(root, "node_modules", ".bin", "tsc"), { recursive: true });
      await chmod(path.join(root, "node_modules", ".bin", "tsc"), 0o755);
      expect(await findProjectTool(root, "tsc")).toBeUndefined();
    });
  });
});

describe("tsc and eslint are opt-in", () => {
  it.each([
    ["tsc", createTscRunner],
    ["eslint", createEslintRunner],
  ] as const)(
    "%s is skipped, and never executed, unless project tools are allowed",
    async (_name, make) => {
      await withTempDir(async (root) => {
        await installTool(root, "tsc");
        await installTool(root, "eslint");
        const { deps, calls } = fakeDeps([], exited(0, "[]"));
        const r = await make(deps)(ctx(root, { allowProjectTools: false }));
        expect(r.outcome).toBe("skipped");
        expect(r.reason).toContain("--allow-project-tools");
        expect(calls).toHaveLength(0);
      });
    },
  );

  it.each([
    ["tsc", createTscRunner],
    ["eslint", createEslintRunner],
  ] as const)("%s is skipped when allowed but not installed in the project", async (name, make) => {
    await withTempDir(async (root) => {
      const { deps, calls } = fakeDeps([name], exited(0, "[]")); // a global install must NOT be used
      const r = await make(deps)(ctx(root, { allowProjectTools: true }));
      expect(r.outcome).toBe("skipped");
      expect(calls).toHaveLength(0);
    });
  });
});

describe("tsc adapter", () => {
  const sample = [
    "src/a.ts(10,5): error TS2322: Type 'string' is not assignable to type 'number'.",
    "src/b.ts(3,1): error TS2304: Cannot find name 'foo'.",
    "  The previous line continues here.",
    "src/c.ts(1,1): warning TS6133: unused.",
  ].join("\n");

  it("parses tsc output into confirmed failures and ignores other lines", () => {
    const f = parseTscOutput("/p", sample);
    expect(f).toHaveLength(2);
    expect(f[0]).toMatchObject({
      title: "TypeScript error TS2322",
      severity: "high",
      confidence: "high",
      status: "confirmed-failure",
      location: { file: "src/a.ts", line: 10 },
    });
  });

  it.skipIf(process.platform === "win32")(
    "runs the project's tsc with fixed arguments and maps exit codes",
    async () => {
      await withTempDir(async (root) => {
        await installTool(root, "tsc");
        const run = async (result: ReturnType<typeof exited>) => {
          const { deps, calls } = fakeDeps([], result);
          return { r: await createTscRunner(deps)(ctx(root, { allowProjectTools: true })), calls };
        };
        const ok = await run(exited(0));
        expect(ok.r.outcome).toBe("passed");
        expect(ok.calls[0]?.args).toEqual(["--noEmit", "-p", "tsconfig.json", "--pretty", "false"]);
        expect(ok.calls[0]?.command).toBe(path.join(root, "node_modules", ".bin", "tsc"));

        const bad = await run(exited(2, sample));
        expect(bad.r.outcome).toBe("failed");
        expect(bad.r.findings).toHaveLength(2);

        const odd = await run(exited(1, "something unparseable"));
        expect(odd.r.outcome).toBe("tool-error");
      });
    },
  );
});

describe("eslint adapter", () => {
  const report = [
    {
      filePath: "/p/src/a.ts",
      messages: [
        {
          ruleId: "no-unused-vars",
          severity: 2,
          message: "'x' is defined but never used.",
          line: 4,
        },
        { ruleId: "prefer-const", severity: 1, message: "Use const.", line: 9 },
      ],
    },
    { filePath: "/p/src/b.ts", messages: [] },
  ];

  it("maps errors to confirmed failures and warnings to warnings", () => {
    const f = parseEslintOutput("/p", report)!;
    expect(f).toHaveLength(2);
    expect(f[0]).toMatchObject({
      status: "confirmed-failure",
      severity: "medium",
      location: { file: "src/a.ts", line: 4 },
    });
    expect(f[1]).toMatchObject({ status: "warning", severity: "low" });
    expect(parseEslintOutput("/p", { not: "an array" })).toBeUndefined();
  });

  it.skipIf(process.platform === "win32")(
    "maps exit codes: 0 passed, 1 errors, warnings only, 2 failure",
    async () => {
      await withTempDir(async (root) => {
        await installTool(root, "eslint");
        const run = async (result: ReturnType<typeof exited>) => {
          const { deps, calls } = fakeDeps([], result);
          return {
            r: await createEslintRunner(deps)(ctx(root, { allowProjectTools: true })),
            calls,
          };
        };
        const ok = await run(exited(0, "[]"));
        expect(ok.r.outcome).toBe("passed");
        expect(ok.calls[0]?.args).toEqual(["--format", "json", "."]);

        expect((await run(exited(1, JSON.stringify(report)))).r.outcome).toBe("failed");
        const warnOnly = [
          { filePath: "/p/a.ts", messages: [{ ruleId: "x", severity: 1, message: "w", line: 1 }] },
        ];
        expect((await run(exited(0, JSON.stringify(warnOnly)))).r.outcome).toBe("findings");

        const broken = await run(
          exited(2, "", "Oops! Something went wrong! ESLint couldn't find an eslint.config file."),
        );
        expect(broken.r.outcome).toBe("tool-error");
        expect(broken.r.reason).toContain("eslint.config");
        expect((await run(exited(1, "not json"))).r.outcome).toBe("tool-error");
      });
    },
  );
});
