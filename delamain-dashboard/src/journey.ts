import { MarkerType, Position, type Edge, type Node, type Viewport } from "@xyflow/react";
import type {
  DispatcherDefinitionState,
  DispatcherJourneyTelemetry,
  DispatcherSnapshot,
  DispatcherTransition,
  DispatcherTransitionClass,
} from "./feed/types.ts";

const PHASE_PALETTE = [
  "#d4a857",
  "#74abd4",
  "#7dc99b",
  "#d66e62",
  "#9f96e5",
  "#d96f89",
];

const PROVIDER_COLORS = {
  anthropic: "#d4a857",
  openai: "#74abd4",
} as const;

const CANVAS_PADDING_LEFT = 72;
const CANVAS_PADDING_TOP = 24;
const CANVAS_PADDING_BOTTOM = 56;
const LANE_GAP_X = 36;
const LANE_WIDTH = 248;
const LANE_HEADER_HEIGHT = 72;
const NODE_GAP_Y = 36;
const AGGREGATE_ANCHOR_SIZE = 12;
const AGGREGATE_ANCHOR_OFFSET_X = 18;
const MIN_CANVAS_HEIGHT = 720;

type JourneyLaneNode = Node<JourneyLaneData, "journeyLane">;
type JourneyAnchorNode = Node<JourneyAnchorData, "journeyAnchor">;
type JourneyStateNode = Node<JourneyNodeData, "journey">;

interface JourneyLaneLayout {
  color: string;
  phase: string;
  stateCount: number;
  width: number;
  x: number;
}

export interface JourneyGraphContract {
  phases: string[];
  states: Record<string, DispatcherDefinitionState>;
  transitions: DispatcherTransition[];
  telemetry?: DispatcherJourneyTelemetry;
}

export interface JourneyNodeData {
  actor: DispatcherDefinitionState["actor"];
  badge: string;
  color: string;
  description: string;
  initial: boolean;
  phase: string | null;
  provider: DispatcherDefinitionState["provider"];
  resumable: DispatcherDefinitionState["resumable"];
  stateName: string;
  terminal: boolean;
  tooltip: string;
  [key: string]: unknown;
}

export interface JourneyLaneData {
  color: string;
  phase: string;
  stateCount: number;
  [key: string]: unknown;
}

export interface JourneyAnchorData {
  phase: string;
  target: string;
  [key: string]: unknown;
}

export interface JourneyEdgeData {
  aggregated?: boolean;
  class: DispatcherTransitionClass;
  sourcePhase?: string;
  sources?: string[];
  tooltip: string;
  [key: string]: unknown;
}

export interface JourneyGraphSummary {
  edgeCounts: Record<DispatcherTransitionClass, number>;
  rawEdgeCount: number;
  renderedEdgeCount: number;
  rawNodeCount: number;
}

export interface JourneyGraphLayout {
  canvasHeight: number;
  canvasWidth: number;
}

export interface JourneyGraph {
  anchors: JourneyAnchorNode[];
  contract: JourneyGraphContract;
  edges: Edge<JourneyEdgeData, "journey">[];
  lanes: JourneyLaneNode[];
  layout: JourneyGraphLayout;
  nodes: JourneyStateNode[];
  palette: Record<string, string>;
  summary: JourneyGraphSummary;
  viewport: Viewport;
}

export function createJourneyGraphContract(dispatcher: DispatcherSnapshot): JourneyGraphContract {
  return {
    phases: dispatcher.phaseOrder,
    states: dispatcher.states,
    transitions: dispatcher.transitions ?? [],
    telemetry: dispatcher.journeyTelemetry,
  };
}

