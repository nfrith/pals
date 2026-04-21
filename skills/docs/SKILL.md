---
name: docs
description: ALS format reference index. This skill should be used when the user asks about ALS format rules, TypeScript-authored system/module/delamain contracts, delamain agents, delamain dispatchers, provider dispatch, field types, agent file format, dispatcher behavior, skill decomposition patterns, or module integration.
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

The `.als/config.md` file format — operator-local boot configuration that tells `/bootup` how to start delamain dispatchers and other runtime services.

Read this when:
- Setting up a new ALS system's runtime environment
- Understanding how `/bootup` determines dispatcher launch behavior
- Creating or modifying `.als/config.md`
- Designing custom boot configurations for different environments
