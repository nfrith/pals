# Delamain Dispatcher Update Command

## Status

Accepted

## Context

- SDR-024 introduced dispatcher template version files and the stale-version advisory line, but it pointed operators at `/upgrade-dispatchers`.
- ALS now converges on one edgerunner-facing update surface: `/update`.
- The placeholder `/upgrade-dispatchers` skill is being retired as part of the release/update reconciliation pass.
- Stale dispatcher templates still need a non-fatal startup signal and an actionable upgrade path.
- Missing local or canonical dispatcher version files still need to fail fast so broken dispatcher assets are caught immediately.

## Decision

- This SDR supersedes SDR-024 for the operator-facing command surface while leaving SDR-024 intact as the historical record of how dispatcher `VERSION` files were introduced.
- When the local dispatcher version is numerically older than the canonical version, the startup log line includes `run /update to update`.
- `/update` is the only user-facing update command for dispatcher drift as well as broader ALS release drift.
- The `/upgrade-dispatchers` skill is deleted.
- Automated dispatcher refresh remains future work, but when it lands it folds into `/update` rather than surfacing as a second public command.
- The stale-version comparison remains advisory. It never blocks dispatcher startup or polling when both local and canonical version sources are readable and valid.
- Missing, unreadable, or malformed local or canonical version files remain hard startup errors.

## Normative Effect

- Required: stale local dispatcher versions produce an actionable `/update` instruction and continue running.
- Required: dispatcher template tests assert the `/update` wording.
- Required: copied dispatcher bundles and reference docs align with the `/update` wording.
- Required: the public release/update contract advertises one operator-facing update command, not separate dispatcher and ALS upgrade commands.
- Allowed: architect/dev tooling to keep direct refresh commands for internal use as long as the edgerunner contract remains `/update`.
- Rejected: a separate edgerunner-facing dispatcher upgrade command.
- Rejected: rollback or reverse migration as the normal response to stale dispatcher code.

## Docs and Fixture Impact

- Update dispatcher reference docs and module-integration docs to point to `/update`.
- Refresh the canonical dispatcher template and all inherited `dispatcher-version.ts` copies with the new wording.
- Delete the placeholder `skills/upgrade-dispatchers/` bundle once the string sweep and tests pass.
- Keep SDR-024 untouched as the superseded historical artifact.

## Non-Goals

- Implementing the future dispatcher refresh orchestration inside `/update`.
- Changing the numeric dispatcher `VERSION` contract introduced by SDR-024.
- Changing module version semantics or language migration semantics.
