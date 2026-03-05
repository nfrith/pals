# PALS Pre-Release Spec (Working Draft)

Updated: 2026-03-05

## 1) Current Agreements (Resolved Decisions)

1. System model:
- Each module is its own filesystem tree.
- The module's interface is its skill (or skill + forked subagent execution).
- Skills own business logic for reads and writes.

2. Orchestrator role:
- Orchestrator is a router/detective.
- Orchestrator does not know internals of module storage shape.
- Orchestrator can call the wrong module and recover.

3. Module awareness:
- Modules should not require global knowledge of the whole system.
- Module responses should not prescribe which other module to call next.
- Routing decisions remain with orchestrator.

4. Cross-module semantics:
- Cross-module IDs are preferred over cross-module path coupling.
- Cross-module interpretation should be owned by the module that owns the data.

5. Interaction style:
- Human prompt is natural language.
- Orchestrator can forward prompt verbatim to a module skill/subagent.
- Module returns semi-structured output to support deterministic orchestration.

## 2) Read Contract Direction (Resolved Decision)

Each module read response uses a semi-structured envelope, but no global routing advice.

Canonical response envelope keys:
- `answer`: module-owned interpretation/result.
- `evidence`: which records/files were used.
- `needs`: external facts required to complete stronger answer.
- `confidence`: high/medium/low.
- `uncertainties`: assumptions, ambiguities, data quality issues.

Envelope rules:
1. Use a stable semi-structured template with the canonical keys above.
2. Module-local extra fields are allowed, but canonical keys remain consistent.
3. `needs` entries must use standardized need-type tokens with optional context details.

Example standardized `needs` entries:
- `EXPERIMENT_OUTCOMES_RECENT` + context: "experiment IDs X/Y, last 30 days"
- `RISK_CLASSIFICATION` + context: "platform channel Z"

Important: `needs` expresses missing information categories, not "call module X" instructions.

## 3) Reference Scenarios (Behavioral Examples)

These scenarios describe expected PALS behavior under different request conditions.
They are illustrative examples, not mutually exclusive design options.

### Scenario A: Priority Selection (Backlog + Experiments)

Human prompt to orchestrator:
"Pick the next 2 stories in EPIC-42 using experiment outcomes from the last 30 days. Weight confidence and recency."

Flow:
1. Orchestrator forwards prompt to `backlog` skill (forked).
2. Backlog returns:
- candidate stories for EPIC-42
- local eligibility interpretation
- `needs`: latest experiment outcomes for referenced experiment IDs
- evidence paths
3. Orchestrator forwards original prompt + backlog output to `experiments` skill (forked).
4. Experiments returns:
- interpreted outcomes (confidence, freshness, caveats)
- evidence paths
5. Orchestrator forwards combined outputs back to `backlog` skill.
6. Backlog returns final ranked stories with rationale.
7. Orchestrator responds to human.

Why this fits current principles:
- No direct module-to-module calling.
- No module-level global system awareness required.
- Module semantics remain module-owned.

### Scenario B: Wrong Module First (Recovery Behavior)

Human prompt:
"Which stories should we accelerate this week based on experiments?"

Flow:
1. Orchestrator first calls `distribution` by mistake.
2. Distribution returns:
- minimal answer: out-of-scope for requested decision
- optional `needs` expressed as unknowns (e.g., "story candidate set required")
3. Orchestrator calls `backlog` then `experiments`.
4. Continues normal flow.

Requirement:
- Out-of-scope responses must be cheap, explicit, and non-destructive.

### Scenario C: Stale Experiment Data

Human prompt:
"Choose next stories for EPIC-42 using experiments."

Flow:
1. Backlog provides candidates + needs.
2. Experiments reports stale/inconclusive outcomes for all relevant IDs.
3. Backlog returns ranking with reduced confidence and a gating note:
- "Decision provisional due to stale experiment evidence."
4. Orchestrator surfaces decision + uncertainty, not fake precision.

