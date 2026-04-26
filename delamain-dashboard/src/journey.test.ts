import { expect, test } from "bun:test";
import type { DispatcherSnapshot } from "./feed/types.ts";
import { collectSystemSnapshot } from "./feed/collector.ts";
import { createDashboardFixture } from "./test-fixtures.ts";
import { buildJourneyGraph, createJourneyGraphContract } from "./journey.ts";

test("journey graph projects dispatcher states into lane nodes and visible edge data", async () => {
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
    expect(graph.edges.map((edge) => edge.id)).toEqual(["advance-queued-in-dev-0-0"]);
    expect(graph.edges.map((edge) => edge.zIndex)).toEqual([1]);
    expect(graph.summary.rawNodeCount).toBe(4);
    expect(graph.summary.rawEdgeCount).toBe(1);
    expect(graph.summary.renderedEdgeCount).toBe(1);
    expect(graph.nodes[0]?.data.badge).toBe("ANTHROPIC AGENT");
    expect(graph.nodes[1]?.data.badge).toBe("OPENAI AGENT");
    expect(graph.nodes[3]?.data.badge).toBe("TERMINAL");
    expect(graph.nodes[3]?.data.color).toBe(graph.palette.closed);
    expect(dispatcher.journeyTelemetry?.activeJobs[0]?.dispatchId).toBe("d-als-001");
  } finally {
    await fixture.cleanup();
  }
});

test("journey graph aggregates multi-source exits per source phase while preserving raw counts", () => {
  const dispatcher = createDispatcher({
    phaseOrder: ["research", "implementation", "acceptance", "closed"],
    states: {
      drafted: { actor: "operator", phase: "research", initial: true, terminal: false },
      research: { actor: "agent", phase: "research", initial: false, terminal: false, provider: "anthropic" },
      planning: { actor: "agent", phase: "implementation", initial: false, terminal: false, provider: "openai" },
      uat: { actor: "operator", phase: "acceptance", initial: false, terminal: false },
      done: { actor: null, phase: "closed", initial: false, terminal: true },
      shelved: { actor: null, phase: "closed", initial: false, terminal: true },
    },
    transitions: [
      { class: "advance", from: "drafted", to: "research" },
      { class: "advance", from: "research", to: "planning" },
      { class: "advance", from: "planning", to: "uat" },
      { class: "rework", from: "planning", to: "research" },
      { class: "exit", from: ["drafted", "research", "planning", "uat"], to: "shelved" },
      { class: "exit", from: "uat", to: "done" },
    ],
  });

  const graph = buildJourneyGraph(dispatcher);
  const groupedEdges = graph.edges.filter((edge) => edge.data?.aggregated);
  const directEdges = graph.edges.filter((edge) => !edge.data?.aggregated);

  expect(graph.lanes.map((lane) => lane.data.phase)).toEqual([
    "research",
    "implementation",
    "acceptance",
    "closed",
  ]);
  expect(graph.summary.edgeCounts).toEqual({
    advance: 3,
    rework: 1,
    exit: 5,
  });
  expect(graph.summary.rawEdgeCount).toBe(9);
  expect(graph.summary.renderedEdgeCount).toBe(8);
  expect(groupedEdges).toHaveLength(3);
  expect(groupedEdges.every((edge) => edge.zIndex === 1)).toBe(true);
  expect(directEdges.every((edge) => edge.zIndex === 1)).toBe(true);
  expect(groupedEdges.map((edge) => edge.data?.sourcePhase)).toEqual([
    "research",
    "implementation",
    "acceptance",
  ]);
  expect(groupedEdges[0]?.data?.sources).toEqual(["drafted", "research"]);
  expect(groupedEdges[1]?.data?.sources).toEqual(["planning"]);
  expect(groupedEdges[2]?.data?.sources).toEqual(["uat"]);
  expect(graph.anchors).toHaveLength(3);
  expect(graph.nodes.find((node) => node.id === "planning")?.data.badge).toBe("OPENAI AGENT");
  expect(graph.nodes.find((node) => node.id === "research")?.data.badge).toBe("ANTHROPIC AGENT");
  expect(graph.nodes.find((node) => node.id === "shelved")?.data.color).toBe(graph.palette.closed);
  expect(centerX(graph.nodes.find((node) => node.id === "drafted"))).toBe(
    centerX(graph.nodes.find((node) => node.id === "research")),
  );
  expect(graph.nodes.find((node) => node.id === "planning")?.position.x ?? 0).toBeGreaterThan(
    graph.nodes.find((node) => node.id === "research")?.position.x ?? 0,
  );
});

function createDispatcher(
  input: Pick<DispatcherSnapshot, "phaseOrder" | "states" | "transitions">,
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
    itemsScanned: 0,
    moduleId: "als-factory",
    moduleVersion: 1,
    moduleMountPath: "workspace/factory",
    entityName: "job",
    entityPath: "jobs/{id}.md",
    statusField: "status",
    phaseOrder: input.phaseOrder,
    states: input.states,
    transitions: input.transitions,
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
    recentEvents: [],
    recentRun: null,
    recentError: null,
    runtime: {
      available: true,
      path: "/tmp/als/system/.claude/delamains/synthetic-journey/runtime/worktree-state.json",
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
      path: "/tmp/als/system/.claude/delamains/synthetic-journey/telemetry/events.jsonl",
      parseErrors: 0,
    },
  };
}

function centerX(node: { position: { x: number }; width?: number } | undefined): number {
  return (node?.position.x ?? 0) + (node?.width ?? 0) / 2;
}
