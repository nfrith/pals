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
| **Respond & advance** to {state} | Provide input, move forward | If advance transitions exist for this state |
| **Respond & rework** to {state} | Provide input, send back | If rework transitions exist for this state |
| **Terminal** (shelve, cancel, etc.) | Exit the pipeline | If exit transitions exist for this state |
| **Exit** | Exit the console | Always |
| **Other** | Freeform operator instruction | Always |

If a class has multiple targets (e.g., the initial state advances to three different states depending on entity type), show one option per target.

If a class has zero targets for this state, omit that row entirely.

### What "respond" means

The meaning of "respond" depends on whether the state is initial:

| State kind | Respond means |
|------------|---------------|
| **Initial** (`initial: true`) | Confirm ready to enter pipeline. Advance to next state(s). |
| **Non-initial** | Perform the actions the preceding agent requires — answer questions, record test results, provide context. |

For non-initial states, the console determines what the operator is responding to by reading the entity's current content — agent questions in a questions section, test instructions in a test section, etc. The console guides the operator through providing what the next agent (or terminal transition) needs.

### After every transition

Update the delamain's state as the last edit. Always.

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

| State | Initial? | Advance to | Rework to | Respond means |
|-------|----------|-----------|-----------|---------------|
| `drafted` | yes | research, planning, or dev (type-gated) | n/a | Confirm ready |
| `research-input` | no | planning | research | Answer research agent questions |
| `plan-input` | no | dev | planning | Answer planner agent questions |
| `uat` | no | done | dev | Record test results |

The console doesn't know about these states specifically. It reads the delamain, sees what's legal, and presents the universal action menu. The only state-specific knowledge is what "respond" means — and that comes from reading the entity, not from console code.
