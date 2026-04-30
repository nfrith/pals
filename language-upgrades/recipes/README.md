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

ALS-066 does not ship a public `v1 → v2` bundle because ALS v2 does not exist yet. Use synthetic fixtures and tests as the proving ground until the first real hop is authored.
