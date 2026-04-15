# Universal Operator Console Pattern

2026-04-15

## Raw

every operator state in a delamain means the same thing: the system is waiting for operator input. so the console actions should be universal across all operator states. the pattern is:

1. respond & advance — provide input, move forward to next state
2. respond & rework — provide input, send back to previous agent state
3. review — open the entity in tmux review so i can read before deciding
4. terminal — shelve or cancel the job
5. other — type freeform instructions

the console reads the delamain's transition table and presents whatever's legal. if a state has two rework targets, show both and ask. if it has zero advances (like uat-failure-input), that option just doesn't appear. the console becomes a generic operator-state handler parameterized by the delamain, not a hand-coded switch statement per state.

the state-specific part is what "respond" means — answer agent questions, record UAT results, provide context, etc. the routing logic is pure delamain.

this emerged from the ghost-factory console. we had hand-coded actions for drafted, research-input, plan-input. uat had nothing. when we tried to add uat actions we realized the pattern was the same every time. the only thing that changes is the transition destinations and what the operator is responding to.

this should be the recommended/default pattern for building delamain consoles. als developers can roll their own if they want, but this gives a starting point that works for any delamain.

related: we also designed uat-failure-input as a new operator state. the uat-failure agent analyzes failures and routes to dev, but sometimes it needs more info from the operator first. uat-failure-input only reworks to uat-failure (not dev or planning) because the agent should complete its analysis before making routing decisions. the operator at the input stage provides information, not routing choices.

## Ghost's Context

This journal entry was written during the Ghost Factory console upgrade session. The operator had just identified a gap: the console skill had no action handlers for the `uat` operator state. While designing those handlers, a universal pattern emerged across all five operator states in the ghost-factory-jobs delamain.

The states at the time of writing:

| State | Actor | Advance to | Rework to |
|-------|-------|-----------|-----------|
| `drafted` | operator | research/planning/dev (type-gated) | n/a (initial state) |
| `research-input` | operator | planning | research |
| `plan-input` | operator | dev | planning |
| `uat` | operator | done | dev |

The insight is that all operator states share the same action skeleton. Differences are:

1. **Available transitions** — defined by the delamain, not the console skill. The console reads the transition table and presents what's legal.
2. **What "respond" means** — state-specific semantics. For input states (research-input, plan-input), it means answering agent questions. For uat, it means recording test results. For drafted, it means providing initial context or just approving.
3. **Whether advance/rework exist** — some states have both, some have only one. `drafted` has no rework (nothing came before).

Design decision: `uat-failure` was collapsed into `uat`. Originally we designed a `uat-failure` agent state and `uat-failure-input` operator state for analysis and Q&A. We removed both because: (1) the operator's context is freshest at the moment of failure — asking them to record details now is better than having an agent ask follow-ups later, (2) the dev agent can do root cause analysis itself when it reads failure notes + the code, (3) the agent was a middleman adding latency to the feedback loop. Now UAT fail goes directly to dev: `uat → dev` (rework).

The universal pattern has implications for ALS tooling:

- **Console skill authoring** — new delamains get a working console for free if they follow this pattern. The ALS developer defines states and transitions; the console derives its UI from the delamain definition.
- **Delamain design guidance** — the pattern encourages clean state design. Every operator state should have clear advance/rework targets. If you can't name what "respond & advance" means for a state, the state might not be well-defined.
- **Console as a delamain projection** — the console doesn't encode business logic; it projects the delamain's transition graph into an operator-friendly menu. Business logic lives in agent prompts and transition rules.

This is not yet implemented. The ghost-factory console still has hand-coded actions. The plan is to upgrade it to the universal pattern as proof-of-concept, then extract the pattern into ALS developer guidance.

Related items:
- Ghost Factory delamain: `.als/modules/ghost-factory/v1/delamains/ghost-factory-jobs/delamain.ts`
- Ghost Factory console skill: `.als/modules/ghost-factory/v1/skills/ghost-factory-console/SKILL.md`
- Cyberdeck journal (prior art on console/delamain relationship): `nfrith-repos/als/journals/2026-04-11-cyberdeck.md`
