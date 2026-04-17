# Delamain Dashboard

Operational dashboard for ALS Delamain dispatchers.

Both the web UI and the TUI consume the same snapshot feed from the local dashboard service. The TUI is the primary operator surface and is designed for both full-screen terminals and a narrow tmux pane.

## Modes

- `bun run service --system-root ../reference-system`
  Starts the localhost dashboard service and serves the web UI plus the canonical snapshot feed.
- `bun run tui --service-url http://127.0.0.1:4646`
  Starts the live OpenTUI client against an already-running local service.
- `bun run smoke:design`
  Renders deterministic wide overview + detail fixture frames for design review.
- `bun run smoke:design:compact`
  Renders deterministic compact overview + detail fixture frames at a narrow width breakpoint.

## Breakpoints

- `compact`: width under `60` columns, or very short terminals
- `standard`: width `60-99`
- `wide`: width `100+`

Compact mode is width-first. The smoke fixture keeps the terminal tall enough to show the full detail stack while preserving the narrow-pane width constraint.

## Keybindings

- `j/k`: move between dispatchers in overview, or move inside the detail item list
- `Enter`: open dispatcher detail from overview
- `Esc`: return to overview
- `r`: refresh
- `q`: quit

## Wireframes

### Wide Overview

```text
Delamain Dashboard • overview • 4 dispatchers
LIVE 1 • IDLE 1 • STALE 1 • ERROR 1 • spend $1.20 • 1 active • updated Apr 17 10:20:00 UTC
────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
┌────────────────────────────────────────────────────────┐ ┌─────────────────────────────────────────────────────────┐
│ [LIVE] als-factory-jobs                                │ │ [IDLE] ghost-factory-jobs                               │
│ als-factory • HB 4s • poll 2s                          │ │ ghost-factory • HB 11s • poll 3s                        │
│ 1 active • 15 tracked • 15 scanned                     │ │ 0 active • 4 tracked • 9 scanned                        │
│ ▶ ALS-006 research (45s, cost pending, 8 turns)        │ │ draft(1) → dev(1) → review(1) → done(1)                 │
│ Spend $0.55 • 2 metered runs • 1 active dispatch       │ │ Spend $0.16 • 1 metered run • Dispatcher is idle        │
└────────────────────────────────────────────────────────┘ └─────────────────────────────────────────────────────────┘
┌────────────────────────────────────────────────────────┐ ┌─────────────────────────────────────────────────────────┐
│ [STALE] research-pipeline                              │ │ [ERROR] ops-incident-feed                               │
│ research • HB 2m 5s • poll 5s                          │ │ ops • HB 16s • poll 4s                                  │
│ 0 active • 4 tracked • 7 scanned                       │ │ 0 active • 3 tracked • 5 scanned                        │
│ draft(0) → research(2) → review(1) → done(1)           │ │ triage(0) → investigate(1) → review(1) → done(1)        │
│ Spend $0.00 • 0 metered runs • Heartbeat is older than │ │ Spend $0.49 • 1 metered run • Last run failed on OPS-   │
│ 60000ms                                                │ │ 221                                                     │
└────────────────────────────────────────────────────────┘ └─────────────────────────────────────────────────────────┘
────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
j/k move • Enter detail • r refresh • q quit • http://127.0.0.1:4646
```

### Compact Overview

```text
Delamain Dashboard • overview • 4 dispatchers
LIVE 1 • IDLE 1 • STALE 1 • ERROR 1 • $1.20
────────────────────────────────────────────────
┌─────────────────────────────────────────────┐
│ [LIVE] als-factory-jobs                     │
│ als-factory • 4s hb                         │
│ 15 tracked • 1 active                       │
│ ALS-006 research 45s                        │
│ Spend $0.55 • 2 metered runs • 1 active     │
│ dispatch                                    │
└─────────────────────────────────────────────┘
┌─────────────────────────────────────────────┐
│ [IDLE] ghost-factory-jobs                   │
│ ghost-factory • 11s hb                      │
│ 4 tracked • 0 active                        │
│ dft(1) → dev(1) → rev(1) → done(1)          │
│ Spend $0.16 • 1 metered run • Dispatcher is │
│ idle                                        │
└─────────────────────────────────────────────┘
```

### Detail

```text
Delamain Dashboard • als-factory-jobs
LIVE • als-factory • HB 4s • poll 2s • Spend $0.55 • 2 metered runs
────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
┌─Meta─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ als-factory • job • jobs/{id}.md                                                                                     │
│ Mount workspace/factory • v4                                                                                         │
│ HB 4s • poll 2s                                                                                                      │
│ Spend $0.55 • 2 metered runs                                                                                         │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
┌─Recent───────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ PASS • ALS-003 • planning → in-dev • 1m 34s • $0.34                                                                  │
│ PASS • ALS-002 • research → planning • 1m 3s • $0.21                                                                 │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
┌─Pipeline─────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ draft(3) → research(1) → planning(0) → dev(1) → review(0) → uat(2) → done(8)                                         │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
┌─Active───────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ ▶ ALS-006 research (45s, cost pending, 8 turns)                                                                      │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
┌─Items────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ ▶ [drafted] 3                                                                                                        │
│   draft                                                                                                              │
│     ALS-001                                                                                                          │
│   drafted • draft • job                                                                                              │
│     ALS-004                                                                                                          │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
j/k items • Esc back • r refresh • q quit • http://127.0.0.1:4646
```

## Canonical Feed

The dashboard service reads dispatcher runtime state from:

- `.claude/delamains/*/status.json` for liveness
- `.claude/delamains/*/telemetry/events.jsonl` for recent dispatch history
- `runtime-manifest.json` and `delamain.yaml` for bundle metadata and pipeline definitions
- current module items for queue state

Both the web UI and the TUI consume the same service snapshot instead of rescanning the filesystem independently.
