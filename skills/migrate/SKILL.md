---
name: migrate
description: Execute a staged ALS v1 module migration. Validates the staged bundle, completes the canonical migration script when needed, dry-runs on a disposable clone, and performs the live cutover atomically.
---

# migrate

Execute the migration of an ALS v1 module from its active version `vN` to the already prepared `vN+1` bundle.

`migrate` is the v1 successor to v0 `als-migrate`.

It consumes a staged bundle prepared by `change`, proves the migration against a disposable clone when live rewrites are required, then performs the live cutover.

## Input

The operator provides a module id or enough system context to identify one module.

Examples:

- `experiments`
- `migrate evaluations`
- `cut over the backlog module in this system`

Do not ask the operator for a skill path. Resolve the target module from `.als/system.ts`.

## Required Reads

Before mutating anything, read these references:

- `../change/references/manifest-template.md`
- `references/report-template.md`
- `../validate/SKILL.md`
- `../docs/references/shape-language.md`

Use `manifest-template.md` as the contract for `vN+1/migrations/MANIFEST.md`.
Use `report-template.md` as the contract for `vN+1/migrations/REPORT.md`.

## Scope & Boundaries

### What `migrate` does

- Resolves the target module from the active ALS v1 system config
- Requires a staged `vN+1/` bundle prepared by `change`
- Validates the manifest surface before migration begins
- Completes or replaces the canonical migration script when the staged script is only a placeholder
- Dry-runs rewrite migrations against a full disposable clone in `/tmp`
- Executes the live migration and flips the module's active version and active `skills:` in `.als/system.ts`
- Projects the new active Claude assets into `.claude/skills/` and `.claude/delamains/`
- Updates `MANIFEST.md` to `status: migrated`
- Authors or updates `REPORT.md`
- Commits the successful cutover

### What `migrate` does NOT do

- Start from an unprepared module with no staged `vN+1/` bundle
- Treat manifest prose as optional; the required frontmatter and H2 surface must exist
- Skip explicit operator approval before touching live data or `.als/system.ts`
- Leave a partial live cutover in place after validation failure
- Rewrite records outside the target module as part of a module-level migration

## Procedure

### Phase 0 — Resolve Target And Preflight

1. Find the system root. Use the same system-root rules as `validate`: prefer an explicit user path, then clear conversation context, then the current directory tree.
2. Read `.als/system.ts`.
3. Resolve the target module id from the operator request.
4. Determine the active module version `vN` from `.als/system.ts`.
5. Require `.als/modules/<module_id>/vN+1/` to exist.
6. Require the target system root to be git-clean before live mutation work begins.
   - Unrelated dirty files outside the target system root may remain.
7. Run whole-system validation against the live system before doing any migration work.

```bash
bun ${CLAUDE_PLUGIN_ROOT}/alsc/compiler/src/index.ts <system-root>
```

8. If the live system fails validation, stop. `migrate` does not cut over on top of a broken baseline.
9. Read `.als/modules/<module_id>/vN+1/migrations/MANIFEST.md`.
10. Validate the manifest contract:
    - required frontmatter fields are present
    - `status` is `staged`
    - `from_version` matches live `vN`
    - `to_version` equals `vN+1`
    - `skill_paths` is present and every path points at a directory under `.als/modules/<module_id>/vN+1/skills/`
    - `primary_migration_script` exists and points at a file under `.als/modules/<module_id>/vN+1/migrations/`
    - required H2 sections exist in the exact declared order
11. Read `REPORT.md` if it already exists; otherwise plan to create it from `references/report-template.md`.

### Phase 1 — Migration Understanding And Script Completion

Build a complete picture of the active and staged module before attempting any execution.

1. Read the active `vN` shape, the staged `vN+1` shape, the live module data path from `.als/system.ts`, and the manifest end to end.
2. Treat manifest `skill_paths` as the staged future active skill set for `vN+1`.
3. Read the active skill bundle and the staged future skill bundle to understand whether behavior changed or remained intentionally stable.
4. Read concrete live records from the target module.
5. Read cross-module reference context needed to understand rewrite safety, but do not plan to mutate external-module records.
6. Read the file named by `primary_migration_script`.
7. If `data_migration_required: true` and the script is only a placeholder or is incomplete, finish it now.
   - The canonical script should accept the ALS system root as its first positional argument.
   - It should resolve the target module path from `.als/system.ts`.
   - It must be deterministic.
   - It must be idempotent.
   - It must log what it changed.
   - It must exit non-zero on failure.
