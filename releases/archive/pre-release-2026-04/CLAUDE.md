# Archived Pre-Release Notes

This directory preserves the former top-level `pre-release/` material as historical context only.

## Why This Was Archived

The legacy notes were last refreshed before the current delamain, dashboard, Foundry, operator-config, provider-dispatch, and broader hook/skill surface existed in the repo. They are still useful for provenance, but they are no longer the active answer to "what still blocks launch?"

The active answer now lives in:

- `../../CLAUDE.md`
- `../../update-model/CLAUDE.md`
- `../../launch/punchlist.md`

## What Changed During The Archive Move

- the markdown notes from the old `pre-release/` tree moved here unchanged except for path-fixups required by the move
- `pre-release/reset-test-container.sh` moved to `../../../docker/reset-test-container.sh`
- `.claude/skills/release/SKILL.md` was deleted rather than archived because it was obsolete and unused

## How To Use This Directory

Read it when you need historical design context or want to understand the old framing. Do not treat it as current release policy, current launch guidance, or the execution input for ALS-051.
