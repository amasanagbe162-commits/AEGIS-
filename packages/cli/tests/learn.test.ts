import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { CheckRunner, Finding } from "@aegis/core";
import { aegis, makeRuntime, withTempDir } from "./helpers.js";

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
};
const skipped: CheckRunner = async () => ({
  outcome: "skipped",
  reason: "gitleaks was not found on PATH",
  findings: [],
});
const clock = () => new Date("2026-10-25T12:00:00.000Z");

const read = (dir: string, rel: string) => readFile(path.join(dir, ...rel.split("/")), "utf8");
async function project(dir: string): Promise<void> {
  await writeFile(path.join(dir, "package.json"), "{}");
}
const add = (dir: string, extra: string[] = []) =>
  aegis(
    [
      "learn",
      "add",
      "--title",
      "Raw SQL from request data",
      "--issue",
      "The agent built SQL from a query parameter.",
      "--category",
      "security",
      "--language",
      "javascript",
      ...extra,
    ],
    makeRuntime(dir, { now: clock }),
  );
const FIX = [
  "--root-cause",
  "Input was concatenated into the SQL text.",
  "--correction",
  "Always pass values as bound parameters.",
];

describe("aegis learn add / list / show", () => {
  it("records an observed issue, and proposes it when cause and correction are given", async () => {
    await withTempDir(async (dir) => {
      await project(dir);
      const a = makeRuntime(dir, { now: clock });
      expect(
        await aegis(["learn", "add", "--title", "T", "--issue", "I", "--category", "security"], a),
      ).toBe(0);
      expect(a.stdout()).toContain("LR-0001 (observed)");
      expect(await add(dir, FIX)).toBe(0);
      const list = makeRuntime(dir);
      await aegis(["learn", "list"], list);
      expect(list.stdout()).toContain("LR-0001  observed");
      expect(list.stdout()).toContain("LR-0002  proposed");
      const only = makeRuntime(dir);
      await aegis(["learn", "list", "--status", "proposed", "--json"], only);
      expect(JSON.parse(only.stdout())).toHaveLength(1);
      const show = makeRuntime(dir);
      await aegis(["learn", "show", "lr-0002"], show);
      expect(show.stdout()).toContain("Always pass values as bound parameters.");
    });
  });

  it("refuses pasted code, redacts secrets, and needs the required options", async () => {
    await withTempDir(async (dir) => {
      await project(dir);
      const code = makeRuntime(dir);
      expect(
        await aegis(
          [
            "learn",
            "add",
            "--title",
            "T",
            "--issue",
            "see ```select * from x```",
            "--category",
            "security",
          ],
          code,
        ),
      ).toBe(2);
      const secret = "ghp_" + "a1B2c3D4e5".repeat(4);
      const red = makeRuntime(dir, { now: clock });
      expect(
        await aegis(
          [
            "learn",
            "add",
            "--title",
            "T",
            "--issue",
            `Token ${secret} was committed`,
            "--category",
            "security",
          ],
          red,
        ),
      ).toBe(0);
      expect(red.stdout()).toContain("redacted");
      expect(await read(dir, ".aegis/learning/LR-0001.json")).not.toContain(secret);
      const missing = makeRuntime(dir);
      expect(await aegis(["learn", "add", "--title", "T"], missing)).toBe(2);
    });
  });

  it("reports a damaged record and exits 2 instead of ignoring it", async () => {
    await withTempDir(async (dir) => {
      await project(dir);
      await mkdir(path.join(dir, ".aegis/learning"), { recursive: true });
      await writeFile(path.join(dir, ".aegis/learning/LR-0001.json"), "{ broken");
      const c = makeRuntime(dir);
      expect(await aegis(["learn", "list"], c)).toBe(2);
      expect(c.stderr()).toContain("LR-0001.json");
      const d = makeRuntime(dir);
      await aegis(["doctor"], d);
      expect(d.stdout()).toContain("[warn] Learning records: LR-0001.json");
    });
  });
});

describe("aegis learn verify", () => {
  it("verifies only after a clean, complete AEGIS check, and records what AEGIS saw", async () => {
    await withTempDir(async (dir) => {
      await project(dir);
      await add(dir, FIX);
      const c = makeRuntime(dir, { runners: allPass, now: clock });
      expect(await aegis(["learn", "verify", "LR-0001"], c)).toBe(0);
      expect(c.stdout()).toContain("CLEAN (2/2 checks ran");
      const rec = JSON.parse(await read(dir, ".aegis/learning/LR-0001.json")) as {
        status: string;
        evidence: { kind: string; verdict: string }[];
      };
      expect(rec.status).toBe("verified");
      expect(rec.evidence[0]).toMatchObject({ kind: "aegis-check", verdict: "clean" });
    });
  });

  it("stays proposed when checks are incomplete or find problems, and says why", async () => {
    await withTempDir(async (dir) => {
      await project(dir);
      await add(dir, FIX);
      const inc = makeRuntime(dir, { runners: { ...allPass, secrets: skipped }, now: clock });
      expect(await aegis(["learn", "verify", "LR-0001"], inc)).toBe(1);
      expect(inc.stdout()).toContain("INCOMPLETE");
      expect(inc.stdout()).toContain("stays proposed");
      const bad = makeRuntime(dir, {
        runners: {
          ...allPass,
          "static-analysis": async () => ({ outcome: "findings" as const, findings: [finding] }),
        },
        now: clock,
      });
      expect(await aegis(["learn", "verify", "LR-0001"], bad)).toBe(1);
      expect(JSON.parse(await read(dir, ".aegis/learning/LR-0001.json")).status).toBe("proposed");
    });
  });

  it("will not verify an observed record", async () => {
    await withTempDir(async (dir) => {
      await project(dir);
      await add(dir);
      const c = makeRuntime(dir, { runners: allPass });
      expect(await aegis(["learn", "verify", "LR-0001"], c)).toBe(2);
      expect(c.stderr()).toContain("only a proposed record");
    });
  });
});

