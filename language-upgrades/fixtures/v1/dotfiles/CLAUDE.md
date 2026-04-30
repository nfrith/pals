# dotfiles/

Machine configuration tracking. Not the dotfiles themselves — the metadata about them. What exists, what it does, why it's there, and which machine profile uses it.

## Philosophy

Configs drift. Tools update, machines change, and what worked six months ago silently breaks. These records exist so you can reconstruct intent when that happens. PURPOSE explains why a config exists, not how to install it. NOTES captures the gotchas you'll forget.

## Key Directories

- `configs/` — Individual tool configurations as `CFG-NNNN.md`
- `profiles/` — Machine provisioning profiles as `PROF-NNNN.md`. Each profile references which configs it depends on.

## Deprecation

Configs go `deprecated` when they're no longer active but worth keeping for reference. Don't delete deprecated configs — they're documentation of what used to work and why it stopped.
