# Delamain State Agents

## Status

Accepted

## Context

- SDR 018 proposes Delamain as ALS's phase-constrained transition graph construct.
- SDR 019 explored prompt assets bound one-to-one to transition outcomes.
- The software-factory fixture exposed a mismatch: dispatch happens because an item is currently in a state, not because the system already knows which branch the item will take out of that state.
- Planning is the clearest example. A planning agent is dispatched because the item is in `planning`, then chooses whether the result is `plan-input` or `plan-ready`.
- The same pattern appears in review and deployment verification. One active state leads to several possible legal outcomes chosen by the work performed in that state.
- Prompt assets therefore align more naturally with current states than with pre-selected transition edges.

## Decision

- ALS adds a first draft `agents` construct scoped inside a Delamain bundle.
- Delamain-local agents are bound to states, not to transitions, in this pass.
- A non-terminal state declares `actor: operator | agent`.
- An `actor: agent` state declares `path: <markdown-path>`.
- The `path` field on a state resolves relative to the directory containing the Delamain primary definition file, which is the Delamain bundle root.
- The resolved `path` target remains inside the same module-version bundle.
- An `actor: agent` state declares `resumable: true | false`.
- `resumable` declares whether the host should persist the state agent session and attempt resume when a record re-enters that same state later.
- If `resumable: true`, the state declares `session-field: <field-id>`.
- `session-field` identifies the frontmatter field where the host persists the resumable agent session id for that state.
- Delamain-declared `session-field` values do not need to appear in `shape.yaml` entity fields.
- Hosts append Delamain-declared session fields after the shape-declared frontmatter fields when materializing entity frontmatter.
- A Delamain-declared `session-field` name must not collide with any other frontmatter field name materialized on the same effective entity schema bound to that Delamain, whether explicit in `shape.yaml` or implicit from another Delamain session field.
- An `actor: agent` state may also declare `sub-agent: <markdown-path>`.
- `sub-agent` resolves relative to the directory containing the Delamain primary definition file, which is the Delamain bundle root.
- The resolved `sub-agent` target remains inside the same module-version bundle.
- Agent files are markdown files with YAML frontmatter plus a markdown body.
- The authored file shape intentionally mirrors Claude sub-agent files in this first draft.
- Delamain-local state agents are prompt assets. Their body prose is not interpreted semantically by the compiler in this pass.
- A state-bound agent is invoked because the record is currently in that state.
- The state-bound agent may choose among the legal outgoing transitions from that state.
- A declared `sub-agent` is an optional helper prompt the state agent may call while working that state.
- Transitions remain the legal outcome graph. Agents do not replace transitions.
- `actor: operator` states do not declare Delamain-local agent paths in this pass.
- This first draft keeps Delamain-local agents strongly coupled to one Delamain instead of introducing a standalone global agent catalog.

## Normative Effect

- Required: every `path` on an `actor: agent` state resolves relative to the directory containing the Delamain primary definition file.
- Required: every resolved `path` target remains inside the same module-version bundle and is a markdown file.
- Required: every resolved state-agent markdown file contains YAML frontmatter.
- Required: every resolved state-agent markdown file contains a non-empty markdown body after frontmatter.
- Required: state-agent markdown files declare frontmatter `name`.
- Required: state-agent markdown files declare frontmatter `description`.
- Required: terminal states do not declare `path`, `resumable`, `session-field`, or `sub-agent`.
- Required: if a state declares `path`, then that state declares `actor: agent`.
- Required: if a state declares `resumable`, then that state declares `actor: agent`.
- Required: `resumable` is boolean only.
- Required: every non-terminal `actor: agent` state declares `resumable`.
- Required: if `resumable: true`, the state declares exactly one `session-field`.
- Required: if `resumable: false`, the state does not declare `session-field`.
- Required: if a state declares `session-field`, then that state declares `actor: agent`.
- Required: if a state declares `sub-agent`, then that state declares `actor: agent`.
- Required: if a non-terminal state declares `actor: agent`, then that state declares exactly one `path`.
- Required: if a non-terminal state declares `actor: operator`, then that state does not declare `path`, `resumable`, `session-field`, or `sub-agent`.
- Required: `session-field` names are unique within one Delamain bundle.
- Required: a Delamain-declared `session-field` name does not collide with any explicit field name materialized on the same effective entity schema bound to that Delamain.
- Required: a Delamain-declared `session-field` name does not collide with any other implicit Delamain session field name materialized on the same effective entity schema.
- Required: Delamain-declared `session-field` names are treated as implicit nullable string frontmatter fields on effective entity schemas bound to that Delamain.
- Required: if a state declares `sub-agent`, the referenced path resolves relative to the directory containing the Delamain primary definition file.
- Required: if a state declares `sub-agent`, the resolved target remains inside the same module-version bundle and is a markdown file.
- Required: every resolved sub-agent markdown file contains YAML frontmatter.
- Required: every resolved sub-agent markdown file contains a non-empty markdown body after frontmatter.
- Required: sub-agent markdown files declare frontmatter `name`.
- Required: sub-agent markdown files declare frontmatter `description`.
- Required: Delamain transitions do not declare `actor`.
- Allowed: Delamain-local agent files may declare additional Claude-style frontmatter such as `tools`, `model`, or `color`.
- Allowed: resumable agent states may preserve their saved session field while work sits in operator-owned states and resume it on later re-entry to the same state.
- Allowed: a state agent may invoke its declared `sub-agent` while remaining the owner of the Delamain state transition.
- Allowed: a state-bound agent may choose any legal outgoing transition from its current state.
- Allowed: transitions keep their own classes even when agents are bound to states.
- Rejected: transition-local `agent` bindings as the primary Delamain prompt surface in this pass.
- Rejected: a top-level Delamain `agents` registry in this draft surface.
- Rejected: requiring Delamain-declared `session-field` values to be explicitly duplicated in `shape.yaml`.
- Rejected: standalone module-level or system-level `agents` declarations in this pass.
- Rejected: interpreting prompt prose as part of Delamain graph validation in this pass.

