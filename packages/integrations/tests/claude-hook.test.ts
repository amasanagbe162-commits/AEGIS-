import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Finding, ScanReport, Verdict } from "@aegis/core";
import {
  decideStop,
  parseStopHookInput,
  readAttempts,
  sessionKey,
  writeAttempts,
} from "../src/claude-hook.js";
import { withTempDir } from "./helpers.js";

const finding = (over: Partial<Finding> = {}): Finding => ({
  title: "Possible SQL injection",
  message: "SQL text is built by concatenation.",
  severity: "critical",
  confidence: "high",
  status: "finding",
  location: { file: "src/db.js", line: 12 },
  ...over,
});

function report(verdict: Verdict, findings: Finding[] = []): ScanReport {
  return {
    verdict,
    findings,
    policy: { summary: "", minRuleSeverity: "low", blockThreshold: "high" },
    summary: { checksPlanned: 4, checksPerformed: 2, checksNotPerformed: 2 },
  } as unknown as ScanReport;
}

describe("hook input", () => {
  it("parses what Claude Code sends and rejects anything else", () => {
    expect(
      parseStopHookInput(
        JSON.stringify({ session_id: "abc", stop_hook_active: true, cwd: "/work/app", extra: 1 }),
      ),
    ).toEqual({ sessionId: "abc", stopHookActive: true, cwd: "/work/app" });
    expect(parseStopHookInput("{}")).toEqual({ sessionId: "", stopHookActive: false });
    expect(parseStopHookInput("not json")).toBeUndefined();
    expect(parseStopHookInput("[1,2]")).toBeUndefined();
    expect(parseStopHookInput("null")).toBeUndefined();
    expect(parseStopHookInput(" ".repeat(300 * 1024))).toBeUndefined();
  });

  it("never lets a session id choose a file path", () => {
    expect(sessionKey("abc-123_DEF")).toBe("abc-123_DEF");
    for (const evil of ["../../etc/passwd", "a/b", "x".repeat(200), "a b", ""]) {
      expect(sessionKey(evil)).toMatch(/^s-[0-9a-f]{32}$/);
    }
  });
});

describe("stop decision", () => {
  it("lets Claude finish when the result is clean", () => {
    expect(decideStop({ report: report("clean"), attemptsSoFar: 2, maxAttempts: 3 })).toEqual({
      exitCode: 0,
      attempts: 0,
    });
  });

  it("sends Claude back for blocking findings and names them", () => {
    const d = decideStop({
      report: report("findings", [finding()]),
      attemptsSoFar: 0,
      maxAttempts: 3,
    });
    expect(d.exitCode).toBe(2);
    expect(d.attempts).toBe(1);
    expect(d.stderr).toContain("[critical] Possible SQL injection (src/db.js:12)");
    expect(d.stderr).toContain("attempt 1 of 3");
    expect(d.stderr).toContain("Do not disable the check");
  });

  it("does not list findings that do not block", () => {
    const quiet = finding({ title: "Style nit", severity: "low", status: "warning" });
    const d = decideStop({
      report: report("findings", [finding(), quiet]),
      attemptsSoFar: 0,
      maxAttempts: 3,
    });
    expect(d.stderr).toContain("1 blocking finding(s)");
    expect(d.stderr).not.toContain("Style nit");
  });

  it("stops blocking after the attempt limit and says the problem is unresolved", () => {
    const r = report("findings", [finding()]);
    expect(decideStop({ report: r, attemptsSoFar: 2, maxAttempts: 3 }).exitCode).toBe(2);
    const last = decideStop({ report: r, attemptsSoFar: 3, maxAttempts: 3 });
    expect(last.exitCode).toBe(0);
    expect(last.notice).toContain("unresolved after 3 attempt(s)");
    expect(last.attempts).toBe(0);
  });

  it("never blocks on incomplete checks or when the checks could not run", () => {
    const incomplete = decideStop({
      report: report("incomplete"),
      attemptsSoFar: 0,
      maxAttempts: 3,
    });
    expect(incomplete.exitCode).toBe(0);
    expect(incomplete.notice).toContain("INCOMPLETE");
    expect(incomplete.notice).toContain("not a clean result");
    const broken = decideStop({ report: report("error"), attemptsSoFar: 0, maxAttempts: 3 });
    expect(broken.exitCode).toBe(0);
    expect(broken.notice).toContain("nothing was verified");
  });

  it("redacts secrets and caps the message size", () => {
    const secret = "ghp_" + "a1B2c3D4e5".repeat(4);
    const d = decideStop({
      report: report(
        "findings",
        Array.from({ length: 30 }, (_, i) => finding({ title: `Leak ${i} ${secret}` })),
      ),
      attemptsSoFar: 0,
      maxAttempts: 3,
    });
    expect(d.stderr).not.toContain(secret);
    expect((d.stderr ?? "").length).toBeLessThanOrEqual(3500);
    expect(d.stderr).toContain("...and 22 more");
  });
});

describe("attempt state", () => {
  it("stores a number only, resets cleanly, and ignores itself in Git", async () => {
    await withTempDir(async (dir) => {
      expect(await readAttempts(dir, "s1")).toBe(0);
      await writeAttempts(dir, "s1", 2);
      expect(await readAttempts(dir, "s1")).toBe(2);
      const file = path.join(dir, ".aegis/state/claude-stop-s1.json");
      expect(JSON.parse(await readFile(file, "utf8"))).toEqual({ attempts: 2 });
      expect(await readFile(path.join(dir, ".aegis/state/.gitignore"), "utf8")).toBe("*\n");
      await writeAttempts(dir, "s1", 0);
      expect(await readAttempts(dir, "s1")).toBe(0);
      expect(
        (await readdir(path.join(dir, ".aegis/state"))).filter((f) => f.endsWith(".json")),
      ).toEqual([]);
    });
  });

  it("treats damaged or absurd state as zero attempts", async () => {
    await withTempDir(async (dir) => {
      const { mkdir, writeFile } = await import("node:fs/promises");
      await mkdir(path.join(dir, ".aegis/state"), { recursive: true });
      const file = path.join(dir, ".aegis/state/claude-stop-s2.json");
      await writeFile(file, "garbage");
      expect(await readAttempts(dir, "s2")).toBe(0);
      await writeFile(file, JSON.stringify({ attempts: -4 }));
      expect(await readAttempts(dir, "s2")).toBe(0);
      await writeFile(file, JSON.stringify({ attempts: 1e9 }));
      expect(await readAttempts(dir, "s2")).toBe(0);
    });
  });
});
