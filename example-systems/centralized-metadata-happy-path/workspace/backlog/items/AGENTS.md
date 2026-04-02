# backlog/items/

This is where individual work items live as `ITEM-NNNN.md` files.

## Working With Items

The `type` field is the first decision. Everything downstream — available sections, valid statuses, what the item even means — flows from that choice. Read the variant before writing anything.

Research items are not app items with different labels. Research items have HYPOTHESIS and FINDINGS. App items have REQUIREMENTS and ARCHITECTURE. Don't mix them.
`status` is variant-scoped even though every current variant has one. App items also carry app-only frontmatter. In this fixture that includes `delivery_track`, `target_release`, `design_doc`, `launch_date`, `reviewer_refs`, and `success_metrics`. Treat those as part of the app contract, not optional notes.

## Refs

All person references use the inline link format: `[display name](als://centralized-happy-path/people/person/PPL-NNNNNN)`. Owner is required. Collaborators are optional but should be real people doing real work on the item, not a CC list.

## Activity Log

Append only. Format: `- YYYY-MM-DD: what happened`. One line per entry. This is the item's memory — if it's not in the log, it didn't happen.
