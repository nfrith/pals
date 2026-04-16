import {
  BoxRenderable,
  TextRenderable,
  createCliRenderer,
  type CliRenderer,
} from "@opentui/core";
import type { DashboardSnapshot } from "../feed/types.ts";
import { renderTuiDocument } from "./document.ts";
import { configureOpenTui } from "./open-tui.ts";

export interface TuiOptions {
  serviceUrl: string;
  refreshMs?: number;
  screenMode?: "alternate" | "normal";
  exitAfterMs?: number | null;
}

export async function runDashboardTui(options: TuiOptions): Promise<void> {
  await configureOpenTui();

  const app = new DashboardTuiApp({
    serviceUrl: options.serviceUrl,
    refreshMs: options.refreshMs ?? 1000,
    screenMode: options.screenMode ?? "alternate",
    exitAfterMs: options.exitAfterMs ?? null,
  });

  try {
    await app.run();
  } finally {
    await app.stop();
  }
}

class DashboardTuiApp {
  readonly #options: Required<TuiOptions>;
  #renderer: CliRenderer | null = null;
  #header!: TextRenderable;
  #separator!: TextRenderable;
  #body!: TextRenderable;
  #footer!: TextRenderable;
  #resolveRun: (() => void) | null = null;
  #pollTimer: ReturnType<typeof setInterval> | null = null;
  #exitTimer: ReturnType<typeof setTimeout> | null = null;
  #stopped = false;

  constructor(options: Required<TuiOptions>) {
    this.#options = options;
  }

  async run(): Promise<void> {
    const runPromise = new Promise<void>((resolve) => {
      this.#resolveRun = resolve;
    });

    this.#renderer = await createCliRenderer({
      backgroundColor: "#081117",
      consoleMode: "disabled",
      exitOnCtrlC: true,
      openConsoleOnError: true,
      prependInputHandlers: [(sequence) => this.#handleInput(sequence)],
      screenMode: this.#options.screenMode === "normal" ? "main-screen" : "alternate-screen",
      useMouse: false,
    });

    this.#buildLayout(this.#renderer);
    await this.#refresh();

    this.#pollTimer = setInterval(() => {
      void this.#refresh();
    }, this.#options.refreshMs);

    if (this.#options.exitAfterMs && this.#options.exitAfterMs > 0) {
      this.#exitTimer = setTimeout(() => this.#requestStop(), this.#options.exitAfterMs);
    }

    process.on("SIGINT", () => this.#requestStop());
    process.on("SIGTERM", () => this.#requestStop());

    await runPromise;
  }

  async stop(): Promise<void> {
    if (this.#stopped) return;
    this.#stopped = true;

    if (this.#pollTimer) clearInterval(this.#pollTimer);
    if (this.#exitTimer) clearTimeout(this.#exitTimer);
    this.#renderer?.destroy();
    this.#renderer = null;
  }

  #buildLayout(renderer: CliRenderer): void {
    const root = new BoxRenderable(renderer, {
      backgroundColor: "#081117",
      flexDirection: "column",
      width: "100%",
      height: "100%",
    });
    renderer.root.add(root);

    this.#header = new TextRenderable(renderer, {
      content: "Delamain Dashboard",
      fg: "#f7b267",
      width: "100%",
      wrapMode: "none",
    });
    root.add(this.#header);

    this.#separator = new TextRenderable(renderer, {
      content: "──────────────────────────────────────────────────────────────────────────────",
      fg: "#9db3aa",
      width: "100%",
      wrapMode: "none",
    });
    root.add(this.#separator);

    this.#body = new TextRenderable(renderer, {
      content: "Loading…",
      fg: "#eef7f2",
      width: "100%",
      wrapMode: "word",
    });
    root.add(this.#body);

    this.#footer = new TextRenderable(renderer, {
      content: "",
      fg: "#9db3aa",
      width: "100%",
      wrapMode: "none",
    });
    root.add(this.#footer);
  }

  async #refresh(): Promise<void> {
    let renderer = this.#getRenderer();
    if (!renderer) return;

    try {
      const snapshot = await fetchSnapshot(this.#options.serviceUrl);
      renderer = this.#getRenderer();
      if (!renderer) return;
      this.#render(snapshot, renderer);
    } catch (error) {
      renderer = this.#getRenderer();
      if (!renderer) return;
      this.#body.content = `Dashboard fetch failed\n\n${formatError(error)}`;
      this.#footer.content = `q quit • r retry • ${this.#options.serviceUrl}`;
      renderer.requestRender();
    }
  }

  #render(snapshot: DashboardSnapshot, renderer: CliRenderer): void {
    this.#header.content = `Delamain Dashboard • ${snapshot.dispatcherCount} dispatchers`;
    this.#body.content = renderTuiDocument(snapshot);
    this.#footer.content = `q quit • r refresh • ${this.#options.serviceUrl}`;
    renderer.requestRender();
  }

  #handleInput(sequence: string): boolean {
    if (sequence === "q") {
      this.#requestStop();
      return true;
    }

    if (sequence === "r") {
      void this.#refresh();
      return true;
    }

    return false;
  }

  #requestStop(): void {
    this.#resolveRun?.();
    this.#resolveRun = null;
  }

  #getRenderer(): CliRenderer | null {
    if (this.#renderer === null || this.#renderer.isDestroyed || this.#stopped) {
      return null;
    }
    return this.#renderer;
  }
}

async function fetchSnapshot(serviceUrl: string): Promise<DashboardSnapshot> {
  const response = await fetch(`${serviceUrl.replace(/\/$/, "")}/api/snapshot`);
  if (!response.ok) {
    throw new Error(`Snapshot request failed with ${response.status}`);
  }
  return await response.json() as DashboardSnapshot;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
