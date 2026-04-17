import { bold, dim, fg, t, type StyledText } from "@opentui/core";
import type { DispatcherLivenessState } from "../feed/types.ts";
import type { DispatcherPhaseView } from "../view-model.ts";

export const TUI_THEME = {
  accent: "#f7b267",
  background: "#081117",
  border: "#23414d",
  card: "#0f1d26",
  cardActive: "#152733",
  cardSelected: "#1b3240",
  error: "#ef6f6c",
  idle: "#8c989f",
  live: "#24b36b",
  muted: "#9db3aa",
  offline: "#b1564f",
  stale: "#d8b14a",
  text: "#eef7f2",
} as const;

export function badgeText(state: DispatcherLivenessState): string {
  switch (state) {
    case "live":
      return "LIVE";
    case "idle":
      return "IDLE";
    case "offline":
      return "OFFLINE";
    case "stale":
      return "STALE";
    case "error":
      return "ERROR";
  }
}

export function phaseColor(phase: DispatcherPhaseView): string {
  if (phase.isActive) return TUI_THEME.live;
  if (phase.isBottleneck) return TUI_THEME.stale;
  if (phase.isTerminal) return TUI_THEME.muted;
  return TUI_THEME.text;
}

export function renderBadge(state: DispatcherLivenessState): StyledText {
  return t`${fg(stateColor(state))(bold(`[${badgeText(state)}]`))}`;
}

export function renderPhaseChunk(phase: DispatcherPhaseView, compact = false): StyledText {
  const label = compact ? phase.compactLabel : phase.label;
  return t`${fg(phaseColor(phase))(`${label}(${phase.count})`)}`;
}

export function renderSubtle(value: string): StyledText {
  return t`${fg(TUI_THEME.muted)(dim(value))}`;
}

export function stateBorderColor(state: DispatcherLivenessState): string {
  return stateColor(state);
}

export function stateColor(state: DispatcherLivenessState): string {
  switch (state) {
    case "live":
      return TUI_THEME.live;
    case "idle":
      return TUI_THEME.idle;
    case "offline":
      return TUI_THEME.offline;
    case "stale":
      return TUI_THEME.stale;
    case "error":
      return TUI_THEME.error;
  }
}
