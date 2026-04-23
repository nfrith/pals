import { createRoot } from "react-dom/client";
import type { DashboardBootstrapPayload } from "../app-bootstrap.ts";
import { DashboardApp } from "./app.tsx";
import "./styles.css";

declare global {
  interface Window {
    __ALS_DASHBOARD_BOOTSTRAP__?: DashboardBootstrapPayload;
  }
}

const bootstrap = window.__ALS_DASHBOARD_BOOTSTRAP__;
const container = document.getElementById("app");

if (!bootstrap || !container) {
  throw new Error("Delamain dashboard bootstrap payload is missing");
}

createRoot(container).render(<DashboardApp bootstrap={bootstrap} />);
