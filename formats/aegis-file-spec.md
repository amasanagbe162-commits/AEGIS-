# The `.aegis` file format, version 1.0

Status: implemented (parser, schema and tests). Agent-specific conversion beyond plain Markdown is PLANNED (Phase 6).

## 1. Purpose

An `.aegis` file is the **master policy** for AI coding agents in a project. It states how an agent should behave (operating rules, self-correction, severity handling) and which protection rules apply. AI agents do not read `.aegis` natively. AEGIS parses and validates it, then converts it into files agents do read, such as `CLAUDE.md` or Copilot instructions. The generated instructions are advisory; an agent may ignore them.

## 2. Syntax

- A `.aegis` file is a single **YAML 1.2** document, UTF-8, at most **256 KB**.
- Only the YAML **core schema** is accepted. Custom or language-specific tags (for example `!!js/function`) are errors.
- **Aliases** (`*name`) are rejected, which prevents expansion attacks.
- **Duplicate keys** and **multiple documents** are errors.
- Unknown fields are errors. This catches typos instead of silently ignoring them.
- Nothing in the file is ever executed or evaluated. Strings such as code examples are inert text.

## 3. Sections

Required fields:

| Field                    | Type                                | Meaning                                                                 |
| ------------------------ | ----------------------------------- | ----------------------------------------------------------------------- |
| `aegis`                  | `"1.0"`                             | Format version of this file.                                            |
| `kind`                   | `master`                            | File kind. Only `master` exists in 1.0.                                 |
| `name`                   | string                              | Display name.                                                           |
| `version`                | `MAJOR.MINOR.PATCH`                 | Version of this policy.                                                 |
| `description`            | string                              | What the file is for.                                                   |
| `principle`              | string                              | One-sentence guiding principle.                                         |
| `defaultProtectionLevel` | `standard` / `advanced` / `maximum` | Level used when config does not set one.                                |
| `operatingRules`         | list                                | Items with `id` (`OP-01`), `title`, and a list of `instructions`.       |
| `selfCorrection`         | object                              | `maxAttempts` (1 to 10), `steps` (name, description), optional `notes`. |
| `severityActions`        | object                              | A non-empty list of expected actions for each severity level.           |
| `ruleReferences`         | list                                | Items that are either `{ collection: <category> }` or `{ rule: <id> }`. |

Optional fields: `limitations`, `dangerousOperations`, `minimumSeverityToBlock`.

A complete example is [`templates/AEGIS.aegis`](../templates/AEGIS.aegis). The machine-readable schema is [`aegis-master-schema.json`](aegis-master-schema.json).

## 4. Rule references

The master file does not contain rules. It points at them:

- `collection: security` selects every rule in that category.
- `rule: AEGIS-SEC-0001` selects one rule by id.

Categories: `universal`, `security`, `coding-errors`, `dependencies`, `configuration`, `testing`, `architecture`.

Resolution checks: an unknown rule id is an **error**. A collection with no rules is a **warning**.

## 5. Rule files

Rules are separate YAML files, one rule per file, stored as `<category>/<id>.yaml`. The schema is [`rule-schema.json`](rule-schema.json). Additional loader checks:

- The file name must equal the rule id, and the folder must equal the category.
- The id prefix must match the category (`SEC`, `COD`, `DEP`, `CFG`, `TST`, `ARC`, `UNI`).
- Ids must be unique.
- Symbolic links and files over the size limit are refused.

Important rule fields: `severity`, `confidence`, `appliesWhen`, `badExample`, `goodExample`, `assumptions`, `limitations`, `verification`, `status`.

`status` records **review**, which is separate from validity. A file can be valid and still technically wrong. Values: `proposed`, `approved`, `rejected`, `superseded`. Only a human maintainer should set `approved`.

A rule may name an external scanner with `scanner: { tool, ruleRef }`. `tool` must be one of an allowlist (`semgrep`, `gitleaks`, `osv-scanner`, `npm-audit`, `eslint`, `tsc`). A rule can never provide a command line.

## 6. Project configuration

`aegis.config.json` (strict JSON) selects the protection level, agents, disabled rules, scan boundaries and the self-correction attempt limit. Paths must be relative and cannot contain `..`. Online updates default to off. Schema: [`config-schema.json`](config-schema.json).

## 7. Validation and error reporting

Every problem is reported as a diagnostic with a severity, the file, the field path and, where possible, the line and column:

```text
error: AEGIS.aegis:11:1 [defaultProtectionLevel] Invalid option: expected one of "standard"|"advanced"|"maximum"
```

Invalid input is rejected safely: parsing returns diagnostics instead of throwing, and a bad rule file never prevents other valid rules from loading.

Until the CLI exists (Phase 4), validate with the test suite (`npm test`), which loads every bundled rule, the master template and the config template.

## 8. Versioning and compatibility

- `aegis: "1.0"` is the format version. A parser must reject versions it does not know.
- A minor format version may only add optional fields. A major version may change required fields.
- `version` inside a file versions that file's content and follows semantic versioning.
- The JSON Schema files are generated from the Zod schemas with `npm run schemas`. A test fails if they drift apart.

## 9. Conversion to agent instructions

`renderMasterMarkdown(master, rules)` turns a validated master file and its selected rules into Markdown. Phase 6 will place that output into agent-specific files and merge it with existing instructions without overwriting them.

## 10. Security considerations

- Treat every `.aegis` and rule file as untrusted input.
- The parser never evaluates content, loads includes, or runs commands.
- Examples are stored as text and never executed. Use fictional credentials only.
- Scanner references are allowlisted names, not commands.
- Size limits bound memory use.
- This format cannot by itself force an agent to comply. Use deterministic checks for critical requirements.
