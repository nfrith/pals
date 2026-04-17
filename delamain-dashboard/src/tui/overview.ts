import { BoxRenderable, ScrollBoxRenderable, TextRenderable, bold, fg, t, type CliRenderer } from "@opentui/core";
import type { DashboardViewModel, DispatcherViewModel } from "../view-model.ts";
import { fitLine, overviewCardContentWidth, type LayoutMode, type ViewportSize } from "./layout.ts";
import { TUI_THEME, badgeText, stateBorderColor, stateColor } from "./theme.ts";

export interface OverviewRenderResult {
  scrollBox: ScrollBoxRenderable;
  selectedCardId: string | null;
}

export function mountOverviewView(
  renderer: CliRenderer,
  parent: BoxRenderable,
  view: DashboardViewModel,
  layoutMode: LayoutMode,
  viewport: ViewportSize,
  selectedDispatcherIndex: number,
): OverviewRenderResult {
  const lineWidth = overviewCardContentWidth(viewport, layoutMode);
  const scrollBox = new ScrollBoxRenderable(renderer, {
    flexGrow: 1,
    height: "100%",
    width: "100%",
    scrollY: true,
    rootOptions: {
      backgroundColor: TUI_THEME.background,
    },
    viewportOptions: {
      backgroundColor: TUI_THEME.background,
    },
    contentOptions: layoutMode === "wide"
      ? {
        backgroundColor: TUI_THEME.background,
        columnGap: 1,
        flexDirection: "row",
        flexWrap: "wrap",
        rowGap: 0,
        width: "100%",
      }
      : {
        backgroundColor: TUI_THEME.background,
        flexDirection: "column",
        rowGap: 0,
        width: "100%",
      },
  });
  parent.add(scrollBox);

  let selectedCardId: string | null = null;

  view.dispatchers.forEach((dispatcher, index) => {
    const selected = index === selectedDispatcherIndex;
    const cardId = `dispatcher-card-${index}`;
    if (selected) {
      selectedCardId = cardId;
    }

    const card = new BoxRenderable(renderer, {
      id: cardId,
      backgroundColor: selected
        ? TUI_THEME.cardSelected
        : dispatcher.activeDispatches.length > 0
          ? TUI_THEME.cardActive
          : TUI_THEME.card,
      border: true,
      borderColor: selected ? TUI_THEME.accent : stateBorderColor(dispatcher.state),
      flexDirection: "column",
      minHeight: 7,
      paddingLeft: 1,
      paddingRight: 1,
      width: layoutMode === "wide" ? "49%" : "100%",
    });
    scrollBox.content.add(card);

    card.add(new TextRenderable(renderer, {
      content: buildTitleLine(dispatcher, selected, lineWidth),
      fg: TUI_THEME.text,
      height: 1,
      width: "100%",
      wrapMode: "none",
    }));
    card.add(new TextRenderable(renderer, {
      content: buildMetaLine(dispatcher, layoutMode, lineWidth),
      fg: TUI_THEME.muted,
      height: 1,
      width: "100%",
      wrapMode: "none",
    }));
    card.add(new TextRenderable(renderer, {
      content: buildQueueLine(dispatcher, layoutMode, lineWidth),
      fg: TUI_THEME.text,
      height: 1,
      width: "100%",
      wrapMode: "none",
    }));
    card.add(new TextRenderable(renderer, {
      content: dispatcher.activeDispatches.length > 0
        ? buildActiveLine(dispatcher, layoutMode, lineWidth)
        : buildPipelineLine(dispatcher, layoutMode, lineWidth),
      fg: dispatcher.activeDispatches.length > 0 ? TUI_THEME.live : TUI_THEME.text,
      height: 1,
      width: "100%",
      wrapMode: "none",
    }));
    card.add(new TextRenderable(renderer, {
      content: buildSpendLine(dispatcher, layoutMode, lineWidth),
      fg: TUI_THEME.muted,
      height: 1,
      width: "100%",
      wrapMode: "none",
    }));
  });

  if (selectedCardId) {
    scrollBox.scrollChildIntoView(selectedCardId);
  }

  return {
    scrollBox,
    selectedCardId,
  };
}

function buildActiveLine(dispatcher: DispatcherViewModel, layoutMode: LayoutMode, lineWidth: number): string {
  if (layoutMode === "compact") {
    return fitLine(dispatcher.activeDispatches[0]?.compactLine ?? dispatcher.activeLine, lineWidth);
  }

  return fitLine(dispatcher.activeLine, lineWidth);
}

function buildMetaLine(dispatcher: DispatcherViewModel, layoutMode: LayoutMode, lineWidth: number): string {
  if (layoutMode === "compact") {
    return fitLine(`${dispatcher.module.moduleId ?? "module?"} • ${dispatcher.heartbeat.ageLabel} hb`, lineWidth);
  }

  return fitLine(`${dispatcher.module.moduleId ?? "module?"} • ${dispatcher.heartbeat.tickLine}`, lineWidth);
}

function buildPipelineLine(dispatcher: DispatcherViewModel, layoutMode: LayoutMode, lineWidth: number): string {
  return fitLine(layoutMode === "compact" ? dispatcher.pipelineCompactLine : dispatcher.pipelineLine, lineWidth);
}

function buildQueueLine(dispatcher: DispatcherViewModel, layoutMode: LayoutMode, lineWidth: number): string {
  if (layoutMode === "compact") {
    return fitLine(`${dispatcher.queue.trackedCount} tracked • ${dispatcher.queue.activeCount} active`, lineWidth);
  }

  return fitLine(dispatcher.queueLine, lineWidth);
}

function buildSpendLine(dispatcher: DispatcherViewModel, _layoutMode: LayoutMode, lineWidth: number): string {
  return fitLine(`${dispatcher.spend.line} • ${dispatcher.detail}`, lineWidth);
}

function buildTitleLine(dispatcher: DispatcherViewModel, selected: boolean, lineWidth: number) {
  const badge = `[${badgeText(dispatcher.state)}]`;
  const nameWidth = Math.max(4, lineWidth - badge.length - 1);
  const name = fitLine(dispatcher.name, nameWidth);
  return t`${fg(stateColor(dispatcher.state))(bold(badge))} ${selected ? fg(TUI_THEME.accent)(bold(name)) : fg(TUI_THEME.text)(bold(name))}`;
}
