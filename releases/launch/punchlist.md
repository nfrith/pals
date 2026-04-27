# ALS Public Launch Punchlist

This is the single approved remaining-work list ALS-051 should consume.

ALS-050 completed the document architecture, the release/update policy write-up, the root-doc cross-links, and the legacy `pre-release/` archive move. Everything below is still implementation work.

## 1. Build A Real Installed-Delamain Upgrade Flow

Why this blocks launch:
Operators can install Foundry-delivered delamains today, but they cannot discover or safely apply newer dispatcher/module versions later.

Done when:
- `/upgrade-dispatchers` is a real skill instead of a placeholder
- an installed system can discover newer bundled delamain/module versions from a pinned ALS release
- the operator sees a classified diff before cutover
- logic-only refreshes validate and redeploy `.claude/` assets without reinstalling from scratch
- migration-required upgrades use explicit staging, validation, approval, and commit boundaries

## 2. Ship A First-Class ALS Language Upgrade Toolchain

Why this blocks launch:
The release/update model is still missing the actual path for `als_version` cutovers.

Done when:
- ALS ships preflight, dry-run, and apply phases for language-version upgrades
- hop-by-hop upgrade policy is enforced explicitly
- module-bundle invalidation or rewrite requirements are surfaced mechanically, not by surprise
- failures are machine-readable enough to support operator review and tooling

## 3. Add A Real Warning And Deprecation Lifecycle

Why this blocks launch:
The current contract is effectively binary: allowed or rejected. That is too abrupt for a public release/update story.

Done when:
- the compiler emits meaningful warnings
- ALS has a documented deprecation posture instead of only hard failures
- release notes can tell operators what to clean up before the next breaking step lands

## 4. Consolidate The Refresh Story For Bundled Operator Surfaces

Why this blocks launch:
Hooks, projected `.claude/` assets, statusline scripts, dashboard launchers, and Foundry updates all move differently today.

Done when:
- the operator has a clear documented path to refresh hooks, projected assets, statusline, and dashboard launchers after an ALS upgrade
- refresh steps are idempotent and git-visible where they touch the operator repo
- ALS no longer relies on operators discovering refresh mechanics by reading source or placeholder docs

## 5. Enforce Compatibility Classification In Release Notes

Why this blocks launch:
The version policy exists on paper now, but the release process does not yet enforce it.

Done when:
- published changelog entries classify notable changes as `docs_only`, `refresh_required`, `additive`, `migration_required`, or `breaking_without_path`
- every `refresh_required` or `migration_required` entry includes explicit operator action
- the release process prevents world-facing launches from shipping `breaking_without_path` items

## 6. Rehearse The End-To-End Operator Story

Why this blocks launch:
The model is not credible until it is proven on a clean system.

Done when:
- a fresh operator can install ALS, import from Foundry, validate, deploy, and configure the monitoring surfaces from the published docs
- at least one real upgrade rehearsal covers the installed-delamain path and the refresh path
- documentation and tooling agree on commands, failure modes, and recovery steps