Requirement:
- Uncertainty handling must be first-class output, not hidden prose.

## 4) Cross-Module Communication (Resolved Decision + Deferred Design Space)

### Current Baseline (Resolved in Current Draft)

1. Default cross-module mechanism is orchestrator-mediated request/response chaining.
2. Integration events are optional and used selectively for async/high-value transitions.
3. Domain-event-only and full dual-event architectures are deferred.

The options below are retained as design space references, not active baseline defaults.

### Option 1: Orchestrator-Only Request/Response (No Events)

- All cross-module communication occurs synchronously via orchestrator call chaining.
- Simple mental model.
- Good for read-heavy and human-in-loop flows.

Pros:
- Lowest complexity.
- Easy to debug.

Cons:
- No durable inter-module event history.
- Weaker decoupling for async workflows.

### Option 2: Domain Events Only (Inside Module)

- Module emits domain events for internal state changes.
- Events are not public integration contracts.

Pros:
- Clarifies module internals and transitions.

Cons:
- Limited direct value for cross-module orchestration unless projected outward.

### Option 3: Integration Events Only (Cross-Module Contract)

- Module emits stable, external-facing events consumed by orchestrator or other modules.

Pros:
- Clear decoupling contract.
- Better path toward future network/service boundary.

Cons:
- Requires event contract governance/versioning.

### Option 4: Both (Domain + Integration)

- Domain events are internal truth.
- Integration events are curated/public projections derived from domain events.

Pros:
- Clean architecture.
- Scales best for future separation.

Cons:
- Highest complexity.
- Risk of over-engineering too early.

### 4.1) Current Baseline Summary (Pre-Release)

For the current baseline, start with:
1. Synchronous orchestrator-mediated request/response for reads and decisions.
2. Optional append-only integration event log only for high-value transitions.
3. Skip full domain-event layer initially.

Rationale:
- Preserves momentum.
- Avoids dual-event-complexity too early.
- Keeps path open to add domain events later if needed.

## 5) Optional Integration Event Shape (Deferred/If Enabled)

Event fields (conceptual):
- `event_id`
- `event_type`
- `producer_module`
- `entity_id`
- `occurred_at`
- `payload`
- `correlation_id` (for orchestrated flow tracing)
- `causation_id` (optional)

Example event types:
- backlog: `story-ranked`, `story-state-changed`
- experiments: `experiment-outcome-updated`, `experiment-confidence-updated`

Storage approach:
- Append-only markdown or JSONL under module-owned `events/` directory.
- Treated as immutable log.

## 6) Open Decisions (Deferred Design Space)

1. Do we require evidence paths for every claim, or only high-impact claims?

The full domain+integration event-split trigger is intentionally parked in Section 21 at the end of this document.

## 7) Next Scenario Candidates (Behavioral Example Backlog)

1. Write path with side effects:
- Backlog state change triggers an experiment planning task.

2. Conflict resolution:
- Experiments signal says "negative," but backlog policy forces urgency due to external deadline.

3. Multi-module chain:
- Backlog + experiments + distribution readiness constraints.

## 8) Additional Scenario Exercises (Behavioral Examples)

### Scenario D: Write With Side Effects (No Events)

Human prompt:
"Move STORY-311 to in-progress and make sure experiment planning is covered."

Flow:
1. Orchestrator calls `backlog` write skill.
2. Backlog updates STORY-311 and returns:
- write result
- side-effect need: "experiment plan required for STORY-311"
- confidence + uncertainties
3. Orchestrator calls `experiments` write skill with that side-effect context.
4. Experiments creates/updates planning record and returns result.
5. Orchestrator returns final response.

Pros:
- Very simple.
- Fully explicit in single request chain.

Cons:
- If step 4 fails, orchestrator must own compensation logic.
- No durable event trail unless explicitly written elsewhere.

### Scenario E: Write With Integration Events (Async-Friendly)

