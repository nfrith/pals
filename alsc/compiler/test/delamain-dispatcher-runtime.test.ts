import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

test("direct resumable dispatch resumes valid SDK session ids", () => {
  const state = buildSessionRuntimeState(
    {
      delegated: false,
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

test("direct non-resumable dispatch omits runtime session keys", () => {
  const state = buildSessionRuntimeState(
    {
      delegated: false,
      resumable: false,
    },
    null,
  );

  expect(state.includeRuntimeKeys).toBe(false);
  expect(state.runtimeSessionField).toBeNull();
  expect(state.runtimeSessionId).toBeNull();
  expect(state.resume).toBe("no");
});

test("direct resumable first-run dispatch exposes session field without resume", () => {
  const state = buildSessionRuntimeState(
    {
      delegated: false,
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

test("direct resumable dispatch ignores invalid stored SDK session ids", () => {
  const state = buildSessionRuntimeState(
    {
      delegated: false,
      resumable: true,
      sessionField: "planner_session",
    },
    "codex:ghost-tree:plan-SWF-001",
  );

  expect(state.includeRuntimeKeys).toBe(true);
  expect(state.runtimeSessionField).toBe("planner_session");
  expect(state.runtimeSessionId).toBeNull();
  expect(state.resume).toBe("no");
  expect(state.resumeSessionId).toBeUndefined();
  expect(state.ignoredInvalidSessionId).toBe("codex:ghost-tree:plan-SWF-001");
});

test("delegated dispatch exposes saved worker session ids without SDK resume", () => {
  const state = buildSessionRuntimeState(
    {
      delegated: true,
      resumable: true,
      sessionField: "planner_session",
    },
    "codex:ghost-tree:plan-SWF-001",
  );

  expect(state.includeRuntimeKeys).toBe(true);
  expect(state.runtimeSessionField).toBe("planner_session");
  expect(state.runtimeSessionId).toBe("codex:ghost-tree:plan-SWF-001");
  expect(state.resume).toBe("no");
  expect(state.resumeSessionId).toBeUndefined();
  expect(state.ignoredInvalidSessionId).toBeUndefined();
});

test("delegated dispatch keeps valid UUID worker session ids as runtime metadata only", () => {
  const state = buildSessionRuntimeState(
    {
      delegated: true,
      resumable: true,
      sessionField: "planner_session",
    },
    "8d4d2ecb-0c59-4c5c-946c-2d44ef7b43b8",
  );

  expect(state.includeRuntimeKeys).toBe(true);
  expect(state.runtimeSessionField).toBe("planner_session");
  expect(state.runtimeSessionId).toBe("8d4d2ecb-0c59-4c5c-946c-2d44ef7b43b8");
  expect(state.resume).toBe("no");
  expect(state.resumeSessionId).toBeUndefined();
});

test("delegated dispatch without a session field still emits null-shaped runtime keys", () => {
  const state = buildSessionRuntimeState(
    {
      delegated: true,
      resumable: false,
    },
    null,
  );

  expect(state.includeRuntimeKeys).toBe(true);
  expect(state.runtimeSessionField).toBeNull();
  expect(state.runtimeSessionId).toBeNull();
  expect(state.resume).toBe("no");
});

test("dispatcher session persistence is disabled for delegated states", () => {
  expect(
    shouldPersistDispatcherSession(
      {
        delegated: true,
        resumable: true,
        sessionField: "planner_session",
      },
      "8d4d2ecb-0c59-4c5c-946c-2d44ef7b43b8",
      buildSessionRuntimeState(
        {
          delegated: true,
          resumable: true,
          sessionField: "planner_session",
        },
        "8d4d2ecb-0c59-4c5c-946c-2d44ef7b43b8",
      ),
    ),
  ).toBe(false);

  expect(
    shouldPersistDispatcherSession(
      {
        delegated: false,
        resumable: true,
        sessionField: "dev_session",
      },
      "8d4d2ecb-0c59-4c5c-946c-2d44ef7b43b8",
      buildSessionRuntimeState(
        {
          delegated: false,
          resumable: true,
          sessionField: "dev_session",
        },
        null,
      ),
    ),
  ).toBe(true);
});

test("dispatcher session persistence is disabled for resumed direct sessions", () => {
  expect(
    shouldPersistDispatcherSession(
      {
        delegated: false,
        resumable: true,
        sessionField: "dev_session",
      },
      "11111111-1111-4111-8111-111111111111",
      buildSessionRuntimeState(
        {
          delegated: false,
          resumable: true,
          sessionField: "dev_session",
        },
        "8d4d2ecb-0c59-4c5c-946c-2d44ef7b43b8",
      ),
    ),
  ).toBe(false);
});

test("dispatcher session persistence is disabled when no new SDK session id is available", () => {
  expect(
    shouldPersistDispatcherSession(
      {
        delegated: false,
        resumable: true,
        sessionField: "dev_session",
      },
      undefined,
      buildSessionRuntimeState(
        {
          delegated: false,
          resumable: true,
          sessionField: "dev_session",
        },
        null,
      ),
    ),
  ).toBe(false);
});

test("dispatcher session persistence is disabled for non-resumable direct states", () => {
  expect(
    shouldPersistDispatcherSession(
      {
        delegated: false,
        resumable: false,
      },
      "8d4d2ecb-0c59-4c5c-946c-2d44ef7b43b8",
      buildSessionRuntimeState(
        {
          delegated: false,
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
    item_id: itemId,
    item_file: `/tmp/${itemId}.md`,
    state: "in-dev",
    agent_name: "in-dev",
    sub_agent_name: null,
    delegated: false,
    resumable: true,
    resume_requested: false,
    session_field: "dev_session",
    runtime_session_id: null,
    resume_session_id: null,
    worker_session_id: "11111111-1111-4111-8111-111111111111",
    transition_targets: ["in-review"],
    duration_ms: 1200,
    num_turns: 6,
    cost_usd: 0.42,
    error: null,
  };
}
