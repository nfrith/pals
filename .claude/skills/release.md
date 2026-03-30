---
name: release
description: Walk through the ALS preview release checklist. Use when preparing to tag and publish a new preview release.
---

# release

Walk through the release checklist for an ALS preview release.

## Before tagging

Run through each item and confirm or fix:

1. Bump the compiler preview version in `alsc/compiler/package.json`.
2. Match the version in `.claude-plugin/plugin.json`.
3. Run `bun test` in `alsc/compiler/` — all tests must pass.
4. Confirm the CLI help text (`bun alsc/compiler/src/cli.ts --help`) still matches the docs in `alsc/compiler/README.md` and the root `README.md`.
5. Update `CHANGELOG.md` with a new entry for this version.
6. Review `RESEARCH-PREVIEW.md` for any contract changes since the last release.
7. Check that no public doc implies stability guarantees the preview does not provide.

## Release notes

Draft release notes that call out:

- the preview version
- the supported public surface
- known missing lifecycle features
- any authored-source breakage from the previous preview
- any manual rewrite expectations

## After publishing

Verify the plugin works end-to-end:

1. Install the plugin fresh into a clean Claude Code session.
2. Run `/validate` against a reference system in `example-systems/`.
3. Run a deploy dry-run via the deploy skill.
4. Edit a file inside an ALS system and confirm the PostToolUse hook fires validation.
5. Confirm the Stop hook blocks if validation errors exist.
6. Watch GitHub issues for install failures and authored-system breakage reports.
