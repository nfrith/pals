# ALS (Agent Language Specification)

ALS is a strict specification language for defining personal agent systems. It is based on the creator's (Nicholas Frith) experience working with personal agent systems going back to mid-2025.

## Profiles

All profiles are end users of ALS. The distinction is in what they do with the system, not in their status. Every profile — including Claude — is a user whose experience matters.

### Operator

End user. Uses a Claude harness (Claude Code, Cowork) on a project that happens to be an ALS system. May not be technical. May never invoke ALS skills directly — they interact with the system through skills that were built for them. Their most common ALS touchpoint is `/run-delamains` to start their pipelines.

### ALS Developer

End user. Builds ALS systems for operators. Knows the spec. Uses `/install`, `/new`, `/change`, `/migrate` to create and evolve modules. May package and distribute modules for operators to install.

### ALS Architect

End user. Alters the language itself. Architects the spec, writes SDRs, evolves the compiler, defines new language constructs. Currently: Nicholas Frith.

### Claude

End user. Present with all of the above. Enables each profile to do whatever they aim to do — from answering operator questions to authoring modules to implementing spec changes.

## Project Status

- This project is under active development and is not officially released yet.
- ALS is not being used in any production environment yet.

## Platform Support

We are building ALS to be supported on Claude platforms — Claude Code CLI, Claude Cowork, Claude Code Desktop, Claude Code Web, and others. We want to support all of these frames.

> \* The goal is to DESIGN/BRAINSTORM as if we were assuming support for every platform, but when implementation hits reality, we go by implementation. The support matrix below reflects the current implementation state.

| Code | Platform | Status |
|------|----------|--------|
| `ALS-PLAT-CCLI` | Claude Code CLI | Supported |
| `ALS-PLAT-CCWK` | Claude Cowork | Planned |
| `ALS-PLAT-CDSK` | Claude Code Desktop | Planned |
| `ALS-PLAT-CWEB` | Claude Code Web | Planned |

> \*\* When referencing a platform anywhere in the codebase, use the CODE column with a formal markdown link back to this file: [`ALS-PLAT-XXXX`](nfrith-repos/als/CLAUDE.md). Never use bare platform codes without a link.

## Current Focus

- **v1 is the current focus.** Lessons from v0 were applied — several hard-to-implement features like skill/app management and migrations were removed from the initial scope. They will be reintroduced into v1 later.
- v0 has been removed from this repo.
- The working reference implementation is `reference-system/`. The compiler is being built to match this intended solution.

## Rules

- The SDR process defined in `sdr/AGENTS.md` must be followed when recording spec decisions.
- We are building this system to scale. It is not meant for startup go-fast mode.

## Install Perspectives

How users discover and install ALS. Each perspective has different constraints on what we can assume about their environment.

### 1. Claude Code Marketplace

User browses the marketplace inside Claude Code, finds ALS, clicks install.

- Already in Claude Code
- Plugin system handles installation
- Hooks activate automatically

### 2. GitHub page in browser

User lands on the GitHub repo page (e.g. from a link, search, social media). Reads the README.

- Not in Claude Code yet
- Needs instructions to clone + install
- May not know what Claude Code is

### 3. Claude Code asks Claude to check the GitHub page

User is already in Claude Code and asks Claude to look at the ALS repo.

- Already in Claude Code
- Claude can read the repo and guide installation
- Could potentially self-install

### 4. Word of mouth / event demo

User sees ALS at a meetup or event (e.g. The AI Lab). Wants to try it after.

- May or may not know Claude Code
- Needs the simplest possible "just try it" path
- First impression matters most

### 5. Shared by a colleague

Someone sends them a link or tells them "try this thing".

- Unknown technical level
- May land on GitHub, may land on marketplace
- Needs clear entry point

### 6. Non-Claude harness (Codex, Open Code, etc.)

User is on a different AI coding harness. Discovers ALS and wants to try it.

- ALS plugin system may not exist in their harness
- Hooks, skills, slash commands — none of it works natively
- Placeholder: guide them to a video of the product in action
- Future: per-harness instruction sets (AGENTS.md, tool configs, etc.)

### 7. AI assistant recommends it

User asks their AI assistant (any harness) about personal agent systems, structured markdown, etc. The assistant finds ALS and suggests it.

- Unpredictable entry point
- May arrive at GitHub, docs, or marketplace
- The README / docs need to be self-explanatory enough for an AI to guide installation
