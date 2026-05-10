import type { DispatchTelemetryEvent } from "../../delamain-dispatcher/src/telemetry.ts";
import type { RuntimeDispatchRecord } from "../../delamain-dispatcher/src/runtime-state.ts";
import type {
  DispatcherCustomerBucket,
  DispatcherDefinitionState,
  DispatcherItemRecord,
  DispatcherSnapshot,
  DispatcherTerminalOutcome,
} from "./feed/types.ts";

const CONTRACT_PULSE_WINDOW_MS = 15 * 60_000;
const RECENT_ADVANCE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export interface CustomerJourneyProjection {
  available: boolean;
  errorMessage: string | null;
  phases: CustomerJourneyPhaseCard[];
  phaseDetail: CustomerJourneyPhaseDetail | null;
  selectedPhase: string | null;
}

export interface CustomerJourneyPhaseCard {
  phase: string;
  label: string;
  activeCount: number;
  waitingCount: number;
  closedCounts: Record<DispatcherTerminalOutcome, number>;
  live: boolean;
  needsAttention: boolean;
  recentTransition: boolean;
  selected: boolean;
}

export interface CustomerJourneyPhaseDetail {
  phase: string;
  label: string;
  waitingRows: CustomerJourneyRow[];
  activeRows: CustomerJourneyActiveRow[];
  recentRows: CustomerJourneyRecentRow[];
}

export interface CustomerJourneyRow {
  itemId: string;
  title: string;
  stateLabel: string;
  timestampLabel: string;
  actionLabel: string;
}

export interface CustomerJourneyActiveRow extends CustomerJourneyRow {
  progressLabel: string;
}

export interface CustomerJourneyRecentRow {
  itemId: string;
  title: string;
  transitionLabel: string;
  timestampLabel: string;
  outcomeIcon: string | null;
}

interface CustomerProjectionOptions {
  now?: Date;
  selectedPhase?: string | null;
}

interface StateContract {
  bucket: DispatcherCustomerBucket;
  definition: DispatcherDefinitionState;
  label: string;
  outcome: DispatcherTerminalOutcome | null;
  phase: string;
}

interface PhaseTransitionSignal {
  fromPhase: string;
  toPhase: string;
  timestamp: number;
}

export function buildCustomerJourneyProjection(
  dispatcher: DispatcherSnapshot,
  options: CustomerProjectionOptions = {},
): CustomerJourneyProjection {
  const now = options.now ?? new Date();
  const phaseOrder = resolvePhaseOrder(dispatcher);
  const stateContracts = resolveStateContracts(dispatcher);

  if (!stateContracts.ok) {
    return {
      available: false,
      errorMessage: "Customer view is unavailable until this Delamain is redeployed with ALS-091 v4 state metadata.",
      phases: phaseOrder.map((phase) => emptyPhaseCard(phase, phase === options.selectedPhase)),
      phaseDetail: null,
      selectedPhase: options.selectedPhase ?? null,
    };
  }

  const runtimeByItemId = new Map<string, RuntimeDispatchRecord>(
    flattenRuntime(dispatcher).map((record) => [record.item_id, record]),
  );
  const activeRuntimeItemIds = new Set(
    dispatcher.runtime.active.map((record) => record.item_id),
  );
  const phaseSignals = buildRecentPhaseSignals(dispatcher, stateContracts.value, now);
  const selectedPhase = options.selectedPhase ?? null;
  const phaseDetails = buildPhaseDetails(
    dispatcher,
    stateContracts.value,
    runtimeByItemId,
    now,
  );

  return {
    available: true,
    errorMessage: null,
    phases: phaseOrder.map((phase) => {
      const detail = phaseDetails.get(phase) ?? emptyPhaseDetail(phase);
      const counts = summarizePhaseCounts(detail, dispatcher.items, stateContracts.value, activeRuntimeItemIds);
      return {
        phase,
        label: formatPhaseLabel(phase),
        activeCount: counts.activeCount,
        waitingCount: counts.waitingCount,
        closedCounts: counts.closedCounts,
        live: counts.live,
        needsAttention: counts.waitingCount > 0,
        recentTransition: phaseSignals.some((signal) => signal.fromPhase === phase || signal.toPhase === phase),
        selected: phase === selectedPhase,
      };
    }),
    phaseDetail: selectedPhase ? phaseDetails.get(selectedPhase) ?? null : null,
    selectedPhase,
  };
}

function resolveStateContracts(dispatcher: DispatcherSnapshot):
  | { ok: true; value: Map<string, StateContract> }
  | { ok: false } {
  const contracts = new Map<string, StateContract>();

  for (const [stateName, definition] of Object.entries(dispatcher.states)) {
    if (!definition.label || !definition.customerBucket) {
      return { ok: false };
    }

    if (
      definition.terminal
      && definition.outcome !== "success"
      && definition.outcome !== "stopped"
      && definition.outcome !== "errored"
    ) {
      return { ok: false };
    }

    contracts.set(stateName, {
      bucket: definition.customerBucket,
      definition,
      label: definition.label,
      outcome: definition.outcome ?? null,
      phase: normalizePhase(definition.phase),
    });
  }

  return { ok: true, value: contracts };
}

