# Public Hook Runtime API and Harness Adapter Contract

## Status

Accepted

## Context

- ALS currently ships five Claude hook entrypoints under [`../hooks/`](../hooks/), four of which are compiler-owned integration hooks:
  - `operator-config-session-start.sh`
  - `als-validate.sh`
  - `als-breadcrumb.sh`
  - `als-stop-gate.sh`
  The fifth, `delamain-stop.sh`, owns dispatcher and pulse lifecycle work rather than compiler semantics.
- The current compiler-owned hooks shell out to the compiler CLI through Bash + jq + Bun. That keeps the CLI as the only public automation surface, but it also duplicates root-discovery, module-owner, warning-rendering, and hook-output behavior at the shell layer.
- ALS-099 research established three facts:
  - Bun-native TypeScript hook entrypoints are mechanically viable on the Claude hook surface.
  - direct imports from current source modules such as `src/validate.ts`, `src/module-owner.ts`, and `src/operator-config.ts` would violate ALS-099's hard public-API constraint
  - `delamain-stop.sh` is not part of the same compiler-owned problem and should not be silently folded into a compiler cleanup
- ALS-099 planning records the architectural rationale in [`../../../als-factory/artifacts/ALS-099/hook-runtime-public-api-architecture.md`](../../../als-factory/artifacts/ALS-099/hook-runtime-public-api-architecture.md). The operator approved the recommended direction:
  - create one formal public hook-runtime API inside `alsc/compiler`
  - move the four compiler-owned hooks to Bun TS entrypoints that import only from that public boundary
  - leave `delamain-stop.sh` on its current shell/lifecycle boundary
- The operator also added a forward-looking constraint: the new public surface is a multi-harness contract. Claude ships first in this job, but future Codex and Open Code hook-port jobs should be able to consume the same semantic API without re-architecting it around Claude-specific JSON wiring.

## Decision

- ALS defines a formal **public hook-runtime API** inside `alsc/compiler` for compiler-owned hook semantics.
- The public hook-runtime API is **semantic-intent based**, not Claude-wire-format based. It must express operations such as:
  - build SessionStart operator-config output
  - resolve touched-path ownership for validation and breadcrumb purposes
  - evaluate post-write validation and warning/block outcomes
  - evaluate stop-gate validation from recorded breadcrumbs
- Harness-specific hook transport belongs in **thin adapter layers above the public API**:
  - this job ships Claude adapters now
  - future Codex and Open Code jobs may add their own adapters
  - those adapters translate harness-native stdin/stdout, env vars, exit codes, and hook configuration into and out of the shared semantic API
- The compiler-owned hook cohort for this decision is fixed to:
  - `operator-config-session-start`
  - `als-validate`
  - `als-breadcrumb`
  - `als-stop-gate`
- `delamain-stop.sh` remains outside this decision. It continues to own SessionEnd dispatcher/pulse lifecycle behavior on its existing shell boundary unless a future job reopens that lifecycle contract explicitly.
- Bun is the normative host for the compiler-owned hook cohort once the public hook-runtime API exists. Bash 3.2 compatibility is no longer a guarantee for that cohort.
- Plugin-root resolution for the compiler-owned Bun entrypoints must be explicit:
  - derive from `import.meta.url`
  - or accept an explicit root input
  Child-process inheritance of `${CLAUDE_PLUGIN_ROOT}` alone is not a sufficient contract boundary.
- The compiler CLI remains supported, but it is no longer the only public automation surface. CLI commands and harness adapters should both depend on the same public hook-runtime API rather than re-implementing the same semantics on separate paths.

## Normative Effect

