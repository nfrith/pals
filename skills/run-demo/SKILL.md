---
name: run-demo
description: Reference-system demo runner. Seeds items via traffic generator, then starts dispatchers so all delamains have work immediately.
model: sonnet
allowed-tools: AskUserQuestion, Bash(bash *), Skill
---

# run-demo

Demo runner for the reference-system. Injects demo-mode overrides into delamain agents, starts one traffic generator per delamain, then starts dispatchers — so every delamain has work from the moment it comes online.

## Setup

The reference-system lives inside the ALS repo. Resolve it once:

```
SYSTEM_ROOT={skill-dir}/../../reference-system
```

All paths below use `{system-root}` to mean this resolved path.

## Procedure

### 1. Ask where to run delamains

Use AskUserQuestion to ask:

**Question:** "Where do you want to run the demo delamains?"

**Options:**
- "Other terminal windows (recommended)" — Opens separate terminal windows/tabs for each delamain
- "Detect my runtime" — Inspects the current environment (tmux, terminal app) to suggest the best approach
- "Claude Code statusline (buggy)" — Uses the statusline badge system (known issues — may die mid-demo)

Store the answer for use in later steps.

#### If "Other terminal windows"

Detect what terminal the operator is currently using:

```
Bash(command: "echo $TERM_PROGRAM")
```

Check if the terminal supports tabs (iTerm2, Terminal.app, Warp, Alacritty with tabs, etc.). If it does, use AskUserQuestion to follow up:

**Question:** "Your terminal ({detected terminal}) supports tabs. Want each delamain in its own tab?"

**Options:**
- "Yes, use tabs" — Open a new tab per delamain
- "No, use separate windows" — Open a new window per delamain

Store the answer. The actual window/tab creation happens in step 4.

#### If "Detect my runtime"

Goal: discover whatever multiplexer or orchestrator the operator is using, inspect its structure, and find the best place to run delamains — without hardcoding any session or window names.

**Step A — Detect multiplexer:**

```
Bash(command: "echo TMUX=$TMUX; echo ZELLIJ=$ZELLIJ; echo TERM_PROGRAM=$TERM_PROGRAM; which tmux zellij 2>/dev/null")
```

**Step B — Inspect structure (tmux example, adapt for others):**

If tmux is detected, map out the full session topology:

```
Bash(command: "tmux list-sessions -F '#{session_name}' && tmux list-windows -a -F '#{session_name}/#{window_index}:#{window_name} (#{window_panes} panes)'")
```

This gives you every session, every window name, and pane counts. Study the output.

**Design principle:** The operator's current pane is the orchestrator cockpit. It must stay clean. Delamains run **out of sight** — in separate windows or tabs that the operator can switch to if they want, but never cluttering the current view. Never suggest split panes in the current window.

**Step C — Find the right target:**

Look at the window names and structure. You're looking for:
- Windows whose name suggests background processes, services, daemons, or monitoring (e.g. names containing "daemon", "bg", "services", "monitor", or similar)
- The current window (where Claude Code is running) — note it so you NEVER suggest running delamains here

**Step D — Suggest placement:**

Present what you found to the operator. Use AskUserQuestion with dynamically built options based on the actual structure. Example pattern:

**Question:** "Found tmux session '{session}' with these windows: {list}. Where should delamains run?"

Build options from what you discovered:
- If you found a window that looks purpose-built for background processes: suggest it as the recommended option (e.g. "Run in '{window_name}' window — looks like it's built for this")
- Always offer "Create a new tmux window" as a fallback
- If the operator has multiple sessions, ask which session first

The key: you are reading the operator's environment and making an intelligent suggestion. Don't just list raw data — interpret it and recommend.

**If zellij detected:** use `zellij action list-tabs` or equivalent to inspect layout, then follow the same pattern — find a tab that looks right, suggest it. Same principle: never add panes to the current tab.

**If no multiplexer detected:** fall back to the "Other terminal windows" flow above.

#### If "Use /bootup for dispatchers"

Run `/als:bootup` to start dispatchers. `/bootup` scans the current runtime environment directly and no longer depends on `.als/bootup.md`.

### 2. Register delamain roots (statusline only)

**Skip this step if the operator did NOT choose "Claude Code statusline" in step 1.**

Write the reference-system path to `.claude/delamain-roots` so the statusline can discover its delamains:

```
Bash(command: "echo '{skill-dir}/../../reference-system' >> .claude/delamain-roots")
```

### 3. Inject demo-mode overrides

