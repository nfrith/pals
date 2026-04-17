import { expect, test } from "bun:test";
import { createTestRenderer } from "@opentui/core/testing";
import { createDesignDashboardSnapshot } from "../test-fixtures.ts";
import { buildDashboardViewModel } from "../view-model.ts";
import { reduceDashboardTuiState } from "./app.ts";
import { resolveLayoutMode } from "./layout.ts";
import { renderDashboardTuiScene } from "./render.ts";

test("layout mode selection honors compact, standard, and wide breakpoints", () => {
  expect(resolveLayoutMode({ width: 48, height: 24 })).toBe("compact");
  expect(resolveLayoutMode({ width: 80, height: 20 })).toBe("standard");
  expect(resolveLayoutMode({ width: 120, height: 32 })).toBe("wide");
  expect(resolveLayoutMode({ width: 120, height: 16 })).toBe("compact");
});

test("overview input transitions drill into detail and back out cleanly", () => {
  const base = {
    detailItemIndex: 0,
    selectedDispatcherIndex: 0,
    viewMode: "overview" as const,
  };

  const move = reduceDashboardTuiState(base, "j", 4);
  expect(move.handled).toBe(true);
  expect(move.state.selectedDispatcherIndex).toBe(1);

  const detail = reduceDashboardTuiState(move.state, "\r", 4);
  expect(detail.handled).toBe(true);
  expect(detail.state.viewMode).toBe("detail");

  const back = reduceDashboardTuiState(detail.state, "\u001b", 4);
  expect(back.handled).toBe(true);
  expect(back.state.viewMode).toBe("overview");

  const passthrough = reduceDashboardTuiState(detail.state, "j", 4);
  expect(passthrough.handled).toBe(false);
});

test("scene renderer builds overview and detail frames from the design fixture", async () => {
  const snapshot = createDesignDashboardSnapshot();
  const view = buildDashboardViewModel(snapshot);
  const { renderer, renderOnce, captureCharFrame } = await createTestRenderer({
    width: 120,
    height: 40,
  });

  try {
    renderDashboardTuiScene(renderer, view, {
      detailItemIndex: 0,
      errorMessage: null,
      selectedDispatcherIndex: 0,
      serviceUrl: "http://127.0.0.1:4646",
      viewMode: "overview",
    });
    renderer.requestRender();
    await renderOnce();

    const overviewFrame = captureCharFrame();
    expect(overviewFrame).toContain("overview");
    expect(overviewFrame).toContain("als-factory-jobs");
    expect(overviewFrame).toContain("ghost-factory-jobs");
    expect(overviewFrame).toContain("ALS-006 research");
    expect(overviewFrame).toContain("draft(1) → dev(1)");

    renderDashboardTuiScene(renderer, view, {
      detailItemIndex: 0,
      errorMessage: null,
      selectedDispatcherIndex: 0,
      serviceUrl: "http://127.0.0.1:4646",
      viewMode: "detail",
    });
    renderer.requestRender();
    await renderOnce();

    const detailFrame = captureCharFrame();
    expect(detailFrame).toContain("Meta");
    expect(detailFrame).toContain("Pipeline");
    expect(detailFrame).toContain("Active");
    expect(detailFrame).toContain("Items");
    expect(detailFrame).toContain("ALS-006");
    expect(detailFrame).toContain("[drafted] 3");
  } finally {
    renderer.destroy();
  }
});
