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
| `tools` | No | Comma-separated tool list. Default: `Read, Edit`. Supports all Claude Code tools including `Skill` (for `/commit` and other skills), `Agent`, `Bash`, etc. |
| `model` | No | `sonnet`, `opus`, or `haiku`. Default: `sonnet` |
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

For direct SDK-resumable states, `resume: yes` means the dispatcher will resume its prior Agent SDK session. For delegated states, `resume: no` can still appear alongside a non-null `session_id`, meaning the saved session belongs to the delegated worker rather than the dispatcher-owned SDK session.

## Best Practices

### 1. Idempotent Agents

Agents may be re-dispatched if the dispatcher restarts. Every agent must be safe to run twice on the same item in the same state.

**For direct dispatch** (agent does work via Agent SDK): this is naturally handled — the agent reads the item, checks state, and either acts or stops.

**For delegated dispatch** (agent spawns an external process): the agent must check whether the operation is already in progress before acting. Check reality, not state.

Example — checking if a tmux window already exists:

```bash
pane_cmd=$(tmux -L {SOCKET} list-panes -t "{SESSION}:{WINDOW}" -F '#{pane_current_command}' 2>/dev/null)
```

- No output → window doesn't exist → proceed
- Output is `codex` or `node` → already running → log and stop
- Output is `zsh` or `bash` → process finished or died → flag for operator

### 2. Delegated Dispatch

Some agents don't do work directly — they spawn an external process (e.g., a Codex session) and stop. This is the delegated dispatch pattern.

The `delegated: true` field in the authored `delamain.ts` definition, projected into runtime `delamain.yaml`, tells the dispatcher to skip Agent SDK resume and auto-persist for delegated states while still exposing runtime session metadata to the agent.

Key rules for delegated agents:
- **Check idempotency first** — verify the delegate isn't already running
- **The dispatch command writes the session ID** — the dispatcher disables auto-persist for delegated states, so the session ID must be captured and written by the dispatch mechanism
- **Saved worker session metadata** — use `session_id` from Runtime Context as the delegated worker session identifier when it is present. `resume` stays `no` because the dispatcher is not resuming its own Agent SDK session for delegated states.

#### Headless dispatch (production)

For automated dispatch without operator monitoring, use `codex exec --json` to run non-interactively and capture the session ID from the JSONL output:

**Fresh dispatch with session capture:**
```bash
TID=$(codex exec --json "{PROMPT}" | jq -r 'select(.type=="thread.started") | .thread_id')
sed -i '' "s/^{SESSION_FIELD}: .*/{SESSION_FIELD}: $TID/" {ITEM_FILE}
```

**Resume dispatch:**
```bash
codex exec resume {SESSION_ID} "{PROMPT}"
```

The `thread.started` event is the first JSONL line emitted. `jq` extracts the `thread_id`, and `sed` writes it to the item's session field after Codex exits. On resume, the stored session ID is passed directly — no re-capture needed.

#### Debug dispatch (tmux)

For operator monitoring, spawn Codex inside a tmux window so the operator can watch the output in real time:

```bash
# Create a tmux window
tmux new-window -t "{SESSION}" -n "{WINDOW}" -d

# Fresh — stream output to terminal, capture session ID after completion
tmux send-keys -t "{SESSION}:{WINDOW}" \
  'codex exec --json "{PROMPT}" | tee >(jq -r '\''select(.type=="thread.started") | .thread_id'\'' > /tmp/tid-{ITEM_ID}); sleep 1; TID=$(cat /tmp/tid-{ITEM_ID}); sed -i '\'''\'' "s/^{SESSION_FIELD}: .*/{SESSION_FIELD}: $TID/" {ITEM_FILE}; rm -f /tmp/tid-{ITEM_ID}' Enter

# Resume — no session capture needed
tmux send-keys -t "{SESSION}:{WINDOW}" \
  'codex exec resume {SESSION_ID} "{PROMPT}"' Enter
```

The `tee` splits output: one copy goes to the terminal (visible to the operator), and the other pipes through `jq` to extract the session ID to a temp file. After Codex exits, the session ID is read, written to the item, and the temp file is cleaned up.

The interactive TUI mode (`codex --no-alt-screen`) can also be used for debugging but does not support machine-readable session capture.

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

Session fields are implicit — they exist on items but are not declared in `module.ts`. They are managed by the dispatcher (for direct dispatch) or the dispatch command chain (for delegated dispatch). Skills and agents should not create, modify, or validate session fields unless they are part of the delegated dispatch mechanism.

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
