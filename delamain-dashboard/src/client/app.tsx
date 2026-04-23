import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import {
  startTransition,
  useDeferredValue,
  useEffect,
  useEffectEvent,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import type { DashboardBootstrapPayload } from "../app-bootstrap.ts";
import type { DashboardSnapshot, DispatcherSnapshot } from "../feed/types.ts";
import { buildJourneyGraph, type JourneyNodeData } from "../journey.ts";
import { buildDashboardViewModel } from "../view-model.ts";

export function DashboardApp({
  bootstrap,
}: {
  bootstrap: DashboardBootstrapPayload;
}): ReactNode {
  const [snapshot, setSnapshot] = useState(bootstrap.snapshot);
  const [connectionStatus, setConnectionStatus] = useState("Live");
  const deferredSnapshot = useDeferredValue(snapshot);

  const applySnapshot = useEffectEvent((nextSnapshot: DashboardSnapshot) => {
    startTransition(() => {
      setSnapshot(nextSnapshot);
    });
  });

  useEffect(() => {
    const events = new EventSource("/api/events");
    events.addEventListener("open", () => setConnectionStatus("Live"));
    events.addEventListener("snapshot", (event) => {
      setConnectionStatus("Live");
      applySnapshot(JSON.parse((event as MessageEvent<string>).data) as DashboardSnapshot);
    });
    events.addEventListener("error", () => setConnectionStatus("Reconnecting"));
    return () => events.close();
  }, [applySnapshot]);

  return bootstrap.route.kind === "journey"
    ? (
      <JourneyPage
        connectionStatus={connectionStatus}
        dispatcherName={bootstrap.route.dispatcherName ?? ""}
        snapshot={deferredSnapshot}
      />
    )
    : <LandingPage connectionStatus={connectionStatus} snapshot={deferredSnapshot} />;
}

function LandingPage({
  connectionStatus,
  snapshot,
}: {
  connectionStatus: string;
  snapshot: DashboardSnapshot;
}): ReactNode {
  const view = useMemo(() => buildDashboardViewModel(snapshot), [snapshot]);
  const dispatchersByName = useMemo(
    () => new Map(snapshot.dispatchers.map((dispatcher) => [dispatcher.name, dispatcher])),
    [snapshot.dispatchers],
  );

  return (
    <main className="dashboard-shell">
      <header className="hero-panel">
        <div className="hero-copy">
          <p className="hero-eyebrow">ALS Runtime Monitor</p>
          <h1>{view.title}</h1>
          <p className="hero-subtitle">
            A React-delivered Delamain workbench for live queue health and journey inspection.
          </p>
          <p className="hero-path">{snapshot.systemRoot}</p>
        </div>
        <div className="hero-meta-grid">
          <HeroStat label="Updated" value={view.generatedAtLabel} />
          <HeroStat label="Feed" value={connectionStatus} />
          <HeroStat label="Active" value={String(view.summary.activeDispatchCount)} />
          <HeroStat label="Spend" value={view.summary.totalSpendLabel} />
        </div>
      </header>

      <section className="summary-strip">
        <SummaryCard label="Dispatchers" value={String(view.dispatcherCount)} detail={view.summary.stateSummaryLine} />
        <SummaryCard label="Roots" value={String(view.rootCount)} detail={snapshot.roots.join(" • ")} />
        <SummaryCard label="Metered Runs" value={String(view.summary.totalSpendEventCount)} detail="Recent telemetry-backed finishes" />
      </section>

      <section className="dispatcher-grid">
        {view.dispatchers.map((dispatcherView, index) => {
          const dispatcher = dispatchersByName.get(dispatcherView.name);
          if (!dispatcher) return null;
          return (
            <article
              key={dispatcher.name}
              className={`dispatcher-card state-${dispatcher.state}`}
              style={{ animationDelay: `${index * 70}ms` } as CSSProperties}
            >
              <header className="card-header">
                <div>
                  <div className="card-heading-row">
                    <h2>{dispatcher.name}</h2>
                    <StatePill state={dispatcher.state} />
                  </div>
                  <p className="card-detail">{dispatcherView.detail}</p>
                </div>
                <a className="journey-link" href={`/journey/${encodeURIComponent(dispatcher.name)}`}>
                  Journey
                </a>
              </header>

              <div className="card-section-grid">
                <InfoBlock label="Module" value={dispatcherView.moduleLine} />
                <InfoBlock label="Queue" value={dispatcherView.queueLine} />
                <InfoBlock label="Heartbeat" value={dispatcherView.tickLine} />
                <InfoBlock label="Recent" value={dispatcherView.recentLine} />
                <InfoBlock label="Spend" value={dispatcherView.spendLine} />
                <InfoBlock label="Telemetry" value={dispatcherView.telemetryLine} />
              </div>

              <div className="card-phase-strip">
                {dispatcher.phaseOrder.map((phase) => (
                  <span key={phase}>{phase}</span>
                ))}
              </div>

              <div className="card-journal">
                <span>{Object.keys(dispatcher.states).length} states</span>
                <span>{dispatcher.transitions?.length ?? 0} transitions</span>
                <span>{dispatcher.runtime.active.length} active jobs</span>
                <span>{dispatcher.journeyTelemetry?.recentEdges.length ?? 0} recent edges</span>
              </div>

              {dispatcherView.errorLine ? <p className="card-error">{dispatcherView.errorLine}</p> : null}

              <ul className="card-list">
                {dispatcherView.itemLines.slice(0, 5).map((line) => <li key={line}>{line}</li>)}
              </ul>
            </article>
          );
        })}
      </section>
    </main>
  );
}

function JourneyPage({
  connectionStatus,
  dispatcherName,
  snapshot,
}: {
  connectionStatus: string;
  dispatcherName: string;
  snapshot: DashboardSnapshot;
}): ReactNode {
  const dispatcher = snapshot.dispatchers.find((item) => item.name === dispatcherName) ?? null;

  if (!dispatcher) {
    return (
      <main className="dashboard-shell">
        <header className="hero-panel journey-hero">
          <div className="hero-copy">
            <p className="hero-eyebrow">Journey View</p>
            <h1>Delamain not found</h1>
            <p className="hero-subtitle">
              The requested dispatcher is not present in the current snapshot for this system root.
            </p>
          </div>
          <div className="hero-meta-grid">
            <HeroStat label="Feed" value={connectionStatus} />
            <HeroStat label="Updated" value={formatTimestamp(snapshot.generatedAt)} />
          </div>
        </header>
        <a className="back-link" href="/">Back to dashboard</a>
      </main>
    );
  }

  const journey = useMemo(() => buildJourneyGraph(dispatcher), [dispatcher]);
  const telemetry = dispatcher.journeyTelemetry ?? { activeJobs: [], recentEdges: [] };

  return (
    <main className="dashboard-shell">
      <header className="hero-panel journey-hero">
        <div className="hero-copy">
          <a className="back-link" href="/">Overview</a>
          <p className="hero-eyebrow">Journey View</p>
          <h1>{dispatcher.name}</h1>
          <p className="hero-subtitle">{dispatcher.moduleId ?? "module unavailable"} • {dispatcher.entityPath ?? "entity path unavailable"}</p>
          <div className="hero-phase-row">
            {journey.contract.phases.map((phase) => (
              <span
                key={phase}
                className="phase-chip"
                style={{ "--phase-color": journey.palette[phase] } as CSSProperties}
              >
                {phase}
              </span>
            ))}
          </div>
        </div>
        <div className="hero-meta-grid">
          <HeroStat label="Feed" value={connectionStatus} />
          <HeroStat label="States" value={String(journey.nodes.length)} />
          <HeroStat label="Edges" value={String(journey.edges.length)} />
          <HeroStat label="Updated" value={formatTimestamp(snapshot.generatedAt)} />
        </div>
      </header>

      <section className="journey-layout">
        <div className="journey-panel">
          <div className="journey-panel-header">
            <div>
              <p className="section-label">State Machine</p>
              <h2>Compiled journey graph</h2>
            </div>
            <div className="journey-caption">
              Hover nodes and edges for state metadata. Drag to pan. Scroll to zoom.
            </div>
          </div>
          <div className="journey-phase-scale">
            {journey.contract.phases.map((phase) => (
              <div
                key={phase}
                className="journey-phase-scale-item"
                style={{ "--phase-color": journey.palette[phase] } as CSSProperties}
              >
                <span>{phase}</span>
              </div>
            ))}
          </div>
          <ReactFlow
            className="journey-flow"
            defaultViewport={journey.viewport}
            edges={journey.edges}
            fitView
            nodeTypes={{ journey: JourneyNode }}
            nodes={journey.nodes}
          >
            <Background color="rgba(255,255,255,0.065)" gap={28} size={1.3} />
            <MiniMap />
            <Controls />
          </ReactFlow>
        </div>

        <aside className="journey-sidebar">
          <SidebarCard title="Legend">
            <LegendItem className="legend-line advance" label="Advance edge" />
            <LegendItem className="legend-line rework" label="Rework edge" />
            <LegendItem className="legend-line exit" label="Exit edge" />
            <LegendItem className="legend-shape agent" label="Agent state" />
            <LegendItem className="legend-shape operator" label="Operator state" />
            <LegendItem className="legend-shape terminal" label="Terminal state" />
          </SidebarCard>

          <SidebarCard title="Runtime seam">
            <MetricLine label="Active jobs" value={String(telemetry.activeJobs.length)} />
            <MetricLine label="Recent edges" value={String(telemetry.recentEdges.length)} />
            <MetricLine label="Bundle root" value={dispatcher.bundleRoot} />
            <MetricLine label="Heartbeat" value={dispatcher.detail} />
          </SidebarCard>

          <SidebarCard title="Recent edge activity">
            {telemetry.recentEdges.length === 0 ? (
              <p className="sidebar-empty">No recent transition telemetry recorded.</p>
            ) : (
              <ul className="sidebar-list">
                {telemetry.recentEdges.slice(0, 6).map((edge) => (
                  <li key={`${edge.from}-${edge.to}-${edge.t}`}>
                    <strong>{edge.from}</strong>
                    <span>{edge.to}</span>
                    <em>{formatTimestamp(edge.t)}</em>
                  </li>
                ))}
              </ul>
            )}
          </SidebarCard>
        </aside>
      </section>
    </main>
  );
}

function JourneyNode({ data }: NodeProps<Node<JourneyNodeData, "journey">>): ReactNode {
  return (
    <div
      className={`journey-node journey-node-${data.actor ?? "terminal"}`}
      style={{ "--journey-accent": data.color } as CSSProperties}
    >
      <Handle position={Position.Left} type="target" />
      {!data.terminal ? <Handle position={Position.Right} type="source" /> : null}
      <span className="journey-node-orbit" />
      <div className="journey-node-copy">
        <span className="journey-node-badge">{data.badge}</span>
        <strong>{data.stateName}</strong>
        <small>{data.description}</small>
      </div>
    </div>
  );
}

function HeroStat({ label, value }: { label: string; value: string }): ReactNode {
  return (
    <div className="hero-stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function SummaryCard({ detail, label, value }: { detail: string; label: string; value: string }): ReactNode {
  return (
    <article className="summary-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <p>{detail}</p>
    </article>
  );
}

function InfoBlock({ label, value }: { label: string; value: string }): ReactNode {
  return (
    <div className="info-block">
      <span>{label}</span>
      <p>{value}</p>
    </div>
  );
}

function StatePill({ state }: { state: DispatcherSnapshot["state"] }): ReactNode {
  return <span className={`state-pill state-pill-${state}`}>{state}</span>;
}

function SidebarCard({ children, title }: { children: ReactNode; title: string }): ReactNode {
  return (
    <section className="sidebar-card">
      <p className="section-label">{title}</p>
      {children}
    </section>
  );
}

function MetricLine({ label, value }: { label: string; value: string }): ReactNode {
  return (
    <div className="metric-line">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function LegendItem({ className, label }: { className: string; label: string }): ReactNode {
  return (
    <div className="legend-item">
      <span className={className} />
      <span>{label}</span>
    </div>
  );
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-US", {
    hour12: false,
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}
