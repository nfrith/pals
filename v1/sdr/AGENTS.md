# SDR Directory Instructions

This directory stores **Specification Decision Records (SDRs)** for PALS v1.

An SDR captures a decision about what the spec means. It is the place to record normative behavior, not implementation scratch work.

## Use This Directory For

Create or update an SDR when the change answers questions like:

- What does a shape rule mean?
- What is valid or invalid under the spec?
- How should the compiler behave because of that rule?
- What diagnostic behavior is part of the spec contract?
- What semantics should docs, examples, and fixtures reflect?

Good SDR topics:

- explicit declaration semantics
- nullability semantics
- variant resolution behavior
- section ordering semantics
- ref or identity contract semantics

## Do Not Use This Directory For

Do not put these here:

- TODO lists
- implementation task plans
- debugging notes
- test run logs
- temporary brainstorms with no decision
- code-level refactor notes that do not change spec meaning

If the content is mainly "what files should change next", it does not belong in an SDR.

## Audience

Assume agents are the primary readers and writers.

Write so an agent can answer:

- what the decision is
- what behavior is now required
- what behavior is now forbidden
- what other materials must match this decision

Prefer direct language over narrative prose.

## File Naming

- One decision per file.
- Use zero-padded numeric prefixes and kebab-case slugs.
- Format: `NNN-short-decision-name.md`

Example:

- `001-explicit-declaration-semantics.md`

## File Structure

Each SDR must explicitly include these sections in this exact order:

1. `# Title`
2. `Status`
3. `Context`
4. `Decision`
5. `Normative Effect`
6. `Compiler Impact`
7. `Docs and Fixture Impact`
8. `Alternatives Considered`

Use `##` headings for every named section.

The `Status` section must contain exactly one of:

- `Proposed`
- `Accepted`
- `Superseded`
- `Rejected`

## Optional Sections

Optional sections are explicit too.

If an optional section is used, it must:

- use one of the exact heading names below
- appear after `Alternatives Considered`
- appear in the same order listed below
- be omitted entirely when it is not needed

Allowed optional sections:

- `Open Questions`
- `Non-Goals`
- `Follow-Up`
- `Supersedes`
- `Superseded By`

Do not invent additional section headings unless the user asks for a new SDR format.

## Writing Rules

- State the final decision, not a stream-of-consciousness discussion.
- Use concrete terms from the spec and compiler.
- When possible, say what is required, what is allowed, and what is rejected.
- Keep examples short and normative.
- If the decision affects diagnostics, name the diagnostic behavior explicitly.
- If the decision affects docs, examples, fixtures, or tests, say so directly.
- Prefer flat bullet lists over nested bullets.
- Distinguish clearly between what is required, what is allowed, and what is rejected.

## Minimal Template

Use this template when creating a new SDR:

```md
# Title

## Status

Accepted

## Context

- Why this decision was needed.

## Decision

- The decision.

## Normative Effect

- Required behavior.
- Allowed behavior.
- Rejected behavior.

## Compiler Impact

- Validator, schema, diagnostics, or parser effects.

## Docs and Fixture Impact

- Reference docs, examples, fixtures, and tests that must match.

## Alternatives Considered

- Rejected alternative and why.
```

## Change Rules

- Prefer creating a new SDR over rewriting history when a previous decision is materially changed.
- If an SDR is no longer current, mark it as superseded instead of deleting it.
- Minor clarifications may update an existing SDR if they do not change the decision.

## Relationship To Other Docs

- SDRs record the decision.
- Reference docs explain the final rules.
- Code implements the decision.
- Tests prove the behavior.

If a TODO becomes a settled spec decision, move that content into an SDR and then delete the TODO.
