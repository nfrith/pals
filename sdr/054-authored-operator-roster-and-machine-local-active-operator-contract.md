# Authored Operator Roster And Machine-Local Active-Operator Contract

## Status

Proposed

## Context

- ALS v1 currently stores operator identity in one markdown file at `<system_root>/.als/operator.md`.
- That file is system-scoped and single-operator only. It cannot express a shared team roster plus a machine-local "who am I here" choice without turning one committed file into a dual-purpose truth surface.
- ALS-100 requires three distinct concepts:
  - a committed roster shared across the repo
  - a machine-local active-operator selector that is never committed
  - authored TypeScript shapes consistent with ALS entrypoint patterns
- The current authored-load contract only admits `system`, `module`, and `delamain` entrypoints and rejects generic local imports, so the new operator topology must not assume arbitrary relative-import composition unless ALS explicitly widens that contract.
- ALS-101 depends on this job for stable operator IDs and compiler-owned resolution helpers; downstream constructs and skills must not duplicate file parsing logic.
- `.als/skip-operator-config` already suppresses SessionStart injection for demo/reference systems and remains a required carve-out.

## Decision

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
- Legacy markdown file-format bookkeeping does not carry into the authored operator shape. `config_version`, `created`, `updated`, and markdown body text remain part of the legacy `.als/operator.md` bridge only.
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
- SessionStart resolution order is semantic:
  - If `.als/skip-operator-config` exists, inject nothing.
  - Else if `.als/operator-roster.ts` exists, load the roster and require a valid local selector whose `operator_id` resolves to exactly one roster entry.
  - Else if the roster surface is absent and legacy `.als/operator.md` validates, inject the legacy single-operator profile.
  - Else inject nothing or remediation according to the existing missing/invalid rules.
- Once the roster surface exists, ALS does **not** silently fall back to legacy `.als/operator.md` for SessionStart. Missing, invalid, or unknown local selector state becomes an explicit remediation path.
- The technical `operator-config` namespace stays in compiler helpers, CLI subcommands, and hook/runtime code, but it becomes a semantic surface over roster plus selector plus legacy bridge rather than a synonym for one markdown file.
- `/configure-operator` is the canonical live-machine writer. It creates or updates operator entrypoints, maintains roster membership, writes the local selector, and migrates legacy `.als/operator.md` into the split surface on demand.
- This change is additive within the current `als_version`. Legacy `.als/operator.md` remains accepted only while the new roster surface is absent. Team-mode follow-on work may require migration, but existing single-operator systems do not break merely because the plugin updated.

## Normative Effect

- Required: team-ready operator configuration is authored as `.als/operator-roster.ts` plus one or more `.als/operators/{slug}.ts` files.
- Required: every authored operator declares a stable `id`, and roster resolution rejects duplicate IDs.
- Required: every `operator_paths` entry is a relative path under `.als/operators/` and ends in `.ts`.
- Required: the active-operator selector lives under `.als/`, is gitignored, and uses schema `als-active-operator-selection@1` with field `operator_id`.
- Required: when the roster surface exists, SessionStart resolves the active operator through the local selector and emits remediation when the selector is missing, invalid, or points at an unknown ID.
- Required: `.als/skip-operator-config` suppresses both the new roster flow and the legacy bridge.
- Required: downstream compiler/runtime/skill consumers use compiler-owned helpers for roster and selector resolution instead of parsing these files directly.
- Allowed: one-entry rosters for single-operator systems.
- Allowed: different machines in the same repo choosing different `operator_id` values through their local selector files.
- Allowed: legacy `.als/operator.md` continuing to work for pre-migration systems that have not yet created `.als/operator-roster.ts`.
- Rejected: treating `.als/operator.md` as the canonical authored surface once the roster surface exists.
- Rejected: committing the active-operator selector or placing it outside `.als/`.
- Rejected: inline full operator objects inside `.als/operator-roster.ts` as the canonical shared topology.
- Rejected: widening authored-load to generic local-import composition as the primary way to assemble the roster in this pass.
- Rejected: silent fallback to legacy `.als/operator.md` after a system has already adopted `.als/operator-roster.ts`.

## Compiler Impact

- Extend authored-load and authoring helper surfaces to support `operatorRoster` and `operator` entrypoints.
- Add roster-path resolution logic that loads each referenced operator entrypoint and validates unique IDs plus declared field shapes.
- Evolve `operator-config.ts` from a single markdown inspector into semantic loader/inspection helpers for:
  - roster manifest
  - per-operator entrypoints
  - local selector
  - skip marker
  - legacy markdown bridge
- Keep `alsc operator-config ...` as the CLI namespace, but widen it to inspect resolved operator context and support live-machine selector and migration helpers needed by `/configure-operator`.
- Update public hook-runtime SessionStart behavior so the Claude adapter still calls one semantic helper while transport remains above the public API per SDR 053.
- Add diagnostics for invalid `operator_paths`, duplicate IDs, missing selectors, unknown selector IDs, invalid selector JSON/schema, and legacy/new-surface ambiguity cases.

## Docs and Fixture Impact

- Update the canonical shape-language reference to document `defineOperatorRoster`, `defineOperator`, the new entrypoint paths, and the no-generic-local-import rule that motivates `operator_paths`.
- Rewrite the operator-config reference doc around the split committed surface plus machine-local selector and legacy bridge.
- Update onboarding/install docs and test expectations that currently describe `.als/operator.md` as the created artifact on fresh systems.
- Add fixture coverage for:
  - a one-entry roster and valid local selector
  - a multi-operator roster
  - duplicate operator IDs
  - roster-present but selector-missing remediation
  - selector pointing to an unknown ID
  - legacy `.als/operator.md` bridge when the roster surface is absent
- If a later job wants dispatcher-level team filtering, that follow-on must consume the compiler-owned resolution surface instead of reopening file-path choices here.

## Alternatives Considered

- Monolithic shared roster file.
- Rejected because it serializes normal operator-profile edits through one shared file and loses the parallelism tiebreaker.
- Keep legacy `.als/operator.md` canonical and bolt on optional team overlays.
- Rejected because it creates dual truth surfaces and forces every downstream consumer to reason about both indefinitely.
- Relative-import-composed roster.
- Rejected for this pass because the current authored-load contract intentionally forbids generic local imports; `operator_paths` preserves split ownership without reopening that broader contract.

## Non-Goals

- ALS-101 team-mode constructs such as `requires_active_operator`, `operator-ref`, dispatcher filtering, or console auto-stamping.
- Removing legacy `.als/operator.md` entirely in this same pass.
- A generic machine-local config namespace beyond the active-operator selector.

## Follow-Up

- If ALS later needs fully generic authored entrypoint composition by local import, that should be handled by a separate authored-load contract job rather than smuggled through operator-roster semantics.
