---
name: people-module
description: Version router for people-module. Load the currently deployed versioned skill content.
context: fork
---

# People Module (Version Router)

This fixture keeps shape metadata in `.pals/`, so this router only selects skill behavior.

## Current Deployed Version

- `v1`

## Load Target

- `v1/content/SKILL.md`

## Router Rule

When this skill is invoked, read and follow the skill instructions at `v1/content/SKILL.md`.
