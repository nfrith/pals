# ALS (Agent Language Specification)

ALS is a strict specification language for defining personal agent systems.

## Vocabulary

Canonical glossary lives at [`skills/docs/references/vocabulary.md`](skills/docs/references/vocabulary.md). All term definitions — profiles, core abstractions, constructs, versioning axes — live there. This file does not redefine them.

## Project Status

- ALS has a public beta research preview.
- The broader world-facing launch, release/update model, and stability posture are still being finished.
- ALS is not being used in any production environment yet.

## Current Focus

- **v1 is the current focus.** Lessons from v0 were applied — several hard-to-implement features like skill/app management and migrations were removed from the initial scope. They will be reintroduced into v1 later.
- v0 has been removed from this repo.
- The working reference implementation is `reference-system/`. The compiler is being built to match this intended solution.

## Rules

- The SDR process defined in `sdr/AGENTS.md` must be followed when recording spec decisions.
- We are building this system to scale. It is not meant for startup go-fast mode.

## Testing

- When adding a new feature, rule, or definition to the compiler, tests must be written — including negative tests that verify invalid input is correctly rejected.