Human prompt:
"Move STORY-311 to in-progress."

Flow:
1. Orchestrator calls `backlog` write skill.
2. Backlog writes STORY-311 and appends integration event `story-state-changed`.
3. Orchestrator may finish user response immediately.
4. Later, orchestrator (or event-consumer worker) reads new events and calls `experiments` to create plan.

Pros:
- Better decoupling.
- Better for delayed/async side effects.
- Durable history of cross-module intent.

Cons:
- Requires event consumption/replay logic.
- Eventual consistency, not immediate consistency.

### Scenario F: Experiment Outcome Arrives Later (Natural Fit for Events)

Situation:
- Experiment run completes overnight without a human prompt.

Flow:
1. Experiments module records outcome and emits `experiment-outcome-updated` integration event.
2. Orchestrator event loop notices event.
3. Orchestrator calls backlog read/write flow to re-evaluate affected stories.
4. Backlog updates ranking or marks decision-review-required.

Why this matters:
- This is hard to model with pure synchronous request/response.
- Integration events provide clean trigger semantics.

### Scenario G: Wrong Call + Recovery + Auditability

Situation:
- Orchestrator routes to wrong module first, then recovers.

Desired behavior:
1. Wrong module returns out-of-scope quickly.
2. Orchestrator retries with better module.
3. Trace keeps a per-request chain (attempt 1 failed routing, attempt 2 succeeded).

Need:
- Correlation ID across subagent calls to debug routing quality over time.

## 9) Domain vs Integration Events in This Architecture (Deferred Design Space)

### Domain Events (internal)

Use when:
- You need rich lifecycle semantics inside a module.
- Multiple local reactions depend on one state change.

Do not expose domain events as cross-module contract by default.

### Integration Events (external)

Use when:
- Another module must react without tight runtime coupling.
- Async or delayed workflows are expected.
- You want future-safe behavior across network boundaries.

Treat integration events as curated outputs, not raw internal details.

### Current Baseline Heuristic (Resolved)

Emit integration events only for transitions that are:
1. Cross-module relevant.
2. Potentially async.
3. Expensive to recompute by polling.

If a flow is synchronous and human-in-loop in one turn, orchestrator chaining is enough.

## 10) Practical Guardrails for Baseline (Resolved Decisions)

1. Keep module read/write responses in a stable template.
2. Keep `needs` standardized and fact-oriented.
3. Keep cross-module references as IDs, not file paths.
4. Require a correlation ID per orchestrated request chain.
5. Start with 2-4 integration event types only; avoid event proliferation.
6. Prefer explicit orchestrator retries over hidden auto-magic.
7. Do not require a persistent short-term orchestrator memory artifact between turns.

## 11) Questions For Next Iteration (Deferred Design Space)

1. Which exact backlog transitions should emit integration events in current baseline?
2. Which experiment transitions should emit integration events in current baseline?
3. Should event storage be JSONL-first or markdown-first?
4. Do we want one shared event log per module or per-entity event streams?
5. What is the minimum retry policy for orchestrator misroutes and transient failures?

## 12) Reference Encoding (Cross-Module IDs, Resolved Decision)

### Decision

Use standard markdown link syntax for cross-module references, but with transport-agnostic logical URIs in link targets.

Canonical format:
- `[display-label](pals://<namespace>/<module>/<id>)`

Example:
```yaml
---
people:
  - "[alex-rivera](pals://workspace/people/PPL-000101)"
  - "[mira-chen](pals://workspace/people/PPL-000204)"
---
```

### Why This Choice

1. Transport-agnostic by design.
- Filesystem now: resolve URI -> local module path.
- HTTP/service later: resolve URI -> module endpoint/read contract.
- Same stored reference, different resolver implementation.

2. Reduced coupling.
- No embedded filesystem paths across module boundaries.
- Module internal tree can be refactored without breaking external reference strings.

