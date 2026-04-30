# ALS Language Upgrade Recipe Contract

## Status

Accepted

## Context

- `alsc` already publishes `supported_als_versions`, `upgrade_mode: "whole-system-cutover"`, and `upgrade_assistance: "hybrid-assisted"`, but ALS still has no first-class upgrade primitive that can carry a system from one `als_version` to the next.
- Language-version upgrades are rare whole-system cutovers. They are not the same problem as routine module evolution handled by `/change` and `/migrate`, and they must not overload `/update`.
- The operator selected Shape 2 as the first landing, but also required Shape 2's primitives to remain a deliberate subset of a future Delamain fold-in so the eventual "upgrade ALS using ALS" step is notation-only work instead of a rewrite.
- Plan-input for ALS-066 settled the remaining architectural guardrails that the first draft SDR left open: full artifact naming, fail-closed authored-schema versioning, independent machine-readable output versioning, `.als/`-only mutation, registry-backed deterministic pre/postconditions, narrow operator-prompt intent rules, and explicit exclusion of construct/module upgrades from this job.
- Pass-2 fixture review approved the bundle layout, the operator-prompt intent enum, and the negative counterexamples, but rejected authored `writes:` declarations as the way to enforce `.als/`-only mutation. The operator also asked this SDR to make three points explicit: operator-prompt `intent` is engine-owned while prompt markdown content is recipe-authored, operator-prompt steps are surfaced through `/upgrade-language` via AskUserQuestion, and enforcement must be split clearly between authored validation, runtime validation, and policy review.
- This pass finalizes the contract after fixture review, records the accepted authored surface, and locks the remaining semantics for implementation.

## Decision

- ALS language-version upgrades ship as one hop-specific `language-upgrade-recipe` bundle under `language-upgrades/recipes/v<from>-to-v<to>/`.
- The artifact name is `language-upgrade-recipe`. The authored schema literal is `als-language-upgrade-recipe@N`. The machine-readable inspection and verification schema literals are `als-language-upgrade-recipe-inspection@N` and `als-language-upgrade-recipe-verification@N`.
- The `alsc` command surface remains `alsc upgrade-recipe inspect <recipe-path>`, but the authored artifact, the runner, the skill, the docs, the fixtures, and this SDR use the full `language-upgrade-recipe` name.
- Each hop bundle contains:
  - `recipe.yaml`
  - `scripts/`
  - `agent-tasks/`
  - `gates/`
  - `operator-prompts/`
- One `language-upgrade-recipe` describes exactly one hop from `from.als_version` to `to.als_version`.
- A multi-hop journey is built by chaining one-hop bundles sequentially. If the operator asks for `vN`, the runner plans `v1 → v2 → ... → vN` and logs each hop boundary explicitly.
- `recipe.yaml` must declare:
  - `schema: "als-language-upgrade-recipe@N"`
  - `from: { als_version: number }`
  - `to: { als_version: number }`
  - `summary: string`
  - `steps: LanguageUpgradeRecipeStep[]`
- Every step declares:
  - `id: string`
  - `title: string`
  - `type: "script" | "agent-task" | "gate" | "operator-prompt"`
  - `category: "must-run" | "recommended" | "optional" | "recovery"`
  - `depends_on: string[]`
  - optional `preconditions: string[]`
  - optional `postconditions: string[]`
  - optional `trigger: "auto" | "manual" | "on-error"`
- Step ids are unique within one recipe. `depends_on` references step ids in the same recipe and must form an acyclic graph.
- `preconditions` and `postconditions` are named checks from the engine's check registry. They are not shell commands, not inline code, and not agent tasks.
- The check registry ships in the engine codebase under `nfrith-repos/als/alsc/upgrade-language/src/checks/`. The initial registry for this job is:
  - `als-version-matches-from`
  - `als-version-matches-to`
  - `validates-as-from-version`
  - `validates-as-to-version`
- Each named check is deterministic, cheap, network-free, and returns `{ ok: boolean, diagnostic?: string }`. New checks ship through engine releases, not through recipe submissions.
- Operator-prompt intents are engine-defined enum values. Recipes pick one allowed `intent` value and pair it with a recipe-authored markdown file under `operator-prompts/` that contains the actual text and options shown to the operator for that hop.
- Preconditions and postconditions are entirely engine-shipped. Recipes may reference registry names, but they do not author check files or check implementations inside the hop bundle.
- Step-type payloads are:
  - `script` steps: required `path` under `scripts/`, optional `args: string[]`
  - `agent-task` steps: required `path` under `agent-tasks/`
  - `gate` steps: required `path` under `gates/`, required `provides: string[]`, optional `accept_statuses: ("pass" | "warn")[]`
  - `operator-prompt` steps: required `path` under `operator-prompts/`, required `intent: "confirm-live-apply" | "acknowledge-future-obligation" | "operator-owned-data-choice"`
