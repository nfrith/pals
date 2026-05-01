# ALS Construct Upgrade Engine Contract

## Status

Proposed

## Context

- ALS already ships plugin-managed constructs that the operator uses but does not author, including dispatcher source, statusline scripts, and the dashboard service. Plugin update refreshes those sources in the plugin tree, but it does not upgrade operator-side dispatcher copies or any runtime state they carry.
- ALS-066 shipped the sibling language-upgrade-recipe engine and locked the operator-prompt runner pattern, staged mutation boundary, and whole-system `/update` orchestration model that ALS-067 must sit beside rather than inside.
- Research-input for ALS-067 settled four planning pivots that the earlier draft still handled inconsistently: construct-upgrade and language-upgrade are siblings with no cross-invocation, `/update` owns one staging worktree for the whole transaction, live lifecycle effects move to a post-commit phase, and dispatcher versioning is fleet-wide even though lifecycle choice is per dispatcher instance.
- Plan-input then rejected the first operator gate as a rubber-stamp pass and asked the proposal to surface the real remaining picks: shape-compatibility with a future staged language-upgrade participant, a deterministic post-commit action-manifest contract, an explicit customization-detection tradeoff, and named post-commit failure states for support handoff.
- Dispatcher is the only current construct with operator-side source copies under `.als/`. Statusline and dashboard run from the plugin tree, so they participate in lifecycle restart but not in customization detection or operator-side source replacement.
- The compiler gets a `VERSION` file in this job for diagnostics only. It remains out of scope for live construct-upgrade surfaces in v1.

## Decision

- ALS ships a first-class construct-upgrade engine under `nfrith-repos/als/alsc/upgrade-construct/`.
- The construct-upgrade engine and the language-upgrade-recipe engine are sibling primitives. Neither engine invokes the other.
- `/update` is the sole operator-facing orchestrator. ALS-067 defines the construct-side staged interface now and is intentionally shaped so a future `/upgrade-language` retrofit can join the same staging boundary. Until Punchlist #1 lands, `/update` may still run ALS-066's current single-phase language-upgrade flow before staging begins; that is a temporary implementation limitation, not the permanent contract shape.
- Every construct that participates in the engine ships:
  - `VERSION`
  - `construct.json`
  - a migrations directory when the selected migration strategy requires it
- `construct.json` is the authored manifest for the construct-upgrade contract. It declares:
  - `schema: "als-construct-manifest@1"`
  - `name`
  - `version`
  - `migration_strategy`
  - `lifecycle_strategy`
  - `migrations_dir`
  - `source_paths`
- `version` in `construct.json` must equal the sibling `VERSION` file content.
- Migration strategies are engine-owned. v1 ships exactly one migration strategy:
  - `sequential`
- Lifecycle strategies are engine-owned. v1 ships exactly three lifecycle strategies:
  - `dispatcher-lifecycle`
  - `process-lifecycle`
  - `none`
- `dispatcher-lifecycle` applies only to delamain dispatchers. It exposes exactly three operator choices in preflight:
  - `Drain`
  - `Kill`
  - `Cancel`
- Dispatcher preflight emits one lifecycle prompt per dispatcher instance. The operator may mix `Drain` and `Kill` across dispatchers in the same `/update`.
- `Cancel` on any dispatcher aborts the entire `/update` transaction before execute begins.
- Dispatcher versioning is a fleet invariant. All delamains in one operator system are treated as one dispatcher fleet for version detection and migration planning.
- The engine computes one dispatcher migration chain for the fleet, then applies it across every dispatcher instance.
- `process-lifecycle` applies to statusline and dashboard. It emits post-commit kill-and-start actions and never prompts the operator.
- `none` is a forward-compatible registry slot for future non-process construct targets. Dispatcher, statusline, and dashboard are the only live v1 construct targets.
- Construct skills follow a two-phase surface:
  - `preflight`
  - `execute`
- Preflight detects version mismatch and returns any prompts required for the operator gate. It does not mutate the system.
- Execute receives the operator answers plus a staging worktree path from `/update`. Execute stages filesystem mutations into that worktree and emits `als-construct-action-manifest@1`. Execute does not touch the live system directly.
- `/update` creates one staging worktree per invocation and shares it across every triggered construct skill.
- `/update` validates the whole staged filesystem before commit.
- `/update` commits the staged worktree back to the live system in one shot.
- `/update` runs construct-emitted lifecycle manifests only after commit succeeds.
- `als-construct-action-manifest@1` is a deterministic structured artifact. v1 action kinds are:
  - `drain-then-restart`
  - `kill-then-restart`
  - `restart-only`
  - `start-only`
- Every manifest action declares:
  - `kind`
  - `construct`
  - `instance_id`
  - `display_name`
  - `start`
  - optional `process_locator`
  - optional `drain_signal`
