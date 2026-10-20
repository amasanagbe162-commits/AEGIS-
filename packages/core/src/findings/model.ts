import { z } from "zod";
import {
  confidenceSchema,
  severitySchema,
  SEVERITIES,
  shortText,
  longText,
} from "../schemas/common.js";
import type { Severity } from "../schemas/common.js";

/**
 * What kind of result this is. The distinction matters: a scanner hit is evidence to
 * investigate, not proof of a vulnerability.
 */
export const FINDING_STATUSES = [
  "finding", // possible problem found by a rule or scanner; needs investigation
  "confirmed-failure", // deterministic failure, e.g. the type checker reported an error
  "warning", // worth knowing, never blocks
  "unverified-suggestion", // an improvement idea with no evidence behind it
] as const;
export const findingStatusSchema = z.enum(FINDING_STATUSES);
export type FindingStatus = z.infer<typeof findingStatusSchema>;

export const findingSchema = z
  .object({
    ruleId: z.string().max(60).optional(),
    checkId: z.string().max(60).optional(),
    title: shortText(200),
    message: longText(1000),
    severity: severitySchema,
    confidence: confidenceSchema,
    status: findingStatusSchema,
    location: z
      .object({
        file: z.string().min(1).max(500),
        line: z.number().int().positive().optional(),
      })
      .strict()
      .optional(),
    /** Short excerpt. Always passed through redaction before it is stored in a report. */
    evidence: z.string().max(500).optional(),
  })
  .strict();

export type Finding = z.infer<typeof findingSchema>;

const RANK: Record<Severity, number> = {
  informational: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

export function severityRank(s: Severity): number {
  return RANK[s];
}

/** True when `a` is at least as severe as `b`. */
export function atLeast(a: Severity, b: Severity): boolean {
  return RANK[a] >= RANK[b];
}

export function sortBySeverity<T extends { severity: Severity }>(items: readonly T[]): T[] {
  return [...items].sort((x, y) => RANK[y.severity] - RANK[x.severity]);
}

export function emptySeverityCounts(): Record<Severity, number> {
  return Object.fromEntries(SEVERITIES.map((s) => [s, 0])) as Record<Severity, number>;
}
