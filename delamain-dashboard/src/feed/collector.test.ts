import { expect, test } from "bun:test";
import { createDashboardFixture } from "../test-fixtures.ts";
import { collectSystemSnapshot } from "./collector.ts";

test("collector enriches dispatcher snapshots with runtime metadata and item counts", async () => {
  const fixture = await createDashboardFixture("collector-live");

  try {
    await fixture.appendSuccess("ALS-001");
    const snapshot = await collectSystemSnapshot({
      systemRoot: fixture.root,
      telemetryLimit: 10,
    });

    expect(snapshot.dispatcherCount).toBe(1);
    const dispatcher = snapshot.dispatchers[0]!;
    expect(dispatcher.name).toBe("factory-jobs");
    expect(dispatcher.state).toBe("live");
    expect(dispatcher.moduleId).toBe("factory");
    expect(dispatcher.entityPath).toBe("items/{id}.md");
    expect(dispatcher.itemSummary.totalItems).toBe(2);
    expect(dispatcher.itemSummary.byState["in-dev"]).toBe(1);
    expect(dispatcher.itemSummary.byState["in-review"]).toBe(1);
    expect(dispatcher.telemetry.available).toBe(true);
    expect(dispatcher.recentRun?.outcome).toBe("success");
  } finally {
    await fixture.cleanup();
  }
});

test("collector classifies stale and offline dispatchers from the same heartbeat feed", async () => {
  const fixture = await createDashboardFixture("collector-states");

  try {
    await fixture.writeHeartbeat({
      last_tick: new Date(Date.now() - 120_000).toISOString(),
      poll_ms: 1000,
      active_dispatches: 0,
    });

    let snapshot = await collectSystemSnapshot({
      systemRoot: fixture.root,
      telemetryLimit: 10,
    });
    expect(snapshot.dispatchers[0]?.state).toBe("stale");

    await fixture.writeHeartbeat({
      pid: 2_147_483_647,
      last_tick: new Date().toISOString(),
      active_dispatches: 0,
    });

    snapshot = await collectSystemSnapshot({
      systemRoot: fixture.root,
      telemetryLimit: 10,
    });
    expect(snapshot.dispatchers[0]?.state).toBe("offline");
  } finally {
    await fixture.cleanup();
  }
});

test("collector surfaces telemetry failures in the shared snapshot", async () => {
  const fixture = await createDashboardFixture("collector-failure");

  try {
    await fixture.writeHeartbeat({ active_dispatches: 0 });
    await fixture.appendFailure("ALS-002", "Recent failure entry");

    const snapshot = await collectSystemSnapshot({
      systemRoot: fixture.root,
      telemetryLimit: 10,
    });
    const dispatcher = snapshot.dispatchers[0]!;

    expect(dispatcher.state).toBe("error");
    expect(dispatcher.recentError?.itemId).toBe("ALS-002");
    expect(dispatcher.recentRun?.outcome).toBe("failure");
  } finally {
    await fixture.cleanup();
  }
});

test("collector falls back to heartbeat-only mode for legacy dispatchers", async () => {
  const fixture = await createDashboardFixture("collector-legacy");

  try {
    const snapshot = await collectSystemSnapshot({
      systemRoot: fixture.root,
      telemetryLimit: 10,
    });
    const dispatcher = snapshot.dispatchers[0]!;

    expect(dispatcher.telemetry.legacyMode).toBe(true);
    expect(dispatcher.recentRun).toBeNull();
    expect(dispatcher.state).toBe("live");
  } finally {
    await fixture.cleanup();
  }
});
