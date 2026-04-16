import type { DashboardSnapshot } from "../feed/types.ts";
import { buildDashboardViewModel, type DashboardViewModel } from "../view-model.ts";

export function renderDashboardHtml(snapshot: DashboardSnapshot): string {
  const view = buildDashboardViewModel(snapshot);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Delamain Dashboard</title>
    <style>${styles()}</style>
  </head>
  <body>
    <main class="app-shell">
      <header class="hero">
        <div>
          <p class="eyebrow">ALS Runtime Monitor</p>
          <h1>${escapeHtml(view.title)}</h1>
          <p class="subtitle">${escapeHtml(view.subtitle)}</p>
        </div>
        <div class="hero-meta">
          <div>
            <span class="meta-label">Updated</span>
            <strong id="updated-at">${escapeHtml(view.generatedAtLabel)}</strong>
          </div>
          <div>
            <span class="meta-label">Feed</span>
            <strong id="connection-status">Live</strong>
          </div>
        </div>
      </header>
      <section class="summary-strip">
        <div class="summary-card">
          <span class="meta-label">Dispatchers</span>
          <strong id="dispatcher-count">${view.dispatcherCount}</strong>
        </div>
        <div class="summary-card">
          <span class="meta-label">Roots</span>
          <strong id="root-count">${view.rootCount}</strong>
        </div>
      </section>
      <section id="dispatchers" class="dispatcher-grid">${renderDispatcherCardsHtml(view)}</section>
    </main>
    <script>
      window.__ALS_DASHBOARD_INITIAL_SNAPSHOT__ = ${JSON.stringify(snapshot)};
    </script>
    <script type="module" src="/app.js"></script>
  </body>
</html>`;
}

export function renderDispatcherCardsHtml(view: DashboardViewModel): string {
  if (view.dispatchers.length === 0) {
    return `<article class="dispatcher-card empty"><p>No delamains discovered yet.</p></article>`;
  }

  return view.dispatchers.map((dispatcher) => `
    <article class="dispatcher-card state-${dispatcher.state}">
      <header class="card-header">
        <div>
          <p class="card-title">${escapeHtml(dispatcher.name)}</p>
          <p class="card-detail">${escapeHtml(dispatcher.detail)}</p>
        </div>
        <span class="state-pill">${escapeHtml(dispatcher.state)}</span>
      </header>
      <dl class="card-lines">
        <div><dt>Module</dt><dd>${escapeHtml(dispatcher.moduleLine)}</dd></div>
        <div><dt>Queue</dt><dd>${escapeHtml(dispatcher.queueLine)}</dd></div>
        <div><dt>Heartbeat</dt><dd>${escapeHtml(dispatcher.tickLine)}</dd></div>
        <div><dt>States</dt><dd>${escapeHtml(dispatcher.countsLine)}</dd></div>
        <div><dt>Recent</dt><dd>${escapeHtml(dispatcher.recentLine)}</dd></div>
        <div><dt>Telemetry</dt><dd>${escapeHtml(dispatcher.telemetryLine)}</dd></div>
      </dl>
      ${dispatcher.errorLine ? `<p class="error-line">${escapeHtml(dispatcher.errorLine)}</p>` : ""}
      ${dispatcher.itemLines.length > 0 ? `
        <ul class="items">
          ${dispatcher.itemLines.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}
        </ul>
      ` : ""}
    </article>
  `).join("");
}

export function renderDashboardClientScript(): string {
  return `const stateClass = (state) => "state-" + state;

const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;");

const formatAge = (ageMs) => {
  if (ageMs === null || ageMs === undefined) return "n/a";
  if (ageMs < 1000) return ageMs + "ms";
  const seconds = Math.round(ageMs / 1000);
  if (seconds < 60) return seconds + "s";
  const minutes = Math.floor(seconds / 60);
  const remSeconds = seconds % 60;
  if (minutes < 60) return remSeconds === 0 ? minutes + "m" : minutes + "m " + remSeconds + "s";
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  return remMinutes === 0 ? hours + "h" : hours + "h " + remMinutes + "m";
};

const formatDuration = (value) => value === null || value <= 0 ? "n/a" : formatAge(value);
const formatCurrency = (value) => value === null || value === undefined ? "n/a" : "$" + Number(value).toFixed(4);

const formatRecent = (dispatcher) => {
  if (dispatcher.recentRun) {
    const run = dispatcher.recentRun;
    const label = run.outcome === "success" ? "Recent success" : "Recent failure";
    return label + " • " + run.itemId + " • " + run.state + " • " + formatDuration(run.durationMs) + " • " + (run.numTurns === null ? "n/a" : run.numTurns + " turns") + " • " + formatCurrency(run.costUsd);
  }
  if (dispatcher.telemetry.legacyMode) return "Legacy dispatcher — recent history unavailable";
  return "No recent dispatch telemetry recorded";
};

const formatTelemetry = (dispatcher) =>
  dispatcher.telemetry.legacyMode
    ? "Telemetry file missing — heartbeat-only mode"
    : "Telemetry live • " + dispatcher.recentEvents.length + " recent events";

const formatCounts = (dispatcher) => {
  const entries = Object.entries(dispatcher.itemSummary.byState || {}).sort((a, b) => a[0].localeCompare(b[0]));
  if (entries.length === 0) return "No tracked items";
  return entries.map(([state, count]) => state + " " + count).join(" • ");
};

const formatTick = (dispatcher) =>
  dispatcher.lastTickAgeMs === null
    ? "No heartbeat age available"
    : "Last tick " + formatAge(dispatcher.lastTickAgeMs) + " ago • poll " + formatDuration(dispatcher.pollMs);

const formatModule = (dispatcher) =>
  dispatcher.moduleId
    ? dispatcher.moduleId + " • " + (dispatcher.entityName || "entity") + " • " + (dispatcher.entityPath || "unknown path")
    : "Runtime manifest unavailable";

const renderCards = (snapshot) => {
  if (!snapshot.dispatchers.length) {
    return '<article class="dispatcher-card empty"><p>No delamains discovered yet.</p></article>';
  }

  return snapshot.dispatchers.map((dispatcher) => {
    const items = dispatcher.items.slice(0, 5).map((item) => "<li>" + escapeHtml(item.id + " • " + item.status + " • " + item.type) + "</li>").join("");
    const errorLine = dispatcher.recentError
      ? '<p class="error-line">' + escapeHtml("Recent error • " + dispatcher.recentError.itemId + " • " + dispatcher.recentError.error) + "</p>"
      : "";

    return '<article class="dispatcher-card ' + stateClass(dispatcher.state) + '">' +
      '<header class="card-header"><div><p class="card-title">' + escapeHtml(dispatcher.name) + '</p><p class="card-detail">' + escapeHtml(dispatcher.detail) + '</p></div><span class="state-pill">' + escapeHtml(dispatcher.state) + '</span></header>' +
      '<dl class="card-lines">' +
      '<div><dt>Module</dt><dd>' + escapeHtml(formatModule(dispatcher)) + '</dd></div>' +
      '<div><dt>Queue</dt><dd>' + escapeHtml(dispatcher.activeDispatches + " active • " + dispatcher.itemSummary.totalItems + " tracked • " + dispatcher.itemsScanned + " scanned") + '</dd></div>' +
      '<div><dt>Heartbeat</dt><dd>' + escapeHtml(formatTick(dispatcher)) + '</dd></div>' +
      '<div><dt>States</dt><dd>' + escapeHtml(formatCounts(dispatcher)) + '</dd></div>' +
      '<div><dt>Recent</dt><dd>' + escapeHtml(formatRecent(dispatcher)) + '</dd></div>' +
      '<div><dt>Telemetry</dt><dd>' + escapeHtml(formatTelemetry(dispatcher)) + '</dd></div>' +
      '</dl>' + errorLine + (items ? '<ul class="items">' + items + '</ul>' : '') + '</article>';
  }).join("");
};

const formatUpdatedAt = (timestamp) => {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? timestamp : date.toLocaleString("en-US", {
    hour12: false,
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
};

const render = (snapshot) => {
  document.getElementById("dispatchers").innerHTML = renderCards(snapshot);
  document.getElementById("updated-at").textContent = formatUpdatedAt(snapshot.generatedAt);
  document.getElementById("dispatcher-count").textContent = String(snapshot.dispatcherCount);
  document.getElementById("root-count").textContent = String(snapshot.roots.length);
};

const initialSnapshot = window.__ALS_DASHBOARD_INITIAL_SNAPSHOT__;
render(initialSnapshot);

const connectionStatus = document.getElementById("connection-status");
const events = new EventSource("/api/events");
events.addEventListener("open", () => {
  connectionStatus.textContent = "Live";
});
events.addEventListener("snapshot", (event) => {
  connectionStatus.textContent = "Live";
  render(JSON.parse(event.data));
});
events.addEventListener("error", () => {
  connectionStatus.textContent = "Reconnecting";
});`;
}

function styles(): string {
  return `
    :root {
      color-scheme: dark;
      --bg-top: #15323a;
      --bg-bottom: #081117;
      --card: rgba(8, 20, 29, 0.78);
      --card-edge: rgba(247, 178, 103, 0.18);
      --ink: #eef7f2;
      --muted: #9db3aa;
      --accent: #f7b267;
      --live: #24b36b;
      --idle: #4ba3d9;
      --stale: #d8b14a;
      --offline: #6f7d89;
      --error: #ef6f6c;
      --mono: "IBM Plex Mono", "SFMono-Regular", ui-monospace, monospace;
      --sans: "IBM Plex Sans", "Avenir Next", "Segoe UI", sans-serif;
    }

    * { box-sizing: border-box; }

    body {
      margin: 0;
      min-height: 100vh;
      background:
        radial-gradient(circle at 20% 0%, rgba(247, 178, 103, 0.18), transparent 30%),
        radial-gradient(circle at 100% 20%, rgba(36, 179, 107, 0.14), transparent 28%),
        linear-gradient(180deg, var(--bg-top), var(--bg-bottom));
      color: var(--ink);
      font-family: var(--sans);
    }

    .app-shell {
      width: min(1440px, calc(100vw - 32px));
      margin: 0 auto;
      padding: 32px 0 40px;
    }

    .hero {
      display: flex;
      justify-content: space-between;
      gap: 24px;
      align-items: end;
      padding: 24px 28px 20px;
      border: 1px solid rgba(255, 255, 255, 0.08);
      background: linear-gradient(180deg, rgba(255, 255, 255, 0.06), rgba(255, 255, 255, 0.02));
      border-radius: 28px;
      backdrop-filter: blur(12px);
    }

    .eyebrow,
    .meta-label,
    .card-lines dt {
      margin: 0;
      font-family: var(--mono);
      letter-spacing: 0.08em;
      text-transform: uppercase;
      font-size: 0.74rem;
      color: var(--muted);
    }

    h1 {
      margin: 8px 0 6px;
      font-size: clamp(2.2rem, 4vw, 4rem);
      line-height: 0.95;
    }

    .subtitle {
      margin: 0;
      color: var(--muted);
      max-width: 60ch;
      word-break: break-word;
    }

    .hero-meta {
      display: grid;
      gap: 14px;
      min-width: 180px;
    }

    .hero-meta strong {
      display: block;
      margin-top: 4px;
      font-size: 1rem;
    }

    .summary-strip {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: 12px;
      margin: 18px 0 0;
    }

    .summary-card,
    .dispatcher-card {
      border: 1px solid var(--card-edge);
      background: var(--card);
      border-radius: 24px;
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.03);
      backdrop-filter: blur(12px);
    }

    .summary-card {
      padding: 18px 20px;
    }

    .summary-card strong {
      display: block;
      margin-top: 6px;
      font-size: 1.8rem;
    }

    .dispatcher-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
      gap: 16px;
      margin-top: 18px;
    }

    .dispatcher-card {
      padding: 20px;
      position: relative;
      overflow: hidden;
    }

    .dispatcher-card::after {
      content: "";
      position: absolute;
      inset: auto -24px -24px auto;
      width: 120px;
      height: 120px;
      border-radius: 999px;
      background: radial-gradient(circle, rgba(247, 178, 103, 0.18), transparent 70%);
      pointer-events: none;
    }

    .dispatcher-card.state-live { border-color: rgba(36, 179, 107, 0.35); }
    .dispatcher-card.state-idle { border-color: rgba(75, 163, 217, 0.35); }
    .dispatcher-card.state-stale { border-color: rgba(216, 177, 74, 0.35); }
    .dispatcher-card.state-offline { border-color: rgba(111, 125, 137, 0.35); }
    .dispatcher-card.state-error { border-color: rgba(239, 111, 108, 0.4); }

    .card-header {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      align-items: start;
      margin-bottom: 18px;
    }

    .card-title {
      margin: 0;
      font-size: 1.25rem;
      font-weight: 700;
    }

    .card-detail {
      margin: 6px 0 0;
      color: var(--muted);
    }

    .state-pill {
      padding: 8px 12px;
      border-radius: 999px;
      font-family: var(--mono);
      font-size: 0.78rem;
      text-transform: uppercase;
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid rgba(255, 255, 255, 0.08);
    }

    .card-lines {
      display: grid;
      gap: 12px;
      margin: 0;
    }

    .card-lines div {
      display: grid;
      gap: 4px;
    }

    .card-lines dd {
      margin: 0;
      line-height: 1.45;
      word-break: break-word;
    }

    .error-line {
      margin: 16px 0 0;
      padding: 12px 14px;
      border-radius: 16px;
      background: rgba(239, 111, 108, 0.12);
      color: #ffd8d6;
    }

    .items {
      list-style: none;
      padding: 0;
      margin: 16px 0 0;
      display: grid;
      gap: 8px;
      font-family: var(--mono);
      font-size: 0.92rem;
      color: var(--muted);
    }

    .items li {
      padding-top: 8px;
      border-top: 1px solid rgba(255, 255, 255, 0.06);
    }

    .empty {
      display: grid;
      place-items: center;
      min-height: 180px;
      color: var(--muted);
    }

    @media (max-width: 760px) {
      .app-shell {
        width: min(100vw - 20px, 100%);
        padding-top: 18px;
      }

      .hero {
        padding: 20px 18px;
        flex-direction: column;
        align-items: start;
      }

      .dispatcher-grid {
        grid-template-columns: 1fr;
      }
    }
  `;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
