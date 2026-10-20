import type { Diagnostic } from "./parser/index.js";
import type { MasterFile, Rule } from "./schemas/index.js";

/**
 * Check that every rule reference in a master file points at something that exists.
 * Unknown rule IDs are errors. A collection with no rules yet is a warning.
 */
export function checkMasterReferences(
  master: MasterFile,
  rules: readonly Rule[],
  source = "<master>",
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const ids = new Set(rules.map((r) => r.id));
  const categories = new Set(rules.map((r) => r.category));

  master.ruleReferences.forEach((ref, index) => {
    const path = `ruleReferences[${index}]`;
    if ("rule" in ref) {
      if (!ids.has(ref.rule)) {
        diagnostics.push({
          severity: "error",
          source,
          path,
          message: `references unknown rule '${ref.rule}'`,
        });
      }
    } else if (!categories.has(ref.collection)) {
      diagnostics.push({
        severity: "warning",
        source,
        path,
        message: `collection '${ref.collection}' has no rules yet`,
      });
    }
  });
  return diagnostics;
}

/** Return the rules a master file selects (before language, framework or level filtering). */
export function resolveMasterRules(master: MasterFile, rules: readonly Rule[]): Rule[] {
  const wanted = new Set<string>();
  for (const ref of master.ruleReferences) {
    if ("rule" in ref) wanted.add(ref.rule);
    else for (const r of rules) if (r.category === ref.collection) wanted.add(r.id);
  }
  return rules.filter((r) => wanted.has(r.id));
}
