# Delamain-Coupled Transition Agents

## Status

Proposed

## Context

- SDR 018 proposes Delamain as ALS's phase-constrained transition graph construct.
- The current backlog pipeline does not only need valid transitions. It also needs authored prompts that tell an agent how to enact those transitions.
- In the Ghost backlog system, those prompts live today as prose in dispatch references and hand-authored skills outside the ALS declaration surface.
- The current prompt assets are tightly coupled to the SDLC transition model. They are not yet a proven independent construct.
- A first draft that keeps transition prompts local to Delamain will make the coupling explicit and let fixtures pressure-test the authored surface before ALS attempts a more general reusable agent system.
- The desired file shape is the same broad form as a Claude sub-agent: frontmatter plus markdown prompt instructions.

## Decision

- ALS adds a first draft `agents` construct that is scoped inside a Delamain companion file.
- A Delamain companion file may declare an explicit `agents` registry.
- Delamain-local agents are strongly coupled to the Delamain that declares them in this pass.
- A transition that uses a Delamain-local agent must declare a stable transition `id`.
- Every transition in a Delamain that declares an `agents` registry must declare exactly one `agent: <name>` reference.
- The `agent` reference must resolve through the Delamain-local `agents` registry, not through filename convention.
- Each Delamain-local agent registry entry maps an agent name to a markdown file path in the same module-version bundle.
- Agent files are markdown files with YAML frontmatter plus a markdown body.
- The authored file shape intentionally mirrors Claude sub-agent files in this first draft.
- ALS treats Delamain-local agent files as prompt assets in this pass. The body content is not interpreted semantically by the compiler.
- In this first pass, ALS validates only the coupling surface: registry entries, transition references, file resolution, and minimal agent-file shape.
- There is one Delamain-local agent per declared transition entry, not per expanded effective edge after list-valued `from` expansion.
- List-valued exit transitions still declare exactly one transition `id` and exactly one agent.
- Delamain-local agents are not a standalone module-level construct in this pass.

## Normative Effect

- Required: every Delamain transition that declares `agent` also declares `id`.
- Required: transition `id` values are unique within one Delamain companion file.
- Required: if a Delamain companion file declares `agents`, then every transition in that file declares exactly one `agent`.
- Required: every transition `agent` reference resolves to a declared Delamain-local agent registry entry.
- Required: every declared Delamain-local agent registry entry resolves to a markdown file in the same module-version bundle.
- Required: every resolved Delamain-local agent file contains YAML frontmatter.
- Required: every resolved Delamain-local agent file contains a non-empty markdown body after frontmatter.
- Required: Delamain-local agent files declare frontmatter `name`.
- Required: Delamain-local agent files declare frontmatter `description`.
- Allowed: Delamain-local agent files may declare additional Claude-style frontmatter such as `tools`, `model`, or `color`.
- Allowed: operator-owned transitions, agent-owned transitions, and system-owned transitions may all reference Delamain-local agents in this pass.
- Allowed: one list-valued exit transition may use one Delamain-local agent.
- Rejected: resolving Delamain-local agent files by convention alone.
- Rejected: transitions without stable `id` values once Delamain-local agents are in use.
- Rejected: one Delamain-local agent shared across multiple declared transitions in this first pass.
- Rejected: module-level or system-level standalone `agents` declarations in this pass.
- Rejected: interpreting agent prompt prose as part of Delamain graph validation in this pass.

## Compiler Impact

- Extend Delamain parsing so companion files may declare an `agents` registry.
- Extend transition parsing so transitions may declare `id` and `agent`.
- Add validation for duplicate transition `id` values inside one Delamain.
- Add validation for missing `agent` on transitions when the Delamain declares an `agents` registry.
- Add validation for unknown Delamain-local agent references.
- Add file-resolution and file-shape validation for Delamain-local agent markdown files, including required frontmatter and required `name` plus `description`.
- Do not interpret prompt body semantics, tool lists, model selection, or instruction quality inside the compiler in this pass.

## Docs and Fixture Impact

- Update the canonical shape-language reference later to document Delamain-local `agents`, transition `id`, transition `agent`, and the Delamain-local file layout for agent prompt assets.
- Extend the `software-factory` design-reference example so its `delivery` Delamain declares explicit transition ids and a Delamain-local `agents` registry.
- Add one Delamain-local agent markdown file per declared transition entry in that example.
- Use the fixture to pressure-test naming, path layout, and how transition-local prompt assets read when coupled directly to Delamain.
- Keep this fixture draft-focused. It does not need to prove runtime execution semantics yet.

## Alternatives Considered

- Add a standalone top-level ALS `agents` construct first.
- Rejected because the current need is transition-local prompt assets whose reuse and independence are not yet proven.
- Attach agents to states rather than transitions.
- Rejected because the current backlog pattern is defined around specific transitions and transition outcomes, not only around entering states.
- Resolve agent files by naming convention from transition signatures.
- Rejected because the authored surface should keep the binding explicit and minimize hidden assumptions.
- Allow one agent to be reused across multiple transitions.
- Rejected because the first draft should keep the coupling one-to-one so fixtures reveal whether the transition grain is correct.

## Open Questions

- Should Delamain-local agents later become a standalone ALS construct?
- Should transition-local agents remain one-to-one with transitions, or should a later pass allow reusable agent templates?
- Should ALS later validate more of the Claude-style frontmatter contract beyond `name` and `description`?
- Should operator-owned transitions keep explicit agents, or should a later orchestrator construct absorb some of that authored surface?

## Non-Goals

- A general-purpose reusable agent catalog.
- Runtime execution semantics for how a host launches Delamain-local agents.
- Compiler judgment about whether a prompt is good, complete, or logically sound.
