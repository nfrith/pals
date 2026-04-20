# Delamain Dispatcher Reference

The dispatcher is a generic Bun application template that scans entity items and invokes Delamain-bound agents via the Claude Agent SDK. Its runtime identity comes from a compiler-generated `runtime-manifest.json` projected into each deployed Delamain bundle.

Each dispatch now runs inside its own isolated git worktree. The dispatcher owns the full lifecycle: create worktree, rewrite the bound item path into that worktree, run the SDK session with that worktree as `cwd`, auto-commit successful edits, serialize merge-back to the integration checkout, and preserve blocked or orphaned worktrees instead of silently dropping work.

## Audience

ALS Developer, ALS Architect, Claude.

## Overview

The dispatcher template lives at `${CLAUDE_PLUGIN_ROOT}/skills/new/references/dispatcher/` and is copied into new Delamain bundles during module creation. Once copied, it runs without modification for any deployed Delamain bundle in any module.

The canonical template exposes its latest template version in `${CLAUDE_PLUGIN_ROOT}/skills/new/references/dispatcher/VERSION`. Every copied dispatcher bundle carries a local `dispatcher/VERSION` file. Startup reads both files, logs `[dispatcher] version: X (latest: Y)`, and appends `run /upgrade-dispatchers to update` when the local version is stale. Missing or malformed local or canonical `VERSION` files are hard startup errors.

Every dispatcher entrypoint begins with `import "./preflight.js";`. That sibling module deletes `process.env.ANTHROPIC_API_KEY` before the Claude Agent SDK loads, which keeps plain `bun run src/index.ts` on Max-subscription routing instead of cached API-key billing.

When a Delamain bundle is deployed to `.claude/delamains/<name>/`, later `alsc deploy claude` runs refresh `dispatcher/` from the canonical dispatcher template while preserving an existing `dispatcher/node_modules/` directory. Deploy itself does not install packages. If dependencies have never been installed in the deployed target, deploy warns and leaves installation as an explicit `bun install` step.

The deployed bundle root also receives `runtime-manifest.json`. That manifest is the authoritative binding contract for the runtime:

- which module mount path to scan
- which entity path template to match
- which frontmatter field is the Delamain-bound status field
- which discriminator field/value, if any, constrain the binding
- which repo-relative submodules, if any, should be mounted as nested worktrees inside the host worktree

Submodule declarations come from an optional authored sidecar at the Delamain bundle root:

- `runtime-manifest.config.json`
- current supported field: `submodules: string[]`
- values are repo-relative paths such as `nfrith-repos/als`

The dispatcher is supported from deployed `.claude/delamains/<name>/` bundles. Running it directly from authored `.als/modules/.../delamains/.../dispatcher` is not part of the runtime contract because authored bundles do not carry the generated manifest.

## Telemetry Files

The dispatcher now emits three runtime surfaces per deployed Delamain bundle:

- `status.json` — the small compatibility heartbeat for liveness, PID checks, poll cadence, direct active dispatch count, scanned item count, and current delegated handoffs
- `runtime/worktree-state.json` — the current runtime registry for active, blocked, orphaned, guarded, and delegated dispatch ownership
- `telemetry/events.jsonl` — the bounded recent activity log for dashboard history

`telemetry/events.jsonl` is append-only at the contract level, but the writer keeps only the most recent bounded window of events so the file does not grow without limit. Each event is a single JSON object using schema `als-delamain-telemetry-event@1`.

Recent telemetry events include:

- dispatch start
- worktree prepared
- dispatch finish
- dispatch failure
- merge success
- merge blocked
- cleanup

Each event records the Delamain name, module id, dispatch id, item id, current state, agent identity, resume metadata, worktree path and branch, merge outcome, transition targets, duration, turn count, cost, and error text when present.
Submodule-targeting events also carry `mounted_submodules`, which records each mounted repo path plus its mounted worktree path and any worktree/integrated commit SHAs known at that point in the lifecycle.

