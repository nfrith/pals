import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DispatchLifecycle } from "../../../delamain-dispatcher/src/dispatch-lifecycle.ts";
import {
  buildConcurrencySnapshot,
  evaluateDispatchConcurrency,
  reserveDispatchConcurrency,
} from "../../../delamain-dispatcher/src/concurrency.ts";
import {
  buildSessionRuntimeState,
  shouldPersistDispatcherSession,
} from "../../../delamain-dispatcher/src/session-runtime.ts";
import {
  appendTelemetryEvent,
  DISPATCH_TELEMETRY_SCHEMA,
  readTelemetryEvents,
  resolveTelemetryPaths,
  type DispatchTelemetryEvent,
} from "../../../delamain-dispatcher/src/telemetry.ts";
import {
  emptyRuntimeState,
  evaluatePoolConcurrency,
  evaluateStateConcurrency,
  listPoolConcurrencyHolders,
  summarizeRuntimeState,
  type RuntimeDispatchRecord,
} from "../../../delamain-dispatcher/src/runtime-state.ts";

test("dispatcher concurrency suppression counts active records toward the cap", () => {
  const state = emptyRuntimeState();
  state.records.push(buildRuntimeDispatchRecord({
    item_id: "ALS-201",
    state: "changelog",
    status: "active",
  }));

  const summary = summarizeRuntimeState(state);
  expect(evaluateStateConcurrency(summary, "changelog", 1)).toEqual({
    currentCount: 1,
    suppressed: true,
  });
});

test("dispatcher concurrency suppression counts blocked records toward the cap", () => {
  const state = emptyRuntimeState();
  state.records.push(buildRuntimeDispatchRecord({
    item_id: "ALS-202",
    state: "changelog",
    status: "blocked",
  }));

  const summary = summarizeRuntimeState(state);
  expect(evaluateStateConcurrency(summary, "changelog", 1)).toEqual({
    currentCount: 1,
    suppressed: true,
  });
});

test("dispatcher pool concurrency suppression counts active and blocked records across member states", () => {
  const state = emptyRuntimeState();
  state.records.push(buildRuntimeDispatchRecord({
    item_id: "ALS-201",
    state: "changelog",
    status: "active",
  }));
  state.records.push(buildRuntimeDispatchRecord({
    item_id: "ALS-202",
    state: "aat",
    status: "blocked",
  }));

  const summary = summarizeRuntimeState(state);
  expect(evaluatePoolConcurrency(summary, {
    states: ["changelog", "aat"],
    capacity: 2,
  })).toEqual({
    currentCount: 2,
    suppressed: true,
    holders: [
      {
        dispatch_id: "ALS-201-dispatch",
        item_id: "ALS-201",
        state: "changelog",
        status: "active",
      },
      {
        dispatch_id: "ALS-202-dispatch",
        item_id: "ALS-202",
        state: "aat",
        status: "blocked",
      },
    ],
  });
});

test("dispatcher pool holders ignore guarded and orphaned runtime records", () => {
  const state = emptyRuntimeState();
  state.records.push(buildRuntimeDispatchRecord({
    item_id: "ALS-301",
    state: "changelog",
    status: "guarded",
  }));
  state.records.push(buildRuntimeDispatchRecord({
    item_id: "ALS-302",
    state: "aat",
    status: "orphaned",
  }));

  const summary = summarizeRuntimeState(state);
  expect(listPoolConcurrencyHolders(summary, ["changelog", "aat"])).toEqual([]);
});

