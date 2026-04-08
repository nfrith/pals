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

### 1. Configure statusline

The statusline is critical to the demo — without it the operator has no way to see delamains running and the demo will make no visual sense.

Use AskUserQuestion to ask:

**Question:** "The demo needs the ALS statusline to show delamain health badges — without it you won't be able to see what's happening. This is temporary and will be undone by /reset-demo. Install it?"

**Options:**
- "Yes, install for demo" — Install the statusline temporarily
- "No, skip statusline" — Run the demo without visual feedback

If yes, invoke configure-statusline:

```
Skill(skill: "als:configure-statusline")
```

If no, warn the operator that they won't have visual feedback of the demo running, then proceed anyway.

### 2. Inject demo-mode overrides

Run the injection script to add demo-mode instructions to all delamain agent files. This makes agents sleep 5 seconds and advance instead of doing real work.

```
Bash(command: "ALS_SYSTEM_ROOT={skill-dir}/../../reference-system bash {skill-dir}/inject-demo-mode.sh")
```

### 3. Start the traffic generators

Start one background shell per delamain — true process-level parallelism. The traffic generator accepts a `module/delamain` argument to filter to a single delamain.

First, install dependencies:

```
Bash(command: "cd {skill-dir}/dispatcher && bun install --silent 2>/dev/null")
```

Then start all 5 generators in parallel (one `Bash(run_in_background: true)` call per delamain, all in a single message):

```
Bash(command: "cd {skill-dir}/dispatcher && ALS_SYSTEM_ROOT={skill-dir}/../../reference-system bun run src/index.ts experiments/run-lifecycle", run_in_background: true)
Bash(command: "cd {skill-dir}/dispatcher && ALS_SYSTEM_ROOT={skill-dir}/../../reference-system bun run src/index.ts factory/development-pipeline", run_in_background: true)
Bash(command: "cd {skill-dir}/dispatcher && ALS_SYSTEM_ROOT={skill-dir}/../../reference-system bun run src/index.ts incident-response/incident-lifecycle", run_in_background: true)
Bash(command: "cd {skill-dir}/dispatcher && ALS_SYSTEM_ROOT={skill-dir}/../../reference-system bun run src/index.ts postmortems/postmortem-lifecycle", run_in_background: true)
Bash(command: "cd {skill-dir}/dispatcher && ALS_SYSTEM_ROOT={skill-dir}/../../reference-system bun run src/index.ts infra/release-lifecycle", run_in_background: true)
```

Wait ~5 seconds for the generators to start, then proceed.

### 4. Start dispatchers

Invoke the `als:run-delamains` skill to start all dispatchers. **Important:** after the skill loads, ensure it ONLY starts dispatchers from the reference-system (`{skill-dir}/../../reference-system`). The operator may have their own ALS system in the current directory — the demo must not touch it. Only reference-system delamains should be started.

```
Skill(skill: "als:run-delamains")
```

Every dispatcher will find items waiting on its first scan.

### 5. Report

Tell the operator:
- How many delamains were discovered
- That 5 traffic generators are running continuously in the background
- They can watch items flow via module operator consoles (e.g., `/factory-operate`)
- The generators stop when the Claude session ends

## Notes

- Demo items are real ALS records — they flow through the full state machine identically to production items.
- The traffic generator uses sonnet model with a $1.00 budget cap per seed (assumes subscription usage).
- Each delamain gets its own dedicated generator process for true parallelism.
- To watch the demo in action, open the module operator console in another pane.
- The generator logs each seed to stdout: `[run-demo] #N seeding module/delamain: "title"`