function buildPhaseDetails(
  dispatcher: DispatcherSnapshot,
  stateContracts: Map<string, StateContract>,
  runtimeByItemId: Map<string, RuntimeDispatchRecord>,
  now: Date,
): Map<string, CustomerJourneyPhaseDetail> {
  const phaseDetails = new Map<string, CustomerJourneyPhaseDetail>();
  const itemsById = new Map(dispatcher.items.map((item) => [item.id, item]));

  for (const phase of resolvePhaseOrder(dispatcher)) {
    const waitingRows: Array<{ sortMs: number; row: CustomerJourneyRow }> = [];
    const activeRows: Array<{ sortMs: number; row: CustomerJourneyActiveRow }> = [];

    for (const item of dispatcher.items) {
      const state = stateContracts.get(item.status);
      if (!state || state.phase !== phase) continue;

      if (state.bucket === "waiting_for_user") {
        const timestamp = bestAvailableWaitingTimestamp(item, runtimeByItemId.get(item.id));
        waitingRows.push({
          sortMs: timestamp ? parseTimestamp(timestamp) ?? 0 : 0,
          row: {
            itemId: item.id,
            title: bestTitle(item),
            stateLabel: state.label,
            timestampLabel: timestamp ? `${formatAge(now, timestamp)} waiting` : "time unavailable",
            actionLabel: waitingActionLabel(state.label),
          },
        });
      }

      if (state.bucket === "active") {
        const runtime = runtimeByItemId.get(item.id);
        activeRows.push({
          sortMs: runtime ? parseTimestamp(runtime.started_at) ?? 0 : 0,
          row: {
            itemId: item.id,
            title: bestTitle(item),
            stateLabel: state.label,
            timestampLabel: runtime?.started_at ? startedLabel(now, runtime.started_at) : "time unavailable",
            actionLabel: "Track item",
            progressLabel: "In progress",
          },
        });
      }
    }

    const recentRows = buildRecentRowsForPhase(
      dispatcher.recentEvents,
      itemsById,
      stateContracts,
      phase,
      now,
    );

    phaseDetails.set(phase, {
      phase,
      label: formatPhaseLabel(phase),
      waitingRows: waitingRows
        .sort((left, right) => left.sortMs - right.sortMs)
        .map((entry) => entry.row),
      activeRows: activeRows
        .sort((left, right) => left.sortMs - right.sortMs)
        .map((entry) => entry.row),
      recentRows,
    });
  }

  return phaseDetails;
}

function buildRecentRowsForPhase(
  events: DispatchTelemetryEvent[],
  itemsById: Map<string, DispatcherItemRecord>,
  stateContracts: Map<string, StateContract>,
  phase: string,
  now: Date,
): CustomerJourneyRecentRow[] {
  const lowerBound = now.getTime() - RECENT_ADVANCE_WINDOW_MS;
  const rows: Array<{ sortMs: number; row: CustomerJourneyRecentRow }> = [];
  const phaseHasClosedBuckets = Array.from(stateContracts.values()).some(
    (state) => state.phase === phase && state.bucket.startsWith("closed_"),
  );

  for (const event of events) {
    const eventMs = parseTimestamp(event.timestamp);
    if (eventMs === null || eventMs < lowerBound) continue;

    const sourceState = stateContracts.get(event.state);
    if (!sourceState) continue;

    if (phaseHasClosedBuckets) {
      for (const targetStateName of event.transition_targets) {
        const targetState = stateContracts.get(targetStateName);
        if (!targetState || targetState.phase !== phase || !targetState.bucket.startsWith("closed_")) {
          continue;
        }

        rows.push({
          sortMs: eventMs,
          row: {
            itemId: event.item_id,
            title: bestTitle(itemsById.get(event.item_id)),
            transitionLabel: `→ ${formatPhaseLabel(targetState.phase)}`,
            timestampLabel: formatAge(now, event.timestamp),
            outcomeIcon: outcomeIcon(targetState.outcome),
          },
        });
      }
      continue;
    }

    if (sourceState.phase !== phase) continue;

    for (const targetStateName of event.transition_targets) {
      const targetState = stateContracts.get(targetStateName);
      if (!targetState || targetState.phase === phase) continue;

      rows.push({
        sortMs: eventMs,
        row: {
          itemId: event.item_id,
          title: bestTitle(itemsById.get(event.item_id)),
          transitionLabel: `→ ${formatPhaseLabel(targetState.phase)}`,
          timestampLabel: formatAge(now, event.timestamp),
          outcomeIcon: targetState.bucket.startsWith("closed_") ? outcomeIcon(targetState.outcome) : null,
        },
      });
    }
  }

  return rows
    .sort((left, right) => right.sortMs - left.sortMs)
    .map((entry) => entry.row);
}

