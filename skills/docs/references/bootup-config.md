# Bootup Configuration

Reference for the `.als/config.md` file — the operator's persistent boot configuration for an ALS system.

## Location

`.als/config.md` sits alongside `.als/system.ts` in the system root.

## Structure

A markdown file with YAML frontmatter (metadata) and freeform sections (operator preferences).

### Frontmatter

```yaml
---
system_id: ghost
created: 2026-04-10
updated: 2026-04-10
---
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `system_id` | string | yes | Must match `.als/system.ts` `system_id` |
| `created` | date | yes | When this config was created |
| `updated` | date | yes | Last modified date |

### Sections

#### Operator's Preferences

Freeform instructions that `/bootup` reads to determine how to start the system. This is where the operator describes their runtime environment and how delamains should be launched.

Examples of what goes here:
- How delamain dispatchers should be run (tmux windows, background processes, etc.)
- Naming conventions for dispatcher processes
- Environment-specific setup (ghost-tree, standalone terminal, etc.)
- Startup ordering preferences

The `/bootup` skill reads this section and executes accordingly. If the section is missing or empty, `/bootup` falls back to interactive configuration.

## Lifecycle

- Created by `/bootup` on first run (interactive setup) or manually by the operator
- Read by `/bootup` on every subsequent invocation
- Updated by the operator when their environment changes
- Not managed by `/change` or `/migrate` — this is operator-local configuration
