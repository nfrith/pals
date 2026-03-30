# ALS Hooks

All hooks resolve the compiler path via `${CLAUDE_PLUGIN_ROOT}/alsc/compiler`.

## Hook inventory

### als-validate.sh (PostToolUse — Write|Edit)

After Write/Edit operations, validates the affected module and blocks further edits if validation fails. This is the inline feedback loop — it catches errors immediately.

### als-breadcrumb.sh (PostToolUse — Write|Edit)

After Write/Edit operations, records which ALS system and module were touched to a session-scoped breadcrumb file at `/tmp/als-touched-${session_id}`. Does not run the compiler. Does not block.

This hook exists so the stop gate knows what to validate without scanning the whole filesystem.

TODO: Does not capture Bash-based file mutations (e.g. `echo ... > file.md`).

### als-stop-gate.sh (Stop)

Before Claude finishes, reads the breadcrumb file for this session. If ALS systems/modules were touched, validates only those. Blocks stop if any have errors.

If no breadcrumb file exists (session didn't touch ALS files), exits immediately — no validation, no blocking.

## Requirements

- Bun must be installed and on `$PATH`.
- jq must be installed and on `$PATH`.
- The plugin must be loaded so `CLAUDE_PLUGIN_ROOT` resolves.
