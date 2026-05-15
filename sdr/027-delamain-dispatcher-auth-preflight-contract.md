# Delamain Dispatcher Auth Preflight Contract

## Status

Accepted

## Context

- `@anthropic-ai/claude-agent-sdk` captures `ANTHROPIC_API_KEY` from `process.env` during module evaluation.
- Delamain dispatchers and similar SDK-backed runtimes often import the SDK before any top-level authored deletion can run, either directly or transitively through `dispatcher.ts`.
- GF-017's 2026-04-18 smoke sequence showed the failure mode and the fix:
  - plain `bun run` plus later in-code env deletion still billed API credits when `ANTHROPIC_API_KEY` was present
  - `env -u ANTHROPIC_API_KEY` at spawn time held balance steady
  - a sibling preflight module imported before every other import also held balance steady under plain `bun run`
- The leak class exists in the canonical `/new` dispatcher template, already-copied latest-version dispatcher bundles, deployed `.claude/delamains/**` projections, and Ghost's `cyber-brain` construct.
- Operator direction for this pass is latest-version-only propagation. Older dispatcher versions remain immutable snapshots unless they are later revived as the latest version.

## Decision

- Every latest-version SDK-backed Delamain dispatcher entrypoint must import a sibling auth preflight module as the literal first line of `src/index.ts`:
  - `import "./preflight.js";`
- Every such dispatcher `src/preflight.ts` must contain only:
  - a brief why-comment explaining the SDK module-init auth capture problem
  - `delete process.env.ANTHROPIC_API_KEY;`
- The preflight module must execute before any direct or transitive import can cause `@anthropic-ai/claude-agent-sdk` to evaluate.
- The canonical dispatcher template at `skills/new/references/dispatcher/` is the source of truth for this contract. Future `/new` copies must inherit the preflight pattern by default.
- Ghost's `cyber-brain` construct follows the same sibling-file contract, but its entrypoint uses its existing `.ts` local-import convention:
  - `import "./preflight.ts";`
- Canonical dispatcher sources remain the edit surface for deployed `.claude/delamains/**` bundles. Projection refresh happens through `alsc deploy claude .`, not by hand-editing deployed mirrors.
- The required steady state is plain `bun run` with Max-subscription routing by default, without operator-managed `env -u ANTHROPIC_API_KEY` wrappers.

## Normative Effect

- Required: every latest-version Delamain dispatcher `src/index.ts` begins with `import "./preflight.js";` as literal line 1.
- Required: every latest-version Delamain dispatcher `src/preflight.ts` exists beside `src/index.ts` and contains the why-comment plus `delete process.env.ANTHROPIC_API_KEY;`.
- Required: the `/new` dispatcher template continues to implement the first-import preflight rule.
- Required: Ghost `cyber-brain` begins with `import "./preflight.ts";` and carries the sibling `src/preflight.ts` file.
- Required: projected `.claude/delamains/**` copies stay aligned with authored dispatcher sources after deploy.
- Allowed: later defensive deletions from cloned SDK env objects remain in place after preflight has already stripped the process environment.
- Allowed: retired non-latest dispatcher versions stay untouched until they become active again.
- Rejected: relying on `env -u ANTHROPIC_API_KEY` as the steady-state contract.
- Rejected: keeping shell-level key removal such as the `.zshrc` workaround as the permanent defense.
- Rejected: wrapper scripts or spawn shims as the primary fix for this leak class.
- Rejected: placing the delete after any import that could reach the SDK.
- Rejected: patching live copies while leaving the `/new` template unfixed.

## Compiler Impact

- No ALS shape syntax, parser semantics, or schema rules change in this decision.
- `alsc/compiler/test/delamain-dispatcher-template.test.ts` must assert the canonical dispatcher template:
  - opens `src/index.ts` with the required first-line preflight import
  - ships a sibling `src/preflight.ts` containing `delete process.env.ANTHROPIC_API_KEY;`
- `alsc/compiler/test/deploy.test.ts` must assert deployed dispatcher projections preserve:
  - the first-line `import "./preflight.js";` contract in projected `src/index.ts`
  - the projected `src/preflight.ts` file with the auth-strip statement
- Deploy remains a source-to-projection mirror. This pass does not add a new compiler validator beyond template and projection regression coverage.
- Future compiler work may add explicit validation for dispatcher preflight shape, but that enforcement is not required by this decision.

## Docs and Fixture Impact

- `skills/docs/references/delamain-dispatcher.md` must document the first-import preflight contract and the role of `src/preflight.ts`.
- `ghost-cyber-brain/CLAUDE.md` must remind forward deploys to carry `preflight.ts` with `index.ts`.
- The canonical dispatcher template, latest-version canonical dispatcher copies, and deployed `.claude/delamains/**` projections in Ghost and the reference-system must stay aligned with this contract.
- This decision does not introduce new authored shape-language syntax. The affected fixtures are dispatcher asset trees, deploy projections, and their regression tests.

## Alternatives Considered

- Require `env -u ANTHROPIC_API_KEY` at spawn time.
- Rejected because it pushes an SDK-specific billing footgun onto operators and breaks the "plain `bun run`" contract.
- Keep the `.zshrc` 1Password auto-load removal as the permanent defense.
- Rejected because it protects this one leak class by degrading unrelated project environments.
- Add a wrapper script around dispatcher launch.
- Rejected because a first-import preflight module fixes the root cause with less indirection and no extra runtime surface.
- Patch only current dispatcher copies and skip the `/new` template.
- Rejected because every future Delamain authored via `/new` would reintroduce the same bug.
- Patch dormant historical dispatcher versions too.
- Rejected for this pass because operator policy is latest-version-only propagation and older versions are treated as immutable snapshots.