- Category behavior is operator vocabulary and is normative:
  - `must-run` always executes unless an earlier hard failure stops the journey
  - `recommended` executes by default and may be skipped only through an explicit operator opt-out
  - `optional` executes only through explicit operator opt-in
  - `recovery` executes only when an earlier step fails in a declared way
- Trigger behavior follows category defaults:
  - `must-run` and `recommended` default to `trigger: auto`
  - `optional` defaults to `trigger: manual`
  - `recovery` requires `trigger: on-error`
- Recovery steps additionally declare `recovers: { step_ids: string[]; error_codes?: string[] }`. They target one or more earlier steps and may narrow by machine-readable error code.
- `operator-prompt` steps are valid only for:
  - live-mutation confirmation
  - acknowledgement of a future required follow-up
  - operator-owned data-content choice needed to finish a valid upgrade
- `operator-prompt` steps are not valid for:
  - architectural choice
  - escape hatches or "skip the rewrite" decisions
  - mutating plugin files, `.claude/`, `CHANGELOG.md`, or any other ALS-managed file outside `.als/`
  - opting out of a `must-run` step while still claiming a successful upgrade
- Recipes, the scripts they run, the agent tasks they invoke, and their recovery steps may mutate only files within `<system_root>/.als/`.
- The plugin tree (`nfrith-repos/als/` or the installed plugin location), `.claude/`, and any other content outside `.als/` are read-only to recipe steps.
- The runner enforces the mutation invariant at runtime, not through authored `writes:` declarations. Every mutating `script` or `agent-task` step executes in a disposable clone or worktree. The post-step `git diff` is the authoritative mutation set. Any changed path outside `<system_root>/.als/` fails the step closed in dry-run and in live execution.
- Operator-prompt steps yield control from the runner back to `/upgrade-language`, which surfaces the recipe-authored markdown content through AskUserQuestion. The runner cannot advance past an operator-prompt step until the skill returns an explicit operator answer.
- After a successful upgrade, the runner may perform its own internal follow-up phases such as `alsc deploy claude` to refresh generated projections. Those phases are engine machinery, not recipe steps.
- The runner checkpoints after every step so an interrupted or failed journey can resume from the last committed checkpoint.
- Frozen fixtures live under `language-upgrades/fixtures/v<N>/`. A fixture is an authored snapshot, not a runtime projection. It includes `.als/` plus the retained authored module roots for that snapshot and excludes `.claude/`.
- When a language hop also requires construct-contract changes, a `language-upgrade-recipe` may invoke the sibling construct-upgrade engine as part of the journey. The construct-upgrade engine remains its own primitive; this SDR does not define its call surface.
- This primitive remains a deliberate subset of a future Delamain fold-in:
  - `step` corresponds to Delamain `state`
  - `preconditions` correspond to entry guards
  - `postconditions` correspond to required validation before advancement
  - `recovery` corresponds to blocked-state recovery routing
  - `agent-task` corresponds to `actor: agent`
  - `operator-prompt` corresponds to `actor: operator`
  - `gate` remains a deterministic validation state, not a new actor kind
- Example authored surface:

```yaml
schema: als-language-upgrade-recipe@1
from:
  als_version: 1
to:
  als_version: 2
summary: Rewrite ALS-managed language files and validate the cutover.
steps:
  - id: validate-source
    title: Validate the source system
    type: gate
    category: must-run
    path: gates/validate-source.sh
    provides:
      - validates-as-from-version
    depends_on: []

  - id: rewrite-als
    title: Rewrite ALS-managed source
    type: script
    category: must-run
    path: scripts/rewrite-als.sh
    depends_on:
      - validate-source
    preconditions:
      - als-version-matches-from
      - validates-as-from-version

  - id: choose-revenue-band-source
    title: Choose revenue_band source
    type: operator-prompt
    category: must-run
    intent: operator-owned-data-choice
    path: operator-prompts/choose-revenue-band-source.md
    depends_on:
      - rewrite-als

  - id: confirm-live-apply
    title: Confirm live apply
    type: operator-prompt
    category: must-run
    intent: confirm-live-apply
    path: operator-prompts/confirm-live-apply.md
    depends_on:
      - choose-revenue-band-source

  - id: validate-target
    title: Validate the upgraded system
    type: gate
    category: must-run
    path: gates/validate-target.sh
    provides:
      - validates-as-to-version
    depends_on:
      - confirm-live-apply

  - id: repair-invalid-records
    title: Repair invalid ALS-managed records
    type: agent-task
    category: recovery
    trigger: on-error
    recovers:
      step_ids:
        - validate-target
      error_codes:
        - als_validation_failed
    path: agent-tasks/repair-invalid-records.md
    depends_on:
      - rewrite-als
```

