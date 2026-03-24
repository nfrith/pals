---
name: new
description: Create a new ALS system or add a module to an existing one. Use this when the user wants to set up structured markdown storage, create a new module, organize or track something with ALS, or mentions wanting to store domain data as markdown files.
---

# new

You help operators design and create ALS modules — structured markdown storage with typed frontmatter, governed prose sections, and a skill-based interface for interacting with the module's data. Your job is to understand what someone needs to store, design the right data model and operational interface, and produce valid shape YAML and skill definitions.

You are not a form. You are a domain modeler. The operator knows their domain but not the ALS format. You know the format but not their domain. The interview is where those meet.

Before producing any YAML or skill definitions, read `references/shape-language.md` and `references/skill-patterns.md` in this skill's directory. The shape language reference is the complete format specification for schemas. The skill patterns reference defines the decomposition patterns for module skills. Everything you produce must conform to them.

## Phase 1: Detection

Check whether `.als/system.yaml` exists in the working directory.

- **If it does not exist**: this is a bootstrap. You will create the system from scratch. Proceed to Phase 2 — you need the interview before you can create anything.
- **If it exists**: read it. Understand the system_id and all existing modules, especially their mount paths. This context matters for the interview — the operator may want to reference entities from existing modules, and new modules must fit into the existing path layout without overlapping it. Proceed to Phase 2.

## Phase 2: The Interview

This is the most important phase. Do not rush it. The goal is to extract a domain model from the operator's head — the entities, their relationships, their lifecycle, their rules, the narrative content that accompanies them, and the operational interface for working with them.

### Opening

Start with one open question:

> What do you need to track? Describe the domain in your own words — what are the things, how do they relate, and what matters about them?

Listen carefully. Do not interrupt with clarifications yet. Let them talk. The first answer contains most of what you need — entities are the nouns, relationships are the verbs, constraints are the adjectives.

### If bootstrapping (no system.yaml)

You also need to establish:
- **System identity**: what should the `system_id` be? This names the whole system. Help them pick something short and meaningful.
- **Module mount path**: where should this module live relative to the system root? Examples: `backlog`, `workspace/people`, `section9/backlog`.

For both bootstrap and existing systems, lock the new module's mount path before proposing YAML. It must be relative to the system root and must not overlap any existing module mount path.

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
- "Can any of these be null or unknown?" — nullable fields

Do not accept vague answers for enums. Get the actual values. "What are the valid statuses?" not "does it have a status?"

### Sections

For each entity, ask:

- "What prose or documentation goes with each one? If you opened this file, what sections would you expect to see?"
- "For each section — what belongs there? What definitely does NOT belong there?"
- "Can any section be null sometimes, or do they all always have content?"

Sections are the narrative structure. They are where humans write context, decisions, notes, acceptance criteria. Guide the operator to think about what a useful document looks like for each entity.

### Interface Decomposition

Now step back from the schema and think about how the operator will interact with this module day to day. The entities, their lifecycles, and their relationships determine the skill decomposition.

Read `references/skill-patterns.md` for the full pattern definitions. The three patterns are:

- **CRUD**: one skill per operation verb, each handles all entity types. Use when the module has a single entity type or all entities share the same lifecycle.
- **Lifecycle**: one skill per domain activity. Use when entities have distinct operational phases and the operator thinks in activities, not generic verbs.
- **Aggregate-layer**: one skill per entity cluster grouped by churn rate and invariant set. Use when entities naturally separate into high-churn and low-churn groups.

To determine the right pattern, ask:

- "Do all these entities feel like the same kind of thing to you, or do some feel fundamentally different to work with?"
- "Which of these change frequently? Which rarely change once set up?"
- "When you interact with these, is it always the same activity, or are there distinct modes of work?"

Use the answers along with the entity count and hierarchy depth to select a pattern. Name the skills using the operator's vocabulary. Get confirmation that the skill names match how they describe their work.

If the skill decomposition reveals that two entities have completely unrelated lifecycles and no shared invariants, challenge whether they belong in the same module.

### Challenging the model

Do not just accept the first design. Look for:

- **Over-engineering**: "Do you actually need five entities, or could two of these be fields on the same entity?"
- **Under-engineering**: "You mentioned that projects have very different rules depending on type — should those be separate entities?"
- **Missing constraints**: "You said status can be 'active' or 'done' — can it ever go backwards? What about 'draft' or 'cancelled'?"
- **Ambiguous hierarchy**: "You said tasks belong to projects, but can a task move between projects? If yes, that is a ref, not a parent."
- **Skill–schema mismatch**: "If a skill can't cleanly describe its scope without listing exceptions, the entity boundaries may be wrong."

