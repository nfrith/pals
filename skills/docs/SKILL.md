---
name: docs
description: ALS format reference index. This skill should be used when the user asks about ALS format rules, operator config, TypeScript-authored system/module/delamain contracts, delamain agents, delamain dispatchers, provider dispatch, field types, agent file format, dispatcher behavior, skill decomposition patterns, or module integration.
---

# ALS Documentation Index

Centralized format references for all ALS skills. Other skills load these references as needed — this index helps locate the right document.

## References

### Shape Language

`references/shape-language.md`

The core ALS v1 authored-source specification: `system.ts`, `module.ts`, `delamain.ts`, entities, field types, body contracts, JSONL rules, and naming rules. Use this together with the delamain-agent and delamain-dispatcher references for runtime asset details.

Read this when:
- Creating or modifying module.ts
- Creating or modifying delamain definitions
- Understanding field types, body regions, or naming rules
- Validating record frontmatter or body structure

### Vocabulary

[`references/vocabulary.md`](references/vocabulary.md)

Canonical glossary for ALS terminology: profiles, authored abstractions, constructs, versioning axes, and the `language-upgrade-recipe` contract surface. Other docs should point here instead of re-defining shared terms.

Read this when:
- Clarifying ALS terms before editing docs or prompts
- Checking the authored-vs-plugin boundary
- Reasoning about version axes or language upgrades
- Linking to canonical definitions instead of inventing local wording

### Compatibility Classes

[`references/compatibility-classes.md`](references/compatibility-classes.md)

The five release-compatibility classes ALS uses in jobs and changelog entries, plus the precedence rule for release headlines and the deprecation interaction policy.

Read this when:
- Classifying a job or changelog entry
- Explaining what `refresh_required` or `migration_required` means
- Choosing the release headline for multiple compatibility classes
- Checking how deprecations map onto compatibility classes

### Deprecation and Warnings

[`references/deprecation-and-warnings.md`](references/deprecation-and-warnings.md)

The compiler-owned deprecation lifecycle, warn-only validation behavior, and the machine-readable diagnostic payload surfaced when authored values are deprecated but still supported.

Read this when:
- Adding or reviewing deprecation metadata
- Explaining why validation returned `status: "warn"`
- Checking the warning payload contract for hooks or tooling
- Confirming the non-blocking warning behavior in ALS validation flows

### Platforms

[`references/platforms.md`](references/platforms.md)

The canonical mapping between ALS platform codes and Claude runtime entrypoints. This is the source of truth for platform-aware skill behavior.

Read this when:
- Branching on `$CLAUDE_CODE_ENTRYPOINT`
- Referencing `ALS-PLAT-XXXX` codes in docs or skills
- Checking current platform support status
- Avoiding ad hoc platform detection logic

### Skill Decomposition Patterns

`references/skill-patterns.md`

The three patterns for decomposing a module's interface into skills: CRUD, Lifecycle, and Aggregate-layer. Includes selection criteria and naming conventions.

Read this when:
- Designing the skill interface for a new module
- Refactoring an existing module's skill set
- Choosing between operation-verb and domain-intent skill names

### Delamain Overview

`references/delamain-overview.md`

What delamains are — Phase-Constrained Transition Graphs. States, transitions, phases, actor model (operator vs agent), agent bindings, discriminated variants. The conceptual foundation.

Read this when:
- Understanding what a delamain is and how it works
- Explaining the delamain model to an operator or developer
- Designing a new workflow that might need a delamain
- Understanding the relationship between operator states and agent states

### Delamain Agent Authoring

`references/delamain-agents.md`

How to write state agents and sub-agents. Covers the agent file format, runtime context injection, and best practices: idempotency, provider-specific dispatch, session field ownership, and sub-agent patterns.

Read this when:
- Writing or modifying a state agent markdown file
- Implementing provider-specific dispatch behavior
- Understanding how the dispatcher injects runtime context
- Debugging agent behavior or dispatch failures

### Delamain Console Patterns

[`references/delamain-console-patterns.md`](references/delamain-console-patterns.md)

Reference pattern for operator console skills that derive actions from a delamain's state graph instead of hard-coding per-state menus. Covers dependencies, review flows, the attention queue, and platform-aware presentation.

Read this when:
- Building or refactoring a delamain console skill
- Designing operator-state review and response flows
- Mapping transitions into universal console actions
- Choosing a platform-aware review pattern

### Delamain Dispatcher

`references/delamain-dispatcher.md`

The generic dispatcher template: a zero-config Bun application that scans entity items and invokes agents through provider-native SDK adapters. Covers the runtime manifest, provider dispatch, session handling, worktree isolation, and deployment.

Read this when:
- Scaffolding a new delamain bundle with a dispatcher
- Understanding how the dispatcher derives configuration from ALS declarations
- Troubleshooting dispatcher behavior
- Planning deployment of a delamain bundle

### Module Integration

`references/module-integration.md`

How delamains connect to the rest of the module surface. Skill naming convention (`{module}-{variant}-{delamain}`), the three skill layers (CRUD, pipeline console, agents), deploy pipeline, and the copy-from-template pattern.

Read this when:
- Wiring a delamain into an existing module
- Naming a pipeline console skill
- Understanding how `alsc deploy claude` projects assets
- Setting up system.ts and module.ts for a delamain

### Architect Notes

[`references/architect-notes.md`](references/architect-notes.md)

Practical tips and shortcuts for ALS architects working on live systems. Field notes from operating real ALS systems — not part of the formal spec.

Read this when:
- Making quick edits to agent prompts or skill files without a full version cycle
- Debugging delamain behavior with in-place edits
- Looking for operational shortcuts that bypass change/migrate safely

### Bootup Configuration

[`references/bootup-config.md`](references/bootup-config.md)

The `.als/bootup.md` file format — operator-local boot configuration that tells `/bootup` how to start delamain dispatchers and other runtime services.

Read this when:
- Setting up a new ALS system's runtime environment
- Understanding how `/bootup` determines dispatcher launch behavior
- Creating or modifying `.als/bootup.md`
- Designing custom boot configurations for different environments

### Language Upgrades

[`references/language-upgrades.md`](references/language-upgrades.md)

Human-readable reference for whole-system `als_version` cutovers via `language-upgrade-recipe` bundles and the `/upgrade-language` flow. Summarizes the authored surface, runtime constraints, and what remains out of scope.

Read this when:
- Authoring or reviewing a `language-upgrade-recipe`
- Understanding how `/upgrade-language` plans and executes hops
- Checking the `.als/`-only mutation boundary for language upgrades
- Looking for the reference doc that points back to SDR 037

### Operator Configuration

[`references/operator-config.md`](references/operator-config.md)

The system-scoped profile stored at `<system_root>/.als/operator.md`, validated by ALS and injected into sessions by the SessionStart hook.

Read this when:
- Setting up the operator profile during onboarding
- Updating stable operator identity or business context
- Understanding `.als/skip-operator-config`
- Reviewing the "no credentials in operator config" boundary
