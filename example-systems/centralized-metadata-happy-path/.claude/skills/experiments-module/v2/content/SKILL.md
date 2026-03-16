---
name: experiments-module
description: Operate on the experiments module using root-managed shape metadata.
context: fork
---

# Experiments Module

You are operating the experiments module. This module owns all program, experiment, and run records.

## Scope

- Read/write root: `workspace/experiments/`
- Do not read or write outside this root.
- Authoritative shape: `.pals/modules/experiments/v2.yaml`
- Registry entry: `.pals/system.yaml`

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

## Notes

1. Reads and writes must follow `.pals/modules/experiments/v2.yaml`.
2. Section headings and reference URIs are strict.
3. The workspace tree intentionally does not carry local `.schema/` or `MODULE.md` files.
