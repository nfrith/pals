# ALS Hooks

All hooks resolve the compiler path via `${CLAUDE_PLUGIN_ROOT}/alsc/compiler`.

## Hook inventory

### als-validate.sh (PostToolUse — Write|Edit)

After Write/Edit operations, validates the affected module and blocks further edits if validation fails. This is the inline feedback loop — it catches errors immediately.

Silent on success (no stdout). On failure, outputs a structured JSON block decision with compiler diagnostics.

### als-breadcrumb.sh (PostToolUse — Write|Edit)

After Write/Edit operations, records which ALS system and module were touched to a session-scoped breadcrumb file at `/tmp/als-touched-${session_id}`. Does not run the compiler. Does not block.

This hook exists so the stop gate knows what to validate without scanning the whole filesystem.

TODO: Does not capture Bash-based file mutations (e.g. `echo ... > file.md`).

### als-stop-gate.sh (Stop)

Before Claude finishes, reads the breadcrumb file for this session. If ALS systems/modules were touched, validates only those. Blocks stop if any have errors.

If no breadcrumb file exists (session didn't touch ALS files), exits immediately — no validation, no blocking.

Written for bash 3.2 compatibility (macOS default). No associative arrays.

### delamain-start.sh (SessionStart)

On session start, scans `.claude/delamains/` for dispatchers. Reports which are running and which are offline. Claude acts on the output to start offline dispatchers as background shells via `Bash(run_in_background: true)`.

Silent when no delamains exist in the system.

### delamain-stop.sh (SessionEnd)

On session end, kills running delamain dispatchers and removes their heartbeat files (`status.json`). Skips cleanup when reason is `clear` or `resume` — dispatchers survive those transitions.

Dispatchers live and die with their Claude session. On next session start, `delamain-start.sh` detects them as offline and suggests restarting.

## Requirements

- Bun must be installed and on `$PATH`.
- jq must be installed and on `$PATH`.
- The plugin must be loaded so `CLAUDE_PLUGIN_ROOT` resolves.
