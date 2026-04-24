import {
  Background,
  BaseEdge,
  Handle,
  Position,
  ReactFlow,
  getBezierPath,
  type Edge,
  type EdgeProps,
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
import {
  buildJourneyGraph,
  type JourneyAnchorData,
  type JourneyEdgeData,
  type JourneyLaneData,
  type JourneyNodeData,
} from "../journey.ts";
import { buildDashboardViewModel } from "../view-model.ts";

const EMPTY_TELEMETRY = {
  activeJobs: [],
  recentEdges: [],
} as const;

const JOURNEY_NODE_TYPES = {
  journey: JourneyNode,
  journeyAnchor: JourneyAnchor,
  journeyLane: JourneyLane,
};

const JOURNEY_EDGE_TYPES = {
  journey: JourneyEdge,
};

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
  const journey = useMemo(() => dispatcher ? buildJourneyGraph(dispatcher) : null, [dispatcher]);
  const flowNodes = useMemo<Node[]>(
    () => journey ? [...journey.lanes, ...journey.anchors, ...journey.nodes] : [],
    [journey],
  );

  if (!dispatcher || !journey) {
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

  const telemetry = dispatcher.journeyTelemetry ?? EMPTY_TELEMETRY;
  const edgeCounts = journey.summary.edgeCounts;

  return (
    <main className="dashboard-shell">
      <header className="hero-panel journey-hero">
        <div className="hero-copy">
          <a className="back-link" href="/">Overview</a>
          <p className="hero-eyebrow">Journey View</p>
          <h1>{dispatcher.name}</h1>
          <p className="hero-subtitle">{dispatcher.moduleId ?? "module unavailable"} • {dispatcher.entityPath ?? "entity path unavailable"}</p>
          <p className="hero-path">{dispatcher.bundleRoot}</p>
        </div>
        <div className="journey-hero-meta">
          <div className="journey-status-cluster">
            <StatusChip label="Compiled journey graph" tone="neutral" />
            <StatusChip label={connectionStatus} tone={connectionStatus === "Live" ? "live" : "warn"} />
            <StatusChip label={dispatcher.runtime.available ? "Runtime connected" : "Runtime unavailable"} tone={dispatcher.runtime.available ? "live" : "offline"} />
            <StatusChip label={`Dispatcher ${dispatcher.state}`} tone={dispatcher.state} />
            <StatusChip label={`System ${labelForSystemRoot(snapshot.systemRoot)}`} tone="neutral" />
          </div>
          <p className="journey-caption">
            Exit funnels are grouped for readability. Counts below still reflect the raw compiled definition.
          </p>
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
              Hover nodes and edges for compiled metadata. Drag to pan. Scroll to zoom.
            </div>
          </div>
          <ReactFlow
            className="journey-flow"
            defaultViewport={journey.viewport}
            edgeTypes={JOURNEY_EDGE_TYPES}
            edges={journey.edges}
            fitView
            fitViewOptions={{ maxZoom: 1.05, minZoom: 0.5, padding: 0.14 }}
            maxZoom={1.5}
            minZoom={0.35}
            nodeTypes={JOURNEY_NODE_TYPES}
            nodes={flowNodes}
            proOptions={{ hideAttribution: true }}
            style={{ "--journey-flow-height": `${journey.layout.canvasHeight}px` } as CSSProperties}
          >
            <Background color="rgba(255,255,255,0.048)" gap={28} size={1.25} />
          </ReactFlow>
          <div className="journey-metadata-strip">
            <MetadataItem label="Journey" value={dispatcher.name} />
            <MetadataItem label="Nodes" value={String(journey.summary.rawNodeCount)} />
            <MetadataItem
              label="Edges"
              value={`${journey.summary.rawEdgeCount} (${edgeCounts.advance} adv / ${edgeCounts.rework} rework / ${edgeCounts.exit} exit)`}
            />
            <MetadataItem label="Status" tone={dispatcher.state} value={dispatcher.state} />
            <MetadataItem label="Heartbeat" value={formatHeartbeatAge(dispatcher)} />
          </div>
        </div>

        <aside className="journey-sidebar">
          <SidebarCard title="Legend">
            <LegendItem className="legend-line advance" label="Advance edge" />
            <LegendItem className="legend-line rework" label="Rework edge" />
            <LegendItem className="legend-line exit" label="Exit edge" />
            <LegendItem className="legend-shape agent anthropic" label="Anthropic agent" />
            <LegendItem className="legend-shape agent openai" label="OpenAI agent" />
            <LegendItem className="legend-shape operator" label="Operator state" />
            <LegendItem className="legend-shape terminal" label="Terminal state" />
          </SidebarCard>

          <SidebarCard title="Active Jobs">
            {telemetry.activeJobs.length === 0 ? (
              <p className="sidebar-empty">No runtime dispatches are currently tracked for this journey.</p>
            ) : (
              <ul className="active-job-list">
                {telemetry.activeJobs.map((job) => (
                  <li key={job.dispatchId} className={`active-job status-${job.status}`}>
                    <div className="active-job-header">
                      <strong>{job.dispatchId}</strong>
                      <span className={`job-chip job-chip-status-${job.status}`}>{job.status}</span>
                    </div>
                    <p className="active-job-state">{job.state}</p>
                    <div className="active-job-meta">
                      <span className={`job-chip job-chip-provider-${job.provider}`}>{job.provider}</span>
                      <span>{job.jobId}</span>
                      <span>{formatDuration(job.age_ms)}</span>
                    </div>
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
      className={[
        "journey-node",
        `journey-node-${data.actor ?? "terminal"}`,
        data.provider ? `journey-node-provider-${data.provider}` : "",
      ].filter(Boolean).join(" ")}
      style={{ "--journey-accent": data.color } as CSSProperties}
      title={data.tooltip}
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

function JourneyLane({ data }: NodeProps<Node<JourneyLaneData, "journeyLane">>): ReactNode {
  return (
    <div
      className="journey-lane"
      style={{ "--phase-color": data.color } as CSSProperties}
      title={`${data.phase} • ${data.stateCount} state${data.stateCount === 1 ? "" : "s"}`}
    >
      <div className="journey-lane-header">
        <span>{data.phase}</span>
        <small>{data.stateCount} state{data.stateCount === 1 ? "" : "s"}</small>
      </div>
    </div>
  );
}

function JourneyAnchor({ data }: NodeProps<Node<JourneyAnchorData, "journeyAnchor">>): ReactNode {
  return (
    <div className="journey-anchor" title={`Grouped exit anchor • ${data.phase} -> ${data.target}`}>
      <Handle className="journey-anchor-handle" position={Position.Right} type="source" />
    </div>
  );
}

function JourneyEdge({
  id,
  data,
  markerEnd,
  sourcePosition,
  sourceX,
  sourceY,
  targetPosition,
  targetX,
  targetY,
}: EdgeProps<Edge<JourneyEdgeData, "journey">>): ReactNode {
  const edgeClassName = [
    "journey-edge",
    `journey-edge-${data?.class ?? "advance"}`,
    data?.aggregated ? "journey-edge-aggregated" : "",
  ].filter(Boolean).join(" ");
  const [path] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    curvature: data?.class === "rework" ? 0.38 : data?.aggregated ? 0.28 : 0.24,
  });

  return (
    <g>
      {data?.tooltip ? <title>{data.tooltip}</title> : null}
      <BaseEdge className={edgeClassName} id={id} markerEnd={markerEnd} path={path} />
    </g>
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

function LegendItem({ className, label }: { className: string; label: string }): ReactNode {
  return (
    <div className="legend-item">
      <span className={className} />
      <span>{label}</span>
    </div>
  );
}

function StatusChip({
  label,
  tone,
}: {
  label: string;
  tone: DispatcherSnapshot["state"] | "live" | "neutral" | "offline" | "warn";
}): ReactNode {
  return <span className={`status-chip status-chip-${tone}`}>{label}</span>;
}

function MetadataItem({
  label,
  tone,
  value,
}: {
  label: string;
  tone?: DispatcherSnapshot["state"];
  value: string;
}): ReactNode {
  return (
    <div className="metadata-item">
      <span>{label}</span>
      <strong className={tone ? `metadata-tone-${tone}` : undefined}>{value}</strong>
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

function formatDuration(valueMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(valueMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function formatHeartbeatAge(dispatcher: DispatcherSnapshot): string {
  if (dispatcher.lastTickAgeMs === null) return dispatcher.detail;
  return `${formatDuration(dispatcher.lastTickAgeMs)} ago`;
}

function labelForSystemRoot(systemRoot: string): string {
  const segments = systemRoot.split("/").filter(Boolean);
  return segments.at(-1) ?? systemRoot;
}
