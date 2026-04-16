import type { DashboardSnapshot } from "../feed/types.ts";
import { buildDashboardViewModel } from "../view-model.ts";

export function renderTuiDocument(snapshot: DashboardSnapshot): string {
  const view = buildDashboardViewModel(snapshot);
  const lines = [
    `${view.title}`,
    `${view.dispatcherCount} dispatchers • ${view.rootCount} roots • updated ${view.generatedAtLabel}`,
    "",
  ];

  for (const dispatcher of view.dispatchers) {
    lines.push(`[${dispatcher.state}] ${dispatcher.name}`);
    lines.push(`  ${dispatcher.detail}`);
    lines.push(`  ${dispatcher.moduleLine}`);
    lines.push(`  ${dispatcher.queueLine}`);
    lines.push(`  ${dispatcher.tickLine}`);
    lines.push(`  ${dispatcher.countsLine}`);
    lines.push(`  ${dispatcher.recentLine}`);
    lines.push(`  ${dispatcher.telemetryLine}`);
    if (dispatcher.errorLine) {
      lines.push(`  ${dispatcher.errorLine}`);
    }
    for (const itemLine of dispatcher.itemLines) {
      lines.push(`  ${itemLine}`);
    }
    lines.push("");
  }

  if (view.dispatchers.length === 0) {
    lines.push("No delamains discovered yet.");
  }

  return lines.join("\n");
}
