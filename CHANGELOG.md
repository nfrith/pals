# Changelog

All notable changes to ALS preview releases should be recorded here.

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
