---
name: experiments-module
description: Version router for experiments-module. Load the currently deployed versioned skill content.
context: fork
---

# Experiments Module (Version Router)

This fixture keeps shape metadata in `.pals/`, so this router only selects skill behavior.

## Current Deployed Version

- `v2`

## Load Target

- `v2/content/SKILL.md`

## Router Rule

When this skill is invoked, read and follow the skill instructions at `v2/content/SKILL.md`.
