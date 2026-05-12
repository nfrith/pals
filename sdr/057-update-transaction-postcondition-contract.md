# Update Transaction Postcondition Contract

## Status

Accepted

## Context

- SDR 039 makes `/update` the owner of the staged worktree, one-commit writeback, and post-commit lifecycle flow, but its public execute surface is still effectively binary: `completed` or `failed`, plus `manual_follow_up_note: string | null`.
- ALS-106 and ALS-107 exposed the same defect shape on different hop classes. The structural transaction can do real work, leave a required follow-through gap, and still return a result that does not force the orchestrator to surface that gap honestly.
- The current `/update` skill text already documents several conditional checks, but every observed orchestrator the operator has watched has missed at least one. That is empirical proof that prose-only follow-through is not a durable contract.
- SDR 050 already moved language-hop truthfulness into wrapper-owned invariants when prepared intent diverged from executed truth. ALS-108 is the same move for postcondition truth after execution.
- SDR 056 proposes a narrow selector-specific fix for ALS-107. ALS-108 needs the systemic parent contract so selector follow-through, lifecycle proof, bundled refresh, and future warning surfaces do not each invent a different side channel.

## Decision

- `/update` gains a wrapper-owned structured `postconditions` ledger on execute results. It becomes the canonical machine-readable surface for post-execute truth.
- Each postcondition record carries stable `code`, `phase`, `status`, `severity`, `why`, and optional `command_to_run` and `operator_input_required` fields.
- Execute results become tri-state:
  - `completed` — structural work succeeded and no required unresolved postconditions remain.
  - `requires_postcondition_input` — structural work committed successfully, but at least one required postcondition now depends on operator choice or explicit manual follow-through.
  - `failed` — the transaction could not satisfy or verify a required wrapper-owned postcondition, or a normal failure surface occurred before that point.
- The wrapper auto-satisfies deterministic live-machine postconditions when it can prove safety. Example: the singleton active-operator selector case from ALS-107 should be repaired inside the wrapper, not delegated back to the orchestrator.
- Required correctness postconditions that the wrapper is expected to prove itself stay on the `failed` path when proof is missing. Example: dispatcher lifecycle success still requires fresh-process / new-plugin-root proof; that is not downgraded into an operator follow-up warning.
- Warning-only or advisory follow-through may coexist with `completed` when structural correctness is intact. Example: a statusline freshness note or a platform restart reminder can remain a warning row instead of escalating the whole transaction.
- `manual_follow_up_note` remains for backward compatibility, but only as a synthesized projection of the structured postcondition ledger. It is no longer an independent source of truth.
- The CLI must fail loudly for old orchestrators when required unresolved postconditions exist. `requires_postcondition_input` therefore exits non-zero and ships a non-null synthesized `manual_follow_up_note` so unchanged orchestrators do not silently accept the new contract while still dropping the work.
- This SDR does not require new authored recipe syntax or new construct-manifest syntax. The wrapper may derive its first hop-class ledger from existing phase traces, live inspections, and lifecycle proofs, then widen phase-local contributors later if needed.

## Normative Effect

- Required: `/update` must not report `completed` while any required postcondition remains unresolved.
- Required: when a committed run needs operator choice or explicit manual follow-through, the execute result returns `status: "requires_postcondition_input"` plus structured `postconditions` records for the unresolved items.
- Required: `manual_follow_up_note` is synthesized from unresolved or warning postcondition records and must stay non-null whenever an unchanged orchestrator would otherwise miss required follow-through.
- Required: deterministic live-machine repairs that do not require operator choice are wrapper-owned. The orchestrator must not be the sole owner of easy, safe follow-through.
- Required: lifecycle proof stays load-bearing. If the wrapper cannot prove that a required lifecycle postcondition landed, execute returns `failed`, not `completed` plus a note.
- Allowed: warning-only postconditions to coexist with `completed` when the transaction has already achieved structural correctness.
- Allowed: the wrapper to derive current postcondition rows from existing phase outputs and live checks without first widening recipe or construct authoring contracts.
- Rejected: keeping postcondition truth in skill prose only.
- Rejected: a binary `completed` / `failed` surface that forces all non-failure follow-through through a nullable string.
- Rejected: unresolved required postconditions that still exit zero for unchanged orchestrators.
- Rejected: pushing gitignored or live-machine follow-through back into staged recipe postconditions just to reuse an existing authored check shape.

## Compiler Impact

- Update `alsc/update-transaction/src/index.ts` result types and execute assembly to add the new tri-state status plus structured postcondition records.
- Add wrapper-owned postcondition evaluation after the relevant phase boundaries and after live writeback where machine-local truth is required.
- Synthesize `manual_follow_up_note` from the ledger for backward compatibility instead of populating it ad hoc per hop class.
- Update `alsc/update-transaction/src/cli.ts` so `requires_postcondition_input` exits non-zero and prints the new result shape without inventing its own postcondition policy.
- Reuse existing helpers and phase outputs where possible:
  - `alsc/compiler/src/operator-config.ts` for selector inspection and singleton selection
  - `alsc/upgrade-construct/src/action-runner.ts` and related lifecycle traces for dispatcher/statusline/dashboard proof
  - existing language-phase truth surfaces from SDR 050
- Keep recipe schema, construct manifest schema, and authored ALS syntax unchanged in this job unless a later pass proves that wrapper-derived rows are insufficient.

## Docs and Fixture Impact

- `skills/update/SKILL.md` must stop treating the postcondition checklist as prose-only truth and instead point to this wrapper-owned contract once accepted.
- `skills/upgrade-language/SKILL.md` must align the v4-to-v5 selector follow-through with the new wrapper-owned postcondition contract.
- Canonical reference docs that currently imply `manual_follow_up_note` is the entire follow-through surface must be updated to describe the structured ledger and tri-state execute result.
- Fixture material must cover, at minimum:
  - no-op or clean execute with `postconditions: []`
  - language-hop success with satisfied postconditions
  - singleton selector self-heal ending in `completed`
  - multi-operator selector follow-through ending in `requires_postcondition_input`
  - lifecycle stale-root or restart-proof failure ending in `failed`
  - warning-only rows that may coexist with `completed`
- If ALS-108 is accepted as the parent contract, ALS-107's narrow string-only proposal in SDR 056 should either be superseded or explicitly retained as a child carve-out rather than being left ambiguous.

## Alternatives Considered

- Atomicity-first wrapper for every postcondition.
- Rejected as the primary recommendation because some postconditions are genuinely operator-chosen or platform-external. Treating all follow-through as blocking wrapper work would over-serialize the transaction boundary and blur the line between correctness-critical proof and warnings.

- Surface-first reporting with `postconditions: [...]` on `completed` results only.
- Rejected because unchanged orchestrators would still be able to declare success without honoring required follow-through unless they were updated everywhere at once.

- Narrow per-incident fixes such as extending `manual_follow_up_note` for ALS-107 and separate ad hoc lifecycle notes for ALS-106.
- Rejected because it preserves the failure mode. The next hop class would still need its own bespoke honesty patch instead of a shared contract.

## Non-Goals

- Redesigning language-upgrade recipe syntax or construct-upgrade manifest syntax in this job.
- Rewriting the `/update` orchestrator into a workflow engine.
- Defining every possible future postcondition class up front.
- Collapsing ALS-106 and ALS-107 automatically before the operator decides whether the parent fix fully subsumes them.

## Follow-Up

- Future passes may widen the ledger contributors if wrapper-derived rows prove insufficient for a new hop class.
- If the accepted parent contract fully covers ALS-107, SDR 056 should be superseded or reduced to historical context rather than left as a competing proposal.
