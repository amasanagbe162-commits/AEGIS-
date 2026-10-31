import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  EXIT,
  inspectProject,
  renderJson,
  renderText,
  type CheckRunner,
  type Finding,
  type ScanReport,
} from "../src/index.js";
import { repoRoot } from "./helpers.js";

const rulesDir = path.join(repoRoot, "packages/rules/data");
const nextjs = path.join(repoRoot, "tests/fixtures/nextjs-sample");

const pass: CheckRunner = async () => ({ outcome: "passed", findings: [] });
const allPass = Object.fromEntries(
  [
    "secrets",
    "static-analysis",
    "typecheck",
    "lint",
    "dependency-audit",
    "dependency-vulnerabilities",
  ].map((id) => [id, pass]),
);
const finding = (over: Partial<Finding> = {}): Finding => ({
  title: "Possible SQL injection",
  message: "String-built SQL near request data.",
  severity: "critical",
  confidence: "high",
  status: "finding",
  ...over,
});
const withFindings =
  (...f: Finding[]): CheckRunner =>
  async () => ({ outcome: "findings", findings: f });

const run = (over: Partial<Parameters<typeof inspectProject>[0]> = {}) =>
  inspectProject({ root: nextjs, rulesDir, now: () => new Date("2026-01-01T00:00:00Z"), ...over });

describe("inspectProject: honest reporting", () => {
  it("is INCOMPLETE (exit 3) when checks are not implemented, never clean", async () => {
    const r = await run();
    expect(r.verdict).toBe("incomplete");
    expect(r.exitCode).toBe(EXIT.INCOMPLETE);
    expect(r.checks.length).toBeGreaterThan(0);
    expect(r.checks.every((c) => c.outcome === "skipped")).toBe(true);
    expect(r.summary.checksPerformed).toBe(0);
    expect(r.summary.checksNotPerformed).toBe(r.checks.length);
    expect(r.notes.join(" ")).toContain("not performed");
  });

  it("plans only the checks that apply and lists the rest as not applicable", async () => {
    const r = await run();
    expect(r.checks.map((c) => c.id)).toEqual(["secrets", "static-analysis", "typecheck", "lint"]);
    expect(r.checksNotApplicable).toEqual([]);
    const advanced = await run({ level: "advanced" });
    expect(advanced.checks.map((c) => c.id)).toContain("dependency-audit");
  });

  it("is CLEAN (exit 0) only when every planned check ran and passed", async () => {
    const r = await run({ runners: allPass });
    expect(r.verdict).toBe("clean");
    expect(r.exitCode).toBe(EXIT.OK);
    expect(r.notes.join(" ")).toContain("does not prove the code is secure");
  });

  it("is INCOMPLETE when one passing check is joined by a skipped one", async () => {
    const r = await run({ runners: { secrets: pass } });
    expect(r.verdict).toBe("incomplete");
    expect(r.summary.checksPerformed).toBe(1);
  });

  it("reports FINDINGS (exit 1) for a critical finding and sorts by severity", async () => {
    const r = await run({
      runners: {
        ...allPass,
        "static-analysis": withFindings(finding({ severity: "low", title: "minor" }), finding()),
      },
    });
    expect(r.verdict).toBe("findings");
    expect(r.exitCode).toBe(EXIT.FINDINGS);
    expect(r.findings[0]?.severity).toBe("critical");
    expect(r.findings[0]?.checkId).toBe("static-analysis");
    expect(r.summary.blockingFindings).toBe(1);
  });

  it("applies the protection level threshold", async () => {
    const runners = { ...allPass, lint: withFindings(finding({ severity: "medium" })) };
    expect((await run({ runners, level: "standard" })).verdict).toBe("clean");
    expect((await run({ runners, level: "advanced" })).verdict).toBe("clean");
    const maximum = await run({
      runners: { ...runners, "dependency-audit": pass, "dependency-vulnerabilities": pass },
      level: "maximum",
    });
    expect(maximum.verdict).toBe("findings");
  });

  it("does not let low-confidence findings, warnings or suggestions block", async () => {
    const runners = {
      ...allPass,
      lint: withFindings(
        finding({ confidence: "low" }),
        finding({ status: "warning" }),
        finding({ status: "unverified-suggestion" }),
      ),
    };
    const r = await run({ runners });
    expect(r.verdict).toBe("clean");
    expect(r.findings).toHaveLength(3); // still reported
  });

  it("treats a confirmed failure as blocking at every protection level, whatever its severity label", async () => {
    for (const level of ["standard", "advanced", "maximum"] as const) {
      const runners = {
        ...allPass,
        "dependency-audit": pass,
        "dependency-vulnerabilities": pass,
        lint: withFindings(finding({ status: "confirmed-failure", severity: "low" })),
      };
      expect((await run({ runners, level })).verdict).toBe("findings");
    }
  });

  it("never lets an informational confirmed failure block", async () => {
    const runners = {
      ...allPass,
      lint: withFindings(finding({ status: "confirmed-failure", severity: "informational" })),
    };
    expect((await run({ runners })).verdict).toBe("clean");
  });

  it("treats a confirmed failure as blocking even at low confidence", async () => {
    const r = await run({
      runners: {
        ...allPass,
        typecheck: withFindings(finding({ status: "confirmed-failure", confidence: "low" })),
      },
    });
    expect(r.verdict).toBe("findings");
  });

  it("turns a crashing check into a tool error, not a crash or a pass", async () => {
    const r = await run({
      runners: {
        ...allPass,
        secrets: async () => {
          throw new Error("spawn gitleaks ENOENT");
        },
      },
    });
    const c = r.checks.find((x) => x.id === "secrets");
    expect(c?.outcome).toBe("tool-error");
    expect(c?.reason).toContain("ENOENT");
    expect(r.verdict).toBe("incomplete");
  });

  it("rejects malformed runner output", async () => {
    const bad = (async () => ({ outcome: "yes", findings: "nope" })) as unknown as CheckRunner;
    const r = await run({ runners: { ...allPass, lint: bad } });
    expect(r.checks.find((c) => c.id === "lint")?.outcome).toBe("tool-error");
  });

  it("does not trust a 'failed' or 'findings' outcome that has no details", async () => {
    for (const outcome of ["failed", "findings"] as const) {
      const r = await run({
        runners: { ...allPass, lint: async () => ({ outcome, findings: [] }) },
      });
      expect(r.checks.find((c) => c.id === "lint")?.outcome).toBe("tool-error");
    }
  });

  it("corrects a 'passed' outcome that carries findings", async () => {
    const r = await run({
      runners: { ...allPass, lint: async () => ({ outcome: "passed", findings: [finding()] }) },
    });
    expect(r.checks.find((c) => c.id === "lint")?.outcome).toBe("findings");
  });
});

