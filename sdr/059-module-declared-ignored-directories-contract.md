# Module-Declared Ignored Directories Contract

## Status

Proposed

## Context

- SDR-003 makes each module own its entire mounted subtree and keeps stray markdown inside that subtree as a validation error.
- SDR-004 and SDR-005 intentionally kept the ignore surface narrow: reserved `AGENTS.md` and `CLAUDE.md` are ignored anywhere in the module tree, but general configurable ignore behavior was rejected because it could hide invalid records.
- ALS-116 surfaces a real operator need that the current contract cannot express cleanly: one module mounted at a parent path may legitimately contain explicitly non-record-bearing directories beside typed record directories.
- Research resolved the motivating contradiction: the Ghost-side top-level `section9/*.md` files can move under `section9/doctrine/`, so the language change only needs explicit directory-level carve-outs. File-level exceptions and globbing remain out of scope.

## Decision

- `module.ts` gains a top-level `ignored_directories: string[]` declaration on `defineModule(...)`.
- Each entry is a relative directory path inside the declaring module's mounted record root.
- Entries may use one or more slash-separated slug segments such as `"doctrine"` or `"meta/drafts"`.
- Entries must not be absolute, must not contain empty segments, `.`, `..`, hidden segments, or a trailing slash.
- Ignored directories remain owned by the declaring module. They are not reclassified as unowned space.
- Ignored directories are non-record-bearing for validation. Record discovery does not parse, infer, or validate record-like files beneath them.
- Record-like files beneath ignored directories count as ignored, not checked or failed, even if they would otherwise trigger uppercase-extension or parse diagnostics.
- The compiler rejects duplicate or overlapping ignored-directory declarations within one module.
- The compiler rejects any ignored-directory declaration that can contain records for a declared entity path template. The diagnostic must name the ignored directory and the conflicting entity path.
- Module mount-path overlap rules from SDR-003 remain unchanged. An ignored directory is not a valid escape hatch for mounting another module inside the parent module's subtree.
- A declared ignored directory that does not exist at validation time emits a warning, not an error. The declaration remains valid so operators can stage directory moves before the filesystem catches up.
- This refines SDR-003, SDR-004, and SDR-005 by adding one explicit authored directory-level carve-out while keeping file-level exceptions and globs rejected.

## Normative Effect

- Required: `ignored_directories` is declared in `module.ts`, not in `system.ts`.
- Required: every `ignored_directories` entry resolves relative to the declaring module's mounted record root.
- Required: every `.md` or `.jsonl` file inside the module mount that is not under an ignored directory and is not a reserved agent file must still validate or fail exactly as before.
- Required: ignored directories remain module-owned; ownership helpers must not treat them as outside the module.
- Required: the compiler rejects ignored directories that duplicate, overlap, or conflict with declared entity paths.
- Required: validation summaries count record-like files under ignored directories as ignored.
- Required: missing ignored directories surface an explicit warning.
- Allowed: multi-segment ignored-directory entries such as `"meta/drafts"`.
- Allowed: predeclaring an ignored directory before the operator has created or moved the directory, as long as the warning is accepted.
- Rejected: file-level ignore lists, filename exceptions, or glob syntax.
- Rejected: using ignored directories to weaken module mount-path overlap rules.
- Rejected: silently treating unmatched markdown under a module root as outside ALS validation.

## Compiler Impact

- Extend `moduleShapeSchema` and the authored module shape types to admit `ignored_directories`.
- Add module-shape validation for ignored-directory path syntax, duplicate or ancestor-descendant overlap, and entity-template conflicts.
- Carry ignored-directory metadata through `LoadedModuleContext` so discovery can suppress validation beneath declared ignored subtrees.
- Update record discovery to count ignored record-like files beneath ignored directories, suppress parse and extension-case diagnostics there, and emit a warning when a declared ignored directory is missing.
- Keep module ownership resolution unchanged: paths under ignored directories still resolve to the parent module.

## Docs and Fixture Impact

- Update the canonical shape-language reference to teach `module.ts` `ignored_directories`, its path rules, and the "owned but non-record-bearing" contract.
- Update naming and record-convention docs so reserved agent files are no longer the only explicit non-record exception.
- Add fixture coverage for:
  - positive ignored-directory examples such as `section9/doctrine/*.md`
  - deep ignored-directory examples such as `meta/drafts/`
  - stray markdown outside ignored directories still failing
  - ignored-directory/entity-path conflicts
  - duplicate or overlapping ignored-directory entries
  - missing ignored-directory warnings

## Alternatives Considered

- System-level `modules.<module_id>.ignored_directories` in `system.ts`.
- Rejected as the primary direction because it splits discovery policy away from the versioned entity contract that discovery is validating.

- Generalized discovery-policy surface or configurable ignore family.
- Rejected because ALS-116 needs one explicit directory-list carve-out, not a broad policy surface that reopens file exceptions or glob semantics.

- Top-level-only ignored directory names.
- Rejected because it forces over-broad carve-outs or renewed module fragmentation when the real non-record region is deeper in the subtree.
