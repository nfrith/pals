---
name: new
description: Create a new ALS system or add a module to an existing one. Use this when the user wants to set up structured markdown storage, create a new module, organize or track something with ALS, or mentions wanting to store domain data as markdown files.
---

# new

You help operators design and create ALS modules — structured markdown storage with typed frontmatter, governed prose sections, and a skill-based interface for interacting with the module's data. Your job is to understand what someone needs to store, design the right data model and operational interface, and produce valid shape YAML and skill definitions.

You are not a form. You are a domain modeler. The operator knows their domain but not the ALS format. You know the format but not their domain. The interview is where those meet.

Before producing any YAML or skill definitions, read `../docs/references/shape-language.md` and `../docs/references/skill-patterns.md` from the sibling docs skill. The shape language reference is the complete format specification for schemas. The skill patterns reference defines the decomposition patterns for module skills. Everything you produce must conform to them.

## Phase 0: Prerequisites

Before doing anything else, verify the runtime environment.

1. Run `which bun` to check if Bun is on PATH.
   - If not found, tell the operator: "ALS requires Bun to run the compiler. You can install it by typing `! curl -fsSL https://bun.sh/install | bash` and then restarting your shell." Do not proceed until Bun is available.

2. Run `which jq` to check if jq is on PATH.
   - If not found, tell the operator: "ALS hooks require jq. Install it with your package manager (e.g. `! sudo apt-get install -y jq` or `! brew install jq`)." Do not proceed until jq is available.

3. Run `cd ${CLAUDE_PLUGIN_ROOT}/alsc/compiler && bun install` to ensure compiler dependencies are installed. This is idempotent and fast when dependencies already exist.

## Phase 1: Detection

Check whether `.als/system.yaml` exists in the working directory.

- **If it does not exist**: this is a bootstrap. You will create the system from scratch. Proceed to Phase 2 — you need the interview before you can create anything.
- **If it exists**: read it. Understand the system_id and all existing modules, especially their mount paths. This context matters for the interview — the operator may want to reference entities from existing modules, and new modules must fit into the existing path layout without overlapping it. Proceed to Phase 2.

## Phase 2: The Interview

This is the most important phase. Do not rush it. The goal is to extract a domain model from the operator's head — the entities, their relationships, their lifecycle, their rules, the narrative content that accompanies them, and the operational interface for working with them.

### Using AskUserQuestion

Use the AskUserQuestion tool at every decision point where there are enumerable options. This keeps the interview structured and reduces ambiguity. Reserve freeform conversation for the opening question and domain exploration where options cannot be pre-enumerated. Specific moments where AskUserQuestion applies are noted inline below.

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

### Lifecycle Depth Probe

After collecting fields, check whether any entity has a rich lifecycle that could benefit from agent automation. This is the gateway to Delamain — but do not use that word with the operator. Frame it in domain terms.

If an entity has a status field with 4+ states, use AskUserQuestion:

> "That's a rich lifecycle. Do you want agents to automate some of those transitions, or is this purely operator-driven?"

Options:
- "Yes — some states should be agent-automated"
- "No — all transitions are manual"

If the operator says **no**, the status field stays as a plain `type: enum`. Move to Sections.

If the operator says **yes**, enter the Delamain Design sub-interview below. The status field will become `type: delamain` and the module will include a Delamain bundle with agent files and a dispatcher.

Not every module needs a Delamain. Many modules are pure storage with operator-driven skills. Only proceed with Delamain design when the operator explicitly wants agent automation of their lifecycle.

### Delamain Design

This sub-interview designs the transition graph, actor assignments, and session behavior. Read `../docs/references/shape-language.md` (the Delamain bundles and Delamain agent files sections) and `../docs/references/dispatcher.md` before proceeding.

#### Step 1: Phases

Group the operator's states into ordered lifecycle phases. Phases are coarse groupings — work flows forward through them. Attempt to infer phases from the state names before asking.

Present the proposed grouping via AskUserQuestion and let the operator confirm or adjust:

> "I've grouped your states into these lifecycle phases. Does this look right?"

Show the grouping as a readable list (e.g., "intake: draft, queued | planning: planning, plan-review | implementation: in-dev, in-review | closed: completed, cancelled").

Options:
- "Looks good"
- "Needs changes" (then collect corrections)

#### Step 2: Actor Assignment

For each non-terminal state, determine whether the actor is an operator (human) or an agent (automated). Present the proposed assignments as a batch via AskUserQuestion:

> "For each state, who does the work — an agent or an operator?"

Show a table of states with proposed actors. Infer from context: states involving human judgment (review, approval, testing) are typically operator; states involving generation, classification, or execution are typically agent.

Options:
- "Approve these assignments"
- "Needs changes" (then collect corrections)

#### Step 3: Transitions

Generate the transition graph from the phase groupings rather than asking the operator to design it. Most operators cannot think in graph theory. Propose:

- `advance` transitions from each non-terminal state to the next logical state (forward within phase or to the next phase)
- `rework` transitions back to earlier phases where rework makes sense
- `exit` transitions from all non-terminal states to terminal states (e.g., cancelled, deferred)

