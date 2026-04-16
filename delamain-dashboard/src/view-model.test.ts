import { expect, test } from "bun:test";
import { createDashboardFixture } from "./test-fixtures.ts";
import { collectSystemSnapshot } from "./feed/collector.ts";
import { renderDispatcherCardsHtml } from "./server/html.ts";
import { buildDashboardViewModel } from "./view-model.ts";
import { renderTuiDocument } from "./tui/document.ts";

test("web and tui views are derived from the same dispatcher summary lines", async () => {
  const fixture = await createDashboardFixture("view-model");

  try {
    await fixture.appendFailure("ALS-002", "Shared failure message");
    const snapshot = await collectSystemSnapshot({
      systemRoot: fixture.root,
      telemetryLimit: 10,
    });

    const view = buildDashboardViewModel(snapshot);
    const card = view.dispatchers[0]!;
    const html = renderDispatcherCardsHtml(view);
    const tui = renderTuiDocument(snapshot);

    expect(html).toContain(card.name);
    expect(tui).toContain(card.name);
    expect(html).toContain(card.countsLine);
    expect(tui).toContain(card.countsLine);
    expect(html).toContain(card.recentLine);
    expect(tui).toContain(card.recentLine);
    expect(html).toContain(card.errorLine!);
    expect(tui).toContain(card.errorLine!);
  } finally {
    await fixture.cleanup();
  }
});
