# Language Upgrade Recipes

This directory holds one public `language-upgrade-recipe` bundle per ALS language hop.

Layout:

```text
language-upgrades/recipes/
  vN-to-vN+1/
    recipe.yaml
    scripts/
    gates/
    agent-tasks/
    operator-prompts/
```

Rules:

- One bundle per hop.
- `recipe.yaml` must inspect cleanly through `alsc upgrade-recipe inspect`.
- Asset paths stay inside the hop bundle.
- Public recipes mutate only `.als/` through the runtime engine's diff-enforced boundary.

ALS now ships the first public hop at `v1-to-v2/`. That bundle seeds `.als/constructs/delamain-dispatcher/`, archives bundled dispatcher trees, removes them from module bundles, and flips the system to `als_version: 2`.
