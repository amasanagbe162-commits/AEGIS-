import type { Finding } from "../findings/model.js";
import type { Diagnostic } from "../parser/diagnostics.js";
import type { DetectedItem } from "../project-detection/types.js";
import type { ProtectionLevel, Severity } from "../schemas/common.js";
import type { CheckResult } from "../verification/checks.js";
import type { Verdict } from "../verification/verdict.js";
import type { MatchKind } from "../rule-matching/select.js";

export const REPORT_VERSION = 1 as const;

export interface ScanReport {
  reportVersion: typeof REPORT_VERSION;
  tool: { name: "aegis"; version: string };
  generatedAt: string;
  protectionLevel: ProtectionLevel;
  policy: { summary: string; minRuleSeverity: Severity; blockThreshold: Severity };
  project: {
    /** Folder name only. Absolute paths are not recorded. */
    name: string;
    languages: DetectedItem[];
    frameworks: DetectedItem[];
    packageManagers: DetectedItem[];
    tools: DetectedItem[];
    uncertainties: string[];
    filesIndexed: number;
    truncated: boolean;
  };
  rules: {
    loaded: number;
    selected: { id: string; title: string; severity: Severity; match: MatchKind; reason: string }[];
    skipped: { id: string; reason: string }[];
    diagnostics: Diagnostic[];
  };
  checks: CheckResult[];
  checksNotApplicable: { id: string; name: string; reason: string }[];
  findings: Finding[];
  summary: {
    findingsBySeverity: Record<Severity, number>;
    blockingFindings: number;
    checksPlanned: number;
    checksPerformed: number;
    checksNotPerformed: number;
  };
  verdict: Verdict;
  exitCode: number;
  notes: string[];
}
