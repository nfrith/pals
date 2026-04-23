import { expect, test } from "bun:test";
import { createDashboardFixture } from "../test-fixtures.ts";
import { createDashboardServiceRuntime } from "./service.ts";
import type { DashboardSnapshot } from "../feed/types.ts";

test("dashboard handlers serve snapshot JSON and fan out SSE updates to concurrent clients", async () => {
  const fixture = await createDashboardFixture("service");
  const runtime = await createDashboardServiceRuntime({
    systemRoot: fixture.root,
    telemetryLimit: 10,
  });

  const clientA = await Promise.resolve(
    runtime.handleRequest(new Request("http://localhost/api/events")),
  );
  const clientB = await Promise.resolve(
    runtime.handleRequest(new Request("http://localhost/api/events")),
  );
  const readerA = createSnapshotEventReader(clientA);
  const readerB = createSnapshotEventReader(clientB);

  try {
    const landingResponse = await Promise.resolve(
      runtime.handleRequest(new Request("http://localhost/")),
    );
    expect(landingResponse.status).toBe(200);
    expect(await landingResponse.text()).toContain("__ALS_DASHBOARD_BOOTSTRAP__");

    const journeyResponse = await Promise.resolve(
      runtime.handleRequest(new Request("http://localhost/journey/factory-jobs")),
    );
    expect(journeyResponse.status).toBe(200);
    expect(await journeyResponse.text()).toContain("\"dispatcherName\":\"factory-jobs\"");

    const missingJourneyResponse = await Promise.resolve(
      runtime.handleRequest(new Request("http://localhost/journey/missing-delamain")),
    );
    expect(missingJourneyResponse.status).toBe(404);

    const assetResponse = await Promise.resolve(
      runtime.handleRequest(new Request("http://localhost/app.js")),
    );
    expect(assetResponse.ok).toBe(true);
    expect(await assetResponse.text()).toContain("Delamain dashboard bootstrap");

    const snapshotResponse = await Promise.resolve(
      runtime.handleRequest(new Request("http://localhost/api/snapshot")),
    );
    expect(snapshotResponse.ok).toBe(true);

    const snapshot = await snapshotResponse.json() as DashboardSnapshot;
    expect(snapshot.dispatchers[0]?.name).toBe("factory-jobs");

    const initialA = await readerA.next();
    const initialB = await readerB.next();
    expect(initialA.dispatchers[0]?.activeDispatches).toBe(1);
    expect(initialB.dispatchers[0]?.activeDispatches).toBe(1);

    await fixture.writeHeartbeat({
      active_dispatches: 0,
      active_by_provider: {
        anthropic: 0,
        openai: 0,
      },
      items_scanned: 3,
    });
    await fixture.writeRuntimeRecords([]);
    await runtime.refresh();

    const updateA = await readerA.until((value) => value.dispatchers[0]?.activeDispatches === 0);
    const updateB = await readerB.until((value) => value.dispatchers[0]?.activeDispatches === 0);
    expect(updateA.dispatchers[0]?.itemsScanned).toBe(3);
    expect(updateB.dispatchers[0]?.itemsScanned).toBe(3);
  } finally {
    await readerA.close();
    await readerB.close();
    await runtime.stop();
    await fixture.cleanup();
  }
});

function createSnapshotEventReader(response: Response): {
  next(): Promise<DashboardSnapshot>;
  until(predicate: (snapshot: DashboardSnapshot) => boolean): Promise<DashboardSnapshot>;
  close(): Promise<void>;
} {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("SSE response is missing a body");
  }

  const decoder = new TextDecoder();
  let buffer = "";

  return {
    async next() {
      while (true) {
        const boundary = buffer.indexOf("\n\n");
        if (boundary !== -1) {
          const chunk = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const dataLine = chunk.split("\n").find((line) => line.startsWith("data: "));
          if (!dataLine) continue;
          return JSON.parse(dataLine.slice(6)) as DashboardSnapshot;
        }

        const result = await withTimeout(reader.read(), 2000);
        if (result.done) {
          throw new Error("SSE stream closed before the next snapshot event");
        }

        buffer += decoder.decode(result.value, { stream: true });
      }
    },

    async until(predicate) {
      while (true) {
        const snapshot = await this.next();
        if (predicate(snapshot)) return snapshot;
      }
    },

    async close() {
      await reader.cancel();
    },
  };
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`Timed out after ${timeoutMs}ms waiting for SSE data`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
