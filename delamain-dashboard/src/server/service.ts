import { collectSystemSnapshot } from "../feed/collector.ts";
import type { DashboardAppRoute } from "../app-bootstrap.ts";
import type { DashboardSnapshot } from "../feed/types.ts";
import {
  buildDashboardClientBundle,
  contentTypeForAsset,
  resolveAssetPath,
  type DashboardClientAssets,
} from "./bundler.ts";
import { renderDashboardHtml } from "./html.ts";

type DashboardSnapshotCollector = (options: {
  systemRoot: string;
  telemetryLimit?: number;
  now?: Date;
}) => Promise<DashboardSnapshot>;
type DashboardAssetBuilder = () => Promise<DashboardClientAssets>;

export interface DashboardServiceOptions {
  systemRoot: string;
  host?: string;
  port?: number;
  pollMs?: number;
  telemetryLimit?: number;
  snapshotCollector?: DashboardSnapshotCollector;
  assetBuilder?: DashboardAssetBuilder;
}

export interface DashboardServiceRuntime {
  readonly snapshot: DashboardSnapshot;
  handleRequest(request: Request): Response | Promise<Response>;
  refresh(): Promise<void>;
  stop(): Promise<void>;
}

export interface DashboardService {
  readonly url: string;
  readonly snapshot: DashboardSnapshot;
  stop(): Promise<void>;
}

const encoder = new TextEncoder();

export async function createDashboardServiceRuntime(
  options: DashboardServiceOptions,
): Promise<DashboardServiceRuntime> {
  const telemetryLimit = options.telemetryLimit ?? 25;
  const collectSnapshot = options.snapshotCollector ?? collectSystemSnapshot;
  const buildAssets = options.assetBuilder ?? buildDashboardClientBundle;
  const assets = await buildAssets();
  let snapshot = await collectSnapshot({
    systemRoot: options.systemRoot,
    telemetryLimit,
  });
  let serializedSnapshot = JSON.stringify(snapshot);
  let closed = false;
  let refreshing = false;

  const clients = new Set<ReadableStreamDefaultController<Uint8Array>>();

  return {
    get snapshot() {
      return snapshot;
    },

    handleRequest(request) {
      const url = new URL(request.url);
      const assetPath = resolveAssetPath(assets, url.pathname);

      if (assetPath) {
        return new Response(Bun.file(assetPath), {
          headers: { "content-type": contentTypeForAsset(url.pathname) },
        });
      }

      const route = resolveAppRoute(url.pathname);

      if (route) {
        const found = route.kind === "dashboard"
          || snapshot.dispatchers.some((dispatcher) => dispatcher.name === route.dispatcherName);

        return new Response(renderDashboardHtml({ route, snapshot }, assets), {
          status: found ? 200 : 404,
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      }

      if (url.pathname === "/api/snapshot") {
        return Response.json(snapshot);
      }

      if (url.pathname === "/api/events") {
        let streamController: ReadableStreamDefaultController<Uint8Array> | null = null;

        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              streamController = controller;
              clients.add(controller);
              controller.enqueue(encodeSse(snapshot));
            },
            cancel() {
              if (streamController) {
                clients.delete(streamController);
              }
            },
          }),
          {
            headers: {
              "cache-control": "no-cache, no-transform",
              connection: "keep-alive",
              "content-type": "text/event-stream; charset=utf-8",
            },
          },
        );
      }

      if (url.pathname === "/favicon.ico") {
        return new Response(null, { status: 204 });
      }

      return new Response("Not found", { status: 404 });
    },

    async refresh() {
      if (closed || refreshing) return;
      refreshing = true;

      try {
        const nextSnapshot = await collectSnapshot({
          systemRoot: options.systemRoot,
          telemetryLimit,
        });
        const nextSerialized = JSON.stringify(nextSnapshot);

        if (nextSerialized !== serializedSnapshot) {
          snapshot = nextSnapshot;
          serializedSnapshot = nextSerialized;
          broadcast(clients, snapshot);
        }
      } catch (error) {
        console.warn(`[delamain-dashboard] refresh failed: ${formatError(error)}`);
      } finally {
        refreshing = false;
      }
    },

    async stop() {
      if (closed) return;
      closed = true;
      for (const controller of clients) {
        try {
          controller.close();
        } catch {
          // Ignore broken connections.
        }
      }
      clients.clear();
    },
  };
}

export async function startDashboardService(
  options: DashboardServiceOptions,
): Promise<DashboardService> {
  const host = options.host ?? "127.0.0.1";
  const pollMs = options.pollMs ?? 1000;
  const runtime = await createDashboardServiceRuntime(options);

  const server = Bun.serve({
    hostname: host,
    port: options.port ?? 4646,
    fetch(request) {
      return runtime.handleRequest(request);
    },
  });

  const interval = setInterval(() => {
    void runtime.refresh();
  }, pollMs);

  let stopped = false;

  return {
    get url() {
      return `http://${host}:${server.port}`;
    },
    get snapshot() {
      return runtime.snapshot;
    },
    async stop() {
      if (stopped) return;
      stopped = true;
      clearInterval(interval);
      await runtime.stop();
      server.stop(true);
    },
  };
}

function broadcast(
  clients: Set<ReadableStreamDefaultController<Uint8Array>>,
  snapshot: DashboardSnapshot,
): void {
  const payload = encodeSse(snapshot);

  for (const controller of clients) {
    try {
      controller.enqueue(payload);
    } catch {
      clients.delete(controller);
    }
  }
}

function encodeSse(snapshot: DashboardSnapshot): Uint8Array {
  return encoder.encode(`event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`);
}

function resolveAppRoute(pathname: string): DashboardAppRoute | null {
  if (pathname === "/") {
    return { kind: "dashboard" };
  }

  if (!pathname.startsWith("/journey/")) {
    return null;
  }

  const dispatcherName = decodeURIComponent(pathname.slice("/journey/".length));
  if (!dispatcherName) {
    return null;
  }

  return {
    kind: "journey",
    dispatcherName,
  };
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
