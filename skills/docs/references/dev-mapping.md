# ALS for Classical Developers

This doc is a bridge for developers arriving with classical software vocabulary. It translates ALS terms into the closest familiar concepts without replacing the canonical ALS definitions in [`vocabulary.md`](./vocabulary.md).

Use this doc to pick the right mental model. Use [`vocabulary.md`](./vocabulary.md) and the linked reference docs when you need the exact ALS meaning.

## Start With The Architectural Reframe

ALS is event-driven / workflow architecture, not MVC.

If you force ALS into an MVC map, you get bad fits:

- `delamain` is not a controller. It moves one record through a long-running lifecycle over multiple states, often across hours or days.
- `dispatcher` is not a route layer. It is the workflow runtime that scans items, enforces runtime limits, and invokes agents.
- `dashboard`, `statusline`, and pipeline consoles are not request-scoped templates. They are consumer-plane views over ALS-produced state.

The cleaner starting frame is:

- workflow engine / saga / state machine for `delamain`
- engine runtime for `dispatcher`
- bounded context / versioned package for `module`
- producer/consumer view surfaces for dashboard, statusline, and console

Read the table below as a translation lens, not an identity swap. The analog helps you orient quickly, but ALS keeps some distinctions that classical stacks usually blur together.

## ALS Term -> Classical Concept Map

This table is intentionally extensible. Add rows as new vocabulary friction surfaces in onboarding conversations.

| ALS term | Classical analog | Note |
|---|---|---|
| `module` | DDD bounded context / versioned npm package | Versioned namespace of types + behavior. "Schema" is too narrow because modules also carry delamains and agent prompts. |
| `entity` | aggregate type / model class definition | The type, not a live instance. |
| `module data record` | aggregate instance / row / document | The concrete item on disk that flows through the delamain. |
| `delamain` | workflow / saga / state machine | Long-running lifecycle orchestration. Not request-scoped; not a controller. |
| `dispatcher` | workflow engine runtime | The Temporal/Cadence/Airflow-like runner that scans items, enforces concurrency, and invokes agents. |
| `state` | workflow node / state-machine state / step | One point in the item's lifecycle graph. |
| `phase` | pipeline stage / SDLC phase | Coarser grouping over states. |
| `actor` | task assignee / executor type | Closest to a BPMN swimlane: who owns the step, `operator` or `agent`. |
| `provider` | worker pool / execution backend | Which backend executes the agent-owned step. |
| `agent` | task implementation / handler / service | The concrete state implementation the dispatcher runs. |
| `construct` | framework / engine code | Vendor-shipped runtime/tooling code, not operator-authored content. |
| `compiler` (`alsc`) | build tool / transpiler / code generator | Materializes ALS-authored source into deployed Claude assets; it is not the request runtime. |
| `skill` | slash command + bundled knowledge | A named operator interface surface, closer to a command/handler than a controller action. |
| `hook` | lifecycle hook / middleware | Plugin-wired shell entrypoints around Claude Code lifecycle events. |
| `dashboard` / `statusline` / `console` | views | Consumer-plane views over ALS-produced state; continuously refreshed, not request-scoped renders. |
| `job` | ticket / issue / card / work item | `als-factory`'s record type. |
| `cyborg` | application instance / tenant | Rough only. ALS treats it as an inhabited personal-agent system, not just a deployable app. |
| `forge` | dev environment | Rough only. It is the maker's build and evolution environment plus reference instance, not just local tooling. |
| `bond` | personalized instance | Rough only. It names the lived relationship between an end user and their instance, not just a tenancy slice. |
| `edgerunner` | end user | The person living inside the system rather than building the language. |
| `ALS developer` | application developer | Builds on ALS like an app developer builds on a framework. |
| `ALS architect` | framework maintainer / language designer | Evolves the language contract itself. |
| `als_version` / `module_version` / construct version / plugin version | multi-axis versioning | Separate version tracks with different cutover mechanisms; do not collapse them into one app version. |
| `language-upgrade-recipe` | DB migration | Specifically the per-hop whole-system language cutover bundle, not every kind of change. |
| `compatibility class` | breaking-change category | Release taxonomy for how disruptive a change is. |

## One Classical Concept -> Many ALS Concepts

ALS often splits one classical developer concept into several sharper concepts because the authorship boundary, runtime boundary, and upgrade boundary are different.

### "DB migration"

In ALS, "DB migration" breaks into at least four different things:

- `/change` + `/migrate` for per-module data shape evolution inside one `als_version`
- `language-upgrade-recipe` for a whole-system `als_version` hop
- construct upgrade for vendor-managed runtime/tooling version hops
- bundled-surface refresh via `alsc deploy claude` for regenerating deployed `.claude/` assets from authored ALS state

### "Package update"

In ALS, "package update" also splits:

- `/update` is the rollup entrypoint the edgerunner sees
- under that rollup, the runtime may need to reconcile plugin version, `als_version`, `module_version`, and construct versions as distinct axes

ALS makes these distinctions on purpose. They keep authored content, vendor-managed runtime code, and generated deploy surfaces from getting collapsed into one vague "update" bucket.

## Things That Do Not Map Cleanly

Some ALS concepts are deliberately net-new or at least more experiential than classical software vocabulary.

- `cyborg` is more than "app instance." It names the whole inhabited system: language, tooling, authored content, runtime, and operator relationship.
- `forge` is more than "dev environment." It includes the maker's build/evolution seat and reference system.
- `bond` has no strong enterprise-software analog. It names the personal relationship between an end user and their instance.

If an analogy collapses authored workflow, runtime engine, and consumer-plane views into one MVC-shaped blob, stop using it. That is the main failure mode this doc is meant to prevent.

## See Also

- [`vocabulary.md`](./vocabulary.md) for canonical ALS term definitions
- [`delamain-overview.md`](./delamain-overview.md) for the workflow/state-machine model
- [`delamain-dispatcher.md`](./delamain-dispatcher.md) for the runtime engine model
- [`language-upgrades.md`](./language-upgrades.md) for the `language-upgrade-recipe` contract
