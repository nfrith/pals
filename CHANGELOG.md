# Changelog

All notable changes to ALS preview releases should be recorded here.

## Unreleased

- Added first-class Delamain support to the ALS compiler:
  - `type: delamain` fields bound through a module `delamains` registry
  - Delamain bundle loading, graph validation, and state-owned agent validation
  - implicit resumable `session-field` synthesis on effective entity schemas
- Accepted and documented SDR 018 and SDR 020 as the current Delamain contract.
- Merged the former `software-factory` example fixture into `example-systems/rich-body-content/`, which now carries the Delamain design and compiler reference surface.
- Extended `alsc deploy claude` from skill-only projection to full Claude projection:
  - active skills still project to `.claude/skills/`
  - bound Delamain bundles now project to `.claude/delamains/`
  - deploy now reports Delamain target collisions and flat-name conflicts
- Added compiler and deploy test coverage for Delamain validation and Claude projection behavior.

## 0.1.0-beta.1 - 2026-03-29

First public beta research preview.

- ALS distributed as a Claude Code plugin with validation and deploy skills
- `alsc validate` for ALS system validation with machine-readable JSON output
- `alsc deploy claude` for Claude skill projection
- PostToolUse hook validates affected module on file edits
- Stop hook gates Claude from finishing while validation errors remain
- explicit research-preview policy and contribution guidance
- CI workflow and structured GitHub issue templates

Compatibility note:

- authored-source compatibility is not guaranteed across preview releases
- manual rewrites may be required while ALS is still in preview
