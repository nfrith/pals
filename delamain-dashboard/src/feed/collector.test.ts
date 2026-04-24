import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "bun:test";
import type { RuntimeDispatchRecord } from "../../../skills/new/references/dispatcher/src/runtime-state.ts";
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
    expect(dispatcher.journeyTelemetry?.activeJobs[0]).toMatchObject({
      dispatchId: "d-als-001",
      jobId: "ALS-001",
      provider: "anthropic",
      state: "in-dev",
      status: "active",
    });
    expect(dispatcher.telemetry.available).toBe(true);
    expect(dispatcher.recentRun?.outcome).toBe("success");
  } finally {
    await fixture.cleanup();
  }
});

test("collector widens journey telemetry across active guarded blocked and orphaned runtime buckets", async () => {
  const fixture = await createDashboardFixture("collector-journey-telemetry");

  try {
    await fixture.writeRuntimeRecords([
      buildRuntimeRecord({
        itemId: "ALS-001",
        provider: "openai",
        startedAt: "2026-04-17T10:19:15.000Z",
        state: "in-dev",
        status: "active",
      }),
      buildRuntimeRecord({
        itemId: "ALS-002",
        provider: "anthropic",
        startedAt: "2026-04-17T10:19:00.000Z",
        state: "queued",
        status: "guarded",
      }),
      buildRuntimeRecord({
        itemId: "ALS-003",
        provider: "openai",
        startedAt: "2026-04-17T10:18:30.000Z",
        state: "in-review",
        status: "blocked",
      }),
      buildRuntimeRecord({
        itemId: "ALS-004",
        provider: "anthropic",
        startedAt: "2026-04-17T10:18:00.000Z",
        state: "completed",
        status: "orphaned",
      }),
    ]);

    const snapshot = await collectSystemSnapshot({
      systemRoot: fixture.root,
      telemetryLimit: 10,
      now: new Date("2026-04-17T10:20:15.000Z"),
    });
    const dispatcher = snapshot.dispatchers[0]!;

    expect(dispatcher.journeyTelemetry?.activeJobs).toEqual([
      {
        dispatchId: "d-als-001",
        jobId: "ALS-001",
        state: "in-dev",
        age_ms: 60_000,
        provider: "openai",
        status: "active",
      },
      {
        dispatchId: "d-als-002",
        jobId: "ALS-002",
        state: "queued",
        age_ms: 75_000,
        provider: "anthropic",
        status: "guarded",
      },
      {
        dispatchId: "d-als-003",
        jobId: "ALS-003",
        state: "in-review",
        age_ms: 105_000,
        provider: "openai",
        status: "blocked",
      },
      {
        dispatchId: "d-als-004",
        jobId: "ALS-004",
        state: "completed",
        age_ms: 135_000,
        provider: "anthropic",
        status: "orphaned",
      },
    ]);
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

function buildRuntimeRecord(input: {
  itemId: string;
  provider: RuntimeDispatchRecord["provider"];
  startedAt: string;
  state: string;
  status: RuntimeDispatchRecord["status"];
}): RuntimeDispatchRecord {
  return {
    dispatch_id: `d-${input.itemId.toLowerCase()}`,
    item_id: input.itemId,
    item_file: `/tmp/${input.itemId}.md`,
    isolated_item_file: `/tmp/worktrees/${input.itemId}.md`,
    state: input.state,
    agent_name: input.state,
    dispatcher_name: "factory-jobs",
    provider: input.provider,
    resumable: false,
    session_field: null,
    status: input.status,
    worktree_path: `/tmp/.worktrees/${input.itemId}`,
    branch_name: `delamain/factory-jobs/${input.itemId}/d-test`,
    base_commit: "1111111111111111111111111111111111111111",
    mounted_submodules: [],
    worktree_commit: null,
    integrated_commit: null,
    started_at: input.startedAt,
    updated_at: "2026-04-17T10:19:30.000Z",
    heartbeat_at: input.status === "active" ? "2026-04-17T10:19:30.000Z" : null,
    owner_pid: process.pid,
    transition_targets: ["in-review"],
    merge_outcome: "pending",
    merge_attempted_at: null,
    merge_message: null,
    latest_error: null,
    latest_session_id: null,
    latest_duration_ms: null,
    latest_num_turns: null,
    latest_cost_usd: null,
    incident: null,
  };
}