3. Lower drift surface.
- Keep relation payload minimal in referencing records.
- Avoid duplicating rich relationship metadata in many places.

4. Easy compiler/linter enforcement.
- Markdown link parse check.
- Allowed URI scheme check (`pals://`).
- Namespace segment check (required, non-empty).
- Module segment check (required, non-empty).
- ID segment check (required, non-empty).
- Existence/resolution check.

### Canonicality Rules

1. Canonical truth is the URI target, not the display label.
2. URI target must include namespace + module + id segments.
3. Opaque primary IDs are required in URI targets (no slug-as-key in canonical target).
4. Display labels are human-facing and may be soft-validated only.

### Non-Goals for Baseline

1. No rich inline relation objects as default reference form.
2. No path-coupled references as canonical FK mechanism.

## 13) Module Evolution and Versioning (Resolved Decision + Playbook Foundation)

### Decision

Every module declares explicit version metadata.
Versioning is customer-facing and starts at `v1`.
`MODULE.md` is frontmatter-only (no markdown body).

Required `MODULE.md` frontmatter fields:
- `module_id`
- `namespace`
- `uri_scheme`
- `module_version`
- `schema_version`
- `entity_paths`
- `references`

Module contract field rules:
1. `entity_paths` maps entity names to canonical relative record path patterns.
2. `references.modules` declares direct external module dependencies.
3. Each `references.modules` item must include `namespace` and `module_id`.
4. Self references must not be listed in `references.modules`.
5. `references.modules` must be derived from deployed schema `ref` fields, deduplicated, and sorted.

### Versioning Rules

1. `module_version` tracks deployed module behavior (schema + skill logic package).
2. `schema_version` is a global module-level version, not per-entity.
3. Schema versions are integers only (`1`, `2`, `3`, ...), not decimals.
4. If any deployed schema file changes, bump module `schema_version`.
5. All deployed schema files in a module must carry the same `schema_version`.
6. Root skill router target `vN` must match `MODULE.md` `module_version: N`.

### Bump Rules

1. Logic-only change:
- bump `module_version` by `+1`
- keep `schema_version` unchanged

2. Schema-only change:
- bump `module_version` by `+1`
- bump `schema_version` by `+1`

3. Schema + logic change:
- bump `module_version` by `+1`
- bump `schema_version` by `+1`

### Mutate -> Migrate Contract

1. `pals-mutate` takes `module_skill_path` as its only required input and derives module context.
2. `pals-mutate` authors `vN+1/` under module skill path.
3. `vN+1/migrations/MANIFEST.md` is required.
4. Manifest frontmatter must include at minimum:
- `manifest_id`
- `module_id`
- `module_path`
- `skill_path`
- `from_version`
- `to_version`
- `change_class`
- `data_migration_required`
- `status`
- `created_on`
- `updated_on`
5. `pals-migrate` must fail if manifest is missing or invalid.
6. Cutover is atomic:
- if migration or validation fails, do not update router or `MODULE.md`
- if all gates pass, update router + `MODULE.md` together in one cutover commit

### Evolution Classes

1. Additive change
- Example: add a new section/field.
- Default strategy: mutate authoring -> deterministic migrate -> atomic cutover.

2. Shape change (move/rename/restructure)
- Example: `body.media` moved under another section.
- Default strategy: mutate authoring -> deterministic rewrite -> atomic cutover.

3. Semantic change (meaning changes)
- Example: field meaning changes from label to computed score.
- Requires explicit version bump, manifested behavior test plan, and migration validation proof.

## 14) Body Structure and Null Semantics (Resolved Decision)

### Decision

Markdown body structure is part of schema, not free-form prose.

Current baseline enforcement model:
1. Enforce section presence/shape contract first.
2. Defer deep typed parsing of section internals unless needed.

### Required vs Missing vs Empty

Treat as three distinct states:
1. Present with value.
2. Present and explicitly empty (canonical null marker).
3. Missing.

