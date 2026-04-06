# Development Pipeline

Status-driven SDLC for work items in the factory module. Governed by the `development-pipeline` delamain.

## Actors

- **Operator**: Human in the loop. Creates items, approves plans, performs UAT, handles failures.
- **Agent**: Dispatched by the delamain. Executes planning, implementation, review, and deployment.

## Phases and Statuses

| Phase | Status | Actor | Purpose |
|-------|--------|-------|---------|
| intake | `draft` | operator | Item created, requirements being defined |
| intake | `queued` | agent | Requirements complete, ready for agent pipeline |
| planning | `planning` | agent | Agent producing implementation plan |
| planning | `plan-input` | operator | Agent has questions, waiting for operator answers |
| planning | `plan-ready` | operator | Plan complete, awaiting operator review |
| implementation | `ready` | agent | Plan approved, ready for implementation |
| implementation | `in-dev` | agent | Agent implementing and testing |
| implementation | `in-review` | agent | Review agent checking the work |
| implementation | `uat-test` | operator | Operator testing the changes |
| deployment | `deployment-ready` | agent | UAT passed, ready for deployment |
| deployment | `deploying` | agent | Agent deploying to target environment |
| deployment | `deployment-testing` | agent | Agent verifying deployment |
| deployment | `deployment-failure` | operator | Verification failed, operator decides |
| closed | `completed` | -- | Deployed and verified (terminal) |
| closed | `deferred` | -- | Paused (terminal) |
| closed | `cancelled` | -- | Dropped (terminal) |

## Valid Transitions

| From | To | Actor |
|------|----|-------|
| `draft` | `queued` | operator |
| `queued` | `planning` | agent |
| `planning` | `plan-input` | agent |
| `planning` | `plan-ready` | agent |
| `plan-input` | `queued` | operator |
| `plan-ready` | `ready` | operator |
| `plan-ready` | `queued` | operator |
| `ready` | `in-dev` | agent |
| `in-dev` | `in-review` | agent |
| `in-review` | `uat-test` | agent |
| `in-review` | `ready` | agent |
| `uat-test` | `deployment-ready` | operator |
| `uat-test` | `queued` | operator |
| `deployment-ready` | `deploying` | agent |
| `deploying` | `deployment-testing` | agent |
| `deployment-testing` | `completed` | agent |
| `deployment-testing` | `deployment-failure` | agent |
| `deployment-failure` | `ready` | operator |
| `deployment-failure` | `queued` | operator |
| *any non-terminal* | `deferred` | operator |
| *any non-terminal* | `cancelled` | operator |

## Rework Loops

### Review failure (code issue)

`in-review` -> `ready` -> `in-dev` -> `in-review`

Review agent sends back to `ready`. Dispatcher resurrects the same dev session via `dev_session`. Dev fixes issues, returns to `in-review`.

### UAT failure (design issue)

`uat-test` -> `queued` -> `planning` -> ... -> `uat-test`

Operator sends back to `queued` for full re-plan. Failure context captured in UAT section and activity log. Fresh planning session starts.

### Plan revision

`plan-ready` -> `queued` -> `planning` -> ... -> `plan-ready`

Operator rejects plan. Item returns to `queued` with `planner_session` preserved. Dispatcher spawns new planner session with revision context.

### Plan-input loop

`planning` -> `plan-input` -> `queued` -> `planning` -> ... -> `plan-ready`

Planner has questions. Operator answers in `PLAN_QUESTIONS`. Item moves back to `queued`. Dispatcher detects the re-queued item (with `planner_session` set) and resumes planning.

## Session Fields

These fields are implicit — managed by the delamain dispatcher, not by the operator skill.

| Field | Purpose |
|-------|---------|
| `planner_session` | Session ID for planning agent. Set at `queued` -> `planning`. |
| `dev_session` | Session ID for dev agent. Set at `ready` -> `in-dev`. |

## Section Lifecycle

Sections are populated progressively as the item moves through the pipeline.

| Section | Populated during | Author |
|---------|-----------------|--------|
| DESCRIPTION | `draft` | operator |
| CURRENT_STATE | `draft` | operator |
| REQUIREMENTS | `draft` | operator |
| DOD | `draft` | operator |
| PLAN | `planning` | agent |
| PLAN_QUESTIONS | `planning` / `plan-input` | both |
| REVIEW | `in-review` | agent (append-only) |
| UAT | `uat-test` | operator (append-only) |
| DEPLOYMENT | `deploying` / `deployment-testing` | agent |
| ACTIVITY_LOG | any | both (append-only) |
