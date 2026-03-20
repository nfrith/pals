# ALS Validation Hook — Deployment Constraint

The `als-validate.sh` hook has a **hardcoded compiler path**:

```
/Users/0xnfrith/nfrith/pals-v0/v1/alsc/compiler
```

This means the hook only works on machines where the pals-v0 repo is checked out at that exact path. This is intentional for now — ALS is in active development and not distributed yet.

## What this affects

- The hook works in pals-v0 directly (development)
- The hook works in `~/worktrees/main` (PRD agent base) because it's on the same machine
- The hook will NOT work on other machines or in CI without updating the compiler path

## When to revisit

When ALS ships externally (target: ~2 weeks from 2026-03-20), this hardcoded path must be replaced with one of:
- A globally installed `alsc` binary (preferred)
- A path resolved from `$CLAUDE_PLUGIN_ROOT` (if the compiler is bundled with the plugin)
- An environment variable for the compiler location
