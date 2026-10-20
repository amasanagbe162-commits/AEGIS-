# Contributing to AEGIS

Thanks for helping! AEGIS is in early development, so the most useful contributions right now are feedback on the design and small, well-tested changes.

## Setup

```bash
git clone <your fork>
cd aegis
npm install
```

## Before opening a pull request

Run all of these and make sure they pass:

```bash
npm run lint
npm run format:check
npm run typecheck
npm run build
npm test
```

## Guidelines

- Keep changes small and focused on one thing.
- Add or update tests for behavior you change.
- Do not commit secrets, real credentials, or private code. Use fictional values in examples.
- Do not claim a feature works unless it is tested. Mark unfinished work as PLANNED.
- Use clear commit messages, for example `fix: handle empty config file`.

## Proposing a protection rule

Open a "New rule proposal" issue first. Rules need a bad example, a corrected example, the risk, assumptions and limitations, and verification guidance. Rule authoring docs will arrive in a later phase.

## Code of conduct

Participation is governed by [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
