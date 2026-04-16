import type { DashboardSnapshot, DispatcherSnapshot } from "./feed/types.ts";

export interface DispatcherCardView {
  name: string;
  state: DispatcherSnapshot["state"];
  detail: string;
  moduleLine: string;
  queueLine: string;
  tickLine: string;
  countsLine: string;
  recentLine: string;
  errorLine: string | null;
  telemetryLine: string;
  itemLines: string[];
}

export interface DashboardViewModel {
  title: string;
  subtitle: string;
  generatedAtLabel: string;
  rootCount: number;
  dispatcherCount: number;
  dispatchers: DispatcherCardView[];
}

export function buildDashboardViewModel(snapshot: DashboardSnapshot): DashboardViewModel {
  return {
    title: "Delamain Dashboard",
    subtitle: snapshot.systemRoot,
    generatedAtLabel: formatTimestamp(snapshot.generatedAt),
    rootCount: snapshot.roots.length,
    dispatcherCount: snapshot.dispatcherCount,
    dispatchers: snapshot.dispatchers.map((dispatcher) => buildDispatcherCard(dispatcher)),
  };
}

export function buildDispatcherCard(dispatcher: DispatcherSnapshot): DispatcherCardView {
  return {
    name: dispatcher.name,
    state: dispatcher.state,
    detail: dispatcher.detail,
    moduleLine:
      dispatcher.moduleId
        ? `${dispatcher.moduleId} • ${dispatcher.entityName ?? "entity"} • ${dispatcher.entityPath ?? "unknown path"}`
        : "Runtime manifest unavailable",
    queueLine:
      `${dispatcher.activeDispatches} active • ${dispatcher.itemSummary.totalItems} tracked • ${dispatcher.itemsScanned} scanned`,
    tickLine:
      dispatcher.lastTickAgeMs === null
        ? "No heartbeat age available"
        : `Last tick ${formatAge(dispatcher.lastTickAgeMs)} ago • poll ${formatDuration(dispatcher.pollMs)}`,
    countsLine:
      formatStateSummary(dispatcher.itemSummary.byState),
    recentLine:
      dispatcher.recentRun
        ? buildRecentRunLine(dispatcher)
        : dispatcher.telemetry.legacyMode
          ? "Legacy dispatcher — recent history unavailable"
          : "No recent dispatch telemetry recorded",
    errorLine:
      dispatcher.recentError
        ? `Recent error • ${dispatcher.recentError.itemId} • ${truncate(dispatcher.recentError.error, 96)}`
        : null,
    telemetryLine:
      dispatcher.telemetry.legacyMode
        ? "Telemetry file missing — heartbeat-only mode"
        : `Telemetry live • ${dispatcher.recentEvents.length} recent events`,
    itemLines:
      dispatcher.items.slice(0, 5).map((item) => `${item.id} • ${item.status} • ${item.type}`),
  };
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
  return `$${value.toFixed(4)}`;
}

export function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? timestamp : date.toLocaleString("en-US", {
    hour12: false,
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function buildRecentRunLine(dispatcher: DispatcherSnapshot): string {
  const run = dispatcher.recentRun!;
  const base = `${run.outcome === "success" ? "Recent success" : "Recent failure"} • ${run.itemId} • ${run.state}`;
  const timing = run.durationMs === null ? "n/a" : formatDuration(run.durationMs);
  const turns = run.numTurns === null ? "n/a" : `${run.numTurns} turns`;
  return `${base} • ${timing} • ${turns} • ${formatCurrency(run.costUsd)}`;
}

function formatStateSummary(byState: Record<string, number>): string {
  const entries = Object.entries(byState).sort((left, right) => left[0].localeCompare(right[0]));
  if (entries.length === 0) return "No tracked items";
  return entries.map(([state, count]) => `${state} ${count}`).join(" • ");
}

function truncate(value: string, width: number): string {
  return value.length > width ? `${value.slice(0, width - 1)}…` : value;
}
