import type { BaseRenderable } from "@opentui/core";

export type LayoutMode = "compact" | "standard" | "wide";

export interface ViewportSize {
  height: number;
  width: number;
}

export function clearChildren(parent: { getChildren(): BaseRenderable[] }): void {
  for (const child of [...parent.getChildren()]) {
    child.destroy();
  }
}

export function clampIndex(index: number, itemCount: number): number {
  if (itemCount <= 0) return 0;
  return Math.max(0, Math.min(index, itemCount - 1));
}

export function compactText(value: string, width: number): string {
  if (value.length <= width) return value;
  if (width <= 1) return value.slice(0, width);
  return `${value.slice(0, width - 1)}…`;
}

export function renderSeparator(width: number): string {
  return "─".repeat(Math.max(12, width));
}

export function resolveLayoutMode(viewport: ViewportSize): LayoutMode {
  if (viewport.width < 60 || viewport.height < 18) {
    return "compact";
  }

  if (viewport.width >= 100 && viewport.height >= 24) {
    return "wide";
  }

  return "standard";
}

export function viewportOf(renderer: { width: number; height: number }): ViewportSize {
  return {
    height: Math.max(8, renderer.height),
    width: Math.max(24, renderer.width),
  };
}
