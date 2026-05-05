# Delamain Dispatcher Source Location Contract

## Status

Proposed

## Context

- Dispatcher source is currently duplicated in every module-version bundle under `.als/modules/<module>/v<N>/delamains/<delamain>/dispatcher/` while the plugin's canonical template still lives under `nfrith-repos/als/skills/new/references/dispatcher/`.
- `/change` carries stale bundled dispatcher trees forward by copying `vN` to `vN+1`, while construct-upgrade treats dispatcher as a vendor-managed construct. That dual-writer shape creates drift and makes dispatcher appear module-versioned even though it is not.
- `alsc deploy claude` currently overlays the plugin canonical template into `.claude/delamains/<name>/dispatcher/`, so deployed bundles can already be fresh while authored `.als` copies remain stale. That masks the real contract problem instead of solving it.
- Ghost's authored dispatcher copies are heterogeneous and stale (`5`, `8`, `11` in the current checkout), while the canonical migration tail begins at `11 -> 12`. The current construct-upgrade engine cannot walk those bundled copies forward as a normal fleet upgrade.
- Research-input for ALS-074 settled four direction calls: this job becomes the first real `als_version: 1 -> 2` hop; the one-time seed comes from the current canonical bundle rather than from stale bundled copies; operator-side installed dispatcher trees live one-per-deployed-Delamain under `.als/constructs/delamain-dispatcher/<delamain>/`; and the internal construct identity stays `dispatcher` even though the directory names move to `delamain-dispatcher`.
- SDR 038 currently assumes bundled operator-side dispatcher copies. ALS-074 needs a new decision record rather than silently rewriting that history.

## Decision

- The Delamain dispatcher is a first-class engine-managed construct. In `als_version >= 2`, it is not a module-bundle subtree and it is not a skill-owned reference asset.
- The plugin canonical template moves to `nfrith-repos/als/delamain-dispatcher/`. That directory carries the whole construct bundle: `VERSION`, `construct.json`, `package.json`, `tsconfig.json`, `migrations/`, `src/`, and any sibling vendor files.
- Each operator system carries exactly one installed dispatcher source tree per deployed Delamain at `<system_root>/.als/constructs/delamain-dispatcher/<delamain>/`.
- The construct's internal identity stays `dispatcher`. `construct.json.name`, action manifests, prompt keys, lifecycle strategy ids, skill names, tests, and the `construct:dispatcher` target slug do not rename to `delamain-dispatcher`.
- Module bundles in `als_version >= 2` keep only authored Delamain assets such as `delamain.ts`, `runtime-manifest.config.json`, `agents/`, and optional `sub-agents/`. `delamains/<name>/dispatcher/` is invalid in v2+.
- The first real language-upgrade-recipe hop is `v1 -> v2`. Its dispatcher cutover seeds `<system_root>/.als/constructs/delamain-dispatcher/<delamain>/` from the current canonical bundle, preserves old bundled dispatcher trees only as support backups, deletes them from module bundles, and reprojects `.claude/`.
- The one-time `v1 -> v2` cutover does not resurrect historical dispatcher migrations below the current canonical tail. Bundled `v5`/`v8`/`v11` copies are treated as stale vendor drift, not as sequential migration inputs.
- After the `v1 -> v2` recipe, normal dispatcher VERSION bumps use the construct-upgrade engine against the installed per-delamain trees under `.als/constructs/delamain-dispatcher/`.
- `alsc deploy claude` projects dispatcher runtime files from the installed operator-side construct copy into `.claude/delamains/<delamain>/dispatcher/`. The plugin canonical path is the upgrade source, not the deployed runtime source of truth.
- `/new`, `/change`, and related skill surfaces never author or carry dispatcher source inside module bundles again. They manage only authored Delamain definition/prompt assets and the references that point operators at the installed construct.
- `alsc/upgrade-construct/` discovers dispatcher instances under `.als/constructs/delamain-dispatcher/`, reads canonical source and migrations from `nfrith-repos/als/delamain-dispatcher/`, and scopes customization detection plus vendor fingerprints to the installed per-delamain trees.

## Normative Effect

