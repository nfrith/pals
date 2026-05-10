# Final Report

End `/install` with a tight operator-facing summary.

Include:

- `Platform` — the acknowledged ALS platform code
- `Prerequisites` — whether `ALS_PLUGIN_ROOT`, `bun`, `jq`, and `git` were confirmed
- `System ID` — the `system_id` chosen in Phase 4
- `Created` — `.als/system.ts` and the empty `.als/modules/` directory
- `Validation` — result of `validate`
- `Deploy` — result of `deploy ${HARNESS} --dry-run --require-empty-targets` and the live `deploy ${HARNESS}` (produces `${SYSTEM_INSTRUCTION_PATH}` and an otherwise empty projection surface)
- `Next` — the Phase 9 outcome: which skill was invoked (`/foundry` or `/new`), or "stopped at skeleton"
- `Later` — commands the operator can reach for any time: `/new`, `/foundry`, `/change`, `/validate`

No module, skill, or delamain output belongs in this report — `/install` does not author any of those. If a downstream skill was invoked in Phase 7, its own output covers what it produced.
