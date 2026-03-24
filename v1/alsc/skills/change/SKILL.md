---
name: change
description: Prepare the next ALS v1 module version bundle. Interviews the operator, analyzes the active module, authors `vN+1`, and commits the prepared bundle without changing live data or flipping the active version.
---

# change

Prepare the next version of an ALS v1 module bundle through structured discovery, operator interview, and authoring.

`change` is the v1 successor to v0 `als-mutate`.

It prepares a committed `vN+1/` bundle under `.als/modules/<module_id>/` and stops there.
It does not modify `.als/system.yaml`, does not touch live records, and does not execute the migration.

## Input

The operator provides a module id or enough system context to identify one module.

Examples:

- `experiments`
- `prepare the next version of backlog`
- `change the experiments module in this system`

Do not ask the operator for a skill path. Resolve the target module from `.als/system.yaml`.

## Required Reads

Before interviewing the operator or authoring files, read these references:

- `../new/references/shape-language.md`
- `references/manifest-template.md`
- `../validate/SKILL.md`

Use `shape-language.md` as the canonical ALS v1 source contract.
Use `manifest-template.md` as the manifest contract for `vN+1/migrations/MANIFEST.md`.

## Scope & Boundaries

### What `change` does

- Resolves the target module from the active ALS v1 system config
- Validates that the current live system is clean before authoring
- Creates the next module version bundle at `.als/modules/<module_id>/vN+1/`
- Updates the next bundle's `shape.yaml`
- Copies the active skill bundle forward and updates it only when the approved change requires it
- Authors a fresh `migrations/` directory with:
  - `MANIFEST.md`
  - at least one additional migration artifact
- Commits the prepared `vN+1/` bundle after operator sign-off

### What `change` does NOT do

- Modify `.als/system.yaml`
- Change the module's active `version`
- Modify any live module records
- Execute migration scripts
- Reuse the previous bundle's `migrations/` directory
- Overwrite an existing future `vN+1/` bundle without explicit operator review

## Procedure

### Phase 0 — Resolve Target And Baseline

Before reading module contents in detail, resolve the real system and baseline.

1. Find the system root. Use the same system-root rules as the sibling `validate` skill: prefer an explicit user path, then clear conversation context, then the current directory tree.
2. Read `.als/system.yaml`.
3. Resolve the target module id from the operator request.
4. Determine the active module version `vN` from `.als/system.yaml`.
5. Run whole-system validation against the live system before doing any authoring.

```bash
bun ${CLAUDE_PLUGIN_ROOT}/compiler/src/index.ts <system-root>
```

6. If the live system fails validation, stop. `change` does not author a new version on top of a broken baseline.
7. Check whether `.als/modules/<module_id>/vN+1/` already exists.
8. If it exists, stop and inspect it with the operator. Explain what is already there and do not overwrite it automatically.

### Phase 1 — Module Comprehension

Before speaking to the operator, silently build a complete mental model of the active module.

Do not proceed to Phase 2 until all of the following is complete.

1. **Read active system config context.**
   - Read the target module entry in `.als/system.yaml`.
   - Note: module path, active version, active skill ids, and the full system module map.

2. **Read the active shape.**
   - Read `.als/modules/<module_id>/vN/shape.yaml` end to end.
   - Note: entities, path templates, identity contracts, dependencies, field contracts, body contracts, enums, refs, and section names.

3. **Read the active skill bundle in full.**
   - For every active skill id listed in `.als/system.yaml`, read the full directory under `.als/modules/<module_id>/vN/skills/<skill_id>/`.
   - Always read `SKILL.md`.
   - Also read supporting files under the skill directory when they exist. Do not treat `SKILL.md` as the whole skill if the bundle already contains references, assets, scripts, or other supporting files.

4. **Read concrete module data.**
   - Sample at least 2-3 records per entity type from the module's live data directory.
   - Observe how the declared shape manifests in real records.
   - Note patterns, edge cases, and places where a future schema change would force record rewrites.

5. **Read recent prior versions.**
   - Read the two most recent prior versions only.
   - If `vN-1` exists, read its `shape.yaml`, active skill bundle, and migration manifest.
   - If `vN-2` exists, skim the same surfaces.
   - This is for recent evolution context, not archaeology.

6. **Map cross-module references.**
   - From the active shape, identify every external ref target.
   - Read the active shape for each referenced module.
   - Read sample target records from those referenced modules so rename, enum, and compatibility risks are grounded in real data.

7. **Inspect migration surfaces.**
   - Read the active bundle's `migrations/` directory only if the active version is greater than `v1`.
   - Note the current manifest status, prior rewrite assumptions, and any recent migration patterns that affect the next version.

### Phase 2 — Operator Interview

The goal is to answer six questions with high confidence.

#### The Six Questions

1. **Intent** — What exactly is the operator trying to achieve?
2. **Desire** — What should the module look like after this change?
3. **Aversion** — What must stay unchanged?
4. **Invariants** — What rules must continue to hold?
5. **Contra-invariants** — What rules are being intentionally retired?
6. **Constraints** — What must the system never do during or after this change?

