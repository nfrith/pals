---
name: ghost-line
description: File an issue on the ALS GitHub repo. Walks the user through a guided flow — scans conversation context for clues, collects structured details, and submits via gh CLI.
allowed-tools: Bash(bash *)
---

# ghost-line

The hotline. Guided issue filing for the ALS repo (`nfrith/als`). Scans the conversation for context, walks the user through structured collection, and submits via `gh`.

## Prerequisites

1. Run `which gh` to check if the GitHub CLI is on PATH.
   - If not found: "ALS support requires the GitHub CLI (`gh`). Install it at https://cli.github.com/ or with `! brew install gh`, then run `! gh auth login`." Stop.

2. Run `gh auth status 2>&1` to check authentication.
   - If not authenticated: "You have `gh` but aren't logged in. Run `! gh auth login` to authenticate." Stop.

## Procedure

### 1. Context scan

Before asking anything, scan the conversation history for clues about what went wrong. Look for:

- **Bash tool results with non-zero exit codes** — failed commands, error output
- **Error or warning strings in tool output** — stack traces, "Error:", "FAILED", exceptions
- **Which `/skill` was invoked** — the skill name tells you the area (bootup, validate, new, etc.)
- **File paths mentioned in errors** — which module, config, or system file was involved
- **What the user was trying to do** — the task intent before things broke

Synthesize what you find into 2-3 candidate one-line summaries. Each should read like a bug title:
- `"/bootup — dispatcher failed to start (exit code 1)"`
- `"/validate — compiler error on module.ts"`
- `"/new — module creation failed, missing system.ts"`

If the conversation has no error context (user invoked `/ghost-line` cold), skip to freeform.

### 2. What is this about?

Present via AskUserQuestion:

- **Header**: `Issue`
- **Question**: "What is this about?"
- **Options**: The 2-3 inferred summaries from the context scan, plus a freeform option ("Describe it yourself"). If no context clues were found, present only the freeform option plus common categories ("Something broke", "Feature request", "Question").

The user picks one or writes their own via Other.

### 3. Category

Present via AskUserQuestion:

- **Header**: `Type`
- **Question**: "What kind of issue is this?"
- **Options**:
  - **Bug report** — something broke or behaved unexpectedly
  - **Feature request** — something that should exist but doesn't
  - **Question** — need help understanding how something works

### 4. Collect environment (silent)

No user input needed. Run in parallel:

```bash
uname -s && uname -m
```

```bash
cat ${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json 2>/dev/null | grep '"version"' | head -1
```

```bash
echo $SHELL
```

Extract:
- **Platform**: OS + architecture (e.g., `Darwin arm64`)
- **ALS version**: from plugin.json `version` field
- **Shell**: user's shell

### 5. Guided detail collection

What to collect depends on the category.

#### Bug report

**Step A — Reproduction steps**

Ask: "What were you doing when this happened?"

Pre-fill a suggestion from conversation context if available (e.g., "I ran `/bootup` and saw an error about missing config"). The user confirms, edits, or replaces via Other.

- **Header**: `Steps`
- **Options**: 1-2 inferred reproduction paths from context + freeform

**Step B — Error output**

If the conversation contains error output (stack traces, error messages), extract the relevant snippet (max ~50 lines). Ask: "Include this error output in the issue?"

- **Header**: `Error`
- **Options**:
  - **Yes, include it** — attach the extracted error output
  - **No, skip it** — omit error output

#### Feature request

**Step A** — Ask: "What should it do?" Freeform.

**Step B** — Ask: "Why do you need this? What are you trying to accomplish?" Freeform.

#### Question

**Step A** — Ask: "What are you trying to understand?" Freeform.

### 6. Confirm and submit

Assemble the issue body using this structure:

```markdown
## Summary
{the selected/written summary from step 2}

## Category
{bug | feature request | question}

## Steps to Reproduce
{reproduction steps — bug only}

## Error Output
```
{error snippet, if included}
```

{bug only, if user opted in}

## Detail
{feature request or question detail}

## Environment
- ALS: {version}
- Platform: {os} {arch}
- Shell: {shell}

---
*Filed via `/ghost-line`*
```

Omit sections that don't apply to the category.

Show the assembled body to the user and ask: "Submit this issue?"

- **Header**: `Confirm`
- **Options**:
  - **Submit** — file the issue
  - **Edit title** — change the issue title before submitting
  - **Cancel** — abort without filing

### 7. Submit

Use a heredoc to avoid shell escaping issues:

```bash
gh issue create --repo nfrith/als --title "{title}" --body "$(cat <<'ISSUE_EOF'
{assembled body}
ISSUE_EOF
)"
```

The title defaults to the summary from step 2. If the user chose "Edit title" in step 6, collect the new title first.

### 8. Report

Show the issue URL returned by `gh`. One line, no ceremony.