test("dispatcher concurrency evaluation prefers pool suppression over state suppression", () => {
  const state = emptyRuntimeState();
  state.records.push(buildRuntimeDispatchRecord({
    item_id: "ALS-401",
    state: "changelog",
    status: "active",
  }));
  state.records.push(buildRuntimeDispatchRecord({
    item_id: "ALS-402",
    state: "aat",
    status: "active",
  }));

  const summary = summarizeRuntimeState(state);
  const snapshot = buildConcurrencySnapshot(summary, [
    {
      state: "aat",
      agentName: "aat",
      provider: "openai",
      resumable: false,
      concurrency: 1,
      pool: {
        id: "rc",
        states: ["changelog", "aat"],
        capacity: 1,
      },
      transitions: [{ class: "advance", to: "done" }],
    },
  ]);

  expect(evaluateDispatchConcurrency(
    {
      state: "aat",
      agentName: "aat",
      provider: "openai",
      resumable: false,
      concurrency: 1,
      pool: {
        id: "rc",
        states: ["changelog", "aat"],
        capacity: 1,
      },
      transitions: [{ class: "advance", to: "done" }],
    },
    snapshot,
  )).toEqual({
    blockedBy: "pool",
    currentCount: 2,
    concurrencyLimit: 1,
    poolId: "rc",
    poolStates: ["changelog", "aat"],
    poolHolders: [
      {
        dispatch_id: "ALS-401-dispatch",
        item_id: "ALS-401",
        state: "changelog",
        status: "active",
      },
      {
        dispatch_id: "ALS-402-dispatch",
        item_id: "ALS-402",
        state: "aat",
        status: "active",
      },
    ],
  });
});

test("dispatcher same-tick reservation suppresses a second pooled state before persistence", () => {
  const summary = summarizeRuntimeState(emptyRuntimeState());
  const dispatchTable = [
    {
      state: "changelog",
      agentName: "changelog",
      provider: "openai",
      resumable: false,
      pool: {
        id: "rc",
        states: ["changelog", "aat"],
        capacity: 1,
      },
      transitions: [{ class: "advance", to: "done" }],
    },
    {
      state: "aat",
      agentName: "aat",
      provider: "openai",
      resumable: false,
      pool: {
        id: "rc",
        states: ["changelog", "aat"],
        capacity: 1,
      },
      transitions: [{ class: "advance", to: "done" }],
    },
  ] as const;
  const snapshot = buildConcurrencySnapshot(summary, dispatchTable);

  reserveDispatchConcurrency(dispatchTable[0], snapshot, {
    dispatch_id: "disp-001",
    item_id: "ALS-501",
    state: "changelog",
    status: "active",
  });

  expect(evaluateDispatchConcurrency(dispatchTable[1], snapshot)).toEqual({
    blockedBy: "pool",
    currentCount: 1,
    concurrencyLimit: 1,
    poolId: "rc",
    poolStates: ["changelog", "aat"],
    poolHolders: [
      {
        dispatch_id: "disp-001",
        item_id: "ALS-501",
        state: "changelog",
        status: "active",
      },
    ],
  });
});

test("dispatcher telemetry preserves concurrency suppression metadata", async () => {
  await withTelemetrySandbox("concurrency-suppression", async (bundleRoot) => {
    await appendTelemetryEvent(
      bundleRoot,
      buildTelemetryEvent("ALS-203", {
        event_type: "dispatch_suppressed_concurrency",
        blocked_by: "state",
        dispatch_id: null,
        isolated_item_file: null,
        worker_session_id: null,
        worktree_path: null,
        branch_name: null,
        worktree_commit: null,
        integrated_commit: null,
        merge_outcome: null,
        current_count: 1,
        concurrency_limit: 1,
        duration_ms: null,
        num_turns: null,
        cost_usd: null,
      }),
    );

    const result = await readTelemetryEvents(bundleRoot, 10);
    expect(result.available).toBe(true);
    expect(result.events[0]).toMatchObject({
      event_type: "dispatch_suppressed_concurrency",
      item_id: "ALS-203",
      blocked_by: "state",
      current_count: 1,
      concurrency_limit: 1,
    });
    expect(Object.hasOwn(result.events[0]!, "pool_id")).toBe(false);
  });
});

