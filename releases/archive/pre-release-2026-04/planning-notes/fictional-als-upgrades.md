# Fictional ALS Upgrades

These are invented language changes used as mental exercises for designing the ALS version upgrade toolchain. None of these are planned or proposed. They exist solely to stress-test our thinking about what upgrade tooling needs to handle — mechanical rewrites, agent-assisted decisions, and the boundary between them.

---

## 1. `allow_null` removed, replaced by `presence`

v2 removes the `allow_null` boolean and replaces it with a `presence` field that accepts three values: `required`, `optional`, `conditional`.

**Mechanical part:** Every `allow_null: false` maps to `presence: required`. Deterministic, no judgment.

**Agent-assisted part:** Every `allow_null: true` forces a decision. Is this field truly optional in all cases, or is it actually conditional on another field's value? For example, a `resolved_at` date field might be nullable — but is it optional, or is it conditional on `status: done`? That requires understanding the domain logic behind each nullable field. The upgrade toolchain cannot answer this.

---

## 2. Variant `discriminator` + `variants` block removed, replaced by `union` grouping

v2 removes the variant entity model entirely. Each variant becomes its own standalone entity definition. A new `union` construct groups them under one path namespace.

**Decisions required:**
- How do you carve up fields that were shared at the entity root vs. fields that were variant-specific?
- What are the new entity type names? The old variant values were enum strings, not entity names.
- Does the parent-child or identity hierarchy change when variants become top-level entities?
- Do cross-entity references that pointed at the old unified entity need to become union-typed refs?

This is almost entirely agent-assisted. The structural transformation is clear in principle, but every concrete decision depends on what the variants meant in the domain.

---

## 3. Content mode tightening: `freeform` sections restricted to `outline` only

v2 decides that certain section patterns must use `outline` mode instead of `freeform`. Sections that previously accepted arbitrary prose paragraphs now require structured heading-based outline nodes.

**Why this is hard:** Existing freeform content doesn't fit the new constraint. Three paragraphs of prose have no single correct restructuring into outline nodes. Someone has to decide:
- What are the outline headings?
- How does the prose break across nodes?
- Does some content get dropped or merged?

The compiler can detect the incompatibility mechanically. Resolving it cannot be mechanical.