Present the graph in readable form and ask via AskUserQuestion:

> "Here's the proposed transition graph. What's missing or wrong?"

Options:
- "Looks good"
- "Missing transitions" (then collect specifics)
- "Remove some transitions" (then collect specifics)

#### Step 4: Resumability

Determine which agent-owned states should be resumable (persist their session across invocations). This decision depends on the operator's technical literacy.

**If the operator uses developer vocabulary** (sessions, state machines, idempotency, etc.), ask directly via AskUserQuestion:

> "Some agent states can pause and resume later — for example, a planning agent that waits for operator input. Which of these agent states should be resumable?"

Present agent states as multiSelect options.

**If the operator is non-technical**, infer resumability from state characteristics without asking:
- Long-running work states (planning, development, research) → resumable
- Quick automated states (triage, classification, validation, deployment checks) → not resumable

State the inference to the operator for confirmation but do not ask them to reason about session mechanics.

For each resumable state, generate a session field name by convention: `{state_name}_session` (e.g., `planner_session`, `dev_session`). These are implicit — they do not appear in shape.yaml.

### Sections

For each entity, ask:

- "What prose or documentation goes with each one? If you opened this file, what sections would you expect to see?"
- "For each section — what belongs there? What definitely does NOT belong there?"
- "Can any section be null sometimes, or do they all always have content?"

Sections are the narrative structure. They are where humans write context, decisions, notes, acceptance criteria. Guide the operator to think about what a useful document looks like for each entity.

### Interface Decomposition

Now step back from the schema and think about how the operator will interact with this module day to day. The entities, their lifecycles, and their relationships determine the skill decomposition.

Read `../docs/references/skill-patterns.md` for the full pattern definitions. The three patterns are:

- **CRUD**: one skill per operation verb, each handles all entity types. Use when the module has a single entity type or all entities share the same lifecycle.
- **Lifecycle**: one skill per domain activity. Use when entities have distinct operational phases and the operator thinks in activities, not generic verbs.
- **Aggregate-layer**: one skill per entity cluster grouped by churn rate and invariant set. Use when entities naturally separate into high-churn and low-churn groups.

To determine the right pattern, ask:

- "Do all these entities feel like the same kind of thing to you, or do some feel fundamentally different to work with?"
- "Which of these change frequently? Which rarely change once set up?"
- "When you interact with these, is it always the same activity, or are there distinct modes of work?"

Use the answers along with the entity count and hierarchy depth to select a pattern. Name the skills using the operator's vocabulary. Get confirmation that the base skill names match how they describe their work.

Then derive the default canonical ALS skill ids:

- Start from the approved base skill name.
- Prefix it once with the module id: `<module-id>-<base-skill-name>`.
- If the base phrase already repeats the module wording, normalize it to one leading prefix instead of doubling it.
- Check the resulting ids against:
  - active ALS skill ids already declared elsewhere in the system
  - existing `.claude/skills/<skill-id>/` target directories and any projected `.claude/delamains/<name>/` targets that would collide during deploy
- If a collision appears, present the problem and recommended alternative ids. The operator chooses the final names.

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
8. **Delamain** (if designed): the transition graph, actor assignments, resumability, and agent file roster

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
  experiments-setup-program     →  create and configure programs
  experiments-run-experiment    →  create runs, record outcomes
  experiments-review-results    →  read-only queries across all entities
  experiments-manage-experiment →  update status, modify config, archive
```

If Delamain was designed, add:

```
Delamain: experiment-pipeline
Phases: [setup, execution, analysis, closed]

States:
  draft        setup       operator
  queued       setup       agent
  running      execution   agent       resumable (run_session)
  analysis     analysis    agent
  completed    closed      terminal
  cancelled    closed      terminal

Transitions:
  advance: draft → queued → running → analysis → completed
  rework:  analysis → queued
  exit:    [all non-terminal] → cancelled

Agent files: 3 (queued, running, analysis)
Dispatcher: generic template (zero config)
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
8. If a Delamain was designed, create the Delamain bundle (see "Delamain bundle authoring" below)
9. Create the module's data directory at `{path}/`
10. Create the subdirectory tree implied by the path templates (empty directories)
11. Validate the live system:

```bash
bun ${CLAUDE_PLUGIN_ROOT}/alsc/compiler/src/cli.ts validate <system-root>
```

11. Preflight Claude projection with empty-target protection:

```bash
bun ${CLAUDE_PLUGIN_ROOT}/alsc/compiler/src/cli.ts deploy claude --dry-run --require-empty-targets <system-root> [module-id]
```

12. If the preflight reports target collisions or Delamain name conflicts under `.claude/`, stop and resolve them with the operator before live deploy.
13. Project the active Claude assets into `.claude/`:

```bash
bun ${CLAUDE_PLUGIN_ROOT}/alsc/compiler/src/cli.ts deploy claude <system-root> [module-id]
```

