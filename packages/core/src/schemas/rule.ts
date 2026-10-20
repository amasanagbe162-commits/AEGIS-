import { z } from "zod";
import {
  categorySchema,
  confidenceSchema,
  longText,
  semverSchema,
  severitySchema,
  shortText,
  slugSchema,
} from "./common.js";

/** Rule IDs look like AEGIS-SEC-0001. The prefix must match the category (checked in the loader). */
export const RULE_ID_PREFIXES = {
  universal: "UNI",
  security: "SEC",
  "coding-errors": "COD",
  dependencies: "DEP",
  configuration: "CFG",
  testing: "TST",
  architecture: "ARC",
} as const;

export const ruleIdSchema = z
  .string()
  .regex(/^AEGIS-(UNI|SEC|COD|DEP|CFG|TST|ARC)-\d{4}$/, "must look like AEGIS-SEC-0001");

/**
 * Review state. Validation (does the file parse?) is separate from approval
 * (did a human maintainer confirm the rule is technically correct?).
 */
export const reviewStatusSchema = z.enum(["proposed", "approved", "rejected", "superseded"]);

/** An example is INERT TEXT. It is stored and displayed, never executed or evaluated. */
export const exampleSchema = z
  .object({
    language: slugSchema,
    code: z.string().trim().min(1).max(4000),
    note: shortText(500).optional(),
  })
  .strict();

/**
 * Optional link to an external scanner. This is deliberately NOT a command:
 * a rule can only name an allowlisted tool and a rule identifier inside that tool.
 */
export const SCANNER_TOOLS = [
  "semgrep",
  "gitleaks",
  "osv-scanner",
  "npm-audit",
  "eslint",
  "tsc",
] as const;

export const scannerRefSchema = z
  .object({
    tool: z.enum(SCANNER_TOOLS),
    ruleRef: z
      .string()
      .regex(/^[A-Za-z0-9@._:/-]{1,120}$/, "may only contain letters, digits and @ . _ : / -")
      .optional(),
  })
  .strict();

export const referenceSchema = z
  .string()
  .url()
  .max(300)
  .refine((u) => u.startsWith("https://"), "references must use https");

export const ruleSchema = z
  .object({
    id: ruleIdSchema,
    title: shortText(120),
    category: categorySchema,
    severity: severitySchema,
    confidence: confidenceSchema,
    languages: z.array(slugSchema).max(20),
    frameworks: z.array(slugSchema).max(20).default([]),
    description: longText(),
    risk: longText(),
    appliesWhen: longText(),
    badExample: exampleSchema,
    goodExample: exampleSchema,
    reasoning: longText(),
    assumptions: z.array(shortText(500)).min(1).max(10),
    limitations: z.array(shortText(500)).min(1).max(10),
    prevention: z.array(shortText(500)).min(1).max(15),
    verification: z.array(shortText(500)).min(1).max(15),
    references: z.array(referenceSchema).max(10).default([]),
    scanner: scannerRefSchema.optional(),
    tests: z.array(shortText(500)).max(15).default([]),
    version: semverSchema,
    status: reviewStatusSchema,
  })
  .strict();

export type Rule = z.infer<typeof ruleSchema>;
