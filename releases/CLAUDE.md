# ALS Releases

This directory is the active answer to two questions:

1. How ALS releases and updates are supposed to work.
2. What still blocks the world-facing launch push while ALS remains a Beta Research Preview.

ALS already has a public beta preview. This tree does not replace `RESEARCH-PREVIEW.md`; it defines the deeper release/update model and the launch gate that the preview docs point into.

## Read Order

1. `update-model/CLAUDE.md`
2. `launch/CLAUDE.md`
3. `launch/punchlist.md`

## Current Position

- ALS is pull-based and exact-version-pinned during preview. No operator system should self-update in the background.
- `als_version` cutovers are whole-system events. Mixed-version ALS systems are not part of the contract.
- Module evolution happens through version bundles plus explicit migration work, not silent reinterpretation of live records.
- Bundled operator-facing surfaces such as hooks, dashboard launchers, statusline scripts, and projected `.claude/` assets refresh through explicit commands or plugin upgrades, never silent mutation.
- The model is prescriptive even where tooling is incomplete. The missing implementation work is tracked in `launch/punchlist.md`.

## Directory Map

- `update-model/` defines the release/update contract across installed delamains, language/module cutovers, shipped operator surfaces, and changelog policy.
- `launch/` defines what "ready to push ALS publicly" means while the beta label stays on, plus the execution punchlist.
- `archive/pre-release-2026-04/` preserves the old `pre-release/` notes as history only. They are not the current answer anymore.

## Relationship To Other Repo Docs

- `RESEARCH-PREVIEW.md` stays the public preview contract.
- `README.md`, `CONTRIBUTING.md`, `CHANGELOG.md`, and `AGENTS.md` stay at repo root and link here for deeper release/readiness policy.
- `launch/punchlist.md` is the single execution input ALS-051 should consume.

## Historical Note

The archived material here was last refreshed before the delamain dispatcher, dashboard, foundry, operator-config, provider-dispatch, and broader hook/skill surface existed in the repo. It remains useful as provenance, not as current policy.
