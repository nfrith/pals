import type { DashboardSnapshot } from "./feed/types.ts";

export interface DashboardOverviewRoute {
  kind: "dashboard";
}

export interface DashboardJourneyRoute {
  kind: "journey";
  dispatcherName: string;
  selectedPhase: string | null;
  view: "customer" | "developer";
}

export type DashboardAppRoute = DashboardOverviewRoute | DashboardJourneyRoute;

export interface DashboardBootstrapPayload {
  route: DashboardAppRoute;
  snapshot: DashboardSnapshot;
}
