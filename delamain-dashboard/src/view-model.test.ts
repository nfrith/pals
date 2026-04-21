import { expect, test } from "bun:test";
import { createDesignDashboardSnapshot } from "./test-fixtures.ts";
import {
  buildDashboardViewModel,
  buildDispatcherViewModel,
  buildRecentHistory,
  compactPhaseLabel,
  inferActiveDispatches,
} from "./view-model.ts";

test("dashboard view model derives pipeline, active dispatch, and spend summaries", () => {
  const snapshot = createDesignDashboardSnapshot();
  const view = buildDashboardViewModel(snapshot);
  const liveDispatcher = view.dispatchers.find((dispatcher) => dispatcher.name === "als-factory-jobs");
  const staleDispatcher = view.dispatchers.find((dispatcher) => dispatcher.name === "research-pipeline");

  expect(view.summary.totalSpendUsd).toBeCloseTo(1.20, 2);
  expect(view.summary.totalSpendEventCount).toBe(4);
  expect(view.summary.activeDispatchCount).toBe(1);
  expect(view.summary.stateSummaryLine).toContain("LIVE 1");
  expect(view.summary.stateSummaryLine).toContain("ERROR 1");

  expect(liveDispatcher).toBeDefined();
  expect(liveDispatcher?.activeDispatches).toHaveLength(1);
  expect(liveDispatcher?.activeDispatches[0]?.itemId).toBe("ALS-006");
  expect(liveDispatcher?.activeDispatches[0]?.summaryLine).toContain("cost pending");
  expect(liveDispatcher?.pipeline.bottleneckPhase).toBe("draft");
  expect(liveDispatcher?.pipeline.horizontalLine).toContain("draft(3)");
  expect(liveDispatcher?.pipeline.compactLine).toContain("dft(3)");
  expect(liveDispatcher?.spend.sessionUsd).toBeCloseTo(0.55, 2);
  expect(staleDispatcher?.spend.amountLabel).toBe("n/a");
  expect(staleDispatcher?.spend.line).toContain("no metered runs");
  expect(liveDispatcher?.itemGroups.map((group) => group.state)).toEqual([
    "drafted",
    "research",
    "in-dev",
    "uat",
    "completed",
  ]);
});

test("inferActiveDispatches leaves only unmatched start events", () => {
  const snapshot = createDesignDashboardSnapshot();
  const dispatcher = snapshot.dispatchers[0]!;
  const active = inferActiveDispatches(dispatcher, new Date(snapshot.generatedAt));

  expect(active).toHaveLength(1);
  expect(active[0]?.itemId).toBe("ALS-006");
  expect(active[0]?.phase).toBe("research");
  expect(active[0]?.elapsedMs).toBe(45_000);
});

test("recent history is truncated to the most recent five terminal events", () => {
  const snapshot = createDesignDashboardSnapshot();
  const dispatcher = {
    ...snapshot.dispatchers[1]!,
    recentEvents: Array.from({ length: 7 }, (_, index) => ({
      schema: "als-delamain-telemetry-event@1" as const,
      event_id: `evt-${index}`,
      event_type: "dispatch_finish" as const,
      timestamp: `2026-04-17T10:${String(index).padStart(2, "0")}:00.000Z`,
      dispatcher_name: "ghost-factory-jobs",
      module_id: "ghost-factory",
      dispatch_id: `d-${index}`,
      item_id: `GHOST-${100 + index}`,
      item_file: `/tmp/GHOST-${100 + index}.md`,
      isolated_item_file: `/tmp/.worktrees/GHOST-${100 + index}.md`,
      state: "in-dev",
      agent_name: "in-dev",
      sub_agent_name: null,
      provider: "openai" as const,
      resumable: false,
      resume_requested: false,
      session_field: null,
      runtime_session_id: null,
      resume_session_id: null,
      worker_session_id: `sess-${index}`,
      worktree_path: `/tmp/.worktrees/GHOST-${100 + index}`,
      branch_name: `delamain/ghost-factory-jobs/GHOST-${100 + index}/d-${index}`,
      worktree_commit: null,
      integrated_commit: null,
      merge_outcome: "merged",
      incident_kind: null,
      transition_targets: ["in-review"],
      duration_ms: 1_000 + index,
      num_turns: 3 + index,
      cost_usd: 0.1 + index / 100,
      error: null,
    })),
  };

  const history = buildRecentHistory(dispatcher.recentEvents);

  expect(history).toHaveLength(5);
  expect(history[0]?.itemId).toBe("GHOST-106");
  expect(history[4]?.itemId).toBe("GHOST-102");
});

test("dispatcher-level model keeps compact labels deterministic", () => {
  const snapshot = createDesignDashboardSnapshot();
  const dispatcher = buildDispatcherViewModel(snapshot.dispatchers[2]!, new Date(snapshot.generatedAt));

  expect(compactPhaseLabel("planning")).toBe("pln");
  expect(compactPhaseLabel("implementation")).toBe("impl");
  expect(dispatcher.pipeline.verticalLines[0]).toContain("dft");
  expect(dispatcher.recentLine).toBe("Legacy dispatcher — recent history unavailable");
});