export function buildJourneyGraph(dispatcher: DispatcherSnapshot): JourneyGraph {
  const contract = createJourneyGraphContract(dispatcher);
  const orderedStates = Object.entries(contract.states);
  const phaseOrder = resolvePhaseOrder(contract.phases, orderedStates);
  const palette = buildPhasePalette(phaseOrder);
  const phaseBuckets = phaseOrder.map((phase) => ({
    phase,
    entries: orderedStates.filter(([, state]) => normalizePhase(state.phase) === phase),
  }));
  const laneLayouts = buildLaneLayouts(phaseBuckets, palette);
  const canvasHeight = measureCanvasHeight(phaseBuckets);
  const lanes = laneLayouts.map((layout) => buildLaneNode(layout, canvasHeight));
  const nodes = buildStateNodes(phaseBuckets, laneLayouts, palette);
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const { anchors, edges } = buildEdges(contract.transitions, nodesById, laneLayouts);
  const edgeCounts = summarizeRawEdges(contract.transitions);

  return {
    anchors,
    contract,
    edges,
    lanes,
    layout: {
      canvasHeight,
      canvasWidth: laneLayouts.length === 0
        ? LANE_WIDTH + CANVAS_PADDING_LEFT * 2
        : CANVAS_PADDING_LEFT * 2 + laneLayouts.length * LANE_WIDTH + (laneLayouts.length - 1) * LANE_GAP_X,
    },
    nodes,
    palette,
    summary: {
      edgeCounts,
      rawEdgeCount: edgeCounts.advance + edgeCounts.rework + edgeCounts.exit,
      renderedEdgeCount: edges.length,
      rawNodeCount: nodes.length,
    },
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}

export function buildPhasePalette(phases: string[]): Record<string, string> {
  const palette: Record<string, string> = {};

  for (const [index, phase] of phases.entries()) {
    palette[phase] = PHASE_PALETTE[index % PHASE_PALETTE.length]!;
  }

  return palette;
}

function resolvePhaseOrder(
  phases: string[],
  orderedStates: Array<[string, DispatcherDefinitionState]>,
): string[] {
  const seen = new Set<string>();
  const resolved: string[] = [];

  for (const phase of phases) {
    const normalized = normalizePhase(phase);
    if (!seen.has(normalized)) {
      seen.add(normalized);
      resolved.push(normalized);
    }
  }

  for (const [, state] of orderedStates) {
    const normalized = normalizePhase(state.phase);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    resolved.push(normalized);
  }

  return resolved;
}

function buildLaneLayouts(
  phaseBuckets: Array<{
    phase: string;
    entries: Array<[string, DispatcherDefinitionState]>;
  }>,
  palette: Record<string, string>,
): JourneyLaneLayout[] {
  return phaseBuckets.map(({ phase, entries }, index) => ({
    color: palette[phase] ?? PHASE_PALETTE[index % PHASE_PALETTE.length]!,
    phase,
    stateCount: entries.length,
    width: LANE_WIDTH,
    x: CANVAS_PADDING_LEFT + index * (LANE_WIDTH + LANE_GAP_X),
  }));
}

function measureCanvasHeight(
  phaseBuckets: Array<{
    phase: string;
    entries: Array<[string, DispatcherDefinitionState]>;
  }>,
): number {
  const maxStackHeight = Math.max(
    0,
    ...phaseBuckets.map(({ entries }) => measureStackHeight(entries.map(([, state]) => state))),
  );

  return Math.max(
    MIN_CANVAS_HEIGHT,
    CANVAS_PADDING_TOP + LANE_HEADER_HEIGHT + maxStackHeight + CANVAS_PADDING_BOTTOM,
  );
}

function buildLaneNode(layout: JourneyLaneLayout, canvasHeight: number): JourneyLaneNode {
  return {
    id: `lane-${layout.phase}`,
    type: "journeyLane",
    position: { x: layout.x, y: 0 },
    width: layout.width,
    height: canvasHeight,
    // `measured` tells @xyflow/system's `adoptUserNodes` to treat the node
    // as already sized so internal `handleBounds` are preserved across
    // re-renders — without this the store wipes handleBounds on every SSE
    // snapshot and EdgeWrapper returns null (no edges render).
    measured: { width: layout.width, height: canvasHeight },
    draggable: false,
    selectable: false,
    connectable: false,
    focusable: false,
    data: {
      color: layout.color,
      phase: layout.phase,
      stateCount: layout.stateCount,
    },
  };
}

function buildStateNodes(
  phaseBuckets: Array<{
    phase: string;
    entries: Array<[string, DispatcherDefinitionState]>;
  }>,
  laneLayouts: JourneyLaneLayout[],
  palette: Record<string, string>,
): JourneyStateNode[] {
  const maxStackHeight = Math.max(
    0,
    ...phaseBuckets.map(({ entries }) => measureStackHeight(entries.map(([, state]) => state))),
  );

  return phaseBuckets.flatMap(({ phase, entries }, phaseIndex) => {
    const lane = laneLayouts[phaseIndex];
    if (!lane) return [];

    const stackHeight = measureStackHeight(entries.map(([, state]) => state));
    let currentY = CANVAS_PADDING_TOP + LANE_HEADER_HEIGHT + (maxStackHeight - stackHeight) / 2;

    return entries.map(([stateName, state]) => {
      const nodeSize = measureNode(state);
      const node = {
        id: stateName,
        type: "journey",
        className: [
          "journey-node-shell",
          `journey-node-${state.actor ?? "terminal"}`,
          state.provider ? `journey-node-provider-${state.provider}` : "",
          state.initial ? "journey-node-initial" : "",
          state.terminal ? "journey-node-terminal" : "",
        ].filter(Boolean).join(" "),
        position: {
          x: lane.x + (lane.width - nodeSize.width) / 2,
          y: currentY,
        },
        width: nodeSize.width,
        height: nodeSize.height,
        // see `buildLaneNode` comment — `measured` keeps handleBounds
        // stable across `adoptUserNodes` re-runs so edges stay drawn.
        measured: { width: nodeSize.width, height: nodeSize.height },
        sourcePosition: state.terminal ? Position.Left : Position.Right,
        targetPosition: Position.Left,
        data: {
          actor: state.actor ?? null,
          badge: buildBadge(state),
          color: resolveNodeColor(state, palette[phase] ?? PHASE_PALETTE[phaseIndex % PHASE_PALETTE.length]!),
          description: buildNodeDescription(state),
          initial: state.initial,
          phase: state.phase,
          provider: state.provider ?? null,
          resumable: state.resumable ?? null,
          stateName,
          terminal: state.terminal,
          tooltip: buildNodeTooltip(stateName, state),
        },
      } satisfies JourneyStateNode;

      currentY += nodeSize.height + NODE_GAP_Y;
      return node;
    });
  });
}

function buildEdges(
  transitions: DispatcherTransition[],
  nodesById: Map<string, JourneyStateNode>,
  laneLayouts: JourneyLaneLayout[],
): {
  anchors: JourneyAnchorNode[];
  edges: Edge<JourneyEdgeData, "journey">[];
} {
  const anchors: JourneyAnchorNode[] = [];
  const edges: Edge<JourneyEdgeData, "journey">[] = [];
  const lanesByPhase = new Map(laneLayouts.map((layout) => [layout.phase, layout]));

  for (const [transitionIndex, transition] of transitions.entries()) {
    if (shouldAggregateExitTransition(transition)) {
      const targetNode = nodesById.get(transition.to);
      if (!targetNode) continue;

      const sourcesByPhase = new Map<string, string[]>();
      for (const source of transition.from) {
        const sourceNode = nodesById.get(source);
        if (!sourceNode) continue;
        const phase = normalizePhase(sourceNode.data.phase);
        const bucket = sourcesByPhase.get(phase) ?? [];
        bucket.push(source);
        sourcesByPhase.set(phase, bucket);
      }

      for (const [phase, sources] of sourcesByPhase.entries()) {
        const lane = lanesByPhase.get(phase);
        if (!lane) continue;

        const sourceCenterY = average(
          sources
            .map((source) => nodesById.get(source))
            .filter((node): node is JourneyStateNode => Boolean(node))
            .map(centerYForNode),
        );
        const anchorId = `exit-anchor-${transition.to}-${phase}-${transitionIndex}`;

        anchors.push({
          id: anchorId,
          type: "journeyAnchor",
          position: {
            x: lane.x + lane.width - AGGREGATE_ANCHOR_OFFSET_X,
            y: sourceCenterY - AGGREGATE_ANCHOR_SIZE / 2,
          },
          width: AGGREGATE_ANCHOR_SIZE,
          height: AGGREGATE_ANCHOR_SIZE,
          // see `buildLaneNode` comment — `measured` keeps handleBounds
          // stable so grouped exit edges stay drawn.
          measured: { width: AGGREGATE_ANCHOR_SIZE, height: AGGREGATE_ANCHOR_SIZE },
          sourcePosition: Position.Right,
          targetPosition: Position.Left,
          draggable: false,
          selectable: false,
          connectable: false,
          focusable: false,
          data: {
            phase,
            target: transition.to,
          },
        });

        edges.push({
          id: `${transition.class}-${phase}-${transition.to}-${transitionIndex}`,
          source: anchorId,
          target: transition.to,
          type: "journey",
          zIndex: 1,
          className: `journey-edge journey-edge-${transition.class} journey-edge-aggregated`,
          markerEnd: { type: MarkerType.ArrowClosed },
          data: {
            aggregated: true,
            class: transition.class,
            sourcePhase: phase,
            sources,
            tooltip: `${transition.class} • ${phase} phase -> ${transition.to}\nfrom: ${sources.join(", ")}`,
          },
        });
      }

      continue;
    }

    const sources = expandSources(transition);
    for (const [sourceIndex, source] of sources.entries()) {
      if (!nodesById.has(source) || !nodesById.has(transition.to)) continue;

      edges.push({
        id: `${transition.class}-${source}-${transition.to}-${transitionIndex}-${sourceIndex}`,
        source,
        target: transition.to,
        type: "journey",
        zIndex: 1,
        className: `journey-edge journey-edge-${transition.class}`,
        markerEnd: { type: MarkerType.ArrowClosed },
        data: {
          class: transition.class,
          tooltip: `${transition.class} • ${source} -> ${transition.to}`,
        },
      });
    }
  }

  return {
    anchors,
    edges,
  };
}

function summarizeRawEdges(
  transitions: DispatcherTransition[],
): Record<DispatcherTransitionClass, number> {
  const counts: Record<DispatcherTransitionClass, number> = {
    advance: 0,
    rework: 0,
    exit: 0,
  };

  for (const transition of transitions) {
    counts[transition.class] += expandSources(transition).length;
  }

  return counts;
}

function shouldAggregateExitTransition(
  transition: DispatcherTransition,
): transition is DispatcherTransition & { class: "exit"; from: string[] } {
  return transition.class === "exit" && Array.isArray(transition.from) && transition.from.length >= 2;
}

function expandSources(transition: DispatcherTransition): string[] {
  return Array.isArray(transition.from) ? transition.from : [transition.from];
}

function measureStackHeight(states: DispatcherDefinitionState[]): number {
  if (states.length === 0) return 0;
  const nodeHeights = states.reduce((total, state) => total + measureNode(state).height, 0);
  const gaps = (states.length - 1) * NODE_GAP_Y;
  return nodeHeights + gaps;
}

function measureNode(state: DispatcherDefinitionState): { height: number; width: number } {
  if (state.actor === "agent") {
    return { width: 136, height: 136 };
  }

  if (state.terminal) {
    return { width: 188, height: 88 };
  }

  return { width: 194, height: 92 };
}

function buildBadge(state: DispatcherDefinitionState): string {
  if (state.terminal) return "TERMINAL";
  if (state.actor === "agent" && state.provider === "anthropic") return "ANTHROPIC AGENT";
  if (state.actor === "agent" && state.provider === "openai") return "OPENAI AGENT";
  if (state.actor === "agent") return "AGENT";
  if (state.actor === "operator") return "OPERATOR";
  return "UNKNOWN";
}

function resolveNodeColor(
  state: DispatcherDefinitionState,
  phaseColor: string,
): string {
  if (state.terminal) return phaseColor;
  if (state.actor === "operator") return PROVIDER_COLORS.anthropic;
  if (state.provider) return PROVIDER_COLORS[state.provider];
  return phaseColor;
}

function buildNodeDescription(state: DispatcherDefinitionState): string {
  const parts = [normalizePhase(state.phase)];

  if (state.resumable === true) {
    parts.push("resumable");
  } else if (state.resumable === false) {
    parts.push("non-resumable");
  }

  if (state.initial) {
    parts.push("initial");
  }

  return parts.join(" • ");
}

function buildNodeTooltip(stateName: string, state: DispatcherDefinitionState): string {
  return [
    stateName,
    `phase: ${normalizePhase(state.phase)}`,
    `actor: ${state.actor ?? "n/a"}`,
    `provider: ${state.provider ?? "n/a"}`,
    `resumable: ${state.resumable === null || state.resumable === undefined ? "n/a" : state.resumable ? "true" : "false"}`,
    `initial: ${state.initial ? "true" : "false"}`,
    `terminal: ${state.terminal ? "true" : "false"}`,
  ].join("\n");
}

function normalizePhase(phase: string | null | undefined): string {
  return phase?.trim() || "unphased";
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function centerYForNode(node: JourneyStateNode): number {
  return node.position.y + (node.height ?? 0) / 2;
}
