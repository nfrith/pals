import type { DispatchTelemetryEvent } from "../../skills/new/references/dispatcher/src/telemetry.ts";
import type {
  DashboardSnapshot,
  DispatcherDefinitionState,
  DispatcherLivenessState,
  DispatcherSnapshot,
} from "./feed/types.ts";

const DASHBOARD_TITLE = "Delamain Dashboard";
const HISTORY_LIMIT = 5;

const STATE_BADGES: Record<DispatcherLivenessState, string> = {
  idle: "IDLE",
  live: "LIVE",
  offline: "OFFLINE",
  stale: "STALE",
  error: "ERROR",
};

const PHASE_ABBREVIATIONS: Record<string, string> = {
  draft: "dft",
  drafted: "dft",
  research: "res",
  planning: "pln",
  implementation: "impl",
  development: "dev",
  dev: "dev",
  review: "rev",
  uat: "uat",
  qa: "qa",
  done: "done",
  closed: "done",
};

export interface DashboardSummaryView {
  activeDispatchCount: number;
  dispatcherCount: number;
  generatedAtLabel: string;
  rootCount: number;
  stateCounts: Record<DispatcherLivenessState, number>;
  stateSummaryLine: string;
  totalSpendLabel: string;
  totalSpendUsd: number;
}

export interface DashboardViewModel {
  dispatchers: DispatcherViewModel[];
  dispatcherCount: number;
  generatedAtLabel: string;
  rootCount: number;
  subtitle: string;
  summary: DashboardSummaryView;
  title: string;
}

export interface DispatcherModuleView {
  entityName: string | null;
  entityPath: string | null;
  moduleId: string | null;
  moduleLine: string;
  moduleMountPath: string | null;
  moduleVersion: number | null;
}

export interface DispatcherQueueView {
  activeCount: number;
  queueLine: string;
  scannedCount: number;
  trackedCount: number;
}

export interface DispatcherHeartbeatView {
  ageLabel: string;
  ageMs: number | null;
  pollLabel: string;
  pollMs: number | null;
  tickLine: string;
}

export interface DispatcherTelemetryView {
  available: boolean;
  legacyMode: boolean;
  line: string;
  parseErrors: number;
  path: string;
  recentEventCount: number;
}

export interface DispatcherSpendView {
  eventCount: number;
  line: string;
  sessionUsd: number;
}

export interface DispatcherPhaseView {
  compactLabel: string;
  count: number;
  isActive: boolean;
  isBottleneck: boolean;
  isTerminal: boolean;
  label: string;
  phase: string;
  stateNames: string[];
}

export interface DispatcherPipelineView {
  bottleneckPhase: string | null;
  compactLine: string;
  horizontalLine: string;
  phases: DispatcherPhaseView[];
  verticalLines: string[];
}

export interface DispatcherActiveDispatchView {
  compactLine: string;
  costLabel: string;
  costPending: boolean;
  costUsd: number | null;
  elapsedLabel: string;
  elapsedMs: number | null;
  itemId: string;
  phase: string | null;
  startedAt: string;
  summaryLine: string;
  transitionTargets: string[];
  turns: number | null;
  turnsLabel: string;
  workerSessionId: string | null;
}

export interface DispatcherHistoryEntryView {
  compactLine: string;
  costLabel: string;
  costUsd: number | null;
  durationLabel: string;
  durationMs: number | null;
  error: string | null;
  itemId: string;
  outcome: "success" | "failure";
  state: string;
  statusLabel: string;
  summaryLine: string;
  timestamp: string;
  timestampLabel: string;
  transitionLabel: string;
  turns: number | null;
  turnsLabel: string;
}

export interface DispatcherItemView {
  actor: "agent" | "operator" | "terminal" | "unknown";
  filePath: string;
  id: string;
  isActive: boolean;
  listDescription: string;
  listName: string;
  phase: string | null;
  phaseLabel: string;
  state: string;
  type: string;
}

export interface DispatcherItemGroupView {
  compactHeader: string;
  count: number;
  header: string;
  items: DispatcherItemView[];
  phase: string | null;
  state: string;
}

