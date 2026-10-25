import { z } from "zod";
import {
  categorySchema,
  longText,
  protectionLevelSchema,
  shortText,
  slugSchema,
} from "../schemas/common.js";

/**
 * Lifecycle of a lesson learned while working on a project.
 *   observed -> proposed -> verified -> approved -> superseded
 *   (observed | proposed | verified) -> rejected
 * This is a reviewed record keeper. It is not machine learning.
 */
export const LEARNING_STATUSES = [
  "observed",
  "proposed",
  "verified",
  "approved",
  "rejected",
  "superseded",
] as const;
export const learningStatusSchema = z.enum(LEARNING_STATUSES);
export type LearningStatus = z.infer<typeof learningStatusSchema>;

export const learningIdSchema = z.string().regex(/^LR-\d{4}$/, "must look like LR-0001");

/** Descriptions only. Pasted source code is refused so private code never lands in a record. */
const prose = (max: number) =>
  longText(max).refine(
    (t) => !t.includes("```"),
    "describe the pattern in words; do not paste code",
  );

export const learningEvidenceSchema = z.discriminatedUnion("kind", [
  /** Recorded by AEGIS itself from a real `aegis check` run. */
  z
    .object({
      kind: z.literal("aegis-check"),
      at: z.string().datetime(),
      level: protectionLevelSchema,
      verdict: z.enum(["clean", "findings", "incomplete", "error"]),
      checksPerformed: z.number().int().min(0),
      checksPlanned: z.number().int().min(0),
    })
    .strict(),
  /** Written by a person or an agent. Context only: it can never verify a record by itself. */
  z.object({ kind: z.literal("note"), at: z.string().datetime(), text: prose(500) }).strict(),
]);
export type LearningEvidence = z.infer<typeof learningEvidenceSchema>;

export const reviewSchema = z
  .object({
    decision: z.enum(["approved", "rejected"]),
    reviewer: shortText(60),
    reason: prose(500),
    at: z.string().datetime(),
  })
  .strict();

export const learningRecordSchema = z
  .object({
    version: z.literal(1),
    id: learningIdSchema,
    status: learningStatusSchema,
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    title: shortText(120),
    category: categorySchema,
    languages: z.array(slugSchema).max(10).default([]),
    /** What went wrong, observed. */
    issue: prose(1000),
    rootCause: prose(1000).optional(),
    correction: prose(1000).optional(),
    evidence: z.array(learningEvidenceSchema).max(20).default([]),
    review: reviewSchema.optional(),
    supersededBy: learningIdSchema.optional(),
  })
  .strict();
export type LearningRecord = z.infer<typeof learningRecordSchema>;
