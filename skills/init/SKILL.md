---
name: init
description: Create the ALS boot configuration — interactive setup that detects the runtime environment and writes .als/bootup.md with operator preferences for how delamains should start.
allowed-tools: Bash(bash *)
---

# init

Create the ALS boot configuration for a system. Detects the runtime environment and walks the operator through setting up `.als/bootup.md` — the file that `/bootup` reads to know how to start delamains.

For the `.als/bootup.md` format specification, see [`../docs/references/bootup-config.md`](../docs/references/bootup-config.md).

## When to use

- First time setting up an ALS system (no `.als/bootup.md` exists)
- Operator wants to reconfigure how delamains start
- Runtime environment changed (new terminal, new multiplexer)

## Procedure

### Step 1 — Check for existing config

```bash
if [ -f .als/bootup.md ]; then
  echo "CONFIG: exists"
else
  echo "CONFIG: none"
fi
```

**If config exists:** Tell the operator and ask if they want to reconfigure or keep the existing config. If they want to keep it, exit — they should use `/bootup` instead.

### Step 2 — Interactive setup

Present the operator with a setup survey using AskUserQuestion:

**Header**: `Boot Config`

**Question**: "How would you like delamains to be started?"

**Options**:
1. **Choose best for me** (Recommended) — Inspect the runtime environment (terminal multiplexer, shell, process manager) and generate a `.als/bootup.md` with sensible defaults.
2. **Let me describe my setup** — Walk the operator through creating `.als/bootup.md` interactively.

#### Option 1: Choose best for me

1. Detect the runtime environment:
   - Is a terminal multiplexer running? (tmux, zellij, screen)
   - Are there custom tmux sockets or sessions? (e.g., named sessions for workspace management)
   - What shell is the operator using?
   - Is there an existing window/pane management convention?
2. Generate `.als/bootup.md` with detected preferences:
   - If terminal multiplexer detected: use dedicated windows/panes with `{module}-delamain-{name}` naming
   - If no multiplexer: use Claude background shells (legacy behavior)
3. Show the generated config to the operator for confirmation
4. Write `.als/bootup.md`

#### Option 2: Let me describe my setup

1. Ask the operator how they want delamains started (AskUserQuestion with environment-specific options)
2. Ask about naming conventions
3. Generate `.als/bootup.md` from their answers
4. Show it for confirmation, write it

### Step 3 — Confirm

Tell the operator the config is written and they can now use `/bootup` to start delamains.

## Notes

- The boot configuration is operator-local — it is not managed by `/change` or `/migrate`.
- This skill only creates the config. Starting delamains is `/bootup`'s job.
- Running `/init` when a config already exists is safe — it asks before overwriting.