export interface DispatcherViewModel {
  activeDispatches: DispatcherActiveDispatchView[];
  activeLine: string;
  countsLine: string;
  detail: string;
  errorLine: string | null;
  heartbeat: DispatcherHeartbeatView;
  itemGroups: DispatcherItemGroupView[];
  itemLines: string[];
  items: DispatcherItemView[];
  module: DispatcherModuleView;
  moduleLine: string;
  name: string;
  pipeline: DispatcherPipelineView;
  pipelineLine: string;
  pipelineCompactLine: string;
  queue: DispatcherQueueView;
  queueLine: string;
  recentHistory: DispatcherHistoryEntryView[];
  recentLine: string;
  spend: DispatcherSpendView;
  spendLine: string;
  state: DispatcherLivenessState;
  stateBadge: string;
  telemetry: DispatcherTelemetryView;
  telemetryLine: string;
  tickLine: string;
}

export function buildDashboardViewModel(snapshot: DashboardSnapshot): DashboardViewModel {
  const now = coerceTimestamp(snapshot.generatedAt);
  const dispatchers = snapshot.dispatchers.map((dispatcher) => buildDispatcherViewModel(dispatcher, now));
  const totalSpendUsd = dispatchers.reduce((sum, dispatcher) => sum + dispatcher.spend.sessionUsd, 0);
  const stateCounts = {
    idle: 0,
    live: 0,
    offline: 0,
    stale: 0,
    error: 0,
  } satisfies Record<DispatcherLivenessState, number>;

  for (const dispatcher of dispatchers) {
    stateCounts[dispatcher.state] += 1;
  }

  const summary: DashboardSummaryView = {
    activeDispatchCount: dispatchers.reduce((sum, dispatcher) => sum + dispatcher.activeDispatches.length, 0),
    dispatcherCount: snapshot.dispatcherCount,
    generatedAtLabel: formatTimestamp(snapshot.generatedAt),
    rootCount: snapshot.roots.length,
    stateCounts,
    stateSummaryLine: formatStateCounts(stateCounts),
    totalSpendLabel: formatCurrency(totalSpendUsd),
    totalSpendUsd,
  };

  return {
    dispatchers,
    dispatcherCount: snapshot.dispatcherCount,
    generatedAtLabel: summary.generatedAtLabel,
    rootCount: snapshot.roots.length,
    subtitle: snapshot.systemRoot,
    summary,
    title: DASHBOARD_TITLE,
  };
}

