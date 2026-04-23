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
  "#77b7d8",
  "#79c29c",
  "#d3845b",
  "#9f96e5",
  "#d96f89",
];

const NODE_GAP_Y = 148;
const PHASE_GAP_X = 280;

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

export interface JourneyEdgeData {
  class: DispatcherTransitionClass;
  tooltip: string;
  [key: string]: unknown;
}

export interface JourneyGraph {
  contract: JourneyGraphContract;
  edges: Edge<JourneyEdgeData>[];
  nodes: Node<JourneyNodeData>[];
  palette: Record<string, string>;
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
  const palette = buildPhasePalette(contract.phases);
  const orderedStates = Object.entries(contract.states);
  const phaseBuckets = contract.phases.map((phase) => ({
    phase,
    entries: orderedStates.filter(([, state]) => state.phase === phase),
  }));

  const nodes = phaseBuckets.flatMap(({ phase, entries }, phaseIndex) => (
    entries.map(([stateName, state], stateIndex) => {
      const nodeSize = measureNode(state);
      const color = palette[phase] ?? PHASE_PALETTE[phaseIndex % PHASE_PALETTE.length]!;
      return {
        id: stateName,
        type: "journey",
        className: [
          "journey-node-shell",
          `journey-node-${state.actor ?? "terminal"}`,
          state.initial ? "journey-node-initial" : "",
          state.terminal ? "journey-node-terminal" : "",
        ].filter(Boolean).join(" "),
        position: {
          x: 80 + phaseIndex * PHASE_GAP_X,
          y: 88 + stateIndex * NODE_GAP_Y + (phaseIndex % 2 === 0 ? 0 : 18),
        },
        width: nodeSize.width,
        height: nodeSize.height,
        sourcePosition: state.terminal ? Position.Left : Position.Right,
        targetPosition: Position.Left,
        data: {
          actor: state.actor ?? null,
          badge: buildBadge(state),
          color,
          description: buildNodeDescription(state),
          initial: state.initial,
          phase: state.phase,
          provider: state.provider ?? null,
          resumable: state.resumable ?? null,
          stateName,
          terminal: state.terminal,
          tooltip: buildNodeTooltip(stateName, state),
        },
      } satisfies Node<JourneyNodeData>;
    })
  ));

  const edges = contract.transitions.flatMap((transition, transitionIndex) => (
    expandSources(transition).map((source, sourceIndex) => {
      const edge: Edge<JourneyEdgeData> = {
        id: `${transition.class}-${source}-${transition.to}-${transitionIndex}-${sourceIndex}`,
        source,
        target: transition.to,
        type: edgeTypeForClass(transition.class),
        className: `journey-edge journey-edge-${transition.class}`,
        animated: transition.class === "advance",
        markerEnd: { type: MarkerType.ArrowClosed },
        data: {
          class: transition.class,
          tooltip: `${transition.class} • ${source} -> ${transition.to}`,
        },
      };
      return edge;
    })
  ));

  return {
    contract,
    edges,
    nodes,
    palette,
    viewport: { x: 120, y: 88, zoom: 1 },
  };
}

export function buildPhasePalette(phases: string[]): Record<string, string> {
  const palette: Record<string, string> = {};
  for (const [index, phase] of phases.entries()) {
    palette[phase] = PHASE_PALETTE[index % PHASE_PALETTE.length]!;
  }
  return palette;
}

function expandSources(transition: DispatcherTransition): string[] {
  return Array.isArray(transition.from) ? transition.from : [transition.from];
}

function edgeTypeForClass(value: DispatcherTransitionClass): string {
  if (value === "rework") return "journey-rework";
  if (value === "exit") return "journey-exit";
  return "journey-advance";
}

function measureNode(state: DispatcherDefinitionState): { height: number; width: number } {
  if (state.actor === "agent") {
    return { width: 118, height: 118 };
  }
  if (state.terminal) {
    return { width: 160, height: 88 };
  }
  return { width: 176, height: 88 };
}

function buildBadge(state: DispatcherDefinitionState): string {
  if (state.terminal) return "terminal";
  if (state.actor === "agent") return state.provider ? `${state.provider} agent` : "agent";
  if (state.actor === "operator") return "operator";
  return "unknown";
}

function buildNodeDescription(state: DispatcherDefinitionState): string {
  const parts = [state.phase ?? "unphased"];
  if (state.actor) parts.push(state.actor);
  if (state.provider) parts.push(state.provider);
  if (state.resumable !== undefined && state.resumable !== null) {
    parts.push(state.resumable ? "resumable" : "non-resumable");
  }
  if (state.initial) parts.push("initial");
  if (state.terminal) parts.push("terminal");
  return parts.join(" • ");
}

function buildNodeTooltip(stateName: string, state: DispatcherDefinitionState): string {
  return [
    stateName,
    `phase: ${state.phase ?? "n/a"}`,
    `actor: ${state.actor ?? "n/a"}`,
    `provider: ${state.provider ?? "n/a"}`,
    `resumable: ${state.resumable === null || state.resumable === undefined ? "n/a" : state.resumable ? "true" : "false"}`,
    `initial: ${state.initial ? "true" : "false"}`,
    `terminal: ${state.terminal ? "true" : "false"}`,
  ].join("\n");
}
