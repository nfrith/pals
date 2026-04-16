import { parseCliOptions } from "./cli.ts";
import { startDashboardService } from "./server/service.ts";

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2));

  if (options.mode === "tui") {
    const { runDashboardTui } = await import("./tui/app.ts");
    await runDashboardTui(options);
    return;
  }

  const service = await startDashboardService({
    systemRoot: options.systemRoot,
    host: options.host,
    port: options.port,
    pollMs: options.pollMs,
    telemetryLimit: options.telemetryLimit,
  });

  console.log(`[delamain-dashboard] system root: ${options.systemRoot}`);
  console.log(`[delamain-dashboard] listening: ${service.url}`);
  console.log(`[delamain-dashboard] web: ${service.url}/`);
  console.log(`[delamain-dashboard] events: ${service.url}/api/events`);

  const stop = async () => {
    await service.stop();
    process.exit(0);
  };

  process.on("SIGINT", () => void stop());
  process.on("SIGTERM", () => void stop());

  await new Promise<void>(() => {
    // Keep the service process alive until it is signalled.
  });
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

void main().catch((error) => {
  console.error(`[delamain-dashboard] ${formatError(error)}`);
  process.exit(1);
});
