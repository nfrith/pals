# ALS Validation Hooks

The `als-validate.sh` and `als-stop-gate.sh` hooks resolve the compiler path via `${CLAUDE_PLUGIN_ROOT}`:

```
${CLAUDE_PLUGIN_ROOT}/alsc/compiler
```

This requires ALS to be installed as a Claude Code plugin so that `CLAUDE_PLUGIN_ROOT` is set by the runtime.

## What the hooks do

- **als-validate.sh** (PostToolUse) — after Write/Edit operations, validates the affected module and blocks further edits if validation fails.
- **als-stop-gate.sh** (Stop) — before Claude finishes, validates all ALS systems under `$PWD` and blocks stop if any system has errors.

## Requirements

- Bun must be installed and on `$PATH`.
- The plugin must be loaded so `CLAUDE_PLUGIN_ROOT` resolves.