Rules:
1. Required sections must be present, even when empty.
2. Missing required section is a schema violation.
3. Explicit empty must use one canonical marker: `null`.
4. Per-section empty-marker overrides are not supported in the current baseline.

### Add-New-Section Process

1. Introduce as optional.
2. Require explicit presence in all new writes (use empty marker if no value).
3. Backfill existing records incrementally (lazy-on-touch + optional batch pass).
4. Promote to required and enforce with linter error at cutover.

## 15) Compiler Responsibilities (Separation of Concerns, Resolved Decision)

### Decision

Do not build one monolithic linter. Split responsibilities:

1. Normalizer
- Parse frontmatter + markdown sections.
- Resolve layout aliases into canonical schema keys.

2. Linter
- Validate canonical model against schema + module invariants.
- Enforce references, required fields/sections, enums, state transitions.

3. Migrator
- Apply record rewrites/backfills.
- Operates from explicit evolution rules.

### Why

- Keeps complexity bounded.
- Avoids embedding transformation logic directly in lint checks.
- Makes large module updates auditable and repeatable.

## 16) Delivery Scope (Current Baseline vs Later)

### Current Baseline (Pre-Release)

1. Orchestrator request/response chaining is the primary cross-module mechanism.
2. Transport-agnostic references with `pals://<namespace>/<module>/<id>`.
3. Additive evolution support (including required explicit empty section markers).
4. Shape-change support via deterministic migration transforms + atomic cutover rules.
5. Minimal migrator for deterministic rewrites.

### Later

1. Full semantic-change tooling automation.
2. Broader domain-event modeling (if needed).
3. Advanced body-content typing and richer schema introspection.

## 17) Decision Log Snapshot (2026-03-03)

1. Orchestrator is the detective/router; modules do not prescribe global routing.
2. Module interfaces are skills/subagents; orchestration handoffs remain natural-language-first.
3. Cross-module references use markdown links with transport-agnostic URI targets.
4. Canonical FK truth is opaque ID in URI target, not display label.
5. Keep relation payload minimal to reduce drift.
6. Prefer synchronous orchestrator chaining in the current baseline; add integration events selectively for async/high-value transitions.
7. Treat body section structure as schema; enforce explicit empty vs missing semantics.
8. Support three evolution classes with different strategies (additive, shape, semantic).
9. Separate normalizer/linter/migrator responsibilities.
10. Keep module read envelopes semi-structured and keep `needs` standardized.
11. Do not require persistent short-term orchestrator memory artifacts between turns.
12. Customer-facing module and skill versions start at `v1`.
13. `schema_version` is global per module and uses integers only.
14. `pals-mutate` requires `migrations/MANIFEST.md`; `pals-migrate` performs atomic cutover.

## 18) Backlog Evolution Playbook (Epic/Story -> Initiative/Epic/Story, Playbook/Template)

### Purpose

Define one concrete, repeatable evolution procedure for the backlog module when introducing `initiative` above `epic`.

### Baseline and Target

Baseline (module_version: 1):
- Hierarchy: `epic -> story`
- Story record requires `epic_ref`

Target (module_version: 2):
- Hierarchy: `initiative -> epic -> story`
- Story record requires both `initiative_ref` and `epic_ref`
- Epic record requires `initiative_ref`

### Canonical References

Use transport-agnostic references only:
- `pals://<namespace>/backlog/INIT-<id>`
- `pals://<namespace>/backlog/EPIC-<id>`
- `pals://<namespace>/backlog/STORY-<id>`

### Module Version Contract (Example)

```yaml
module_id: backlog
module_version: 2
schema_version: 2
```

### Phase Plan

#### Phase 0: Mutate Authoring (vN+1 Folder)

1. Add initiative schema and directory.
2. Update module skill logic in `vN+1/content/SKILL.md` for initiative-aware behavior.
3. Author required `vN+1/migrations/MANIFEST.md`.
4. Include mutate outputs: intent, invariants, constraints, schema changes, behavior changes, migration plan, behavior test plan, cutover gates.

