# Delamain Overview

Delamains are Phase-Constrained Transition Graphs — formalized workflow engines that govern how entities move through lifecycle states. The name is a convenience label; the underlying construct is a state machine with phase groupings, actor ownership, and agent bindings.

## Audience

All profiles — Operator, ALS Developer, ALS Architect, Claude.

## Core Concepts

### States

Every state in a delamain has:

- **Phase** — a logical grouping (e.g., `intake`, `planning`, `implementation`, `deployment`, `closed`). Phases impose ordering on the state graph but don't enforce transitions.
- **Actor** — either `operator` or `agent`. Determines who owns the state. Operator states wait for human action. Agent states are dispatched automatically.
- **Terminal** — optional. Terminal states have no outbound transitions. Items that reach a terminal state are done.

### Transitions

Transitions connect states. Each transition has:

- **Class** — `advance` (forward progress), `rework` (return to earlier state), or `exit` (move to terminal).
- **From** — one or more source states.
- **To** — the target state.

Only legal transitions are allowed. An agent or operator can only move an item to a state that has a declared transition from the current state.

### Phases

Phases group states into logical stages. They exist for human readability and reporting — they don't enforce transition rules. A transition can cross phase boundaries.

### Agent Bindings

States with `actor: agent` declare:

- **path** — the agent markdown file (relative to the delamain bundle root)
- **provider** — the runtime provider for the agent prompt (`anthropic` or `openai`)
- **resumable** — whether the state participates in persisted session handling
- **session-field** — the frontmatter field that stores the persisted session identifier for that state
- **sub-agent** — optional path to a sub-agent markdown file

### Operator States

States with `actor: operator` have no agent binding. They represent wait points where the human decides what happens next. The operator console skill surfaces items in operator states and presents context actions.

## The Delamain Bundle

A delamain is a directory containing:

```
development-pipeline/
├── delamain.ts           # phases, states, transitions
├── agents/
│   ├── queued.md           # one per agent-owned state
│   ├── planning.md
│   └── ...
├── sub-agents/
│   └── developer.md        # optional helpers
└── dispatcher/
    ├── package.json
    ├── tsconfig.json
    └── src/
        ├── index.ts
        ├── dispatcher.ts
        ├── session-runtime.ts
        └── watcher.ts
```

The Delamain bundle is self-contained. It lives in `.als/modules/{module}/v{N}/delamains/` as authored `delamain.ts` plus markdown assets, and is deployed to `.claude/delamains/` by the compiler as runtime files.

## Claude Projection

`alsc deploy claude` projects each active Delamain bundle to `.claude/delamains/<delamain-name>/`.

- Authored Delamain files refresh from the canonical ALS bundle on deploy.
- If the deployed target already has `dispatcher/node_modules/`, deploy preserves it.
- Deploy stays filesystem-only. It does not run `bun install` or any other package-manager command.
- If the target dispatcher has no `node_modules/` yet, deploy warns and continues.
- Because Delamain projection may use merge semantics, stale authored files or incidental runtime files can remain in the deployed target.

## How It Runs

1. The operator starts the dispatcher (via `/run-delamains` or manually).
2. The dispatcher polls committed `HEAD` state for entities in agent-owned states.
3. When an item is found, the dispatcher reads the state's agent file and invokes it via the Agent SDK.
4. The agent performs its work and transitions the item to the next state.
5. On the next tick after that transition is committed, the dispatcher sees the new state and dispatches the appropriate agent — or stops if the state is operator-owned or terminal.

The operator interacts with items in operator-owned states through the pipeline console skill.

## Monitoring Model

Delamain runtime monitoring now has two layers:

- **Statusline** — compact badge surface for quick liveness checks
- **Delamain Dashboard** — canonical monitoring surface for current queue state, recent runs, and recent failures

Dispatchers remain the producers of runtime truth. They emit:

- `status.json` for compatibility-oriented liveness plus provider-aware active-dispatch metadata
- `telemetry/events.jsonl` for bounded recent dispatch history

The dashboard service reads those runtime files plus bundle metadata and current item files, then serves one normalized snapshot to both the localhost web UI and the OpenTUI client.

## Event-Driven, Not Polling

While the dispatcher technically polls the filesystem, the system is event-driven from the operator's perspective. The commit is the event boundary: agents run when committed work exists in `HEAD`. No heartbeat daemon burns tokens in the background. The operator is the heartbeat.

## Discriminated Variants

When an entity uses a discriminator (e.g., `type: app` vs `type: infra`), only the variant with a `type: delamain` status field participates in the pipeline. The dispatcher filters items by the discriminator value, ignoring items of other variants.
