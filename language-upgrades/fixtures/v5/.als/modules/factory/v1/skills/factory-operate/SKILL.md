---
name: factory-operate
description: Operator console for the factory development pipeline. Scans work items for operator attention, presents context actions, and handles all CRUD. The single skill for interacting with the factory module.
model: sonnet
allowed-tools: Bash(bash *)
---

# factory-operate

Operator console for the factory module. Surfaces work items that need operator attention, presents status-specific actions, and handles creation and queries.

This is the single interface for all operator interactions with the development pipeline.

## Startup

Before entering either mode, ensure the module's delamain dispatchers are running.

### Delamain check

1. Resolve the system root — the directory containing `.als/system.ts`. Store the **absolute path**.
2. Read `module.ts` for the active module version. Check if `delamains:` is declared.
3. If no delamains, skip to mode selection.
4. For each declared delamain, check if a heartbeat file exists and is fresh:
   ```bash
   cat {system-root}/.claude/delamains/{delamain-name}/status.json 2>/dev/null
   ```
   If `status.json` exists and `last_tick` is within 2x `poll_ms`, the dispatcher is alive. Skip to the next delamain.
5. If the dispatcher is not running, start it as a Claude background shell. Use the Bash tool with `run_in_background: true`. **Always use absolute paths**:
   ```
   Bash(command: "cd {system-root}/.claude/delamains/{delamain-name}/dispatcher && bun install --silent 2>/dev/null && bun run src/index.ts", run_in_background: true)
   ```
   Do NOT use `nohup` or `&`. The dispatcher runs as a Claude-managed background shell — visible as "N shell" in the statusline, inspectable via Shell details, and dies when Claude exits.
   Wait 3 seconds, then verify `status.json` was written.
6. Report to the operator: which dispatchers were already running, which were started.

The dispatcher is a long-running poll loop owned by the Claude session. It auto-discovers the system root and dispatches agents for work items in agent-owned statuses. It writes a heartbeat to `.claude/delamains/{name}/status.json` on each tick. When Claude exits, the dispatcher dies and the heartbeat goes stale — the next session's startup will restart it automatically.

## Modes

### Console mode (default)

Invoked without arguments or with "status" / "what needs attention" / "queue":

1. Scan for attention items
2. Present attention queue
3. Present context actions for selected item
4. Execute action
5. Loop to step 1

### Direct mode

Invoked with a specific request ("create a work item", "show SWF-001", "list all items"):

Execute the request directly. Offer to enter console mode after.

## Console Mode

### 1. Scan

Read all files in the module data path. Parse YAML frontmatter. Collect items where `status` is an attention status.

| Status | Label | Meaning |
|--------|-------|---------|
| `plan-input` | PLAN INPUT | Planner has questions for the operator |
| `plan-ready` | PLAN READY | Plan complete, awaiting operator approval |
| `uat-test` | UAT TEST | Implementation passed review, operator must verify |
| `deployment-failure` | DEPLOY FAIL | Deployment verification failed, operator decides |

Items in other statuses are agent-owned or terminal. Ignore them.

Resolve the data path from `.als/system.ts` module entry. The entity path template is `items/{id}.md` relative to the module path.

If no items need attention: "No items require operator attention." Offer direct mode.

### 2. Present queue and create options

Present two questions in a single AskUserQuestion call.

**Question 1 — Attention queue:**
- **header**: `Queue`
- **question**: `Attention: {N} Plan Input, {N} Plan Ready, {N} UAT Test, {N} Deploy Fail. Select an item to act on.` (omit groups with 0)
- **options**: Each attention item:
  - **label**: `[{STATUS}] {id}  {title}` — status in caps
  - **description**: `{kind} | {priority} | {repository}`
- If more than 4 attention items, split into multiple questions by status group.
- If no attention items, omit this question entirely.

**Question 2 — Create new:**
- **header**: `Create`
- **question**: `Or create a new work item?`
- **options**:
  - `Bug report` — Report a bug in an existing system
  - `Feature request` — Request a new capability
  - `Hotfix issue` �� Urgent fix for a production issue
  - `Experiment request` — Propose a new experiment

Always include the Create question, even when the queue is empty.

If operator types "exit", "quit", or "done" via Other — exit the skill.

### 3. Context actions

Read the selected item's full file. Present a second AskUserQuestion based on status.

**Header**: The item's ID (e.g., `SWF-001`)

**Question text**:
```
{id}: {title}
{status} | {kind} | {priority} | {repository}

Select an action:
```

#### plan-input

| Option | Label | Description |
|--------|-------|-------------|
| 1 | Answer questions | Review and answer planner questions |
| 2 | Back | Return to attention queue |
| 3 | Cancel | Exit console |

#### plan-ready

| Option | Label | Description |
|--------|-------|-------------|
| 1 | Approve plan | Promote to ready for implementation |
| 2 | Request revision | Send plan back with operator notes |
| 3 | Back | Return to attention queue |
| 4 | Cancel | Exit console |

#### uat-test

| Option | Label | Description |
|--------|-------|-------------|
| 1 | Pass UAT | Mark deployment-ready |
| 2 | Fail UAT | Re-queue for full re-plan |
| 3 | Back | Return to attention queue |
| 4 | Cancel | Exit console |

