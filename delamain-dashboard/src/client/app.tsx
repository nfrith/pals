import {
  Background,
  Handle,
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
import type { DashboardBootstrapPayload, DashboardJourneyRoute } from "../app-bootstrap.ts";
import { buildCustomerJourneyProjection } from "../customer-journey.ts";
import type { DashboardSnapshot, DispatcherSnapshot } from "../feed/types.ts";
import {
  buildJourneyGraph,
  type JourneyAnchorData,
  type JourneyLaneData,
  type JourneyNodeData,
} from "../journey.ts";
import { buildDashboardViewModel } from "../view-model.ts";

const PIPELINE_ACCENTS = ["#d4a857", "#74abd4", "#7dc99b", "#d66e62", "#9f96e5", "#d96f89"];

const EMPTY_TELEMETRY = {
  activeJobs: [],
  recentEdges: [],
} as const;

const JOURNEY_NODE_TYPES = {
  journey: JourneyNode,
  journeyAnchor: JourneyAnchor,
  journeyLane: JourneyLane,
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
        route={bootstrap.route}
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
            A React-delivered Delamain workbench for live queue health and customer-facing journey inspection.
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
                <a className="journey-link" href={buildJourneyHref(dispatcher.name, null, "customer")}>
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
  route,
  snapshot,
}: {
  connectionStatus: string;
  route: DashboardJourneyRoute;
  snapshot: DashboardSnapshot;
}): ReactNode {
  const dispatcher = snapshot.dispatchers.find((item) => item.name === route.dispatcherName) ?? null;
  const journey = useMemo(() => dispatcher ? buildJourneyGraph(dispatcher) : null, [dispatcher]);
  const flowNodes = useMemo<Node[]>(
    () => journey ? [...journey.lanes, ...journey.anchors, ...journey.nodes] : [],
    [journey],
  );
  const customerView = useMemo(
    () => dispatcher
      ? buildCustomerJourneyProjection(dispatcher, {
        now: new Date(snapshot.generatedAt),
        selectedPhase: route.selectedPhase,
      })
      : null,
    [dispatcher, route.selectedPhase, snapshot.generatedAt],
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
            <StatusChip label={route.view === "developer" ? "Developer mode" : "Customer mode"} tone="neutral" />
            <StatusChip label={connectionStatus} tone={connectionStatus === "Live" ? "live" : "warn"} />
            <StatusChip label={dispatcher.runtime.available ? "Runtime connected" : "Runtime unavailable"} tone={dispatcher.runtime.available ? "live" : "offline"} />
            <StatusChip label={`Dispatcher ${dispatcher.state}`} tone={dispatcher.state} />
            <StatusChip label={`System ${labelForSystemRoot(snapshot.systemRoot)}`} tone="neutral" />
          </div>
          <div className="journey-mode-toggle">
            <a
              className={route.view === "customer" ? "journey-mode-link is-active" : "journey-mode-link"}
              href={buildJourneyHref(dispatcher.name, route.selectedPhase, "customer")}
            >
              Customer
            </a>
            <a
              className={route.view === "developer" ? "journey-mode-link is-active" : "journey-mode-link"}
              href={buildJourneyHref(dispatcher.name, route.selectedPhase, "developer")}
            >
              Developer
            </a>
          </div>
          <p className="journey-caption">
            {route.view === "developer"
              ? "Compiled graph projected from the deployed artifact. Smoothstep edges replace the retired ALS-049 custom router."
              : "Customer pipeline projected from v4 state labels, terminal outcomes, and customer buckets."}
          </p>
        </div>
      </header>

      {route.view === "developer"
        ? (
          <DeveloperJourneyView
            connectionStatus={connectionStatus}
            dispatcher={dispatcher}
            flowNodes={flowNodes}
            journey={journey}
          />
        )
        : customerView
          ? (
            <CustomerJourneyView
              dispatcher={dispatcher}
              projection={customerView}
            />
          )
          : null}
    </main>
  );
}

