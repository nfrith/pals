---
name: docs
description: ALS format reference index. This skill should be used when the user asks about ALS format rules, shape YAML syntax, delamain definitions, field types, agent file format, dispatcher behavior, or skill decomposition patterns.
---

# ALS Documentation Index

Centralized format references for all ALS skills. Other skills load these references as needed — this index helps locate the right document.

## References

### Shape Language

`references/shape-language.md`

The complete ALS v1 format specification: system.yaml, shape.yaml, entities, field types, body contracts, delamain bundles, agent file format, and naming rules. This is the authoritative source for producing or validating ALS YAML.

Read this when:
- Creating or modifying shape.yaml
- Creating or modifying delamain definitions
- Authoring agent or sub-agent markdown files
- Understanding field types, body regions, or naming rules
- Validating record frontmatter or body structure

### Skill Decomposition Patterns

`references/skill-patterns.md`

The three patterns for decomposing a module's interface into skills: CRUD, Lifecycle, and Aggregate-layer. Includes selection criteria and naming conventions.

Read this when:
- Designing the skill interface for a new module
- Refactoring an existing module's skill set
- Choosing between operation-verb and domain-intent skill names

### Dispatcher

`references/dispatcher.md`

The generic Delamain dispatcher template: a zero-config Bun application that scans entity items and invokes agents via the Claude Agent SDK. Covers the three source files, session handling, sub-agent delegation, and deployment.

Read this when:
- Scaffolding a new delamain bundle with a dispatcher
- Understanding how the dispatcher derives configuration from ALS declarations
- Troubleshooting dispatcher behavior
- Planning deployment of a delamain bundle
