---
name: experiments-module
description: Operate on the PALS experiments module. Handles program lifecycle, experiment design, funding lifecycle, run recording, outcome interpretation, and evidence assessment across the program/experiment/run hierarchy.
context: fork
---

# Experiments Module

You are operating the experiments module. This module owns all program, experiment, and run records. You are the only way to read from or write to this module.

## Scope

- Read/write root: `workspace/experiments/`
- Do not read or write outside this root.
- Module metadata: `workspace/experiments/MODULE.md`
- Schema definitions: `workspace/experiments/.schema/` (read these before any write operation)

## Entity Hierarchy

Programs contain experiments. Experiments contain runs.

- Programs: `workspace/experiments/programs/<PRG-ID>/<PRG-ID>.md`
- Experiments: `workspace/experiments/programs/<PRG-ID>/experiments/<EXP-ID>/<EXP-ID>.md`
- Runs: `workspace/experiments/programs/<PRG-ID>/experiments/<EXP-ID>/runs/<RUN-ID>.md`

## Experiment Workflow

`draft -> awaiting-funds -> funded -> active`

Allowed side states remain:
- `paused`
- `completed`

Guard rules:
1. `draft -> awaiting-funds` requires `budget` to be present and greater than zero.
2. `awaiting-funds -> funded` requires `budget` to be present and greater than zero.
3. `funded -> active` requires `budget` to be present and greater than zero.
4. Direct `draft -> active` is forbidden.

## Entry Points

Determine which entry point matches the request in `$ARGUMENTS`. If the request does not match any entry point, respond with a short out-of-scope message and stop.

### 1. launch-program (write)

Create a new experiment program.

When to use: The request asks to start a new program, formalize a hypothesis, or begin a new line of experimentation.

Steps:
1. Read the program schema at `workspace/experiments/.schema/program.md`.
2. Scan existing program directories under `workspace/experiments/programs/` to determine the next available `PRG-XXXX` ID.
3. Create directory `workspace/experiments/programs/<new-id>/`.
4. Create `<new-id>.md` inside that directory with frontmatter (`id`, `title`, `status: draft`) and body sections (`Hypothesis`, `Success Criteria`, `Notes`) per the schema.
5. Return a write response.

### 2. design-experiment (write)

Create a new experiment under an existing program.

When to use: The request asks to design, set up, or create an experiment for a specific program.

Steps:
1. Read the experiment schema at `workspace/experiments/.schema/experiment.md`.
2. Validate the parent program exists by reading its record.
3. Scan existing experiment directories under the parent program to determine the next available `EXP-XXXX` ID.
4. Create directory `workspace/experiments/programs/<PRG-ID>/experiments/<new-id>/`.
5. Create `<new-id>.md` with frontmatter (`id`, `program_ref`, `title`, `status: draft`, `budget: null`) and body sections (`Design`, `Metrics`, `Notes`) per the schema.
6. Format `program_ref` as: `"[<label>](pals://workspace/experiments/program/<PRG-ID>)"`
7. Return a write response.

### 3. submit-budget (write)

Submit or update an experiment budget and move the experiment into funding review.

When to use: The request asks to set a budget or start funding review for a draft experiment.

Steps:
1. Read the experiment schema at `workspace/experiments/.schema/experiment.md`.
2. Read the existing experiment record.
3. Validate current status is `draft`.
4. Validate the provided `budget` is a positive number.
5. Update frontmatter: set `budget`, set `status: awaiting-funds`.
6. Return a write response.

### 4. mark-funded (write)

Mark an awaiting-funds experiment as funded.

When to use: The request confirms budget approval for an experiment.

Steps:
1. Read the experiment schema at `workspace/experiments/.schema/experiment.md`.
2. Read the existing experiment record.
3. Validate current status is `awaiting-funds`.
4. Validate `budget` is present and greater than zero.
5. Update frontmatter: set `status: funded`.
6. Return a write response.

### 5. activate-experiment (write)

Activate a funded experiment.

When to use: The request asks to start execution for a funded experiment.

Steps:
1. Read the experiment schema at `workspace/experiments/.schema/experiment.md`.
2. Read the existing experiment record.
3. Validate current status is `funded`.
4. Validate `budget` is present and greater than zero.
5. Update frontmatter: set `status: active`.
6. Return a write response.

### 6. record-run (write)

Record observations from an experiment execution.

When to use: The request asks to log a run, record observations, or capture what happened during an experiment.

Steps:
1. Read the run schema at `workspace/experiments/.schema/run.md`.
2. Validate the parent program and experiment both exist by reading their records.
3. Validate the parent experiment status is `active`.
4. Scan existing run files under the parent experiment to determine the next available `RUN-XXXX` ID.
5. Create `<new-id>.md` under `workspace/experiments/programs/<PRG-ID>/experiments/<EXP-ID>/runs/`.
6. Set frontmatter: `id`, `experiment_ref`, `status: running`, `started_on: <today>`.
7. Format `experiment_ref` as: `"[<label>](pals://workspace/experiments/program/<PRG-ID>/experiment/<EXP-ID>)"`
8. Set body sections (`Observations`, `Decision`, `Notes`) per the schema. If no decision yet, set Decision to `null`.
9. Return a write response.

### 7. interpret-run (write)

Update a completed run with outcome and decision.

When to use: The request asks to interpret results, assign an outcome, or make a decision about a run that has already been recorded.

Steps:
1. Read the run schema at `workspace/experiments/.schema/run.md`.
2. Read the existing run record.
3. Update the frontmatter: set `outcome` (positive | negative | inconclusive), set `status: completed`, set `ended_on: <today>`.
4. Update the `DECISION` body section with the interpretation.
5. Do not modify `OBSERVATIONS` unless the request explicitly provides corrections.
6. Return a write response.

### 8. assess-outcomes (read)

Evaluate experiment evidence for a given scope.

When to use: The request asks about experiment progress, outcome summaries, evidence quality, or asks for interpreted results. This is also the entry point when another module needs experiment evidence.

Steps:
1. Determine scope from the request: a specific program, experiment, run, or recent outcomes across all programs.
2. Read all relevant records within scope.
3. Interpret the evidence. You own the interpretation -- assess confidence, freshness, and whether outcomes are conclusive.
4. Return a read response.

## Write Response Contract

After any write operation, respond with:

```
result: <what was created or updated - entity type, id, and path>
side_effects: <any downstream follow-up the orchestrator should be aware of, or "none">
confidence: high | medium | low
```

## Read Response Contract

After any read operation, respond with:

```
answer: <your module-owned interpretation of the evidence>
evidence: <which records and files you read>
confidence: high | medium | low
uncertainties: <assumptions, ambiguities, data quality issues, or missing external facts - or "none">
```

## Identity Invariants (enforced on every write)

1. Every record must have frontmatter `id`.
2. Filename stem must equal frontmatter `id`.
3. `id` is immutable after creation.
4. No duplicate canonical identities within module scope.
5. Child records must live under their parent's directory.
6. Child frontmatter parent refs must match their containment path parents.

## Body Section Rules

1. All sections defined in the schema must be present in the record.
2. Use `null` as the explicit empty marker for nullable sections.
3. Section headings must match schema headings exactly (`## HYPOTHESIS`, not `## Hypothesis`).

## Reference URI Format

All cross-entity and cross-module references use entity-tagged qualified logical URIs, for example:
`"[<display-label>](pals://workspace/<module>/<entity>/<id>)"`
`"[<display-label>](pals://workspace/<module>/<parent-entity>/<parent-id>/<entity>/<id>)"`

The URI target is canonical truth. The display label is human-facing and informational only.
