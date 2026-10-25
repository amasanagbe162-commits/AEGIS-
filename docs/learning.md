# Learning records

AEGIS can keep a reviewed list of mistakes your agents made on **this project** and how they were fixed. Approved lessons are added to the instruction files `aegis agents sync` generates, so the next session starts with them.

This is a record keeper with a review step. It is **not machine learning**, and nothing is uploaded: records are plain JSON files in `.aegis/learning/`.

## Lifecycle

```
observed -> proposed -> verified -> approved -> superseded
   \          \           \
    +----------+-----------+--> rejected
```

| Status     | Meaning                                    | How it gets there                                                                  |
| ---------- | ------------------------------------------ | ---------------------------------------------------------------------------------- |
| observed   | Something went wrong                       | `aegis learn add`                                                                  |
| proposed   | Root cause and correction are written down | Add both (`--root-cause`, `--correction`), at creation or with `aegis learn amend` |
| verified   | A real AEGIS check came back clean         | `aegis learn verify <id>` runs the checks itself and records the result            |
| approved   | A named person accepted it                 | `aegis learn review <id> --approve ...`, at a terminal, with a confirmation        |
| rejected   | Not useful or wrong                        | `aegis learn review <id> --reject ...`                                             |
| superseded | Replaced by a newer approved lesson        | `aegis learn supersede <id> --by <id>`                                             |

## Why you can trust a "verified" record

- Evidence is recorded **by AEGIS** from a real run, never typed in by the agent.
- It must be **clean and complete**: every planned check ran. An INCOMPLETE run (for example Gitleaks is not installed) does not verify, because a skipped check proves nothing.
- Only the **latest** check counts, so a later failing run un-verifies it.
- Notes are context only and can never verify a record.
- Changing the root cause or correction (`amend`) clears the evidence and returns the record to proposed.
- **Approval cannot be scripted.** It needs a terminal and a typed confirmation, and `--yes` does not bypass it, so an agent that runs shell commands cannot approve its own work. Rejecting does not need a terminal.

"Verified" means the project's checks passed after the fix. It does not prove the lesson is technically correct: that is what the human review is for.

## Privacy

- Secrets are redacted before anything is written (pattern based, so a safety net rather than a guarantee).
- Text containing a code fence is refused: describe the pattern in words instead of pasting private code.
- Fields are length-limited, and the record holds no logs and no file contents.
- Damaged, oversized, mismatched or symlinked record files are reported (`aegis learn list` exits 2, `aegis doctor` warns) and never silently dropped. Their ids stay reserved.
- Add `.aegis/learning/` to Git if the team should share lessons. `.aegis/state/` (the Stop hook's counter) ignores itself.

## Example

```bash
aegis learn add --title "Raw SQL from request data" \
  --issue "The agent built a query string from a request parameter." \
  --category security --language javascript \
  --root-cause "Input was concatenated into the SQL text." \
  --correction "Always pass values as bound parameters."
aegis learn verify LR-0001                       # runs the real checks
aegis learn review LR-0001 --approve --reviewer isaacco --reason "Matches AEGIS-SEC-0001"
aegis agents sync --yes                          # lesson now appears in agent instructions
```

## From project lesson to shared rule

A project lesson is local. Turning one into a bundled protection rule is a separate, human step: write it as a rule (see [rule-authoring.md](rule-authoring.md)) and submit a pull request, where it is reviewed like any other rule. AEGIS never promotes a record into the trusted library by itself.
