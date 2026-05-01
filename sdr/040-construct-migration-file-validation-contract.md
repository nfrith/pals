# ALS Construct Migration-File Validation Contract

## Status

Accepted

## Context

- ALS-067 introduced the construct-upgrade engine and the `sequential` migration strategy, but its compile-time validation stops at "`migrations_dir` exists and is a directory." Filename shape, hop width, duplicates, gaps, and chain end-at-version are still enforced only when the runtime engine plans an upgrade.
- That placement leaves a real pre-ship gap. A plugin author can commit malformed migration files, pass `alsc construct inspect`, and only fail later when an edgerunner runs `/update`.
- The immediate trigger is the next dispatcher migration after `v11-to-v12.ts`. Today the shipped chain is functionally fail-closed because only one migration exists, but the next added step would make gaps, duplicates, or malformed filenames materially dangerous.
- ALS-067 already fixed the surrounding construct-upgrade vocabulary and strategy registry contract in [`038-construct-upgrade-engine-contract.md`](./038-construct-upgrade-engine-contract.md). This SDR narrows in on the sequential migration-file contract nested inside that engine.
- This SDR uses the existing `construct` and `construct upgrade` vocabulary from [`skills/docs/references/vocabulary.md`](../skills/docs/references/vocabulary.md). It does not add a new authored ALS surface.

## Decision

- ALS defines a compiler-enforced migration-file contract for constructs whose `construct.json.migration_strategy` is `sequential`.
- The canonical sequential migration filename pattern is `vN-to-vM.{ts,js,cts,mts,cjs,mjs}`:
  - lowercase `v`
  - positive-integer `N` and `M`
  - literal `-to-`
  - exactly one of `.ts`, `.js`, `.cts`, `.mts`, `.cjs`, `.mjs`
- The `migrations/` directory is strict-hygiene surface area. Every directory entry must be a sequential migration file except for one name-precise carve-out: the literal `.gitkeep`.
- `.gitkeep` is permitted only as the standard git empty-directory placeholder. It is not a migration step, does not satisfy any required hop, and counts as "empty" for the empty-directory rule.
- Any other non-conforming directory entry rejects as `construct_manifest.migrations.malformed_name`, including:
  - typoed migration filenames such as `v11_to_v12.ts` or `V11-to-V12.ts`
  - helper files such as `_helpers.ts`
  - docs such as `README.md`
  - OS metadata such as `.DS_Store`
  - subdirectories or any other non-file entry
- The sequential strategy is single-hop only. A valid migration file must satisfy `M = N + 1`. Files such as `v12-to-v14.ts` reject as `construct_manifest.migrations.multi_hop_forbidden`.
- Sequential migration chains must be contiguous across the range they actually ship. When the discovered migration steps are sorted by source version, each step's target version must equal the next step's source version. The chain does not need to start at version 1.
- The highest target version in the shipped sequential chain must equal `construct.json.version`. Because SDR 038 already requires `construct.json.version` to match the sibling `VERSION` file, this rule also anchors the chain end to the construct's shipped version.
- A given sequential hop may be represented by exactly one file. Multiple files for the same `N -> N+1` hop reject as `construct_manifest.migrations.duplicate`, even when the extensions differ.
- An empty `migrations/` directory passes only when `construct.json.version` equals `1`. A directory that contains only `.gitkeep` is treated as empty for this rule. Empty plus version `> 1` rejects as `construct_manifest.migrations.empty_with_nontrivial_version`.
- The compiler and the runtime engine share one validation definition for sequential migration steps. The compiler uses it to surface structured diagnostics during `alsc construct inspect`; the runtime engine keeps using it as defense-in-depth when `/update` plans an upgrade.
- The compiler-owned diagnostic namespace for this contract is:
  - `construct_manifest.migrations.gap`
  - `construct_manifest.migrations.malformed_name`
  - `construct_manifest.migrations.multi_hop_forbidden`
  - `construct_manifest.migrations.duplicate`
  - `construct_manifest.migrations.chain_end_mismatch`
  - `construct_manifest.migrations.empty_with_nontrivial_version`
