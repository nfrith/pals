import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DispatchLifecycle } from "../../../skills/new/references/dispatcher/src/dispatch-lifecycle.ts";
import {
  buildSessionRuntimeState,
  shouldPersistDispatcherSession,
} from "../../../skills/new/references/dispatcher/src/session-runtime.ts";
import {
  appendTelemetryEvent,
  DISPATCH_TELEMETRY_SCHEMA,
  readTelemetryEvents,
  resolveTelemetryPaths,
  type DispatchTelemetryEvent,
} from "../../../skills/new/references/dispatcher/src/telemetry.ts";

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

function buildTelemetryEvent(itemId: string): DispatchTelemetryEvent {
  return {
    schema: DISPATCH_TELEMETRY_SCHEMA,
    event_id: `${itemId}-event`,
    event_type: "dispatch_finish",
    timestamp: "2026-04-16T08:00:00.000Z",
    dispatcher_name: "telemetry-test",
    module_id: "factory",
    dispatch_id: "d-telemetry001",
    item_id: itemId,
    item_file: `/tmp/${itemId}.md`,
    isolated_item_file: `/tmp/.worktrees/${itemId}.md`,
    state: "in-dev",
    agent_name: "in-dev",
    sub_agent_name: null,
    provider: "openai",
    resumable: true,
    resume_requested: false,
    session_field: "dev_session",
    runtime_session_id: null,
    resume_session_id: null,
    worker_session_id: "codex-thread-123",
    worktree_path: `/tmp/.worktrees/${itemId}`,
    branch_name: `delamain/telemetry-test/${itemId}/d-telemetry001`,
    worktree_commit: null,
    integrated_commit: null,
    merge_outcome: "merged",
    incident_kind: null,
    transition_targets: ["in-review"],
    duration_ms: 1200,
    num_turns: 6,
    cost_usd: 0.42,
    error: null,
  };
}
