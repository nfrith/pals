# Example Systems

This directory holds ALS reference systems and compiler fixtures.

## Merge Learnings

- A fixture that happens to showcase Delamain behavior still merges like any other module fixture. Move the canonical `.als` bundle into the host instead of preserving a per-fixture standalone exception.
- Prefer incremental merges into an existing host fixture instead of introducing a new combined system name too early.
- Preserve imported module ids, versions, entity names, and relative data paths during early consolidation. The safe first rewrite is the host `system_id` inside authored `als://...` refs because module ids and entity names are identity-significant public surfaces.
- When two fixtures collide on a module id, choose one canonical bundle explicitly and adapt the other fixture's records and tests to that contract. Do not keep two divergent contracts under one live module id.
- Preserve downstream projections that are already checked in alongside the canonical `.als` bundles. If a source fixture has `.claude/skills/` or `.claude/delamains/`, move that projection with the module bundles instead of dropping it during cleanup.
- Do not carry vendored runtime dependencies from downstream projections during merges. Keep authored source and lightweight checked-in projection files, but drop trees such as `dispatcher/node_modules/`.
- Move or retarget tests before deleting a source fixture directory. The compiler suite is coupled to example-system directory names, relative fixture paths, and sometimes literal canonical refs.
- Keep rejected artifacts outside validated module subtrees after a merge so they remain documentation/examples, not live validation inputs.
- Append future merge-specific learnings here as consolidation continues.
