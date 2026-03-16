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
- Authoritative shape: `.pals/modules/experiments/v1.yaml`
- Registry entry: `.pals/system.yaml`

## Entity Hierarchy

Programs contain experiments. Experiments contain runs.

- Programs: `workspace/experiments/programs/<PRG-ID>/<PRG-ID>.md`
- Experiments: `workspace/experiments/programs/<PRG-ID>/experiments/<EXP-ID>/<EXP-ID>.md`
- Runs: `workspace/experiments/programs/<PRG-ID>/experiments/<EXP-ID>/runs/<RUN-ID>.md`

## Notes

1. Reads and writes must follow the shape declared in `.pals/modules/experiments/v1.yaml`.
2. Section headings and reference URIs are strict.
3. The workspace tree intentionally does not carry local `.schema/` or `MODULE.md` files.
