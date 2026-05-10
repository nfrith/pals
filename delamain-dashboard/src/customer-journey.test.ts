import { expect, test } from "bun:test";
import type { RuntimeDispatchRecord } from "../../delamain-dispatcher/src/runtime-state.ts";
import type { DispatcherSnapshot } from "./feed/types.ts";
import { buildCustomerJourneyProjection } from "./customer-journey.ts";

test("customer projection derives phase counts and drill-in rows from v4 state metadata", () => {
  const dispatcher = createDispatcher({
    items: [
      createItem("ALS-001", "plan-review", "Approve the plan", "2026-05-08T10:00:00.000Z"),
      createItem("ALS-002", "in-dev", "Implement the approved work", "2026-05-08T09:00:00.000Z"),
      createItem("ALS-003", "completed", "Ship the finished work", "2026-05-07T08:00:00.000Z"),
    ],
    recentEvents: [
      telemetryEvent("ALS-003", "in-dev", ["completed"], "2026-05-09T08:00:00.000Z"),
    ],
    runtime: {
      active: [
        runtimeRecord({
          itemId: "ALS-002",
          state: "in-dev",
          startedAt: "2026-05-09T10:30:00.000Z",
          status: "active",
        }),
      ],
      blocked: [],
      guarded: [],
      orphaned: [],
      available: true,
      path: "/tmp/runtime.json",
    },
  });

  const projection = buildCustomerJourneyProjection(dispatcher, {
    now: new Date("2026-05-10T10:30:00.000Z"),
    selectedPhase: "implementation",
  });

  expect(projection.available).toBe(true);
  expect(projection.phases.map((phase) => ({
    active: phase.activeCount,
    phase: phase.phase,
    waiting: phase.waitingCount,
  }))).toEqual([
    { phase: "research", active: 0, waiting: 0 },
    { phase: "implementation", active: 1, waiting: 1 },
    { phase: "closed", active: 0, waiting: 0 },
  ]);
  expect(projection.phaseDetail?.waitingRows[0]).toMatchObject({
    title: "Approve the plan",
    stateLabel: "Review the AI plan",
    actionLabel: "Review now",
  });
  expect(projection.phaseDetail?.activeRows[0]).toMatchObject({
    title: "Implement the approved work",
    stateLabel: "AI is implementing",
    progressLabel: "In progress",
  });
  expect(projection.phaseDetail?.recentRows[0]).toMatchObject({
    title: "Ship the finished work",
    transitionLabel: "→ Closed",
    outcomeIcon: "✓",
  });
});

test("customer projection fails closed when v4 state metadata is missing", () => {
  const dispatcher = createDispatcher({
    states: {
      queued: {
        actor: "agent",
        phase: "implementation",
        initial: true,
        terminal: false,
        provider: "anthropic",
      },
    },
  });

  const projection = buildCustomerJourneyProjection(dispatcher, {
    now: new Date("2026-05-10T10:30:00.000Z"),
    selectedPhase: null,
  });

  expect(projection.available).toBe(false);
  expect(projection.errorMessage).toContain("ALS-091 v4");
});