Run the injection script to add demo-mode instructions to all delamain agent files. This makes agents sleep 5 seconds and advance instead of doing real work.

```
Bash(command: "ALS_SYSTEM_ROOT={skill-dir}/../../reference-system bash {skill-dir}/inject-demo-mode.sh")
```

### 4. Start traffic generators and dispatchers

First, install all dependencies:

```
Bash(command: "cd {skill-dir}/dispatcher && bun install --silent 2>/dev/null")
Bash(command: "cd {skill-dir}/../../reference-system/.claude/delamains/development-pipeline/dispatcher && bun install --silent 2>/dev/null")
Bash(command: "cd {skill-dir}/../../reference-system/.claude/delamains/incident-lifecycle/dispatcher && bun install --silent 2>/dev/null")
Bash(command: "cd {skill-dir}/../../reference-system/.claude/delamains/postmortem-lifecycle/dispatcher && bun install --silent 2>/dev/null")
Bash(command: "cd {skill-dir}/../../reference-system/.claude/delamains/release-lifecycle/dispatcher && bun install --silent 2>/dev/null")
Bash(command: "cd {skill-dir}/../../reference-system/.claude/delamains/run-lifecycle/dispatcher && bun install --silent 2>/dev/null")
```

#### Traffic generators — exact commands

These are the 5 traffic generators. Each maps a module path to its delamain. **Use these exact module/delamain paths — do not guess.**

| # | Module/Delamain | Command |
|---|-----------------|---------|
| 1 | `factory/development-pipeline` | `cd {skill-dir}/dispatcher && ALS_SYSTEM_ROOT={skill-dir}/../../reference-system bun run src/index.ts factory/development-pipeline` |
| 2 | `incident-response/incident-lifecycle` | `cd {skill-dir}/dispatcher && ALS_SYSTEM_ROOT={skill-dir}/../../reference-system bun run src/index.ts incident-response/incident-lifecycle` |
| 3 | `postmortems/postmortem-lifecycle` | `cd {skill-dir}/dispatcher && ALS_SYSTEM_ROOT={skill-dir}/../../reference-system bun run src/index.ts postmortems/postmortem-lifecycle` |
| 4 | `infra/release-lifecycle` | `cd {skill-dir}/dispatcher && ALS_SYSTEM_ROOT={skill-dir}/../../reference-system bun run src/index.ts infra/release-lifecycle` |
| 5 | `experiments/run-lifecycle` | `cd {skill-dir}/dispatcher && ALS_SYSTEM_ROOT={skill-dir}/../../reference-system bun run src/index.ts experiments/run-lifecycle` |

#### Dispatchers — exact commands

These are the 5 dispatchers. Each runs from its delamain's dispatcher directory.

| # | Delamain | Command |
|---|----------|---------|
| 1 | development-pipeline | `cd {skill-dir}/../../reference-system/.claude/delamains/development-pipeline/dispatcher && bun run src/index.ts` |
| 2 | incident-lifecycle | `cd {skill-dir}/../../reference-system/.claude/delamains/incident-lifecycle/dispatcher && bun run src/index.ts` |
| 3 | postmortem-lifecycle | `cd {skill-dir}/../../reference-system/.claude/delamains/postmortem-lifecycle/dispatcher && bun run src/index.ts` |
| 4 | release-lifecycle | `cd {skill-dir}/../../reference-system/.claude/delamains/release-lifecycle/dispatcher && bun run src/index.ts` |
| 5 | run-lifecycle | `cd {skill-dir}/../../reference-system/.claude/delamains/run-lifecycle/dispatcher && bun run src/index.ts` |

#### How to start them

Depends on the operator's choice in step 1:

**If "Claude Code statusline (buggy)":**
- Start all 10 processes as `Bash(run_in_background: true)` calls — all generators first, then all dispatchers after ~5 seconds

**If tmux (from "Detect my runtime" or "Other terminal windows"):**

Create 2 daemon windows for the target tmux session, then start processes via `tmux send-keys`. **Critical: do NOT use bash arrays or loops — issue each command explicitly to avoid variable expansion bugs.**

