import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  amend,
  approve,
  learningRecordSchema,
  loadRecords,
  nextId,
  propose,
  reject,
  saveRecord,
  supersede,
  verify,
  type LearningRecord,
} from "../src/index.js";
import { withTempDir } from "./helpers.js";

const T0 = "2026-10-25T10:00:00.000Z";
const T1 = "2026-10-25T11:00:00.000Z";

function record(over: Partial<LearningRecord> = {}): LearningRecord {
  return {
    version: 1,
    id: "LR-0001",
    status: "observed",
    createdAt: T0,
    updatedAt: T0,
    title: "Raw SQL built from request data",
    category: "security",
    languages: ["javascript"],
    issue: "An agent built a SQL string from a query parameter.",
    evidence: [],
    ...over,
  };
}
const check = (verdict: "clean" | "findings" | "incomplete", performed = 4, planned = 4) =>
  ({
    kind: "aegis-check",
    at: T1,
    level: "standard",
    verdict,
    checksPerformed: performed,
    checksPlanned: planned,
  }) as const;

describe("lifecycle", () => {
  it("walks observed -> proposed -> verified -> approved only with real evidence and a reviewer", () => {
    let r = record({ rootCause: "Input was concatenated.", correction: "Use bound parameters." });
    const p = propose(r, T1);
    expect(p.ok && p.record.status).toBe("proposed");
    r = p.ok ? p.record : r;

    expect(verify(r, T1)).toEqual({
      ok: false,
      message: expect.stringContaining("no AEGIS check"),
    });
    const withNote = {
      ...r,
      evidence: [{ kind: "note", at: T1, text: "I tested it, trust me" } as const],
    };
    expect(verify(withNote, T1).ok).toBe(false);

    const ok = verify({ ...r, evidence: [check("clean")] }, T1);
    expect(ok.ok && ok.record.status).toBe("verified");
    const v = ok.ok ? ok.record : r;

    const a = approve(v, "isaacco", "Matches rule AEGIS-SEC-0001.", T1);
    expect(a.ok && a.record.status).toBe("approved");
    expect(a.ok && a.record.review?.reviewer).toBe("isaacco");
  });

  it("an incomplete or dirty check does not verify, and only the LATEST check counts", () => {
    const base = record({ status: "proposed", rootCause: "x", correction: "y" });
    const incomplete = verify({ ...base, evidence: [check("incomplete", 2, 4)] }, T1);
    expect(incomplete.ok).toBe(false);
    expect(!incomplete.ok && incomplete.message).toContain("INCOMPLETE");
    expect(verify({ ...base, evidence: [check("findings")] }, T1).ok).toBe(false);
    expect(verify({ ...base, evidence: [check("clean"), check("findings")] }, T1).ok).toBe(false);
    // "clean" with checks skipped or nothing planned is not trusted either
    expect(verify({ ...base, evidence: [check("clean", 3, 4)] }, T1).ok).toBe(false);
    expect(verify({ ...base, evidence: [check("clean", 0, 0)] }, T1).ok).toBe(false);
  });

  it("cannot skip steps or approve what is not verified", () => {
    expect(propose(record(), T1).ok).toBe(false);
    expect(approve(record({ status: "proposed" }), "a", "b", T1).ok).toBe(false);
    expect(approve(record(), "a", "b", T1).ok).toBe(false);
    expect(supersede(record({ status: "verified" }), "LR-0002", T1).ok).toBe(false);
  });

  it("rejects, supersedes, and voids verification when the substance is amended", () => {
    expect(reject(record(), "a", "not useful", T1).ok).toBe(true);
    expect(reject(record({ status: "approved" }), "a", "x", T1).ok).toBe(false);
    const s = supersede(record({ status: "approved" }), "LR-0002", T1);
    expect(s.ok && s.record.supersededBy).toBe("LR-0002");
    const am = amend(
      record({ status: "verified", rootCause: "x", correction: "y", evidence: [check("clean")] }),
      { correction: "z" },
      T1,
    );
    expect(am.ok && am.record.status).toBe("observed");
    expect(am.ok && am.record.evidence).toEqual([]);
    expect(amend(record({ status: "rejected" }), {}, T1).ok).toBe(false);
  });
});

describe("schema", () => {
  it("refuses pasted code and unknown fields", () => {
    expect(
      learningRecordSchema.safeParse(record({ issue: "see ```const q = 'SELECT'```" })).success,
    ).toBe(false);
    expect(learningRecordSchema.safeParse({ ...record(), extra: 1 }).success).toBe(false);
    expect(learningRecordSchema.safeParse(record({ id: "../x" as never })).success).toBe(false);
  });
});

describe("store", () => {
  it("saves, loads, numbers new records, and redacts secrets", async () => {
    await withTempDir(async (dir) => {
      expect((await loadRecords(dir)).records).toEqual([]);
      const secret = "ghp_" + "a1B2c3D4e5".repeat(4);
      const saved = await saveRecord(
        dir,
        record({ issue: `Agent committed token ${secret} to config.` }),
        true,
      );
      expect(saved.redacted).toBe(true);
      const raw = await readFile(path.join(dir, ".aegis/learning/LR-0001.json"), "utf8");
      expect(raw).not.toContain(secret);

      const loaded = await loadRecords(dir);
      expect(loaded.records).toHaveLength(1);
      expect(nextId(loaded.records, loaded.problems)).toBe("LR-0002");
    });
  });

  it("never overwrites an existing id when creating", async () => {
    await withTempDir(async (dir) => {
      await saveRecord(dir, record(), true);
      await expect(saveRecord(dir, record({ title: "other" }), true)).rejects.toThrow();
      expect((await loadRecords(dir)).records[0]?.title).toBe("Raw SQL built from request data");
    });
  });

  it.skipIf(process.platform === "win32")(
    "reports damaged, mismatched and symlinked files instead of dropping them silently",
    async () => {
      await withTempDir(async (dir) => {
        const d = path.join(dir, ".aegis/learning");
        await mkdir(d, { recursive: true });
        await writeFile(path.join(d, "LR-0001.json"), "{ nope");
        await writeFile(path.join(d, "LR-0002.json"), JSON.stringify(record({ id: "LR-0003" })));
        await writeFile(
          path.join(dir, "elsewhere.json"),
          JSON.stringify(record({ id: "LR-0004" })),
        );
        await symlink(path.join(dir, "elsewhere.json"), path.join(d, "LR-0004.json"));
        const loaded = await loadRecords(dir);
        expect(loaded.records).toEqual([]);
        expect(loaded.problems.map((p) => p.file)).toEqual([
          "LR-0001.json",
          "LR-0002.json",
          "LR-0004.json",
        ]);
        expect(loaded.problems[1]?.message).toContain("does not match");
        // damaged files still reserve their ids so a new record can never collide
        expect(nextId(loaded.records, loaded.problems)).toBe("LR-0005");
      });
    },
  );
});
