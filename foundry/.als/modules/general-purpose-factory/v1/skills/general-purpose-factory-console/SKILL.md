---
name: general-purpose-factory-console
description: Operator console for general-purpose factory jobs. Create jobs, surface operator-owned states, and route work into or out of the RPI pipeline.
model: sonnet
allowed-tools: Bash(bash *)
---

# Dependencies

## Scanner results

none.

## LLM Operations

- Resolve the system root and confirm `.als/system.ts` exists before proceeding.
- Read the active `general-purpose-factory` module entry from `.als/system.ts` to resolve the mounted jobs path.
- Read the module's authored `delamain.ts` before presenting actions so the console derives legal transitions from the current graph.
- Check `.claude/delamains/general-purpose-factory-jobs/status.json` when present. If the dispatcher is stale or missing, warn the operator that autonomous states will not progress until `/bootup` is run.

# general-purpose-factory-console

Primary operator interface for `general-purpose-factory`. It implements the universal delamain console pattern for the two operator-owned states: `drafted` and `blocked`.

## Input

Use this skill when the operator wants to:

- create a new job
- see what needs attention
- kick a drafted job into research
- recover a blocked job
- shelve or cancel a job

## Procedure

### 1. Resolve context

1. Resolve the system root and mounted jobs path from `.als/system.ts`.
2. Read `module.ts` and `delamains/general-purpose-factory-jobs/delamain.ts`.
3. Treat `drafted` and `blocked` as the attention states.

### 2. Scan the attention queue

1. Read all job records under the mounted jobs path.
2. Filter to records whose `status` is `drafted` or `blocked`.
3. Present a queue with:
   - `Create new job` as the first option, always.
   - One option per attention item using the label format `[STATUS] {id}  {title}`.
4. After every completed action, re-scan and re-present the queue until the operator exits.

### 3. Create a new job

1. Collect `title`, `description`, `type`, and optional tags from the operator.
2. Allocate the next `GPF-NNN` id by scanning existing jobs.
3. Write a new record at `general-purpose-factory/jobs/{id}.md` with:
   - frontmatter fields in the authored order
   - `status: drafted`
   - `created` and `updated` set to today
   - `research_session`, `planner_session`, and `impl_session` set to `null`
   - `PURPOSE` seeded from the operator's goal
   - nullable sections initialized to `null`
   - `ACTIVITY_LOG` seeded with `- YYYY-MM-DD: Created.`
4. Return to the attention queue.

### 4. Universal action menu

When the operator selects a job in an operator-owned state, present:

- `Review` — show the full job record before any change.
- `Respond` — do the state-specific work, then choose a legal transition.
- `Terminal` — offer any legal exit transitions for the current state.
- `Exit` — leave the console.
- `Other` — interpret freeform operator instructions for this job.

### 5. Respond for `drafted`

1. Confirm the operator is ready to start the pipeline and that `PURPOSE`, `CURRENT_STATE`, and `REQUIREMENTS` are sufficient to begin.
2. Offer the single legal advance target: `research`.
3. When chosen:
   - update `status` as the last edit
   - update `updated`
   - append `- YYYY-MM-DD: drafted -> research [operator]. Advanced via general-purpose-factory-console.`
   - create a dedicated transition commit with the subject `delamain: {id} drafted -> research [operator]`

### 6. Respond for `blocked`

1. Read the job sections that explain the blocker: `RESEARCH_QUESTIONS`, `PLAN_QUESTIONS`, `REVIEW`, `DEPLOYMENT`, and recent `ACTIVITY_LOG` entries.
2. Guide the operator through the missing input or corrective edit directly in the job file.
3. Offer the legal rework targets from the delamain:
   - `research`
   - `planning`
   - `impl`
4. When the operator chooses a direction:
   - update `status` as the last edit
   - update `updated`
   - append `- YYYY-MM-DD: blocked -> {target} [operator]. Reworked via general-purpose-factory-console.`
   - create a dedicated transition commit with the subject `delamain: {id} blocked -> {target} [operator]`

### 7. Terminal actions

If the selected state allows exits, offer each legal terminal target separately. For this delamain that means:

- `shelved`
- `cancelled`

For either transition:

1. Update `status` as the last edit.
2. Update `updated`.
3. Append `- YYYY-MM-DD: {from} -> {to} [operator]. Exited via general-purpose-factory-console.`
4. Create a dedicated transition commit with the subject `delamain: {id} {from} -> {to} [operator]`.

## Notes

- Use the authored transition graph as the source of truth. Do not hard-code extra states or actions that are not legal in `delamain.ts`.
- The bundled sample at `references/sample-job.md` is a copy-paste starting point when the operator wants an example record shape.
- If the operator only wants to read job state without changing it, hand them to `general-purpose-factory-inspect`.
