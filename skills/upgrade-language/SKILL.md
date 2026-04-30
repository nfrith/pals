---
name: upgrade-language
description: Execute an ALS language-upgrade-recipe journey across one or more `als_version` hops. Use when the operator needs a whole-system ALS language cutover, not a normal module or construct update.
---

# upgrade-language

`upgrade-language` is the whole-system `als_version` cutover surface.

Do not use it for normal plugin refreshes (`update`), staged module evolution (`change` / `migrate`), or construct-version work.

## Required Reads

Before mutating anything, read:

- `../docs/references/language-upgrades.md`
- `../validate/SKILL.md`
- `../../sdr/037-language-upgrade-recipe-contract.md`

Use SDR 037 as the normative contract. The reference doc is the human-readable guide.

## Prerequisites

1. Verify `bun` is on PATH.
2. Run `cd ${CLAUDE_PLUGIN_ROOT}/alsc/compiler && bun install` so the compiler and recipe inspector can run.

The runtime package at `${CLAUDE_PLUGIN_ROOT}/alsc/upgrade-language/` has no external dependencies, but the compiler does.

## Determine Scope

Resolve:

- the ALS system root (`.als/system.ts`)
- the current `als_version`
- the target `als_version`

Rules:

- Prefer an explicit operator path or version when one is provided.
- Otherwise, resolve the current system root from the working directory tree.
- If the operator omits the target version, treat the latest reachable recipe chain in `language-upgrades/recipes/` as the target.

## Preflight

1. Validate the live system before planning any upgrade work.

```bash
bun ${CLAUDE_PLUGIN_ROOT}/alsc/compiler/src/cli.ts validate <system-root>
```

2. Read the current `als_version` from the validation output.
3. Discover the hop bundles under `${CLAUDE_PLUGIN_ROOT}/language-upgrades/recipes/`.
4. Build the chain `vN → vN+1 → ... → vM`.
5. For every hop, inspect the authored bundle before execution.

```bash
bun ${CLAUDE_PLUGIN_ROOT}/alsc/compiler/src/cli.ts upgrade-recipe inspect <recipe-bundle-or-recipe.yaml>
```

6. Summarize for the operator:
   - current version
   - target version
   - hop count
   - per-hop summary
   - operator-prompt steps
   - recommended and optional steps
   - that recipe mutation is confined to `.als/`
   - that rollback is not supported

If any hop fails inspection, stop. Do not run a partial or uninspected chain.

## Execution Rules

Execution is governed by the runtime engine in `${CLAUDE_PLUGIN_ROOT}/alsc/upgrade-language/src/`.

Honor these rules exactly:

- `must-run` steps always run.
- `recommended` steps run unless the operator explicitly opts out.
- `optional` steps run only on explicit opt-in.
- `recovery` steps run only after their declared failure trigger.
- `operator-prompt` steps pause the run and surface the referenced markdown through AskUserQuestion.
- Mutating `script` and `agent-task` steps may change only `<system_root>/.als/`.
- The post-step mutation set is enforced through git diff / status inspection in the disposable execution workspace.

## Live Run

1. Require explicit live approval before the first mutating hop.
2. Execute the chain hop by hop.
3. At each hop boundary, report:
   - hop id
   - step results
   - any skipped recommended or optional steps
   - any recovery steps triggered
4. If an `operator-prompt` step fires:
   - surface its markdown content with AskUserQuestion
   - wait for an explicit answer
   - resume from the checkpoint state
5. If a step fails with no declared recovery path, halt and report the failure. Do not invent one.

## After A Successful Chain

1. Validate the upgraded system again.

```bash
bun ${CLAUDE_PLUGIN_ROOT}/alsc/compiler/src/cli.ts validate <system-root>
```

2. If the projection contract changed, refresh generated Claude assets as runner-owned follow-up work.

```bash
bun ${CLAUDE_PLUGIN_ROOT}/alsc/compiler/src/cli.ts deploy claude <system-root>
```

3. Report the final per-hop outcome, the final `als_version`, and any future obligations acknowledged during `operator-prompt` steps.

## Boundaries

- No rollback.
- No partial-system upgrades.
- No plugin-tree or `.claude/` mutation from recipe-authored steps.
- No construct-upgrade authorship here; that stays a sibling primitive.
- ALS-066 ships the engine and contract only. Do not fabricate a public `v1 → v2` recipe when none exists.
