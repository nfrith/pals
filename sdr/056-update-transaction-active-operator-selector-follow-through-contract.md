# Update Transaction Active Operator Selector Follow-Through Contract

## Status

Proposed

## Context

- SDR 039 makes `/update` the owner of the staged commit, live writeback, and post-commit lifecycle flow.
- SDR 054 makes the `v4 -> v5` operator-config migration a split contract: the recipe writes tracked roster files, while `.als/local/active-operator.json` remains machine-local follow-through after commit.
- ALS-107 showed that `/update` currently returns `manual_follow_up_note: null` even when the roster landed and the local selector is still missing.
- SDR 055 makes that missing selector a fail-closed runtime condition for delamains with `requires_active_operator: strict`, so a silent `/update` success misattributes the later failure as local drift instead of half-complete migration.
- The existing `/update` and `/upgrade-language` skills already document the singleton helper step, but skill prose alone is not a durable transaction postcondition.

## Decision

- `/update` owns the live-machine active-operator selector postcondition for the `v4 -> v5` operator-config migration after the staged commit is written back to the live repo.
- After writeback, when the committed live system has a valid authored operator roster and the machine-local selector is missing, the wrapper inspects live operator-config state before it reports final success.
- If the live roster has exactly one valid entry, the wrapper writes `.als/local/active-operator.json` itself by calling the compiler-owned singleton-selection helper. A singleton system does not receive a manual follow-up note for a condition the transaction can repair autonomously.
- If the selector cannot be landed autonomously because the roster has zero or multiple entries, the roster is invalid, or the helper fails, the execute result returns a non-null `manual_follow_up_note`.
- For ALS-107, `manual_follow_up_note` remains `string | null`. Orchestrators treat non-null as mandatory verbatim follow-through text, not as optional flavor text and not as a machine-parsed schema.
- When multiple follow-ups exist, the wrapper composes them into one string using blank-line-separated paragraphs. Each paragraph must name the affected surface, the exact action or command, and the consequence of skipping it.
- The operator-selector follow-up paragraph must name the missing selector, the live-machine consequence, and the appropriate compiler command: `operator-config select-singleton` when singleton auto-resolution is applicable, otherwise `operator-config set-active <operator-id>` when the operator must choose.
- This decision refines SDR 039 and SDR 054 without moving machine-local selector writes into language-upgrade recipe execution and without changing authored ALS syntax or versioning.

## Normative Effect

- Required: after a `v4 -> v5` `/update` run lands a committed roster, the wrapper self-heals a missing selector before returning `status: "completed"` when the live roster has exactly one valid entry.
- Required: if the selector is still unresolved after that wrapper-owned follow-through, the execute result returns a non-null `manual_follow_up_note`.
- Required: the operator-selector follow-up note states the missing-selector condition, the exact command to run, whether explicit operator choice is required, and the `requires_active_operator: strict` consequence of leaving the selector missing.
- Required: the language-upgrade recipe continues to own only the tracked roster migration files; machine-local selector writes stay outside staged recipe execution.
- Allowed: `manual_follow_up_note` to remain `null` when singleton self-heal succeeded and no other follow-up remains.
- Allowed: the wrapper to compose the operator-selector note with the existing statusline note as blank-line-separated paragraphs in one string.
- Rejected: a successful execute result with a committed roster present, a missing selector, and `manual_follow_up_note: null`.
- Rejected: pushing local-selector truth into recipe postconditions that run only inside the staging worktree.
- Rejected: relying on skill orchestration alone to remember the operator-selector follow-through.

## Compiler Impact

- Update `alsc/update-transaction/src/index.ts` so post-writeback success inspection calls compiler operator-config helpers against the live system root, not the staging tree.
- Extend execute-result assembly so `manual_follow_up_note` can be composed from the existing statusline follow-up plus the new operator-selector follow-up.
- Reuse `inspectOperatorConfig()`, `selectSingletonActiveOperator()`, and `writeActiveOperatorSelection()` semantics from `alsc/compiler/src/operator-config.ts`; do not duplicate roster parsing or selector validation inside the wrapper.
- Keep `alsc/update-transaction/src/cli.ts` a thin adapter unless the JSON result text or error plumbing requires an explicit update.
- Add regression coverage in `alsc/update-transaction/test/engine.test.ts` for singleton self-heal, multi-operator follow-up, invalid-roster follow-up, and coexistence with statusline follow-up text.

## Docs and Fixture Impact

- `skills/update/SKILL.md` and `skills/upgrade-language/SKILL.md` must point their operator-config follow-through step back to this SDR once accepted.
- `skills/docs/references/language-upgrades.md` and `skills/docs/references/operator-config.md` must describe the split correctly: tracked roster files commit in the recipe, machine-local selector follow-through completes in the wrapper.
- Add or update fixture material showing singleton `v4 -> v5` execute success with selector present post-run and `manual_follow_up_note: null`.
- Add or update fixture material showing multi-operator execute success with selector still missing and a non-null follow-up note naming `operator-config set-active`.
- Add or update fixture material showing operator-selector follow-up text composed with the existing statusline follow-up note.
- Keep the multi-operator path synthetic or otherwise explicitly non-canonical if canonical v4 input cannot naturally produce a multi-entry roster.

## Alternatives Considered

- Report-only wrapper: detect the missing selector but always return a note and leave all helper invocation to the orchestrator.
- Rejected because the easy singleton case would still depend on operator or agent discipline even though the wrapper already owns post-writeback live-machine follow-through.

- Structured follow-up records in place of `string | null`.
- Rejected for ALS-107 because it broadens the transaction contract beyond the narrow honesty defect. If more follow-up surfaces accumulate, that generalization can be a separate job.

- Recipe-owned or named language-upgrade postcondition for the local selector.
- Rejected because the selector is intentionally machine-local gitignored state and cannot be truthfully satisfied inside the staged recipe execution surface.

## Non-Goals

- Redesigning `manual_follow_up_note` into a general-purpose workflow engine.
- Changing the authored operator roster or active-operator selector file shapes from SDR 054.
- Altering SDR 055's fail-closed runtime behavior for missing selectors.
- Merging this defect with ALS-106's lifecycle-failure work.
