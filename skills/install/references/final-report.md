# Final Report

End `/install` with a tight operator-facing summary.

Include:

- `Platform` — the acknowledged ALS platform code
- `Prerequisites` — whether `CLAUDE_PLUGIN_ROOT`, `bun`, and `jq` were confirmed
- `Created` — `.als/authoring.ts`, `.als/system.ts`, `.als/modules/<module_id>/v1/...`, the mounted data directory, `.claude/skills/...`, and optional `.claude/delamains/...`
- `Validation` — result of `validate`
- `Deploy` — result of `deploy claude --dry-run --require-empty-targets` and live `deploy claude`
- `Next` — `/new` to add another module, `/change` to evolve the first module, `/validate` to re-check the system

If the install authored a Delamain:

- Say where the bundle lives under `.als/modules/<module_id>/v1/delamains/...`
- Say where it deployed under `.claude/delamains/...`
- Remind the operator if any agent files are TODO scaffolds
