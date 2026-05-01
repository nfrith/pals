import type { ConstructUpgradeTelemetryEvent } from "./types.ts";

export function createConstructUpgradeTelemetryEvent(
  construct: string,
  type: string,
  message: string,
  data: Record<string, unknown> = {},
): ConstructUpgradeTelemetryEvent {
  return {
    type,
    timestamp: new Date().toISOString(),
    construct,
    message,
    data,
  };
}
