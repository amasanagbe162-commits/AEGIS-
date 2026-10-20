import { describe, expect, it } from "vitest";
import { MAX_FILE_BYTES, parseRule } from "../src/index.js";
import { validRuleText } from "./helpers.js";

function errorsOf(text: string) {
  const result = parseRule(text, "test.yaml");
  if (result.ok) throw new Error("expected parse to fail");
  return result.diagnostics;
}

describe("rule parsing", () => {
  it("accepts a valid rule", () => {
    const result = parseRule(validRuleText, "ok.yaml");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.id).toBe("AEGIS-SEC-0001");
      expect(result.value.frameworks).toEqual(["node.js"]);
    }
  });

  it("reports an unknown field with its line number", () => {
    const text = validRuleText + "surprise: true\n";
    const diags = errorsOf(text);
    const d = diags.find((x) => x.path === "surprise");
    expect(d?.message).toContain("unknown field");
    expect(d?.line).toBe(text.trimEnd().split("\n").length);
  });

  it("reports a missing required field", () => {
    const diags = errorsOf(validRuleText.replace(/^risk:.*$/m, ""));
    expect(diags.some((d) => d.path === "risk")).toBe(true);
  });

  it("reports an invalid enum value at the right line", () => {
    const text = validRuleText.replace("severity: critical", "severity: catastrophic");
    const diags = errorsOf(text);
    const d = diags.find((x) => x.path === "severity");
    expect(d).toBeDefined();
    expect(d?.line).toBe(text.split("\n").findIndex((l) => l.startsWith("severity:")) + 1);
  });

  it("reports a nested field path", () => {
    const text = validRuleText.replace(
      "language: javascript\n  code: |",
      "language: Not A Slug\n  code: |",
    );
    const diags = errorsOf(text);
    expect(diags.some((d) => d.path === "badExample.language")).toBe(true);
  });

  it("rejects non-https references", () => {
    const text = validRuleText.replace(
      "https://owasp.org/www-community/attacks/SQL_Injection",
      "http://example.com/x",
    );
    expect(errorsOf(text).some((d) => d.path.startsWith("references[0]"))).toBe(true);
  });

  it("rejects YAML syntax errors with a line number", () => {
    const diags = errorsOf("id: [unclosed\ntitle: x\n");
    expect(diags[0]?.line).toBeGreaterThan(0);
  });

  it("rejects empty input", () => {
    expect(errorsOf("   \n")[0]?.message).toBe("file is empty");
  });

  it("rejects input larger than the size limit", () => {
    const big = "x: " + "a".repeat(MAX_FILE_BYTES + 1);
    expect(errorsOf(big)[0]?.message).toContain("larger than");
  });

  it("rejects duplicate keys", () => {
    expect(errorsOf(validRuleText + "id: AEGIS-SEC-0002\n").length).toBeGreaterThan(0);
  });

  it("rejects multiple YAML documents", () => {
    expect(errorsOf(validRuleText + "---\nid: x\n").length).toBeGreaterThan(0);
  });
});

describe("parser safety", () => {
  it("rejects YAML aliases", () => {
    const text = validRuleText.replace(
      "languages: [javascript, typescript]",
      "languages: &a [javascript]\nframeworks: *a",
    );
    const diags = errorsOf(text);
    expect(diags.some((d) => d.message.includes("aliases"))).toBe(true);
  });

  it("rejects custom or JavaScript-style YAML tags instead of evaluating them", () => {
    const text = validRuleText.replace(
      "title: Prevent SQL injection",
      "title: !!js/function 'function(){ globalThis.__pwned = true }'",
    );
    expect(parseRule(text).ok).toBe(false);
    expect((globalThis as Record<string, unknown>).__pwned).toBeUndefined();
  });

  it("treats code-like example text as inert data", () => {
    const text = validRuleText.replace(
      "// UNSAFE: user input becomes part of the SQL text.",
      "process.exit(1); require('child_process').execSync('echo pwned'); !!js/function x",
    );
    const result = parseRule(text);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.badExample.code).toContain("process.exit(1)");
  });

  it("does not allow __proto__ to pollute objects", () => {
    const text = validRuleText + "__proto__:\n  polluted: true\n";
    expect(parseRule(text).ok).toBe(false);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("rejects scanner references that try to supply a command", () => {
    const text = validRuleText.replace("tool: semgrep", "tool: semgrep\n  command: rm -rf /");
    const diags = errorsOf(text);
    expect(diags.some((d) => d.path === "scanner.command")).toBe(true);
  });

  it("rejects scanner tools outside the allowlist", () => {
    const text = validRuleText.replace("tool: semgrep", "tool: bash");
    expect(errorsOf(text).some((d) => d.path === "scanner.tool")).toBe(true);
  });
});
