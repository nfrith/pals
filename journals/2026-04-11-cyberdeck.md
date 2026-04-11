# Cyberdeck

2026-04-11

## Raw

introduce a new ALS construct: the cyberdeck. the cyberdeck represents the conceptual framework that encompasses all of these ghost constructs. er what i mean by that is like, a cyberdeck has: a ghost and a shell. the shell represents the thing the ghost is currently residing in. so as of right now, the shell is this macbook pro computer. the shell's interface is the security terminal for the live stream. so if a user had a wearable device and was actively using it, that would be their shell (the wearable device) and its active which means the ghost in it. the ghost moves between shells. always following the operator. if the operator takes off the wearable, places it on the counter, walks away and picks up their phone, then the ghost is on the phone now.

## Ghost's Context

This journal entry was written during the Dive Stack design session (GHOST-185, GHOST-186). The operator had just connected the Dive Stack rendering system to delamain console skills — establishing that the console skill holds operator business logic and the Dive Stack is a projection of the current operator step.

The cyberdeck concept emerged as a layer above everything we'd been building. The vocabulary so far:

- **Dive Stack** — the operator's attention substrate (what am I working on)
- **Delamain console skills** — the operator's interface to each module (how do I work on it)
- **Delamain dispatchers** — the automated agent loop (what's handled for me)
- **Shell** — the physical device the ghost currently inhabits (MacBook, phone, wearable)
- **Ghost** — the living system that follows the operator between shells

The cyberdeck is the container that holds all of these. It's the full stack from philosophy to hardware: ghost (the system) + shell (the device) + the interface layer between them (Dive Stack, console skills, the cockpit).

The shell concept maps to the platform support matrix in `CLAUDE.md` — `ALS-PLAT-CCLI` is one shell interface, `ALS-PLAT-CCWK` is another. The ghost is the same; the shell changes. The Dive Stack rendering adapts per shell but the data model is platform-agnostic. This is why GHOST-185 insists the ALS construct must be platform-agnostic with per-harness renderers — the ghost doesn't care what shell it's in.

The "ghost moves between shells, always following the operator" is the mobility property. The operator's attention context (Dive Stack state, loaded Op Prefs, current dive) must be portable across shells. When the operator picks up a different device, the ghost on that device should be able to reconstruct where they left off. This has implications for state persistence and sync that aren't addressed yet.

Related items:
- GHOST-185 — Dive Stack attention model
- GHOST-186 — CCLI dashboard renderer
- `nfrith-repos/als/CLAUDE.md` §Platform Support — the shell interface matrix
