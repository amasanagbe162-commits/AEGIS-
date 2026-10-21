import { atLeast, type Finding } from "../findings/model.js";
import type { Severity } from "../schemas/common.js";
import type { CheckResult } from "./checks.js";

/** Process exit codes used by AEGIS commands. */
export const EXIT = {
  /** Every planned check ran and nothing blocking was found. */
  OK: 0,
  /** At least one finding at or above the protection level's threshold. */
  FINDINGS: 1,
  /** Invalid configuration, unreadable rules, or an internal error. */
  ERROR: 2,
  /** Nothing blocking was found, but some planned checks did not run. NOT a clean result. */
  INCOMPLETE: 3,
} as const;

export type Verdict = "clean" | "findings" | "incomplete" | "error";

export const VERDICT_EXIT: Record<Verdict, number> = {
  clean: EXIT.OK,
  findings: EXIT.FINDINGS,
  error: EXIT.ERROR,
  incomplete: EXIT.INCOMPLETE,
};

/**
 * What blocks (changes the result to "findings"):
 * - A confirmed failure (for example a type error or a lint error) always blocks. It is a
 *   deterministic failure of a check the project itself defines, whatever the severity label.
 * - A finding blocks when it is at or above the protection level's threshold and its confidence
 *   is not low. Low-confidence findings are leads to investigate, not proof.
 * - Warnings and unverified suggestions never block.
 */
export function isBlocking(f: Finding, threshold: Severity): boolean {
  if (f.status === "confirmed-failure") return f.severity !== "informational";
  if (f.status !== "finding") return false;
  return atLeast(f.severity, threshold) && f.confidence !== "low";
}

export function computeVerdict(input: {
  findings: readonly Finding[];
  checks: readonly CheckResult[];
  threshold: Severity;
  fatalError: boolean;
}): Verdict {
  if (input.fatalError) return "error";
  if (input.findings.some((f) => isBlocking(f, input.threshold))) return "findings";
  if (input.checks.some((c) => c.outcome === "skipped" || c.outcome === "tool-error")) {
    return "incomplete";
  }
  return "clean";
}
