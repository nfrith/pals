---
name: pals-mutate
description: Guide the development of a PALS module's next version. Interviews the operator, analyzes the current module, and authors the next version folder. Does not deploy, modify data, or touch anything outside the new version directory.
---

# pals-mutate

Create the next version of a PALS module skill through structured discovery, operator interview, and authoring.

## Input

The operator provides the path or name of a PALS module skill (e.g. `backlog-module` or `.claude/skills/{skill-name}`).

## Preflight

Before starting, verify the target is a valid PALS module skill (see `palsc/references/module-schema-definition.md`). If it isn't, stop and tell the operator pals-mutate can only be operated against PALS enabled skills.

## Scope & Boundaries

### What pals-mutate does

- Creates a new version folder (`vN+1/`) under the module's skill directory
- Populates it with updated `content/SKILL.md`, `schemas/`, and `migrations/` as needed
- Ensures the operator fully understands and agrees with what the new version represents

### What pals-mutate does NOT do

- Modify the version router `SKILL.md` (that is pals-migrate's job)
- Modify `MODULE.md` or any module data
- Touch the current deployed version folder or any prior version folder
- Write, edit, or delete any file outside `vN+1/`

## Procedure

### Phase 1 — Module Comprehension

Before speaking to the operator, silently build a complete mental model of the module.

1. **Read the module contract.** Find and read `MODULE.md` frontmatter only. Note: `module_id`, `namespace`, `uri_scheme`, `module_version`, `schema_version`, `entity_paths`, and `references.modules`.

2. **Read the version router.** Find the skill's root `SKILL.md`. Identify the current deployed version (`vN`).

3. **Read the current version skill.** Read `vN/content/SKILL.md` end to end. Note: entry points, response contracts, identity invariants, body section rules, reference URI patterns, and any evolution rules.

4. **Read every schema.** Read all files in `vN/schemas/`. For each entity, note: frontmatter contract (fields, types, required/optional, enums, refs), body contract (sections, types, required/nullable, includes/excludes).

5. **Read concrete data.** Sample at least 2-3 records per entity type from the module data directory. Observe how the schemas manifest in practice. Note any patterns, edge cases, or inconsistencies between schema and data.

6. **Read prior versions if they exist.** If `v1`, `v2`, ... `vN-1` exist, skim them to understand the module's evolutionary history.

7. **Map cross-module references.** Identify all external reference targets from deployed schema `ref` fields. Verify `MODULE.md` `references.modules` matches exactly (same modules, deduplicated, sorted, no self-reference).

Do not proceed to Phase 2 until all of the above is complete.

### Phase 2 — Operator Interview

The goal is to answer six questions with high confidence. Adapt interview depth to the operator's expertise — but never assume completeness, even with technical operators.

#### The Six Questions

1. **Intent** — What exactly is the operator trying to achieve?
2. **Desire** — What does the operator want the module to look like after this change?
3. **Aversion** — What does the operator explicitly not want? What should be preserved as-is?
4. **Invariants** — What rules must hold true in the updated system?
5. **Contra-invariants** — What previously held rules are being intentionally relaxed or removed?
6. **Constraints** — What negative invariants apply? (Things the system must never do or allow.)

#### Interview Rules

- Begin with an open question: ask the operator to describe what they want to change and why.
- Listen for implicit answers to the six questions in the operator's natural description.
- Ask targeted follow-ups only for questions that remain unanswered or ambiguous.
- If the operator is non-technical, use concrete examples from the module's actual data to ground the conversation. ("Right now a record looks like this — what would you change about it?")
- If the operator is technical, still probe for blind spots: ask about edge cases, migration impact on existing records, and downstream reference consumers.
- Never accept vague answers. "Make it more flexible" must be decomposed into specific schema or workflow changes.
- Summarize your understanding of all six answers back to the operator and get explicit confirmation before proceeding.

### Phase 3 — Post-Interview Analysis

After the operator confirms the interview summary, return to the module with fresh eyes.

1. **Re-read schemas and data** with the proposed changes in mind. Identify:
   - Fields being added, removed, renamed, or retyped
   - Sections being added, removed, or restructured
   - Reference paths being added or changed
   - Enum values being added, removed, or renamed
   - Required/optional changes on any field or section

2. **Surface ambiguities.** For each change, ask:
   - What happens to existing records that don't match the new schema?
   - Are there cross-module references that would break?
   - Does this change affect any entry point's behavior?
   - Does this introduce new invariants or relax existing ones?

3. **Report findings to the operator.** If any ambiguities surfaced, present them and resolve before proceeding. This is not optional — do not skip this even if the changes seem straightforward.

### Phase 4 — Authoring

Create the next version folder with the following structure:

```
vN+1/
├── content/
│   └── SKILL.md
├── schemas/
│   ├── <entity>.md   (one per entity)
│   └── ...
└── migrations/
    └── MANIFEST.md   (required)
```

#### Authoring Rules

1. **Start from a copy of vN.** Duplicate the entire current deployed version folder to create `vN+1/` using a shell copy command. Then apply changes to the copy.

2. **Schema authoring.** Update schema files to reflect the agreed-upon changes. Preserve the existing schema format and conventions exactly. Do not introduce new conventions without operator agreement.

3. **Skill content authoring.** Update `content/SKILL.md` to reflect any new or changed entry points, response contracts, invariants, or rules. If nothing changed in the skill behavior, the content may be identical to vN.

4. **Manifest authoring (required).** Always create `migrations/MANIFEST.md`. Use `palsc/references/manifest-template.md` as the source template and fully populate frontmatter plus the `Mutate Outputs` section from the confirmed interview and post-interview analysis.

5. **Migration notes.** If the schema changes require existing data to be transformed, capture the transformation plan inside `migrations/MANIFEST.md` under mutate outputs. This is informational for pals-migrate — pals-mutate does not execute migrations.

6. **No cosmetic changes.** Do not reformat, reorganize, or "improve" content that is not part of the agreed changes. The diff between vN and vN+1 should contain only what was discussed.

### Phase 5 — Alignment

Present the completed version to the operator for final review.

1. **Walk through every change.** For each file in `vN+1/`, explain what changed relative to `vN` and why.

2. **Highlight what did NOT change.** Confirm that unchanged files are intentionally identical.

3. **Restate the six answers.** Verify that the authored version faithfully represents the operator's intent, desire, aversion, invariants, contra-invariants, and constraints.

4. **Get explicit sign-off.** The operator must confirm the version is complete and correct. If adjustments are needed, return to the relevant phase and iterate.

5. **Commit.** Once the operator confirms, commit all changes in the `vN+1/` folder with a message describing the mutation.

pals-mutate is complete when the commit lands. The `vN+1/` folder is now ready for pals-migrate.
