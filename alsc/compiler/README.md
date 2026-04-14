# ALS Compiler

Bun-based validator for ALS systems. Validates module shapes, records, refs, and body structure, and manages Claude harness deploy artifacts under both `.als/` and `.claude/`.

This compiler is part of the [ALS plugin](../../README.md) and is invoked by plugin skills and hooks. It is not published as a standalone package.

## Commands

Validate an ALS system:

```bash
bun src/cli.ts validate <system-root>
bun src/cli.ts validate <system-root> <module-id>
```

Deploy active Claude harness assets from the validated ALS system:

```bash
bun src/cli.ts deploy claude <system-root>
bun src/cli.ts deploy claude --dry-run --require-empty-targets <system-root> <module-id>
```

When invoked through the plugin, skills call these via `bun ${CLAUDE_PLUGIN_ROOT}/alsc/compiler/src/index.ts`.

## Current Contract

- ALS currently supports `als_version: 1` only.
- Validation output is versioned as `als-validation-output@1`.
- Filtered validation remains trustworthy for the selected module by loading its declared dependency closure.
- Claude deploy is the only harness projection surfaced by this preview.
- Claude deploy manages one generated system-root file at `.als/CLAUDE.md` plus skill and Delamain projections under `.claude/`.
- ALS does not yet ship a language-version upgrade CLI or a real warning and deprecation lifecycle.

## Output Contract

The validator emits JSON shaped as `als-validation-output@1`. Claude deploy emits JSON shaped as `als-claude-deploy-output@4`.

- `schema` identifies the output contract version.
- `als_version` is the active ALS language version declared by `.als/system.yaml`.
- `module_filter` is `null` for full-system validation and the selected module id for filtered runs.
- `compiler_contract.supported_als_versions` lists the ALS language versions this compiler accepts today.
- `compiler_contract.upgrade_mode` is currently `whole-system-cutover`.
- `compiler_contract.upgrade_assistance` is currently `hybrid-assisted`.
- Diagnostics remain author-facing, but `code` and nullable `reason` are the machine-readable contract for automation.
- `reason` coverage is incremental; some diagnostics may still emit `null`.
- Claude deploy reports `planned_system_file_count`, `written_system_file_count`, and `planned_system_files` for generated system-root artifacts such as `.als/CLAUDE.md`.

## License

Elastic License 2.0 (ELv2). See [LICENSE](LICENSE).
