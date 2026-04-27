import { expect, test } from "bun:test";
import { ConnectionMode, adoptUserNodes, getEdgePosition } from "@xyflow/system";
import { buildJourneyEdgeRoute } from "./client/journey-routing.ts";
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
    expect(graph.edges[0]?.data).toMatchObject({
      routeSlot: 0,
      sourceLaneIndex: 0,
      sourcePhase: "implementation",
      targetLaneIndex: 0,
      targetPhase: "implementation",
    });
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
  expect(groupedEdges.map((edge) => edge.data?.targetPhase)).toEqual([
    "closed",
    "closed",
    "closed",
  ]);
  expect(groupedEdges[0]?.data?.sources).toEqual(["drafted", "research"]);
  expect(groupedEdges[1]?.data?.sources).toEqual(["planning"]);
  expect(groupedEdges[2]?.data?.sources).toEqual(["uat"]);
  expect(groupedEdges[0]?.data).toMatchObject({
    sourceLaneIndex: 0,
    targetLaneIndex: 3,
    sourceNodeKind: "anchor",
    targetNodeKind: "state",
  });
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

test("same-lane rework routes out through the right gutter and stays off unrelated node faces", () => {
  const graph = buildJourneyGraph(createRoutingDispatcher());
  const edge = findGraphEdge(graph, (candidate) => candidate.source === "planning" && candidate.target === "research");
  const route = buildRouteForEdge(graph, edge);
  const sourceHandle = graphHandlePoint(findGraphNode(graph, edge.source), "source");
  const targetHandle = graphHandlePoint(findGraphNode(graph, edge.target), "target");

  expect(route.strategy).toBe("same-lane-rework");
  expect(route.start.x).toBeGreaterThan(sourceHandle.x);
  expect(route.end.x).toBeLessThan(targetHandle.x);
  expect(route.waypoints[1]?.x).toBeGreaterThan(route.start.x);
  expect(route.waypoints[2]?.y).toBeLessThan(
    Math.min(...graph.nodes.map((node) => node.position.y)),
  );
  assertRouteAvoidsNodes(
    route,
    graph.nodes.filter((node) => !new Set(["planning", "research"]).has(node.id)),
  );
});

test("adjacent-lane advance stays in the shared gutter and insets the arrowhead", () => {
  const graph = buildJourneyGraph(createRoutingDispatcher());
  const edge = findGraphEdge(graph, (candidate) => candidate.source === "planning" && candidate.target === "review");
  const route = buildRouteForEdge(graph, edge);
  const targetHandle = graphHandlePoint(findGraphNode(graph, edge.target), "target");

  expect(route.strategy).toBe("adjacent-advance");
  expect(route.end.x).toBeLessThan(targetHandle.x);
  expect(route.waypoints[1]?.x).toBe(route.waypoints[2]?.x);
  assertRouteAvoidsNodes(
    route,
    graph.nodes.filter((node) => !new Set(["planning", "review"]).has(node.id)),
  );
});

test("cross-lane advance uses the top channel instead of cutting across intermediate lanes", () => {
  const graph = buildJourneyGraph(createRoutingDispatcher());
  const edge = findGraphEdge(graph, (candidate) => candidate.source === "research" && candidate.target === "done");
  const route = buildRouteForEdge(graph, edge);
  const targetHandle = graphHandlePoint(findGraphNode(graph, edge.target), "target");

  expect(route.strategy).toBe("top-channel");
  expect(route.end.x).toBeLessThan(targetHandle.x);
  expect(route.waypoints[2]?.y).toBe(route.waypoints[3]?.y);
  assertRouteAvoidsNodes(
    route,
    graph.nodes.filter((node) => !new Set(["research", "done"]).has(node.id)),
  );
});

