# ALS Vocabulary

Canonical glossary of the terms used across ALS. When a term is defined here, other docs should link to this file rather than redefine it.

This doc is the single source of truth for term definitions. Add new terms here as they crystallize.

---

## Cyborg Stack

ALS sits inside a four-layer stack. ALS is the **Language** layer; the others are maker-specific.

| Layer | Definition |
|-------|------------|
| **Language** | The spec for building personal agent systems. ALS itself. |
| **Forge** | Where a maker builds and evolves their cyborg. Their dev environment + reference instance. |
| **Product** | What end users adopt. Each maker brands their own. |
| **Bond** | The personal lived relationship between an end user and their instance. |

ALS is one Language. Many Forges, Products, and Bonds exist on top of it.

### Cyborg

Abstract term for a personal agent system built from the ALS spec. A cyborg is the working unit — language + tooling + authored content + runtime — that an operator inhabits.

---

## Profiles

All profiles are end users of ALS. The distinction is in what they do with the system, not in their status. Every profile — including Claude — is a user whose experience matters.

### Operator

The abstract role for "the human at the interface." A given operator is concretely typed by one or more profiles below.

### Edgerunner

End user. Uses a Claude harness (Claude Code, Cowork) on a project that happens to be an ALS system. May not be technical. May never invoke ALS skills directly — they interact with the system through skills that were built for them. Their most common ALS touchpoint is `/run-delamains` to start their pipelines.

### ALS Developer

End user. Builds ALS systems for operators. Knows the spec. Uses `/install`, `/new`, `/change`, `/migrate` to create and evolve modules. May package and distribute modules for operators to install.

### ALS Architect

End user. Alters the language itself. Architects the spec, writes SDRs, evolves the compiler, defines new language constructs. Currently: Nicholas Frith.

### Claude

End user. Present alongside every other profile. Enables each profile to do whatever they aim to do — from answering edgerunner questions to authoring modules to implementing spec changes.

---

## Core Authored Abstractions

These are the things an ALS author creates and lives inside. They are owned by the operator's system, stored under `<system_root>/.als/`, and evolve through `/new`, `/change`, `/migrate`.

### Module

A self-contained authored bundle of related entities and (optionally) one or more delamains. Lives at `.als/modules/{module}/v{N}/`. Versioned per-module via `module_version`.

### Delamain

A state machine for orchestrating items (records) through stages. A delamain definition declares states, transitions, phases, actors, providers, and per-state agents. The dispatcher reads the definition and drives records through the graph.

### State

A node in a delamain's transition graph. Each state declares a `phase`, an `actor` (`agent` or `operator`), and — for agent-actor states — a provider, prompt path, resumability, and (per ALS-065) optional concurrency cap.

### Phase

A coarse grouping of states (e.g. `research`, `acceptance`, `closed`). Phases impose an ordering on `advance` and `rework` transitions; the compiler enforces phase ordering at the language layer.

### Actor

Who acts at a state. Two values: `agent` (an LLM-driven step) or `operator` (a human gate).

### Provider

For agent-actor states, the LLM provider that runs the dispatch. Today: `anthropic` or `openai`. Each provider has its own slot pool managed by the dispatcher.

### Agent

A dispatched LLM instance. Driven by the prompt at the state's `path` (e.g. `agents/research.md`). The agent reads context, does work, writes back to the operator's authored content. Agent prompts are **authored content** living inside delamains in `.als/modules/{module}/v{N}/delamains/{delamain}/agents/*.md` — they are NOT shipped by the plugin.

### Module Data Record

An item flowing through a delamain (e.g. a `job` in als-factory, a `client` in client-registry). Lives as a markdown file with frontmatter inside the relevant module's directory. The dispatcher reads its `status` field to decide which state's agent to run.

---

## Constructs

A **construct** is anything Section 9 ships as runtime/tooling code that the operator's system uses but does not author. Constructs are vendor-managed: they update with the plugin, the operator does not customize them.

Today's constructs:

- **Delamain dispatcher source** — the runtime engine that reads delamain definitions, dispatches agents, manages worktrees. Template lives at `nfrith-repos/als/skills/new/references/dispatcher/` (the canonical source). Tracked by its own `VERSION` file. Currently at VERSION 12.
- **Hooks** — `als-validate.sh`, `als-stop-gate.sh`, `als-session-start-operator.sh`, etc. Plugin-shipped shell scripts wired into Claude Code's hook lifecycle.
- **Statusline scripts** — runtime scripts that produce the live status line (delamain health, OBS state, context usage, clock).
- **Dashboard launchers** — the localhost dashboard service that visualizes dispatcher state.
- **Compiler (`alsc`)** — the language compiler. Validates authored content, projects to `.claude/`, owns the contract surface.