Exit criteria:
- New schema loads successfully.
- Manifest is complete and approved.

#### Phase 1: Migration Implementation

1. Implement deterministic, idempotent migration script(s).
2. Migration rewrites v1 records to v2 shape:
- story requires `initiative_ref` + `epic_ref`
- epic requires `initiative_ref`
3. Do not change IDs or containment paths.

Exit criteria:
- Migration script exists and can run repeatedly without drift.

#### Phase 2: Dry-Run + Validation Gates

1. Run migration on a staging copy.
2. Validate migrated output in strict mode.
3. Execute behavior tests from manifest.
4. Produce migration report with per-record status and failures.

Exit criteria:
- Strict validation passes.
- Behavior tests pass.
- Failures are either zero or explicitly accepted with manual resolution plan.

#### Phase 3: Cutover

1. Apply migration to active module data.
2. Update root skill router to `v2`.
3. Update `MODULE.md` to `module_version: 2`, `schema_version: 2`.
4. Commit cutover atomically.

Exit criteria:
- Deployed pointers and metadata all agree on v2.
- No partial deployment state.

### Linter Rule Timeline (Concrete)

Example rules:

1. `BKL-REF-001` reference target must be valid `pals://<namespace>/<module>/<id>` URI.
- Always `error`.

2. `BKL-EVO-001` `initiative_ref` missing on story.
- Always `error` in deployed v2 data.

3. `BKL-EVO-002` `initiative_ref` missing on epic.
- Always `error` in deployed v2 data.

4. `BKL-EVO-003` v1-only write shape detected.
- Always `error` in deployed v2 logic.

### Backfill Process Contract

Backfill must be:
1. Deterministic.
2. Idempotent.
3. Restart-safe.

Recommended mechanics:
1. Generate candidate list from linter findings.
2. Apply transform rule set.
3. Validate transformed record immediately.
4. Persist with per-record status log.
5. Re-run until no actionable records remain.

### Failure Handling

If mapping story/epic to initiative is ambiguous:
1. Mark record `failed` with explicit reason.
2. Do not guess silently.
3. Route failed set to manual resolution queue.
4. Do not cut over until failures are resolved or explicitly waived.

### Orchestrator/Skill Behavior During Migration

1. Orchestrator remains unchanged.
2. Backlog skill handles only one deployed version at a time.
3. Cross-module callers only see stable backlog output contract.

### Definition of Done

1. All active records are v2-compliant.
2. Linter runs in strict mode for v2 requirements.
3. Backlog write path only emits v2 shape.
4. Required manifest and migration report are archived.
5. Router + `MODULE.md` point to v2 and are in sync.

## 19) Body Shape-Change Playbook (Section Move Example: `## Media`, Playbook/Template)

### Purpose

Define a concrete procedure for a markdown body section move/rename without breaking module reads.

Example change:
- Old shape: top-level `## Media`
- New shape: nested under `## Assets` as `### Media`

### Canonical Schema Key

Treat both layouts as one canonical key during migration design:
- Canonical key: `body.media`

Interpretation rule:
1. Old layout (`## Media`) maps to `body.media`.
2. New layout (`## Assets` -> `### Media`) maps to `body.media`.

### Phase Plan

#### Phase 0: Mutate Authoring

1. Update vN+1 schema to require only the new layout.
2. Add migration transform rules from old layout -> new layout.
3. Record this change in `vN+1/migrations/MANIFEST.md`.

Validation state:
- Old layout is allowed only as migration input.
- New layout is required in deployed output.

Exit criteria:
- Migration transform rules are deterministic and conflict-aware.

#### Phase 1: Migration Implementation

1. Implement migrator to rewrite old layout to new layout.
2. Keep deployed write logic on new layout only.
3. Do not deploy dual-layout acceptance.

