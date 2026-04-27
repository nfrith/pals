# ALS Update Model

This directory defines the release/update contract ALS should stand behind for the preview-era public launch.

## Default Posture

- Pull-based, operator-initiated, exact-version-pinned.
- No evergreen updates, no silent push, no background mutation of operator repos.
- Validation, dry-run, and git-visible changes before live cutover.
- Beta preview status remains. Breaking changes are allowed only when they are classified and the operator action is explicit.

## Surface Summary

| Surface | Source of truth | Intended update path | Current gap |
|---------|-----------------|----------------------|-------------|
| Installed delamains | bundled Foundry modules and authored module bundles | upgrade ALS to a pinned release, then run a dedicated dispatcher upgrade flow | `/upgrade-dispatchers` is still a placeholder |
| ALS language and module bundles | compiler/plugin release, `als_version`, `.als/modules/<module_id>/vN/` | hop-by-hop cutovers with explicit preflight, dry-run, and apply phases | no first-class `alsc upgrade` toolchain yet |
| Shipped operator surfaces | hooks, `.claude/` projection, statusline scripts, dashboard launchers, Foundry shelf | plugin upgrade plus explicit deploy/refresh steps | no unified refresh orchestration yet |
| Version policy | this directory plus `CHANGELOG.md` | classify compatibility impact in every release | current changelog is not yet consistently tagged by impact class |

## Read Next

- `installed-delamains.md` for the operator-facing dispatcher/module update path
- `language-and-modules.md` for compiler, `als_version`, and module-bundle cutovers
- `shipped-surfaces.md` for hooks, projection, statusline, dashboard, and Foundry refresh rules
- `version-policy.md` for breaking-change taxonomy and changelog expectations
