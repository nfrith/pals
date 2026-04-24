import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
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
    expect(dispatcher.transitions).toEqual([
      {
        class: "advance",
        from: "queued",
        to: "in-dev",
      },
    ]);
    expect(dispatcher.states["queued"]?.provider).toBe("anthropic");
    expect(dispatcher.runtime.available).toBe(true);
    expect(dispatcher.runtime.active[0]?.item_id).toBe("ALS-001");
    expect(dispatcher.journeyTelemetry?.activeJobs[0]?.jobId).toBe("ALS-001");
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
    expect(dispatcher.transitions?.length).toBe(1);
    expect(dispatcher.state).toBe("live");
  } finally {
    await fixture.cleanup();
  }
});

test("collector isolates bundle-local scan failures to one error card", async () => {
  const fixture = await createDashboardFixture("collector-bundle-failure");

  try {
    await addBrokenBundle(fixture.root, "broken-jobs");

    const snapshot = await collectSystemSnapshot({
      systemRoot: fixture.root,
      telemetryLimit: 10,
    });

    expect(snapshot.dispatcherCount).toBe(2);

    const broken = snapshot.dispatchers.find((dispatcher) => dispatcher.name === "broken-jobs");
    const healthy = snapshot.dispatchers.find((dispatcher) => dispatcher.name === "factory-jobs");

    expect(healthy?.state).toBe("live");
    expect(healthy?.itemSummary.totalItems).toBe(2);
    expect(broken?.state).toBe("error");
    expect(broken?.detail).toContain("Dispatcher snapshot failed:");
    expect(broken?.detail).toContain("ENOENT");
    expect(broken?.itemSummary.totalItems).toBe(0);
  } finally {
    await fixture.cleanup();
  }
});

async function addBrokenBundle(systemRoot: string, name: string): Promise<void> {
  const bundleRoot = join(systemRoot, ".claude", "delamains", name);
  const templateRoot = join(systemRoot, ".claude", "delamains", "factory-jobs");
  const definition = await readFile(join(templateRoot, "delamain.yaml"), "utf-8");

  await mkdir(bundleRoot, { recursive: true });
  await writeFile(join(bundleRoot, "delamain.yaml"), definition, "utf-8");
  await writeFile(
    join(bundleRoot, "runtime-manifest.json"),
    JSON.stringify(
      {
        schema: "als-delamain-runtime-manifest@1",
        delamain_name: name,
        module_id: "factory",
        module_version: 1,
        module_mount_path: "workspace/missing",
        entity_name: "work-item",
        entity_path: "items/{id}.md",
        status_field: "status",
        discriminator_field: null,
        discriminator_value: null,
        state_providers: {
          queued: "anthropic",
          "in-dev": "openai",
          "in-review": "anthropic",
        },
      },
      null,
      2,
    ) + "\n",
    "utf-8",
  );
  await writeFile(
    join(bundleRoot, "status.json"),
    JSON.stringify(
      {
        name,
        pid: process.pid,
        last_tick: new Date().toISOString(),
        poll_ms: 1000,
        active_dispatches: 0,
        active_by_provider: {
          anthropic: 0,
          openai: 0,
        },
        blocked_dispatches: 0,
        orphaned_dispatches: 0,
        guarded_dispatches: 0,
        items_scanned: 0,
      },
      null,
      2,
    ) + "\n",
    "utf-8",
  );
}
