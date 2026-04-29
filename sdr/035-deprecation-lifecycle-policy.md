# Deprecation Lifecycle Policy

## Status

Accepted

## Context

- ALS had compatibility classes and release-cut policy, but no written lifecycle for announcing a deprecation before removing a construct.
- Without a lifecycle rule, future removals would oscillate between silent aliases and surprise hard failures.
- ALS needs one policy that ties the compiler warning contract, compatibility classes, and release notes together.

## Decision

- ALS uses a three-stage lifecycle for compiler-owned constructs:
  - `supported`
  - `deprecated`
  - `removed`
- `deprecated` means the construct still validates, but `alsc validate` emits a warning diagnostic carrying structured deprecation metadata.
- A construct must remain in `deprecated` state for at least two released ALS versions before removal.
- Example:
  - deprecated in `v1.4`
  - still deprecated in `v1.5`
  - earliest removal in `v1.6`
- Announcing a new deprecation is classified as `additive`.
- Removing a previously deprecated construct is classified by the actual removal impact:
  - `refresh_required`
  - `migration_required`
  - `breaking_without_path`
- `breaking_without_path` for removing an existing supported construct should be reserved for cases where a prior deprecation announcement already shipped. Enforcement of that rule is future work, not part of this decision.
- `/update` does not auto-rewrite deprecated values in this job. The `replacement` metadata is advisory until a later job consumes it.

## Normative Effect

- Required: a construct receives a deprecation announcement before a normal removal.
- Required: the minimum runway is two released ALS versions.
- Required: the changelog classification for a deprecation announcement is `additive`.
- Required: the class for a removal release reflects the real removal impact instead of inheriting `additive`.
- Allowed: a later removal job to ship a compatibility shim instead of a hard failure, with the compat class chosen from the actual effect.
- Rejected: silent removal of an existing supported construct with no prior announcement.
- Rejected: treating the warning phase itself as a blocking validation failure.

## Compiler Impact

- The compiler warning contract from SDR 034 becomes the operator-visible signal for the `deprecated` lifecycle stage.
- Future removal jobs consume the same metadata and decide whether the removal lands as a shimmed migration or a hard invalidation.
- No new auto-rewrite behavior is introduced here.

## Docs and Fixture Impact

- `als-factory/docs/release-model/update-mechanics/version-policy.md` must define the lifecycle, the two-version runway, and the compat-class interaction.
- `skills/docs/references/deprecation-and-warnings.md` explains how the lifecycle appears in validation output.
- `skills/docs/references/compatibility-classes.md` explains how compatibility classes map to deprecation announcement versus removal.

## Alternatives Considered

- One-version deprecation runway.
- Rejected because it does not provide meaningful operator runway between announcement and removal.

- No minimum runway at all.
- Rejected because the policy would collapse back into surprise breakage whenever removal pressure appears.

## Non-Goals

- Changelog-gate enforcement that proves every `breaking_without_path` removal had a prior deprecation announcement.
- Automatic `/update` rewrites that consume the `replacement` field.
