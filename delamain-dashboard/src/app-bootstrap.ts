import type { DashboardSnapshot } from "./feed/types.ts";

export interface DashboardAppRoute {
  kind: "dashboard" | "journey";
  dispatcherName?: string;
}

export interface DashboardBootstrapPayload {
  route: DashboardAppRoute;
  snapshot: DashboardSnapshot;
}