test("aggregated exits route from the anchor through the top channel without crossing state cards", () => {
  const graph = buildJourneyGraph(createRoutingDispatcher());
  const edge = findGraphEdge(
    graph,
    (candidate) => candidate.data?.aggregated === true && candidate.data?.sourcePhase === "implementation",
  );
  const route = buildRouteForEdge(graph, edge);
  const targetHandle = graphHandlePoint(findGraphNode(graph, edge.target), "target");

  expect(route.strategy).toBe("top-channel");
  expect(route.end.x).toBeLessThan(targetHandle.x);
  assertRouteAvoidsNodes(
    route,
    graph.nodes.filter((node) => node.id !== edge.target),
  );
});

test("journey nodes expose explicit handles so edge positions resolve without DOM measurement", () => {
  const initialGraph = buildJourneyGraph(createRoutingDispatcher());
  const refreshedGraph = buildJourneyGraph(createRoutingDispatcher());
  const nodeLookup = new Map();
  const parentLookup = new Map();

  adoptUserNodes([...initialGraph.lanes, ...initialGraph.anchors, ...initialGraph.nodes], nodeLookup, parentLookup);
  assertEveryEdgeResolvesPosition(initialGraph, nodeLookup);

  adoptUserNodes([...refreshedGraph.lanes, ...refreshedGraph.anchors, ...refreshedGraph.nodes], nodeLookup, parentLookup);
  assertEveryEdgeResolvesPosition(refreshedGraph, nodeLookup);
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

function createRoutingDispatcher(): DispatcherSnapshot {
  return createDispatcher({
    phaseOrder: ["implementation", "review", "closed"],
    states: {
      drafted: { actor: "operator", phase: "implementation", initial: true, terminal: false },
      research: { actor: "agent", phase: "implementation", initial: false, terminal: false, provider: "anthropic" },
      planning: { actor: "agent", phase: "implementation", initial: false, terminal: false, provider: "openai" },
      review: { actor: "operator", phase: "review", initial: false, terminal: false },
      done: { actor: null, phase: "closed", initial: false, terminal: true },
      shelved: { actor: null, phase: "closed", initial: false, terminal: true },
    },
    transitions: [
      { class: "advance", from: "drafted", to: "research" },
      { class: "advance", from: "planning", to: "review" },
      { class: "advance", from: "research", to: "done" },
      { class: "rework", from: "planning", to: "research" },
      { class: "exit", from: ["drafted", "research", "planning", "review"], to: "shelved" },
    ],
  });
}

function buildRouteForEdge(
  graph: ReturnType<typeof buildJourneyGraph>,
  edge: ReturnType<typeof buildJourneyGraph>["edges"][number],
) {
  const sourceNode = findGraphNode(graph, edge.source);
  const targetNode = findGraphNode(graph, edge.target);
  const sourcePosition = normalizePosition(sourceNode.sourcePosition, "right");
  const targetPosition = normalizePosition(targetNode.targetPosition, "left");
  const sourceHandle = graphHandlePoint(sourceNode, "source");
  const targetHandle = graphHandlePoint(targetNode, "target");

  return buildJourneyEdgeRoute({
    data: edge.data!,
    sourcePosition,
    sourceX: sourceHandle.x,
    sourceY: sourceHandle.y,
    targetPosition,
    targetX: targetHandle.x,
    targetY: targetHandle.y,
  });
}

function findGraphEdge(
  graph: ReturnType<typeof buildJourneyGraph>,
  matcher: (edge: ReturnType<typeof buildJourneyGraph>["edges"][number]) => boolean,
) {
  const edge = graph.edges.find(matcher);
  if (!edge) {
    throw new Error("Expected graph edge was not found.");
  }

  return edge;
}

function findGraphNode(
  graph: ReturnType<typeof buildJourneyGraph>,
  id: string,
) {
  const node = [...graph.nodes, ...graph.anchors].find((candidate) => candidate.id === id);
  if (!node) {
    throw new Error(`Expected graph node '${id}' was not found.`);
  }

  return node;
}

function graphHandlePoint(
  node: ReturnType<typeof buildJourneyGraph>["nodes"][number] | ReturnType<typeof buildJourneyGraph>["anchors"][number],
  handle: "source" | "target",
) {
  const width = node.width ?? 0;
  const height = node.height ?? 0;
  const position = normalizePosition(
    handle === "source" ? node.sourcePosition : node.targetPosition,
    handle === "source" ? "right" : "left",
  );

  switch (position) {
    case "left":
      return { x: node.position.x, y: node.position.y + height / 2 };
    case "right":
      return { x: node.position.x + width, y: node.position.y + height / 2 };
    case "top":
      return { x: node.position.x + width / 2, y: node.position.y };
    case "bottom":
      return { x: node.position.x + width / 2, y: node.position.y + height };
  }
}

function normalizePosition(
  position: unknown,
  fallback: "bottom" | "left" | "right" | "top",
) {
  return position === "left" || position === "right" || position === "top" || position === "bottom"
    ? position
    : fallback;
}

function assertEveryEdgeResolvesPosition(
  graph: ReturnType<typeof buildJourneyGraph>,
  nodeLookup: Map<string, unknown>,
) {
  const errors: Array<{ code: string; edgeId: string }> = [];

  for (const edge of graph.edges) {
    const sourceNode = nodeLookup.get(edge.source);
    const targetNode = nodeLookup.get(edge.target);

    expect(sourceNode).toBeDefined();
    expect(targetNode).toBeDefined();

    const edgePosition = getEdgePosition({
      id: edge.id,
      sourceNode: sourceNode as Parameters<typeof getEdgePosition>[0]["sourceNode"],
      targetNode: targetNode as Parameters<typeof getEdgePosition>[0]["targetNode"],
      sourceHandle: edge.sourceHandle ?? null,
      targetHandle: edge.targetHandle ?? null,
      connectionMode: ConnectionMode.Strict,
      onError: (code) => errors.push({ code, edgeId: edge.id }),
    });

    expect(edgePosition).not.toBeNull();
  }

  expect(errors).toEqual([]);
}

function assertRouteAvoidsNodes(
  route: ReturnType<typeof buildJourneyEdgeRoute>,
  nodes: Array<ReturnType<typeof buildJourneyGraph>["nodes"][number]>,
) {
  for (const node of nodes) {
    const box = toBox(node);

    for (const point of route.waypoints) {
      expect(pointInsideBox(point, box)).toBe(false);
    }

    for (let index = 0; index < route.waypoints.length - 1; index += 1) {
      expect(segmentIntersectsBox(route.waypoints[index]!, route.waypoints[index + 1]!, box)).toBe(false);
    }
  }
}

function toBox(node: { height?: number; position: { x: number; y: number }; width?: number }) {
  return {
    bottom: node.position.y + (node.height ?? 0),
    left: node.position.x,
    right: node.position.x + (node.width ?? 0),
    top: node.position.y,
  };
}

function pointInsideBox(
  point: { x: number; y: number },
  box: { bottom: number; left: number; right: number; top: number },
): boolean {
  const padding = 1;

  return point.x > box.left + padding
    && point.x < box.right - padding
    && point.y > box.top + padding
    && point.y < box.bottom - padding;
}

function segmentIntersectsBox(
  start: { x: number; y: number },
  end: { x: number; y: number },
  box: { bottom: number; left: number; right: number; top: number },
): boolean {
  const padding = 1;

  if (approximatelyEqual(start.x, end.x)) {
    if (start.x <= box.left + padding || start.x >= box.right - padding) return false;
    return rangesOverlap(start.y, end.y, box.top + padding, box.bottom - padding);
  }

  if (approximatelyEqual(start.y, end.y)) {
    if (start.y <= box.top + padding || start.y >= box.bottom - padding) return false;
    return rangesOverlap(start.x, end.x, box.left + padding, box.right - padding);
  }

  return false;
}

function rangesOverlap(firstStart: number, firstEnd: number, secondStart: number, secondEnd: number): boolean {
  const [normalizedFirstStart, normalizedFirstEnd] = firstStart <= firstEnd
    ? [firstStart, firstEnd]
    : [firstEnd, firstStart];

  return Math.max(normalizedFirstStart, secondStart) < Math.min(normalizedFirstEnd, secondEnd);
}

function approximatelyEqual(first: number, second: number): boolean {
  return Math.abs(first - second) < 0.001;
}
