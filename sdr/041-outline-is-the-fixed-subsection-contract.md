# ALS Outline Is the Fixed Subsection Contract

## Status

Proposed

## Context

- ALS-073 was filed under the assumption that the compiler could hard-enforce required H2 sections but could not hard-enforce required named H3 subsections inside an H2.
- Research found that ALS already ships an exact heading-tree primitive for that job: `content.mode: "outline"`, documented in `skills/docs/references/shape-language.md` and already used in `reference-system/.als/modules/incident-response/v1/module.ts`.
- The compiler already enforces that surface in `alsc/compiler/src/markdown.ts` via `validateOutlineContent()`, including missing-node rejection (`BODY_OUTLINE_NODE_MISSING`) and undeclared-preamble rejection (`BODY_OUTLINE_PREAMBLE_UNDECLARED`).
- The real gap is narrower than the draft assumed. Outline nodes today do not carry node-level `allow_null`, node-level `guidance`, or nested full `ContentShape`; they carry exact `heading` metadata plus freeform node content.
- The live `als-factory v2` `CHANGE_IMPACT` consumer cited in the draft is not present in this checkout, so this pass is a language-contract decision first and a consumer-wiring job later.

## Decision

- ALS v1 uses existing `content.mode: "outline"` as the authoritative authored contract when an H2 section requires fixed named ordered H3 subsections.
- ALS v1 does not add a new `SectionShape.subsections` primitive for the exact-H3 use case.
- When the semantic contract is "this H2 must contain these exact H3 headings in this order," the section declares those headings as `outline.nodes` with exact `heading.depth` and `heading.text`.
- For top-level body sections, the fixed subsection headings are authored as `depth: 3` outline nodes unless a different structural depth is explicitly required by the surrounding region.
- Section-level `allow_null` and `guidance` remain on the H2 `SectionShape`.
- Outline-node bodies continue to use the existing `FreeformContentShape` contract.
- ALS v1 does not use this decision to add optional outline nodes, repeated outline nodes, node-level `allow_null`, node-level `guidance`, or nested non-freeform node content.
- The future `CHANGE_IMPACT` consumer should be authored as an outline section with exact H3 nodes `Language Impact` and `Construct Impacts` once that consumer exists in the ALS repo.

## Normative Effect

- Required: fixed named ordered H3 subsection contracts inside an H2 are authored with `content.mode: "outline"`.
- Required: missing or misspelled required subsection headings reject through the existing outline validation path, including `BODY_OUTLINE_NODE_MISSING`.
- Required: undeclared prose before the first required subsection heading rejects through `BODY_OUTLINE_PREAMBLE_UNDECLARED` unless the section explicitly declares an outline preamble.
- Required: section-level nullability and guidance remain H2-level concerns under this decision.
- Required: when a downstream consumer needs exact subsection names, the authored surface must encode them in compiler-validated shape data rather than relying only on prompt discipline or gate-local structural checks.
- Allowed: an explicitly declared outline preamble before the required H3 nodes.
- Allowed: deeper headings inside an outline node body when the node's freeform block rules permit them.
- Allowed: a future ADR/SDR to introduce a new primitive if ALS gains a real need for node-level semantics that outline cannot express.
- Rejected: adding a new `subsections` field in ALS v1 solely to hard-require exact H3 names.
- Rejected: treating fixed named H3 subsection contracts as unconstrained freeform headings plus downstream ad-hoc validation only.
- Rejected: silently widening outline in this decision to include optional nodes, repeated nodes, node-level `guidance`, node-level `allow_null`, or nested full `ContentShape`.

## Compiler Impact

- No new compiler primitive is required to satisfy exact-H3 enforcement.
- The current ownership roots for this contract remain:
  - `alsc/compiler/src/schema.ts` for `OutlineContentShape` and `OutlineNodeShape`
  - `alsc/compiler/src/markdown.ts` for `validateOutlineContent()`
  - `alsc/compiler/src/diagnostics.ts` for the `body.outline.*` diagnostic reasons
  - the existing outline regression coverage in `alsc/compiler/test/body-contract-negative.test.ts`
- A future consumer may delete duplicate gate-local subsection checks once it is authored against outline and the remaining validation can safely defer to compiler diagnostics.
- If ALS later needs node-level subsection semantics beyond outline, that work must land as a new explicit decision record plus matching schema, docs, diagnostics, and test changes rather than as an implicit extension of this decision.

## Docs and Fixture Impact

- Add this SDR as the decision record for ALS-073's recommended v1 direction.
- Update the canonical shape-language documentation to state explicitly that required named H3s inside an H2 are an outline use case, ideally with a `CHANGE_IMPACT`-shaped example once the decision is accepted.
- The next planning pass should paint synthetic `CHANGE_IMPACT` examples and counterexamples using outline, because the live `als-factory v2` consumer is not yet present in this checkout.
- No new compiler tests are required to prove exact-H3 enforcement itself; that behavior is already covered by existing outline tests. Any future consumer-specific tests should reuse the existing outline contract rather than restating it under a second primitive.
- No `als_version` bump, language-upgrade recipe, or frozen-fixture version hop is part of this decision.

## Alternatives Considered

- Add a new `subsections` primitive.
- Rejected for this pass because ALS already has exact ordered H3 enforcement through outline. A new primitive is justified only if the operator explicitly wants node-level semantics outline does not have.

- Replace outline with a new primitive everywhere fixed H3s appear.
- Rejected because outline is already documented and already used in live authored source. Migration churn is not justified without a real semantic gap.

- Keep the current "prompt-only plus gate-local checks" posture for fixed subsection names.
- Rejected because the whole point of this pass is to make compiler-validated shape, not agent prompt discipline, the structural source of truth.

## Non-Goals

- Wiring the absent `als-factory v2` `CHANGE_IMPACT` consumer in this pass.
- Adding node-level `allow_null`, node-level `guidance`, or nested non-freeform content to outline nodes.
- Any ALS v2 epoch cutover, `SUPPORTED_ALS_VERSIONS` widening, or `language-upgrades/recipes/v1-to-v2/` work.
