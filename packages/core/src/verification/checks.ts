import { z } from "zod";
import { findingSchema, type Finding } from "../findings/model.js";
import type { ProjectProfile } from "../project-detection/types.js";

/** One verification check AEGIS can plan: a tool run that produces evidence. */
export interface CheckDefinition {
  id: string;
  name: string;
  /** External tool the check relies on. */
  tool: string;
  /** Whether the project has what the check needs. Checks that do not apply are not planned. */
  appliesTo(profile: ProjectProfile): boolean;
}

const hasTool = (p: ProjectProfile, name: string) => p.tools.some((t) => t.name === name);

export const CHECK_DEFINITIONS: readonly CheckDefinition[] = [
  { id: "secrets", name: "Secret detection", tool: "gitleaks", appliesTo: () => true },
  { id: "static-analysis", name: "Static analysis", tool: "semgrep", appliesTo: () => true },
  {
    id: "typecheck",
    name: "TypeScript type check",
    tool: "tsc",
    appliesTo: (p) => hasTool(p, "tsc"),
  },
  { id: "lint", name: "Lint", tool: "eslint", appliesTo: (p) => hasTool(p, "eslint") },
  {
    id: "dependency-audit",
    name: "npm dependency audit",
    tool: "npm-audit",
    appliesTo: (p) => p.packageManagers.some((m) => m.name === "npm"),
  },
  {
    id: "dependency-vulnerabilities",
    name: "Dependency vulnerability scan",
    tool: "osv-scanner",
    appliesTo: (p) => p.packageManagers.length > 0,
  },
];

export type CheckOutcomeKind =
  | "passed" // the check ran and found nothing
  | "findings" // the check ran and reported findings
  | "failed" // the check ran and failed deterministically (must come with findings)
  | "skipped" // the check was planned but not performed
  | "tool-error"; // the tool could not run correctly (crash, timeout, unreadable output)

export const checkOutcomeSchema = z
  .object({
    outcome: z.enum(["passed", "findings", "failed", "skipped", "tool-error"]),
    reason: z.string().max(500).optional(),
    findings: z.array(findingSchema).max(1000).default([]),
  })
  .strict();

export interface CheckOutcome {
  outcome: CheckOutcomeKind;
  reason?: string;
  findings: Finding[];
}

export interface CheckResult extends CheckOutcome {
  id: string;
  name: string;
  tool: string;
}

export interface CheckContext {
  root: string;
  profile: ProjectProfile;
  /** True when running tools installed inside the project (tsc, eslint) is allowed. */
  allowProjectTools: boolean;
  timeoutMs: number;
}

/** Runs one check. Real runners live in scanners/. */
export type CheckRunner = (ctx: CheckContext) => Promise<CheckOutcome>;

/** Used when no runner was supplied for a check: nothing is executed, and the report says so. */
export const notImplementedRunner: CheckRunner = async () => ({
  outcome: "skipped",
  reason: "no runner was provided for this check, so it was not performed",
  findings: [],
});
