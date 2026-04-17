import {
  BoxRenderable,
  SelectRenderable,
  TextRenderable,
  type CliRenderer,
} from "@opentui/core";
import type { DispatcherViewModel } from "../view-model.ts";
import type { LayoutMode } from "./layout.ts";
import { TUI_THEME } from "./theme.ts";

export interface DetailRenderResult {
  itemList: SelectRenderable;
}

export function mountDetailView(
  renderer: CliRenderer,
  parent: BoxRenderable,
  dispatcher: DispatcherViewModel,
  layoutMode: LayoutMode,
  selectedItemIndex: number,
): DetailRenderResult {
  const root = new BoxRenderable(renderer, {
    backgroundColor: TUI_THEME.background,
    columnGap: 1,
    flexDirection: "column",
    flexGrow: 1,
    rowGap: 1,
    width: "100%",
  });
  parent.add(root);

  if (layoutMode === "compact") {
    root.add(buildInfoBox(renderer, "Meta", [
      dispatcher.moduleLine,
      `HB ${dispatcher.heartbeat.ageLabel} • ${dispatcher.spend.line}`,
      dispatcher.recentHistory.length > 0 ? `Recent ${dispatcher.recentHistory[0]!.compactLine}` : "Recent n/a",
    ]));
    root.add(buildInfoBox(renderer, "Pipeline", dispatcher.pipeline.verticalLines.slice(0, 4)));
    root.add(buildInfoBox(
      renderer,
      "Active",
      dispatcher.activeDispatches.length > 0
        ? [dispatcher.activeDispatches[0]!.summaryLine]
        : ["Idle • no active dispatch inferred"],
    ));
  } else {
    root.add(buildInfoBox(renderer, "Meta", [
      dispatcher.moduleLine,
      `Mount ${dispatcher.module.moduleMountPath ?? "unknown"} • v${dispatcher.module.moduleVersion ?? "?"}`,
      `HB ${dispatcher.heartbeat.ageLabel} • poll ${dispatcher.heartbeat.pollLabel}`,
      dispatcher.spend.line,
    ]));

    root.add(buildInfoBox(
      renderer,
      "Recent",
      dispatcher.recentHistory.length > 0
        ? dispatcher.recentHistory.slice(0, 3).map((entry) => entry.summaryLine)
        : ["No recent runs"],
    ));

    root.add(buildInfoBox(
      renderer,
      "Pipeline",
      [dispatcher.pipeline.horizontalLine],
    ));

    root.add(buildInfoBox(
      renderer,
      "Active",
      dispatcher.activeDispatches.length > 0
        ? dispatcher.activeDispatches.map((entry) => entry.summaryLine)
        : ["Idle • no active dispatch inferred"],
    ));
  }

  const itemsBox = new BoxRenderable(renderer, {
    backgroundColor: TUI_THEME.card,
    border: true,
    borderColor: TUI_THEME.border,
    flexDirection: "column",
    flexGrow: 1,
    minHeight: layoutMode === "compact" ? 6 : 8,
    title: "Items",
    width: "100%",
  });
  root.add(itemsBox);

  const itemList = new SelectRenderable(renderer, {
    backgroundColor: TUI_THEME.card,
    descriptionColor: TUI_THEME.muted,
    flexGrow: 1,
    focusedBackgroundColor: TUI_THEME.card,
    focusedTextColor: TUI_THEME.text,
    height: "100%",
    itemSpacing: 0,
    options: buildItemOptions(dispatcher),
    selectedBackgroundColor: TUI_THEME.accent,
    selectedDescriptionColor: TUI_THEME.background,
    selectedIndex: selectedItemIndex,
    selectedTextColor: TUI_THEME.background,
    showDescription: layoutMode !== "compact",
    showScrollIndicator: true,
    textColor: TUI_THEME.text,
    width: "100%",
    wrapSelection: false,
  });
  itemsBox.add(itemList);

  return { itemList };
}

function buildInfoBox(
  renderer: CliRenderer,
  title: string,
  lines: string[],
  width: number | `${number}%` | "auto" = "100%",
): BoxRenderable {
  const box = new BoxRenderable(renderer, {
    backgroundColor: TUI_THEME.card,
    border: true,
    borderColor: TUI_THEME.border,
    flexDirection: "column",
    minHeight: Math.max(4, lines.length + 4),
    padding: 1,
    rowGap: 0,
    title,
    width,
  });

  for (const line of lines) {
    box.add(new TextRenderable(renderer, {
      content: line,
      fg: TUI_THEME.text,
      height: 1,
      width: "100%",
      wrapMode: "word",
    }));
  }

  return box;
}

function buildItemOptions(dispatcher: DispatcherViewModel): { description: string; name: string }[] {
  const options: { description: string; name: string }[] = [];

  for (const group of dispatcher.itemGroups) {
    options.push({
      name: `[${group.state}] ${group.count}`,
      description: group.phase ?? "unmapped",
    });

    for (const item of group.items) {
      options.push({
        name: `  ${item.listName}`,
        description: item.listDescription,
      });
    }
  }

  return options.length > 0
    ? options
    : [{
      name: "No tracked items",
      description: dispatcher.detail,
    }];
}
