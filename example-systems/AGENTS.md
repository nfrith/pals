# Example Systems

This directory holds ALS reference systems and compiler fixtures.

## Merge Learnings

- `software-factory` stays standalone. Do not merge other example systems into it, and do not merge it into anything else.
- Prefer incremental merges into an existing host fixture instead of introducing a new combined system name too early.
- Preserve imported module ids, versions, entity names, and relative data paths during early consolidation. The safe first rewrite is the host `system_id` inside authored `als://...` refs because module ids and entity names are identity-significant public surfaces.
- Move or retarget tests before deleting a source fixture directory. The compiler suite is coupled to example-system directory names, relative fixture paths, and sometimes literal canonical refs.
- Keep rejected artifacts outside validated module subtrees after a merge so they remain documentation/examples, not live validation inputs.
- Append future merge-specific learnings here as consolidation continues.