test("dispatcher telemetry preserves pool suppression metadata and holders", async () => {
  await withTelemetrySandbox("pool-concurrency-suppression", async (bundleRoot) => {
    await appendTelemetryEvent(
      bundleRoot,
      buildTelemetryEvent("ALS-204", {
        event_type: "dispatch_suppressed_concurrency",
        blocked_by: "pool",
        dispatch_id: null,
        isolated_item_file: null,
        worker_session_id: null,
        worktree_path: null,
        branch_name: null,
        worktree_commit: null,
        integrated_commit: null,
        merge_outcome: null,
        current_count: 1,
        concurrency_limit: 1,
        pool_id: "rc",
        pool_states: ["changelog", "aat"],
        pool_holders: [
          {
            dispatch_id: "disp-101",
            item_id: "ALS-101",
            state: "changelog",
            status: "active",
          },
        ],
        duration_ms: null,
        num_turns: null,
        cost_usd: null,
      }),
    );

    const result = await readTelemetryEvents(bundleRoot, 10);
    expect(result.available).toBe(true);
    expect(result.events[0]).toMatchObject({
      event_type: "dispatch_suppressed_concurrency",
      item_id: "ALS-204",
      blocked_by: "pool",
      current_count: 1,
      concurrency_limit: 1,
      pool_id: "rc",
      pool_states: ["changelog", "aat"],
      pool_holders: [
        {
          dispatch_id: "disp-101",
          item_id: "ALS-101",
          state: "changelog",
          status: "active",
        },
      ],
    });
  });
});

test("anthropic resumable dispatch resumes stored session ids", () => {
  const state = buildSessionRuntimeState(
    {
      provider: "anthropic",
      resumable: true,
      sessionField: "planner_session",
    },
    "8d4d2ecb-0c59-4c5c-946c-2d44ef7b43b8",
  );

  expect(state.includeRuntimeKeys).toBe(true);
  expect(state.runtimeSessionField).toBe("planner_session");
  expect(state.runtimeSessionId).toBe("8d4d2ecb-0c59-4c5c-946c-2d44ef7b43b8");
  expect(state.resume).toBe("yes");
  expect(state.resumeSessionId).toBe("8d4d2ecb-0c59-4c5c-946c-2d44ef7b43b8");
});

test("openai resumable dispatch resumes opaque thread ids", () => {
  const state = buildSessionRuntimeState(
    {
      provider: "openai",
      resumable: true,
      sessionField: "planner_session",
    },
    "codex-thread-123",
  );

  expect(state.includeRuntimeKeys).toBe(true);
  expect(state.runtimeSessionField).toBe("planner_session");
  expect(state.runtimeSessionId).toBe("codex-thread-123");
  expect(state.resume).toBe("yes");
  expect(state.resumeSessionId).toBe("codex-thread-123");
});

test("resumable first-run dispatch exposes session field without resume", () => {
  const state = buildSessionRuntimeState(
    {
      provider: "openai",
      resumable: true,
      sessionField: "planner_session",
    },
    null,
  );

  expect(state.includeRuntimeKeys).toBe(true);
  expect(state.runtimeSessionField).toBe("planner_session");
  expect(state.runtimeSessionId).toBeNull();
  expect(state.resume).toBe("no");
  expect(state.resumeSessionId).toBeUndefined();
});

test("non-resumable dispatch omits runtime session keys", () => {
  const state = buildSessionRuntimeState(
    {
      provider: "anthropic",
      resumable: false,
    },
    null,
  );

  expect(state.includeRuntimeKeys).toBe(false);
  expect(state.runtimeSessionField).toBeNull();
  expect(state.runtimeSessionId).toBeNull();
  expect(state.resume).toBe("no");
});

