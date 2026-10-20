import type { Category, ProtectionLevel, Severity } from "../schemas/common.js";

/** What a protection level changes. These are real settings used by selection and verdicts. */
export interface LevelPolicy {
  /** Rule categories included at this level. */
  categories: readonly Category[];
  /** Rules less severe than this are not selected. */
  minRuleSeverity: Severity;
  /** Findings at or above this severity make the result "findings" (exit code 1). */
  blockThreshold: Severity;
  /** Verification checks planned at this level (see verification/checks.ts). */
  checkIds: readonly string[];
  /** Human-readable summary, shown in reports and docs. */
  summary: string;
}

const STANDARD_CHECKS = ["secrets", "static-analysis", "typecheck", "lint"] as const;
const ADVANCED_CHECKS = [
  ...STANDARD_CHECKS,
  "dependency-audit",
  "dependency-vulnerabilities",
] as const;

export const LEVEL_POLICIES: Record<ProtectionLevel, LevelPolicy> = {
  standard: {
    categories: ["universal", "security", "coding-errors", "dependencies"],
    minRuleSeverity: "medium",
    blockThreshold: "critical",
    checkIds: STANDARD_CHECKS,
    summary:
      "Common safety and security rules, essential checks. Only critical findings change the result.",
  },
  advanced: {
    categories: [
      "universal",
      "security",
      "coding-errors",
      "dependencies",
      "configuration",
      "testing",
    ],
    minRuleSeverity: "low",
    blockThreshold: "high",
    checkIds: ADVANCED_CHECKS,
    summary:
      "Adds configuration and testing rules and dependency vulnerability checks. High and critical findings change the result.",
  },
  maximum: {
    categories: [
      "universal",
      "security",
      "coding-errors",
      "dependencies",
      "configuration",
      "testing",
      "architecture",
    ],
    minRuleSeverity: "informational",
    blockThreshold: "medium",
    checkIds: ADVANCED_CHECKS,
    summary:
      "Every rule category and the strictest threshold. Medium, high and critical findings change the result. Slowest and most likely to report false positives.",
  },
};
