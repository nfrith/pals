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

### 1. Ask about statusline

The statusline is critical to the demo — without it the operator has no way to see delamains running. Ask upfront so the operator knows it's coming, but DON'T install it yet — installation happens in step 5, AFTER all shells are running.

Use AskUserQuestion to ask:

**Question:** "The demo needs the ALS statusline to show delamain health badges — without it you won't be able to see what's happening. This is temporary and will be undone by /reset-demo. Install it?"

**Options:**
- "Yes, install for demo" — Install the statusline (after dispatchers are up)
- "No, skip statusline" — Run the demo without visual feedback

Store the answer and proceed either way.

### 2. Register delamain roots

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

Start one background shell per delamain for both generators and dispatchers.

First, install dependencies:

```
Bash(command: "cd {skill-dir}/dispatcher && bun install --silent 2>/dev/null")
```

**Pre-warm the statusline cache before generator burst (TECH DEBT — see statusline CLAUDE.md):**
The statusline render cache may be stale (>30s since session start). Pre-warm it RIGHT before
launching shells so rapid-fire invocations during the burst hit the cached path (~12ms) instead
of the cold scan (~73ms). This must run immediately before the background shell launches.

```
Bash(command: "echo '{\"workspace\":{\"current_dir\":\"'$(pwd)'\"},\"model\":{\"display_name\":\"warm\"},\"context_window\":{\"used_percentage\":0}}' | bash .claude/scripts/statusline.sh > /dev/null 2>&1 && echo 'cache warmed (pre-generators)'")
```

Then start all 5 generators in parallel (one `Bash(run_in_background: true)` call per delamain, all in a single message):

```
Bash(command: "cd {skill-dir}/dispatcher && ALS_SYSTEM_ROOT={skill-dir}/../../reference-system bun run src/index.ts experiments/run-lifecycle", run_in_background: true)
Bash(command: "cd {skill-dir}/dispatcher && ALS_SYSTEM_ROOT={skill-dir}/../../reference-system bun run src/index.ts factory/development-pipeline", run_in_background: true)
Bash(command: "cd {skill-dir}/dispatcher && ALS_SYSTEM_ROOT={skill-dir}/../../reference-system bun run src/index.ts incident-response/incident-lifecycle", run_in_background: true)
Bash(command: "cd {skill-dir}/dispatcher && ALS_SYSTEM_ROOT={skill-dir}/../../reference-system bun run src/index.ts postmortems/postmortem-lifecycle", run_in_background: true)
Bash(command: "cd {skill-dir}/dispatcher && ALS_SYSTEM_ROOT={skill-dir}/../../reference-system bun run src/index.ts infra/release-lifecycle", run_in_background: true)
```

Wait ~5 seconds for the generators to seed initial items.

**Pre-warm again before dispatcher burst:**
The 5 generator launches took ~5-10s. Pre-warm again to reset the 30s cache window before the next burst.

```
Bash(command: "echo '{\"workspace\":{\"current_dir\":\"'$(pwd)'\"},\"model\":{\"display_name\":\"warm\"},\"context_window\":{\"used_percentage\":0}}' | bash .claude/scripts/statusline.sh > /dev/null 2>&1 && echo 'cache warmed (pre-dispatchers)'")
```

Then start all 5 dispatchers in parallel from the reference-system ONLY (not Ghost's own delamains):

```
Bash(command: "cd {skill-dir}/../../reference-system/.claude/delamains/development-pipeline/dispatcher && bun install --silent 2>/dev/null && bun run src/index.ts", run_in_background: true)
Bash(command: "cd {skill-dir}/../../reference-system/.claude/delamains/incident-lifecycle/dispatcher && bun install --silent 2>/dev/null && bun run src/index.ts", run_in_background: true)
Bash(command: "cd {skill-dir}/../../reference-system/.claude/delamains/postmortem-lifecycle/dispatcher && bun install --silent 2>/dev/null && bun run src/index.ts", run_in_background: true)
Bash(command: "cd {skill-dir}/../../reference-system/.claude/delamains/release-lifecycle/dispatcher && bun install --silent 2>/dev/null && bun run src/index.ts", run_in_background: true)
Bash(command: "cd {skill-dir}/../../reference-system/.claude/delamains/run-lifecycle/dispatcher && bun install --silent 2>/dev/null && bun run src/index.ts", run_in_background: true)
```

Wait ~5 seconds for dispatchers to start and scan their first items.

### 5. Configure statusline (AFTER shells are running)

If the operator said yes in step 1, NOW install the statusline. Installing AFTER all shells are running avoids the debounce problem: rapid-fire statusline updates during shell launches can cancel the script and disable it for the session. With everything already running, the shell burst is over and the statusline renders cleanly.

```
Skill(skill: "als:configure-statusline")
```

Then pre-warm the statusline cache so it's ready on the next turn:

```
Bash(command: "echo '{\"workspace\":{\"current_dir\":\"'$(pwd)'\"},\"model\":{\"display_name\":\"warm\"},\"context_window\":{\"used_percentage\":0}}' | bash .claude/scripts/statusline.sh > /dev/null 2>&1 && echo 'statusline cache warmed'")
```

If the operator said no, warn them they won't have visual feedback, then proceed anyway.

### 6. Verify dispatchers

Verify all 5 reference-system dispatchers are running:

```
Bash(command: "sleep 3 && for sf in {skill-dir}/../../reference-system/.claude/delamains/*/status.json; do [ -f \"$sf\" ] && echo \"=== $(jq -r .name \"$sf\") ===\" && jq '{name, pid, items_scanned, active_dispatches}' \"$sf\"; done")
```

### 7. Report

Tell the operator:
- 5 delamains discovered and dispatching
- 5 traffic generators running continuously in the background
- Badges visible in the statusline showing live delamain health
- They can watch items flow via module operator consoles (e.g., `/factory-operate`)
- Everything stops when the Claude session ends

## Notes

- Demo items are real ALS records — they flow through the full state machine identically to production items.
- The traffic generator uses sonnet model with a $1.00 budget cap per seed (assumes subscription usage).
- Each delamain gets its own dedicated generator process for true parallelism.
- To watch the demo in action, open the module operator console in another pane.
- The generator logs each seed to stdout: `[run-demo] #N seeding module/delamain: "title"`
