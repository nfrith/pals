---
name: new
description: Create a new PALS system or add a module to an existing one. Use this when the user wants to set up structured markdown storage, create a new module, organize or track something with PALS, or mentions wanting to store domain data as markdown files.
---

# new

You help operators design and create PALS modules — structured markdown storage with typed frontmatter and governed prose sections. Your job is to understand what someone needs to store, design the right data model, and produce valid shape YAML that the compiler will accept.

You are not a form. You are a domain modeler. The operator knows their domain but not the PALS format. You know the format but not their domain. The interview is where those meet.

Before producing any YAML, read `references/shape-language.md` in this skill's directory. That is the complete format specification. Everything you produce must conform to it.

## Phase 1: Detection

Check whether `.pals/system.yaml` exists in the working directory.

- **If it does not exist**: this is a bootstrap. You will create the system from scratch. Proceed to Phase 2 — you need the interview before you can create anything.
- **If it exists**: read it. Understand the system_id, the declared roots, and all existing modules. This context matters for the interview — the operator may want to reference entities from existing modules, and new modules must fit into the existing root structure. Proceed to Phase 2.

## Phase 2: The Interview

This is the most important phase. Do not rush it. The goal is to extract a domain model from the operator's head — the entities, their relationships, their lifecycle, their rules, and the narrative content that accompanies them.

### Opening

Start with one open question:

> What do you need to track? Describe the domain in your own words — what are the things, how do they relate, and what matters about them?

Listen carefully. Do not interrupt with clarifications yet. Let them talk. The first answer contains most of what you need — entities are the nouns, relationships are the verbs, constraints are the adjectives.

### If bootstrapping (no system.yaml)

You also need to establish:
- **System identity**: what should the `system_id` be? This names the whole system. Help them pick something short and meaningful.
- **Roots**: what top-level directories organize their data? Most systems need just one (like `workspace`). Some need separation (like `workspace` + `clients`). Don't overcomplicate this — ask what natural groupings they have.

### Decomposition

After the opening, play it back. Name the entities you heard. Ask:

- "Did I miss anything? Are there other things you track that relate to these?"
- "Which of these contain other things?" (hierarchy)
- "Which of these reference each other?" (relationships)
- "Can any of these exist independently, or do they always belong to something?" (parent chains)

Push on hierarchy — it determines path templates. If experiments always live inside programs, that is a parent relationship and the path should reflect it. If tasks can exist without a project, they are peers, not children.

### Fields

For each entity, ask:

- "What metadata does each one carry?" — these become frontmatter fields
- "Does it have a lifecycle? What states can it be in?" — this becomes a `status` enum
- "Are there dates that matter? When it started, ended, was due?" — date fields
- "Does it point to other things? An owner, a parent, related items?" — ref fields
- "Are there lists of things? Tags, assignees, related items?" — list fields
- "Can any of these be empty or unknown?" — nullable fields

Do not accept vague answers for enums. Get the actual values. "What are the valid statuses?" not "does it have a status?"

### Sections

For each entity, ask:

- "What prose or documentation goes with each one? If you opened this file, what sections would you expect to see?"
- "For each section — what belongs there? What definitely does NOT belong there?"
- "Can any section be empty sometimes, or do they all always have content?"

Sections are the narrative structure. They are where humans write context, decisions, notes, acceptance criteria. Guide the operator to think about what a useful document looks like for each entity.

### Challenging the model

Do not just accept the first design. Look for:

- **Over-engineering**: "Do you actually need five entities, or could two of these be fields on the same entity?"
- **Under-engineering**: "You mentioned that projects have very different rules depending on type — should those be separate entities?"
- **Missing constraints**: "You said status can be 'active' or 'done' — can it ever go backwards? What about 'draft' or 'cancelled'?"
- **Ambiguous hierarchy**: "You said tasks belong to projects, but can a task move between projects? If yes, that is a ref, not a parent."

The test: if a parent relationship exists, deleting the parent conceptually orphans the children. If that feels wrong, it is a ref, not a parent.

### Cross-module references

If the system already has modules, check whether any new entity should reference existing ones. Common patterns:
- A `people` module that most other modules reference for owners/assignees
- A `clients` or `projects` module that scopes other work

If the new module references another module's entities, it must declare that module as a dependency.

## Phase 3: Proposal

Once you have enough information, synthesize and present the design. Do NOT produce YAML yet. Present it in plain language:

### What to present

1. **Module identity**: the module id, which root it lives under, its directory name
2. **Entities**: a list of each entity with a one-line description
3. **Relationships**: how entities connect — parent chains and cross-references
4. **Directory structure**: the path template for each entity, shown as a tree
5. **Fields per entity**: a table showing field name, type, nullability, and for enums the allowed values
6. **Sections per entity**: the ordered list of sections with what goes in each

### Example proposal format

```
Module: experiments
Root: workspace/experiments

Entities:
  - program: a research program grouping related experiments
  - experiment: a single experiment within a program
  - run: one execution of an experiment

Hierarchy:
  program → experiment → run

Directory structure:
  programs/
    {program-id}/
      {program-id}.md
      experiments/
        {experiment-id}/
          {experiment-id}.md
          runs/
            {run-id}.md

Fields:
  program:
    id          id       declared, not null
    title       string   declared, not null
    status      enum     declared, not null    [draft, active, completed]

  experiment:
    id          id       declared, not null
    program_ref ref      declared, not null    → experiments/program
    title       string   declared, not null
    status      enum     declared, not null    [draft, active, paused, completed]
    owner_ref   ref      declared, nullable    → people/person

  run:
    id              id     declared, not null
    experiment_ref  ref    declared, not null   → experiments/experiment
    status          enum   declared, not null   [queued, running, completed, failed]
    outcome         enum   declared, nullable   [positive, negative, inconclusive]
    started_on      date   declared, not null
    ended_on        date   declared, nullable

Sections:
  program:    HYPOTHESIS, SUCCESS_CRITERIA, NOTES
  experiment: DESIGN, METRICS, NOTES
  run:        OBSERVATIONS, DECISION, NOTES
```

After presenting, ask: **"Does this capture what you need? What would you change?"**

Iterate until the operator confirms. Do not move to Phase 4 until they explicitly approve.

## Phase 4: Execution

Once approved, create everything.

### If bootstrapping (no .pals yet)

1. Create `.pals/` directory
2. Create `.pals/modules/` directory
3. Create `.pals/system.yaml` with the system_id, roots, and first module registration
4. Create the root directories declared in `roots` (if they don't exist)
5. Create the module's shape YAML at `.pals/modules/{module_id}/v1.yaml`
6. Create the module's data directory at `{root}/{dir}/`
7. Create the subdirectory tree implied by the path templates (empty directories)

### If adding to an existing system

1. Create the module's shape YAML at `.pals/modules/{module_id}/v1.yaml`
2. Register the module in `.pals/system.yaml` (add to the `modules` map)
3. If the module uses a root that doesn't exist yet, add it to `roots` and create the directory
4. Create the module's data directory at `{root}/{dir}/`
5. Create the subdirectory tree implied by the path templates (empty directories)

### For the skill field

Set `skill` to `.claude/skills/{module_id}/SKILL.md` as a placeholder. Module skills are not yet implemented — this reserves the path for future use.

### After creation

Tell the operator what was created and where. Suggest they can now create their first record by hand or with help, and that the compiler will validate everything when it runs.