Older dispatcher copies that only emit `status.json` remain valid. Consumers must degrade to heartbeat-only mode instead of failing when `telemetry/events.jsonl` is absent.

## Source Files

### `src/index.ts`

Entry point. Handles:

- **Auth preflight**: imports `src/preflight.ts` as the literal first line so the Claude Agent SDK never sees `ANTHROPIC_API_KEY` during module evaluation.
- **System root discovery**: walks up directories from its own location looking for `.als/system.ts`. Also respects the `SYSTEM_ROOT` environment variable.
- **Template version check**: reads local `dispatcher/VERSION` and canonical `${CLAUDE_PLUGIN_ROOT}/skills/new/references/dispatcher/VERSION`, logs the current/latest versions, and fails before polling when either source is missing or malformed.
- **Startup**: calls `resolve()` once to load `runtime-manifest.json`, local `delamain.yaml`, and state-agent files, then enters the poll loop.
- **Runtime boot**: creates one `DispatcherRuntime`, runs orphan sweep at startup, and keeps the persisted dispatch registry as the source of truth for active, blocked, orphaned, guarded, and delegated ownership.
- **Poll loop**: scans items at a configurable interval (`POLL_MS`, default 30s). Reads committed `HEAD` state only, warns when a status transition exists in the checkout but not in `HEAD`, reconciles registry records against current item status, suppresses redispatch for unresolved incidents, runs periodic orphan sweeping, and refreshes the heartbeat after dispatch completions.
- **Runtime hardening**: keeps the event loop alive with an internal keepalive server, logs tick and process lifecycle events, and ignores stray `SIGTERM` so dispatcher children do not accidentally kill the parent runtime.

### `src/preflight.ts`

Auth-strip shim.

- Deletes `process.env.ANTHROPIC_API_KEY` before any SDK import executes
- Protects plain `bun run` entrypoints from the SDK's module-init auth capture
- Keeps the later `sdkEnv` clone aligned with the already-stripped process environment

### `src/dispatcher-runtime.ts`

Runtime coordinator for isolated dispatch execution.

- Creates per-dispatch worktrees
- Owns the persisted dispatch registry
- Finalizes successful and failed dispatches
- Holds the repo-mutation lease during merge-back
- Produces heartbeat counts for active, blocked, orphaned, guarded, and delegated runtime state

### `src/dispatch-registry.ts`

Persistent registry over `runtime/worktree-state.json`.

- Stores the current dispatch/worktree owner for each item
- Survives dispatcher restarts
- Suppresses redispatch for blocked or orphaned incidents
- Releases guards when an item's status changes
- Preserves mounted submodule worktree metadata for active, blocked, and orphaned dispatches

### `src/git-worktree-isolation.ts`

Git-backed isolation strategy.

- Creates per-dispatch branches named `delamain/<dispatcher>/<item>/<dispatch-id>`
- Creates host worktrees under `~/.worktrees/delamain/<dispatcher>/<item>/<dispatch-id>/`
- Mounts any declared `runtime-manifest.json.submodules` as nested git worktrees at the same repo-relative paths inside that host worktree
- Rewrites bound item paths into the isolated workspace
- Auto-commits mounted submodule worktrees first, cherry-picks them into their primary clones, repoints the mounted checkout to the integrated SHA, then commits and cherry-picks the host worktree
- Rolls back already-integrated primary clones if a later repo in the merge transaction fails, leaving the host worktree and mounted submodule worktrees preserved for inspection

### `src/repo-mutation-lock.ts`

Cross-process integration lease.

- Serializes merge-back into the integration checkout
- Sweeps stale locks left by dead dispatcher processes

### `src/orphan-sweeper.ts`

Recovery helper for stale active dispatches.

- Removes pristine stale worktrees automatically
- Preserves dirty or committed stale worktrees as orphaned incidents
- Leaves operator-visible incident state instead of deleting ambiguous work

### `src/dispatch-lifecycle.ts`

Legacy in-memory lifecycle helper retained for compatibility tests. The persisted runtime registry is now the authoritative ownership mechanism.

### `src/watcher.ts`

