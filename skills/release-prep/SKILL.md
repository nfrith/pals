---
name: release-prep
description: Architect-run release cut helper for ALS. Validates `CHANGELOG.md`, summarizes `## [Unreleased]`, computes the release headline class, prompts for version/date, and promotes the staged entries into a numbered release section.
allowed-tools: AskUserQuestion, Bash(bash *), Read, Edit
---

# release-prep

Prepare an ALS release from the staged `## [Unreleased]` changelog entries.

This is an architect-only SDLC workflow. It does not validate operator systems and it does not touch plugin versioning by itself. Its job is release-note preparation: validate the staged entries, compute the release headline class, ask for the release version/date, and rewrite `CHANGELOG.md` into the next numbered section while restoring an empty `## [Unreleased]`.

## Phase 1 — Validate the current staging area

Run the SDLC-side changelog inspector against the ALS repo:

```bash
bun ${CLAUDE_PLUGIN_ROOT}/alsc/compiler/src/cli.ts changelog inspect ${CLAUDE_PLUGIN_ROOT}
```

If the inspection output is anything other than `status: "pass"`, stop and repair `CHANGELOG.md` first. Do not promote an invalid staging area into a numbered release.

## Phase 2 — Read and summarize `## [Unreleased]`

Open `${CLAUDE_PLUGIN_ROOT}/CHANGELOG.md` and read the entries under `## [Unreleased]`.

If there are no `### ALS-XXX` entries there, stop and tell the architect: "There are no staged changelog entries to release."

For each staged entry, capture:

- job id
- compatibility class list
- summary
- operator action
- affected surfaces

## Phase 3 — Compute the release headline class

Read the canonical precedence order from the compiler contract so the skill does not drift:

```bash
bun -e "import { COMPATIBILITY_CLASS_RELEASE_HEADLINE_ORDER } from '${CLAUDE_PLUGIN_ROOT}/alsc/compiler/src/contracts.ts'; console.log(COMPATIBILITY_CLASS_RELEASE_HEADLINE_ORDER.join(' > '));"
```

Use that order exactly:

- `breaking_without_path`
- `migration_required`
- `refresh_required`
- `additive`
- `docs_only`

Collapse every staged job's class list into one release-level headline by choosing the most disruptive class that appears anywhere in `## [Unreleased]`.

Also prepare a grouped summary for the architect:

- one flat list of job ids per compatibility class
- the single release headline class

## Phase 4 — Ask for release identity

Ask the architect for:

1. Release version string
2. Release date (`YYYY-MM-DD`)

Before editing, show the grouped summary and the computed headline class so the architect can verify the release framing before promotion.

## Phase 5 — Promote `Unreleased` to the numbered section

Rewrite `${CLAUDE_PLUGIN_ROOT}/CHANGELOG.md` into this shape:

```md
# Changelog

For pre-2026-04-29 release history, see git tags.

## [Unreleased]

## <version> - <date>

### ALS-XXX
- Compatibility: ...
- Summary: ...
- Operator action: ...
- Affected surfaces: ...
```

Rules:

- The promoted numbered section goes immediately below `## [Unreleased]`.
- `## [Unreleased]` is left empty after promotion.
- Preserve each staged `### ALS-XXX` entry exactly as it appeared under `## [Unreleased]` unless the architect explicitly requested an edit in Phase 4.
- Do not backfill any pre-2026-04-29 history.

## Phase 6 — Re-validate and report

Run the changelog inspector again:

```bash
bun ${CLAUDE_PLUGIN_ROOT}/alsc/compiler/src/cli.ts changelog inspect ${CLAUDE_PLUGIN_ROOT}
```

If validation fails, repair the rewrite before finishing.

Final report:

- release version
- release date
- release headline class
- grouped job ids by compatibility class
- validation result (`pass`)

## Non-Goals

- Bumping `.claude-plugin/plugin.json`
- Pushing git refs or tags
- Publishing the RC or stable marketplace
- Editing job files outside the already-staged changelog entries