Step A — Create 2 windows (adapt the creation method to the operator's environment):

```
Bash(command: "tmux new-window -d -t {session} -n traffic-generators -c {skill-dir}/dispatcher")
Bash(command: "tmux new-window -d -t {session} -n demo-delamains -c {skill-dir}/../../reference-system")
```

Step B — Get the main pane ID for traffic-generators:

```
Bash(command: "tmux list-panes -t {session}:{traffic-generators-index} -F '#{pane_id}' | head -1")
```

Step C — Start all 5 generators. Send the first to the existing pane, then split for each additional one. **Each is its own Bash call — never combine into arrays or loops:**

```
Bash(command: "tmux send-keys -t {PANE} 'ALS_SYSTEM_ROOT={skill-dir}/../../reference-system bun run src/index.ts factory/development-pipeline' Enter")
Bash(command: "tmux split-window -v -t {session}:{traffic-generators-index} -c {skill-dir}/dispatcher")
Bash(command: "tmux send-keys -t {session}:{traffic-generators-index}.{last} 'ALS_SYSTEM_ROOT={skill-dir}/../../reference-system bun run src/index.ts incident-response/incident-lifecycle' Enter")
Bash(command: "tmux select-layout -t {session}:{traffic-generators-index} even-vertical")
```

Repeat the split → send-keys → select-layout pattern for:
- `postmortems/postmortem-lifecycle`
- `infra/release-lifecycle`
- `experiments/run-lifecycle`

Step D — Wait ~5 seconds for generators to seed initial items.

Step E — Get the main pane ID for demo-delamains and start all 5 dispatchers using the same explicit split pattern. **Always use the full absolute path in the cd command — never relative — because the split pane may start from the window's cwd, not the dispatcher directory:**

```
Bash(command: "tmux send-keys -t {PANE} 'cd {skill-dir}/../../reference-system/.claude/delamains/development-pipeline/dispatcher && bun run src/index.ts' Enter")
Bash(command: "D2=$(tmux split-window -v -t {session}:{window} -c {skill-dir}/../../reference-system -P -F '#{pane_id}') && tmux send-keys -t $D2 'cd {skill-dir}/../../reference-system/.claude/delamains/incident-lifecycle/dispatcher && bun run src/index.ts' Enter && tmux select-layout -t {session}:{window} even-vertical")
```

Repeat for each remaining dispatcher, always with the full absolute path:
- `postmortem-lifecycle`
- `release-lifecycle`
- `run-lifecycle`

**Important tmux rules:**
- After each `split-window`, the new pane is automatically the active pane — send-keys to `{session}:{window}.{last}` or capture the pane ID from split-window output with `-P -F '#{pane_id}'`
- Run `tmux select-layout even-vertical` after each split to keep panes readable
- Never use bash arrays with `tmux send-keys` — `${ARR[0]}` silently expands empty in compound commands

### 5. Configure statusline and start daemon (statusline only)

**Skip this entire step if the operator did NOT choose "Claude Code statusline" in step 1.**

Install the statusline and start the data collection daemon:

```
Skill(skill: "als:configure-statusline")
```

Then start the statusline daemon as a background process. The daemon collects delamain badge state, git branch, and OBS status every 3 seconds, writing to cache files. The statusline script becomes a pure reader (~5ms) that never gets cancelled by Claude Code's debounce:

```
Bash(command: "bash .claude/scripts/statusline-daemon.sh '$(pwd)' &", run_in_background: true)
```

Wait ~3 seconds for the daemon to complete its first data collection cycle, then the statusline will show badges on the next turn.

### 6. Verify dispatchers

Verify all 5 dispatchers are running:

```
Bash(command: "sleep 3 && for sf in {skill-dir}/../../reference-system/.claude/delamains/*/status.json; do [ -f \"$sf\" ] && echo \"=== $(jq -r .name \"$sf\") ===\" && jq '{name, pid, items_scanned, active_dispatches}' \"$sf\"; done")
```

### 7. Report

Tell the operator:
- 5 delamains running: development-pipeline, incident-lifecycle, postmortem-lifecycle, release-lifecycle, run-lifecycle
- 5 traffic generators running continuously
- Where everything is running (based on step 1 choice — which windows/tabs/tmux windows)
- If statusline was chosen: "Statusline daemon running (updates badges every 3s)"
- They can watch items flow via module operator consoles (e.g., `/factory-operate`)
- To stop: close the daemon windows or end the Claude session

## Notes

- Demo items are real ALS records — they flow through the full state machine identically to production items.
- The traffic generator uses sonnet model with a $1.00 budget cap per seed (assumes subscription usage).
- Each delamain gets its own dedicated generator process for true parallelism.
- To watch the demo in action, open the module operator console in another pane.
- The generator logs each seed to stdout: `[run-demo] #N seeding module/delamain: "title"`
