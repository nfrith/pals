# Delamain Dispatcher Reference

The dispatcher is a generic Bun application template that scans entity items and invokes Delamain-bound agents via the Claude Agent SDK. It requires zero configuration — everything is derived from the ALS declaration surface.

## Overview

The dispatcher template lives at `${CLAUDE_PLUGIN_ROOT}/skills/new/references/dispatcher/` and is copied into new delamain bundles during module creation. Once copied, it runs without modification for any delamain in any module.

## Source Files

### `src/index.ts`

Entry point. Handles:

- **System root discovery**: walks up directories from its own location looking for `.als/system.yaml`. Also respects the `SYSTEM_ROOT` environment variable.
- **Startup**: calls `resolve()` once to crawl the ALS declaration surface, then enters the poll loop.
- **Poll loop**: scans items at a configurable interval (`POLL_MS`, default 30s). Tracks active dispatches and releases items when their status changes.

### `src/watcher.ts`

Generic frontmatter parser and item scanner. Reads markdown files from the items directory and extracts `id` and `status` from YAML frontmatter. No ALS-specific knowledge — a pure filesystem scanner.

### `src/dispatcher.ts`

The core logic. Two main functions:

**`resolve(systemRoot)`** — crawls the ALS declaration surface:

1. Reads `system.yaml` → finds the first module
2. Reads `shape.yaml` → finds the entity with a `type: delamain` field
3. Reads the delamain primary definition file → loads states, transitions, agent files
4. Builds a dispatch table from `actor: agent` states

**`dispatch(itemId, itemFile, entry, agents, systemRoot)`** — invokes an agent:

1. Reads the agent's markdown file (frontmatter + body)
2. Composes the prompt: agent body + runtime context (item ID, current state, legal transitions)
3. Calls the Agent SDK `query()` directly with the agent's model, tools, and prompt
4. Handles resumable sessions: reads/writes session IDs to item frontmatter
5. Passes sub-agents via the SDK `agents` parameter when the state declares `sub-agent`

## How Configuration Is Derived

The dispatcher never reads a config file. Everything comes from the ALS declaration surface:

| What | Derived from |
|------|-------------|
| Module path | `system.yaml` → module entry → `path` |
| Items directory | Module path + entity path template dirname |
| Status field | Entity field with `type: delamain` |
| Legal states | Delamain primary definition → `states` |
| Dispatch rules | States where `actor: agent` and `path` is declared |
| Agent prompts | Markdown files at delamain-relative `path` |
| Legal transitions | Delamain primary definition → `transitions` filtered by source state |
| Session persistence | State `resumable` + `session-field` |
| Sub-agents | State `sub-agent` path |

## Path Resolution

Agent paths in `delamain.yaml` resolve relative to the directory containing the delamain primary definition file (the delamain bundle root), not relative to the module bundle root. This enables deployment to `.claude/delamains/` without path rewriting.

The `findSystemRoot` walk-up in `index.ts` makes the dispatcher work at any nesting depth — whether running from the original `.als/modules/` location or from a deployed `.claude/delamains/` location.

## Session Handling

States that declare `resumable: true` and `session-field: <field>` get automatic session persistence:

1. Before dispatch, the dispatcher reads the session field from item frontmatter.
2. If a session ID exists, it passes `resume: sessionId` to the SDK.
3. After a new session completes, the dispatcher writes the session ID back to the item's frontmatter field.
4. On subsequent dispatches to the same state, the session resumes where it left off.

Session fields are implicit — they are declared in `delamain.yaml`, not in `shape.yaml`.

## Sub-Agent Handling

When a state declares `sub-agent: <path>`, the dispatcher:

1. Loads the sub-agent markdown file from the delamain-relative path.
2. Passes it via the SDK's `agents` parameter as a named agent definition.
3. Adds `Agent` to the parent agent's allowed tools so it can invoke the sub-agent.

The sub-agent does not choose transitions — only the parent state agent decides which transition to take.

## Running the Dispatcher

```bash
cd <delamain-bundle>/dispatcher
bun install
bun run src/index.ts
```

Environment variables:

- `SYSTEM_ROOT` — override the system root (optional; auto-detected by default)
- `POLL_MS` — polling interval in milliseconds (default: 30000)

## Dependencies

- `@anthropic-ai/claude-agent-sdk` — for `query()` calls
- `yaml` — for YAML parsing
- Bun runtime