- `start` declares the post-commit launch contract:
  - `command: string[]`
  - `cwd: string`
- `drain-then-restart` requires both `process_locator` and `drain_signal`.
- `kill-then-restart` and `restart-only` require `process_locator`.
- `start-only` requires no `process_locator`.
- v1 proposal: `/update` executes manifest actions sequentially in manifest order. This keeps post-commit behavior deterministic, keeps failure states legible, and matches the v1 structured-manifest philosophy.
- v1 does not allow prose-only, free-form, or agent-authored lifecycle manifests.
- Customization detection applies only to operator-side source copies. In v1 that means dispatcher source under `.als/modules/**/delamains/**/dispatcher/`.
- Customization detection compares the vendor-owned files in the operator-side copy against the engine's shipped known-version vendor content hashes. If the copy matches any known vendor version exactly, it is not customized. Otherwise it is customized.
- When customization is detected, preflight emits `confirm-construct-overwrite` with the backup target path `<source>.customized-backup`.
- The operator-prompt runner pattern is shared with ALS-066, but the prompt intents and schema are owned by ALS-067. v1 construct-upgrade intents are:
  - `pick-construct-lifecycle`
  - `confirm-construct-overwrite`
- Construct-upgrade may mutate only `<system_root>/.als/`.
- Plugin files are read-only to construct-upgrade.
- Any `.claude/` refresh belongs to `/update` transaction machinery, not to construct-upgrade as a mutation step.
- If post-commit lifecycle fails after the staged filesystem has been committed, v1 reports one of these failure states for support handoff:
  - `lifecycle-drain-stalled`
  - `lifecycle-stop-failed`
  - `lifecycle-start-failed`
  - `lifecycle-partial`
- The compiler gets `nfrith-repos/als/alsc/VERSION` for diagnostics only. It does not get a construct skill, live lifecycle strategy application, or operator prompt surface in v1.
- Example dispatcher manifest shape:

```json
{
  "schema": "als-construct-manifest@1",
  "name": "dispatcher",
  "version": 11,
  "migration_strategy": "sequential",
  "lifecycle_strategy": "dispatcher-lifecycle",
  "migrations_dir": "migrations",
  "source_paths": [
    {
      "path": "src",
      "owner": "vendor"
    }
  ]
}
```

## Normative Effect

- Required: construct-upgrade and language-upgrade remain sibling primitives with no cross-engine invocation path.
- Required: `/update` is the sole operator-facing orchestrator for combining the two engines.
- Required: every construct manifest starts with `schema: "als-construct-manifest@1"`.
- Required: `construct.json.version` matches the sibling `VERSION` file exactly.
- Required: `migration_strategy` and `lifecycle_strategy` names come from engine-owned registries only.
- Required: unknown strategy names fail closed.
- Required: dispatcher lifecycle prompts are emitted one per dispatcher instance during preflight.
- Required: dispatcher version planning is fleet-wide even though lifecycle choice is per dispatcher instance.
- Required: `Cancel` on any dispatcher aborts the entire `/update` transaction before execute.
- Required: construct execute passes mutate only the staging worktree path supplied by `/update`.
- Required: construct execute passes emit post-commit lifecycle manifests instead of touching live processes immediately.
- Required: construct execute passes emit `als-construct-action-manifest@1`, not prose-only or agent-authored lifecycle instructions.
- Required: the action manifest remains shape-compatible with a future staged language-upgrade participant in the same `/update` transaction.
- Required: v1 action kinds are `drain-then-restart`, `kill-then-restart`, `restart-only`, and `start-only`.
- Required: every action provides the structured fields its kind needs to execute deterministically.
- Required: v1 proposal is sequential manifest execution in manifest order.
- Required: no live lifecycle side-effect runs before `/update` validates and commits the whole staged filesystem.
- Required: customization detection treats an exact vendor match against any shipped known version as non-customized.
- Required: non-matching vendor-owned dispatcher source is treated as customized and requires explicit overwrite approval before execute.
- Required: overwrite approval creates a `.customized-backup` copy before vendor source replacement.
- Required: construct-upgrade mutates only `<system_root>/.als/`.
- Required: plugin files remain read-only to construct-upgrade.
- Required: `.claude/` refresh remains outside the construct-upgrade mutation contract.
- Required: post-commit failure handoff uses named lifecycle states rather than raw prose only.
- Required: v1 failure vocabulary is `lifecycle-drain-stalled`, `lifecycle-stop-failed`, `lifecycle-start-failed`, and `lifecycle-partial`.
- Required: the compiler stays diagnostics-only in v1 even though it gains a `VERSION` file.
- Allowed: `Drain` and `Kill` to be mixed across dispatcher instances in one `/update`.
- Allowed: `process-lifecycle` to restart statusline and dashboard without any operator prompt.
- Allowed: `none` to ship in the registry even when no live v1 construct target uses it.
- Allowed: construct skills to be callable directly for testing or surgical runs, as long as they still honor the staged execute contract when invoked by `/update`.
- Rejected: pre-commit Drain or Kill against the live system.
- Rejected: cross-engine invocation where language-upgrade calls construct-upgrade or vice versa.
- Rejected: per-delamain heterogeneous version planning in v1.
- Rejected: silent overwrite of customized dispatcher source.
- Rejected: partial-system construct upgrades where only some dispatchers in the fleet take the version bump.
- Rejected: rollback as part of the public contract.

