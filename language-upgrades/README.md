# ALS Language Upgrades

Language upgrades are hop-specific `language-upgrade-recipe` bundles that move a system from one `als_version` to the next.

The canonical contract lives in [SDR 037](../sdr/037-language-upgrade-recipe-contract.md). This doc is the directory-level guide: where the assets live, how they are organized, and which boundaries are load-bearing.

## Layout

```text
language-upgrades/
  README.md
  recipes/
    v1-to-v2/
      recipe.yaml
      scripts/
      gates/
      agent-tasks/
      operator-prompts/
  fixtures/
    v1/
      .als/
      workspace/
      clients/
      operations/
      governance/
      infra/
      dotfiles/
```

Rules:

- One bundle per hop. A `v1-to-v2` bundle describes exactly one `als_version` cutover.
- `recipe.yaml` uses the authored schema literal `als-language-upgrade-recipe@N`.
- Asset `path` fields resolve relative to the hop bundle and must stay inside that bundle.
- `operator-prompts/*.md` files hold the operator-facing content for AskUserQuestion prompts fired by `/upgrade-language`.

## Execution Model

- `alsc upgrade-recipe inspect <recipe-path>` validates authored bundle shape.
- `/upgrade-language` computes multi-hop chains and executes one hop bundle at a time.
- Mutating `script` and `agent-task` steps run inside a disposable clone or worktree.
- Post-step `git diff` is the authoritative mutation set.
- Any changed path outside `<system_root>/.als/` fails closed in dry-run and live execution.
- `.claude/` refresh is runner-owned follow-up machinery, not recipe-authored state.

## Fixtures

- `fixtures/v<N>/` is an authored snapshot, not a runtime projection.
- Include `.als/` plus the retained mounted module roots for that version.
- Exclude `.claude/`.
- Retain fixtures permanently for CI verification and support recreation.

## Step Assets

- `scripts/` contains deterministic transforms.
- `gates/` contains deterministic validation executables.
- `agent-tasks/` contains markdown prompts for agent work.
- `operator-prompts/` contains markdown content surfaced by `/upgrade-language` through AskUserQuestion.

Step semantics, allowed intents, recovery rules, and the exact validation contract are defined in [SDR 037](../sdr/037-language-upgrade-recipe-contract.md), not in this README.

## Boundaries

- This surface covers `als_version` cutovers only.
- Module evolution stays on `/change` and `/migrate`.
- Construct upgrades are a sibling primitive. A `language-upgrade-recipe` may invoke the construct-upgrade engine when a hop requires construct-contract changes, but that engine's contract is owned by ALS-067 follow-on work, not by this directory.
