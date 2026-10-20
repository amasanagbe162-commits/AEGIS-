# Writing a protection rule

Rules live in `packages/rules/data/<category>/<id>.yaml`. Start from an existing file such as `AEGIS-SEC-0001.yaml`.

## Checklist

1. Pick the next free id in the category, for example `AEGIS-SEC-0005`. The file name must match the id.
2. Fill in every required field. See [the format specification](../formats/aegis-file-spec.md) and `formats/rule-schema.json`.
3. Write `appliesWhen` carefully. Do not claim every application needs the same control.
4. Give a **bad example** and a **corrected example** in the same language. Use fictional credentials only.
5. State real `assumptions` and `limitations`. A corrected example is not universally secure.
6. Add `verification` steps a developer can actually perform.
7. Use `status: proposed`. A maintainer sets `approved` after reviewing that the rule is technically correct.
8. Run `npm test`. This loads every rule and reports problems with file, field and line.

## What validation does not prove

Passing validation means the file is well formed. It does not mean the advice is correct. Review by a person is what moves a rule from `proposed` to `approved`.
