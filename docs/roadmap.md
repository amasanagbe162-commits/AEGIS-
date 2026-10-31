# Roadmap

Status values: not started, in progress, done.

| Phase | Goal                                                      | Status                     |
| ----- | --------------------------------------------------------- | -------------------------- |
| 0     | Repository foundation (tooling, CI, community files)      | done                       |
| 1     | Repository inspection and architecture design             | done                       |
| 2     | `.aegis` format, schemas, master file, starter rules      | done                       |
| 3     | Core engine (detection, selection, findings, reports)     | done                       |
| 4     | CLI (`init`, `scan`, `check`, `rules`, `doctor`)          | done                       |
| 5     | Security tool integrations (Semgrep, Gitleaks, ...)       | done                       |
| 6     | Agent integrations (Claude Code, Copilot, Codex, ChatGPT) | done                       |
| 7     | Self-correction and learning records                      | done                       |
| 8     | Offline baseline and optional signed updates              | done                       |
| 9     | Testing and hardening                                     | done                       |
| 10    | Documentation and release readiness                       | code done; needs a person* |

The full specification lives in `docs/AEGIS-MASTER-SPEC.md` (add it from your local copy).

\* Phase 10 is done as far as the tool can do it. It still needs a person for four things listed in [acceptance.md](acceptance.md): a human review of the rules, the signing key, the npm name, and macOS/Windows runs.
