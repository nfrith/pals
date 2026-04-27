# Installed Delamain Updates

## Decision

An installed delamain updates by pull, not by push. The operator upgrades to a specific ALS plugin release, then runs a dedicated upgrade flow that compares the local installed bundle against the newer bundled shelf version.

ALS does not evergreen-update operator systems, does not mutate them from the background, and does not treat reinstall as the normal upgrade path.

## What Is Being Updated

An installed delamain can involve all of the following:

- the module bundle under `.als/modules/<module_id>/vN/`
- the active module entry in `.als/system.ts`
- projected dispatcher assets under `.claude/delamains/`
- projected skills under `.claude/skills/`
- live records or state that may require migration

These surfaces must move together under one explicit operator action. Silent partial refresh is not acceptable.

## Intended Upgrade Flow

1. The operator pins a target ALS plugin release.
2. The operator runs `/upgrade-dispatchers`.
3. The upgrade flow discovers newer bundled delamain/module versions available from that pinned release.
4. The flow shows a classified diff:
   - `logic_only` for refreshes that do not require record rewrites
   - `refresh_required` for projected/operator-surface updates
   - `migration_required` when module data or authored source must change
5. Logic-only updates refresh the local bundle, validate the system, and redeploy the projected `.claude/` assets.
6. Migration-required updates route through the same staged, reviewable discipline ALS already uses for module evolution: explicit preparation, dry-run where needed, live cutover, validation, projection refresh, and commit.
7. The result lands as a normal git-visible change set inside the operator's repo.

## Hard Rules

- No background polling updater.
- No remote push into operator-owned repos.
- No silent rewrite of operator-owned data.
- No "reinstall from scratch" as the normative upgrade path.
- No live cutover without validation and a clear operator action boundary.

## Current Implementation Gap

Today this flow does not exist yet. `skills/upgrade-dispatchers/SKILL.md` is a placeholder, there is no shipped version-diff surface for installed delamains, and there is no first-class operator command for refreshing a Foundry-installed dispatcher safely.

That gap is a launch blocker. The implementation work is captured in `../launch/punchlist.md`.
