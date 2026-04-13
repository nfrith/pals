---
name: bootup
description: Boot an ALS system — start delamain dispatchers and runtime services using operator-configured preferences or interactive setup.
allowed-tools: Bash(bash *)
---

# bootup

Boot an ALS system's runtime services. Reads the operator's boot configuration if one exists, otherwise guides interactive setup.

For the `.als/config.md` format specification, see [`../docs/references/bootup-config.md`](../docs/references/bootup-config.md).

## Scan results

<bash>bash ${CLAUDE_PLUGIN_ROOT}/skills/bootup/scan.sh</bash>

## Procedure

### Step 1 — Check for boot configuration

Parse the scan results above.

**If `CONFIG: found`:**
- Read the `Operator's Preferences` section from the scan output
- These are the operator's instructions for how to start delamains
- Proceed to Step 2 using those instructions

**If `CONFIG: none`:**
- No boot configuration exists yet
- Tell the operator: "No boot config found. Run `/init` to set one up."
- Exit.

### Step 2 — Start offline delamains per operator preferences

If the scan shows `All dispatchers are running. Nothing to do.` — report this and exit.

Otherwise, for each delamain listed in `OFFLINE_DELAMAINS`:

1. Read the operator's preferences to determine HOW to start the dispatcher
2. Ensure `bun install` has been run in the dispatcher directory before starting
3. Follow the operator's config commands **exactly as written** — copy-paste, substitute names, execute. Do not improvise alternative approaches.
4. Start all offline dispatchers in parallel when possible

After starting, verify with:

```bash
sleep 3 && for sf in {system-root}/.claude/delamains/*/status.json; do [ -f "$sf" ] && echo "=== $(jq -r .name "$sf") ===" && jq '{name, pid, items_scanned, active_dispatches}' "$sf"; done
```

Report results to the operator in a single table.

## Notes

- This skill replaces the former `/run-delamains`
- When Claude exits, dispatchers started as Claude background shells die. Dispatchers started in tmux windows survive.
- If all dispatchers are already running, nothing to do.
- The boot configuration is operator-local — it is not managed by `/change` or `/migrate`.
- If no config exists, use `/init` to create one first.
- **This skill must be run from the operator's session** (e.g., [OPERATOR] window), not from the cyber-brain or other Agent SDK processes. The Agent SDK cleans up tmux windows created during its query — dispatchers will die when the brain's turn ends. If the brain needs delamains started, it should message the operator to run `/bootup`.