## Normative Effect

- Required: every authored recipe starts with a supported `schema: "als-language-upgrade-recipe@N"` literal.
- Required: the engine fails closed on any unsupported authored schema literal. Older engines refuse newer recipes. Newer engines may support older recipe schemas only through explicit compatibility code.
- Required: inspection and verification output schemas are versioned independently from the authored recipe schema.
- Required: one authored system targets exactly one `als_version` at a time. Language upgrades remain whole-system cutovers.
- Required: every public `language-upgrade-recipe` bundle is one hop only. Chained journeys are built by sequencing one-hop bundles.
- Required: recipe execution order is determined by DAG dependencies plus category and trigger rules, not by file listing order alone.
- Required: every asset `path` in a recipe resolves relative to the hop bundle and stays inside that bundle.
- Required: recipe steps may not mutate plugin files, `.claude/`, or any non-`.als/` path in the operator system.
- Required: the runner executes mutating `script` and `agent-task` steps in a disposable clone or worktree and treats post-step `git diff` as the authoritative mutation set.
- Required: the runner detects attempted out-of-scope writes during dry-run and live execution and fails closed before claiming success.
- Required: `preconditions` and `postconditions` reference named checks from the shipped registry only.
- Required: shipped named checks are deterministic, cheap, network-free, and LLM-free.
- Required: the initial named-check set for this job is `als-version-matches-from`, `als-version-matches-to`, `validates-as-from-version`, and `validates-as-to-version`.
- Required: operator-prompt `intent` values come from the engine-shipped enum, while operator-prompt markdown content remains recipe-authored per hop.
- Required: the runner cannot proceed past an `operator-prompt` step without an explicit answer mediated by `/upgrade-language`.
- Required: operator-prompt markdown content drives the AskUserQuestion text and option labels that the operator sees at runtime.
- Required: `gate` steps provide the named conditions that later steps may consume.
- Required: recovery steps declare their failure-routing contract explicitly through `recovers`.
- Required: checkpointed runtime state is sufficient to resume an interrupted journey without re-planning the whole chain from scratch.
- Required: `operator-prompt` steps use only the three allowed intents: `confirm-live-apply`, `acknowledge-future-obligation`, and `operator-owned-data-choice`.
- Required: `operator-prompt` steps do not let the operator choose architecture, skip a `must-run` step, or leave the upgrade in a half-valid state.
- Required: a frozen fixture is an authored snapshot and excludes `.claude/`.
- Required: this job covers only `als_version` cutovers. Construct upgrades, module upgrades, dispatcher refreshes, and foundry or projection churn remain separate work.
- Required: when a language-upgrade journey invokes construct-upgrade work, the exact construct-upgrade call surface is owned by the sibling construct-upgrade contract, not by this SDR.
- Allowed: deterministic scripts and agent tasks to coexist in the same hop bundle.
- Allowed: different recipes to reuse the same `intent` value while supplying different operator-facing markdown content for the actual question text and options.
- Allowed: `recommended` steps to be skipped by explicit operator choice.
- Allowed: `optional` steps to exist even when the default journey does not execute them.
- Allowed: `gate` steps to accept `warn` when the recipe contract explicitly allows a warn-clean outcome.
- Allowed: the runner to refresh `.claude/` after a successful upgrade as an internal follow-up phase that is not modeled as a recipe step.
- Rejected: rollback as part of the public contract.
- Rejected: partial-system upgrades where different modules remain on different ALS language versions.
- Rejected: free-text, script-path, or agent-task-valued `preconditions` or `postconditions`.
- Rejected: recipe-authored check files or recipe-authored check implementations inside the hop bundle.
- Rejected: recipe assets that escape their bundle through relative paths.
- Rejected: out-of-scope mutations to `.claude/`, the plugin tree, `CHANGELOG.md`, or any other non-`.als/` surface.
- Rejected: `operator-prompt` steps that encode architectural choice, escape hatches, or direct mutation of ALS-managed files.
- Rejected: advancing past an `operator-prompt` step without a skill-mediated operator answer.
- Rejected: treating construct or module upgrades as part of the `language-upgrade-recipe` surface for this job.

