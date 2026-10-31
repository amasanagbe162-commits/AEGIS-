import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createGitleaksRunner,
  createNpmAuditRunner,
  createOsvScannerRunner,
  createSemgrepRunner,
  normalizeRuleId,
  type RunResult,
} from "../../src/index.js";
import { ctx, exited, fakeDeps, npmProfile, profile, withTempDir } from "./helpers.js";

const failures: [string, RunResult, RegExp][] = [
  ["a timeout", { kind: "timeout" }, /did not finish within 5 seconds/],
  ["too much output", { kind: "output-limit", stream: "stdout" }, /produced more than 20 MB/],
  [
    "a program that cannot start",
    { kind: "spawn-error", message: "EACCES" },
    /could not be started: EACCES/,
  ],
];

describe.each([
  ["gitleaks", (d: ReturnType<typeof fakeDeps>["deps"]) => createGitleaksRunner(d)],
  [
    "semgrep",
    (d: ReturnType<typeof fakeDeps>["deps"]) =>
      createSemgrepRunner(d, { rulesFile: "/rules.yaml" }),
  ],
  ["npm", (d: ReturnType<typeof fakeDeps>["deps"]) => createNpmAuditRunner(d)],
  ["osv-scanner", (d: ReturnType<typeof fakeDeps>["deps"]) => createOsvScannerRunner(d)],
] as const)("common behavior of the %s adapter", (tool, make) => {
  const c = () => ctx("/x", { profile: npmProfile() });

  it("is SKIPPED (never passed) when the tool is not installed", async () => {
    const { deps, calls } = fakeDeps([], exited(0));
    const r = await make(deps)(c());
    expect(r.outcome).toBe("skipped");
    expect(r.reason).toContain(`${tool} was not found on PATH`);
    expect(calls).toHaveLength(0);
  });

  it.each(failures)("is a TOOL-ERROR on %s", async (_name, result, pattern) => {
    const { deps } = fakeDeps([tool], result);
    const r = await make(deps)(c());
    expect(r.outcome).toBe("tool-error");
    expect(r.reason).toMatch(pattern);
    expect(r.findings).toEqual([]);
  });

  it("never passes a shell command line or inherits the secret in the environment", async () => {
    const { deps, calls } = fakeDeps([tool], exited(0, "{}"));
    await make(deps)(ctx("/x; touch pwned", { profile: npmProfile() }));
    for (const call of calls) {
      expect(call.command).toBe(`/fake/bin/${tool}`);
      expect(Array.isArray(call.args)).toBe(true);
      expect(call.timeoutMs).toBe(5000);
    }
  });
});