describe("aegis learn review", () => {
  async function verified(dir: string): Promise<void> {
    await project(dir);
    await add(dir, FIX);
    await aegis(["learn", "verify", "LR-0001"], makeRuntime(dir, { runners: allPass, now: clock }));
  }
  const approveArgs = [
    "learn",
    "review",
    "LR-0001",
    "--approve",
    "--reviewer",
    "isaacco",
    "--reason",
    "Matches AEGIS-SEC-0001.",
  ];

  it("approval needs a person at a terminal: it cannot be scripted", async () => {
    await withTempDir(async (dir) => {
      await verified(dir);
      const c = makeRuntime(dir, { now: clock });
      expect(await aegis([...approveArgs, "--yes"], c)).toBe(2);
      expect(JSON.parse(await read(dir, ".aegis/learning/LR-0001.json")).status).toBe("verified");
    });
  });

  it("approves after an explicit confirmation, and respects a 'no'", async () => {
    await withTempDir(async (dir) => {
      await verified(dir);
      const no = makeRuntime(dir, { interactive: true, script: { confirms: [false] }, now: clock });
      expect(await aegis(approveArgs, no)).toBe(0);
      expect(JSON.parse(await read(dir, ".aegis/learning/LR-0001.json")).status).toBe("verified");
      const yes = makeRuntime(dir, { interactive: true, script: { confirms: [true] }, now: clock });
      expect(await aegis(approveArgs, yes)).toBe(0);
      const rec = JSON.parse(await read(dir, ".aegis/learning/LR-0001.json")) as {
        status: string;
        review: { reviewer: string };
      };
      expect(rec.status).toBe("approved");
      expect(rec.review.reviewer).toBe("isaacco");
    });
  });

  it("cannot approve an unverified record, and needs exactly one decision", async () => {
    await withTempDir(async (dir) => {
      await project(dir);
      await add(dir, FIX);
      const c = makeRuntime(dir, { interactive: true, script: { confirms: [true] } });
      expect(await aegis(approveArgs, c)).toBe(2);
      expect(c.stderr()).toContain("only a verified record");
      const both = makeRuntime(dir);
      expect(
        await aegis(
          [
            "learn",
            "review",
            "LR-0001",
            "--approve",
            "--reject",
            "--reviewer",
            "a",
            "--reason",
            "b",
          ],
          both,
        ),
      ).toBe(2);
    });
  });

  it("rejection works without a terminal", async () => {
    await withTempDir(async (dir) => {
      await project(dir);
      await add(dir, FIX);
      const c = makeRuntime(dir, { now: clock });
      expect(
        await aegis(
          [
            "learn",
            "review",
            "LR-0001",
            "--reject",
            "--reviewer",
            "isaacco",
            "--reason",
            "Too vague.",
          ],
          c,
        ),
      ).toBe(0);
      expect(JSON.parse(await read(dir, ".aegis/learning/LR-0001.json")).status).toBe("rejected");
    });
  });

  it("amending clears verification, so a changed lesson must be checked again", async () => {
    await withTempDir(async (dir) => {
      await verified(dir);
      const c = makeRuntime(dir, { now: clock });
      expect(
        await aegis(["learn", "amend", "LR-0001", "--correction", "Use an ORM query builder."], c),
      ).toBe(0);
      const rec = JSON.parse(await read(dir, ".aegis/learning/LR-0001.json")) as {
        status: string;
        evidence: unknown[];
      };
      expect(rec.status).toBe("proposed");
      expect(rec.evidence).toEqual([]);
    });
  });
});

describe("approved lessons reach the agent instructions", () => {
  it("only approved lessons appear, and sync refreshes the files", async () => {
    await withTempDir(async (dir) => {
      await project(dir);
      await add(dir, FIX);
      await aegis(
        ["learn", "verify", "LR-0001"],
        makeRuntime(dir, { runners: allPass, now: clock }),
      );
      const sync = ["agents", "sync", "--yes", "--agent", "claude-code", "codex"];

      await aegis(sync, makeRuntime(dir));
      expect(await read(dir, ".claude/rules/aegis.md")).not.toContain("Lessons approved");

      await aegis(
        ["learn", "review", "LR-0001", "--approve", "--reviewer", "isaacco", "--reason", "ok"],
        makeRuntime(dir, { interactive: true, script: { confirms: [true] }, now: clock }),
      );
      const verify = makeRuntime(dir);
      expect(await aegis(["agents", "verify", "--agent", "claude-code", "codex"], verify)).toBe(1);
      expect(verify.stdout()).toContain("[stale]");

      await aegis(sync, makeRuntime(dir));
      expect(await read(dir, ".claude/rules/aegis.md")).toContain(
        "Always pass values as bound parameters.",
      );
      expect(await read(dir, "AGENTS.md")).toContain("Approved lessons for this project");
      expect(
        await aegis(["agents", "verify", "--agent", "claude-code", "codex"], makeRuntime(dir)),
      ).toBe(0);
    });
  });
});
