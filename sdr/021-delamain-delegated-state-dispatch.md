# Delamain Delegated State Dispatch

## Status

Proposed

## Context

- SDR 020 established state-bound Delamain agents, resumable state sessions, and implicit `session-field` frontmatter synthesis.
- The generic dispatcher currently assumes every resumable agent-owned state uses the Agent SDK session as the durable worker session for that state.
- Some state agents instead act as short-lived orchestrators that hand work to an external worker or session manager, such as a tmux-launched Codex session.
- In those cases, resuming or persisting the dispatcher-owned Agent SDK session is the wrong behavior. The durable session, if any, belongs to the delegated worker.
- The Ghost backlog planning flow exposed this mismatch while porting its SDLC dispatcher to Delamain. The planning state still needs runtime access to the state's session metadata, but the dispatcher must stop treating its own SDK session as the durable worker session.

## Decision

- ALS adds optional boolean state field `delegated` on Delamain `actor: agent` states.
- If omitted, `delegated` defaults to `false`.
- `delegated: true` means the host treats the state agent as a stateless orchestrator that may hand execution to an external worker or session manager.
- `delegated: true` is a generic capability for agent-owned states. It is not limited to one app, one worker implementation, or one Delamain.
- When `delegated: true`, the host must not pass a stored session id to the Agent SDK `query()` `resume` option.
- When `delegated: true`, the host must not auto-persist the dispatcher-owned Agent SDK session id into the state's `session-field`.
- When `delegated: true`, the host still injects runtime session metadata so the state agent can inspect or manage the delegated worker lifecycle itself.
- Runtime Context for delegated states always includes `session_field` and `session_id`.
- If the delegated state has no declared `session-field`, the runtime values are `session_field: null` and `session_id: null`.
- If the delegated state declares `session-field` but the item has no saved session value, the runtime values are `session_field: <field-name>` and `session_id: null`.
- `delegated` does not change transition legality, agent-file resolution, `resumable` meaning, `session-field` synthesis, or `sub-agent` semantics from SDR 020.

## Normative Effect

- Required: `delegated` is boolean only.
- Required: if a state declares `delegated`, that state declares `actor: agent`.
- Required: operator-owned states do not declare `delegated`.
- Required: terminal states do not declare `delegated`.
- Required: hosts treat omitted `delegated` as `false`.
- Required: when `delegated: true`, hosts do not pass `resume` to the Agent SDK even if the state's `session-field` currently contains a valid session id.
- Required: when `delegated: true`, hosts do not write the dispatcher-owned Agent SDK session id back into the state's `session-field`.
- Required: when `delegated: true`, hosts still expose runtime context keys `session_field` and `session_id`.
- Required: if `delegated: true` and the state has no declared `session-field`, hosts expose `session_field: null` and `session_id: null`.
- Required: if `delegated: true` and the state declares `session-field`, hosts expose the field name plus the saved value or `null`.
- Allowed: delegated states may also declare `resumable: false`; in that case the runtime session keys remain present with null-shaped values.
- Allowed: delegated states may use `session-field` to point at a durable worker session managed outside the Agent SDK.
- Allowed: delegated states may hand work to external CLIs, tmux-managed sessions, or other orchestration layers without changing their Delamain transition graph.
- Rejected: `delegated` on non-agent states.
- Rejected: inferring delegated dispatch from prompt prose or host-specific convention instead of an explicit Delamain field.
- Rejected: treating the dispatcher-owned Agent SDK session as the durable worker session when `delegated: true`.

## Compiler Impact

- Extend Delamain state parsing to accept optional boolean `delegated`.
- Add validation that operator-owned and terminal states do not declare `delegated`.
- Add validation that `delegated` on a non-agent state fails closed with an explicit compiler error.
- Surface parsed `delegated` values through the Delamain data model so dispatcher hosts can branch on them.
- Add coverage for valid delegated agent-owned states plus invalid delegated non-agent states, including combinations with `resumable: true` and `resumable: false`.

## Docs and Fixture Impact

- Update the canonical shape-language reference to document optional `delegated`, its default `false` behavior, and the delegated runtime-session contract.
- Update the dispatcher reference to document delegated dispatch: no Agent SDK resume, no dispatcher-side session auto-persist, and stable runtime `session_field` plus `session_id`.
- Paint the proposed syntax into the Ghost development-pipeline Delamain and any template/example YAML that needs the new authored field before compiler work finalizes.
- Update the dispatcher template at `skills/new/references/dispatcher/` and then refresh deployed copies via the existing repo-local copy pattern, with Ghost as the first concrete rollout.

## Alternatives Considered

- Keep delegation as prompt-only convention.
- Rejected because host behavior around resume and session persistence must be declared explicitly, not inferred from prose.
- Restrict `delegated` to resumable states only.
- Rejected because operator direction was to keep it as a generic agent-state capability, and some delegated states may not rely on host-managed resume at all.
- Introduce a separate external-worker construct instead of a state field.
- Rejected because the immediate need is a narrow host-behavior flag on already-existing state definitions.
- Reuse `resumable` or `session-field` semantics to imply delegation.
- Rejected because direct SDK-resumable states and delegated externally managed states are distinct runtime behaviors.
