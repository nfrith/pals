# Delamain Phase-Constrained Transition Graphs

## Status

Accepted

## Context

- ALS currently models `status` as a plain enum field.
- That surface is enough to validate which values exist, but not enough to declare valid transitions, required human-in-the-loop transitions, or the difference between domain classification and operational progression.
- In the Ghost backlog app pipeline, the `status` value list lives in shape YAML, while transition rules and operator-console behavior live in prose and runtime code outside the ALS shape contract.
- The current backlog module already shows a practical size limit: large variant-rich `shape.yaml` files become hard to teach and maintain even before workflow declarations are added.
- ALS may eventually grow multiple graph-like constructs, so generic names such as `workflow` or `process graph` are too overloaded to serve as the construct name.
- The first workflow primitive should stay narrow enough to be teachable and strict.
- A first pass that tries to absorb dispatch hooks, operator menus, review loops, and agent-launch behavior would turn one declaration surface into a full runtime DSL too early.
- A separate first-class lifecycle primitive is weaker than needed for the current problem because lifecycle phases do not by themselves constrain legal state changes.
- The next step needs more than syntax. It needs graph invariants that let ALS reject incoherent authored graphs without relying on model interpretation.

## Decision

- ALS adds a first-class construct named `Delamain`.
- Delamain bundles live under `.als/modules/<module_id>/vN/delamains/`.
- Delamain declarations remain module-version artifacts, but they do not live inline inside `shape.yaml` in this pass.
- `shape.yaml` declares an explicit `delamains` registry.
- The registry maps Delamain names to explicit Delamain primary-file paths.
- ALS adds a frontmatter field type `delamain`.
- A `delamain` field must declare `delamain: <name>`.
- The named Delamain must appear in the `shape.yaml` registry.
- The named Delamain resolves through the declared registry entry, not through filename convention alone.
- The named Delamain becomes the authoritative value set for that field. A `delamain` field does not also declare `allowed_values`.
- ALS allows at most one `delamain` field per effective entity schema.
- For plain entities, that means at most one `delamain` field on the entity.
- For variant entities, root/base fields may declare at most one `delamain` field; if root/base fields declare one, variants declare none.
- For variant entities whose root/base fields declare no `delamain` field, each variant may declare at most one `delamain` field in that variant's effective schema.
- A Delamain primary definition file declares ordered `phases`.
- A Delamain primary definition file declares authoritative `states`.
- A Delamain primary definition file declares explicit `transitions`.
- Delamain-local asset paths resolve relative to the directory containing the Delamain primary definition file, which is the Delamain bundle root.
- Delamain phase names are unique within one primary definition file.
- State names are the legal persisted values for the bound field.
- Each state may declare `initial: true`.
- Each state may declare `terminal: true`.
- Each state may declare `phase: <phase-name>`.
- Each non-terminal state declares `actor: operator | agent`.
- `phases` are the ordered lifecycle layers of the Delamain graph. ALS does not add a separate standalone lifecycle primitive in this pass.
- Every transition declares `class: advance | rework | exit`.
- `advance` and `rework` transitions declare `from: <state-name>`.
- `exit` transitions declare `from: <state-name>` or `from: [<state-name>, ...]`.
- A transition declares `to: <state-name>`.
- `actor` identifies the required executor of work performed while a record is in that state.
- `actor: operator` means progress from that state requires operator action.
- `actor: agent` means progress from that state requires agent action.
- Effective transition ownership is inherited from the source state, not declared on the transition itself.
- `advance` means the target is non-terminal and is in the same phase or the next declared phase.
- `rework` means the target is non-terminal and is in the same phase or an earlier declared phase.
- `exit` means the target is terminal.
- Delamain graphs reject self-loop transitions.
- Delamain graphs require every declared phase to contain at least one state.
- Delamain graphs require the initial state to be in the first declared phase.
- Delamain graphs require terminal states to be in the last declared phase.
- Delamain graphs require every non-terminal state to have a path to at least one terminal state.
- Delamain graphs reject states that are both `initial: true` and `terminal: true`.
- Transitions are explicit. ALS does not infer legal moves from phase order alone.
- Delamain is a phase-constrained transition graph surface, not a dispatcher or orchestrator runtime surface.
- Delamain primary definition files do not inline hooks, commands, prompts, side-effect instructions, queue-membership metadata, or free-text semantic fields in this pass.

## Normative Effect