#### Interview Rules

- Start with one open question: ask the operator to describe what they want to change and why.
- Listen for implicit answers to the six questions before drilling into follow-ups.
- Never accept vague language like "make it more flexible" or "clean this up."
- Convert every requested change into concrete bundle effects:
  - shape changes
  - skill-bundle changes
  - migration obligations
  - cross-module compatibility risks
- If the operator is non-technical, ground the conversation in real records and current shapes.
- If the operator is technical, still probe for migration and identity blind spots.
- Summarize all six answers back to the operator and get explicit confirmation before proceeding.

### Phase 3 — Post-Interview Analysis

Return to the active module with the confirmed interview summary in mind.

1. Re-read the active shape, active skills, sampled records, recent prior versions, and referenced-module context.
2. Identify every approved difference between `vN` and the intended `vN+1`:
   - fields added, removed, renamed, retyped, or re-nullabled
   - sections added, removed, renamed, or reordered
   - enum values added, removed, or renamed
   - path-template, lineage, or identity changes
   - skill-bundle behavior or scope changes
3. Classify the change as one of:
   - `logic_only`
   - `schema_only`
   - `schema_and_logic`
4. Determine whether live record migration is required.
   - If any live record would fail the new shape or require deterministic rewrite, the answer is `true`.
5. Surface ambiguities and resolve them with the operator before authoring.
   - Existing records that do not fit the new shape
   - Changed or retired enum values
   - Cross-module refs that may break
   - Skill-interface promises that no longer match the new module contract
   - Identity-sensitive rewrites that must be treated as explicit migration work
6. If there is no material versioned diff after analysis, abort cleanly.
   - Do not create `vN+1/`.
   - Tell the operator that no justified versioned change was identified.

### Phase 4 — Authoring

Author the next bundle only after the operator confirms the post-interview analysis.

Create:

```text
.als/modules/<module_id>/vN+1/
├── shape.yaml
├── skills/                  # omit entirely when the active module declares skills: []
│   └── <skill_id>/...
└── migrations/
    ├── MANIFEST.md
    └── <additional migration artifact>
```

#### Authoring Rules

1. **Copy the active shape forward.**
   - Start from `.als/modules/<module_id>/vN/shape.yaml`.
   - Write the agreed `vN+1` shape by editing the copy.

2. **Copy the active skill bundle forward.**
   - Copy every active skill directory listed in `.als/system.yaml` from `vN` into `vN+1`.
   - If `skills: []`, omit `vN+1/skills/` entirely.
   - Change copied skill files only when the approved mutation changes the module's actual behavior, interface, or constraints.

3. **Create a fresh migrations directory.**
   - Do not copy `vN/migrations/`.
   - Create `vN+1/migrations/` from scratch.

4. **Author the manifest from scratch.**
   - Use `references/manifest-template.md`.
   - Populate every field and section completely.
   - Record `skill_paths` for the carried-forward active skill directories in `vN+1`.
   - If the module declares `skills: []`, use `skill_paths: []`.
   - Set `primary_migration_script` to the repo-root-relative path of the primary migration artifact created in `vN+1/migrations/`.
   - Set manifest `status: staged`.
   - Do not leave unresolved questions in the manifest.

5. **Always create one additional migration artifact.**
   - `MANIFEST.md` alone is invalid for `vN+1`.
   - The default extra artifact is a placeholder migration script such as `migrate_from_vN.py`.
   - The artifact named by `primary_migration_script` is the canonical handoff target for later `migrate` work.
   - Treat script language as "best tool for the job," with Python as the default for simple placeholder stubs.

6. **Capture migration intent, not execution.**
   - If live data will need transformation, record the plan in the manifest and the placeholder script.
   - `change` prepares the rewrite contract; it does not execute it.

7. **Do not author cosmetic churn.**
   - No unrelated cleanup.
   - No reformat-only edits.
   - The diff between `vN` and `vN+1` must reflect only the confirmed change.

#### Placeholder Migration Script Rules

- The script must clearly identify itself as a prepared migration asset, not an executed migration.
- It may be a stub, but it must match the manifest's stated migration direction and target paths.
- It should accept the ALS system root as its first positional argument and fail cleanly if that root or `.als/system.yaml` is missing.
- It should fail cleanly when invoked against a missing target path.
- It should not pretend the migration is already complete.

### Phase 5 — Alignment And Commit

Present the prepared bundle to the operator for final review.

1. Walk through every file in `vN+1/` and explain what changed relative to `vN`.
2. Call out unchanged carried-forward skill files intentionally.
3. Restate the six confirmed answers and verify the prepared bundle matches them.
4. Get explicit operator sign-off.
5. Commit the prepared bundle with:

```text
change: prepare <module_id> vN to vN+1
```

`change` is complete when that commit lands.

The prepared bundle is now ready for later migration work, but the live system remains on `vN` until separate migration tooling performs the cutover.
