import { createTestRenderer } from "@opentui/core/testing";
import { createDesignDashboardSnapshot } from "./test-fixtures.ts";
import { buildDashboardViewModel } from "./view-model.ts";
import { renderDashboardTuiScene } from "./tui/render.ts";

interface SmokeFrame {
  height: number;
  selectedDispatcherIndex: number;
  title: string;
  viewMode: "detail" | "overview";
  width: number;
}

async function main(): Promise<void> {
  const compact = process.argv.includes("--compact");
  const snapshot = createDesignDashboardSnapshot();
  const view = buildDashboardViewModel(snapshot);
  const frames: SmokeFrame[] = compact
    ? [
      { title: "Compact Overview", viewMode: "overview", width: 48, height: 40, selectedDispatcherIndex: 0 },
      { title: "Compact Detail", viewMode: "detail", width: 48, height: 40, selectedDispatcherIndex: 0 },
    ]
    : [
      { title: "Wide Overview", viewMode: "overview", width: 120, height: 40, selectedDispatcherIndex: 0 },
      { title: "Detail", viewMode: "detail", width: 120, height: 40, selectedDispatcherIndex: 0 },
    ];

  for (const frame of frames) {
    const { renderer, renderOnce, captureCharFrame } = await createTestRenderer({
      width: frame.width,
      height: frame.height,
    });

    try {
      renderDashboardTuiScene(renderer, view, {
        detailItemIndex: 0,
        errorMessage: null,
        selectedDispatcherIndex: frame.selectedDispatcherIndex,
        serviceUrl: "http://127.0.0.1:4646",
        viewMode: frame.viewMode,
      });
      renderer.requestRender();
      await renderOnce();
      console.log(`# ${frame.title}`);
      console.log(trimFrame(captureCharFrame()));
      console.log("");
    } finally {
      renderer.destroy();
    }
  }
}

function trimFrame(frame: string): string {
  return frame
    .split("\n")
    .map((line) => line.replace(/\s+$/u, ""))
    .join("\n")
    .trimEnd();
}

void main().catch((error) => {
  const detail = error instanceof Error ? error.message : String(error);
  console.error(`[smoke-design] ${detail}`);
  process.exit(1);
});