describe("gitleaks adapter", () => {
  it("tells the user when their Gitleaks is too old to have the 'dir' command, and never passes", async () => {
    await withTempDir(async (dir) => {
      const { deps } = fakeDeps(
        ["gitleaks"],
        exited(
          1,
          "",
          'Error: unknown command "dir" for "gitleaks"\nRun \'gitleaks --help\' for usage.',
        ),
      );
      const r = await createGitleaksRunner(deps)(ctx(dir));
      expect(r.outcome).toBe("tool-error");
      expect(JSON.stringify(r)).toContain("too old");
      expect(JSON.stringify(r)).toContain("8.28.0");
    });
  });

  const leak = (root: string, file: string, line = 3) => ({
    RuleID: "generic-api-key",
    Description: "Detected a Generic API Key",
    StartLine: line,
    Match: "apiKey = REDACTED",
    Secret: "REDACTED",
    File: path.join(root, file),
  });

  it("calls gitleaks in directory mode with redaction and no shell", async () => {
    const { deps, calls } = fakeDeps(["gitleaks"], exited(0, "[]"));
    await createGitleaksRunner(deps)(ctx("/some dir; x"));
    const args = calls[0]?.args ?? [];
    expect(args.slice(0, 2)).toEqual(["dir", "/some dir; x"]);
    expect(args).toEqual(
      expect.arrayContaining([
        "--report-format",
        "json",
        "--report-path",
        "-",
        "--redact",
        "--no-banner",
        "--no-color",
      ]),
    );
    // The project must not be able to configure (or silence) the scanner that checks it.
    expect(args).toContain("--ignore-gitleaks-allow");
    const config = args[args.indexOf("--config") + 1] ?? "";
    expect(config).toMatch(/aegis-gitleaks-[^/\\]+[/\\]aegis\.toml$/);
    expect(config.startsWith("/some dir")).toBe(false);
  });

  it("refuses to trust a scan when the project has a .gitleaksignore file, and does not even run gitleaks", async () => {
    await withTempDir(async (root) => {
      await writeFile(path.join(root, ".gitleaksignore"), "anything\n");
      const { deps, calls } = fakeDeps(["gitleaks"], exited(0, "[]"));
      const r = await createGitleaksRunner(deps)(ctx(root));
      expect(r.outcome).toBe("tool-error");
      expect(JSON.stringify(r)).toContain(".gitleaksignore");
      expect(calls).toHaveLength(0);
    });
  });

  it("cleans up its private config folder after every run", async () => {
    const { deps, calls } = fakeDeps(["gitleaks"], exited(0, "[]"));
    await createGitleaksRunner(deps)(ctx("/x"));
    const args = calls[0]?.args ?? [];
    const config = args[args.indexOf("--config") + 1] ?? "";
    await expect(stat(path.dirname(config))).rejects.toThrow();
  });

  it("passes on exit 0 with an empty report", async () => {
    const { deps } = fakeDeps(["gitleaks"], exited(0, "[]\n"));
    expect((await createGitleaksRunner(deps)(ctx("/x"))).outcome).toBe("passed");
  });

  it("does not trust exit 0 with no report", async () => {
    const { deps } = fakeDeps(["gitleaks"], exited(0, ""));
    expect((await createGitleaksRunner(deps)(ctx("/x"))).outcome).toBe("tool-error");
  });

  it("reports leaks with a relative path and without any secret value", async () => {
    await withTempDir(async (root) => {
      const { deps } = fakeDeps(
        ["gitleaks"],
        exited(1, JSON.stringify([leak(root, "src/app.js", 7)])),
      );
      const r = await createGitleaksRunner(deps)(ctx(root));
      expect(r.outcome).toBe("findings");
      const f = r.findings[0]!;
      expect(f).toMatchObject({
        ruleId: "AEGIS-SEC-0003",
        severity: "critical",
        confidence: "medium",
        status: "finding",
        location: { file: "src/app.js", line: 7 },
      });
      expect(JSON.stringify(f)).not.toContain(root);
    });
  });

  it("downgrades findings in .gitignore'd files to warnings", async () => {
    await withTempDir(async (root) => {
      await writeFile(path.join(root, ".gitignore"), ".env\n");
      const { deps } = fakeDeps(
        ["gitleaks"],
        exited(1, JSON.stringify([leak(root, ".env", 1), leak(root, "app.js")])),
      );
      const r = await createGitleaksRunner(deps)(ctx(root));
      const byFile = Object.fromEntries(r.findings.map((f) => [f.location?.file, f]));
      expect(byFile[".env"]).toMatchObject({ status: "warning", severity: "low" });
      expect(byFile["app.js"]).toMatchObject({ status: "finding", severity: "critical" });
    });
  });

  it("treats exit code 1 without a readable report as a failure, not as a leak", async () => {
    const fatal = exited(1, "", "\u001b[31mFTL\u001b[0m stat /nope: no such file or directory");
    const { deps } = fakeDeps(["gitleaks"], fatal);
    const r = await createGitleaksRunner(deps)(ctx("/x"));
    expect(r.outcome).toBe("tool-error");
    expect(r.reason).toContain("no such file or directory");
    expect(r.reason).not.toContain("\u001b");
  });

  it("treats exit code 1 with an empty list as a failure", async () => {
    const { deps } = fakeDeps(["gitleaks"], exited(1, "[]"));
    expect((await createGitleaksRunner(deps)(ctx("/x"))).outcome).toBe("tool-error");
  });

  it("treats other exit codes and malformed reports as failures", async () => {
    for (const result of [exited(2, "[]"), exited(0, "not json"), exited(0, '{"a":1}')]) {
      const { deps } = fakeDeps(["gitleaks"], result);
      expect((await createGitleaksRunner(deps)(ctx("/x"))).outcome).toBe("tool-error");
    }
  });

  it("caps the number of findings and says so", async () => {
    await withTempDir(async (root) => {
      const many = Array.from({ length: 250 }, (_, i) => leak(root, `f${i}.js`));
      const { deps } = fakeDeps(["gitleaks"], exited(1, JSON.stringify(many)));
      const r = await createGitleaksRunner(deps)(ctx(root));
      expect(r.findings).toHaveLength(200);
      expect(r.reason).toContain("50 more");
    });
  });
});

