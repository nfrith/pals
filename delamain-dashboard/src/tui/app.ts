import {
  CliRenderEvents,
  SelectRenderableEvents,
  createCliRenderer,
  type CliRenderer,
} from "@opentui/core";
import type { DashboardSnapshot } from "../feed/types.ts";
import { buildDashboardViewModel } from "../view-model.ts";
import { clampIndex } from "./layout.ts";
import { configureOpenTui } from "./open-tui.ts";
import { renderDashboardTuiScene, type DashboardTuiSceneState, type DashboardTuiViewMode } from "./render.ts";

export interface TuiOptions {
  serviceUrl: string;
  refreshMs?: number;
  screenMode?: "alternate" | "normal";
  exitAfterMs?: number | null;
}

export interface DashboardTuiState {
  detailItemIndex: number;
  selectedDispatcherIndex: number;
  viewMode: DashboardTuiViewMode;
}

export type DashboardTuiCommand = "noop" | "quit" | "refresh" | "render";

export interface DashboardTuiInputResult {
  command: DashboardTuiCommand;
  handled: boolean;
  state: DashboardTuiState;
}

export async function runDashboardTui(options: TuiOptions): Promise<void> {
  await configureOpenTui();

  const app = new DashboardTuiApp({
    exitAfterMs: options.exitAfterMs ?? null,
    refreshMs: options.refreshMs ?? 1000,
    screenMode: options.screenMode ?? "alternate",
    serviceUrl: options.serviceUrl,
  });

  try {
    await app.run();
  } finally {
    await app.stop();
  }
}

export function reduceDashboardTuiState(
  state: DashboardTuiState,
  sequence: string,
  dispatcherCount: number,
): DashboardTuiInputResult {
  if (sequence === "q") {
    return { command: "quit", handled: true, state };
  }

  if (sequence === "r") {
    return { command: "refresh", handled: true, state };
  }

  if (state.viewMode === "overview") {
    if (sequence === "j") {
      return {
        command: "render",
        handled: true,
        state: {
          ...state,
          selectedDispatcherIndex: clampIndex(state.selectedDispatcherIndex + 1, dispatcherCount),
        },
      };
    }

    if (sequence === "k") {
      return {
        command: "render",
        handled: true,
        state: {
          ...state,
          selectedDispatcherIndex: clampIndex(state.selectedDispatcherIndex - 1, dispatcherCount),
        },
      };
    }

    if (sequence === "g") {
      return {
        command: "render",
        handled: true,
        state: {
          ...state,
          selectedDispatcherIndex: 0,
        },
      };
    }

    if (sequence === "G") {
      return {
        command: "render",
        handled: true,
        state: {
          ...state,
          selectedDispatcherIndex: clampIndex(dispatcherCount - 1, dispatcherCount),
        },
      };
    }

    if ((sequence === "\r" || sequence === "\n") && dispatcherCount > 0) {
      return {
        command: "render",
        handled: true,
        state: {
          ...state,
          detailItemIndex: 0,
          viewMode: "detail",
        },
      };
    }

    return { command: "noop", handled: false, state };
  }

  if (sequence === "\u001b") {
    return {
      command: "render",
      handled: true,
      state: {
        ...state,
        viewMode: "overview",
      },
    };
  }

  return { command: "noop", handled: false, state };
}

class DashboardTuiApp {
  readonly #options: Required<TuiOptions>;
  #renderer: CliRenderer | null = null;
  #resolveRun: (() => void) | null = null;
  #pollTimer: ReturnType<typeof setInterval> | null = null;
  #exitTimer: ReturnType<typeof setTimeout> | null = null;
  #latestSnapshot: DashboardSnapshot | null = null;
  #lastError: string | null = null;
  #detailSelectionListenerBoundToId: string | null = null;
  #state: DashboardTuiState = {
    detailItemIndex: 0,
    selectedDispatcherIndex: 0,
    viewMode: "overview",
  };
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

    this.#renderer.on(CliRenderEvents.RESIZE, () => {
      this.#render();
    });

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

  async #refresh(): Promise<void> {
    try {
      const snapshot = await fetchSnapshot(this.#options.serviceUrl);
      this.#latestSnapshot = snapshot;
      this.#lastError = null;
      this.#state.selectedDispatcherIndex = clampIndex(
        this.#state.selectedDispatcherIndex,
        snapshot.dispatchers.length,
      );
      if (snapshot.dispatchers.length === 0) {
        this.#state.viewMode = "overview";
      }
      this.#render();
    } catch (error) {
      this.#lastError = formatError(error);
      this.#render();
    }
  }

  #handleInput(sequence: string): boolean {
    const dispatcherCount = this.#latestSnapshot?.dispatchers.length ?? 0;
    const next = reduceDashboardTuiState(this.#state, sequence, dispatcherCount);
    if (!next.handled) {
      return false;
    }

    this.#state = next.state;

    if (next.command === "quit") {
      this.#requestStop();
      return true;
    }

    if (next.command === "refresh") {
      void this.#refresh();
      return true;
    }

    if (next.command === "render") {
      this.#render();
    }

    return true;
  }

  #render(): void {
    const renderer = this.#getRenderer();
    if (!renderer) return;

    const view = this.#latestSnapshot ? buildDashboardViewModel(this.#latestSnapshot) : null;
    this.#state.selectedDispatcherIndex = clampIndex(
      this.#state.selectedDispatcherIndex,
      view?.dispatchers.length ?? 0,
    );

    const sceneState: DashboardTuiSceneState = {
      detailItemIndex: this.#state.detailItemIndex,
      errorMessage: this.#lastError,
      selectedDispatcherIndex: this.#state.selectedDispatcherIndex,
      serviceUrl: this.#options.serviceUrl,
      viewMode: this.#state.viewMode,
    };
    const result = renderDashboardTuiScene(renderer, view, sceneState);

    if (result.detailList) {
      this.#bindDetailList(result.detailList);
      process.nextTick(() => {
        result.detailList?.focus();
      });
    } else {
      this.#detailSelectionListenerBoundToId = null;
      this.#state.detailItemIndex = 0;
    }

    renderer.requestRender();
  }

  #bindDetailList(detailList: { id: string; getSelectedIndex(): number; options: unknown[]; on: (event: string, listener: () => void) => void; setSelectedIndex(index: number): void }): void {
    this.#state.detailItemIndex = clampIndex(this.#state.detailItemIndex, detailList.options.length);
    detailList.setSelectedIndex(this.#state.detailItemIndex);

    if (this.#detailSelectionListenerBoundToId === detailList.id) {
      return;
    }

    this.#detailSelectionListenerBoundToId = detailList.id;
    detailList.on(SelectRenderableEvents.SELECTION_CHANGED, () => {
      this.#state.detailItemIndex = detailList.getSelectedIndex();
    });
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
