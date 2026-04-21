# Delamain Agent Authoring

Reference for writing state agents and sub-agents in a delamain bundle. Covers the agent file format, best practices, and patterns that have emerged from production use.

## Audience

ALS Developer, ALS Architect, Claude.

## Agent File Format

Agent files are markdown with YAML frontmatter:

```markdown
---
name: development-pipeline--planning
description: Handle items in the planning state.
tools: Read, Edit, Grep, Glob
model: sonnet
color: blue
---

You are the state agent for `planning` in the `development-pipeline` Delamain.

## Mission

One sentence describing what this agent does.

## Procedure

1. Step one.
2. Step two.
3. ...
```

### Frontmatter Fields

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Agent identifier. Convention: `{delamain-name}--{state}` |
| `description` | Yes | One-line description for the dispatcher log |
| `tools` | Anthropic only | Comma-separated Claude tool list. Supports `Skill` (for `/commit` and other skills), `Agent`, `Bash`, etc. |
| `model` | No | Provider-specific model selector. Anthropic uses `sonnet`, `opus`, or `haiku`; OpenAI uses codex model ids such as `gpt-5.4`. |
| `sandbox-mode` | OpenAI only | Codex sandbox mode. Common value: `workspace-write`. |
| `approval-policy` | OpenAI only | Codex approval policy. Common value: `never`. |
| `reasoning-effort` | OpenAI only | Optional Codex reasoning effort (`low`, `medium`, `high`, `xhigh`). |
| `color` | No | Display color hint |

### Body

The body is the agent's prompt. It is sent verbatim to the Agent SDK with runtime context appended.

## Runtime Context

The dispatcher appends a `## Runtime Context` section to every agent prompt at dispatch time:

```
---

## Runtime Context

item_id: SWF-001
item_file: /path/to/SWF-001.md
current_state: planning
date: 2026-04-06
resume: no
session_field: planner_session
session_id: null

legal_transitions:
- advance → plan-input
- advance → plan-ready
```

The agent uses this to know which item to operate on, what transitions are legal, and how session handling applies in the current state.

For resumable states, `resume: yes` means the dispatcher will resume the provider-owned prior session or thread using the stored `session_id`. On a first run, `resume: no` appears alongside a non-null `session_field` and `session_id: null`.

## Best Practices

### 1. Idempotent Agents

Agents may be re-dispatched if the dispatcher restarts. Every agent must be safe to run twice on the same item in the same state.

The agent should read the item, confirm the current state, and either act or stop. Resumable provider sessions help with continuity, but the authored prompt still needs to be safe when re-run.

Example — checking if a tmux window already exists:

```bash
pane_cmd=$(tmux -L {SOCKET} list-panes -t "{SESSION}:{WINDOW}" -F '#{pane_current_command}' 2>/dev/null)
```

- No output → window doesn't exist → proceed
- Output is `codex` or `node` → already running → log and stop
- Output is `zsh` or `bash` → process finished or died → flag for operator

### 2. Provider-Specific Prompt Surfaces

ALS agent prompts are authored against the declared state `provider`.

- **Anthropic provider**: Claude-style frontmatter such as `tools`, Anthropic model aliases, and `/skill` references in the prompt body.
- **OpenAI provider**: Codex-style frontmatter such as `sandbox-mode`, `approval-policy`, optional `reasoning-effort`, and `$skill` references in the prompt body.

The compiler rejects cross-provider prompt syntax. Examples:

- `provider: openai` with `/commit` in the prompt body is invalid.
- `provider: openai` with `tools:` frontmatter is invalid.
- `provider: anthropic` with `$commit` in the prompt body is invalid.
- `provider: anthropic` with `sandbox-mode:` frontmatter is invalid.

### 3. Status Change Last

When an agent or skill edits an ALS record, the status field must be the **last** field changed before the transition commit. All other edits (activity log entries, field updates, section rewrites) must complete before the status transition is written.

**Why:** Delamain dispatchers poll committed `HEAD` state. If the status changes before other edits are complete, the transition commit can publish a partially updated record and the next agent will read that incomplete snapshot.

**Rule:** In any Edit sequence that includes a status change, the status change is a separate Edit call issued after all other edits succeed, and the resulting transition is committed as its own dedicated commit before the dispatcher can act on it.

### 4. One Job Per Agent

Each state agent has exactly one job: perform the work for that state and choose the next transition. Don't combine multiple states' work into one agent.

- **Transition agents** (e.g., `queued.md`, `ready.md`): move the item to the next state. Minimal logic — read, validate, transition, log.
- **Work agents** (e.g., `planning.md`, `in-dev.md`): perform substantive work then transition based on the outcome.

### 4. Sub-Agents for Focused Work

When a state agent needs to perform a large unit of focused work, delegate to a sub-agent. The sub-agent:
- Does the scoped implementation work
- Reports results back to the parent
- Does NOT choose the next transition — only the parent state agent decides

### 5. Session Field Ownership

Session fields are implicit — they exist on items but are not declared in `module.ts`. They are managed by the dispatcher as provider-owned session/thread identifiers. Skills and agents should not create, modify, or validate session fields directly.

### 6. Agent Prompt Structure

Keep agent prompts focused:
- **Mission** — one sentence
- **Context** — only if the agent needs domain-specific knowledge
- **Procedure** — numbered steps, each step is one action
- **Conditional sections** — only when the agent's behavior varies by domain

Avoid putting lifecycle rules in agent prompts. The legal transitions come from Runtime Context — the agent doesn't need to know the full state machine.

### 7. Operator Console Skill

Every delamain should have a corresponding operator console skill. The delamain bundle handles automated dispatch for agent-owned states. The console skill handles operator-owned states — surfacing items that need attention and providing context actions.

The console skill pattern:
1. **Scan** — find items in operator-attention statuses (e.g., `plan-input`, `plan-ready`, `uat-test`, `deployment-failure`)
2. **Present** — show the attention queue grouped by status, let the operator select an item
3. **Act** — offer status-specific context actions (answer questions, approve plan, record UAT pass/fail)
4. **Loop** — after every action, re-scan and return to the queue until the operator exits

The console skill is the operator's interface to the delamain. Without it, operator-owned states are dead ends — items arrive but nobody acts on them.

Naming convention: `{module}-{variant}-{delamain}` (e.g., `backlog-app-development-pipeline`). The skill lives in the module's skills directory alongside CRUD and inspection skills.
