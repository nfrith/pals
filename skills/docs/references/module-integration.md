# Module Integration

Reference for wiring delamains, skills, and dispatchers into a cohesive module surface. Covers naming conventions, the deploy pipeline, and how the pieces connect.

## Audience

ALS Developer, ALS Architect, Claude.

## Skill Naming Convention

Skills tied to a delamain pipeline follow the pattern:

```
{module}-{variant}-{delamain}
```

Examples:
- `backlog-app-development-pipeline` — operator console for the backlog module's app variant
- `factory-work-item-development-pipeline` — if the factory module had variants

For modules without variants (single entity type), the variant segment is omitted:
- `factory-operate` — operator console for the factory module

This convention ensures:
- The module is identified at a glance
- The variant scope is clear
- The delamain name is explicit
- No collisions when a module has multiple variants with different delamains

## How Skills Connect to Delamains

A module with a delamain typically has three skill layers:

| Layer | Purpose | Example |
|-------|---------|---------|
| **CRUD** | Create, read, update, close entities | `backlog-manage`, `backlog-inspect` |
| **Pipeline console** | Operator attention queue + actions | `backlog-app-development-pipeline` |
| **Delamain agents** | Automated state transitions | Dispatched by the dispatcher, not invoked as skills |

The pipeline console skill is the operator's interface to the delamain. It surfaces items in operator-owned states and presents context-specific actions. It does not invoke delamain agents directly — the dispatcher handles that.

## Reference Files in Pipeline Skills

Complex actions within the pipeline console (like the plan-input Q&A flow) are stored as reference files within the skill:

```
skills/backlog-app-development-pipeline/
├── SKILL.md
├── scan.sh
└── references/
    └── plan-input.md
```

The SKILL.md procedure says "Follow the procedure in references/plan-input.md" for that action. This keeps the main skill focused and the sub-procedures modular.

## The Deploy Pipeline

`alsc deploy claude` projects active ALS assets into `.claude/`:

```
.als/modules/backlog/v2/
├── skills/
│   ├── backlog-manage/        →  .claude/skills/backlog-manage/
│   ├── backlog-inspect/       →  .claude/skills/backlog-inspect/
│   └── backlog-app-.../       →  .claude/skills/backlog-app-.../
└── delamains/
    └── development-pipeline/  →  .claude/delamains/development-pipeline/
```

**Important**:
- Skill deploy under `.claude/skills/` still overwrites the target directory completely.
- Delamain deploy under `.claude/delamains/<name>/` refreshes authored files via merge projection so an existing `dispatcher/node_modules/` survives.
- Delamain deploy does not run `bun install` or any other package-manager command.
- If the deployed dispatcher has no installed dependencies yet, deploy warns and continues.
- Merge projection may leave stale authored files or incidental runtime files in the deployed Delamain target.

## Dispatcher as Copy-From-Template

Never hand-write a dispatcher. The template lives at `${CLAUDE_PLUGIN_ROOT}/skills/new/references/dispatcher/` and is copied into new delamain bundles:

```bash
cp -R ${CLAUDE_PLUGIN_ROOT}/skills/new/references/dispatcher/ \
  .als/modules/{module}/v{N}/delamains/{delamain}/dispatcher/
```

When the template improves, all consumers update by re-copying:

```bash
cp -R template/src/ target/dispatcher/src/
```

This ensures all dispatchers stay consistent with the latest features (multi-module support, variant scanning, OAuth, UUID validation, session context injection).

<!-- UPDATE THIS MAP when drift is discovered between the template and its targets. -->

### Dispatcher Targets

| Target | Path |
|--------|------|
| Template (canonical) | `skills/new/references/dispatcher/src/` |
| incident-lifecycle (deployed) | `reference-system/.claude/delamains/incident-lifecycle/dispatcher/src/` |
| release-lifecycle (deployed) | `reference-system/.claude/delamains/release-lifecycle/dispatcher/src/` |
| postmortem-lifecycle (deployed) | `reference-system/.claude/delamains/postmortem-lifecycle/dispatcher/src/` |
| run-lifecycle (deployed) | `reference-system/.claude/delamains/run-lifecycle/dispatcher/src/` |
| development-pipeline (deployed) | `reference-system/.claude/delamains/development-pipeline/dispatcher/src/` |
| incident-lifecycle (module source) | `reference-system/.als/modules/incident-response/v1/delamains/incident-lifecycle/dispatcher/src/` |
| release-lifecycle (module source) | `reference-system/.als/modules/infra/v1/delamains/release-lifecycle/dispatcher/src/` |
| postmortem-lifecycle (module source) | `reference-system/.als/modules/postmortems/v1/delamains/postmortem-lifecycle/dispatcher/src/` |
| run-lifecycle (module source) | `reference-system/.als/modules/experiments/v2/delamains/run-lifecycle/dispatcher/src/` |
| development-pipeline (module source) | `reference-system/.als/modules/factory/v1/delamains/development-pipeline/dispatcher/src/` |

## system.yaml Registration

Skills are registered in `system.yaml` under the module:

```yaml
modules:
  backlog:
    path: backlog
    version: 2
    skills:
      - backlog-manage
      - backlog-inspect
      - backlog-app-development-pipeline
```

Delamains are registered in `shape.yaml`:

```yaml
delamains:
  development-pipeline:
    path: delamains/development-pipeline/delamain.yaml
```

The entity (or variant) references the delamain via the status field:

```yaml
variants:
  app:
    fields:
      status:
        type: delamain
        delamain: development-pipeline
```
