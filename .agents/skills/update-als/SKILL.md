---
name: update-als
description: Update this repo's ALS compiler behavior, spec semantics, fixtures, examples, or reference docs when the change must be grounded in compiler rules. Use when the operator wants to enhance compiler functionality, change compiler behavior, or update docs, examples, or fixtures whose meaning depends on ALS semantics.
---

# Update ALS

## Overview

Use this skill for development work on this repo's ALS compiler and its normative materials. Drive the work from settled semantics through SDRs, fixtures, canonical shape-language documentation, compiler changes, and tests.

## Required Reads

Read these files before proposing semantics or changing compiler behavior:

- Repository rules: `../../../AGENTS.md`
- SDR process and format: `../../../sdr/AGENTS.md`

Prefer pointing back to those files over re-stating their content. If this skill and an `AGENTS.md` disagree, follow the relevant `AGENTS.md`.

## Use This Skill For

- Updating compiler behavior or diagnostics
- Adding or revising ALS syntax or semantics
- Updating fixtures, examples, or reference docs when compiler rules must be consulted
- Aligning docs, fixtures, and implementation after a spec decision

Do not use this skill for pure editorial cleanup that does not change or depend on ALS semantics.

## Workflow

Follow this order. Do not skip ahead to compiler work before the semantic decision and fixture pass are stable.

1. Discuss the change with the operator.
2. Settle the intended semantics before writing the SDR.
3. Write a new SDR with `Proposed` status once the decision is concrete.
4. Paint the proposed syntax into fixture records and shape YAML before compiler work.
5. Revise from fixture friction.
6. Ask the operator to review the proposed syntax and any friction surfaced by fixtures.
7. Update the ALS canonical shape-language documentation.
8. Mark the SDR `Accepted` once the decision and syntax are settled.
9. Implement compiler changes and tests.
10. Re-align fixtures, examples, and reference docs if implementation surfaced additional required edits.

Per `../../../sdr/AGENTS.md`, the SDR records a settled decision. It is not the brainstorm. Discuss first, then write the `Proposed` SDR.

## Discussion Phase

Use the discussion to make the decision explicit enough that fixtures can carry it. Push until the operator has answered:

- What behavior is required?
- What behavior is allowed?
- What behavior is rejected?
- What diagnostics or compiler outcomes are part of the contract?
- Which docs, examples, and fixtures must change if this decision lands?

If the operator is proposing new syntax, get concrete examples early. Use those examples to drive the fixture pass.

## SDR Phase

Create a new SDR instead of rewriting history when the change materially alters ALS meaning. Follow `../../../sdr/AGENTS.md` for file naming, section order, and status values.

Write the SDR so an agent can answer:

- what the decision is
- what behavior is required
- what behavior is forbidden
- what docs, fixtures, and compiler behavior must match it

Keep implementation task chatter out of the SDR. Put normative meaning into the SDR and implementation work into code and tests.

## Fixture-First Syntax Pass

Before compiler changes, encode the proposal in fixtures and shape YAML. This is the syntax proving ground.

Use this pass to answer:

- Is the syntax understandable in realistic records?
- Does the shape YAML stay coherent and teachable?
- Do the examples reveal awkward naming, ordering, or ambiguity?
- Is operator feedback pointing to spec friction rather than implementation friction?

Expect revision here. Fixture friction is part of the process, not a failure.

## Canonical Shape-Language Documentation

Update the ALS canonical shape-language documentation after the fixture-first pass and before compiler implementation. Treat that document as the human-readable reference for the final syntax and semantics.

Do not hardcode the document's home in your reasoning. The location is expected to move.

Current reference location:
- `../../../skills/docs/references/shape-language.md`

If that path no longer holds the canonical shape-language documentation:
- locate the new canonical file before editing
- continue using the new location
- tell the operator the reference location changed

## Implementation Phase

After the SDR is accepted and the canonical shape-language documentation is updated, implement the compiler changes. Then update or add tests required by the repo rules in `../../../AGENTS.md`.

When the change introduces new compiler behavior, add positive and negative tests that prove valid input is accepted and invalid input is rejected.

Keep docs, fixtures, and compiler behavior aligned. Do not leave reference docs teaching syntax the compiler does not implement, or fixtures demonstrating behavior the SDR rejects.

## Output Expectations

When using this skill, produce work in this shape:

1. Restate the proposed semantic change in precise terms.
2. Identify the SDR to create or update.
3. Show the fixture and shape-YAML examples that exercise the proposal.
4. Summarize any friction and ask for operator review when the syntax is still moving.
5. Identify the canonical shape-language documentation update.
6. Implement compiler and test changes only after the decision is settled.