- Required: `shape.yaml` declares Delamain names explicitly when the module uses `delamain`.
- Required: every declared Delamain registry entry resolves to a Delamain primary file in the same module version bundle.
- Required: every referenced Delamain appears in the `shape.yaml` registry.
- Required: `shape.yaml` remains the field-binding and Delamain-registry surface; Delamain definitions live in primary files inside Delamain bundles.
- Required: every `delamain` field references a declared Delamain primary file in the same module bundle.
- Required: plain entities declare at most one `delamain` field.
- Required: if a variant entity's root/base fields declare a `delamain` field, its variants declare no `delamain` fields.
- Required: if a variant entity's root/base fields declare no `delamain` field, each variant declares at most one `delamain` field in that variant's effective schema.
- Required: every Delamain primary definition file declares ordered `phases`.
- Required: Delamain-local asset paths resolve relative to the directory containing the Delamain primary definition file.
- Required: Delamain-local asset paths resolve to files that remain inside the same module-version bundle.
- Required: Delamain phase names are unique within one primary definition file.
- Required: Delamain state names are unique within one primary definition file.
- Required: each Delamain primary definition file has exactly one `initial: true` state.
- Required: every state declares `phase`.
- Required: every declared `phase` value appears in the Delamain file's `phases` list.
- Required: every declared phase contains at least one state.
- Required: the initial state is in the first declared phase.
- Required: terminal states are in the last declared phase.
- Required: no state is both `initial: true` and `terminal: true`.
- Required: every non-terminal state declares `actor`.
- Required: terminal states do not declare `actor`.
- Required: every transition `from` and `to` value references declared states.
- Required: every transition declares `class`.
- Required: transitions do not declare `actor`.
- Required: self-loop transitions are rejected.
- Required: every state is reachable from the Delamain initial state after expanding list-valued `from` declarations into effective edges.
- Required: `delamain` fields use the referenced Delamain file's declared state names as their legal persisted values.
- Required: `advance` transitions target non-terminal states only.
- Required: `advance` transitions declare exactly one source state.
- Required: `advance` transitions move to the same phase or the next declared phase only.
- Required: `rework` transitions target non-terminal states only.
- Required: `rework` transitions declare exactly one source state.
- Required: `rework` transitions move to the same phase or an earlier declared phase only.
- Required: `exit` transitions target terminal states only.
- Required: `exit` transition sources are non-terminal states.
- Required: list-valued `from` declarations are allowed only on `exit` transitions.
- Required: list-valued `from` declarations are non-empty.
- Required: list-valued `from` declarations do not repeat the same state name.
- Required: terminal states have no outgoing effective transitions.
- Required: every non-terminal state has at least one outgoing effective transition.
- Required: every non-terminal state has a path to at least one terminal state.
- Required: duplicate effective transitions are rejected after expanding list-valued `from` declarations.
- Allowed: multiple terminal states.
- Allowed: one `exit` transition entry that expands a shared `from` list into multiple legal source states for the same `to`.
- Allowed: modules that continue using plain `enum` fields for status-like values when no workflow declaration is needed.
- Allowed: parent and child entities may each declare their own `delamain` fields because each entity schema is validated independently.
- Allowed: sibling entities may each declare their own `delamain` fields because each entity schema is validated independently.
- Rejected: duplicating Delamain state values in `allowed_values` on a `delamain` field.
- Rejected: multiple `delamain` fields in the same effective entity schema.
- Rejected: inferring legal transitions from lifecycle phases alone.
- Rejected: declaring executor ownership on transitions instead of states.
- Rejected: list-valued `from` declarations on `advance` or `rework` transitions.
- Rejected: state-local attention or queue-membership flags inside Delamain primary definition files in this pass.
- Rejected: embedding dispatch commands, agent prompts, context actions, or operator menus inside Delamain primary definition files in this pass.
- Rejected: a separate first-class lifecycle primitive as the first workflow feature surface.
- Rejected: forcing large transition graphs to live inline in `shape.yaml`.
- Rejected: relying on free-text meaning fields as the primary semantic contract for coherence in this pass.

## Compiler Impact

- Extend module loading so bundles may contain Delamain primary files and related assets under `delamains/`.
- Extend shape parsing so modules may declare a `delamains` registry.
- Extend frontmatter field parsing so shapes may declare `type: delamain` plus required `delamain`.
- Add field-binding validation so each effective entity schema may declare at most one `type: delamain` field.
- Add Delamain-file loading and validation for unknown Delamain references, duplicate Delamain names in the registry, duplicate phase names, duplicate state names, missing or multiple initial states, missing phases, unknown phase names, empty phases, initial states outside the first phase, terminal states outside the last phase, states marked both initial and terminal, missing actor on non-terminal states, actor declared on terminal states, forbidden list-valued `from` declarations on `advance` or `rework`, empty `from` lists, duplicate values inside `from` lists, self-loop transitions, and transitions that reference undeclared states.
- Add Delamain-local asset-path resolution relative to the Delamain primary definition file and reject resolved targets that escape the same module-version bundle.
- Add Delamain transition-class validation for `advance`, `rework`, and `exit` against declared phase order and terminal-state annotations.
- Add Delamain graph validation for reachability from the initial state, missing outgoing transitions on non-terminal states, missing paths from non-terminal states to terminal states, forbidden outgoing transitions on terminal states, and duplicate effective edges after list expansion.
- Treat Delamain state names as the legal current-value set for the bound field during snapshot validation.
- Do not claim that snapshot validation alone proves a record arrived at its current state legally.
- If ALS later validates transitions on write or across diffs, that behavior should build on this declaration surface rather than changing the authored syntax.
- Keep dispatcher, orchestrator, hook, and context-action behavior out of the compiler contract for this pass.