test("guarded lifecycle tracks active providers and guarded items", () => {
  const lifecycle = new DispatchLifecycle();
  lifecycle.reconcile([{ id: "ALS-002", status: "dev" }]);
  lifecycle.markDispatchStarted("ALS-002", "dev", "openai");

  expect(lifecycle.heartbeat()).toEqual({
    active_dispatches: 1,
    active_by_provider: {
      anthropic: 0,
      openai: 1,
    },
    guarded_dispatches: 0,
    guarded_items: [],
  });

  const disposition = lifecycle.completeDispatch({
    itemId: "ALS-002",
    state: "dev",
    success: true,
    provider: "openai",
    guardedAtMs: Date.parse("2026-04-17T04:05:06.000Z"),
  });

  expect(disposition).toBe("guarded");
  expect(lifecycle.isGuarded("ALS-002")).toBe(true);
  expect(lifecycle.heartbeat()).toEqual({
    active_dispatches: 0,
    active_by_provider: {
      anthropic: 0,
      openai: 0,
    },
    guarded_dispatches: 1,
    guarded_items: [
      {
        item_id: "ALS-002",
        state: "dev",
        provider: "openai",
        guarded_at: "2026-04-17T04:05:06.000Z",
      },
    ],
  });
});

test("guarded lifecycle releases items when status changes", () => {
  const lifecycle = new DispatchLifecycle();
  lifecycle.reconcile([{ id: "ALS-002", status: "dev" }]);
  lifecycle.markDispatchStarted("ALS-002", "dev", "openai");
  lifecycle.completeDispatch({
    itemId: "ALS-002",
    state: "dev",
    success: true,
    provider: "openai",
    guardedAtMs: Date.parse("2026-04-17T04:05:06.000Z"),
  });

  const releases = lifecycle.reconcile([{ id: "ALS-002", status: "in-review" }]);

  expect(releases).toEqual([
    {
      itemId: "ALS-002",
      previousStatus: "dev",
      nextStatus: "in-review",
      releasedActive: false,
      releasedGuarded: true,
    },
  ]);
  expect(lifecycle.isGuarded("ALS-002")).toBe(false);
  expect(lifecycle.heartbeat().guarded_items).toEqual([]);
});

test("guarded lifecycle ignores stale completions after the item already moved on", () => {
  const lifecycle = new DispatchLifecycle();
  lifecycle.reconcile([{ id: "ALS-002", status: "dev" }]);
  lifecycle.markDispatchStarted("ALS-002", "dev", "anthropic");
  lifecycle.reconcile([{ id: "ALS-002", status: "in-review" }]);

  const disposition = lifecycle.completeDispatch({
    itemId: "ALS-002",
    state: "dev",
    success: true,
    provider: "anthropic",
  });

  expect(disposition).toBe("ignored_stale");
  expect(lifecycle.isGuarded("ALS-002")).toBe(false);
  expect(lifecycle.heartbeat()).toEqual({
    active_dispatches: 0,
    active_by_provider: {
      anthropic: 0,
      openai: 0,
    },
    guarded_dispatches: 0,
    guarded_items: [],
  });
});

test("failed dispatches release active guards immediately", () => {
  const lifecycle = new DispatchLifecycle();
  lifecycle.reconcile([{ id: "ALS-002", status: "dev" }]);
  lifecycle.markDispatchStarted("ALS-002", "dev", "anthropic");

  const disposition = lifecycle.completeDispatch({
    itemId: "ALS-002",
    state: "dev",
    success: false,
    provider: "anthropic",
  });

  expect(disposition).toBe("released_after_failure");
  expect(lifecycle.counts()).toEqual({ active: 0, guarded: 0 });
});

test("dispatcher session persistence writes new openai worker session ids", () => {
  expect(
    shouldPersistDispatcherSession(
      {
        provider: "openai",
        resumable: true,
        sessionField: "dev_session",
      },
      "codex-thread-123",
      buildSessionRuntimeState(
        {
          provider: "openai",
          resumable: true,
          sessionField: "dev_session",
        },
        null,
      ),
    ),
  ).toBe(true);
});

