# Claude Deploy Generates System .als/CLAUDE.md

## Status

Accepted

## Context

- `alsc deploy claude` currently projects active ALS skills and Delamains into `.claude/`, but it does not generate any system-root guidance under `.als/`.
- Operators and Claude both need a canonical explanation of what `.als/` is, what lives there, and how it must be changed.
- Ghost previously carried a hand-authored `.als/CLAUDE.md` with Ghost-specific guidance, but that does not scale as an ALS-wide contract.
- Operator direction for this decision is explicit: every Claude-target deploy writes the file at `<system-root>/.als/CLAUDE.md`, the file is deploy-generated rather than authored, deploy always overwrites it with generic ALS-wide content, dry-run must report the planned write, and a write failure must fail deploy.

## Decision

- `alsc deploy claude` writes `<system-root>/.als/CLAUDE.md` as a system-level deploy artifact.
- The same rule applies to full-system and module-filter Claude deploys.
- The generated file content is canonical, generic, and system-agnostic. It explains that ALS owns `.als/`, manual edits are rejected, ALS skills are the path for customization, `.als/` contains ALS definitions such as shapes, Delamain bundles, skill definitions, and migration bundles, and the compiler reads `.als/` then projects runtime assets into `.claude/`.
- Claude deploy owns this file completely and overwrites any existing `<system-root>/.als/CLAUDE.md` on each deploy.
- Dry-run exposes the planned `.als/CLAUDE.md` write through `als-claude-deploy-output@4` using dedicated system-file reporting fields.
- If Claude deploy cannot create or refresh `<system-root>/.als/CLAUDE.md`, deploy fails.
- This file is a system-root deploy artifact, not authored ALS source syntax. No new `system.yaml`, `shape.yaml`, `delamain.yaml`, or record-frontmatter field is introduced by this decision.

## Normative Effect

- Required: every successful Claude-target deploy leaves `<system-root>/.als/CLAUDE.md` present with the canonical ALS-managed contents.
- Required: module-filter Claude deploys still write or refresh `<system-root>/.als/CLAUDE.md`.
- Required: deploy-generated `.als/CLAUDE.md` content is generic across ALS systems and does not interpolate system-specific instructions.
- Required: deploy overwrites a pre-existing `<system-root>/.als/CLAUDE.md` instead of preserving local edits.
- Required: dry-run reports that `.als/CLAUDE.md` would be written without creating or modifying the file.
- Required: inability to create or refresh `.als/CLAUDE.md` is a deploy failure, not a warning-only side effect.
- Allowed: future non-Claude harness deploys to define their own system-root guidance behavior in separate decisions.
- Allowed: the validator and authored shape surface to remain unchanged because `.als/CLAUDE.md` is outside the authored module discovery contract.
- Rejected: generating the file only during `/new`, `/change`, or another authoring workflow instead of Claude deploy.
- Rejected: preserving manual edits to `.als/CLAUDE.md` across deploy runs.
- Rejected: placing this guidance under `.claude/` while leaving `.als/` without a generated contract file.
- Rejected: best-effort warning-only behavior when `.als/CLAUDE.md` cannot be written.

## Compiler Impact

- Update Claude deploy planning and write logic so system-level projection includes generated `.als/CLAUDE.md` alongside the existing `.claude/` skill and Delamain projections.
- Extend the machine-readable deploy output contract to `als-claude-deploy-output@4` with `planned_system_file_count`, `written_system_file_count`, and `planned_system_files` entries for generated system-level files.
- Add deploy coverage for full-system deploy, module-filter deploy, dry-run reporting, canonical overwrite behavior, and write-failure behavior for `.als/CLAUDE.md`.
- Keep validator behavior unchanged unless implementation proves a separate system-root discovery rule is required.

## Docs and Fixture Impact

- Fixture review for this decision uses the reference-system root plus deploy tests and deploy output snapshots, not new `shape.yaml` or record syntax.
- The reference-system authored files `reference-system/.als/system.yaml` and module `shape.yaml` files remain unchanged in the fixture-first pass.
- Update deploy docs to say Claude deploy now manages one ALS-owned system-root file under `.als/` in addition to `.claude/` projections.
- Update the canonical shape-language reference to explain the generated system-root `.als/CLAUDE.md` contract without implying it is authored YAML syntax.

## Alternatives Considered

- Generate `.als/CLAUDE.md` only during system creation.
- Rejected because operator direction explicitly ties the file to the Claude deploy contract and requires refresh on every deploy.
- Treat `.als/CLAUDE.md` as an authored file committed and maintained by ALS developers per system.
- Rejected because the decision requires one generic generated message rather than per-system authorship.
- Preserve manual edits and only create the file when missing.
- Rejected because it conflicts with ALS ownership of the file and would make deploy output non-deterministic.
- Report the planned file only in human-readable stdout instead of the machine-readable deploy output.
- Rejected because operator direction requires dry-run to report the planned write as part of the deploy contract surface.

## Non-Goals

- Introducing system-specific templating or interpolation inside `.als/CLAUDE.md`.
- Creating a general registry for arbitrary system-root generated files.
- Changing non-Claude harness deploy behavior in this pass.
- Implementing compiler changes or tests before the fixture review is approved.