Generic frontmatter parser and item scanner. Recursively walks the bound module root, matches concrete markdown file paths against the bound entity path template, and reads the Delamain-bound status field named in `runtime-manifest.json`.

### `src/dispatcher.ts`

The core logic. Two main functions:

**`resolve(bundleRoot, systemRoot)`** — loads the bundle-local runtime contract:

1. Reads `runtime-manifest.json` from the deployed Delamain bundle root
2. Reads local `delamain.yaml`
3. Loads state-agent and sub-agent markdown files from the same deployed bundle
4. Builds a dispatch table from `actor: agent` states

**`dispatch(itemId, itemFile, entry, agents, config, bundleRoot, runtime)`** — invokes an agent:

1. Claims a persisted dispatch slot and creates an isolated worktree
2. Rewrites the bound `item_file` into that worktree and adds worktree metadata to Runtime Context
3. Calls the Agent SDK `query()` with the worktree as `cwd`
4. Handles direct and delegated session behavior: reads session metadata, resumes direct SDK sessions, and skips SDK resume plus auto-persist for delegated states
5. Finalizes through the runtime: auto-commit worktree changes, merge back under the repo-mutation lease, clean up on success, or preserve blocked/orphaned worktrees when integration is unsafe

### `src/runtime-manifest.ts`

Runtime manifest loader and validator.

- Reads `runtime-manifest.json` from the deployed bundle root
- Validates the manifest schema and required binding fields
- Normalizes the optional `submodules` list to `[]` when absent
- Fails closed with a redeploy message when the manifest is missing or malformed

### `src/dispatcher-version.ts`

Dispatcher template version loader and formatter.

- Reads local `dispatcher/VERSION` from the deployed bundle root
- Reads canonical latest version from `${CLAUDE_PLUGIN_ROOT}/skills/new/references/dispatcher/VERSION`
- Accepts positive integers only
- Formats the startup version line and stale-version upgrade instruction

### `src/session-runtime.ts`

Pure helper logic for session handling:

- Builds the runtime `resume`, `session_field`, and `session_id` contract from authored Delamain state data plus any stored session value
- Distinguishes direct SDK-resumable states from delegated externally managed worker sessions
- Centralizes the rule for whether the dispatcher should persist its own SDK session id

### `src/telemetry.ts`

Structured telemetry writer and reader.

- Resolves the deployed telemetry path at `telemetry/events.jsonl`
- Normalizes telemetry events under schema `als-delamain-telemetry-event@1`
- Serializes concurrent writes inside the dispatcher process
- Enforces bounded retention so only the most recent events remain on disk
- Lets downstream consumers detect heartbeat-only legacy dispatchers when the file is absent

### `src/runtime-state.ts`

Shared reader/writer for `runtime/worktree-state.json`.

- Normalizes persisted dispatch/worktree records
- Lets dashboard consumers inspect current active, blocked, orphaned, guarded, and delegated state
- Gives the dispatcher registry a single on-disk contract

## How Configuration Is Derived

The dispatcher reads one generated runtime manifest plus the local Delamain bundle:

| What | Derived from |
|------|-------------|
| Module path | `runtime-manifest.json` → `module_mount_path` |
| Entity path template | `runtime-manifest.json` → `entity_path` |
| Status field | `runtime-manifest.json` → `status_field` |
| Variant discriminator | `runtime-manifest.json` → `discriminator_field` + `discriminator_value` |
| Mounted nested repos | `runtime-manifest.json` → `submodules[]` |
| Legal states | Delamain primary definition → `states` |
| Dispatch rules | States where `actor: agent` and `path` is declared |
| Agent prompts | Markdown files at delamain-relative `path` |
| Legal transitions | Delamain primary definition → `transitions` filtered by source state |
| Session handling | State `resumable` + `delegated` + `session-field` |
| Sub-agents | State `sub-agent` path |
| Local dispatcher template version | `dispatcher/VERSION` |
| Latest dispatcher template version | `${CLAUDE_PLUGIN_ROOT}/skills/new/references/dispatcher/VERSION` |