## Docs and Fixture Impact

- Update the canonical shape-language reference to document the `delamains` registry in `shape.yaml`, `delamain`, Delamain bundles under `delamains/`, Delamain-local path resolution from the bundle root, state `actor`, transition `class`, `states`, `transitions`, `phases`, and the boundary between Delamain and later runtime constructs.
- Add a forward-looking `software-factory` design-reference example system that paints a backlog-style software delivery flow without using entity variants.
- Use that fixture to show `kind` as ordinary classification.
- Use that fixture to show `status` as Delamain-governed state.
- Use that fixture to show `phase` as lifecycle grouping metadata.
- Keep that fixture coherent under the Delamain graph invariants: unique phases, populated phases, initial state in the first phase, terminal states in the last phase, no self-loops, all states reachable, no outgoing edges from terminal states, no dead-end non-terminal states, a path from every non-terminal state to at least one terminal state, and no duplicate effective edges.
- Add positive and negative compiler tests only after the declaration surface is settled and implemented.

## Alternatives Considered

- Add a standalone lifecycle primitive first.
- Rejected because lifecycle phases are useful metadata but are too weak to express legal transitions.
- Allow multiple Delamain-bound fields on the same effective entity schema.
- Rejected because one record with multiple independently active Delamain graphs would create ambiguous ownership, competing runtime behavior, and frontmatter collision pressure.
- Add a full workflow engine first.
- Rejected because that would mix state contracts, runtime dispatch, operator UX, and side effects into one early DSL.
- Use a generic construct name such as `workflow` or `process graph`.
- Rejected because ALS may grow multiple graph-like constructs and the authored surface needs one specific name for this one.
- Extend `type: enum` with transition metadata inside `shape.yaml`.
- Rejected because once a field is Delamain-governed, it is no longer just a plain enum and the resulting large graphs do not belong inline in the shape file.
- Keep executor ownership on transitions.
- Rejected because dispatch is triggered by current state, and state ownership is the coherent place to express who advances work from that state.
- Allow `advance` and `rework` to use list-valued `from`.
- Rejected because those classes are intended to express one specific semantic move from one source state, while shared many-source exits are the narrow case where list expansion remains coherent.
- Allow only single-state `from` values.
- Rejected because realistic workflows quickly repeat the same `to` across many source states, creating avoidable authored noise.
- Resolve Delamain files by filename convention alone.
- Rejected because the authored shape should minimize hidden assumptions and give agents an explicit binding surface they can trust directly.
- Require at least one `terminal: true` state as a separate rule.
- Rejected because once every non-terminal state must have a path to at least one terminal state, the existence of at least one terminal state is already implied.
- Require every declared state to appear explicitly in at least one transition.
- Rejected because reachability from the initial state plus outgoing-transition requirements for non-terminal states already make orphan states invalid.
- Require the initial state to have no incoming transitions.
- Rejected because some Delamain graphs may validly re-enter the initial state, and the first pass should not ban that shape without a stronger use case.
- Require `attention: true` states to be operator-owned states.
- Rejected because queue and operator-surface concerns belong to a later orchestrator-layer construct rather than to the first Delamain state-graph contract.
- Keep `attention` as a state-local flag in Delamain.
- Rejected because Delamain now treats required executors as state semantics and leaves queue/surface semantics to later constructs.
- Add free-text semantic fields such as `meaning` as part of the first Delamain contract.
- Rejected because the first pass should encode coherence in machine-checkable transition classes rather than relying on prose.
- Put dispatch hooks directly in the first Delamain primitive.
- Rejected because runtime behavior should layer on top of the state contract, not define the first pass.

## Open Questions

- Should a later pass add more Delamain transition classes beyond `advance`, `rework`, and `exit`?
- Should a later pass add symbolic selectors such as `from: non-terminal`, or is `from: [state, ...]` sufficient for the intended authoring pressure?
- Should a later orchestrator-layer construct derive its queue from Delamain state ownership alone, or declare queue membership explicitly?
- What is the smallest ALS-controlled write surface that can validate transitions as transitions rather than only validating the resulting snapshot?

## Non-Goals

- A first-class dispatcher language.
- A first-class orchestrator or operator-console language.
- State-entry and state-exit hooks.
- Side-effect execution semantics.
- Free-text semantic interpretation inside the core validator.
- Historical transition validation during ordinary snapshot-only `validate` runs.
