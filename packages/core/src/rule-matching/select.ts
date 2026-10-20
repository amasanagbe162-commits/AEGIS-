import type { AegisConfig } from "../schemas/config.js";
import type { ProtectionLevel } from "../schemas/common.js";
import { atLeast } from "../findings/model.js";
import type { Rule } from "../schemas/rule.js";
import type { ProjectProfile } from "../project-detection/types.js";
import { LEVEL_POLICIES } from "./levels.js";

export type MatchKind = "language-agnostic" | "framework" | "language";

export interface SelectedRule {
  rule: Rule;
  match: MatchKind;
  /** Why the rule was selected, for transparency. */
  reason: string;
}

export interface SkippedRule {
  id: string;
  reason: string;
}

export interface Selection {
  selected: SelectedRule[];
  skipped: SkippedRule[];
}

export interface SelectOptions {
  profile: ProjectProfile;
  level: ProtectionLevel;
  config?: Pick<AegisConfig, "disabledRules" | "ruleCollections">;
}

/**
 * Choose the rules that apply to a project.
 *
 * - Rejected and superseded rules are never selected.
 * - The protection level limits categories and minimum severity.
 * - A rule with no languages applies to every project.
 * - A language-specific rule needs a detected language in common. If the project's language
 *   was not detected, only language-agnostic rules are selected (reported, not guessed).
 * - Frameworks are a relevance hint: a language match is enough, and the reason records
 *   whether a framework also matched.
 */
export function selectRules(rules: readonly Rule[], options: SelectOptions): Selection {
  const policy = LEVEL_POLICIES[options.level];
  const disabled = new Set(options.config?.disabledRules ?? []);
  const collections = options.config?.ruleCollections;
  const languages = new Set(options.profile.languages.map((l) => l.name));
  const frameworks = new Set(options.profile.frameworks.map((f) => f.name));

  const selected: SelectedRule[] = [];
  const skipped: SkippedRule[] = [];

  for (const rule of rules) {
    const skip = (reason: string) => skipped.push({ id: rule.id, reason });

    if (rule.status === "rejected" || rule.status === "superseded") {
      skip(`rule status is '${rule.status}'`);
    } else if (disabled.has(rule.id)) {
      skip("disabled in aegis.config.json");
    } else if (!policy.categories.includes(rule.category)) {
      skip(`category '${rule.category}' is not part of the ${options.level} level`);
    } else if (collections && !collections.includes(rule.category)) {
      skip(`category '${rule.category}' is not in the configured ruleCollections`);
    } else if (!atLeast(rule.severity, policy.minRuleSeverity)) {
      skip(`severity '${rule.severity}' is below the ${options.level} level minimum`);
    } else if (rule.languages.length === 0) {
      selected.push({ rule, match: "language-agnostic", reason: "applies to every language" });
    } else {
      const sharedLanguages = rule.languages.filter((l) => languages.has(l));
      if (sharedLanguages.length === 0) {
        skip(`no matching language (rule: ${rule.languages.join(", ")})`);
      } else {
        const sharedFrameworks = rule.frameworks.filter((f) => frameworks.has(f));
        if (sharedFrameworks.length > 0) {
          selected.push({
            rule,
            match: "framework",
            reason: `language ${sharedLanguages.join(", ")} and framework ${sharedFrameworks.join(", ")} detected`,
          });
        } else {
          selected.push({
            rule,
            match: "language",
            reason: `language ${sharedLanguages.join(", ")} detected`,
          });
        }
      }
    }
  }
  return { selected, skipped };
}
