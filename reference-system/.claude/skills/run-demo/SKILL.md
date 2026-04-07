---
name: run-demo
description: Reference-system demo runner. Seeds items via traffic generator, then starts dispatchers so all delamains have work immediately.
model: sonnet
allowed-tools: Bash(bash *), Skill
---

# run-demo

Demo runner for the reference-system. Injects demo-mode overrides into delamain agents, starts the traffic generator to build up items, then starts dispatchers — so every delamain has work from the moment it comes online.

## Procedure

### 1. Inject demo-mode overrides

Run the injection script to add demo-mode instructions to all delamain agent files. This makes agents sleep 5 seconds and advance instead of doing real work.

```
Bash(command: "{skill-dir}/inject-demo-mode.sh")
```

Where `{skill-dir}` is the absolute path to this skill's directory (the directory containing this SKILL.md).

### 2. Start the traffic generator

Run the traffic generator as a background shell **before** starting dispatchers. It runs one parallel seeder per delamain — all 5 seed concurrently.

```
Bash(command: "cd {skill-dir}/dispatcher && bun install --silent 2>/dev/null && bun run src/index.ts", run_in_background: true)
```

Wait ~5 seconds for the generator to start, then proceed.

### 3. Start dispatchers

Invoke the `als:run-delamains` skill to start all dispatchers:

```
Skill(skill: "als:run-delamains")
```

Every dispatcher will find items waiting on its first scan.

### 4. Report

Tell the operator:
- How many delamains were discovered
- That the traffic generator is running continuously in the background
- They can watch items flow via module operator consoles (e.g., `/factory-operate`)
- The generator stops when the Claude session ends

## Notes

- Demo items are real ALS records — they flow through the full state machine identically to production items.
- The traffic generator uses sonnet model with a $1.00 budget cap per seed (assumes subscription usage).
- The generator runs one parallel seeder per delamain — every delamain is always being fed.
- To watch the demo in action, open the module operator console in another pane.
- The generator logs each seed to stdout: `[run-demo] #N seeding module/delamain: "title"`