export function buildDispatcherViewModel(
  dispatcher: DispatcherSnapshot,
  now = coerceTimestamp(new Date().toISOString()),
): DispatcherViewModel {
  const activeDispatches = inferActiveDispatches(dispatcher, now);
  const activeItemIds = new Set(activeDispatches.map((run) => run.itemId));
  const recentHistory = buildRecentHistory(dispatcher.recentEvents);
  const pipeline = buildPipelineView(dispatcher, activeDispatches);
  const spendUsd = recentHistory.reduce((sum, entry) => sum + (entry.costUsd ?? 0), 0);
  const spendEventCount = recentHistory.filter((entry) => entry.costUsd !== null).length;
  const activeCount = Math.max(dispatcher.activeDispatches, activeDispatches.length);

  const moduleLine = dispatcher.moduleId
    ? [
      dispatcher.moduleId,
      dispatcher.entityName ?? "entity",
      dispatcher.entityPath ?? "unknown path",
    ].join(" • ")
    : "Runtime manifest unavailable";
  const queueLine = `${activeCount} active • ${dispatcher.itemSummary.totalItems} tracked • ${dispatcher.itemsScanned} scanned`;
  const tickLine = dispatcher.lastTickAgeMs === null
    ? "Heartbeat unavailable"
    : `HB ${formatAge(dispatcher.lastTickAgeMs)} • poll ${formatDuration(dispatcher.pollMs)}`;
  const countsLine = formatStateSummary(dispatcher.itemSummary.byState);
  const recentLine = recentHistory.length > 0
    ? recentHistory[0]!.summaryLine
    : dispatcher.telemetry.legacyMode
      ? "Legacy dispatcher — recent history unavailable"
      : "No recent dispatch telemetry recorded";
  const telemetryLine = dispatcher.telemetry.legacyMode
    ? "Telemetry file missing — heartbeat-only mode"
    : dispatcher.telemetry.parseErrors > 0
      ? `Telemetry live • ${dispatcher.recentEvents.length} events • ${dispatcher.telemetry.parseErrors} parse errors`
      : `Telemetry live • ${dispatcher.recentEvents.length} events`;
  const activeLine = activeDispatches.length > 0
    ? activeDispatches.length === 1
      ? activeDispatches[0]!.summaryLine
      : `${activeDispatches[0]!.summaryLine} +${activeDispatches.length - 1} more`
    : "Idle • no active dispatch inferred";
  const spendLine = `Spend ${formatCurrency(spendUsd)} • ${spendEventCount} metered run${spendEventCount === 1 ? "" : "s"}`;

  const items = buildItemViews(dispatcher, activeItemIds);
  const itemGroups = buildItemGroups(items);

  return {
    activeDispatches,
    activeLine,
    countsLine,
    detail: dispatcher.detail,
    errorLine: dispatcher.recentError
      ? `Recent error • ${dispatcher.recentError.itemId} • ${truncate(dispatcher.recentError.error, 96)}`
      : null,
    heartbeat: {
      ageLabel: dispatcher.lastTickAgeMs === null ? "n/a" : formatAge(dispatcher.lastTickAgeMs),
      ageMs: dispatcher.lastTickAgeMs,
      pollLabel: formatDuration(dispatcher.pollMs),
      pollMs: dispatcher.pollMs,
      tickLine,
    },
    itemGroups,
    itemLines: items.slice(0, 5).map((item) => `${item.id} • ${item.state} • ${item.type}`),
    items,
    module: {
      entityName: dispatcher.entityName,
      entityPath: dispatcher.entityPath,
      moduleId: dispatcher.moduleId,
      moduleLine,
      moduleMountPath: dispatcher.moduleMountPath,
      moduleVersion: dispatcher.moduleVersion,
    },
    moduleLine,
    name: dispatcher.name,
    pipeline,
    pipelineLine: pipeline.horizontalLine,
    pipelineCompactLine: pipeline.compactLine,
    queue: {
      activeCount,
      queueLine,
      scannedCount: dispatcher.itemsScanned,
      trackedCount: dispatcher.itemSummary.totalItems,
    },
    queueLine,
    recentHistory,
    recentLine,
    spend: {
      eventCount: spendEventCount,
      line: spendLine,
      sessionUsd: spendUsd,
    },
    spendLine,
    state: dispatcher.state,
    stateBadge: STATE_BADGES[dispatcher.state],
    telemetry: {
      available: dispatcher.telemetry.available,
      legacyMode: dispatcher.telemetry.legacyMode,
      line: telemetryLine,
      parseErrors: dispatcher.telemetry.parseErrors,
      path: dispatcher.telemetry.path,
      recentEventCount: dispatcher.recentEvents.length,
    },
    telemetryLine,
    tickLine,
  };
}