function createDispatcher(
  input: Partial<DispatcherSnapshot> & {
    items?: DispatcherSnapshot["items"];
    recentEvents?: DispatcherSnapshot["recentEvents"];
    runtime?: DispatcherSnapshot["runtime"];
    states?: DispatcherSnapshot["states"];
  },
): DispatcherSnapshot {
  return {
    name: "synthetic-journey",
    systemRoot: "/tmp/als/system",
    bundleRoot: "/tmp/als/system/.claude/delamains/synthetic-journey",
    state: "idle",
    detail: "Dispatcher is idle",
    heartbeat: null,
    pidLive: false,
    lastTickAgeMs: null,
    pollMs: null,
    activeDispatches: 0,
    itemsScanned: input.items?.length ?? 0,
    moduleId: "als-factory",
    moduleVersion: 1,
    moduleMountPath: "workspace/factory",
    entityName: "job",
    entityPath: "jobs/{id}.md",
    statusField: "status",
    phaseOrder: ["research", "implementation", "closed"],
    states: input.states ?? {
      research: {
        actor: "agent",
        phase: "research",
        initial: true,
        terminal: false,
        label: "AI is researching",
        customerBucket: "active",
        provider: "anthropic",
      },
      "plan-review": {
        actor: "operator",
        phase: "implementation",
        initial: false,
        terminal: false,
        label: "Review the AI plan",
        customerBucket: "waiting_for_user",
      },
      "in-dev": {
        actor: "agent",
        phase: "implementation",
        initial: false,
        terminal: false,
        label: "AI is implementing",
        customerBucket: "active",
        provider: "openai",
      },
      completed: {
        actor: null,
        phase: "closed",
        initial: false,
        terminal: true,
        label: "Work shipped",
        outcome: "success",
        customerBucket: "closed_success",
      },
    },
    transitions: [],
    items: input.items ?? [],
    itemSummary: {
      totalItems: input.items?.length ?? 0,
      byState: {},
      byActor: {
        agent: 0,
        operator: 0,
        terminal: 0,
        unknown: 0,
      },
    },
    recentEvents: input.recentEvents ?? [],
    recentRun: null,
    recentError: null,
    runtime: input.runtime ?? {
      available: true,
      path: "/tmp/runtime.json",
      active: [],
      blocked: [],
      orphaned: [],
      guarded: [],
    },
    journeyTelemetry: {
      activeJobs: [],
      recentEdges: [],
    },
    telemetry: {
      available: true,
      legacyMode: false,
      path: "/tmp/events.jsonl",
      parseErrors: 0,
    },
  };
}

function createItem(
  id: string,
  status: string,
  title: string,
  updated: string,
): DispatcherSnapshot["items"][number] {
  return {
    id,
    status,
    type: "job",
    filePath: `/tmp/${id}.md`,
    title,
    updated,
  };
}

function runtimeRecord(input: {
  itemId: string;
  state: string;
  startedAt: string;
  status: RuntimeDispatchRecord["status"];
}): RuntimeDispatchRecord {
  return {
    dispatch_id: `d-${input.itemId.toLowerCase()}`,
    item_id: input.itemId,
    item_file: `/tmp/${input.itemId}.md`,
    isolated_item_file: `/tmp/worktrees/${input.itemId}.md`,
    state: input.state,
    agent_name: input.state,
    dispatcher_name: "factory-jobs",
    provider: "openai",
    resumable: false,
    session_field: null,
    status: input.status,
    worktree_path: `/tmp/.worktrees/${input.itemId}`,
    branch_name: `delamain/factory-jobs/${input.itemId}/d-test`,
    base_commit: "1111111111111111111111111111111111111111",
    mounted_submodules: [],
    worktree_commit: null,
    integrated_commit: null,
    started_at: input.startedAt,
    updated_at: input.startedAt,
    heartbeat_at: input.startedAt,
    owner_pid: process.pid,
    transition_targets: ["completed"],
    merge_outcome: "pending",
    merge_attempted_at: null,
    merge_message: null,
    latest_error: null,
    latest_session_id: null,
    latest_duration_ms: null,
    latest_num_turns: null,
    latest_cost_usd: null,
    incident: null,
  };
}

function telemetryEvent(
  itemId: string,
  state: string,
  transitionTargets: string[],
  timestamp: string,
): DispatcherSnapshot["recentEvents"][number] {
  return {
    schema: "als-delamain-telemetry-event@1",
    event_id: `${itemId}-${timestamp}`,
    event_type: "dispatch_finish",
    timestamp,
    dispatcher_name: "factory-jobs",
    module_id: "factory",
    dispatch_id: `d-${itemId.toLowerCase()}`,
    item_id: itemId,
    item_file: `/tmp/${itemId}.md`,
    isolated_item_file: `/tmp/worktrees/${itemId}.md`,
    state,
    agent_name: state,
    sub_agent_name: null,
    provider: "openai",
    resumable: false,
    resume_requested: false,
    session_field: null,
    runtime_session_id: null,
    resume_session_id: null,
    worker_session_id: null,
    worktree_path: `/tmp/.worktrees/${itemId}`,
    branch_name: `delamain/factory-jobs/${itemId}/d-test`,
    worktree_commit: null,
    integrated_commit: null,
    merge_outcome: "merged",
    incident_kind: null,
    transition_targets: transitionTargets,
    duration_ms: 1_000,
    num_turns: 3,
    cost_usd: 0.1,
    error: null,
  };
}
