# Compatibility Classification Contract

## Status

Accepted

## Context

- ALS had a documented five-class compatibility vocabulary in `als-factory/docs/release-model/update-mechanics/version-policy.md`, but no compiler-owned source of truth.
- Multiple consumers need the same vocabulary: ALS factory jobs, changelog entries, release-prep summaries, and downstream lifecycle work.
- A single job may span more than one compatibility class, so a scalar field would lose real release information.
- Release-cut work still needs one most-disruptive headline class for summary purposes.

## Decision

- The canonical compatibility vocabulary lives in `alsc/compiler/src/contracts.ts`.
- The compiler exports:
  - `COMPATIBILITY_CLASSES`
  - `CompatibilityClass`
  - `COMPATIBILITY_CLASS_METADATA`
  - `COMPATIBILITY_CLASS_RELEASE_HEADLINE_ORDER`
- The accepted classes are:
  - `docs_only`
  - `refresh_required`
  - `additive`
  - `migration_required`
  - `breaking_without_path`
- `COMPATIBILITY_CLASS_METADATA` is the public per-class contract and records:
  - human-readable description
  - whether operator action is required
  - the release-headline precedence rank
- The canonical precedence order is:
  - `breaking_without_path`
  - `migration_required`
  - `refresh_required`
  - `additive`
  - `docs_only`
- ALS factory jobs store the raw field as `compatibility_classes`, a list of `CompatibilityClass` values.
- `compatibility_classes` stays nullable while a job is still in flight. Once a job is classified, the stored value is the raw list, not a collapsed scalar.
- The precedence order exists only to collapse many per-job classes into one release-level headline. It does not replace the underlying list on jobs or on individual changelog entries.

## Normative Effect

- Required: every consumer of the compatibility vocabulary uses the compiler-owned literal set or the authored shim that re-exports it.
- Required: no consumer invents a local mirror enum with different spellings or ordering.
- Required: ALS factory jobs use `compatibility_classes` as a list-valued field.
- Required: release summaries use the canonical precedence order when one headline class must be chosen.
- Allowed: a job to carry multiple compatibility classes.
- Allowed: `compatibility_classes: null` before changelog staging.
- Rejected: a scalar compatibility field on jobs.
- Rejected: per-consumer copies of the vocabulary that can drift from the compiler contract.

## Compiler Impact

- `alsc/compiler/src/contracts.ts` becomes the public compatibility source of truth.
- Authored surfaces re-export the compatibility contract through `.als/authoring.ts` shims so `module.ts` definitions can consume the same literals.
- Tests must cover:
  - the exported literal set
  - metadata semantics
  - precedence collapse behavior

## Docs and Fixture Impact

- `version-policy.md` must describe the human meaning of the classes while pointing back to the compiler contract as the source of truth.
- ALS factory job records must carry `compatibility_classes: null` until they reach changelog staging.
- Operator-facing documentation must refer to `compatibility_classes`, not older placeholder names.

## Alternatives Considered

- Keep the vocabulary as prose only.
- Rejected because the release workflow, changelog validation, and downstream lifecycle tooling need one typed contract.

- Store only one class per job.
- Rejected because jobs can legitimately mix changes such as `refresh_required` and `additive`, and collapsing early throws away information.

## Non-Goals

- Warning emission or deprecation lifecycle behavior that consumes this contract later.
- Automatic release cutting or changelog promotion.