export function inferActiveDispatches(
  dispatcher: DispatcherSnapshot,
  now = coerceTimestamp(new Date().toISOString()),
): DispatcherActiveDispatchView[] {
  const ordered = dispatcher.recentEvents
    .map((event, index) => ({ event, index }))
    .sort((left, right) => {
      const leftTime = coerceTimestamp(left.event.timestamp).getTime();
      const rightTime = coerceTimestamp(right.event.timestamp).getTime();
      return leftTime === rightTime ? left.index - right.index : leftTime - rightTime;
    });
  const pending: DispatchTelemetryEvent[] = [];

  for (const { event } of ordered) {
    if (event.event_type === "dispatch_start") {
      pending.push(event);
      continue;
    }

    const matchIndex = findMatchingStartIndex(pending, event);
    if (matchIndex !== -1) {
      pending.splice(matchIndex, 1);
    }
  }

  return pending.map((event) => {
    const elapsedMs = measureAgeMs(event.timestamp, now);
    const phase = dispatcher.states[event.state]?.phase ?? null;
    const turnsLabel = event.num_turns === null ? "turns pending" : `${event.num_turns} turns`;
    const costPending = event.cost_usd === null;
    const costLabel = costPending ? "cost pending" : formatCurrency(event.cost_usd);
    const elapsedLabel = elapsedMs === null ? "n/a" : formatDuration(elapsedMs);
    const phaseLabel = phase ?? event.state;

    return {
      compactLine: `${event.item_id} ${phaseLabel} ${elapsedLabel}`,
      costLabel,
      costPending,
      costUsd: event.cost_usd,
      elapsedLabel,
      elapsedMs,
      itemId: event.item_id,
      phase,
      startedAt: event.timestamp,
      summaryLine: `▶ ${event.item_id} ${event.state} (${elapsedLabel}, ${costLabel}, ${turnsLabel})`,
      transitionTargets: event.transition_targets,
      turns: event.num_turns,
      turnsLabel,
      workerSessionId: event.worker_session_id,
    };
  });
}

export function buildRecentHistory(
  events: DispatchTelemetryEvent[],
  limit = HISTORY_LIMIT,
): DispatcherHistoryEntryView[] {
  return events
    .filter((event) => event.event_type === "dispatch_finish" || event.event_type === "dispatch_failure")
    .slice(-limit)
    .reverse()
    .map((event) => {
      const transitionTarget = event.transition_targets[0];
      const transitionLabel = transitionTarget ? `${event.state} → ${transitionTarget}` : event.state;
      const outcome = event.event_type === "dispatch_finish" ? "success" : "failure";
      const turnsLabel = event.num_turns === null ? "turns n/a" : `${event.num_turns} turns`;
      const durationLabel = formatDuration(event.duration_ms);
      const costLabel = formatCurrency(event.cost_usd);
      const statusLabel = outcome === "success" ? "PASS" : "FAIL";

      return {
        compactLine: `${statusLabel} ${event.item_id} ${durationLabel} ${costLabel}`,
        costLabel,
        costUsd: event.cost_usd,
        durationLabel,
        durationMs: event.duration_ms,
        error: event.error,
        itemId: event.item_id,
        outcome,
        state: event.state,
        statusLabel,
        summaryLine: `${statusLabel} • ${event.item_id} • ${transitionLabel} • ${durationLabel} • ${costLabel}`,
        timestamp: event.timestamp,
        timestampLabel: formatTimestamp(event.timestamp),
        transitionLabel,
        turns: event.num_turns,
        turnsLabel,
      };
    });
}

export function buildPipelineView(
  dispatcher: DispatcherSnapshot,
  activeDispatches: DispatcherActiveDispatchView[],
): DispatcherPipelineView {
  const phaseNames = dispatcher.phaseOrder.length > 0
    ? [...dispatcher.phaseOrder]
    : uniquePhasesFromStates(dispatcher.states);
  const activePhases = new Set(
    activeDispatches
      .map((dispatch) => dispatch.phase)
      .filter((value): value is string => value !== null),
  );

  const phases: DispatcherPhaseView[] = [];
  const countsByPhase = new Map<string, number>();

  for (const phase of phaseNames) {
    const stateNames = Object.entries(dispatcher.states)
      .filter(([, state]) => state.phase === phase)
      .map(([name]) => name)
      .sort((left, right) => left.localeCompare(right));
    const count = stateNames.reduce((sum, stateName) => sum + (dispatcher.itemSummary.byState[stateName] ?? 0), 0);
    countsByPhase.set(phase, count);
    phases.push({
      compactLabel: compactPhaseLabel(phase),
      count,
      isActive: activePhases.has(phase),
      isBottleneck: false,
      isTerminal: isTerminalPhase(dispatcher.states, stateNames),
      label: phase,
      phase,
      stateNames,
    });
  }

  const unmappedCount = Object.entries(dispatcher.itemSummary.byState)
    .filter(([stateName]) => !dispatcher.states[stateName]?.phase)
    .reduce((sum, [, count]) => sum + count, 0);
  if (unmappedCount > 0) {
    phases.push({
      compactLabel: "oth",
      count: unmappedCount,
      isActive: false,
      isBottleneck: false,
      isTerminal: false,
      label: "other",
      phase: "other",
      stateNames: Object.keys(dispatcher.itemSummary.byState).filter((stateName) => !dispatcher.states[stateName]?.phase),
    });
  }

  const bottleneckPhase = phases
    .filter((phase) => !phase.isTerminal)
    .sort((left, right) => right.count - left.count || left.phase.localeCompare(right.phase))[0];
  if (bottleneckPhase && bottleneckPhase.count > 0) {
    bottleneckPhase.isBottleneck = true;
  }

  return {
    bottleneckPhase: bottleneckPhase?.phase ?? null,
    compactLine: formatPipelineLine(phases, true),
    horizontalLine: formatPipelineLine(phases, false),
    phases,
    verticalLines: phases.map((phase) => {
      const marker = phase.isActive ? "▶" : phase.isBottleneck ? "!" : " ";
      return `${marker} ${padRight(compactPhaseLabel(phase.phase), 4)} ${String(phase.count).padStart(2, " ")}`;
    }),
  };
}

