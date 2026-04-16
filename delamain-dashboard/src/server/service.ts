import { collectSystemSnapshot } from "../feed/collector.ts";
import type { DashboardSnapshot } from "../feed/types.ts";
import {
  renderDashboardClientScript,
  renderDashboardHtml,
} from "./html.ts";

export interface DashboardServiceOptions {
  systemRoot: string;
  host?: string;
  port?: number;
  pollMs?: number;
  telemetryLimit?: number;
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
  let snapshot = await collectSystemSnapshot({
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

      if (url.pathname === "/") {
        return new Response(renderDashboardHtml(snapshot), {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      }

      if (url.pathname === "/app.js") {
        return new Response(renderDashboardClientScript(), {
          headers: { "content-type": "text/javascript; charset=utf-8" },
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
        const nextSnapshot = await collectSystemSnapshot({
          systemRoot: options.systemRoot,
          telemetryLimit,
        });
        const nextSerialized = JSON.stringify(nextSnapshot);

        if (nextSerialized !== serializedSnapshot) {
          snapshot = nextSnapshot;
          serializedSnapshot = nextSerialized;
          broadcast(clients, snapshot);
        }
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
