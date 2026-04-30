# ALS Language Upgrade Migration Recipe Contract

## Status

Proposed

## Context

- `alsc` already publishes `supported_als_versions`, `upgrade_mode: "whole-system-cutover"`, and `upgrade_assistance: "hybrid-assisted"`, but ALS has no first-class upgrade primitive that can carry a system from one `als_version` to the next.
- Language-version upgrades are a different class of event than routine module or skill updates. They are rare, breaking, whole-system cutovers and must not overload `/update`, `/change`, or `/migrate`.
- The operator already selected Shape 2, Migration Recipe, over Shape 1, Codemod++ Bundle, and Shape 3, Upgrade-as-Delamain. Shape 2 must still be designed as a subset of Shape 3 so a later fold-in is notation-only work, not a rewrite.
- The shipped toolchain must support deterministic rewrites, guided agent work, validation gates, operator gates, resumable execution, permanent retained fixtures, and fix-forward recovery without promising rollback.
- Recipe-schema versioning mechanics are still being settled in plan-input for ALS-066. This draft records the contract that is already decided and leaves the schema-versioning mechanics in `Open Questions`.

## Decision

- Official ALS language upgrades ship as one hop-specific bundle under `language-upgrades/recipes/v<from>-to-v<to>/` inside the ALS plugin.
- Each hop bundle contains:
  - `recipe.yaml` as the machine-readable recipe definition
  - `scripts/` for deterministic executable steps
  - `agent-tasks/` for markdown agent prompts
  - `gates/` for deterministic validation executables
  - `operator-prompts/` for markdown operator gates
- One recipe describes exactly one hop from `from.als_version` to `to.als_version`.
- Multi-hop journeys are composed by chaining hop bundles sequentially. If the operator requests `vN`, the engine plans `v1 → v2 → ... → vN` and executes one continuous journey with explicit per-hop boundaries in the log.
- `recipe.yaml` must declare:
  - `from: { als_version: number }`
  - `to: { als_version: number }`
  - `summary: string`
  - `steps: RecipeStep[]`
- Every recipe step declares:
  - `id: string`
  - `title: string`
  - `type: "script" | "agent-task" | "gate" | "operator-prompt"`
  - `category: "must-run" | "recommended" | "optional" | "recovery"`
  - `depends_on: string[]`
  - optional `preconditions: string[]`
  - optional `postconditions: string[]`
  - optional `trigger: "auto" | "manual" | "on-error"`
- Step ids are unique within one recipe. `depends_on` references step ids in the same recipe and must form an acyclic graph.
- `preconditions` and `postconditions` are condition ids, not prose notes. A condition id is valid only if the engine can evaluate it through a built-in check or through a declared gate step. Free-text preconditions or postconditions are rejected.
- Step-type payloads are:
  - `script` steps: required `path` under `scripts/`, optional `args: string[]`
  - `agent-task` steps: required `path` under `agent-tasks/`
  - `gate` steps: required `path` under `gates/`, required `provides: string[]`, optional `accept_statuses: ("pass" | "warn")[]`
  - `operator-prompt` steps: required `path` under `operator-prompts/`
- Category behavior is operator vocabulary and is normative:
  - `must-run` always executes unless an earlier hard failure stops the journey
  - `recommended` executes by default and may be skipped only through an explicit operator opt-out
  - `optional` executes only through explicit operator opt-in
  - `recovery` executes only when an earlier step fails in a declared way
- Trigger behavior follows category defaults:
  - `must-run` and `recommended` default to `trigger: auto`
  - `optional` defaults to `trigger: manual`
  - `recovery` requires `trigger: on-error`
- Recovery steps must additionally declare `recovers: { step_ids: string[]; error_codes?: string[] }`. They may target one or more earlier steps and optionally narrow to declared machine-readable error codes.
- Recovery is fix-forward only. The engine does not promise rollback. If no matching recovery step exists for a failure, the journey halts with a machine-readable diagnostic.
- The runner checkpoints progress after every step to a runtime state file in the operator system so a failed or interrupted journey can resume from its last committed checkpoint.
- Permanent frozen fixtures live under `language-upgrades/fixtures/v<N>/`. Each directory is an immutable committed snapshot of a released ALS system version. These fixtures are retained indefinitely for support recreation and for recipe verification.
- This recipe primitive is a deliberate subset of a future Delamain fold-in:
  - recipe `step` corresponds to Delamain `state`
  - `preconditions` correspond to entry guards
  - `postconditions` correspond to required validation before advancement
  - `recovery` corresponds to blocked-state recovery routing
  - `agent-task` corresponds to `actor: agent`
  - `operator-prompt` corresponds to `actor: operator`
  - `gate` remains a deterministic validation state, not a new actor kind
- Example recipe surface:

