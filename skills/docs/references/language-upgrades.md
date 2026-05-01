# ALS Language Upgrades

Language upgrades are explicit whole-system cutovers from one `als_version` to the next.

The recipe contract lives in [SDR 037](../../../sdr/037-language-upgrade-recipe-contract.md). The two-phase runtime contract lives in [SDR 039](../../../sdr/039-update-transaction-wrapper-contract.md). This doc is the human-readable reference for authors and operators; it points back to those SDRs for required, allowed, and rejected behavior.

## Core Model

- One `language-upgrade-recipe` bundle per hop.
- `/upgrade-language` plans multi-hop journeys by chaining one-hop bundles.
- Steps are typed: `script`, `agent-task`, `gate`, `operator-prompt`.
- Step categories are `must-run`, `recommended`, `optional`, and `recovery`.
- `operator-prompt` steps combine an engine-defined `intent` with recipe-authored markdown content.

## Authored Surface

Every recipe bundle includes a `recipe.yaml` plus any referenced assets under `scripts/`, `gates/`, `agent-tasks/`, and `operator-prompts/`.

Minimal authored shape:

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

  - id: confirm-live-apply
    title: Confirm live apply
    type: operator-prompt
    category: must-run
    intent: confirm-live-apply
    path: operator-prompts/confirm-live-apply.md
    depends_on:
      - rewrite-als
```

Notes:

- `preconditions` and `postconditions` reference engine-owned named checks only.
- `operator-prompt` content lives in markdown files authored per hop.
- Recipes do not declare target write paths. `.als/` confinement is enforced at runtime, not through authored `writes:` lists.

## Runtime Rules

- Mutating steps may change only `<system_root>/.als/`.
- The runner executes mutating `script` and `agent-task` steps in a disposable clone or worktree.
- Post-step `git diff` is the source of truth for the actual mutation set.
- Any non-`.als/` path change fails the step closed.
- Preflight discovers every `operator-prompt` step that can fire for the selected hop chain and option set.
- Execute consumes a pre-collected operator-answer map and fails closed if a required answer is missing.
- `operator-prompt` steps in `category: "recovery"` are rejected so prompt discovery stays static.
- When `/upgrade-language` runs under `/update`, SDR 039's transaction wrapper owns the staged `alsc deploy claude` refresh.

## Fixtures And Verification

- `language-upgrades/fixtures/v<N>/` stores the retained authored snapshot for each shipped `als_version`.
- Fixtures include `.als/` plus the retained mounted module roots and exclude `.claude/`.
- Inspection output uses `als-language-upgrade-recipe-inspection@N`.
- Verification output uses `als-language-upgrade-recipe-verification@N`.

## Out Of Scope

- Module evolution inside an existing `als_version` stays on `/change` and `/migrate`.
- Construct upgrades are a sibling primitive, not part of the core `language-upgrade-recipe` contract.
- Rollback, partial-system upgrades, and live patching are excluded.

See [SDR 037](../../../sdr/037-language-upgrade-recipe-contract.md) and [SDR 039](../../../sdr/039-update-transaction-wrapper-contract.md) for the exact contract.