#### Phase 2: Backfill

1. Run migrator on staging copy.
2. Validate canonical equivalence and strict schema compliance.

Backfill guarantees:
- Deterministic transform.
- Idempotent re-run behavior.
- Per-file status log.

Exit criteria:
- Remaining old-layout files are only known exceptions.

#### Phase 3: Cutover

1. Apply migration to active data.
2. Deploy vN+1 schema and skill logic with new layout only.

Lint state:
- Old layout anywhere: `error`

Exit criteria:
- No old-layout sections remain in active records.

#### Phase 4: Cleanup

1. Remove migration-only transform shims from active runtime.
2. Keep migration note in module changelog for auditability.

### Conflict and Ambiguity Rules

1. If file has both old and new layout with different content, fail lint (`error`).
2. Migrator must not guess merge outcomes for conflicting content.
3. Conflicts are routed to manual resolution queue.

### Null/Empty Handling During Move

1. Empty content remains explicit using canonical empty marker (`null`).
2. Missing required section after move is still a schema violation.

### Definition of Done

1. All active files use new layout.
2. Linter rejects old layout.
3. Migration-only transform shims removed from active runtime.
4. Migration/conflict report archived.

## 20) Fixture-Backed Current Model (Pristine Snapshot, Behavioral Example)

This section reflects the current concrete fixture under `example-systems/pristine-happy-path`.

### Module Root Pattern

1. Workspace root uses `workspace/` as the high-level partition.
2. Each module has `workspace/<module_id>/MODULE.md`.
3. `MODULE.md` is frontmatter-only and is authoritative for module metadata, entity paths, and module dependency declarations.

Current fixture module shapes:
1. `backlog` -> flat entity files under typed subdirectories.
2. `people` -> simple single-entity module.
3. `experiments` -> nested 3-layer hierarchy (program -> experiment -> run).

Minimum module contract frontmatter fields:
- `module_id`
- `namespace`
- `uri_scheme`
- `module_version`
- `schema_version`
- `entity_paths`
- `references`

Versioning conventions in fixture:
1. Customer-facing skill versions start at `v1`.
2. Root skill router target `vN` matches `MODULE.md` `module_version: N`.
3. All schema files in a deployed module share the module `schema_version`.

### Identity Invariants (Enforced)

1. Every record must have frontmatter `id`.
2. Filename stem must equal frontmatter `id`.
3. `id` is immutable except through explicit migration workflows.
4. Duplicate `id` values within module scope are forbidden.
5. Reference targets must resolve by exact `id`.

### Reference Contract (Current Baseline)

Reference fields use `type: ref` with:
- `uri_scheme`
- `namespace`
- `module`
- `target_entity`
Resolution target key is opinionated: always `id`.

### Body Contract (Current Baseline)

1. Body schema is defined inline in markdown section contract blocks.
2. Required sections must be present.
3. Explicit empty value is literal `null`.
4. Custom per-section empty markers are not supported in the current baseline.

### Flat and Nested Structures

Both structures are allowed:

1. Flat entity files:
- Example: `workspace/backlog/stories/STORY-0001.md`

2. Nested containment hierarchies:
- Example:
  - `workspace/experiments/programs/PRG-0001/PRG-0001.md`
  - `workspace/experiments/programs/PRG-0001/experiments/EXP-0001/EXP-0001.md`
  - `workspace/experiments/programs/PRG-0001/experiments/EXP-0001/runs/RUN-0001.md`

### Nested Hierarchy Rule

Containment path encodes hierarchy, but explicit parent refs are still required in frontmatter.

For example:
1. Experiment record contains `program_ref`.
2. Run record contains both `program_ref` and `experiment_ref`.
3. Linter must validate path-parent consistency and ref-parent consistency.

## 21) Open Decision Note (Deferred Design Space)

1. Trigger for introducing full domain+integration event split remains open.
2. Status: on the table for later iteration; no trigger is selected yet.
