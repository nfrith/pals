# ALS Hooks

All hooks resolve the compiler path via `${CLAUDE_PLUGIN_ROOT}/alsc/compiler`.

## Hook inventory

### operator-config-session-start.sh (SessionStart)

On session start, walks up from the reported `cwd`, finds the current ALS system root, resolves `<system_root>/.als/operator.md`, validates it, and injects one `<system-reminder>` block with stable operator identity/business context. If no ALS system root is found, if the current ALS system contains `.als/skip-operator-config`, or if the config file is missing, it injects nothing. If the config is invalid, it injects remediation instructions telling the operator to run `/configure-operator`.

### als-validate.sh (PostToolUse — Write|Edit)

After Write/Edit operations, validates the affected module and blocks further edits if validation fails. This is the inline feedback loop — it catches errors immediately.

Silent on clean success. Warn-only validation stays non-blocking but emits immediate context so deprecated-value usage is visible during the edit loop. On failure, outputs a structured JSON block decision with compiler diagnostics.

### als-breadcrumb.sh (PostToolUse — Write|Edit)

After Write/Edit operations, records which ALS system and module were touched to a session-scoped breadcrumb file at `/tmp/als-touched-${session_id}`. Does not run the compiler. Does not block.

This hook exists so the stop gate knows what to validate without scanning the whole filesystem.

TODO: Does not capture Bash-based file mutations (e.g. `echo ... > file.md`).

### als-stop-gate.sh (Stop)

Before Claude finishes, reads the breadcrumb file for this session. If ALS systems/modules were touched, validates only those. Blocks stop if any have errors.

Warn-only results never block stop, but the hook emits a final reminder summary when the touched system/module still carries warnings. If no breadcrumb file exists (session didn't touch ALS files), exits immediately — no validation, no blocking.

Written for bash 3.2 compatibility (macOS default). No associative arrays.

### delamain-stop.sh (SessionEnd)

On session end, kills running delamain dispatchers and removes their heartbeat files (`status.json`). Skips cleanup when reason is `clear` or `resume` — dispatchers survive those transitions.

The hook also appends one JSONL entry to `{SYSTEM_ROOT}/.claude/scripts/.cache/pulse/sessionend.log` for every invocation, including skipped `clear` / `resume` exits. When pulse is running, the hook records the target PID before attempting the SessionEnd reap signal. Pulse uses that breadcrumb plus its own `shutdown.log` entries to diagnose whether a shutdown came from the hook path or from its parent shell.

Dispatchers live and die with their Claude session. On next session start, `delamain-start.sh` detects them as offline and suggests restarting.

## Environment variables

### `ALS_DEMO_MODE`

When set to `"1"`, `als-validate.sh` and `als-stop-gate.sh` skip all validation. Used by the reference-system [`/run-demo`](../reference-system/.claude/skills/run-demo/SKILL.md) traffic generators so seed agents can write items without triggering the compiler on every write.

## Requirements

- Bun must be installed and on `$PATH`.
- jq must be installed and on `$PATH`.
- The plugin must be loaded so `CLAUDE_PLUGIN_ROOT` resolves.
