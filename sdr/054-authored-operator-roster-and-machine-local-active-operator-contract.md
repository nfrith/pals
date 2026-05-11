# Authored Operator Roster And Machine-Local Active-Operator Contract

## Status

Proposed

## Context

- ALS v4 currently stores operator identity in one markdown file at `<system_root>/.als/operator.md`.
- That file is system-scoped and single-operator only. It cannot express a shared team roster plus a machine-local "who am I here" choice without turning one committed file into a dual-purpose truth surface.
- ALS-100 requires three distinct concepts:
  - a committed roster shared across the repo
  - a machine-local active-operator selector that is never committed
  - authored TypeScript shapes consistent with ALS entrypoint patterns
- The current authored-load contract only admits `system`, `module`, and `delamain` entrypoints and rejects generic local imports, so the new operator topology must not assume arbitrary relative-import composition unless ALS explicitly widens that contract.
- ALS-101 depends on this job for stable operator IDs and compiler-owned resolution helpers; downstream constructs and skills must not duplicate file parsing logic.
- `.als/skip-operator-config` already suppresses SessionStart injection for demo/reference systems and remains a required carve-out.
- The operator explicitly rejected a legacy-runtime bridge during plan-input. `.als/operator.md` may be read once during migration, but it must play no runtime role after this change ships.

## Decision

- This clean-break contract lands as `als_version: 5` through a `v4 -> v5` language-upgrade-recipe. A within-version breaking rollout is rejected.
- The canonical committed operator surface is split:
  - `<system_root>/.als/operator-roster.ts`
  - `<system_root>/.als/operators/{slug}.ts`
- `als:authoring` adds two new helpers:
  - `defineOperatorRoster(...)`
  - `defineOperator(...)`
- `.als/operator-roster.ts` exports `operatorRoster`. Its authored shape declares shared roster membership by path, not by inlining full operator objects:

  ```ts
  import { defineOperatorRoster } from "als:authoring";

  export const operatorRoster = defineOperatorRoster({
    operator_paths: ["./operators/nick.ts"],
  });
  ```

- Every `.als/operators/{slug}.ts` file exports `operator` through `defineOperator(...)`. The operator shape carries the stable identity and profile/business fields required for SessionStart and downstream operator references:
  - `id`
  - `first_name`
  - `last_name`
  - `display_name`
  - `primary_email`
  - `role`
  - `profiles`
  - `owns_company`
  - `company_name`
  - `company_type`
  - `company_type_other`
  - `revenue_band`
- Legacy markdown file-format bookkeeping does not carry into the authored operator shape. `config_version`, `created`, `updated`, and markdown body text exist only on the v4 migration input.
- Every roster entrypoint path must resolve to a basename that matches the exported operator's `id` plus `.ts`. Example: `id: "0xnfrith"` must live at `.als/operators/0xnfrith.ts`.
- The machine-local selector lives at `<system_root>/.als/local/active-operator.json`.
- `<system_root>/.als/.gitignore` must ignore `/local/` so the selector is never committed.
- The selector is JSON with schema literal `als-active-operator-selection@1` and required field `operator_id`. Example:

  ```json
  {
    "schema": "als-active-operator-selection@1",
    "operator_id": "nick"
  }
  ```

- `.als/skip-operator-config` continues to suppress operator-context injection regardless of whether the system uses the legacy file or the new roster surface.
- SessionStart resolution order is semantic and contains no legacy read path:
  - If `.als/skip-operator-config` exists, inject nothing.
  - Else if `.als/operator-roster.ts` exists, load the roster and require a valid local selector whose `operator_id` resolves to exactly one roster entry.
  - Else inject a hard remediation reminder and no identity block.
- Missing, invalid, or unknown local selector state becomes an explicit remediation path. The hook never silently falls back to legacy `.als/operator.md`.
- The technical `operator-config` namespace stays in compiler helpers, CLI subcommands, and hook/runtime code, but it becomes a semantic surface over roster plus selector rather than a synonym for one markdown file.
- `/configure-operator` remains the canonical human-facing live-machine writer. For the `v4 -> v5` hop, the language-upgrade recipe owns tracked `.als/` mutations, and a compiler-owned live-machine helper in the `alsc operator-config` namespace writes `.als/local/active-operator.json` immediately after commit.
- The migration rule for legacy IDs is deterministic: slugify the effective legacy display label, using `display_name` when non-null and falling back to `"${first_name} ${last_name}"` only when `display_name` is null.
- The `v4 -> v5` recipe:
  - reads `<system_root>/.als/operator.md`
  - writes `.als/operator-roster.ts`
  - writes `.als/operators/{id}.ts`
  - writes or updates `.als/.gitignore` to ignore `/local/`
  - removes `.als/operator.md`
  - bumps `.als/system.ts` to `als_version: 5`
- The local selector is not committed by the recipe. It is written by the live-machine helper after commit, and failure at that step is explicit post-commit failure or remediation, not silent success.

## Normative Effect

