# Writing a protection rule

Rules live in `packages/rules/data/<category>/<id>.yaml`. Start from an existing file such as `AEGIS-SEC-0001.yaml`.

## Checklist

1. Pick the next free id in the category, for example `AEGIS-SEC-0005`. The file name must match the id.
2. Fill in every required field. See [the format specification](../formats/aegis-file-spec.md) and `formats/rule-schema.json`.
3. Write `appliesWhen` carefully. Do not claim every application needs the same control.
4. Give a **bad example** and a **corrected example** in the same language. Use fictional credentials only.
5. State real `assumptions` and `limitations`. A corrected example is not universally secure.
6. Add `verification` steps a developer can actually perform.
7. Use `status: proposed`, with no `review` block. A reviewer sets `approved` and adds a `review` block (see "Approving a rule" below).
8. Add a test that runs your bad and corrected examples (see `tests/rules/rule-examples.test.ts`) so the claim "the corrected example solves the problem" is checked, not assumed.
9. Run `npm test`. This loads every rule and reports problems with file, field and line.

## What validation does not prove

Passing validation means the file is well formed. It does not mean the advice is correct. Review by a person is what moves a rule from `proposed` to `approved`.

## Approving a rule

A rule becomes `approved` only when its file contains a `review` block, and the schema rejects `approved` without one. The block records:

- `reviewerKind`: `human` (a person reviewed it) or `ai-assisted` (an AI model reviewed it and a person has not confirmed it). Be truthful: tests check that an AI-assisted review says a human has not yet confirmed it.
- `reviewer` and `reviewedAt` (a date).
- `gates`: **every** quality gate from the specification, which you are stating you checked: `metadata-valid`, `description-accurate`, `severity-justified`, `examples-technically-correct`, `corrected-example-solves-the-problem`, `references-legitimate`, `tests-pass`, `scanner-configuration-safe`, `behavior-documented`, `no-secrets`, `dangerous-examples-not-executed-by-tooling`, `compatibility-clear`.
- `notes`: what you actually did (for example which references you opened).

Do not list a gate you did not check. A rule that blocks automatically or runs an external scanner deserves a second reviewer. Bump the rule's `version` and `BASELINE_RULES_VERSION` when you change an approved rule.