describe("semgrep adapter", () => {
  const rulesFile = "/rules/aegis.yaml";
  const result = (over: object = {}) => ({
    check_id: "tmp.sgrules.aegis.js.sql-string-concat",
    path: "/proj/app.js",
    start: { line: 5 },
    extra: {
      message: "SQL text is built by concatenation.",
      severity: "ERROR",
      lines: "requires login",
      metadata: {
        aegis_rule_id: "AEGIS-SEC-0001",
        aegis_severity: "critical",
        confidence: "MEDIUM",
      },
    },
    ...over,
  });
  const run = (stdout: string, exitCode = 0) =>
    createSemgrepRunner(fakeDeps(["semgrep"], exited(exitCode, stdout)).deps, { rulesFile })(
      ctx("/proj"),
    );

  it("uses only the local rule file, with metrics and version checks off", async () => {
    const { deps, calls } = fakeDeps(["semgrep"], exited(0, '{"results":[],"errors":[]}'));
    await createSemgrepRunner(deps, { rulesFile })(ctx("/proj"));
    const args = calls[0]!.args;
    expect(args).toEqual(
      expect.arrayContaining(["--metrics=off", "--disable-version-check", "--config", rulesFile]),
    );
    expect(args.join(" ")).not.toMatch(/p\/|semgrep\.dev|--config=auto|registry/);
    expect(args.at(-1)).toBe("/proj");
  });

  it("is a tool error when no rule file was provided", async () => {
    const { deps } = fakeDeps(["semgrep"], exited(0));
    expect((await createSemgrepRunner(deps, { rulesFile: undefined })(ctx("/proj"))).outcome).toBe(
      "tool-error",
    );
  });

  it("passes when nothing is found", async () => {
    expect((await run('{"results":[],"errors":[]}')).outcome).toBe("passed");
  });

  it("maps results to findings with AEGIS rule id, severity and a relative path", async () => {
    const r = await run(JSON.stringify({ results: [result()], errors: [] }));
    expect(r.outcome).toBe("findings");
    expect(r.findings[0]).toMatchObject({
      ruleId: "AEGIS-SEC-0001",
      severity: "critical",
      confidence: "medium",
      status: "finding",
      location: { file: "app.js", line: 5 },
      title: "Possible issue (aegis.js.sql-string-concat)",
    });
    expect(r.findings[0]?.message).toContain("not a confirmed vulnerability");
  });

  it("falls back to Semgrep's severity when AEGIS metadata is missing or invalid", async () => {
    const bare = result({
      extra: { message: "m", severity: "WARNING", metadata: { aegis_severity: "bogus" } },
    });
    const r = await run(JSON.stringify({ results: [bare], errors: [] }));
    expect(r.findings[0]).toMatchObject({ severity: "medium", confidence: "medium" });
    expect(r.findings[0]?.ruleId).toBeUndefined();
  });

  it("notes files that could not be analyzed without calling the result clean", async () => {
    const r = await run(JSON.stringify({ results: [], errors: [{ type: "PartialParsing" }] }));
    expect(r.outcome).toBe("passed");
    expect(r.reason).toContain("1 file(s) or rule(s) could not be fully analyzed");
  });

  it("treats a non-zero exit (for example an invalid rule file, exit 7) as a failure", async () => {
    const stdout = JSON.stringify({
      results: [],
      errors: [{ type: "SemgrepError", level: "error" }],
    });
    const r = await run(stdout, 7);
    expect(r.outcome).toBe("tool-error");
    expect(r.reason).toContain("exited with code 7");
  });

  it("treats malformed output as a failure", async () => {
    expect((await run("not json")).outcome).toBe("tool-error");
    expect((await run('{"nope":true}')).outcome).toBe("tool-error");
  });

  it("normalizes rule ids that Semgrep prefixes with the config path", () => {
    expect(normalizeRuleId("tmp.sgrules.aegis.js.sql-string-concat")).toBe(
      "aegis.js.sql-string-concat",
    );
    expect(normalizeRuleId("aegis.packages.rules.semgrep.aegis.js.inner-html-assignment")).toBe(
      "aegis.js.inner-html-assignment",
    );
    expect(normalizeRuleId("aegis.js.document-write")).toBe("aegis.js.document-write");
    expect(normalizeRuleId("other.rule")).toBe("other.rule");
  });
});