Constructs are NOT operator-authored. The operator's `.als/modules/.../delamains/.../agents/*.md` and `.als/modules/.../entities/...` are authored content, not constructs. The dispatcher template specifically ships ONLY dispatcher TypeScript source — it does NOT ship agent prompts. Agent prompts always come from the operator's authored delamain.

### Construct upgrade

The act of bumping a construct's version inside the operator's system to match a newer version shipped by the plugin. Distinct from authored-content evolution (which goes through `/change`/`/migrate`) and from language-version cutover (which goes through `/upgrade-language`).

A construct upgrade typically involves: (1) detecting that the operator's `.als/`-side copy of the construct is older than the plugin's reference, (2) replacing the source files in the operator's system, (3) running any state-shape migrations the new version requires, (4) re-deploying to `.claude/` via `alsc deploy`, (5) restarting any background processes the construct owns.

### Delamain upgrade / Dispatcher upgrade

A specific case of construct upgrade. When the dispatcher's `VERSION` bumps in the plugin, every delamain in the operator's system needs its dispatcher source refreshed. Often involves runtime-state migration (e.g. `worktree-state.json` shape changes) and a kill-and-bootup cycle.

---

## Authored vs Plugin-Shipped — the Boundary

| Lives in | Owned by | Examples |
|----------|----------|----------|
| `<system_root>/.als/` | Operator (authored) | Modules, module data, delamain definitions, agent prompts, operator-config |
| `<system_root>/.claude/` | Compiler (projected) | Skill text, hook wiring, deployed assets — regenerated by `alsc deploy claude` |
| Plugin tree (`nfrith-repos/als/` or wherever installed) | Section 9 (vendor) | Dispatcher template, hooks, statusline, dashboard, compiler, foundry assets |

This boundary is load-bearing: language-upgrade-recipes and construct-upgrade machinery may only mutate `<system_root>/.als/`. The plugin tree is read-only to the operator's system. `.claude/` is regenerated by the compiler, never hand-edited.

---

## Versioning Axes

ALS has multiple version axes that evolve at different rates.

| Axis | Where declared | Cadence | Cutover mechanism |
|------|----------------|---------|--------------------|
| **`als_version`** | `.als/system.ts` (operator-side); `SUPPORTED_ALS_VERSIONS` (plugin-side) | Rare. Hop event. | `/upgrade-language` + language-upgrade-recipe (ALS-066) |
| **`module_version`** | `.als/modules/{module}/v{N}/module.ts` | Per-module, as the operator's data shape evolves | `/change` + `/migrate` |
| **Construct version** | `nfrith-repos/als/skills/new/references/dispatcher/VERSION` (and similar per construct) | Per-construct, as the runtime evolves | Construct upgrade (Punchlist #1, future job) |
| **Plugin version** | `.claude-plugin/plugin.json` | Vendor release. Rolls up all of the above. | `/update` |

The plugin version is the rollup that edgerunners see ("you're on plugin 0.2.1"). The other axes are internal; the engine reconciles them during upgrade flows.

---

## Language-Upgrade-Recipe

Per-hop bundle that describes how to migrate a system from one `als_version` to the next. Lives at `nfrith-repos/als/language-upgrades/recipes/v{N}-to-v{N+1}/`. Contains:

- A manifest declaring an ordered DAG of typed steps
- Deterministic scripts (mechanical transforms)
- Agent-task prompts (judgment work)
- Gates (validation checks)
- Operator-prompts (literal human gates, narrowly scoped — see ALS-066 REQ-15)

Step types: `script`, `agent-task`, `gate`, `operator-prompt`.
Step categories: `must-run`, `recommended`, `optional`, `recovery`.

The artifact's full name is `language-upgrade-recipe`; "recipe" alone is ambiguous and should not be used standalone in agent prompts. Schema literal: `als-language-upgrade-recipe@1`.

Distinct from construct upgrades — language-upgrade-recipes operate ONLY on `als_version` cutovers.

See ALS-066 and SDR 037 for the canonical contract.

---

## See Also

- [`platforms.md`](./platforms.md) — `ALS-PLAT-XXXX` codes and runtime entrypoints
- [`compatibility-classes.md`](./compatibility-classes.md) — the 5-class compat vocabulary
- [`deprecation-and-warnings.md`](./deprecation-and-warnings.md) — lifecycle stages for deprecating values
- [`shape-language.md`](./shape-language.md) — authored shape primitives
- [`delamain-overview.md`](./delamain-overview.md), [`delamain-dispatcher.md`](./delamain-dispatcher.md), [`delamain-agents.md`](./delamain-agents.md) — delamain deep-dives
