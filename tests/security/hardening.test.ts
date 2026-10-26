import { mkdtemp, readdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  parseConfig,
  parseMasterFile,
  parseRule,
  stageBundle,
  type CheckRunner,
  type Finding,
} from "../../packages/core/src/index.js";
import { aegis, makeRuntime } from "../../packages/cli/tests/helpers.js";

const dirs: string[] = [];
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});
async function temp(): Promise<string> {
  const d = await mkdtemp(path.join(os.tmpdir(), "aegis-sec-"));
  dirs.push(d);
  return d;
}

describe("hostile input to the parsers", () => {
  const bomb = (() => {
    const lines = ['a: &a ["x","x","x","x","x","x","x","x","x"]'];
    let prev = "a";
    for (let i = 0; i < 9; i++) {
      const n = String.fromCharCode(98 + i);
      lines.push(`${n}: &${n} [${Array(9).fill(`*${prev}`).join(",")}]`);
      prev = n;
    }
    return lines.join("\n");
  })();

  it("refuses YAML aliases (a billion-laughs document) quickly", () => {
    const started = Date.now();
    for (const r of [parseRule(bomb, "x.yaml"), parseMasterFile(bomb, "m.aegis")]) {
      expect(r.ok).toBe(false);
      expect(JSON.stringify(r)).toContain("aliases are not allowed");
    }
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("refuses code-bearing YAML tags, oversized files and prototype-pollution keys", () => {
    expect(JSON.stringify(parseRule("a: !!js/function 'function(){}'", "x.yaml"))).toContain("tag");
    expect(JSON.stringify(parseRule("x: " + "a".repeat(300 * 1024), "x.yaml"))).toContain(
      "larger than",
    );
    const polluted = parseConfig(
      '{"version":1,"__proto__":{"polluted":true},"constructor":{"prototype":{"p":1}}}',
    );
    expect(polluted.ok).toBe(false);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe.skipIf(process.platform === "win32")(
  "a repository that ships .aegis as a symbolic link",
  () => {
    async function trap() {
      const project = await temp();
      const target = await temp();
      await writeFile(path.join(project, "package.json"), "{}");
      await symlink(target, path.join(project, ".aegis"));
      return { project, target };
    }

    it("learning records are not written through it", async () => {
      const { project, target } = await trap();
      const c = makeRuntime(project);
      expect(
        await aegis(["learn", "add", "--title", "T", "--issue", "I", "--category", "security"], c),
      ).toBe(2);
      expect(await readdir(target)).toEqual([]);
    });

    it("the Stop hook writes nothing there, and fails open instead of blocking without a limit", async () => {
      const { project, target } = await trap();
      const finding: Finding = {
        title: "Possible SQL injection",
        message: "m",
        severity: "critical",
        confidence: "high",
        status: "finding",
      };
      const runners: Record<string, CheckRunner> = Object.fromEntries(
        [
          "secrets",
          "static-analysis",
          "typecheck",
          "lint",
          "dependency-audit",
          "dependency-vulnerabilities",
        ].map((id) => [
          id,
          id === "static-analysis"
            ? async () => ({ outcome: "findings" as const, findings: [finding] })
            : async () => ({ outcome: "passed" as const, findings: [] }),
        ]),
      );
      const c = makeRuntime(project, {
        runners,
        readStdin: async () => JSON.stringify({ session_id: "s", cwd: project }),
      });
      expect(await aegis(["hook", "claude-stop"], c)).toBe(0);
      expect(c.stdout()).toContain("cannot record its attempt count");
      expect(await readdir(target)).toEqual([]);
    });

    it("a rule update is not staged through it", async () => {
      const { project, target } = await trap();
      const manifest = {
        bundleVersion: "9.0.0",
        minAegisVersion: "0.0.0",
        createdAt: "2026-10-25T12:00:00.000Z",
        keyId: "k",
        rules: [{ path: "security/AEGIS-SEC-0001.yaml", content: "id: x\n" }],
      } as const;
      await expect(
        stageBundle(project, { ...manifest, rules: [...manifest.rules] }),
      ).rejects.toThrow("symbolic link");
      expect(await readdir(target)).toEqual([]);
    });
  },
);