- Existing valid constructs remain valid under this contract:
  - dispatcher v12 with `migrations/v11-to-v12.ts` passes
  - statusline v1 with `.gitkeep`-only `migrations/` passes
  - dashboard v1 with `.gitkeep`-only `migrations/` passes

## Normative Effect

- Required: `alsc construct inspect` validates sequential migration filenames, hop width, duplicates, contiguity, end-at-version, and the empty-directory rule before a construct ships.
- Required: the canonical filename contract accepts the same six extensions the runtime engine already accepts.
- Required: every `migrations/` directory entry other than the literal `.gitkeep` matches the canonical sequential migration filename contract.
- Required: `.gitkeep` is treated as a placeholder only, not as a migration step.
- Required: multi-hop sequential files reject.
- Required: the present shipped chain is contiguous from its lowest shipped source version through its highest shipped target version.
- Required: the chain's highest shipped target version equals `construct.json.version`.
- Required: duplicate hop coverage rejects even when the files differ only by extension.
- Required: an empty or `.gitkeep`-only `migrations/` directory passes only for version `1`.
- Required: the runtime engine keeps validating the same rules at upgrade time even after compile-time validation exists.
- Allowed: a construct to ship only the tail of its historical migration chain instead of every hop back to version `1`, as long as the shipped range is internally contiguous and reaches the construct's current version.
- Allowed: `.gitkeep` as the only named exception inside `migrations/`.
- Rejected: runtime-only validation as the sole enforcement point for sequential migration files.
- Rejected: silent ignoring of malformed or auxiliary entries under `migrations/`.
- Rejected: `.ts`-only narrowing as part of this job.
- Rejected: requiring constructs to retain migrations all the way back to version `1`.

## Compiler Impact

- Add compiler-owned sequential migration validation logic that can:
  - inspect raw `migrations/` directory entries
  - parse sequential migration steps
  - validate strict hygiene, hop width, duplicates, contiguity, end-at-version, and the empty-directory rule
  - emit `ConstructUpgradeInspectionIssue` records in the six-code namespace above
- `inspectConstructManifest()` must invoke that validation when `migration_strategy === "sequential"`.
- The shared logic must be importable by `alsc/upgrade-construct/` without creating a compiler-engine import cycle. The compiler remains the ownership root because the engine already imports compiler-side construct inspection.
- The runtime engine may keep its throw-based API, but it must derive its enforcement from the shared validation definition rather than a forked rule copy.
- Shared validation code should carry short inline comments that explain the normative rules and point back to this SDR as the canonical contract.

## Docs and Fixture Impact

- Add `040-construct-migration-file-validation-contract.md` as the canonical decision record for sequential migration-file validation.
- Add a one-line cross-reference in SDR 038 so its construct-upgrade compiler story points here for migration-file validation details.
- Add compiler regression coverage for:
  - each of the six new diagnostic codes
  - the dispatcher v12 happy path
  - empty or `.gitkeep`-only v1 happy paths
- If the runtime engine's tests depend on exact validation errors, update them to consume the shared rule set without restating the contract in separate prose.
- No canonical shape-language documentation update is required in this pass because the job adds no authored ALS syntax.

## Alternatives Considered

- Keep sequential migration-file validation runtime-only.
- Rejected because it lets malformed plugin bundles pass `alsc construct inspect` and fail only after shipment.

- Tighten the canonical filename contract to `.ts` only.
- Rejected because ALS-067 already shipped a broader runtime regex and this job is not the place to narrow that contract implicitly.

- Ignore non-conforming entries in `migrations/` unless they "look like" migration files.
- Rejected because strict hygiene is the chosen fail-closed posture and catches both typos and stray auxiliary files before ship.

- Require sequential migration chains to start at version `1`.
- Rejected because existing constructs only need a contiguous shipped tail that reaches the current version; forcing full-history retention would be a new burden unrelated to the failure gap this job closes.

## Non-Goals

- Validation rules for non-sequential migration strategies.
- Migration file content validation beyond filename/chain structure.
- New operator-facing migration authoring tools.
- Cross-construct migration validation.
- Changes to `/update` orchestration or ALS-069's transaction-wrapper work.