test("dispatcher session persistence is disabled for resumed sessions", () => {
  expect(
    shouldPersistDispatcherSession(
      {
        provider: "anthropic",
        resumable: true,
        sessionField: "dev_session",
      },
      "11111111-1111-4111-8111-111111111111",
      buildSessionRuntimeState(
        {
          provider: "anthropic",
          resumable: true,
          sessionField: "dev_session",
        },
        "8d4d2ecb-0c59-4c5c-946c-2d44ef7b43b8",
      ),
    ),
  ).toBe(false);
});

test("dispatcher session persistence is disabled when no new provider session id is available", () => {
  expect(
    shouldPersistDispatcherSession(
      {
        provider: "anthropic",
        resumable: true,
        sessionField: "dev_session",
      },
      undefined,
      buildSessionRuntimeState(
        {
          provider: "anthropic",
          resumable: true,
          sessionField: "dev_session",
        },
        null,
      ),
    ),
  ).toBe(false);
});

test("dispatcher session persistence is disabled for non-resumable states", () => {
  expect(
    shouldPersistDispatcherSession(
      {
        provider: "anthropic",
        resumable: false,
      },
      "8d4d2ecb-0c59-4c5c-946c-2d44ef7b43b8",
      buildSessionRuntimeState(
        {
          provider: "anthropic",
          resumable: false,
        },
        null,
      ),
    ),
  ).toBe(false);
});

test("dispatcher telemetry reader degrades gracefully when no telemetry file exists", async () => {
  await withTelemetrySandbox("missing", async (bundleRoot) => {
    const result = await readTelemetryEvents(bundleRoot);

    expect(result.available).toBe(false);
    expect(result.events).toEqual([]);
    expect(result.parse_errors).toBe(0);
  });
});

test("dispatcher telemetry retains only the most recent events", async () => {
  await withTelemetrySandbox("retention", async (bundleRoot) => {
    await appendTelemetryEvent(bundleRoot, buildTelemetryEvent("ALS-001"), 2);
    await appendTelemetryEvent(bundleRoot, buildTelemetryEvent("ALS-002"), 2);
    await appendTelemetryEvent(bundleRoot, buildTelemetryEvent("ALS-003"), 2);

    const result = await readTelemetryEvents(bundleRoot, 10);

    expect(result.available).toBe(true);
    expect(result.events).toHaveLength(2);
    expect(result.events.map((event) => event.item_id)).toEqual(["ALS-002", "ALS-003"]);
  });
});

test("dispatcher telemetry skips malformed lines without failing the reader", async () => {
  await withTelemetrySandbox("parse-errors", async (bundleRoot) => {
    const { directory, eventsFile } = resolveTelemetryPaths(bundleRoot);
    await mkdir(directory, { recursive: true });
    await writeFile(
      eventsFile,
      [
        JSON.stringify(buildTelemetryEvent("ALS-010")),
        "not-json",
        JSON.stringify({ schema: "wrong-schema@1" }),
      ].join("\n") + "\n",
      "utf-8",
    );

    const result = await readTelemetryEvents(bundleRoot, 10);

    expect(result.available).toBe(true);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]?.item_id).toBe("ALS-010");
    expect(result.parse_errors).toBe(2);
  });
});

