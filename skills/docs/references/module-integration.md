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

`alsc deploy ${HARNESS}` manages one system-owned file under `.als/` and projects active ALS assets into the roots emitted by `skills/lib/runtime-env.sh`:

```
System instruction file:
${SYSTEM_INSTRUCTION_PATH}      →  generated + overwritten on every deploy

.als/modules/backlog/v2/
├── skills/
│   ├── backlog-manage/        →  ${SKILLS_ROOT}/backlog-manage/
│   ├── backlog-inspect/       →  ${SKILLS_ROOT}/backlog-inspect/
│   └── backlog-app-.../       →  ${SKILLS_ROOT}/backlog-app-.../
└── delamains/
    └── development-pipeline/  →  ${DELAMAINS_ROOT}/development-pipeline/
```

**Important**:
- Deploy writes `${SYSTEM_INSTRUCTION_PATH}` on every run, including module-filter deploys, and always overwrites it with the canonical ALS-managed guidance.
- Skill deploy under `${SKILLS_ROOT}` still overwrites the target directory completely.
- Delamain deploy under `${DELAMAINS_ROOT}/<name>/` refreshes authored Delamain files via merge projection so an existing `dispatcher/node_modules/` survives.
- Delamain deploy projects runtime dispatcher files from `.als/constructs/delamain-dispatcher/<name>/` into `${DELAMAINS_ROOT}/<name>/dispatcher/`.
- Delamain deploy does not run `bun install` or any other package-manager command.
- If the deployed dispatcher has no installed dependencies yet, deploy warns and continues.
- Merge projection may leave stale authored files or incidental runtime files in the deployed Delamain target.

## Dispatcher as Engine-Managed Construct

Never hand-write a dispatcher. The canonical bundle lives at `${ALS_PLUGIN_ROOT}/delamain-dispatcher/`, and ALS v2+ installs one operator-side copy per Delamain under `.als/constructs/delamain-dispatcher/<delamain>/`.

Module bundles no longer carry `delamains/<name>/dispatcher/`. `/change` and other authored-source flows manage only `delamain.ts`, agent prompts, optional sub-agent prompts, and optional `runtime-manifest.config.json`.

When the canonical dispatcher improves, the construct-upgrade engine refreshes the installed `.als/constructs/delamain-dispatcher/<name>/` trees. Deploy then reprojects `${DELAMAINS_ROOT}/<name>/dispatcher/` from those installed roots.

This keeps the dispatcher orthogonal to module-version churn and makes the installed construct root the single operator-side source of truth.

At startup, dispatchers compare their local `dispatcher/VERSION` with `${ALS_PLUGIN_ROOT}/delamain-dispatcher/VERSION`. Stale but readable versions log `run /update to update` and keep polling. Missing or malformed local or canonical version files fail startup before polling.

<!-- UPDATE THIS MAP when drift is discovered between the template and its targets. -->

### Dispatcher Targets

| Target | Path |
|--------|------|
| Template (canonical) | `${ALS_PLUGIN_ROOT}/delamain-dispatcher/` |
| incident-lifecycle (installed source) | `${SYSTEM_ROOT}/.als/constructs/delamain-dispatcher/incident-lifecycle/` |
| release-lifecycle (installed source) | `${SYSTEM_ROOT}/.als/constructs/delamain-dispatcher/release-lifecycle/` |
| postmortem-lifecycle (installed source) | `${SYSTEM_ROOT}/.als/constructs/delamain-dispatcher/postmortem-lifecycle/` |
| run-lifecycle (installed source) | `${SYSTEM_ROOT}/.als/constructs/delamain-dispatcher/run-lifecycle/` |
| development-pipeline (installed source) | `${SYSTEM_ROOT}/.als/constructs/delamain-dispatcher/development-pipeline/` |
| incident-lifecycle (deployed) | `${DELAMAINS_ROOT}/incident-lifecycle/dispatcher/` |
| release-lifecycle (deployed) | `${DELAMAINS_ROOT}/release-lifecycle/dispatcher/` |
| postmortem-lifecycle (deployed) | `${DELAMAINS_ROOT}/postmortem-lifecycle/dispatcher/` |
| run-lifecycle (deployed) | `${DELAMAINS_ROOT}/run-lifecycle/dispatcher/` |
| development-pipeline (deployed) | `${DELAMAINS_ROOT}/development-pipeline/dispatcher/` |

## system.ts Registration

Skills are registered in `system.ts` under the module:

```ts
modules: {
  backlog: {
    path: "backlog",
    version: 2,
    description: "Track backlog items and the delivery workflow around them.",
    skills: [
      "backlog-manage",
      "backlog-inspect",
      "backlog-app-development-pipeline",
    ],
  },
}
```

Delamains are registered in `module.ts`:

```ts
delamains: {
  "development-pipeline": {
    path: "delamains/development-pipeline/delamain.ts",
  },
}
```

The entity (or variant) references the delamain via the status field:

```ts
variants: {
  app: {
    fields: {
      status: {
        type: "delamain",
        delamain: "development-pipeline",
      },
    },
  },
}
```
