import { resolveRulesInUse, type RulesInUse } from "@aegis/core";
import { BASELINE_RULES_VERSION, RULES_DIR, TRUSTED_KEYS } from "@aegis/rules";

/** The rules a project uses: its installed, verified update if there is one, else the shipped baseline. */
export function rulesInUse(root: string): Promise<RulesInUse> {
  return resolveRulesInUse(root, { dir: RULES_DIR, version: BASELINE_RULES_VERSION });
}

export { BASELINE_RULES_VERSION, TRUSTED_KEYS };