export function buildItemGroups(items: DispatcherItemView[]): DispatcherItemGroupView[] {
  const groups = new Map<string, DispatcherItemView[]>();

  for (const item of items) {
    const existing = groups.get(item.state) ?? [];
    existing.push(item);
    groups.set(item.state, existing);
  }

  return [...groups.entries()].map(([state, stateItems]) => ({
    compactHeader: `[${state}] ${stateItems.length}`,
    count: stateItems.length,
    header: `${state} (${stateItems.length})`,
    items: stateItems,
    phase: stateItems[0]?.phase ?? null,
    state,
  }));
}

export function buildItemViews(
  dispatcher: DispatcherSnapshot,
  activeItemIds: Set<string>,
): DispatcherItemView[] {
  return dispatcher.items
    .map((item) => {
      const state = dispatcher.states[item.status];
      const phase = state?.phase ?? null;
      const actor: DispatcherItemView["actor"] = state?.terminal
        ? "terminal"
        : state?.actor === "agent"
          ? "agent"
          : state?.actor === "operator"
            ? "operator"
            : "unknown";
      const listName = `${activeItemIds.has(item.id) ? "▶ " : ""}${item.id}`;
      const listDescription = [item.status, phase ?? "unmapped", item.type].join(" • ");

      return {
        actor,
        filePath: item.filePath,
        id: item.id,
        isActive: activeItemIds.has(item.id),
        listDescription,
        listName,
        phase,
        phaseLabel: phase ?? item.status,
        state: item.status,
        type: item.type,
      };
    })
    .sort((left, right) => compareItems(dispatcher, left, right));
}

export function formatAge(ageMs: number): string {
  if (ageMs < 1000) return `${ageMs}ms`;

  const seconds = Math.round(ageMs / 1000);
  if (seconds < 60) return `${seconds}s`;

  const minutes = Math.floor(seconds / 60);
  const remainderSeconds = seconds % 60;
  if (minutes < 60) return remainderSeconds === 0 ? `${minutes}m` : `${minutes}m ${remainderSeconds}s`;

  const hours = Math.floor(minutes / 60);
  const remainderMinutes = minutes % 60;
  return remainderMinutes === 0 ? `${hours}h` : `${hours}h ${remainderMinutes}m`;
}

export function formatDuration(value: number | null): string {
  if (value === null || value <= 0) return "n/a";
  return formatAge(value);
}

export function formatCurrency(value: number | null): string {
  if (value === null) return "n/a";
  return `$${value.toFixed(2)}`;
}

export function formatTimestamp(timestamp: string): string {
  const date = coerceTimestamp(timestamp);
  if (Number.isNaN(date.getTime())) return timestamp;

  const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][date.getUTCMonth()]!;
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hour = String(date.getUTCHours()).padStart(2, "0");
  const minute = String(date.getUTCMinutes()).padStart(2, "0");
  const second = String(date.getUTCSeconds()).padStart(2, "0");
  return `${month} ${day} ${hour}:${minute}:${second} UTC`;
}

