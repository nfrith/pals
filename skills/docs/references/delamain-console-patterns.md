# Delamain Console Patterns

Reference for building operator console skills that work with any delamain. The console is a projection of the delamain's transition graph into an operator-friendly interface.

## Audience

ALS Developer, ALS Architect.

## The Universal Operator Action Pattern

Every operator state in a delamain means the same thing: the system is waiting for operator input. The console actions are universal across all operator states.

### Actions

When the operator selects an {entity} in an operator-owned state, the console reads the delamain's transitions where `from` = current state, groups them by class, and presents:

| Action | Description | When shown |
|--------|-------------|------------|
| **Review** | Present the entity to the operator for reading | Always |
| **Respond** | Do the state-specific work, then choose a transition | If any advance or rework transitions exist |
| **Terminal** (shelve, cancel, etc.) | Exit the pipeline | If exit transitions exist for this state |
| **Exit** | Exit the console | Always |
| **Other** | Freeform operator instruction | Always |

If a class has zero targets for this state, omit that row entirely.

### Respond: two-phase pattern

"Respond" is a single action with two phases:

**Phase 1 — Do the work.** The operator performs whatever the state requires. The meaning depends on whether the state is initial:

| State kind | Phase 1 means |
|------------|---------------|
| **Initial** (`initial: true`) | Confirm ready to enter pipeline. |
| **Non-initial** | Perform what the preceding agent requires — answer questions, record test results, provide context. |

For non-initial states, the console determines what the operator is responding to by reading the entity's current content — agent questions in a questions section, test instructions in a test section, etc.

**Phase 1 is guided, not delegated.** The console walks the operator through the work step by step — presenting one item at a time, collecting responses, running verification where possible. The agent is an active partner during Phase 1, not a questionnaire that hands the operator a checklist and waits. For example: UAT testing presents each test case individually, helps verify results, and records outcomes as they happen. Input states present each question one at a time, collect answers, and ask follow-ups for clarity.

**Phase 2 — Choose direction.** After the work is done, the console presents the legal transitions from the delamain:

| Transition class | Presented as |
|------------------|-------------|
| **advance** | Advance to {state} — one option per advance target |
| **rework** | Rework to {state} — one option per rework target |

If a class has multiple targets (e.g., the initial state advances to three different states depending on entity type), show one option per target. If a class has zero targets, omit it.

The operator chooses the direction *after* doing the work, not before. This matters most for states where the response determines the outcome (e.g., UAT — pass vs fail isn't known until tests are performed).

### After every transition

Update the delamain's state as the last edit before the transition commit. Always.

Commit every transition as its own dedicated commit. Use the subject:

`delamain: <id> <from> → <to> [operator]`

The dispatcher only reads committed `HEAD` state. Unstaged or staged status edits do nothing until that transition commit exists.

### Review

"Review" means presenting the full entity record to the operator for reading before they make a decision. The implementation is platform-specific — a tmux popup, a file preview, a web view. The pattern is platform-agnostic: the operator can always read before acting.

## The Attention Queue

The attention queue is the console's entry screen — what the operator sees when they first open the console. It is not a delamain state or phase. It is a separate mode: a scan of all entities that need operator action.

### Scan

Read all entities. Filter to those whose status maps to an operator-owned state in the delamain. Group by state.

### Presentation

The attention queue is a selection prompt with two kinds of options:

1. **Create new {entity}** — always the first option, always shown, even when the queue is empty.
2. **Attention items** — entities in operator-owned states. Suggested label format: `[{STATE}] {id}  {title}` (e.g., `[UAT] GF-002  Upgrade tmux-annotate`).

The operator selects an item to act on (entering the universal action pattern), or creates a new entity. "Create new {entity}" only appears on the attention queue screen — once the operator selects an item, they are in the action pattern, not the queue.

### Loop

After every action completes, the console returns to the attention queue. Re-scan, re-present. The operator stays in the console until they exit or no items remain.

## Delamain-Driven vs Hand-Coded

A hand-coded console defines a switch statement per operator state with custom actions for each. This works for small delamains but scales poorly — every new operator state requires new console code.

A delamain-driven console reads the transition table and derives actions dynamically. The console skill only needs to know:

1. Which transitions are legal from this state (from the delamain)
2. What "respond" means for this state (from the entity's content)
3. How to present the entity for review (platform-specific)

State-specific behavior (like type-gated advance options for the initial state) is expressed through the delamain's transition rules, not through console branching logic.

## Example: Ghost Factory

Four operator states, one universal pattern:

| State | Initial? | Phase 1 (do the work) | Phase 2 (choose direction) |
|-------|----------|-----------------------|---------------------------|
| `drafted` | yes | Confirm ready to enter pipeline | Advance to research, planning, or dev (type-gated) |
| `research-input` | no | Answer research agent questions | Advance to planning / Rework to research |
| `plan-input` | no | Answer planner agent questions | Advance to dev / Rework to planning |
| `uat` | no | Perform tests, record results | Advance to done / Rework to dev |

The console doesn't know about these states specifically. It reads the delamain, sees what's legal, and presents the universal action menu. The only state-specific knowledge is what phase 1 means — and that comes from reading the entity, not from console code.
