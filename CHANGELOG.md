# Changelog

For pre-2026-04-29 release history, see git tags.

## [Unreleased]

### ALS-058
- Compatibility: refresh_required, additive
- Summary: Promote the 5-class compatibility vocabulary into a compiler-owned primitive (`COMPATIBILITY_CLASSES`, per-class metadata, release-headline precedence + helpers), add an SDLC-side `alsc changelog inspect` command with a structured `CHANGELOG.md` baseline and a `/release-prep` skill, and insert a `uat → changelog → changelog-gate → (changelog-input | done)` lifecycle on the als-factory delamain so every job stages a typed `compatibility_classes` list and a matching `### ALS-XXX` entry under `## [Unreleased]` before reaching `done`.
- Operator action: rerun `alsc deploy claude` (or the equivalent install/refresh) to pick up the new als-factory module shape, the `changelog` / `changelog-gate` / `changelog-input` states and their agents, the updated `als-factory-console` skill, and the new `alsc changelog inspect` + `/release-prep` surfaces. No data migration required; existing job files were backfilled with `compatibility_classes: null`.
- Affected surfaces: `nfrith-repos/als/alsc/compiler/src/contracts.ts`, `nfrith-repos/als/alsc/compiler/src/cli.ts`, `nfrith-repos/als/alsc/compiler/src/changelog.ts`, `.als/authoring.ts`, `nfrith-repos/als/reference-system/.als/authoring.ts`, `.als/modules/als-factory/v1/module.ts`, `.als/modules/als-factory/v1/delamains/als-factory-jobs/delamain.ts`, `.als/modules/als-factory/v1/delamains/als-factory-jobs/agents/changelog.md`, `.als/modules/als-factory/v1/delamains/als-factory-jobs/agents/changelog-gate.md`, `.als/modules/als-factory/v1/skills/als-factory-console/SKILL.md`, `nfrith-repos/als/CHANGELOG.md`, `nfrith-repos/als/skills/release-prep/SKILL.md`, `nfrith-repos/als/sdr/032-compatibility-classification-contract.md`, `nfrith-repos/als/sdr/033-changelog-lifecycle-and-release-staging.md`, `als-factory/docs/release-model/update-mechanics/version-policy.md`, `als-factory/docs/release-model/architect-flow.md`