describe("inspectProject: privacy", () => {
  it("redacts secrets from finding text and does not record absolute paths", async () => {
    const secret = "gh" + "p_" + "A1b2C3d4E5f6G7h8I9j0".repeat(2);
    const r = await run({
      runners: {
        ...allPass,
        secrets: withFindings(
          finding({
            message: `token ${secret} committed`,
            evidence: ["API_K", "EY=", "abcd1234efgh"].join(""),
          }),
        ),
      },
    });
    const json = renderJson(r);
    expect(json).not.toContain(secret);
    expect(json).not.toContain("abcd1234efgh");
    expect(json).not.toContain(repoRoot);
    expect(r.project.name).toBe("nextjs-sample");
  });
});

describe("inspectProject: errors", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "aegis-engine-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns an error report (exit 2) for a missing project directory", async () => {
    const r = await run({ root: path.join(dir, "nope") });
    expect(r.verdict).toBe("error");
    expect(r.exitCode).toBe(EXIT.ERROR);
  });

  it("returns an error report for an invalid aegis.config.json, with a line number", async () => {
    await writeFile(
      path.join(dir, "aegis.config.json"),
      '{\n  "version": 1,\n  "protectionLevel": "paranoid"\n}',
    );
    const r = await run({ root: dir });
    expect(r.exitCode).toBe(EXIT.ERROR);
    expect(r.rules.diagnostics[0]?.line).toBe(3);
    expect(r.checks).toEqual([]);
  });

  it("returns an error report when the rules directory is missing or broken", async () => {
    expect((await run({ rulesDir: path.join(dir, "missing") })).exitCode).toBe(EXIT.ERROR);
    await mkdir(path.join(dir, "rules/security"), { recursive: true });
    await writeFile(path.join(dir, "rules/security/AEGIS-SEC-0001.yaml"), "id: nope\n");
    expect((await run({ rulesDir: path.join(dir, "rules") })).exitCode).toBe(EXIT.ERROR);
  });

  it("uses defaults and says so when there is no config file", async () => {
    const r = await run({ root: dir, runners: {} });
    expect(r.notes.join(" ")).toContain("No aegis.config.json");
    expect(r.rules.selected).toEqual([]); // empty project: no language detected
    expect(r.project.uncertainties.join(" ")).toContain("No supported language");
  });

  it("reads protectionLevel from config and lets an option override it", async () => {
    await writeFile(
      path.join(dir, "aegis.config.json"),
      '{ "version": 1, "protectionLevel": "advanced" }',
    );
    expect((await run({ root: dir })).protectionLevel).toBe("advanced");
    expect((await run({ root: dir, level: "maximum" })).protectionLevel).toBe("maximum");
  });

  it("keeps working on a project with no files", async () => {
    const r = await run({ root: dir });
    expect(r.verdict).toBe("incomplete");
  });
});

describe("report rendering", () => {
  it("renders valid JSON that round-trips", async () => {
    const r = await run();
    const parsed = JSON.parse(renderJson(r)) as ScanReport;
    expect(parsed.verdict).toBe("incomplete");
    expect(parsed.generatedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(parsed.reportVersion).toBe(1);
  });

  it("renders text that states the limits of the result", async () => {
    const text = renderText(await run());
    expect(text).toContain("INCOMPLETE");
    expect(text).toContain("[SKIPPED]");
    expect(text).toContain("exit code 3");
    expect(text).toContain("next.js (high)");
  });

  it("renders findings with location and severity", async () => {
    const r = await run({
      runners: {
        ...allPass,
        "static-analysis": withFindings(finding({ location: { file: "app/db.ts", line: 12 } })),
      },
    });
    const text = renderText(r);
    expect(text).toContain("[critical/finding, confidence high] app/db.ts:12");
    expect(text).toContain("FINDINGS");
  });
});
