import { describe, expect, it } from "vitest";
import { parse as parseYaml, stringify } from "yaml";
import { REVIEW_GATES, parseRule } from "../src/index.js";
import { validRuleText } from "./helpers.js";

/** Start from a real, valid, approved rule and change one thing at a time. */
function variant(mutate: (r: Record<string, unknown>) => void): ReturnType<typeof parseRule> {
  const rule = parseYaml(validRuleText) as Record<string, unknown>;
  mutate(rule);
  return parseRule(stringify(rule), "AEGIS-SEC-0001.yaml");
}

describe("approval requires a complete review record", () => {
  it("the bundled approved rule is valid", () => {
    expect(parseRule(validRuleText, "AEGIS-SEC-0001.yaml").ok).toBe(true);
  });

  it("a proposed rule needs no review", () => {
    const r = variant((x) => {
      x["status"] = "proposed";
      delete x["review"];
    });
    expect(r.ok).toBe(true);
  });

  it("an approved rule without a review is rejected", () => {
    const r = variant((x) => delete x["review"]);
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).toContain("must record who reviewed it");
  });

  it("an approved rule that skipped a quality gate is rejected, and the message names the gate", () => {
    for (const gate of REVIEW_GATES) {
      const r = variant((x) => {
        const review = x["review"] as { gates: string[] };
        review.gates = review.gates.filter((g) => g !== gate);
      });
      expect(r.ok, gate).toBe(false);
      expect(JSON.stringify(r), gate).toContain(gate);
    }
  });

  it("rejects unknown gates, unknown reviewer kinds, bad dates and extra fields", () => {
    const bad: ((r: { gates: string[]; [k: string]: unknown }) => void)[] = [
      (r) => r.gates.push("looks-fine-to-me"),
      (r) => (r["reviewerKind"] = "robot"),
      (r) => (r["reviewedAt"] = "yesterday"),
      (r) => (r["approvedBy"] = "someone"),
    ];
    for (const m of bad) {
      expect(variant((x) => m(x["review"] as never)).ok).toBe(false);
    }
  });
});
