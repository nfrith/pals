import { expect, test } from "bun:test";
import type { DispatcherSnapshot } from "./feed/types.ts";
import { collectSystemSnapshot } from "./feed/collector.ts";
import { createDashboardFixture } from "./test-fixtures.ts";
import { buildJourneyGraph, createJourneyGraphContract } from "./journey.ts";

test("journey graph projects v4 state labels onto stock smoothstep edges", async () => {
  const fixture = await createDashboardFixture("journey");

  try {
    const snapshot = await collectSystemSnapshot({
      systemRoot: fixture.root,
      telemetryLimit: 10,
    });
    const dispatcher = snapshot.dispatchers[0]!;
    const contract = createJourneyGraphContract(dispatcher);
    const graph = buildJourneyGraph(dispatcher);

    expect(contract.transitions).toHaveLength(1);
    expect(graph.lanes.map((lane) => lane.data.phase)).toEqual(["implementation", "closed"]);
    expect(graph.nodes.map((node) => node.id)).toEqual(["queued", "in-dev", "in-review", "completed"]);
    expect(graph.edges.map((edge) => edge.type)).toEqual(["smoothstep"]);
    expect(graph.edges[0]).toMatchObject({
      animated: false,
      className: "journey-edge journey-edge-advance",
    });
    expect(graph.nodes[0]?.data).toMatchObject({
      label: "AI queued the work",
      stateName: "queued",
    });
    expect(graph.nodes[3]?.data).toMatchObject({
      label: "Work shipped",
      badge: "SUCCESS",
      outcomeIcon: "✓",
    });
  } finally {
    await fixture.cleanup();
  }
});

test("journey graph preserves aggregated exits and marks active nodes and edges from runtime telemetry", () => {
  const graph = buildJourneyGraph(createDispatcher());
  const aggregatedEdges = graph.edges.filter((edge) => edge.data?.aggregated);
  const activeEdge = graph.edges.find((edge) => edge.source === "research" && edge.target === "planning");

  expect(graph.summary.edgeCounts).toEqual({
    advance: 3,
    rework: 1,
    exit: 5,
  });
  expect(graph.summary.rawEdgeCount).toBe(9);
  expect(graph.summary.renderedEdgeCount).toBe(8);
  expect(aggregatedEdges).toHaveLength(3);
  expect(aggregatedEdges.map((edge) => edge.type)).toEqual(["smoothstep", "smoothstep", "smoothstep"]);
  expect(graph.nodes.find((node) => node.id === "planning")?.className).toContain("journey-node-live");
  expect(activeEdge?.animated).toBe(true);
  expect(activeEdge?.className).toContain("journey-edge-active");
});

test("journey nodes keep explicit handle metadata for smoothstep edge resolution", () => {
  const graph = buildJourneyGraph(createDispatcher());

  expect(graph.nodes.every((node) => Array.isArray(node.handles) && node.handles.length >= 1)).toBe(true);
  expect(graph.anchors.every((node) => Array.isArray(node.handles) && node.handles.length === 1)).toBe(true);
  expect(graph.edges.every((edge) => edge.type === "smoothstep")).toBe(true);
});

function createDispatcher(): DispatcherSnapshot {
  return {
    name: "synthetic-journey",
    systemRoot: "/tmp/als/system",
    bundleRoot: "/tmp/als/system/.claude/delamains/synthetic-journey",
    state: "live",
    detail: "Dispatcher is live",
    heartbeat: null,
    pidLive: true,
    lastTickAgeMs: 5_000,
    pollMs: 1_000,
    activeDispatches: 1,
    itemsScanned: 3,
    moduleId: "als-factory",
    moduleVersion: 1,
    moduleMountPath: "workspace/factory",
    entityName: "job",
    entityPath: "jobs/{id}.md",
    statusField: "status",
    phaseOrder: ["research", "implementation", "acceptance", "closed"],
    states: {
      drafted: {
        actor: "operator",
        phase: "research",
        initial: true,
        terminal: false,
        label: "Draft the job",
        customerBucket: "waiting_for_user",
      },
      research: {
        actor: "agent",
        phase: "research",
        initial: false,
        terminal: false,
        label: "AI is researching",
        customerBucket: "active",
        provider: "anthropic",
      },
      planning: {
        actor: "agent",
        phase: "implementation",
        initial: false,
        terminal: false,
        label: "AI is planning implementation",
        customerBucket: "active",
        provider: "openai",
      },
      uat: {
        actor: "operator",
        phase: "acceptance",
        initial: false,
        terminal: false,
        label: "Approve the output",
        customerBucket: "waiting_for_user",
      },
      done: {
        actor: null,
        phase: "closed",
        initial: false,
        terminal: true,
        label: "Shipped",
        outcome: "success",
        customerBucket: "closed_success",
      },
      shelved: {
        actor: null,
        phase: "closed",
        initial: false,
        terminal: true,
        label: "Stopped",
        outcome: "stopped",
        customerBucket: "closed_stopped",
      },
    },
    transitions: [
      { class: "advance", from: "drafted", to: "research" },
      { class: "advance", from: "research", to: "planning" },
      { class: "advance", from: "planning", to: "uat" },
      { class: "rework", from: "planning", to: "research" },
      { class: "exit", from: ["drafted", "research", "planning", "uat"], to: "shelved" },
      { class: "exit", from: "uat", to: "done" },
    ],
    items: [],
    itemSummary: {
      totalItems: 0,
      byState: {},
      byActor: {
        agent: 0,
        operator: 0,
        terminal: 0,
        unknown: 0,
      },
    },
    recentEvents: [
      {
        schema: "als-delamain-telemetry-event@1",
        event_id: "evt-1",
        event_type: "dispatch_finish",
        timestamp: "2026-05-10T09:59:00.000Z",
        dispatcher_name: "synthetic-journey",
        module_id: "als-factory",
        dispatch_id: "d-als-001",
        item_id: "ALS-001",
        item_file: "/tmp/ALS-001.md",
        isolated_item_file: "/tmp/.worktrees/ALS-001.md",
        state: "research",
        agent_name: "research",
        sub_agent_name: null,
        provider: "openai",
        resumable: false,
        resume_requested: false,
        session_field: null,
        runtime_session_id: null,
        resume_session_id: null,
        worker_session_id: null,
        worktree_path: "/tmp/.worktrees/ALS-001",
        branch_name: "delamain/synthetic/ALS-001/d-test",
        worktree_commit: null,
        integrated_commit: null,
        merge_outcome: "merged",
        incident_kind: null,
        transition_targets: ["planning"],
        duration_ms: 1_000,
        num_turns: 3,
        cost_usd: 0.1,
        error: null,
      },
    ],
    recentRun: null,
    recentError: null,
    runtime: {
      available: true,
      path: "/tmp/runtime.json",
      active: [],
      blocked: [],
      orphaned: [],
      guarded: [],
    },
    journeyTelemetry: {
      activeJobs: [
        {
          dispatchId: "d-als-001",
          jobId: "ALS-001",
          state: "planning",
          age_ms: 30_000,
          provider: "openai",
          status: "active",
          transitionTargets: ["uat"],
        },
      ],
      recentEdges: [
        {
          from: "research",
          to: "planning",
          t: "2026-05-10T09:59:00.000Z",
        },
      ],
    },
    telemetry: {
      available: true,
      legacyMode: false,
      path: "/tmp/events.jsonl",
      parseErrors: 0,
    },
  };
}
