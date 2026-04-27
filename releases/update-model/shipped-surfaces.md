# Shipped Operator Surfaces

## Principle

Anything copied into an operator repo or session must have an explicit refresh path. ALS can ship bundled surfaces, but it cannot pretend those surfaces are evergreen once copied.

## Surface Map

| Surface | Lives in this repo | Operator gets it via | Update rule |
|---------|--------------------|----------------------|-------------|
| Hooks | `.claude-plugin/plugin.json` plus `hooks/` | plugin install/upgrade | new or changed hooks arrive only with plugin upgrade/reload; ALS does not mutate per-project hook state behind the operator's back |
| Projected skills and delamains | `.claude/skills/`, `.claude/delamains/`, `.als/CLAUDE.md` in the operator system | `alsc deploy claude` | deploy rewrites derived assets from authored source after validation |
| Statusline | `statusline/` plus `/configure-statusline` | copies into `.claude/scripts/` | rerun `/configure-statusline` after an ALS upgrade when the installed scripts need to change |
| Dashboard launchers | `delamain-dashboard/` plus `/configure-delamain-dashboard` | copies into `.claude/scripts/` | rerun `/configure-delamain-dashboard` to refresh the project-local launchers after an ALS upgrade |
| Foundry shelf | `foundry/` | `/foundry` and future upgrade flow | the shelf itself updates when ALS updates; importing or upgrading from it remains explicit |
| Operator profile hook path | `hooks/operator-config-session-start.sh` plus `skills/operator-config` | plugin hook + per-system `.als/operator.md` | hook code updates with ALS upgrades; system data updates only when the operator runs `/operator-config` |

## Rules

- Derived surfaces should be overwritten by deploy, not hand-merged.
- Installer-written launcher or script files are local copies. They must be refreshable idempotently.
- Hook changes belong to the ALS/plugin release. Project-local script copies belong to explicit installer reruns.
- No shipped surface should require the operator to rediscover the correct refresh path from source code.

## Current Gap

ALS does not yet offer a single operator-facing refresh command that covers every shipped surface coherently. Today the update story is split across plugin upgrade, deploy, and installer skills.

That fragmentation is acceptable during early preview, but it is not the final launch-ready posture. The consolidation work is captured in `../launch/punchlist.md`.
