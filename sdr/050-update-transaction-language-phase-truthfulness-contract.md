# Update Transaction Language Phase Truthfulness Contract

## Status

Accepted

## Context

- SDR 037 gives the language-upgrade runner a resumable checkpoint file under `.als/runtime/language-upgrades/state.json`.
- SDR 039 makes `/update` the sole owner of the staging worktree, the bundled-surface refresh, and the single commit whose message records applied language hops and construct deltas.
- ALS-095 exposed an unsafe interaction between those contracts: `/update` ran language execute in staging without an explicit `state_path`, so the runner reused an unrelated checkpoint copied into the staging tree, treated the v3-to-v4 hop as already complete, and returned `status: "completed"` without mutating authored `.als/`.
- The wrapper then built `Language hops: v3-to-v4` from the prepared plan instead of the executed language phase and committed a construct-only diff. Git history now contains a permanent false claim.
- Manual recovery proved the recipe, compiler validation, and `alsc deploy claude` projection are intact in isolation. The missing guarantees are checkpoint identity, language-phase trace truth, and pre-commit invariants.

## Decision

- `/update` owns a transaction-scoped language-runner state path outside the staged `.als/` and `.claude/` commit candidate. Each prepared execute run starts from a fresh wrapper-owned state file instead of implicitly reusing `.als/runtime/language-upgrades/state.json` copied from the live tree.
- Language-runner resume is an identity contract, not a file-presence contract. A checkpoint is resumable only when an engine-owned checkpoint fingerprint matches the current execution input. The fingerprint must cover:
  - target `als_version`
  - ordered hop ids and hop count
  - each hop's `from` and `to` versions
  - each hop's recipe identity
  - the caller-owned run identity for the target system root
- If a caller supplies a checkpoint whose fingerprint does not match, the runner fails closed with a machine-readable checkpoint-mismatch result. It must not advance `current_hop_index`, mark any step complete, or report `status: "completed"` from the mismatched state.
- `/update` builds language claims from the executed language phase, not from the prepared plan alone. Commit metadata and execute-result reporting are derived from applied, skipped, recovered, and failed hop or step records returned by the runner.
- Before commit, `/update` enforces language-phase truth invariants whenever the prepared plan contains language hops:
  - staged validation must report the prepared target `als_version`
  - the staged diff must contain non-runtime `.als/` mutations for every applied must-run mutating hop
  - when the language phase changed authored `.als/`, the staged `.claude/` refresh produced by `alsc deploy claude` must be present inside the same one-commit boundary
  - timestamp-only checkpoint drift does not count as language progress
- If a required language hop or step did not land, `/update` fails closed before commit. Explicitly skipped non-required steps may be reported in the execute result, but they must not be described as applied language hops in the commit history.
- The execute result exposes a per-phase language trace that names applied, skipped, recovered, and failed steps plus their reasons, so operators can distinguish intentional no-op or recovery paths from orchestration failure.
- This decision refines SDR 037 and SDR 039 without changing the authored `als-language-upgrade-recipe@1` schema or the `/update` prepare or execute split.

## Normative Effect

- Required: `/update` passes an explicit wrapper-owned `state_path` to language execute.
- Required: unrelated `.als/runtime/language-upgrades/state.json` files copied into staging cannot satisfy a prepared `/update` language plan.
- Required: same-plan resume is allowed only after checkpoint fingerprint validation succeeds.
- Required: checkpoint fingerprint mismatch fails closed with an explicit machine-readable result.
- Required: language-phase claims in commit metadata and execute results are derived from executed hop or step outcomes, not from prepared intent alone.
- Required: a prepared must-run language hop proves target-version cutover and non-runtime authored mutations before commit.
- Required: when authored language mutations landed, the bundled `.claude/` refresh for that same language phase is part of the same committed transaction.
- Required: skipped language steps surface explicit reasons in the execute result.
- Allowed: optional, recommended, and recovery steps to be skipped when their category rules allow it, as long as the commit does not claim they applied.
- Allowed: standalone `/upgrade-language` callers to resume from a caller-selected checkpoint path when the fingerprint matches exactly.
- Rejected: treating hop-count overrun, timestamp-only checkpoint churn, or prepared-plan intent as proof that a language hop applied.
- Rejected: silently reusing or silently resetting a mismatched checkpoint.
- Rejected: committing a message that claims a language hop whose authored mutations are absent from the commit diff.

## Compiler Impact

- Update `alsc/upgrade-language/src/runtime-state.ts` to store and validate the engine-owned checkpoint fingerprint, and bump or extend the runtime-state schema as needed for mismatch detection.
- Update `alsc/upgrade-language/src/runner.ts` so resume is gated by fingerprint validation and the execute result exposes a structured language-phase trace plus checkpoint-mismatch failure reporting.
- Update `alsc/update-transaction/src/index.ts` so `/update`:
  - allocates a transaction-owned language state path
  - passes that path into language execute
  - derives commit metadata from actual language execution outcomes
  - enforces staged target-version and staged-diff truth invariants before commit
  - surfaces skipped and mismatch details in the execute result
- Update `alsc/update-transaction/src/cli.ts` if the CLI JSON surface needs to expose the new language trace or mismatch fields.
- Keep the authored recipe schema, construct-upgrade engine, and `alsc deploy claude` projection contract unchanged.

## Docs and Fixture Impact

- `skills/update/SKILL.md` must point `/update` language-phase truthfulness and failure posture back to this SDR instead of restating the contract as skill-owned folklore.
- `skills/docs/references/language-upgrades.md` must describe same-plan-only checkpoint resume and distinguish runner checkpoint state from `/update` transaction-owned state.
- Add fixture and test examples for:
  - a stale checkpoint whose fingerprint does not match the requested hop chain
  - a successful v3-to-v4 transaction whose one commit includes `.als/system.ts`, authored `delamain.ts`, and deployed `.claude/delamains/*/delamain.yaml`
  - a blocked commit when the staged diff contains only runtime-state churn
  - a clean construct-only transaction whose commit contains no language claims

## Alternatives Considered

- Keep `.als/runtime/language-upgrades/state.json` inside the staged tree as `/update`'s implicit resume source and add only fingerprint validation.
- Rejected because transaction bookkeeping would remain part of the commit candidate and runtime-state diffs would stay entangled with commit truth.

- Delete or ignore the staged checkpoint before every `/update`.
- Rejected because it patches the observed incident without defining a durable resume-identity contract or a truthful commit-metadata rule.

- Continue building `Language hops:` from the prepared plan and add warning text when execute produced no diff.
- Rejected because git history must describe applied truth, not intended truth with a side-channel apology.

## Non-Goals

- Changing the authored `als-language-upgrade-recipe@1` schema.
- Introducing new operator prompts or new `/update` commands.
- Splitting the language hop, bundled-surface refresh, and construct deltas across multiple commits.
- Redesigning ALS-067 construct lifecycle behavior.
