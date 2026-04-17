# ALS (Agent Language Specification)

ALS is a strict specification language for defining personal agent systems.

## Profiles

All profiles are end users of ALS. The distinction is in what they do with the system, not in their status. Every profile — including Claude — is a user whose experience matters.

### Operator

End user. Uses a Claude harness (Claude Code, Cowork) on a project that happens to be an ALS system. May not be technical. May never invoke ALS skills directly — they interact with the system through skills that were built for them. Their most common ALS touchpoint is `/run-delamains` to start their pipelines.

### ALS Developer

End user. Builds ALS systems for operators. Knows the spec. Uses `/install`, `/new`, `/change`, `/migrate` to create and evolve modules. May package and distribute modules for operators to install.

### ALS Architect

End user. Alters the language itself. Architects the spec, writes SDRs, evolves the compiler, defines new language constructs. Currently: Nicholas Frith.

### Claude

End user. Present with all of the above. Enables each profile to do whatever they aim to do — from answering operator questions to authoring modules to implementing spec changes.

## Project Status

- This project is under active development and is not officially released yet.
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
