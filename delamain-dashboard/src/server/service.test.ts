import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "bun:test";
import { createDashboardFixture } from "../test-fixtures.ts";
import { collectSystemSnapshot } from "../feed/collector.ts";
import { createDashboardServiceRuntime } from "./service.ts";
import type { DashboardSnapshot } from "../feed/types.ts";
import { runGit } from "../../../skills/new/references/dispatcher/src/git.ts";

test("dashboard handlers serve snapshot JSON and fan out SSE updates to concurrent clients", async () => {
  const fixture = await createDashboardFixture("service");
  const runtime = await createDashboardServiceRuntime({
    systemRoot: fixture.root,
    telemetryLimit: 10,
    assetBuilder: () => createStubAssets(fixture.root),
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

test("dashboard refresh keeps the last good snapshot when a refresh throws", async () => {
  const fixture = await createDashboardFixture("service-refresh-error");
  let calls = 0;
  const runtime = await createDashboardServiceRuntime({
    systemRoot: fixture.root,
    telemetryLimit: 10,
    assetBuilder: () => createStubAssets(fixture.root),
    snapshotCollector: async (options) => {
      calls += 1;
      if (calls === 1) {
        return collectSystemSnapshot(options);
      }
      throw new Error("synthetic refresh failure");
    },
  });

  try {
    const before = runtime.snapshot;
    await runtime.refresh();

    expect(runtime.snapshot).toEqual(before);

    const snapshotResponse = await Promise.resolve(
      runtime.handleRequest(new Request("http://localhost/api/snapshot")),
    );
    expect(await snapshotResponse.json()).toEqual(before);
  } finally {
    await runtime.stop();
    await fixture.cleanup();
  }
});

test(
  "dashboard service survives a 60s Bun.serve host soak without TypeError",
  { timeout: 120_000 },
  async () => {
    const fixture = await createDashboardFixture("service-host-regression");
    const extraDispatchers = Array.from({ length: 7 }, (_, index) => `factory-jobs-${index + 2}`);

    try {
      await addCommittedItems(fixture.root, 8);
      for (const dispatcherName of extraDispatchers) {
        await cloneDispatcherBundle(fixture.root, "factory-jobs", dispatcherName);
      }

      let port: number;
      try {
        port = await reservePort();
      } catch (error) {
        if (isPermissionError(error)) {
          console.warn("[delamain-dashboard] skipping host soak: sandbox forbids binding a local port");
          return;
        }
        throw error;
      }
      const service = startDashboardProcess(fixture.root, port);
      let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;

      try {
        await service.ready;

        const landingResponse = await fetch(`${service.url}/`);
        expect(landingResponse.status).toBe(200);

        const eventsResponse = await fetch(`${service.url}/api/events`);
        expect(eventsResponse.ok).toBe(true);

        reader = eventsResponse.body?.getReader() ?? null;
        if (!reader) {
          throw new Error("SSE response is missing a body");
        }

        const firstEvent = await withTimeout(reader.read(), 5000);
        expect(firstEvent.done).toBe(false);

        const soakDeadline = Date.now() + 60_000;
        while (Date.now() < soakDeadline) {
          await assertProcessStaysRunning(service.process, 10_000);

          const snapshotResponse = await fetch(`${service.url}/api/snapshot`);
          expect(snapshotResponse.ok).toBe(true);

          const snapshot = await snapshotResponse.json() as DashboardSnapshot;
          expect(snapshot.dispatcherCount).toBe(extraDispatchers.length + 1);
        }

        await reader.cancel();
        reader = null;

        const stopResult = await stopDashboardProcess(service.process);
        expect(stopResult.exitCode).toBe(0);
        expect(service.output()).not.toContain("TypeError: undefined is not a function");
      } finally {
        if (reader) {
          await reader.cancel().catch(() => undefined);
        }
        await ensureDashboardStopped(service.process);
      }
    } finally {
      await fixture.cleanup();
    }
  },
);

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

async function createStubAssets(root: string): Promise<{
  files: Map<string, string>;
  scriptPaths: string[];
  stylePaths: string[];
}> {
  const assetDir = join(root, ".dashboard-assets");
  const scriptPath = join(assetDir, "app.js");

  await mkdir(assetDir, { recursive: true });
  await writeFile(scriptPath, "console.log('Delamain dashboard bootstrap');\n", "utf-8");

  return {
    files: new Map([["app.js", scriptPath]]),
    scriptPaths: ["/assets/app.js"],
    stylePaths: [],
  };
}

async function addCommittedItems(systemRoot: string, count: number): Promise<void> {
  const itemsDir = join(systemRoot, "workspace", "factory", "items");

  for (let offset = 0; offset < count; offset += 1) {
    const itemNumber = offset + 3;
    const itemId = `ALS-${String(itemNumber).padStart(3, "0")}`;
    await writeFile(
      join(itemsDir, `${itemId}.md`),
      [
        "---",
        `id: ${itemId}`,
        "type: work-item",
        "status: in-dev",
        `title: Stress item ${itemNumber}`,
        "---",
        "",
        "Dashboard soak fixture item.",
      ].join("\n") + "\n",
      "utf-8",
    );
  }

  await runGit(systemRoot, ["add", "."]);
  await runGit(
    systemRoot,
    [
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@local",
      "commit",
      "--no-gpg-sign",
      "-m",
      "fixture: expand dashboard soak corpus",
    ],
  );
}

async function cloneDispatcherBundle(
  systemRoot: string,
  templateName: string,
  dispatcherName: string,
): Promise<void> {
  const bundlesRoot = join(systemRoot, ".claude", "delamains");
  const templateRoot = join(bundlesRoot, templateName);
  const targetRoot = join(bundlesRoot, dispatcherName);

  await cp(templateRoot, targetRoot, { recursive: true });
  await rewriteJsonFile(join(targetRoot, "status.json"), (value) => ({
    ...value,
    name: dispatcherName,
  }));
  await rewriteJsonFile(join(targetRoot, "runtime-manifest.json"), (value) => ({
    ...value,
    delamain_name: dispatcherName,
  }));
}

async function rewriteJsonFile(
  filePath: string,
  rewrite: (value: Record<string, unknown>) => Record<string, unknown>,
): Promise<void> {
  const raw = await readFile(filePath, "utf-8");
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  await writeFile(filePath, JSON.stringify(rewrite(parsed), null, 2) + "\n", "utf-8");
}

function startDashboardProcess(systemRoot: string, port: number): {
  process: ChildProcessWithoutNullStreams;
  url: string;
  ready: Promise<void>;
  output(): string;
} {
  const alsRoot = fileURLToPath(new URL("../../../", import.meta.url));
  const dashboardRoot = fileURLToPath(new URL("../../", import.meta.url));
  const entrypoint = fileURLToPath(new URL("../index.ts", import.meta.url));
  const child = spawn(
    "bun",
    [
      "run",
      entrypoint,
      "service",
      "--system-root",
      systemRoot,
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--poll-ms",
      "1000",
    ],
    {
      cwd: dashboardRoot,
      env: {
        ...process.env,
        CLAUDE_PLUGIN_ROOT: alsRoot,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  let output = "";
  const appendOutput = (chunk: string | Buffer) => {
    output += chunk.toString();
  };

  child.stdout.on("data", appendOutput);
  child.stderr.on("data", appendOutput);

  return {
    process: child,
    url: `http://127.0.0.1:${port}`,
    ready: waitForProcessOutput(child, "[delamain-dashboard] listening:", () => output, 10_000),
    output: () => output,
  };
}

function waitForProcessOutput(
  process: ChildProcessWithoutNullStreams,
  needle: string,
  getOutput: () => string,
  timeoutMs: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const onData = () => {
      if (!getOutput().includes(needle)) return;
      cleanup();
      resolve();
    };
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      cleanup();
      reject(
        new Error(
          `Dashboard exited before becoming ready (code ${code ?? "null"}, signal ${signal ?? "null"}).\n${getOutput()}`,
        ),
      );
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for dashboard readiness.\n${getOutput()}`));
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timer);
      process.stdout.off("data", onData);
      process.stderr.off("data", onData);
      process.off("exit", onExit);
    };

    process.stdout.on("data", onData);
    process.stderr.on("data", onData);
    process.once("exit", onExit);
    onData();
  });
}

function waitForProcessExit(
  process: ChildProcessWithoutNullStreams,
): Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolve) => {
    if (process.exitCode !== null || process.signalCode !== null) {
      resolve({
        exitCode: process.exitCode,
        signal: process.signalCode,
      });
      return;
    }

    process.once("exit", (exitCode, signal) => {
      resolve({ exitCode, signal });
    });
  });
}

async function stopDashboardProcess(
  process: ChildProcessWithoutNullStreams,
): Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }> {
  if (process.exitCode !== null || process.signalCode !== null) {
    return {
      exitCode: process.exitCode,
      signal: process.signalCode,
    };
  }

  process.kill("SIGTERM");
  return withTimeout(waitForProcessExit(process), 10_000);
}

async function ensureDashboardStopped(process: ChildProcessWithoutNullStreams): Promise<void> {
  if (process.exitCode !== null || process.signalCode !== null) {
    return;
  }

  process.kill("SIGKILL");
  await waitForProcessExit(process);
}

async function assertProcessStaysRunning(
  process: ChildProcessWithoutNullStreams,
  durationMs: number,
): Promise<void> {
  const exit = await Promise.race([
    waitForProcessExit(process),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), durationMs)),
  ]);

  if (exit) {
    throw new Error(
      `Dashboard exited unexpectedly during soak (code ${exit.exitCode ?? "null"}, signal ${exit.signal ?? "null"}).`,
    );
  }
}

async function reservePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();

    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Unable to determine an ephemeral port"));
        return;
      }

      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(address.port);
      });
    });
  });
}

function isPermissionError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "EPERM";
}
