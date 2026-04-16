# Delamain Dashboard

Local monitoring surface for ALS Delamain dispatchers.

## Modes

- `bun run src/index.ts service --system-root ../reference-system`
  Starts the localhost dashboard service and serves the web UI plus the canonical snapshot feed.
- `bun run src/index.ts tui --service-url http://127.0.0.1:4646`
  Starts the OpenTUI client against an already-running local service.

## Canonical Feed

The dashboard service reads dispatcher runtime state from:

- `.claude/delamains/*/status.json` for liveness
- `.claude/delamains/*/telemetry/events.jsonl` for recent dispatch history
- `runtime-manifest.json` and `delamain.yaml` for bundle metadata
- current module items for queue state

Both the web UI and the TUI consume the same service snapshot instead of rescanning the filesystem independently.