export function compactPhaseLabel(phase: string): string {
  const lower = phase.toLowerCase();
  if (PHASE_ABBREVIATIONS[lower]) {
    return PHASE_ABBREVIATIONS[lower]!;
  }

  const lettersOnly = lower.replace(/[^a-z0-9]/g, "");
  if (lettersOnly.length <= 4) {
    return lettersOnly;
  }

  const consonants = `${lettersOnly[0]}${lettersOnly.slice(1).replace(/[aeiou]/g, "")}`;
  return consonants.slice(0, 4);
}

function compareItems(
  dispatcher: DispatcherSnapshot,
  left: DispatcherItemView,
  right: DispatcherItemView,
): number {
  const leftPhaseIndex = resolvePhaseIndex(dispatcher, left.phase);
  const rightPhaseIndex = resolvePhaseIndex(dispatcher, right.phase);
  if (leftPhaseIndex !== rightPhaseIndex) {
    return leftPhaseIndex - rightPhaseIndex;
  }

  if (left.state !== right.state) {
    return left.state.localeCompare(right.state);
  }

  return left.id.localeCompare(right.id);
}

function coerceTimestamp(timestamp: string): Date {
  return new Date(timestamp);
}

function findMatchingStartIndex(pending: DispatchTelemetryEvent[], terminal: DispatchTelemetryEvent): number {
  for (let index = pending.length - 1; index >= 0; index -= 1) {
    const start = pending[index]!;
    if (start.item_id !== terminal.item_id) continue;
    if (start.worker_session_id && terminal.worker_session_id && start.worker_session_id === terminal.worker_session_id) {
      return index;
    }
    if (start.state === terminal.state) {
      return index;
    }
  }

  return pending.findLastIndex((start) => start.item_id === terminal.item_id);
}

function formatPipelineLine(phases: DispatcherPhaseView[], compact: boolean): string {
  const relevant = compact
    ? phases.filter((phase, index) => phase.count > 0 || phase.isActive || index === phases.length - 1)
    : phases;

  if (relevant.length === 0) return "No pipeline definition";

  return relevant
    .map((phase) => {
      const label = compact ? phase.compactLabel : phase.label;
      return `${label}(${phase.count})`;
    })
    .join(" → ");
}

function formatStateCounts(stateCounts: Record<DispatcherLivenessState, number>): string {
  return (["live", "idle", "stale", "offline", "error"] as const)
    .filter((state) => stateCounts[state] > 0)
    .map((state) => `${STATE_BADGES[state]} ${stateCounts[state]}`)
    .join(" • ");
}

function formatStateSummary(byState: Record<string, number>): string {
  const entries = Object.entries(byState).sort((left, right) => left[0].localeCompare(right[0]));
  if (entries.length === 0) return "No tracked items";
  return entries.map(([state, count]) => `${state} ${count}`).join(" • ");
}

function isTerminalPhase(
  states: Record<string, DispatcherDefinitionState>,
  stateNames: string[],
): boolean {
  if (stateNames.length === 0) return false;
  return stateNames.every((name) => states[name]?.terminal === true);
}

function measureAgeMs(timestamp: string, now: Date): number | null {
  const value = Date.parse(timestamp);
  if (Number.isNaN(value)) return null;
  return Math.max(0, now.getTime() - value);
}

function padRight(value: string, length: number): string {
  return value.padEnd(length, " ");
}

function resolvePhaseIndex(dispatcher: DispatcherSnapshot, phase: string | null): number {
  if (phase === null) return Number.MAX_SAFE_INTEGER;
  const index = dispatcher.phaseOrder.indexOf(phase);
  return index === -1 ? Number.MAX_SAFE_INTEGER - 1 : index;
}

function truncate(value: string, width: number): string {
  return value.length > width ? `${value.slice(0, width - 1)}…` : value;
}

function uniquePhasesFromStates(states: Record<string, DispatcherDefinitionState>): string[] {
  return [...new Set(
    Object.values(states)
      .map((state) => state.phase)
      .filter((value): value is string => typeof value === "string" && value.length > 0),
  )];
}
