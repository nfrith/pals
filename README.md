<div align="center">

# ALS — Agent Language Specification

A model harness engineering SDK — built for Claude.

**Beta Research Preview**

ALS is public for early adopters who are comfortable with breakage, manual rewrites, and rapid iteration. Read the preview contract in [RESEARCH-PREVIEW.md](RESEARCH-PREVIEW.md).

</div>

---

## What ALS Is

ALS is a model harness engineering SDK that bridges the interface between agent and operator. Built for the Claude platforms — Claude Code CLI, Claude Cowork, Claude Code Desktop, Claude Code Web — with a vision towards wearables and ambient computing.

We started building this long before "model harness engineering" existed as a term. Before open-source alternatives appeared. The problem was clear from the start: agent systems need a strict contract between the human operator and the agents working alongside them. Who owns which state? What does the operator see? What do agents handle autonomously? How does the system follow the operator across devices?

ALS answers these questions with a filesystem-backed specification language:

- `module.ts` defines what valid records look like
- the compiler validates module shapes, records, refs, and body structure
- skill bundles define the intended process surface for working with that data
- delamain bundles define autonomous agent pipelines with operator-owned and agent-owned states
- the cyber-brain orchestrates what the operator sees and does next

The goal: a strict boundary between structure and workflow, between operator attention and agent execution, across every device the operator touches.

## What Works Today

The current public preview is centered on two usable surfaces:

- `alsc validate` validates an ALS system and emits machine-readable JSON
- `alsc deploy claude` projects active ALS Claude assets into `.claude/skills/` and `.claude/delamains/`
- `reference-system/` provides the canonical reference fixture for the current ALS v1 contract

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

Once installed, ALS skills (`/install`, `/new`, `/validate`, `/change`, `/migrate`) are available inside Claude Code sessions.

## How to Use

The ALS plugin adds skills to Claude Code — slash commands that guide Claude through structured workflows. Type the skill name in your Claude Code session to invoke it.

### `/install` — Bootstrap a new ALS system

Start here in a fresh project. ALS welcomes you, checks prerequisites, acknowledges the ALS platform code, interviews for the first module, bootstraps `.als/`, validates the authored system, and deploys the Claude assets into `.claude/`.

```
/install Track client projects with status, owner, and deliverables
```

### `/new` — Add another module

Once the project is already ALS-aware, use `/new` to add the next module. It reuses the same domain-modeling interview and authors another module bundle inside the existing system.

```
/new I also need a people directory for client contacts and owners
```

### `/validate` — Check your system

Runs the compiler against your ALS system and reports errors.

```
/validate
# Validate a specific module:
/validate backlog
```

### `/change` and `/migrate` — Evolve your schema

When you need to add a field, rename a section, modify the shape, or update a skill definition, the process is two steps: prepare, then execute.

**`/change`** prepares the next version bundle. It interviews you about the change, authors `vN+1`, and stages the migration assets — without touching live data.

```
/change backlog add a priority field
```

**`/migrate`** takes the prepared bundle and executes it. It validates the staged version, dry-runs on a disposable clone, and performs the live cutover atomically.

```
/migrate backlog
```

## How It Works

An ALS system is a directory with a `.als/` metadata tree and module data alongside it. Modules can mount at any path — top-level or nested.

```
my-system/
├── .als/
│   ├── system.ts                      # system identity and module registry
│   └── modules/
│       ├── backlog/
│       │   └── v1/
│       │       ├── module.ts          # schema: fields, sections, body contract
│       │       └── skills/
│       │           ├── backlog-create/
│       │           │   └── SKILL.md   # skill: how to create records
│       │           └── backlog-get/
│       │               └── SKILL.md   # skill: how to read records
│       └── people/
│           └── v1/
│               ├── module.ts
│               └── skills/
│                   └── people-module/
│                       └── SKILL.md
│
├── backlog/                           # module mounted at root level
│   └── items/
│       ├── ITEM-001.md                # record: typed frontmatter + governed prose
│       └── ITEM-002.md
│
└── workspace/
    └── people/                        # module mounted under workspace/
        └── PPL-001.md
```

**`module.ts`** defines what valid records look like — fields, types, nullability, enums, refs, and the exact body sections each record must contain. Variant entities can also use a discriminator to select additional frontmatter fields and a variant-specific body contract.

**`SKILL.md`** defines how agents interact with the data — the procedures, scope boundaries, and domain vocabulary for each operation.

**Records** are markdown files with YAML frontmatter. The compiler validates them against the shape. Skills provide the interface for creating and modifying them.

## Why ALS

- **Single session.** You only ever need one Claude session open. ALS systems run inside the session you already have.
- **Online-ready.** This means Claude Code online and cowork will work when they support full Claude primitives. No local-only lock-in.
- **Future-proof.** ALS builds on Claude's native surface — skills, tools, markdown. Any future Anthropic product will support it. You never have to worry about upgrading.
- **No third-party services.** You do not need to host, maintain, or pay for external agent infrastructure.
- **Anthropic-grade security.** Infinitely more secure than any third-party agent provider because you use Anthropic's security boundary, not someone else's.
- **Event-driven, token-efficient.** Agents run when work exists, not on a polling loop. No heartbeat, no daemon burning tokens in the background. The heartbeat is the operator. Always.
- **Agents run inside the session.** Dispatched agents are background shell tasks inside your single Claude session. No separate processes, no orphaned daemons.
- **Agent SDK — same guarantees.** Since agents are Claude Agent SDK sessions, they inherit the same security, updates, and future-proofing that comes with using Claude Code itself.
- **Operator and agent are first-class citizens.** The language distinguishes operator-owned and agent-owned states. Both are formalized, not bolted on.

## Philosophy

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
│  │     Schema      │  │           │  │     module.ts    │  │
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
│module.ts │                                               │module.ts │
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
reference-system/ # Canonical reference fixture
pre-release/      # Internal risk analysis and current-state notes
```

## Watch It Being Built

ALS isn't ready yet — but you can watch the factory floor live. We stream the building of ALS on YouTube: [youtube.com/@0xnfrith](https://youtube.com/@0xnfrith)

Come hang out while it's being made.

## Feedback

Use GitHub issues for:

- compiler bugs
- authored-system breakage reports
- research feedback on what ALS should optimize for next

See [CONTRIBUTING.md](CONTRIBUTING.md) for the expected issue detail.

## License

Copyright 2026 Section 9 Technologies LLC. Licensed under [Elastic License 2.0 (ELv2)](LICENSE).