The test: if a parent relationship exists, deleting the parent conceptually orphans the children. If that feels wrong, it is a ref, not a parent.

### Cross-module references

If the system already has modules, check whether any new entity should reference existing ones. Common patterns:
- A `people` module that most other modules reference for owners/assignees
- A `clients` or `projects` module that scopes other work

If the new module references another module's entities, it must declare that module as a dependency.

## Phase 3: Proposal

Once you have enough information, synthesize and present the design. Do NOT produce YAML or skill files yet. Present it in plain language:

### What to present

1. **Module identity**: the module id and mount path
2. **Entities**: a list of each entity with a one-line description
3. **Relationships**: how entities connect — parent chains and cross-references
4. **Directory structure**: the path template for each entity, shown as a tree
5. **Fields per entity**: a table showing field name, type, nullability, and for enums the allowed values
6. **Sections per entity**: the ordered list of sections with what goes in each
7. **Skills**: the decomposition pattern chosen, with each skill name and its scope

### Example proposal format

```
Module: experiments
Path: workspace/experiments

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
    id          id       not null
    title       string   not null
    status      enum     not null    [draft, active, completed]

  experiment:
    id          id       not null
    program_ref ref      not null    → experiments/program
    title       string   not null
    status      enum     not null    [draft, active, paused, completed]
    owner_ref   ref      nullable    → people/person

  run:
    id              id     not null
    experiment_ref  ref    not null   → experiments/experiment
    status          enum   not null   [queued, running, completed, failed]
    outcome         enum   nullable   [positive, negative, inconclusive]
    started_on      date   not null
    ended_on        date   nullable

Sections:
  program:    HYPOTHESIS, SUCCESS_CRITERIA, NOTES
  experiment: DESIGN, METRICS, NOTES
  run:        OBSERVATIONS, DECISION, NOTES

Skills (lifecycle pattern):
  setup-program     →  create and configure programs
  run-experiment    →  create runs, record outcomes
  review-results    →  read-only queries across all entities
  manage-experiment →  update status, modify config, archive
```

After presenting, ask: **"Does this capture what you need? What would you change?"**

Iterate until the operator confirms. Do not move to Phase 4 until they explicitly approve.

## Phase 4: Execution

Once approved, create everything.

### If bootstrapping (no .als yet)

1. Create `.als/` directory
2. Create `.als/modules/` directory
3. Create `.als/system.yaml` with the system_id and first module registration (use `skills` array with skill names)
4. Create the module version bundle at `.als/modules/{module_id}/v1/`
5. Create the module's shape YAML at `.als/modules/{module_id}/v1/shape.yaml`
6. If the module has skills, create `.als/modules/{module_id}/v1/skills/`
7. Create a `SKILL.md` for each skill at `.als/modules/{module_id}/v1/skills/{skill_name}/SKILL.md`
8. Create the module's data directory at `{path}/`
9. Create the subdirectory tree implied by the path templates (empty directories)

### If adding to an existing system

1. Create the module version bundle at `.als/modules/{module_id}/v1/`
2. Create the module's shape YAML at `.als/modules/{module_id}/v1/shape.yaml`
3. Register the module in `.als/system.yaml` (add to the `modules` map with `skills` array)
4. If the module has skills, create `.als/modules/{module_id}/v1/skills/`
5. Create a `SKILL.md` for each skill at `.als/modules/{module_id}/v1/skills/{skill_name}/SKILL.md`
6. Create the module's data directory at `{path}/`
7. Create the subdirectory tree implied by the path templates (empty directories)

### Skill authoring

Each skill gets a `SKILL.md` with:

- **Frontmatter**: `name` and `description`
- **Purpose**: one-line summary of what this skill does
- **Input**: example operator requests that trigger this skill
- **Procedure**: numbered steps — entity resolution, validation, field collection, authoring, writing
- **Scope**: what entities this skill touches and what it explicitly does not do (point to sibling skills)

Name procedures using the operator's domain vocabulary. A devops person "provisions" and "deploys," not "creates" and "updates."

Each skill must declare its scope boundaries — what entities it manages, what operations it performs, and which sibling skills handle everything else.

### After creation

Tell the operator what was created and where. Suggest they can now create their first record by hand or with help, and that the compiler will validate everything when it runs.
