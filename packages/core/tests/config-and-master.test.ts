import { describe, expect, it } from "vitest";
import {
  checkMasterReferences,
  parseConfig,
  parseMasterFile,
  renderMasterMarkdown,
  resolveMasterRules,
  formatDiagnostic,
  type Rule,
} from "../src/index.js";
import { configTemplateText, masterTemplateText, validRuleText } from "./helpers.js";
import { parseRule } from "../src/index.js";

function sampleRule(): Rule {
  const r = parseRule(validRuleText);
  if (!r.ok) throw new Error("fixture rule invalid");
  return r.value;
}

describe("config", () => {
  it("accepts the template", () => {
    expect(parseConfig(configTemplateText).ok).toBe(true);
  });

  it("applies defaults", () => {
    const r = parseConfig('{ "version": 1 }');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.protectionLevel).toBe("standard");
      expect(r.value.updates.enabled).toBe(false);
      expect(r.value.selfCorrection.maxAttempts).toBe(3);
    }
  });

  it("reports invalid JSON with a line", () => {
    const r = parseConfig('{\n  "version": 1,\n}');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.diagnostics[0]?.line).toBeGreaterThan(0);
  });

  it("rejects YAML-style content in a JSON config", () => {
    expect(parseConfig("version: 1").ok).toBe(false);
  });

  it("rejects unknown protection levels, absolute paths and parent paths", () => {
    expect(parseConfig('{"version":1,"protectionLevel":"paranoid"}').ok).toBe(false);
    expect(parseConfig('{"version":1,"masterFile":"/etc/passwd"}').ok).toBe(false);
    expect(parseConfig('{"version":1,"masterFile":"../outside.aegis"}').ok).toBe(false);
    expect(parseConfig('{"version":1,"scan":{"exclude":["C:\\\\Windows"]}}').ok).toBe(false);
  });

  it("rejects out-of-range attempt limits and unknown fields", () => {
    expect(parseConfig('{"version":1,"selfCorrection":{"maxAttempts":0}}').ok).toBe(false);
    expect(parseConfig('{"version":1,"selfCorrection":{"maxAttempts":99}}').ok).toBe(false);
    expect(parseConfig('{"version":1,"extra":1}').ok).toBe(false);
  });
});

describe("master file", () => {
  it("accepts the shipped template", () => {
    const r = parseMasterFile(masterTemplateText, "AEGIS.aegis");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.operatingRules).toHaveLength(10);
  });

  it("rejects an unsupported format version", () => {
    const r = parseMasterFile(masterTemplateText.replace('aegis: "1.0"', 'aegis: "9.9"'));
    expect(r.ok).toBe(false);
  });

  it("requires the self-correction section", () => {
    const text = masterTemplateText.replace(
      /^selfCorrection:[\s\S]*?^severityActions:/m,
      "severityActions:",
    );
    const r = parseMasterFile(text, "AEGIS.aegis");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.diagnostics.some((d) => d.path === "selfCorrection")).toBe(true);
  });

  it("formats diagnostics with file, line and field", () => {
    const r = parseMasterFile(
      masterTemplateText.replace("defaultProtectionLevel: standard", "defaultProtectionLevel: x"),
      "AEGIS.aegis",
    );
    if (r.ok) throw new Error("expected failure");
    const text = formatDiagnostic(r.diagnostics[0]!);
    expect(text).toMatch(/^error: AEGIS\.aegis:\d+:\d+ \[defaultProtectionLevel\]/);
  });
});

describe("rule references", () => {
  const master = (() => {
    const r = parseMasterFile(masterTemplateText);
    if (!r.ok) throw new Error("template invalid");
    return r.value;
  })();

  it("reports an unknown rule id as an error", () => {
    const m = { ...master, ruleReferences: [{ rule: "AEGIS-SEC-9999" as const }] };
    const d = checkMasterReferences(m, [sampleRule()]);
    expect(d).toHaveLength(1);
    expect(d[0]?.severity).toBe("error");
  });

  it("warns about collections with no rules", () => {
    const m = { ...master, ruleReferences: [{ collection: "testing" as const }] };
    const d = checkMasterReferences(m, [sampleRule()]);
    expect(d[0]?.severity).toBe("warning");
  });

  it("resolves collections and single rules without duplicates", () => {
    const m = {
      ...master,
      ruleReferences: [{ collection: "security" as const }, { rule: "AEGIS-SEC-0001" as const }],
    };
    expect(resolveMasterRules(m, [sampleRule()]).map((r) => r.id)).toEqual(["AEGIS-SEC-0001"]);
  });
});

describe("markdown rendering", () => {
  it("renders every required section", () => {
    const r = parseMasterFile(masterTemplateText);
    if (!r.ok) throw new Error("template invalid");
    const md = renderMasterMarkdown(r.value, [sampleRule()]);
    for (const heading of [
      "# AEGIS Master Instructions",
      "## Operating rules",
      "## Self-correction protocol",
      "## Severity and expected actions",
      "## Operations that require explicit user confirmation",
      "## Protection rules in effect",
      "## Limitations",
    ]) {
      expect(md).toContain(heading);
    }
    expect(md).toContain("AEGIS-SEC-0001");
    expect(md.endsWith("\n")).toBe(true);
  });
});