async function withTelemetrySandbox(
  label: string,
  run: (bundleRoot: string) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), `als-dispatcher-telemetry-${label}-`));
  const bundleRoot = join(root, ".claude", "delamains", "telemetry-test");

  try {
    await run(bundleRoot);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function buildRuntimeDispatchRecord(
  overrides: Partial<RuntimeDispatchRecord>,
): RuntimeDispatchRecord {
  return {
    dispatch_id: overrides.dispatch_id ?? `${overrides.item_id ?? "ALS-000"}-dispatch`,
    item_id: overrides.item_id ?? "ALS-000",
    item_file: overrides.item_file ?? `/tmp/${overrides.item_id ?? "ALS-000"}.md`,
    isolated_item_file: overrides.isolated_item_file ?? null,
    state: overrides.state ?? "dev",
    agent_name: overrides.agent_name ?? "dev",
    dispatcher_name: overrides.dispatcher_name ?? "factory-jobs",
    provider: overrides.provider ?? "anthropic",
    resumable: overrides.resumable ?? false,
    session_field: overrides.session_field ?? null,
    status: overrides.status ?? "active",
    worktree_path: overrides.worktree_path ?? null,
    branch_name: overrides.branch_name ?? null,
    base_commit: overrides.base_commit ?? null,
    mounted_submodules: overrides.mounted_submodules ?? [],
    worktree_commit: overrides.worktree_commit ?? null,
    integrated_commit: overrides.integrated_commit ?? null,
    started_at: overrides.started_at ?? "2026-05-02T00:00:00.000Z",
    updated_at: overrides.updated_at ?? "2026-05-02T00:00:00.000Z",
    heartbeat_at: overrides.heartbeat_at ?? null,
    owner_pid: overrides.owner_pid ?? null,
    transition_targets: overrides.transition_targets ?? ["in-review"],
    merge_outcome: overrides.merge_outcome ?? "pending",
    merge_attempted_at: overrides.merge_attempted_at ?? null,
    merge_message: overrides.merge_message ?? null,
    latest_error: overrides.latest_error ?? null,
    latest_session_id: overrides.latest_session_id ?? null,
    latest_duration_ms: overrides.latest_duration_ms ?? null,
    latest_num_turns: overrides.latest_num_turns ?? null,
    latest_cost_usd: overrides.latest_cost_usd ?? null,
    incident: overrides.incident ?? null,
  };
}

function buildTelemetryEvent(
  itemId: string,
  overrides: Partial<DispatchTelemetryEvent> = {},
): DispatchTelemetryEvent {
  return {
    schema: DISPATCH_TELEMETRY_SCHEMA,
    event_id: `${itemId}-event`,
    event_type: overrides.event_type ?? "dispatch_finish",
    timestamp: "2026-04-16T08:00:00.000Z",
    dispatcher_name: "telemetry-test",
    module_id: "factory",
    dispatch_id: overrides.dispatch_id ?? "d-telemetry001",
    item_id: itemId,
    item_file: `/tmp/${itemId}.md`,
    isolated_item_file: overrides.isolated_item_file ?? `/tmp/.worktrees/${itemId}.md`,
    state: overrides.state ?? "in-dev",
    agent_name: overrides.agent_name ?? "in-dev",
    sub_agent_name: overrides.sub_agent_name ?? null,
    provider: overrides.provider ?? "openai",
    resumable: overrides.resumable ?? true,
    resume_requested: overrides.resume_requested ?? false,
    session_field: overrides.session_field ?? "dev_session",
    runtime_session_id: overrides.runtime_session_id ?? null,
    resume_session_id: overrides.resume_session_id ?? null,
    worker_session_id: overrides.worker_session_id ?? "codex-thread-123",
    worktree_path: overrides.worktree_path ?? `/tmp/.worktrees/${itemId}`,
    branch_name: overrides.branch_name ?? `delamain/telemetry-test/${itemId}/d-telemetry001`,
    worktree_commit: overrides.worktree_commit ?? null,
    integrated_commit: overrides.integrated_commit ?? null,
    merge_outcome: overrides.merge_outcome ?? "merged",
    incident_kind: overrides.incident_kind ?? null,
    blocked_by: overrides.blocked_by,
    current_count: overrides.current_count ?? null,
    concurrency_limit: overrides.concurrency_limit ?? null,
    pool_id: overrides.pool_id,
    pool_states: overrides.pool_states,
    pool_holders: overrides.pool_holders,
    transition_targets: overrides.transition_targets ?? ["in-review"],
    duration_ms: overrides.duration_ms ?? 1200,
    num_turns: overrides.num_turns ?? 6,
    cost_usd: overrides.cost_usd ?? 0.42,
    error: overrides.error ?? null,
  };
}