## Compiler Impact

- Add compiler-owned literal sets and types for `language-upgrade-recipe` step types, categories, triggers, and operator-prompt intents.
- Add schema literals for `als-language-upgrade-recipe@N`, `als-language-upgrade-recipe-inspection@N`, and `als-language-upgrade-recipe-verification@N`.
- Add recipe parsing and validation for `recipe.yaml`, including:
  - top-level required fields
  - step-id uniqueness
  - DAG acyclicity
  - dependency reference integrity
  - type-specific payload validation
  - category and trigger consistency
  - path confinement to the hop bundle
  - named-check validation for `preconditions` and `postconditions`
  - recovery-routing validation for `recovers`
  - operator-prompt intent validation
  - best-effort lint for obviously forbidden prompt text or option text in operator-prompt markdown
- Keep the CLI surface as `alsc upgrade-recipe inspect <recipe-path>`, but emit `als-language-upgrade-recipe-inspection@1` JSON.
- Add runtime verification output `als-language-upgrade-recipe-verification@1` for CI and support workflows.
- Add runner support for checkpoint files, chained-hop planning, check-registry execution, runtime diff-based write-scope enforcement, AskUserQuestion-mediated operator-prompt pauses, recovery dispatch, and structured per-step telemetry.

## Docs and Fixture Impact

- Add `language-upgrades/CLAUDE.md` to explain the bundle layout, retained fixture rules, runtime-only mutation enforcement, and the difference between recipe assets and runner-owned follow-up phases.
- Add `skills/docs/references/language-upgrades.md` as the human-readable reference surface for the `language-upgrade-recipe` contract and upgrade flow. That reference should cite this SDR for semantics instead of restating them independently.
- Seed `language-upgrades/fixtures/v1/` from the authored `reference-system` surface: `.als/` plus retained mounted module roots, excluding `.claude/`.
- In the fixture-first planning pass, paint both allowed and rejected `operator-prompt` examples, named-check usage, runtime-only `.als/` enforcement, and AskUserQuestion-mediated prompt flow before implementation begins.
- `/upgrade-language` must use the full `language-upgrade-recipe` name, the locked schema literals, the named-check vocabulary, the AskUserQuestion mediation contract, and the fix-forward-only recovery model from this SDR.
- ALS-066 does not ship a real `v1 → v2` recipe because no v2 exists yet. Synthetic example bundles or test fixtures are the proving ground in this job.

## Alternatives Considered

- Use a flat Codemod++ bundle with ordered scripts and prompts only.
- Rejected because it has no first-class DAG, no typed gates, no explicit recovery routing, no check registry, and no resumable checkpoint contract.

- Ship Upgrade-as-Delamain immediately.
- Rejected for this job because the bootstrap and notation design cost is too high for the first language-upgrade landing, even though the future fold-in remains desirable.

- Keep preconditions and postconditions as recipe-authored scripts or prompts.
- Rejected because determinism and cheap repeatability are part of the contract, and allowing authored shell or agent checks would make "same input, same answer" unenforceable.

- Require every mutating step to declare a static `writes:` list in authored recipe YAML.
- Rejected because pattern-based transforms do not scale to bounded path enumeration. The post-step diff in a disposable clone is the authoritative mutation set.

- Permit recipe steps to write outside `.als/` and rely on operator trust or documentation.
- Rejected because the upgrade surface must be mechanically bounded. Plugin files and generated runtime projections are not recipe-owned state.

## Non-Goals

- Reverse migrations or rollback automation.
- Live patching, auto-migrate-on-save, or background language upgrades.
- Partial-system or per-module mixed ALS language versions.
- Pull-request creation, release publication, or any CI/CD workflow beyond validation and verification artifacts.
- Module upgrades.
- Construct upgrades as a first-class primitive, including dispatcher version bumps, foundry refreshes, hook-surface migrations, or projection churn outside a language-version hop. When a language hop needs that work, it calls the sibling construct-upgrade engine whose contract is owned by the separate ALS-067 follow-on SDR, not by this one.
- Changes to `/update`, `/change`, or `/migrate` semantics in this job.
