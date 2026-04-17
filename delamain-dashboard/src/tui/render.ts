import {
  BoxRenderable,
  TextRenderable,
  type CliRenderer,
  type SelectRenderable,
} from "@opentui/core";
import type { DashboardViewModel, DispatcherViewModel } from "../view-model.ts";
import { mountDetailView } from "./detail.ts";
import { clearChildren, renderSeparator, resolveLayoutMode, viewportOf, type LayoutMode } from "./layout.ts";
import { mountOverviewView } from "./overview.ts";
import { TUI_THEME } from "./theme.ts";

export type DashboardTuiViewMode = "detail" | "overview";

export interface DashboardTuiSceneState {
  detailItemIndex: number;
  errorMessage: string | null;
  selectedDispatcherIndex: number;
  serviceUrl: string;
  viewMode: DashboardTuiViewMode;
}

export interface DashboardTuiSceneResult {
  detailList: SelectRenderable | null;
  layoutMode: LayoutMode;
}

export function renderDashboardTuiScene(
  renderer: CliRenderer,
  view: DashboardViewModel | null,
  sceneState: DashboardTuiSceneState,
): DashboardTuiSceneResult {
  const viewport = viewportOf(renderer);
  const layoutMode = resolveLayoutMode(viewport);
  clearChildren(renderer.root);

  const root = new BoxRenderable(renderer, {
    backgroundColor: TUI_THEME.background,
    flexDirection: "column",
    gap: 0,
    height: "100%",
    width: "100%",
  });
  renderer.root.add(root);

  const selectedDispatcher = view?.dispatchers[sceneState.selectedDispatcherIndex] ?? null;
  const effectiveViewMode = sceneState.viewMode === "detail" && selectedDispatcher ? "detail" : "overview";

  root.add(new TextRenderable(renderer, {
    content: buildHeader(view, selectedDispatcher, effectiveViewMode),
    fg: TUI_THEME.accent,
    height: 1,
    width: "100%",
    wrapMode: "none",
  }));

  root.add(new TextRenderable(renderer, {
    content: buildSubheader(view, selectedDispatcher, effectiveViewMode, sceneState.errorMessage, layoutMode),
    fg: TUI_THEME.muted,
    height: 1,
    width: "100%",
    wrapMode: "none",
  }));

  root.add(new TextRenderable(renderer, {
    content: renderSeparator(viewport.width),
    fg: TUI_THEME.border,
    height: 1,
    width: "100%",
    wrapMode: "none",
  }));

  const contentHost = new BoxRenderable(renderer, {
    backgroundColor: TUI_THEME.background,
    flexDirection: "column",
    flexGrow: 1,
    width: "100%",
  });
  root.add(contentHost);

  let detailList: SelectRenderable | null = null;

  if (!view) {
    contentHost.add(new TextRenderable(renderer, {
      content: sceneState.errorMessage ?? "Loading snapshot…",
      fg: TUI_THEME.text,
      width: "100%",
      wrapMode: "word",
    }));
  } else if (effectiveViewMode === "overview") {
    mountOverviewView(renderer, contentHost, view, layoutMode, sceneState.selectedDispatcherIndex);
  } else if (selectedDispatcher) {
    detailList = mountDetailView(
      renderer,
      contentHost,
      selectedDispatcher,
      layoutMode,
      sceneState.detailItemIndex,
    ).itemList;
  }

  root.add(new TextRenderable(renderer, {
    content: renderSeparator(viewport.width),
    fg: TUI_THEME.border,
    height: 1,
    width: "100%",
    wrapMode: "none",
  }));

  root.add(new TextRenderable(renderer, {
    content: buildFooter(effectiveViewMode, sceneState.serviceUrl, layoutMode),
    fg: TUI_THEME.muted,
    height: 1,
    width: "100%",
    wrapMode: "word",
  }));

  return {
    detailList,
    layoutMode,
  };
}

function buildFooter(viewMode: DashboardTuiViewMode, serviceUrl: string, layoutMode: LayoutMode): string {
  const suffix = layoutMode === "compact" ? "" : ` • ${serviceUrl}`;
  if (viewMode === "detail") {
    return `j/k items • Esc back • r refresh • q quit${suffix}`;
  }

  return `j/k move • Enter detail • r refresh • q quit${suffix}`;
}

function buildHeader(
  view: DashboardViewModel | null,
  dispatcher: DispatcherViewModel | null,
  viewMode: DashboardTuiViewMode,
): string {
  if (!view) {
    return "Delamain Dashboard";
  }

  if (viewMode === "detail" && dispatcher) {
    return `Delamain Dashboard • ${dispatcher.name}`;
  }

  return `Delamain Dashboard • overview • ${view.dispatcherCount} dispatchers`;
}

function buildSubheader(
  view: DashboardViewModel | null,
  dispatcher: DispatcherViewModel | null,
  viewMode: DashboardTuiViewMode,
  errorMessage: string | null,
  layoutMode: LayoutMode,
): string {
  if (!view) {
    return errorMessage ?? "Waiting for snapshot";
  }

  const base = viewMode === "detail" && dispatcher
    ? layoutMode === "compact"
      ? `${dispatcher.stateBadge} • ${dispatcher.module.moduleId ?? "module?"} • HB ${dispatcher.heartbeat.ageLabel} • $${dispatcher.spend.sessionUsd.toFixed(2)}`
      : `${dispatcher.stateBadge} • ${dispatcher.module.moduleId ?? "module?"} • ${dispatcher.heartbeat.tickLine} • ${dispatcher.spend.line}`
    : layoutMode === "compact"
      ? `${view.summary.stateSummaryLine} • ${view.summary.totalSpendLabel}`
      : `${view.summary.stateSummaryLine} • spend ${view.summary.totalSpendLabel} • ${view.summary.activeDispatchCount} active • updated ${view.generatedAtLabel}`;

  return errorMessage ? `${base} • ERR ${errorMessage}` : base;
}