- Required: compiler-owned hook entrypoints import only from the formal public hook-runtime API.
- Required: the public hook-runtime API accepts semantic hook intents rather than Claude-specific hook payload shapes as its stable contract.
- Required: harness adapters own transport translation for stdin, stdout, exit codes, environment inputs, and harness-native command wiring.
- Required: the Claude adapter preserves current hook behavior for clean-success silence, warn-only `additionalContext`, block decisions, exit `2`, demo-mode bypass, and timeout/failure posture.
- Required: Bun TS entrypoints become the normative implementation shape for the compiler-owned hook cohort.
- Required: plugin-root resolution is explicit inside that cohort and does not rely solely on child-process env inheritance.
- Required: the public hook-runtime API is designed so future Codex and Open Code adapters can consume it without first stripping Claude-specific assumptions out of the API itself.
- Allowed: the compiler CLI may remain a public caller of the same hook-runtime API.
- Allowed: adapters may add harness-specific bridge code when a harness's hook transport does not match the Claude transport exactly.
- Allowed: future jobs may widen the adapter set to Codex or Open Code without changing the semantic-intent contract.
- Rejected: direct imports from internal compiler source modules outside the public hook-runtime boundary.
- Rejected: preserving Bash wrapper entrypoints as a required long-term boundary once the public API exists.
- Rejected: folding `delamain-stop.sh` into this contract by implication.
- Rejected: baking Claude JSON hook wiring directly into the public API surface as though it were the universal hook model.

## Compiler Impact

- Add a formal public hook-runtime API surface in `alsc/compiler` with stable exported types and semantic operations for the four compiler-owned hooks.
- Refactor the existing CLI-owned logic so the CLI and the new Bun hook entrypoints call the same underlying public hook-runtime API rather than maintaining parallel logic paths.
- Add or update adapter code for Claude hook transport around the public API boundary.
- Add coverage for:
  - public import boundary behavior
  - Claude adapter translation behavior
  - validation warn/block/silent outcomes
  - breadcrumb recording and stop-gate evaluation
  - explicit plugin-root resolution
- No authored ALS syntax, parser, or validator grammar changes are introduced by this decision.

## Docs and Fixture Impact

- Add this SDR as the normative record for the public hook-runtime API and harness-adapter boundary.
- Add [`../../../als-factory/artifacts/ALS-099/hook-runtime-public-api-architecture.md`](../../../als-factory/artifacts/ALS-099/hook-runtime-public-api-architecture.md) as the load-bearing rationale note for the chosen architecture.
- Update `hooks/CLAUDE.md`, the affected compiler docs, and any touched skill/reference docs so future work in this area encounters either this SDR or the rationale note before changing the boundary.
- Paint the pass-2 fixture review as hook-runtime examples rather than shape-language syntax:
  - public import examples
  - Claude hook command strings
  - semantic API result shapes
  - Claude adapter stdout / exit-code examples
  - demo-mode bypass and infrastructure-failure examples
- Keep `delamain-stop.sh` out of this fixture round.

## Alternatives Considered

- Keep the CLI as the only public surface and retain Bash entrypoints as permanent transport shims.
- Rejected because it preserves duplicated shell orchestration and keeps the shared compiler semantics behind an unnecessarily indirect boundary.

- Move hooks to Bun TS entrypoints by importing current internal source modules directly.
- Rejected because it violates the public-API hard constraint and turns future compiler refactors into silent hook breakage risk.

- Rewrite the entire `hooks/` directory, including `delamain-stop.sh`, under the same Bun/public-API umbrella.
- Rejected because it mixes compiler-owned hook semantics with a separate dispatcher/pulse lifecycle boundary and enlarges blast radius without a compensating architectural win.

## Non-Goals

- Codex hook parity in this job.
- Open Code hook parity in this job.
- Any runtime-harness projection change.
- Any authored ALS syntax change.
- Rewriting `delamain-stop.sh`.

## Follow-Up

- A future job may add Codex hook adapters on top of the same public hook-runtime API.
- A future job may add Open Code hook adapters on top of the same public hook-runtime API.
- If a later lifecycle-focused job chooses to revisit `delamain-stop.sh`, it must carry its own rationale and contract rather than relying on this SDR by analogy.
