import { BoxRenderable, ScrollBoxRenderable, TextRenderable, bold, fg, t, type CliRenderer } from "@opentui/core";
import type { DashboardViewModel, DispatcherViewModel } from "../view-model.ts";
import { compactText } from "./layout.ts";
import type { LayoutMode } from "./layout.ts";
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
  selectedDispatcherIndex: number,
): OverviewRenderResult {
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
        rowGap: 1,
        width: "100%",
      }
      : {
        backgroundColor: TUI_THEME.background,
        flexDirection: "column",
        rowGap: 1,
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
      minHeight: layoutMode === "compact" ? 6 : 7,
      padding: 1,
      width: layoutMode === "wide" ? "49%" : "100%",
    });
    scrollBox.content.add(card);

    card.add(new TextRenderable(renderer, {
      content: buildTitleLine(dispatcher, selected),
      fg: TUI_THEME.text,
      width: "100%",
      wrapMode: "word",
    }));
    card.add(new TextRenderable(renderer, {
      content: buildMetaLine(dispatcher, layoutMode),
      fg: TUI_THEME.muted,
      width: "100%",
      wrapMode: "word",
    }));
    card.add(new TextRenderable(renderer, {
      content: buildQueueLine(dispatcher, layoutMode),
      fg: TUI_THEME.text,
      width: "100%",
      wrapMode: "word",
    }));
    card.add(new TextRenderable(renderer, {
      content: dispatcher.activeDispatches.length > 0
        ? buildActiveLine(dispatcher, layoutMode)
        : buildPipelineLine(dispatcher, layoutMode),
      fg: dispatcher.activeDispatches.length > 0 ? TUI_THEME.live : TUI_THEME.text,
      width: "100%",
      wrapMode: "word",
    }));
    card.add(new TextRenderable(renderer, {
      content: buildSpendLine(dispatcher, layoutMode),
      fg: TUI_THEME.muted,
      width: "100%",
      wrapMode: "word",
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

function buildActiveLine(dispatcher: DispatcherViewModel, layoutMode: LayoutMode): string {
  if (layoutMode === "compact") {
    return dispatcher.activeDispatches[0]?.compactLine ?? dispatcher.activeLine;
  }

  return dispatcher.activeLine;
}

function buildMetaLine(dispatcher: DispatcherViewModel, layoutMode: LayoutMode): string {
  if (layoutMode === "compact") {
    return compactText(`${dispatcher.module.moduleId ?? "module?"} • ${dispatcher.heartbeat.ageLabel} hb`, 40);
  }

  return `${dispatcher.module.moduleId ?? "module?"} • ${dispatcher.heartbeat.tickLine}`;
}

function buildPipelineLine(dispatcher: DispatcherViewModel, layoutMode: LayoutMode): string {
  return layoutMode === "compact" ? dispatcher.pipelineCompactLine : dispatcher.pipelineLine;
}

function buildQueueLine(dispatcher: DispatcherViewModel, layoutMode: LayoutMode): string {
  if (layoutMode === "compact") {
    return `${dispatcher.queue.trackedCount} tracked • ${dispatcher.queue.activeCount} active`;
  }

  return dispatcher.queueLine;
}

function buildSpendLine(dispatcher: DispatcherViewModel, layoutMode: LayoutMode): string {
  if (layoutMode === "compact") {
    return `${dispatcher.spend.line} • ${dispatcher.detail}`;
  }

  return `${dispatcher.spend.line} • ${dispatcher.detail}`;
}

function buildTitleLine(dispatcher: DispatcherViewModel, selected: boolean) {
  return t`${fg(stateColor(dispatcher.state))(bold(`[${badgeText(dispatcher.state)}]`))} ${selected ? fg(TUI_THEME.accent)(bold(dispatcher.name)) : fg(TUI_THEME.text)(bold(dispatcher.name))}`;
}