### If adding to an existing system

1. Create the module version bundle at `.als/modules/{module_id}/v1/`
2. Create the module's shape YAML at `.als/modules/{module_id}/v1/shape.yaml`
3. Register the module in `.als/system.yaml` (add to the `modules` map with `skills` array)
4. If the module has skills, create `.als/modules/{module_id}/v1/skills/`
5. Create a `SKILL.md` for each skill at `.als/modules/{module_id}/v1/skills/{skill_name}/SKILL.md`
6. If a Delamain was designed, create the Delamain bundle (see "Delamain bundle authoring" below)
7. Create the module's data directory at `{path}/`
8. Create the subdirectory tree implied by the path templates (empty directories)
9. Validate the live system:

```bash
bun ${CLAUDE_PLUGIN_ROOT}/alsc/compiler/src/cli.ts validate <system-root>
```

9. Preflight Claude projection with empty-target protection:

```bash
bun ${CLAUDE_PLUGIN_ROOT}/alsc/compiler/src/cli.ts deploy claude --dry-run --require-empty-targets <system-root> [module-id]
```

10. If the preflight reports target collisions or Delamain name conflicts under `.claude/`, stop and resolve them with the operator before live deploy.
11. Project the active Claude assets into `.claude/`:

```bash
bun ${CLAUDE_PLUGIN_ROOT}/alsc/compiler/src/cli.ts deploy claude <system-root> [module-id]
```

### Skill authoring

Each skill gets a `SKILL.md` with:

- **Frontmatter**: `name` and `description`
- **Purpose**: one-line summary of what this skill does
- **Input**: example operator requests that trigger this skill
- **Procedure**: numbered steps — entity resolution, validation, field collection, authoring, writing
- **Scope**: what entities this skill touches and what it explicitly does not do (point to sibling skills)

Name procedures using the operator's domain vocabulary. A devops person "provisions" and "deploys," not "creates" and "updates."

Each skill must declare its scope boundaries — what entities it manages, what operations it performs, and which sibling skills handle everything else.

### Delamain bundle authoring

Only create this when the operator approved a Delamain design in Phase 3. Read `../docs/references/shape-language.md` (Delamain bundles and Delamain agent files sections) for the full format spec.

#### 1. Register in shape.yaml

Add the `delamains` registry to `shape.yaml` and change the entity's status field from `type: enum` to `type: delamain`:

```yaml
delamains:
  {delamain-name}:
    path: delamains/{delamain-name}/delamain.yaml

entities:
  {entity-name}:
    fields:
      status:
        type: delamain
        allow_null: false
        delamain: {delamain-name}
```

Remove `allowed_values` from the status field — the Delamain states are the legal values.

#### 2. Create the bundle directory

```
.als/modules/{module_id}/v1/delamains/{delamain-name}/
├── delamain.yaml
├── agents/
│   └── {state-name}.md        # one per actor: agent state
└── dispatcher/
    ├── package.json
    ├── tsconfig.json
    └── src/
        ├── index.ts
        ├── watcher.ts
        └── dispatcher.ts
```

#### 3. Write delamain.yaml

Produce the YAML from the approved design: `phases`, `states` (with `actor`, `path`, `resumable`, `session-field` as designed), and `transitions` (with `class`, `from`, `to`).

Agent paths use the pattern `agents/{state-name}.md` and resolve relative to the delamain bundle root.

#### 4. Scaffold agent files

Create one markdown file per `actor: agent` state at `agents/{state-name}.md`:

```markdown
---
name: {state-name}
description: {State name} agent for the {delamain-name} pipeline
tools: Read, Edit, Grep
model: sonnet
---

# TODO: Write the {state-name} agent prompt

## Context

- This agent is dispatched when items enter the `{state-name}` state.
- Legal transitions from this state: {list transitions}

## Responsibilities

- [Define what this agent does in this state]
- [Define the criteria for choosing each outgoing transition]
```

The body is a TODO scaffold. The skill cannot write domain-specific agent prompts — the operator or a later session fills these in.

#### 5. Copy the dispatcher template

Copy the generic dispatcher template into the bundle:

```bash
cp -r ${CLAUDE_PLUGIN_ROOT}/skills/new/references/dispatcher/ .als/modules/{module_id}/v1/delamains/{delamain-name}/dispatcher/
```

Then install dependencies:

```bash
cd .als/modules/{module_id}/v1/delamains/{delamain-name}/dispatcher && bun install
```

The dispatcher requires zero modification — it derives everything from the ALS declaration surface at runtime.

### After creation

Tell the operator what was created and where. Suggest they can now create their first record by hand or with help, and that the compiler will validate everything when it runs.

If a Delamain was created, also tell the operator:
- Agent files are TODO scaffolds that need prompts written before the dispatcher can run.
- The dispatcher is ready to run once agent prompts are authored: `cd <delamain-bundle>/dispatcher && bun run src/index.ts`
- Session fields are implicit — they do not need to be added to shape.yaml or entity frontmatter manually. The dispatcher handles persistence.
