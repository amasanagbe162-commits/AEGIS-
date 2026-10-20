import { z } from "zod";
import {
  categorySchema,
  longText,
  protectionLevelSchema,
  semverSchema,
  severitySchema,
  shortText,
} from "./common.js";
import { ruleIdSchema } from "./rule.js";

/** Current version of the .aegis file format. Files declare which version they use. */
export const AEGIS_FORMAT_VERSION = "1.0" as const;

export const operatingRuleSchema = z
  .object({
    id: z.string().regex(/^OP-\d{2}$/, "must look like OP-01"),
    title: shortText(120),
    instructions: z.array(shortText(500)).min(1).max(20),
  })
  .strict();

export const selfCorrectionSchema = z
  .object({
    maxAttempts: z.number().int().min(1).max(10),
    steps: z
      .array(z.object({ name: shortText(40), description: longText(500) }).strict())
      .min(1)
      .max(10),
    notes: z.array(shortText(500)).max(10).default([]),
  })
  .strict();

export const severityActionsSchema = z
  .object({
    critical: z.array(shortText(300)).min(1),
    high: z.array(shortText(300)).min(1),
    medium: z.array(shortText(300)).min(1),
    low: z.array(shortText(300)).min(1),
    informational: z.array(shortText(300)).min(1),
  })
  .strict();

/** Reference to a rule collection (a category) or to one specific rule. */
export const ruleReferenceSchema = z.union([
  z.object({ collection: categorySchema }).strict(),
  z.object({ rule: ruleIdSchema }).strict(),
]);

/**
 * The master .aegis file: a YAML document. Required sections define agent behavior.
 * Optional sections add context. Unknown fields are rejected.
 */
export const masterFileSchema = z
  .object({
    aegis: z.literal(AEGIS_FORMAT_VERSION),
    kind: z.literal("master"),
    name: shortText(80),
    version: semverSchema,
    description: longText(),
    principle: shortText(200),
    defaultProtectionLevel: protectionLevelSchema,
    operatingRules: z.array(operatingRuleSchema).min(1).max(30),
    selfCorrection: selfCorrectionSchema,
    severityActions: severityActionsSchema,
    ruleReferences: z.array(ruleReferenceSchema).min(1).max(100),
    // Optional sections
    limitations: z.array(shortText(500)).max(20).default([]),
    dangerousOperations: z.array(shortText(300)).max(30).default([]),
    minimumSeverityToBlock: severitySchema.optional(),
  })
  .strict();

export type MasterFile = z.infer<typeof masterFileSchema>;