describe("npm audit adapter", () => {
  // Trimmed from a real `npm audit --json --package-lock-only` run.
  const realVulnerable = {
    auditReportVersion: 2,
    vulnerabilities: {
      lodash: {
        name: "lodash",
        severity: "high",
        isDirect: true,
        via: [
          {
            title: "Command Injection in lodash",
            url: "https://github.com/advisories/GHSA-35jh-r3h4-6jhm",
            severity: "high",
            range: "<4.17.21",
          },
        ],
        range: "<=4.17.23",
        fixAvailable: { name: "lodash", version: "4.18.1", isSemVerMajor: false },
      },
    },
    metadata: { vulnerabilities: { high: 1, total: 1 } },
  };
  const run = (stdout: string, exitCode = 1, stderr = "") =>
    createNpmAuditRunner(fakeDeps(["npm"], exited(exitCode, stdout, stderr)).deps)(
      ctx("/p", { profile: npmProfile() }),
    );

  it("asks npm to audit from the lockfile as JSON", async () => {
    const { deps, calls } = fakeDeps(["npm"], exited(0, '{"vulnerabilities":{}}'));
    await createNpmAuditRunner(deps)(ctx("/p"));
    expect(calls[0]?.args).toEqual(["audit", "--json", "--package-lock-only"]);
    expect(calls[0]?.cwd).toBe("/p");
  });

  it("reports vulnerable packages with advisories", async () => {
    const r = await run(JSON.stringify(realVulnerable));
    expect(r.outcome).toBe("findings");
    expect(r.findings[0]).toMatchObject({
      title: "Vulnerable dependency: lodash",
      severity: "high",
      confidence: "high",
      status: "finding",
      location: { file: "package-lock.json" },
    });
    expect(r.findings[0]?.message).toContain("GHSA-35jh-r3h4-6jhm");
    expect(r.findings[0]?.message).toContain("not checked");
  });

  it("maps npm's 'moderate' to medium and handles transitive-only entries", async () => {
    const report = {
      vulnerabilities: {
        a: { name: "a", severity: "moderate", via: ["b"], range: "*", fixAvailable: false },
      },
    };
    const r = await run(JSON.stringify(report));
    expect(r.findings[0]).toMatchObject({ severity: "medium" });
    expect(r.findings[0]?.message).toContain("Vulnerable through b");
    expect(r.findings[0]?.message).toContain("No fix is available");
  });

  it("passes only on exit 0 with an empty report", async () => {
    expect((await run('{"vulnerabilities":{}}', 0)).outcome).toBe("passed");
    expect((await run('{"vulnerabilities":{}}', 1)).outcome).toBe("tool-error");
  });

  it("reports npm's network failure as a tool error with the real reason, never as clean", async () => {
    // Real npm output: exit 1, JSON with an empty error summary and the reason in 'message'.
    const failure = {
      message:
        "request to https://registry.npmjs.org/-/npm/v1/security/audits/quick failed, reason: self-signed certificate in certificate chain",
      error: { summary: "", detail: "" },
    };
    const r = await run(JSON.stringify(failure));
    expect(r.outcome).toBe("tool-error");
    expect(r.reason).toContain("self-signed certificate");
  });

  it("reports an error object with a code", async () => {
    const r = await run(
      JSON.stringify({ error: { code: "ENOLOCK", summary: "requires an existing lockfile" } }),
    );
    expect(r.reason).toContain("ENOLOCK");
    expect(r.reason).toContain("requires an existing lockfile");
  });

  it("treats unreadable or unexpected output as a failure", async () => {
    expect((await run("", 1, "npm error boom")).outcome).toBe("tool-error");
    expect((await run('{"something":"else"}')).outcome).toBe("tool-error");
  });
});