function CustomerJourneyView({
  dispatcher,
  projection,
}: {
  dispatcher: DispatcherSnapshot;
  projection: ReturnType<typeof buildCustomerJourneyProjection>;
}): ReactNode {
  if (!projection.available) {
    return (
      <section className="journey-panel customer-empty-state">
        <div className="journey-panel-header">
          <div>
            <p className="section-label">Customer View</p>
            <h2>Contract unavailable</h2>
          </div>
        </div>
        <p className="sidebar-empty">{projection.errorMessage}</p>
      </section>
    );
  }

  return (
    <section className="customer-journey-shell">
      <div className="customer-pipeline-strip">
        {projection.phases.map((phase, index) => (
          <PipelinePhaseCard
            key={phase.phase}
            dispatcherName={dispatcher.name}
            isLast={index === projection.phases.length - 1}
            phase={phase}
            phaseAccent={PIPELINE_ACCENTS[index % PIPELINE_ACCENTS.length]!}
          />
        ))}
      </div>

      <section className="journey-panel customer-detail-panel">
        <div className="journey-panel-header">
          <div>
            <p className="section-label">Phase Drill-In</p>
            <h2>{projection.phaseDetail?.label ?? "Select a phase"}</h2>
          </div>
          <div className="journey-caption">
            {projection.phaseDetail
              ? "Waiting, active, and recent movement are all derived from live runtime state plus telemetry."
              : "Open a phase card to inspect the customer-facing work inside that stage."}
          </div>
        </div>

        {!projection.selectedPhase ? (
          <p className="sidebar-empty">
            Choose a phase from the pipeline above to open its customer-facing drill-in.
          </p>
        ) : !projection.phaseDetail ? (
          <p className="sidebar-empty">
            The selected phase is not present in the compiled journey definition.
          </p>
        ) : (
          <div className="customer-detail-grid">
            <CustomerDetailSection
              className="waiting"
              count={projection.phaseDetail.waitingRows.length}
              title="Waiting for you"
            >
              {projection.phaseDetail.waitingRows.length === 0 ? (
                <p className="sidebar-empty">No work in this phase is currently waiting on the operator.</p>
              ) : (
                <ul className="customer-row-list">
                  {projection.phaseDetail.waitingRows.map((row) => (
                    <li key={`${row.itemId}-waiting`} className="customer-row">
                      <div className="customer-row-copy">
                        <strong>{row.title}</strong>
                        <p>{row.stateLabel}</p>
                      </div>
                      <div className="customer-row-meta">
                        <span>{row.timestampLabel}</span>
                        <span className="customer-action-chip">{row.actionLabel}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CustomerDetailSection>

            <CustomerDetailSection
              className="active"
              count={projection.phaseDetail.activeRows.length}
              title="Active"
            >
              {projection.phaseDetail.activeRows.length === 0 ? (
                <p className="sidebar-empty">No active runtime work is currently tracked in this phase.</p>
              ) : (
                <ul className="customer-row-list">
                  {projection.phaseDetail.activeRows.map((row) => (
                    <li key={`${row.itemId}-active`} className="customer-row">
                      <div className="customer-row-copy">
                        <strong>{row.title}</strong>
                        <p>{row.stateLabel}</p>
                        <div className="customer-progress-bar">
                          <span />
                        </div>
                      </div>
                      <div className="customer-row-meta">
                        <span>{row.timestampLabel}</span>
                        <span className="customer-action-chip">{row.progressLabel}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CustomerDetailSection>

            <CustomerDetailSection
              className="recent"
              count={projection.phaseDetail.recentRows.length}
              title="Recently advanced"
            >
              {projection.phaseDetail.recentRows.length === 0 ? (
                <p className="sidebar-empty">No telemetry-backed phase movement was observed here in the last 7 days.</p>
              ) : (
                <ul className="customer-row-list">
                  {projection.phaseDetail.recentRows.map((row) => (
                    <li key={`${row.itemId}-${row.transitionLabel}`} className="customer-row">
                      <div className="customer-row-copy">
                        <strong>{row.title}</strong>
                        <p>{row.transitionLabel}</p>
                      </div>
                      <div className="customer-row-meta">
                        <span>{row.timestampLabel}</span>
                        {row.outcomeIcon ? <span className="customer-outcome-chip">{row.outcomeIcon}</span> : null}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CustomerDetailSection>
          </div>
        )}
      </section>
    </section>
  );
}

function DeveloperJourneyView({
  connectionStatus,
  dispatcher,
  flowNodes,
  journey,
}: {
  connectionStatus: string;
  dispatcher: DispatcherSnapshot;
  flowNodes: Node[];
  journey: ReturnType<typeof buildJourneyGraph>;
}): ReactNode {
  const telemetry = dispatcher.journeyTelemetry ?? EMPTY_TELEMETRY;
  const edgeCounts = journey.summary.edgeCounts;

  return (
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

        <SidebarCard title="Runtime">
          <div className="journey-runtime-stack">
            <StatusChip label={connectionStatus} tone={connectionStatus === "Live" ? "live" : "warn"} />
            <StatusChip label={dispatcher.runtime.available ? "Runtime connected" : "Runtime unavailable"} tone={dispatcher.runtime.available ? "live" : "offline"} />
          </div>
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
  );
}

function PipelinePhaseCard({
  dispatcherName,
  isLast,
  phase,
  phaseAccent,
}: {
  dispatcherName: string;
  isLast: boolean;
  phase: ReturnType<typeof buildCustomerJourneyProjection>["phases"][number];
  phaseAccent: string;
}): ReactNode {
  const closedTotal = phase.closedCounts.success + phase.closedCounts.stopped + phase.closedCounts.errored;

  return (
    <>
      <a
        className={[
          "pipeline-card",
          phase.selected ? "is-selected" : "",
          phase.live ? "is-live" : "",
          phase.needsAttention ? "needs-attention" : "",
        ].filter(Boolean).join(" ")}
        href={buildJourneyHref(dispatcherName, phase.phase, "customer")}
        style={{ "--phase-accent": phaseAccent } as CSSProperties}
      >
        <div className="pipeline-card-header">
          <span className="pipeline-card-label">{phase.label}</span>
          {phase.needsAttention ? <span className="pipeline-badge">Needs you</span> : null}
        </div>
        <div className="pipeline-metrics">
          <PipelineMetric label="Active" value={String(phase.activeCount)} />
          <PipelineMetric label="Waiting" value={String(phase.waitingCount)} />
          {closedTotal > 0 ? (
            <div className="pipeline-closed-group">
              <span>Closed</span>
              <div className="pipeline-closed-counts">
                <span>✓ {phase.closedCounts.success}</span>
                <span>⊘ {phase.closedCounts.stopped}</span>
                <span>⚠ {phase.closedCounts.errored}</span>
              </div>
            </div>
          ) : null}
        </div>
        <div className="pipeline-card-footer">
          <span>{phase.live ? "Runtime active" : "Open drill-in"}</span>
          {phase.recentTransition ? <span className="pipeline-foot-chip">Recent movement</span> : null}
        </div>
        <span className="pipeline-card-signal" />
      </a>
      {!isLast ? <PipelineConnector animated={phase.recentTransition} /> : null}
    </>
  );
}

function PipelineMetric({ label, value }: { label: string; value: string }): ReactNode {
  return (
    <div className="pipeline-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function PipelineConnector({ animated }: { animated: boolean }): ReactNode {
  return (
    <div className={animated ? "pipeline-connector is-animated" : "pipeline-connector"}>
      <span className="pipeline-connector-line" />
      <span className="pipeline-connector-arrow">►</span>
      <span className="pipeline-connector-bead" />
    </div>
  );
}

function CustomerDetailSection({
  children,
  className,
  count,
  title,
}: {
  children: ReactNode;
  className: string;
  count: number;
  title: string;
}): ReactNode {
  return (
    <section className={`customer-detail-section ${className}`}>
      <div className="customer-detail-heading">
        <div>
          <p className="section-label">{title}</p>
          <h3>{count}</h3>
        </div>
      </div>
      {children}
    </section>
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
      <span className={data.live ? "journey-node-signal is-live" : "journey-node-signal"} />
      {data.outcomeIcon ? <span className="journey-node-outcome">{data.outcomeIcon}</span> : null}
      <div className="journey-node-copy">
        <span className="journey-node-badge">{data.badge}</span>
        <strong>{data.label}</strong>
        <small className="journey-node-state-id">{data.stateName}</small>
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

function buildJourneyHref(
  dispatcherName: string,
  selectedPhase: string | null,
  view: "customer" | "developer",
): string {
  const encodedDispatcher = encodeURIComponent(dispatcherName);
  const phaseSegment = selectedPhase ? `/${encodeURIComponent(selectedPhase)}` : "";
  const search = view === "developer" ? "?view=developer" : "";
  return `/journey/${encodedDispatcher}${phaseSegment}${search}`;
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
