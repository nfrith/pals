---
name: run-demo
description: Reference-system demo runner. Starts all delamain dispatchers, then runs a traffic generator that seeds random demo items via Agent SDK every 5 seconds.
model: sonnet
allowed-tools: Bash(bash *), Skill
---

# run-demo

Demo runner for the reference-system. Starts all delamain dispatchers, then runs a traffic generator that seeds random demo items into delamain initial states via Agent SDK on a 5-second loop.

## Purpose

Showcases the full ALS surface in motion:
- **Dispatchers** — background agents autonomously managing entity lifecycles
- **Agent SDK traffic** — autonomous agents creating work items that flow through state machines
- **End-to-end lifecycle** — from item creation through every agent-owned state to terminal

## Procedure

### 1. Start dispatchers

Invoke the `als:run-delamains` skill to start any offline dispatchers:

```
Skill(skill: "als:run-delamains")
```

Wait for it to complete. All delamain dispatchers must be running before seeding items.

### 2. Start the traffic generator

Run the demo dispatcher as a background shell:

```
Bash(command: "cd {skill-dir}/dispatcher && bun install --silent 2>/dev/null && bun run src/index.ts", run_in_background: true)
```

Where `{skill-dir}` is the absolute path to this skill's directory (the directory containing this SKILL.md).

The traffic generator:
- Auto-discovers all delamains from `system.yaml` → `shape.yaml` → `delamain.yaml`
- Every 5 seconds, picks a random delamain and seeds a demo item at its initial agent-owned state via Agent SDK (haiku)
- Each item gets a random realistic title and valid field values
- Runs until killed (Ctrl+C or Claude session exit)

### 3. Report

Tell the operator:
- How many delamains were discovered
- That the traffic generator is running in the background
- They can watch items flow via module operator consoles (e.g., `/factory-operate`)
- The generator stops when the Claude session ends

## Notes

- Demo items are real ALS records — they flow through the full state machine identically to production items.
- The traffic generator uses sonnet model with a $1.00 budget cap per seed (assumes subscription usage).
- To watch the demo in action, open the module operator console in another pane.
- The generator logs each seed to stdout: `[run-demo] #N seeding module/delamain: "title"`
