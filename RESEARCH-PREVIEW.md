# ALS Beta Research Preview

ALS is being released publicly as a beta research preview.

The goal of this phase is not to present ALS as stable. The goal is to get real pressure from risky early adopters so ALS can learn what actually matters before its compatibility story hardens.

This file is the preview contract. Install from the stable marketplace, update manually with `/update`, and expect fix-forward recovery if a preview release breaks.

## What This Preview Is

- A public preview of the ALS v1 authored-source contract
- A usable compiler surface for validation
- A usable Claude skill projection surface
- A request for real-world feedback on structure, workflow, and migration pressure

## What This Preview Is Not

- Not a compatibility commitment
- Not a production-stability promise
- Not a claim that ALS lifecycle tooling is complete
- Not a promise that authored systems will upgrade automatically between preview releases

## Supported Surface

This preview is centered on:

- `alsc validate` (via the `/validate` skill)
- `alsc deploy claude` (via the `/deploy` skill)
- the current ALS v1 source contract
- the reference material and fixtures in this repository

Other workflow material in the repo may still be useful, but it is not the core public promise for this preview.

## Distribution

ALS is distributed as a Claude Code plugin. The compiler runs as Bun-executed TypeScript source bundled inside the plugin — there is no separate npm package or standalone binary.

Requirements:

- [Claude Code](https://claude.ai/code)
- [Bun](https://bun.sh) >= 1.3.0
- [jq](https://jqlang.github.io/jq/) (used by plugin hooks)

## Explicit Non-Guarantees

If you adopt ALS during this preview, assume the following:

- preview releases may break authored systems
- manual rewrites may be required
- exact version pinning is required
- manual `/update` is the supported move to a newer release
- rollback is not the promised recovery path; bad releases are handled by hotfix-forward
- some features may be removed, renamed, or reframed before ALS stabilizes

## Known Missing Lifecycle Pieces

ALS does not yet ship:

- an ALS language-version upgrade toolchain
- a first-class language migration lifecycle
- a real warning and deprecation lifecycle
- mixed-version ALS coexistence inside one system
- non-Claude harness projection surfaces as a settled public contract

## Who This Is For

This preview is for operators and teams who:

- want to experiment with strict agent-system structure early
- are comfortable reading docs, diagnostics, and example systems
- can tolerate breakage while ALS direction is still being shaped

If you need stable upgrade guarantees, this preview is too early.

## Feedback

Open GitHub issues for:

- compiler bugs
- authored-system breakage between preview releases
- missing diagnostics or missing machine-readable output
- research feedback on where ALS should go next

When reporting breakage, include the preview version you were on, the preview version you moved to, and the smallest reproducible system or fixture you can share.