- Required: the steady-state roster contract is `als_version: 5`.
- Required: team-ready operator configuration is authored as `.als/operator-roster.ts` plus one or more `.als/operators/{slug}.ts` files.
- Required: every authored operator declares a stable `id`, and roster resolution rejects duplicate IDs.
- Required: every `operator_paths` entry is a relative path under `.als/operators/`, ends in `.ts`, and its basename matches the resolved operator `id`.
- Required: the active-operator selector lives under `.als/`, is gitignored, and uses schema `als-active-operator-selection@1` with field `operator_id`.
- Required: when the roster surface exists, SessionStart resolves the active operator through the local selector and emits remediation when the selector is missing, invalid, or points at an unknown ID.
- Required: when the roster surface does not exist, SessionStart emits remediation and injects no identity block.
- Required: `.als/skip-operator-config` suppresses the roster flow and the missing-roster remediation.
- Required: downstream compiler/runtime/skill consumers use compiler-owned helpers for roster and selector resolution instead of parsing these files directly.
- Required: `v4 -> v5` migration derives operator IDs by slugifying the effective legacy display label (`display_name` when present, otherwise `first_name + " " + last_name"`).
- Allowed: one-entry rosters for single-operator systems.
- Allowed: different machines in the same repo choosing different `operator_id` values through their local selector files.
- Allowed: legacy `.als/operator.md` being read by the `v4 -> v5` migration only.
- Rejected: treating `.als/operator.md` as a runtime surface after this change ships.
- Rejected: committing the active-operator selector or placing it outside `.als/`.
- Rejected: inline full operator objects inside `.als/operator-roster.ts` as the canonical shared topology.
- Rejected: widening authored-load to generic local-import composition as the primary way to assemble the roster in this pass.
- Rejected: a within-version breaking rollout that changes hook/runtime behavior without an `als_version` hop.

## Compiler Impact

- Extend supported-version constants and language-upgrade planning so the roster contract lands as `als_version: 5` with a `v4 -> v5` recipe.
- Extend authored-load and authoring helper surfaces to support `operatorRoster` and `operator` entrypoints.
- Add roster-path resolution logic that loads each referenced operator entrypoint and validates unique IDs plus declared field shapes.
- Evolve `operator-config.ts` from a single markdown inspector into semantic loader/inspection helpers for:
  - roster manifest
  - per-operator entrypoints
  - local selector
  - skip marker
  - migration-only legacy markdown input
- Keep `alsc operator-config ...` as the CLI namespace, but widen it to inspect resolved operator context and support live-machine selector plus migration helpers needed by `/configure-operator`, `/upgrade-language`, and `/update`.
- Update public hook-runtime SessionStart behavior so the Claude adapter still calls one semantic helper while transport remains above the public API per SDR 053.
- Add diagnostics for invalid `operator_paths`, duplicate IDs, missing roster surface, missing selectors, unknown selector IDs, invalid selector JSON/schema, basename/id mismatch, and migration-time legacy ID derivation failures.

## Docs and Fixture Impact

- Update the canonical shape-language reference to document `defineOperatorRoster`, `defineOperator`, the new entrypoint paths, the no-generic-local-import rule that motivates `operator_paths`, and the `als_version: 5` cutover.
- Rewrite the operator-config reference doc around the split committed surface plus machine-local selector and migration-only legacy input.
- Update onboarding/install docs and test expectations that currently describe `.als/operator.md` as the created artifact on fresh systems.
- Update language-upgrade docs and `/update`/`/upgrade-language` skill text to explain the `v4 -> v5` recipe plus the post-commit local-selector write.
- Add fixture coverage for:
  - a one-entry roster and valid local selector
  - a multi-operator roster
  - duplicate operator IDs
  - roster-absent hard remediation
  - roster-present but selector-missing remediation
  - selector pointing to an unknown ID
  - `v4 -> v5` migration from legacy `.als/operator.md`, including `display_name`-to-slug ID derivation
- If a later job wants dispatcher-level team filtering, that follow-on must consume the compiler-owned resolution surface instead of reopening file-path choices here.

## Alternatives Considered

- Monolithic shared roster file.
- Rejected because it serializes normal operator-profile edits through one shared file and loses the parallelism tiebreaker.
- Keep legacy `.als/operator.md` as a runtime bridge until teams migrate.
- Rejected because the operator explicitly overrode coexistence and because a half-legacy runtime would hide a breaking authored contract behind silent fallback.
- Within-version breaking rollout.
- Rejected because it would make hook/runtime behavior break older systems without an explicit language-version boundary or recipe-owned authored migration.
- Relative-import-composed roster.
- Rejected for this pass because the current authored-load contract intentionally forbids generic local imports; `operator_paths` preserves split ownership without reopening that broader contract.

## Non-Goals

- ALS-101 team-mode constructs such as `requires_active_operator`, `operator-ref`, dispatcher filtering, or console auto-stamping.
- Preserving runtime support for legacy `.als/operator.md`.
- A generic machine-local config namespace beyond the active-operator selector.

## Follow-Up

- If ALS later needs fully generic authored entrypoint composition by local import, that should be handled by a separate authored-load contract job rather than smuggled through operator-roster semantics.