## Compiler Impact

- Extend state parsing so states may declare `path`, `resumable`, optional `session-field`, and optional `sub-agent`.
- Add file-resolution and file-shape validation for state-agent markdown files, including required frontmatter and required `name` plus `description`.
- Add file-resolution and file-shape validation for referenced sub-agent markdown files.
- Add validation that terminal states do not declare `path`, `resumable`, `session-field`, or `sub-agent`.
- Add validation that `actor: agent` states declare exactly one `path` and explicit boolean `resumable`.
- Add validation that `resumable: true` states declare exactly one `session-field`.
- Add validation that `resumable: false` states do not declare `session-field`.
- Add validation that `actor: operator` states do not declare `path`, `resumable`, `session-field`, or `sub-agent`.
- Add validation that Delamain-declared `session-field` names are unique, do not collide with explicit field names materialized on the same effective entity schema, do not collide with other implicit Delamain session fields materialized on that same effective schema, and are surfaced as implicit nullable string frontmatter fields after the shape-declared fields.
- Add path-resolution validation for `path` and `sub-agent` relative to the Delamain bundle root and reject resolved targets that escape the same module-version bundle.
- Do not interpret prompt body semantics, tool lists, model selection, or instruction quality inside the compiler in this pass.

## Docs and Fixture Impact

- Update the canonical shape-language reference later to document state-level `path`, required `resumable`, optional `session-field`, path-valued optional `sub-agent`, Delamain-relative path resolution from the bundle root, and the Delamain-bundle file layout for prompt assets.
- Revise the `software-factory` design-reference example so its `development-pipeline` Delamain declares direct state-level agent paths rather than a separate registry.
- Remove explicit planner and dev session fields from the fixture `shape.yaml` and let the Delamain declaration supply them implicitly.
- Add one Delamain-local agent markdown file per agent-owned state in that example.
- Add Delamain-local helper prompt assets under `sub-agents/` where the fixture needs to sketch a nested-agent pattern.
- Use the fixture to pressure-test naming, path layout, and how state-local prompt assets read when one state agent may choose among multiple legal transitions.
- Keep this fixture draft-focused. It does not need to prove runtime execution semantics yet.

## Alternatives Considered

- Keep transition-local agents from SDR 019.
- Rejected because dispatch is triggered by current state, while transition choice is an outcome of the work performed in that state.
- Keep a separate Delamain `agents` registry.
- Rejected because the current sketch is deliberately pushing authored paths down onto the states that own execution.
- Require session persistence fields to be explicitly duplicated in `shape.yaml`.
- Rejected because resumable session storage belongs to Delamain-owned execution semantics and should not force redundant field declarations in the base entity shape.
- Add a standalone top-level ALS `agents` construct first.
- Rejected because the current need is Delamain-local prompt assets whose reuse and independence are not yet proven.
- Resolve state agent files by naming convention from state ids.
- Rejected because the authored surface should keep the binding explicit and minimize hidden assumptions.
- Resolve Delamain-local agent paths relative to the module bundle root.
- Rejected because Delamain-local assets need stable authored paths that continue to resolve when a Delamain bundle is deployed outside `.als/modules/`.
- Allow operator-owned states to declare Delamain-local agents too.
- Rejected because this draft is for autonomous prompt assets, while operator loops belong to later orchestrator-layer constructs.

## Open Questions

- Should Delamain-local agents later become a standalone ALS construct?
- Should state-bound agents remain Delamain-local, or should a later pass allow reusable agent templates?
- Should ALS later validate more of the Claude-style frontmatter contract beyond `name` and `description`?
- Should path-valued `sub-agent` remain Delamain-local, or grow into an explicit reusable registry later?
- Should Delamain later define explicit clearing semantics for saved session fields when work exits a resumable state permanently?
- Should Delamain eventually infer some transition metadata from states, or keep transitions fully explicit even when ownership lives on states?

## Non-Goals

- A general-purpose reusable agent catalog.
- Runtime execution semantics for how a host launches Delamain-local agents.
- Compiler judgment about whether a prompt is good, complete, or logically sound.
