import type { DashboardBootstrapPayload } from "../app-bootstrap.ts";

export function renderDashboardHtml(
  bootstrap: DashboardBootstrapPayload,
  assets: {
    scriptPaths: string[];
    stylePaths: string[];
  },
): string {
  const serialized = JSON.stringify(bootstrap).replaceAll("<", "\\u003c");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Delamain Dashboard</title>
    ${assets.stylePaths.map((path) => `<link rel="stylesheet" href="${path}" />`).join("\n    ")}
  </head>
  <body>
    <div id="app"></div>
    <script>
      window.__ALS_DASHBOARD_BOOTSTRAP__ = ${serialized};
    </script>
    ${assets.scriptPaths.map((path) => `<script type="module" src="${path}"></script>`).join("\n    ")}
  </body>
</html>`;
}