describe("osv-scanner adapter", () => {
  const lockProfile = npmProfile();
  const run = (exitCode: number, stdout: string, stderr = "", p = lockProfile) =>
    createOsvScannerRunner(fakeDeps(["osv-scanner"], exited(exitCode, stdout, stderr)).deps)(
      ctx("/p", { profile: p }),
    );

  it("is skipped when there is no supported lockfile", async () => {
    const r = await run(0, "{}", "", profile());
    expect(r.outcome).toBe("skipped");
  });

  it("passes the lockfiles found by project detection, each as its own argument", async () => {
    const { deps, calls } = fakeDeps(["osv-scanner"], exited(0, '{"results":[]}'));
    await createOsvScannerRunner(deps)(ctx("/p", { profile: lockProfile }));
    expect(calls[0]?.args).toEqual([
      "scan",
      "source",
      "--format",
      "json",
      "--lockfile",
      "package-lock.json",
    ]);
  });

  it("REGRESSION: an empty JSON result with exit code 127 (network failure) is an error, not a pass", async () => {
    // Real osv-scanner v2 behavior when api.osv.dev is unreachable.
    const stderr =
      'Error during extraction: request failed: Post "https://api.osv.dev/v1/querybatch": dial tcp: lookup api.osv.dev: no such host';
    const r = await run(127, '{\n  "results": [],\n  "experimental_config": {}\n}', stderr);
    expect(r.outcome).toBe("tool-error");
    expect(r.reason).toContain("api.osv.dev");
  });

  it("is skipped on exit 128 (no packages found)", async () => {
    expect((await run(128, "")).outcome).toBe("skipped");
  });

  it("passes only on exit 0 with a readable report", async () => {
    expect((await run(0, '{"results":[]}')).outcome).toBe("passed");
    expect((await run(0, "nope")).outcome).toBe("tool-error");
  });

  // REAL output: captured from OSV-Scanner 2.2.2 scanning tests/fixtures/vulnerable-deps/package-lock.json
  // with `--offline-vulnerabilities` against a local advisory database (the sandbox could not reach
  // api.osv.dev). The report FORMAT is the real tool's. The advisory record behind it was written by hand.
  it("maps a real OSV-Scanner 2.2.2 report of a vulnerable lockfile to a finding", async () => {
    const real = await readFile(
      new URL("../../../../tests/fixtures/osv-real/vulnerable-lockfile.json", import.meta.url),
      "utf8",
    );
    expect(JSON.parse(real)).toHaveProperty("experimental_config");
    const r = await run(1, real);
    expect(r.outcome).toBe("findings");
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]).toMatchObject({
      title: "Vulnerable dependency: lodash 4.17.15",
      severity: "high",
      status: "finding",
      location: { file: "package-lock.json" },
    });
    expect(r.findings[0]?.message).toContain("GHSA-35jh-r3h4-6jhm: Command Injection in lodash");
    expect(r.findings[0]?.message).toContain("reachable");
  });

  it("never treats the real vulnerable report as clean, even if the exit code were 0", async () => {
    const real = await readFile(
      new URL("../../../../tests/fixtures/osv-real/vulnerable-lockfile.json", import.meta.url),
      "utf8",
    );
    expect((await run(0, real)).outcome).toBe("findings");
  });

  // SYNTHETIC data written from the documented v2 output format. Not captured from a real
  // vulnerable run, because the sandbox could not reach api.osv.dev.
  it("maps vulnerabilities from the documented format to findings (synthetic sample)", async () => {
    const report = {
      results: [
        {
          source: { path: "/p/package-lock.json" },
          packages: [
            {
              package: { name: "lodash", version: "4.17.15" },
              vulnerabilities: [
                {
                  id: "GHSA-xxxx-yyyy-zzzz",
                  summary: "Prototype pollution",
                  database_specific: { severity: "HIGH" },
                },
              ],
            },
          ],
        },
      ],
    };
    const r = await run(1, JSON.stringify(report));
    expect(r.outcome).toBe("findings");
    expect(r.findings[0]).toMatchObject({
      title: "Vulnerable dependency: lodash 4.17.15",
      severity: "high",
      confidence: "high",
      status: "finding",
    });
  });

  it("treats exit code 1 without readable vulnerabilities as a failure", async () => {
    expect((await run(1, '{"results":[]}')).outcome).toBe("tool-error");
  });
});
