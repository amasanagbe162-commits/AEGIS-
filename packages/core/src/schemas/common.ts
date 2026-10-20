import { z } from "zod";

export const SEVERITIES = ["critical", "high", "medium", "low", "informational"] as const;
export const CONFIDENCES = ["high", "medium", "low"] as const;
export const PROTECTION_LEVELS = ["standard", "advanced", "maximum"] as const;
export const CATEGORIES = [
  "universal",
  "security",
  "coding-errors",
  "dependencies",
  "configuration",
  "testing",
  "architecture",
] as const;
export const AGENTS = ["claude-code", "github-copilot"] as const;

export const severitySchema = z.enum(SEVERITIES);
export const confidenceSchema = z.enum(CONFIDENCES);
export const protectionLevelSchema = z.enum(PROTECTION_LEVELS);
export const categorySchema = z.enum(CATEGORIES);
export const agentSchema = z.enum(AGENTS);

export type Severity = z.infer<typeof severitySchema>;
export type Confidence = z.infer<typeof confidenceSchema>;
export type ProtectionLevel = z.infer<typeof protectionLevelSchema>;
export type Category = z.infer<typeof categorySchema>;

/** Strict semantic version: MAJOR.MINOR.PATCH (no pre-release or build metadata yet). */
export const semverSchema = z.string().regex(/^\d+\.\d+\.\d+$/, "must look like 1.0.0");

/** Lowercase identifier used for languages and frameworks, e.g. "typescript", "next.js". */
export const slugSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9.+#-]{0,39}$/, "must be a lowercase slug such as 'typescript'");

/** Short human text. Bounded so a malicious file cannot exhaust memory. */
export const shortText = (max = 300) => z.string().trim().min(1).max(max);
export const longText = (max = 2000) => z.string().trim().min(1).max(max);

/** Relative POSIX-style path inside the project. Absolute paths and ".." are rejected. */
export const relativePathSchema = z
  .string()
  .min(1)
  .max(260)
  .refine((p) => !p.startsWith("/") && !/^[a-zA-Z]:/.test(p), "must be a relative path")
  .refine((p) => !p.split(/[\\/]/).includes(".."), "must not contain '..'")
  .refine((p) => !p.includes("\0"), "must not contain null bytes");