#### deployment-failure

| Option | Label | Description |
|--------|-------|-------------|
| 1 | Inspect failure | Review deployment context without changing status |
| 2 | Send back to dev | Return to ready with operator notes |
| 3 | Re-plan from scratch | Return to queued for full re-planning |
| 4 | Cancel | Exit console |

**Navigation**:
- **Back** -> re-scan and present queue
- **Cancel** -> "Console session closed."
- **Other** -> interpret as freeform instruction for this item

### 4. Execute action

After execution, loop back to step 1 unless operator cancelled.

#### Answer questions (plan-input)

1. Read `## PLAN_QUESTIONS`. Find unanswered content — skip blocks under `### Round N (answered)` headings.
2. Extract discrete questions from the unanswered content.
3. Present each question via AskUserQuestion (max 4 per call).
   - If planner provided explicit options, map them to AskUserQuestion options.
   - If not, synthesize 2 reasonable options from context. Other is always available.
4. Write answers back into PLAN_QUESTIONS. Do not rewrite existing planner prose.
5. Update frontmatter: `status: queued`, `updated: {today}`.
6. Append to ACTIVITY_LOG: `- {today}: Status -> queued. Operator answered planner questions via factory-operate.`

#### Approve plan (plan-ready)

1. Update: `status: ready`, `updated: {today}`.
2. Append: `- {today}: Status -> ready. Operator approved plan via factory-operate.`
3. Confirm: "{id} approved — now ready for dev dispatch."

#### Request revision (plan-ready)

1. Collect revision notes via AskUserQuestion:
   - **Header**: `Revision`
   - **Question**: "What needs to change?"
   - Provide 2 options based on the item's PLAN content.
2. Update: `status: queued`, `updated: {today}`.
3. Append: `- {today}: Status -> queued. Operator requested revision: {summary}. Via factory-operate.`
4. Confirm: "{id} sent back for revision."

#### Pass UAT (uat-test)

1. Update: `status: deployment-ready`, `updated: {today}`.
2. Append: `- {today}: Status -> deployment-ready. Operator passed UAT via factory-operate.`
3. Confirm: "{id} passed UAT — now deployment-ready."

#### Fail UAT (uat-test)

1. Collect failure notes via AskUserQuestion:
   - **Header**: `UAT Fail`
   - **Question**: "What failed?"
   - Provide 2 options based on DOD/REQUIREMENTS.
2. Update: `status: queued`, `updated: {today}`.
3. Append: `- {today}: Status -> queued. Operator failed UAT: {summary}. Via factory-operate.`
4. Confirm: "{id} failed UAT — re-queued for planning."

#### Inspect failure (deployment-failure)

1. Read `## DEPLOYMENT` and last 5 ACTIVITY_LOG entries.
2. Present: what was deployed, what failed, error context.
3. Do not change status. Return to context actions for the same item.

#### Send back to dev (deployment-failure)

1. Collect operator notes via AskUserQuestion.
2. Update: `status: ready`, `updated: {today}`.
3. Append: `- {today}: Status -> ready. Operator sending back to dev: {summary}. Via factory-operate.`

#### Re-plan from scratch (deployment-failure)

1. Collect operator notes via AskUserQuestion.
2. Update: `status: queued`, `updated: {today}`.
3. Append: `- {today}: Status -> queued. Re-plan after deployment failure: {summary}. Via factory-operate.`

## Direct Mode

### Create work item

1. Collect from operator: `title`, `kind` (bug, feature, hotfix, experiment), `priority`, `repository`.
2. Allocate ID: scan existing items in the data directory, find the highest `SWF-NNN`, increment by 1.
3. Set defaults: `created`/`updated` to today, `status: draft`, nullable fields to `null`.
4. Author the record with all sections in declared order. Set non-nullable sections (DESCRIPTION, ACTIVITY_LOG) to initial content. Set nullable sections to `null`.
5. Write to `{module_path}/items/{id}.md`.
6. Append: `- {today}: Created.`
7. Confirm with the full ID and path.

### Show item

Read and present the full record for a given ID.

### List items

Query items and present as a table: `id | title | status | kind | priority | repository`.

Support filters:
- By status: "show queued items"
- By kind: "list all bugs"
- By repository: "items for apps/search"
- Pipeline view: "what's in the pipeline" — group by SDLC phase

### Update fields

1. Read the record.
2. Apply changes. Set `updated` to today.
3. For status changes, validate against pipeline transitions. See [references/pipeline.md](references/pipeline.md).
4. Append to ACTIVITY_LOG.

### Close items

Set status to `completed`, `deferred`, or `cancelled`. These are valid exits from any non-terminal status. Append to ACTIVITY_LOG.

## Rules

- **Activity log is append-only.** Never edit or remove existing entries.
- **Validate status transitions** against [references/pipeline.md](references/pipeline.md). Only allow declared transitions.
- **Loop after every console action.** Re-scan and present the queue.
- **Confirm every transition** — tell the operator what changed and what happens next.
- **Today's date** format: YYYY-MM-DD.
- **Use Edit tool** for all file modifications. Be precise with `old_string` matching.
- **Session fields are implicit.** `planner_session` and `dev_session` are managed by the dispatcher, not this skill. Do not create, modify, or validate them.