```yaml
from:
  als_version: 1
to:
  als_version: 2
summary: Rewrite legacy constructs and verify the cutover.
steps:
  - id: rewrite-system
    title: Rewrite removed language constructs
    type: script
    category: must-run
    path: scripts/rewrite-system.sh
    depends_on: []
    postconditions:
      - builtin.no-legacy-constructs

  - id: validate-system
    title: Validate the rewritten system
    type: gate
    category: must-run
    path: gates/validate-system.sh
    provides:
      - gate.system-valid
    depends_on:
      - rewrite-system

  - id: operator-review
    title: Review the dry-run findings
    type: operator-prompt
    category: recommended
    path: operator-prompts/review-findings.md
    depends_on:
      - validate-system

  - id: repair-invalid-records
    title: Repair records if validation fails
    type: agent-task
    category: recovery
    trigger: on-error
    recovers:
      step_ids:
        - validate-system
      error_codes:
        - als_validation_failed
    path: agent-tasks/repair-invalid-records.md
    depends_on:
      - rewrite-system
```

## Normative Effect

- Required: one authored system targets exactly one `als_version` at a time; language upgrades remain whole-system cutovers.
- Required: every public recipe bundle is one hop only. Chained journeys are built by sequencing several one-hop recipes.
- Required: recipe execution order is determined by DAG dependencies plus category and trigger rules, not by file listing order alone.
- Required: every `path` in a recipe resolves relative to the hop bundle and stays inside that bundle.
- Required: `gate` steps provide the condition ids that later steps may use in `preconditions` or `postconditions`.
- Required: recovery steps declare their failure-routing contract explicitly through `recovers`.
- Required: checkpointed runtime state is sufficient to resume an interrupted journey without re-planning the whole chain from scratch.
- Required: frozen fixtures are permanent retained snapshots and are valid CI and support inputs, not disposable examples.
- Allowed: deterministic scripts and agent tasks to coexist in the same hop bundle.
- Allowed: `recommended` steps to be skipped by explicit operator choice.
- Allowed: `optional` steps to exist even when the default journey does not execute them.
- Allowed: `gate` steps to accept `warn` when the recipe contract explicitly allows a warn-clean outcome.
- Rejected: rollback as part of the public contract.
- Rejected: partial-system upgrades where different modules remain on different ALS language versions.
- Rejected: recipe assets that escape their hop bundle through relative paths.
- Rejected: free-text, non-checkable postconditions.
- Rejected: a public recipe primitive whose meaning depends on hidden runtime behavior instead of explicit step/category/trigger fields.

## Compiler Impact

- Add compiler-owned literal sets for recipe step types, recipe categories, and recipe trigger kinds.
- Add machine-readable output schema literals for recipe inspection and recipe verification.
- Add recipe parsing and validation for `recipe.yaml`, including:
  - top-level required fields
  - step-id uniqueness
  - DAG acyclicity
  - dependency reference integrity
  - type-specific payload validation
  - category/trigger consistency
  - path confinement to the hop bundle
  - condition-id and gate-provider validation for `preconditions` and `postconditions`
  - recovery-routing validation for `recovers`
- Add `alsc upgrade-recipe inspect <recipe-path>` that emits `als-upgrade-recipe-inspection@1` JSON.
- Add runtime verification output `als-upgrade-recipe-verification@1` for CI and support workflows.
- Add runner and runtime support for checkpoint files, chained-hop planning, category defaults, recovery dispatch, and structured per-step telemetry.

## Docs and Fixture Impact

- Add `language-upgrades/README.md` to explain the bundle layout, retained fixtures, and how recipe assets are organized.
- Add `skills/docs/references/language-upgrades.md` as the human-readable reference surface for recipe vocabulary and upgrade flow. That reference should cite this SDR for semantics instead of re-stating them independently.
- Add `language-upgrades/fixtures/v1/` as the first retained frozen fixture, committed as an immutable copy of the v1 reference system snapshot.
- In the next planning pass, paint the recipe syntax into synthetic example bundles or test fixtures before implementation begins. ALS-066 does not ship a real `v1 → v2` recipe because no v2 exists yet.
- `/upgrade-language` must use the same vocabulary as this SDR: `must-run`, `recommended`, `optional`, `recovery`, transparent hop chaining, and fix-forward recovery.

## Alternatives Considered

- Use a flat Codemod++ bundle with ordered scripts and prompts only.
- Rejected because it has no first-class DAG, no typed gates, no explicit recovery routing, and no resumable checkpoint contract.

- Ship Upgrade-as-Delamain immediately.
- Rejected for this job because the bootstrap and notation design cost is too high for the first language-upgrade landing, even though the future fold-in remains desirable.

- Put recipes in a separate repository.
- Rejected because upgrade assets must ship atomically with the ALS version that needs them, and support needs one local source of truth.

- Promise rollback as part of the toolchain.
- Rejected because rollback multiplies state-management complexity while the operator explicitly chose fix-forward recovery instead.

## Open Questions

- Where the recipe schema version is declared, how authored recipe compatibility is matched against runner support, and whether compatibility is exact-literal or intentionally multi-version remain open for ALS-066 plan-input.

## Non-Goals

- Reverse migrations or rollback automation.
- Live patching, auto-migrate-on-save, or background language upgrades.
- Partial-system or per-module mixed ALS language versions.
- Pull-request creation, release publication, or any CI/CD workflow beyond validation and verification artifacts.
- Changes to `/update`, `/change`, or `/migrate` semantics in this job.
