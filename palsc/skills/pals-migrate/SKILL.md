---
name: pals-migrate
description: Execute a prepared PALS module migration. Validates the mutation is ready, runs the compiler, generates migration code, tests against a clone, and applies to the live module.
---

# pals-migrate

Execute the migration of a PALS module from its current version to the next, as prepared by pals-mutate.

## Input

The operator provides the path or name of a PALS module skill (e.g. `backlog-module` or `.claude/skills/{skill-name}`).

## Preflight

Before starting, verify the target is a valid PALS module skill (see `palsc/references/module-skill-definition.md`). If it isn't, stop and tell the operator pals-migrate can only be operated against PALS enabled skills.

## Step 1 — Version Readiness

Confirm a mutation has been prepared and is ready for migration.

1. Identify the current deployed version (`vN`) from the skill's root `SKILL.md` router.
2. Check that a `vN+1/` directory exists under the module skill path.
3. Check that `vN+1/migrations/MANIFEST.md` exists.
4. Read the manifest frontmatter and verify `status` is `ready-for-migrate`.

If any of these checks fail, stop and tell the operator what's missing. pals-migrate cannot proceed without a fully prepared mutation.

## Step 2 — Compiler Validation

Run the PALS compiler against the module to surface any structural or schema issues before migration begins.

<!-- TODO: replace with actual compiler invocation once palsc/compiler is built -->
Run: `palsc validate <module_skill_path>`

If the compiler reports errors, present each one to the operator. Work through them one at a time — the operator decides how to resolve each issue. Do not proceed until the compiler reports zero errors.

If the compiler reports warnings, present them to the operator for awareness but they do not block migration.

## Step 3 — Migration Code Generation

Generate the code that will transform the module's data from the current schema to the new one.

1. **Read the manifest.** Review the `MANIFEST.md` in full — the mutate outputs section contains the change class, schema changes, data migration plan, and any transformation details left by pals-mutate.

2. **Assess migration type.** Based on `change_class` and `data_migration_required` in the manifest:
   - If `data_migration_required: false` — no migration code is needed. Skip to the next step.
   - If `data_migration_required: true` — migration code must be generated.

3. **Read both schemas.** Read every schema file in `vN/schemas/` and `vN+1/schemas/`. Diff them mentally. Every difference must be accounted for in the migration.

4. **Read sample data.** Read several records per entity type from the module data directory. Understand the concrete shape of data that will be transformed.

5. **Write the migration script.** Generate a single script (TypeScript or Python — match the operator's preference or project conventions) and place it in `vN+1/migrations/`. The script must:
   - Read every record of each affected entity type
   - Transform each record from the vN schema shape to the vN+1 schema shape
   - Write transformed records back to their original paths
   - Be idempotent — running it twice produces the same result
   - Log what it changed (file path, fields modified) to stdout
   - Exit non-zero on any failure

6. **Do not run the script yet.** Code generation is complete when the script exists in `vN+1/migrations/` and the operator has reviewed it.

## Step 4 — Test Against Clone

Never run the migration script against the live module data. Test it against a disposable copy first.

1. **Clone the module data.** Copy the entire module data directory to a scratch location using a shell copy command. The clone must be a complete copy — all entity subdirectories, all records, `.schema/`, and `MODULE.md`.

2. **Run the migration script against the clone.** Point the script at the cloned data directory. Capture all stdout output for the operator.

3. **Run the compiler against the clone.** Invoke the PALS compiler against the cloned data using the vN+1 schemas to validate every transformed record.

   <!-- TODO: replace with actual compiler invocation once palsc/compiler is built -->
   Run: `palsc validate <cloned_module_path> --schema <module_skill_path>/vN+1/schemas/`

4. **Evaluate results.**
   - If the compiler reports zero errors: present a summary to the operator (number of records transformed, entities affected, no validation errors).
   - If the compiler reports errors: classify each error before acting.

     **Mechanical errors** — the migration script failed to account for a data shape, but the data's meaning is unambiguous. Examples: unexpected whitespace, a date in a slightly different format, a field the script didn't handle. Fix the migration script and re-run this step from scratch against a fresh clone.

     **Semantic errors** — the data itself is ambiguous or contradictory in a way where any automated transform would be a guess. The meaning of the data would be silently changed or lost if forced through the migration. Examples: an enum value that was removed and has no obvious mapping, a declared non-nullable field that has no safe value, or a reference that points to something that no longer exists. Stop and present these to the operator. The operator decides how each record should be resolved — fix the source data, then re-run this step from scratch against a fresh clone.

     A migration must never silently change what data means, only how it is shaped. When in doubt, treat the error as semantic and involve the operator.

5. **Clean up.** Delete the cloned data directory once testing is complete, regardless of outcome.

Do not proceed until the compiler reports zero errors against the clone.

## Step 5 — Execute Migration

The migration script has been tested and validated. Now apply it to the live module.

1. **Ask for operator approval.** Present a final summary: what the migration will do, how many records will be affected, and that this will modify live data. Do not proceed without explicit approval from the operator.

2. **Run the migration script against the live module data.** Use the same invocation that succeeded against the clone, pointed at the real module data directory.

3. **Run the compiler against the live module.** Validate every record against the vN+1 schemas to confirm the migration applied cleanly.

   <!-- TODO: replace with actual compiler invocation once palsc/compiler is built -->
   Run: `palsc validate <module_data_path> --schema <module_skill_path>/vN+1/schemas/`

4. **Update the version router.** Edit the skill's root `SKILL.md` to point to `vN+1`.

5. **Update the module contract.** Edit `MODULE.md` frontmatter only: set new `module_version` and `schema_version`, and ensure `entity_paths` + `references.modules` match the deployed schemas (deduplicated, sorted, no self-reference).

6. **Update the manifest.** Set `status` to `migrated` and `updated_on` to today's date in `vN+1/migrations/MANIFEST.md`.

7. **Commit.** Commit all changes with a message describing the migration.

pals-migrate is complete when the commit lands.