Hosts generate `runtime-manifest.json` during Claude projection. One deployed Delamain bundle owns exactly one effective binding. Reusing the same Delamain name across multiple effective bindings is a deploy-planning error.

## Path Resolution

Agent paths in `delamain.yaml` resolve relative to the directory containing the Delamain primary definition file (the deployed bundle root), not relative to the module bundle root.

The `findSystemRoot` walk-up in `index.ts` makes the dispatcher work at any nesting depth under a deployed `.claude/delamains/<name>/` bundle.

## Dashboard Contract

`nfrith-repos/als/delamain-dashboard/` is the canonical monitoring consumer for dispatcher runtime state.

The dashboard service reads:

- `status.json` for liveness and current delegated handoffs
- `runtime/worktree-state.json` for active worktree ownership plus blocked/orphaned incidents, including any mounted submodule worktrees
- `telemetry/events.jsonl` for recent run history and failures
- `runtime-manifest.json` for bundle identity and item binding
- `delamain.yaml` for phase and actor context
- current item files for queue state

The localhost web UI and the OpenTUI client both consume the same service snapshot. They do not each re-implement discovery or scan the filesystem independently.

## Session Handling

Session fields are implicit — they originate in authored `delamain.ts` and are projected into runtime `delamain.yaml`, not declared in `module.ts`.

### Direct resumable dispatch

States that declare `resumable: true` and omit `delegated` (or declare `delegated: false`) get automatic Agent SDK session persistence:

1. Before dispatch, the dispatcher reads the session field from item frontmatter.
2. If the stored value is a valid Agent SDK session id, it passes `resume: sessionId` to the SDK.
3. After a new SDK session completes, the dispatcher writes that SDK session id back to the item's frontmatter field.
4. On subsequent dispatches to the same state, the SDK session resumes where it left off.

### Delegated dispatch

States that declare `delegated: true` are treated as orchestrators for externally managed work:

1. The dispatcher still reads the authored `session-field` value when one exists.
2. The dispatcher exposes `session_field` and `session_id` in Runtime Context so the state agent can inspect or manage the delegated worker lifecycle.
3. The dispatcher does not pass `resume` to the Agent SDK for delegated states.
4. The dispatcher does not auto-persist the dispatcher-owned Agent SDK session id back into the item's `session-field`.

If a delegated state has no declared `session-field`, Runtime Context still includes `session_field: null` and `session_id: null`.

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

`bun install` is the bootstrap step for a new deployed dispatcher. It is not part of the normal redeploy contract once `dispatcher/node_modules/` already exists.

Environment variables:

- `SYSTEM_ROOT` — override the system root (optional; auto-detected by default)
- `POLL_MS` — polling interval in milliseconds (default: 30000)
- `CLAUDE_PLUGIN_ROOT` — installed ALS plugin root used to read the canonical dispatcher `VERSION` file (required)

If `dispatcher/VERSION`, `CLAUDE_PLUGIN_ROOT`, the canonical dispatcher `VERSION`, or `runtime-manifest.json` is missing or invalid, the dispatcher fails closed before polling. Stale but readable dispatcher versions continue running and instruct the operator to run `/upgrade-dispatchers`.

## Heartbeat Shape

`status.json` always keeps these compatibility fields:

- `name`
- `pid`
- `last_tick`
- `poll_ms`
- `active_dispatches`
- `items_scanned`

Delegation-aware dispatchers add:

- `blocked_dispatches` — current count of blocked merge or cleanup incidents
- `orphaned_dispatches` — current count of preserved orphaned worktrees
- `guarded_dispatches` — current count of successful same-state direct runs still guarded against redispatch
- `delegated_dispatches` — current number of delegated items still owned by external workers
- `delegated_items` — array of `{ item_id, state, delegated_at }` objects for the live delegated handoffs

Older consumers that only read the compatibility fields remain valid.

## Dependencies

- `@anthropic-ai/claude-agent-sdk` — for `query()` calls
- `yaml` — for YAML parsing
- Bun runtime
