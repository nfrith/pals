# Item 12 Decision Record: Runtime-Owned State Transitions

Status: accepted and implemented
Related TODO item: `TODO.md` -> `### 12. State-transition validation is referenced but has no declaration model`

## Problem

The current baseline says the linter should enforce state transitions.

The specific overreach is in `SPEC.md` Section 15, which currently says the linter should:

`Enforce references, declared fields/sections, nullability, enums, state transitions.`

That does not line up with the rest of the repository:

- the compiler has machine-readable contracts for schema shape, refs, identities, and module structure
- state-transition rules currently live in versioned module skill content
- migration manifests may describe transition behavior tests, but they are not a compiler contract

This creates a scope mismatch:

- the compiler sees a static record snapshot, not a before/after write history
- the compiler has no declared transition model to read
- parsing `SKILL.md` prose as if it were a stable machine contract would be brittle
- requiring previous-state input for ordinary validation would expand compiler scope well beyond the current baseline

## Decision Summary

Keep state-transition validation out of the baseline compiler. Module skills enforce transitions at write time.

Keep these rules:

1. The compiler continues to validate static schema and module invariants.
2. Enum validation remains compiler-owned.
3. Some module skills may define workflow rules and transition guards in their versioned content.
4. Migration manifests may carry transition-oriented behavior tests for migrate workflows.

Add these rules:

1. `palsc validate` does not validate previous-state -> next-state hop legality in the current baseline.
2. `palsc validate` does not derive workflow contracts from `SKILL.md` prose.
3. Transition legality is owned by module write entrypoints and runtime guard logic.
4. Cross-field snapshot business rules expressed only in module skill workflow prose are also runtime-owned in the current baseline.
5. Enum fields are plain enums by default. A field becomes workflow-governed only when module write behavior explicitly gives it lifecycle meaning.
6. If a future machine-readable workflow or constraints contract is introduced, it must be specified as a new normative surface, not inferred from existing skill prose.

## Proposed Responsibility Boundary

Compiler owns static snapshot validation:

1. field presence and unknown-field checks
2. section presence and unknown-section checks
3. type, nullability, enum, ref, identity, and path validation

Runtime owns workflow validation:

1. whether a requested write is allowed from the record's current state
2. whether a transition guard passes
3. whether a direct state hop is forbidden
4. cross-field business guards that are only declared in module skill prose

Migration and behavior-test workflows own transition exercises:

1. transition test cases recorded in `MANIFEST.md`
2. validation that a new module version's write behavior matches the intended lifecycle rules

Default rule for enum fields:

1. An enum field is just an enum unless the module's write behavior explicitly treats it as a workflow field.
2. If no workflow semantics are declared for an enum field, the compiler validates only membership in the declared `allowed` set.

## Example Shapes

The experiments module makes the boundary concrete.

Experiment schema:

```yaml
status:
  type: enum
  nullable: false
  allowed: [draft, awaiting-funds, funded, active, paused, completed]
budget:
  type: number
  nullable: true
```

Experiment skill workflow:

```text
draft -> awaiting-funds -> funded -> active

draft -> awaiting-funds requires budget > 0
awaiting-funds -> funded requires budget > 0
funded -> active requires budget > 0
direct draft -> active is forbidden
```

### Example 1: Schema-valid but runtime-invalid

```yaml
status: active
budget: null
```

Under this decision:

1. the compiler may accept this snapshot because `active` is in the allowed enum and `budget` is nullable
2. the runtime must reject any write that tries to produce this state through module entrypoints

This is not a compiler bug under the baseline.

It means one of the following happened:

1. the file was produced outside the guarded write path
2. a migration encoded the business rule incorrectly
3. a human edited the file into a schema-valid but runtime-invalid state

This detection gap is an intentional consequence of keeping the baseline compiler limited to declared static contracts.

### Example 2: Transition legality is runtime-owned

Suppose an experiment moves from:

```yaml
status: draft
budget: 2500
```

to:

```yaml
status: active
budget: 2500
```

The compiler only sees the final snapshot. It cannot tell whether the record legally passed through:

`draft -> awaiting-funds -> funded -> active`

or illegally jumped directly:

`draft -> active`

That hop legality belongs to the module write path, not baseline validation.

### Example 3: Static-invalid remains compiler-owned

```yaml
status: launched
budget: 2500
```

The compiler must reject this because `launched` is not in the declared enum.

## Boundary Note: Schemas, Skills, and Manifests

This decision does not redefine schema enums as transition graphs.

For item `12`:

1. `frontmatter_contract.allowed` defines allowed current values, not allowed transitions.
2. Versioned module `SKILL.md` content may define workflow rules and write-time guards for modules that need them.
3. The presence of an enum field does not by itself imply lifecycle semantics.
4. `MANIFEST.md` may describe transition behavior tests, but that does not make transition validation part of the baseline compiler.
5. `record-validation.md` should remain a static validation spec unless a new explicit workflow or constraints contract is added later.

## Why This Direction

1. It matches the current repository shape, where workflow rules already live in versioned module skills.
2. It keeps the compiler deterministic and static.
3. It avoids forcing the compiler to parse prose as if it were a formal DSL.
4. It avoids making previous-state input mandatory for ordinary validation runs.
5. It preserves a clean separation between schema validation and business-logic enforcement.
6. It makes the current limitation explicit: schema-valid but runtime-invalid snapshots can exist if produced outside guarded write paths.
7. It keeps the door open for a future explicit workflow or constraints contract without overloading the baseline compiler now.

## Explicit Non-Goals For This Decision

1. Do not introduce a workflow or transition DSL in baseline schema files.
2. Do not make `palsc validate` read `SKILL.md` and infer legal state graphs.
3. Do not require previous snapshots for baseline validation runs.
4. Do not treat every enum field as an implicit workflow field.
5. Do not collapse runtime behavior tests into compiler diagnostics.

## Repo Surfaces Updated By This Decision

This decision required coordinated updates in at least:

1. `SPEC.md`
2. `TODO.md`
3. any repo docs/examples that still describe baseline compiler-owned state-transition enforcement

The key normative update was:

1. `SPEC.md` Section 15 no longer includes `state transitions` in baseline linter responsibilities and explicitly assigns workflow enforcement to module write skills

This repository is still pre-release. This decision is now implemented in the normative spec files and tracked as resolved in `TODO.md`.