function summarizePhaseCounts(
  detail: CustomerJourneyPhaseDetail,
  items: DispatcherItemRecord[],
  stateContracts: Map<string, StateContract>,
  activeRuntimeItemIds: Set<string>,
): {
  activeCount: number;
  waitingCount: number;
  closedCounts: Record<DispatcherTerminalOutcome, number>;
  live: boolean;
} {
  const closedCounts = {
    success: 0,
    stopped: 0,
    errored: 0,
  } satisfies Record<DispatcherTerminalOutcome, number>;
  let activeCount = 0;
  let waitingCount = 0;
  let live = false;

  for (const item of items) {
    const state = stateContracts.get(item.status);
    if (!state || state.phase !== detail.phase) continue;

    if (state.bucket === "active") {
      activeCount += 1;
    } else if (state.bucket === "waiting_for_user") {
      waitingCount += 1;
    } else if (state.outcome) {
      closedCounts[state.outcome] += 1;
    }

    if (activeRuntimeItemIds.has(item.id)) {
      live = true;
    }
  }

  return { activeCount, waitingCount, closedCounts, live };
}

function buildRecentPhaseSignals(
  dispatcher: DispatcherSnapshot,
  stateContracts: Map<string, StateContract>,
  now: Date,
): PhaseTransitionSignal[] {
  const lowerBound = now.getTime() - CONTRACT_PULSE_WINDOW_MS;
  const signals: PhaseTransitionSignal[] = [];

  for (const event of dispatcher.recentEvents) {
    const eventMs = parseTimestamp(event.timestamp);
    if (eventMs === null || eventMs < lowerBound) continue;

    const sourceState = stateContracts.get(event.state);
    if (!sourceState) continue;

    for (const targetName of event.transition_targets) {
      const targetState = stateContracts.get(targetName);
      if (!targetState || targetState.phase === sourceState.phase) continue;
      signals.push({
        fromPhase: sourceState.phase,
        toPhase: targetState.phase,
        timestamp: eventMs,
      });
    }
  }

  return signals;
}

function flattenRuntime(dispatcher: DispatcherSnapshot): RuntimeDispatchRecord[] {
  return [
    ...dispatcher.runtime.active,
    ...dispatcher.runtime.guarded,
    ...dispatcher.runtime.blocked,
    ...dispatcher.runtime.orphaned,
  ];
}

function bestAvailableWaitingTimestamp(
  item: DispatcherItemRecord,
  runtime: RuntimeDispatchRecord | undefined,
): string | null {
  return item.updated ?? runtime?.updated_at ?? null;
}

function startedLabel(now: Date, timestamp: string): string {
  return `started ${formatAge(now, timestamp)} ago`;
}

function bestTitle(item: DispatcherItemRecord | undefined): string {
  if (!item) return "Unknown item";
  return item.title?.trim() || item.id;
}

function waitingActionLabel(label: string): string {
  const normalized = label.toLowerCase();
  if (normalized.includes("question") || normalized.includes("answer")) {
    return "Answer now";
  }
  if (normalized.includes("review") || normalized.includes("approve") || normalized.includes("plan")) {
    return "Review now";
  }
  return "Open item";
}

function outcomeIcon(outcome: DispatcherTerminalOutcome | null): string | null {
  if (outcome === "success") return "✓";
  if (outcome === "stopped") return "⊘";
  if (outcome === "errored") return "⚠";
  return null;
}

function resolvePhaseOrder(dispatcher: DispatcherSnapshot): string[] {
  const seen = new Set<string>();
  const phases: string[] = [];

  for (const phase of dispatcher.phaseOrder) {
    const normalized = normalizePhase(phase);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    phases.push(normalized);
  }

  for (const definition of Object.values(dispatcher.states)) {
    const normalized = normalizePhase(definition.phase);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    phases.push(normalized);
  }

  return phases;
}

function emptyPhaseCard(phase: string, selected: boolean): CustomerJourneyPhaseCard {
  return {
    phase,
    label: formatPhaseLabel(phase),
    activeCount: 0,
    waitingCount: 0,
    closedCounts: {
      success: 0,
      stopped: 0,
      errored: 0,
    },
    live: false,
    needsAttention: false,
    recentTransition: false,
    selected,
  };
}

function emptyPhaseDetail(phase: string): CustomerJourneyPhaseDetail {
  return {
    phase,
    label: formatPhaseLabel(phase),
    waitingRows: [],
    activeRows: [],
    recentRows: [],
  };
}

function normalizePhase(phase: string | null | undefined): string {
  return phase?.trim() || "unphased";
}

function formatPhaseLabel(phase: string): string {
  return phase
    .split(/[-_]/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function parseTimestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function formatAge(now: Date, timestamp: string): string {
  const value = parseTimestamp(timestamp);
  if (value === null) return "time unavailable";

  const diffMs = Math.max(0, now.getTime() - value);
  const totalMinutes = Math.floor(diffMs / 60_000);
  const totalHours = Math.floor(diffMs / 3_600_000);
  const totalDays = Math.floor(diffMs / 86_400_000);

  if (totalDays > 0) return `${totalDays}d ago`;
  if (totalHours > 0) return `${totalHours}h ago`;
  if (totalMinutes > 0) return `${totalMinutes}m ago`;
  return "just now";
}
