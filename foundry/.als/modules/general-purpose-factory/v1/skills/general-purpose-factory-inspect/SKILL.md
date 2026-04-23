---
name: general-purpose-factory-inspect
description: Read-only inspection for general-purpose factory jobs. Show one job, list jobs, or summarize status across the mounted job set.
model: sonnet
allowed-tools: Bash(bash *)
---

# Inspect General-Purpose Factory

Read-only companion skill for `general-purpose-factory`.

## Input

Use this skill when the operator wants to:

- show a specific job
- list all jobs
- filter jobs by status or type
- review blockers without changing state

## Procedure

### 1. Resolve the module path

1. Resolve the system root and confirm `.als/system.ts` exists.
2. Read the `general-purpose-factory` entry to determine the mounted jobs path.

### 2. Determine query mode

- `show` — present a single job by id
- `list` — enumerate jobs in a compact table
- `status` — group jobs by status and highlight `blocked`
- `recent` — show the most recently updated jobs first

### 3. Read and present

- For a single job, present frontmatter plus the body sections in order.
- For a list, show `id | title | status | type | updated`.
- For a blocker scan, surface `RESEARCH_QUESTIONS`, `PLAN_QUESTIONS`, and the latest `ACTIVITY_LOG` lines for blocked jobs.
- Do not create, edit, or transition records. This skill is read-only.

## Scope

- Read-only access to the mounted job set.
- For creation or transitions, use `general-purpose-factory-console`.
