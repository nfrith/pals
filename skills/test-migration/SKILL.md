---
name: test-migration
description: Reserved future wrapper for the disposable-clone subset of `migrate`. The authoritative v1 dry-run and live cutover flow currently lives in `migrate`.
---

# test-migration

`migrate` currently owns the authoritative ALS v1 migration flow.
That includes staged-manifest validation, disposable-clone testing, and the final live cutover.

This skill remains intentionally unimplemented for now.
When it is split out later, it should reuse the same manifest and report contracts as `migrate` but stop after clone validation and behavior checks.

Use `migrate` for now.
