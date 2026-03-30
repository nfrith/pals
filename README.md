<div align="center">

# ALS — Agent Language Specification

A strict specification language for agent systems.

**Beta Research Preview**

ALS is public for early adopters who are comfortable with breakage, manual rewrites, and rapid iteration. Read the preview contract in [RESEARCH-PREVIEW.md](RESEARCH-PREVIEW.md).

</div>

---

## What ALS Is

ALS gives agent systems a strict, filesystem-backed contract:

- `shape.yaml` defines what valid records look like
- the compiler validates module shapes, records, refs, and body structure
- skill bundles define the intended process surface for working with that data

The goal is simple: fewer ad hoc file conventions, less drift, and a clearer boundary between structure and workflow.

## What Works Today

The current public preview is centered on two usable surfaces:

- `alsc validate` validates an ALS system and emits machine-readable JSON
- `alsc deploy claude` projects active ALS skill bundles into `.claude/skills/`
- `example-systems/` provides reference systems and fixtures for the current ALS v1 contract

## Install

ALS is distributed as a Claude Code plugin. Requires [Bun](https://bun.sh) >= 1.3.0 and [jq](https://jqlang.github.io/jq/).

### Option A: From the terminal

```bash
claude plugin marketplace add https://github.com/nfrith/als
claude plugin install als@als-marketplace
```

### Option B: From inside Claude Code

1. Type `/plugin`
2. Navigate to the **Marketplaces** tab and select **+ Add Marketplace**
3. Enter `https://github.com/nfrith/als` as the marketplace source
4. Go to the **Discover** tab, select **als**, press `Space` to toggle, then `i` to install
5. Run `/reload-plugins` to activate

Once installed, ALS skills (`/new`, `/validate`, `/change`, `/deploy`) are available inside Claude Code sessions.

## How to Use

*Coming soon.*

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

### Creating a System

An operator or agent describes their domain. ALS interviews, models, and produces both artifacts in one motion.

```
              ┌───────────────────┐
              │ Operator or Agent │
              │  describes domain │
              └─────────┬─────────┘
                        │
                        ▼
                 ┌─────────────┐
                 │    /new     │
                 │  Interview  │
                 └──────┬──────┘
                        │
              ┌─────────┴─────────┐
              │                   │
              ▼                   ▼
       ┌────────────┐     ┌────────────┐
       │  SKILL.md  │     │ shape.yaml │
       └────────────┘     └────────────┘

  Define your structure. Build the process that enforces it.
```

### Migrations

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

## Preview Contract

This is a research preview, not a stability release.

- Authored-source compatibility is not guaranteed across preview releases.
- Upgrading may require manual rewrites.
- Users should pin exact preview versions.
- ALS currently supports `als_version: 1` only.
- ALS does not yet ship a language-version upgrade toolchain.
- ALS does not yet ship a real warning or deprecation lifecycle.
- Claude projection is the only harness projection surfaced in this preview.

The longer-form contract and known gaps live in [RESEARCH-PREVIEW.md](RESEARCH-PREVIEW.md).

## Repository Structure

```text
alsc/
  compiler/       # Validator and Claude skill projector
  skills/         # ALS skill definitions and workflow material
sdr/              # Spec Decision Records
example-systems/  # Reference implementations and fixtures
pre-release/      # Internal risk analysis and current-state notes
```

## Feedback

Use GitHub issues for:

- compiler bugs
- authored-system breakage reports
- research feedback on what ALS should optimize for next

See [CONTRIBUTING.md](CONTRIBUTING.md) for the expected issue detail.

## License

Copyright 2026 Section 9 Technologies LLC. Licensed under [Elastic License 2.0 (ELv2)](LICENSE).
