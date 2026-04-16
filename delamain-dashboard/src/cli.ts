export interface ServiceCliOptions {
  mode: "service";
  systemRoot: string;
  host: string;
  port: number;
  pollMs: number;
  telemetryLimit: number;
}

export interface TuiCliOptions {
  mode: "tui";
  serviceUrl: string;
  refreshMs: number;
  screenMode: "alternate" | "normal";
  exitAfterMs: number | null;
}

export type CliOptions = ServiceCliOptions | TuiCliOptions;

export function parseCliOptions(argv: string[], cwd = process.cwd()): CliOptions {
  const args = [...argv];
  const mode = normalizeMode(args.shift());

  if (mode === "tui") {
    return {
      mode,
      serviceUrl: readStringFlag(args, "--service-url") ?? process.env["DELAMAIN_DASHBOARD_URL"] ?? "http://127.0.0.1:4646",
      refreshMs: readNumberFlag(args, "--refresh-ms") ?? 1000,
      screenMode: readStringFlag(args, "--screen-mode") === "normal" ? "normal" : "alternate",
      exitAfterMs: readNumberFlag(args, "--exit-after-ms") ?? null,
    };
  }

  return {
    mode,
    systemRoot: readStringFlag(args, "--system-root") ?? cwd,
    host: readStringFlag(args, "--host") ?? "127.0.0.1",
    port: readNumberFlag(args, "--port") ?? 4646,
    pollMs: readNumberFlag(args, "--poll-ms") ?? 1000,
    telemetryLimit: readNumberFlag(args, "--telemetry-limit") ?? 25,
  };
}

function normalizeMode(value: string | undefined): "service" | "tui" {
  if (value === "tui") return "tui";
  return "service";
}

function readStringFlag(args: string[], name: string): string | null {
  const index = args.indexOf(name);
  if (index === -1) return null;
  return args[index + 1] ?? null;
}

function readNumberFlag(args: string[], name: string): number | null {
  const value = readStringFlag(args, name);
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
