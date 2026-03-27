<div align="center">

# ALS — Agent Language Specification

A strict specification language for agent systems.

**Under active development. Not yet released.**

</div>

---

## The Problem

### Every time your agent writes a file, it looks *slightly different*

Your agent creates an invoice. Next time, the fields are in a different order. Next time, a section is missing. Next time, the date format changed. **Same folder, same intent — different structure every time.**

> Personal agent systems have no way to enforce structure on their own filesystem. The agent writes what seems right in the moment. Over weeks, you get drift.

> Furthermore, workflows and processes are completely made up each time — every session reinvents how to store, organize, and retrieve its own output.

## The Answer

ALS defines **structure** for your data and **process** for your workflows.

> Markdown files become typed, structured, and verifiable.

> Skills become the process entry point — the mechanism that enforces how your agent interacts with that data.

## How It Works

ALS applies the same two-layer architecture that classical software uses — but built on markdown files and agent skills instead of code and databases.

```
CLASSICAL SOFTWARE                              ALS

┌───────────────────────┐           ┌───────────────────────┐
│   App / Business Logic│           │        Skills          │
└───────────────────────┘           └───────────────────────┘

┌───────────────────────┐           ┌───────────────────────┐
│       Database        │           │      Filesystem        │
│                       │           │                        │
│  ┌─────────────────┐  │           │  ┌──────────────────┐  │
│  │     Schema      │  │           │  │    shape.yaml    │  │
│  └─────────────────┘  │           │  └──────────────────┘  │
│                       │           │                        │
│  ┌────────┐┌────────┐ │           │  ┌────────┐┌────────┐  │
│  │ users  ││ orders │ │           │  │backlog ││ exper~ │  │
│  │--------││--------│ │           │  │--------││--------│  │
│  │ id     ││ id     │ │           │  │ items/ ││ prog~/ │  │
│  │ name   ││ user_id│ │           │  │ ├ 001  ││ ├ PRG/ │  │
│  │ email  ││ amount │ │           │  │ └ 002  ││ │ └run/│  │
│  │        ││ status │ │           │  │        ││ └ PRG/ │  │
│  └────────┘└────────┘ │           │  └────────┘└────────┘  │
│                       │           │                        │
└───────────────────────┘           └───────────────────────┘

              Same architecture. Different primitives.
```

**Databases** have schemas that define what valid data looks like. Tables hold rows. Foreign keys encode relationships.

**ALS** has shapes that define what valid data looks like. Directories hold markdown records. Filesystem paths encode relationships.

The compiler validates everything. Skills provide the interface.

## Migrations

ALS codifies schema migrations the same way classical software does — prepare, test, execute, flip.

```
CLASSICAL SOFTWARE

  v1                          Migration                        v2
┌──────────┐                                               ┌──────────┐
│ App Logic│───────────── Update code ────────────────────▶│ App Logic│
└──────────┘                                               └──────────┘
┌──────────┐    Write DDL ──▶ Test on staging ──▶ Run on   ┌──────────┐
│ Database │─────────────────────────────────────production▶│ Database │
│  Schema  │                                               │  Schema  │
│  Tables  │                                               │  Tables  │
└──────────┘                                               └──────────┘


ALS

  v1                          Migration                        v2
┌──────────┐                                               ┌──────────┐
│  Skills  │───────────── Update skills ──────────────────▶│  Skills  │
└──────────┘                                               └──────────┘
┌──────────┐    Update shape ▶ Dry-run on clone ▶ Run on   ┌──────────┐
│Filesystem│─────────────────────────────────────  live   ─▶│Filesystem│
│shape.yaml│                                               │shape.yaml│
│ Records  │                                               │ Records  │
└──────────┘                                               └──────────┘
```

`change` prepares the next version bundle. `migrate` tests it on a disposable clone, then executes the live cutover. Every migration is versioned, manifested, and auditable.

## Project Status

- **v1 is the current focus.** Lessons from v0 were applied — several hard-to-implement features were removed from the initial scope and will be reintroduced later.
- The working reference implementation is in `example-systems/`.
- The compiler is being built to match the intended solution.

## Repository Structure

```
alsc/
  compiler/       # The ALS compiler — validates systems against shapes
  skills/         # ALS skill definitions (new, change, migrate, validate)
sdr/              # Spec Decision Records — the decision trail
example-systems/  # Reference implementations
pre-release/      # Risk analysis and next steps
```