## Compiler Impact

- Add a new construct-manifest schema literal and metadata block alongside the existing compiler contracts without modifying ALS-066's language-upgrade-recipe contract block.
- Add engine-owned literal sets and types for:
  - migration strategies
  - lifecycle strategies
  - construct-upgrade operator-prompt intents
  - post-commit action kinds
  - post-commit failure states
- Add compiler validation for `construct.json`, including:
  - top-level required fields
  - schema literal validation
  - `version` parity with `VERSION`
  - strategy-name membership
  - path validation for `migrations_dir`
  - `source_paths` validation
- Add compiler validation for `als-construct-action-manifest@1`, including:
  - schema literal validation
  - action-kind membership
  - per-kind required fields
  - `start.command` and `start.cwd` shape validation
  - `process_locator` and `drain_signal` presence rules by action kind
  - execution-order validation if v1 keeps sequential manifest order
- Add runner/runtime support in `alsc/upgrade-construct/` for:
  - fleet version detection
  - sequential migration-chain planning
  - customization detection from shipped known-version hashes
  - preflight prompt batching
  - stage-only execute behavior
  - post-commit lifecycle manifest emission
  - post-commit failure-state emission
  - runtime state and telemetry
- Reuse ALS-066's operator-prompt runner pattern or factor it into a shared utility module, but keep ALS-067's prompt-intent enum and schema separate.

## Docs and Fixture Impact

- Add a fixture-first review pass for:
  - dispatcher, statusline, and dashboard `construct.json` examples
  - dispatcher preflight prompt examples with one lifecycle choice per dispatcher instance
  - staged post-commit lifecycle manifest examples
  - manifest-ordering examples and counterexamples
  - customization-detection examples showing exact-version match vs overwrite prompt
  - failure-state examples showing which operator-visible state each post-commit failure lands in
  - `/update` phase examples showing one shared staging worktree and no live lifecycle side-effect before commit
- Add or update human-readable reference docs so they cite this SDR for construct-upgrade semantics instead of restating lifecycle, customization, or staging rules independently.
- `/upgrade-delamain`, `/upgrade-statusline`, `/upgrade-dashboard`, and `/update` skill text must reflect the staged execute contract and the post-commit lifecycle split.

## Alternatives Considered

- Let the language-upgrade engine invoke construct-upgrade directly when a hop needs construct changes.
- Rejected because `/update` is the chosen orchestration boundary, and cross-engine invocation adds avoidable coupling and duplicate transaction semantics.

- Execute Drain or Kill against the live system before staging or validation.
- Rejected because it breaks the atomicity story for pre-commit failure and makes "discard the worktree, system unchanged" false at the filesystem and process boundary.

- Plan dispatcher version deltas independently per delamain.
- Rejected because ALS-067 explicitly treats dispatcher upgrades as a fleet operation and reserves heterogeneous drift handling for customization detection rather than per-instance migration planning.

- Treat the compiler as a live construct-upgrade target in v1.
- Rejected because the compiler has no state-migration story here; `VERSION` is useful for diagnostics without expanding this job into a compiler-upgrade surface.

- Emit free-form prose or agent-authored post-commit lifecycle instructions.
- Rejected because v1 needs deterministic validation, reproducible support handoff, and a bounded failure surface before it can experiment with more flexible manifest styles.

## Non-Goals

- Hook upgrades.
- Skill upgrades.
- A compiler upgrade skill.
- Stateless bundled-surface refresh wiring into `/update`.
- Agent-driven lifecycle or migration strategies.
- Partial-system upgrades.
- Forked-plugin merge support.
- Rollback automation.
- The `/update` transaction wrapper itself.

## Follow-Up

- Future job: fold `/upgrade-language` into the same staging boundary so Decision #13's all-or-nothing atomicity holds across language and construct together, not just on the construct side.
- Future job: converge dispatcher source toward a shared on-disk location or symlink model so every delamain does not need its own vendor copy. The fleet-version rule in this SDR is the prerequisite for that optimization.