8. If safe cutover would require rewriting records outside the target module, stop and escalate to the operator. That is out of scope for module-level `migrate`.

### Phase 2 — Dry Run On A Disposable Clone

This phase is required when `data_migration_required: true`.

1. Clone the full repo to a disposable path in `/tmp` using `git clone`.
   - Use a normal disposable git clone of the current repo root so the dry run has ordinary git state and ordinary filesystem cleanup.
   - Do not use `cp -R` or `git worktree add`.

```text
/tmp/als-migrate-<system_id>-<module_id>-vN-to-vN+1-<timestamp>
```

2. Create or update `REPORT.md` with preflight results and clone execution tracking.
3. Run the primary migration script against the cloned system root while the clone still points at `vN`.
4. Flip the cloned target module entry in `.als/system.ts` to `version: N+1` and `skills:` matching manifest `skill_paths`.
5. Run whole-system validation against the clone.
6. Project the cloned target module's active Claude assets into `.claude/`.

```bash
bun ${CLAUDE_PLUGIN_ROOT}/alsc/compiler/src/deploy.ts <clone-root> <module-id>
```

7. Execute the manifest's `Behavior Test Plan`.
   - By default this is an operator checklist.
   - If the staged bundle includes concrete test scripts or commands, run them and record the results.
8. Evaluate the dry run:
   - If the script or validation fails for mechanical reasons, fix the canonical script in the live `vN+1` bundle, discard the failed attempt, create a fresh clone, and rerun Phase 2.
   - If the failure is semantic or ambiguous, stop and escalate. Do not guess.
9. Delete successful clones with ordinary filesystem removal after the dry run passes.
10. Keep failed clones for inspection until the operator decides otherwise.

If `data_migration_required: false`, skip this phase and record `clone_result: skipped` in `REPORT.md`.

### Phase 3 — Live Cutover

Never touch live data or `.als/system.ts` before a final operator approval.

1. Present a final summary to the operator:
   - what the migration will do
   - whether a dry run passed or was skipped
   - what behavior checks were performed
   - that live repo-tracked files will be modified
2. Require explicit fresh approval.
3. Track every live file you mutate so rollback can be precise.
   - Track modified tracked files separately from newly created untracked files.
   - Include `.claude/skills/` and `.claude/delamains/` changes in that tracking.
4. If `data_migration_required: true`, run the proven primary migration script against the live system root while `.als/system.ts` still points at `vN`.
5. Flip the target module in live `.als/system.ts` to `version: N+1` and `skills:` matching manifest `skill_paths`.
6. Run whole-system validation.
7. If validation fails after live mutation:
   - restore tracked files touched by the failed cutover with `git restore --worktree --source=HEAD -- <paths...>`
   - delete any new untracked files created by the failed cutover attempt inside the target system root
   - keep `MANIFEST.md` at `status: staged`
   - keep the staged bundle's migration assets for inspection
   - stop and report the failure
8. If validation passes, project the target module's active Claude assets into `.claude/`.

```bash
bun ${CLAUDE_PLUGIN_ROOT}/alsc/compiler/src/deploy.ts <system-root> <module-id>
```

   - Overwrite projected dirs for skills and Delamains in the new active set.
   - Delete projected dirs for old active skill ids retired or renamed by this module cutover.
9. If projection fails after validation:
   - restore tracked files touched by the failed cutover with `git restore --worktree --source=HEAD -- <paths...>`
   - delete any new untracked files created by the failed cutover attempt inside the target system root
   - keep `MANIFEST.md` at `status: staged`
   - keep the staged bundle's migration assets for inspection
   - stop and report the failure
10. If validation and projection both pass:
   - update `MANIFEST.md` to `status: migrated`
   - update `updated_on` in `MANIFEST.md`
   - finalize `REPORT.md` with clone/live outcomes
   - commit with:

```text
migrate: cut over <module_id> vN to vN+1
```

`migrate` is complete when that commit lands.

## Commit Scope

The successful cutover commit should include only:

- live target-module record changes
- the target module's version and `skills:` flip in `.als/system.ts`
- `.claude/skills/` and `.claude/delamains/` changes for the target module's cutover
- `vN+1/migrations/MANIFEST.md`
- `vN+1/migrations/REPORT.md`
- the finalized primary migration script and directly related migration assets in the target bundle

Do not pull unrelated cleanup into the cutover commit.