- Required: `nfrith-repos/als/delamain-dispatcher/` is the only canonical dispatcher template root in the plugin tree.
- Required: `<system_root>/.als/constructs/delamain-dispatcher/<delamain>/` is the only supported operator-side installed dispatcher source root in `als_version >= 2`.
- Required: one installed dispatcher instance maps to one deployed Delamain identity.
- Required: the internal construct identity remains `dispatcher` even though the directory names say `delamain-dispatcher`.
- Required: `als_version >= 2` module bundles reject `delamains/<name>/dispatcher/`.
- Required: the first public `v1 -> v2` language-upgrade-recipe performs the dispatcher seed, backup, cleanup, and re-deploy cutover.
- Required: that one-time cutover seeds from current canonical vendor source rather than chaining historical bundled migrations.
- Required: bundled dispatcher trees from v1 are backup-only artifacts during the cutover and do not remain live after a successful v2 upgrade.
- Required: normal post-v2 dispatcher upgrades run through construct-upgrade against the installed `.als/constructs/delamain-dispatcher/<delamain>/` trees.
- Required: `alsc deploy claude` uses the installed operator-side construct copy as the runtime projection source.
- Required: `/new`, `/change`, and related skill surfaces stop copying or teaching `dispatcher/` under Delamain bundles.
- Required: construct-upgrade discovery, lifecycle prompt ids, and customization detection stop scanning module bundles for dispatcher source.
- Allowed: ALS v1 systems to retain bundled dispatcher source until they run the `v1 -> v2` recipe.
- Allowed: the recipe to preserve backup copies of removed bundled trees for support or debug handoff.
- Rejected: treating dispatcher source as module-versioned authored content after `als_version` 2.
- Rejected: direct deploy from plugin canonical as the steady-state runtime source once the installed construct root exists.
- Rejected: restoring historical migration tails solely to walk stale bundled copies from `v5`/`v8` to current.
- Rejected: renaming the construct contract from `dispatcher` to `delamain-dispatcher`.

## Compiler Impact

- Widen `SUPPORTED_ALS_VERSIONS` to include `2` and add the first public `language-upgrades/recipes/v1-to-v2/` bundle plus fixture coverage.
- Add version-gated validation that rejects `delamains/<name>/dispatcher/` for `als_version >= 2` while leaving v1 snapshots loadable for the recipe path.
- Update compiler and deploy path constants plus tests that currently point at `skills/new/references/dispatcher/`.
- Update deploy projection logic and regression tests so `.claude/delamains/<name>/dispatcher/` is sourced from `.als/constructs/delamain-dispatcher/<delamain>/`, not from module bundles or direct canonical overlay.
- Update construct-upgrade tests for the new canonical path, the new installed discovery path, seed-from-canonical cutover semantics, and fingerprint coverage for the relocated construct root.

## Docs and Fixture Impact

- Update the canonical shape-language and vocabulary docs to show v2 Delamain bundles without `dispatcher/` plus the new `.als/constructs/delamain-dispatcher/<delamain>/` install tree.
- Update dispatcher and module-integration references to explain the new canonical root and the `v1 -> v2` cutover.
- Update `/new`, `/change`, and `/upgrade-delamain` skill docs and procedure text to stop instructing copy-from-template into module bundles.
- Paint the proposed layout into fixture trees and recipe examples during the next planning pass before compiler work starts.
- Keep earlier SDRs as historical records. If old path guidance remains referenced, point at this SDR or annotate the superseded assumption instead of silently rewriting history.

## Alternatives Considered

- Keep ALS v1 and treat the relocation as an in-place cleanup.
- Rejected because it changes a previously valid authored bundle shape and weakens the whole-system cutover story that the operator explicitly approved.
- Reconstruct old migration tails and sequentially upgrade stale bundled copies before moving them.
- Rejected because the stale bundled trees are vendor-owned drift, the current canonical migration tail starts at `11`, and the operator chose seed-from-canonical instead.
- Rename the internal construct identity to `delamain-dispatcher`.
- Rejected because the directory naming clarity does not justify a wider contract blast radius across manifests, prompt keys, telemetry, skills, tests, and change-impact accounting.

## Non-Goals

- Changing dispatcher runtime semantics, lifecycle choices, or VERSION/migration rules outside the location and cutover contract.
- Adding dashboard-specific observability work. ALS-074 remains `language` plus `construct:dispatcher` plus `skill`.
- Removing the dispatcher canonical template entirely. The construct still ships one vendor canonical root in the plugin tree.
