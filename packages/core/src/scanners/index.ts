import type { CheckRunner } from "../verification/checks.js";
import { defaultScannerDeps, type ScannerDeps } from "./common.js";
import { createGitleaksRunner } from "./gitleaks.js";
import { createNpmAuditRunner } from "./npm-audit.js";
import { createOsvScannerRunner } from "./osv-scanner.js";
import { createEslintRunner, createTscRunner } from "./project-tools.js";
import { createSemgrepRunner } from "./semgrep.js";

export * from "./common.js";
export { createGitleaksRunner } from "./gitleaks.js";
export { createSemgrepRunner, normalizeRuleId, type SemgrepOptions } from "./semgrep.js";
export { createNpmAuditRunner } from "./npm-audit.js";
export { createOsvScannerRunner } from "./osv-scanner.js";
export {
  createTscRunner,
  createEslintRunner,
  parseTscOutput,
  parseEslintOutput,
} from "./project-tools.js";

export interface DefaultRunnerOptions {
  /** Path of the AEGIS Semgrep rule file (exported by @aegis/rules). */
  semgrepRulesFile?: string | undefined;
  deps?: ScannerDeps;
}

/** The real runners for every check id AEGIS plans. */
export function createDefaultRunners(
  options: DefaultRunnerOptions = {},
): Record<string, CheckRunner> {
  const deps = options.deps ?? defaultScannerDeps();
  return {
    secrets: createGitleaksRunner(deps),
    "static-analysis": createSemgrepRunner(deps, { rulesFile: options.semgrepRulesFile }),
    typecheck: createTscRunner(deps),
    lint: createEslintRunner(deps),
    "dependency-audit": createNpmAuditRunner(deps),
    "dependency-vulnerabilities": createOsvScannerRunner(deps),
  };
}
