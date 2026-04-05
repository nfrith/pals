# Delamain State Agents

## Status

Proposed

## Context

- SDR 018 proposes Delamain as ALS's phase-constrained transition graph construct.
- SDR 019 explored prompt assets bound one-to-one to transition outcomes.
- The software-factory fixture exposed a mismatch: dispatch happens because an item is currently in a state, not because the system already knows which branch the item will take out of that state.
- Planning is the clearest example. A planning agent is dispatched because the item is in `planning`, then chooses whether the result is `plan-input` or `plan-ready`.
- The same pattern appears in review and deployment verification. One active state leads to several possible legal outcomes chosen by the work performed in that state.
- Prompt assets therefore align more naturally with current states than with pre-selected transition edges.

## Decision

- ALS adds a first draft `agents` construct scoped inside a Delamain companion file.
- Delamain-local agents are bound to states, not to transitions, in this pass.
- A Delamain companion file may declare an explicit `agents` registry.
- A non-terminal state declares `actor: operator | agent`.
- A state may declare `agent: <name>`.
- The `agent` reference on a state resolves through the Delamain-local `agents` registry, not through filename convention.
- Each Delamain-local agent registry entry maps an agent name to a markdown file path in the same module-version bundle.
- Agent files are markdown files with YAML frontmatter plus a markdown body.
- The authored file shape intentionally mirrors Claude sub-agent files in this first draft.
- Delamain-local state agents are prompt assets. Their body prose is not interpreted semantically by the compiler in this pass.
- A state-bound agent is invoked because the record is currently in that state.
- The state-bound agent may choose among the legal outgoing transitions from that state.
- Transitions remain the legal outcome graph. Agents do not replace transitions.
- `actor: operator` states do not declare Delamain-local agents in this pass.
- This first draft keeps Delamain-local agents strongly coupled to one Delamain instead of introducing a standalone global agent catalog.

## Normative Effect

- Required: a state that declares `agent` references a declared Delamain-local agent registry entry.
- Required: every declared Delamain-local agent registry entry resolves to a markdown file in the same module-version bundle.
- Required: every resolved Delamain-local agent file contains YAML frontmatter.
- Required: every resolved Delamain-local agent file contains a non-empty markdown body after frontmatter.
- Required: Delamain-local agent files declare frontmatter `name`.
- Required: Delamain-local agent files declare frontmatter `description`.
- Required: terminal states do not declare `agent`.
- Required: if a state declares `agent`, then that state declares `actor: agent`.
- Required: if a non-terminal state declares `actor: agent`, then that state declares exactly one `agent`.
- Required: if a non-terminal state declares `actor: operator`, then that state does not declare `agent`.
- Required: Delamain transitions do not declare `actor`.
- Allowed: Delamain-local agent files may declare additional Claude-style frontmatter such as `tools`, `model`, or `color`.
- Allowed: a state-bound agent may choose any legal outgoing transition from its current state.
- Allowed: transitions keep their own ids and classes even when agents are bound to states.
- Rejected: transition-local `agent` bindings as the primary Delamain prompt surface in this pass.
- Rejected: resolving Delamain-local agent files by naming convention alone.
- Rejected: standalone module-level or system-level `agents` declarations in this pass.
- Rejected: interpreting prompt prose as part of Delamain graph validation in this pass.

## Compiler Impact

- Extend Delamain parsing so companion files may declare an `agents` registry.
- Extend state parsing so states may declare `agent`.
- Add validation for unknown state-level agent references.
- Add file-resolution and file-shape validation for Delamain-local agent markdown files, including required frontmatter and required `name` plus `description`.
- Add validation that terminal states do not declare agent.
- Add validation that `actor: agent` states declare exactly one agent.
- Add validation that `actor: operator` states do not declare `agent`.
- Do not interpret prompt body semantics, tool lists, model selection, or instruction quality inside the compiler in this pass.

## Docs and Fixture Impact

- Update the canonical shape-language reference later to document Delamain-local `agents`, state-level `agent`, and the Delamain-local file layout for agent prompt assets.
- Revise the `software-factory` design-reference example so its `delivery` Delamain declares state-level agent bindings rather than transition-level agent bindings.
- Add one Delamain-local agent markdown file per agent-owned state in that example.
- Use the fixture to pressure-test naming, path layout, and how state-local prompt assets read when one state agent may choose among multiple legal transitions.
- Keep this fixture draft-focused. It does not need to prove runtime execution semantics yet.

## Alternatives Considered

- Keep transition-local agents from SDR 019.
- Rejected because dispatch is triggered by current state, while transition choice is an outcome of the work performed in that state.
- Add a standalone top-level ALS `agents` construct first.
- Rejected because the current need is Delamain-local prompt assets whose reuse and independence are not yet proven.
- Resolve state agent files by naming convention from state ids.
- Rejected because the authored surface should keep the binding explicit and minimize hidden assumptions.
- Allow operator-owned states to declare Delamain-local agents too.
- Rejected because this draft is for autonomous prompt assets, while operator loops belong to later orchestrator-layer constructs.

## Open Questions

- Should Delamain-local agents later become a standalone ALS construct?
- Should state-bound agents remain Delamain-local, or should a later pass allow reusable agent templates?
- Should ALS later validate more of the Claude-style frontmatter contract beyond `name` and `description`?
- Should Delamain eventually infer some transition metadata from states, or keep transitions fully explicit even when ownership lives on states?

## Non-Goals

- A general-purpose reusable agent catalog.
- Runtime execution semantics for how a host launches Delamain-local agents.
- Compiler judgment about whether a prompt is good, complete, or logically sound.
