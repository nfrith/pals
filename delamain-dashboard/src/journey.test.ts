import { expect, test } from "bun:test";
import { createDashboardFixture } from "./test-fixtures.ts";
import { collectSystemSnapshot } from "./feed/collector.ts";
import { buildJourneyGraph, createJourneyGraphContract } from "./journey.ts";

test("journey graph expands dispatcher transitions into pannable node-edge data", async () => {
  const fixture = await createDashboardFixture("journey");

  try {
    const snapshot = await collectSystemSnapshot({
      systemRoot: fixture.root,
      telemetryLimit: 10,
    });
    const dispatcher = snapshot.dispatchers[0]!;
    const contract = createJourneyGraphContract(dispatcher);
    const graph = buildJourneyGraph(dispatcher);

    expect(contract.transitions).toHaveLength(1);
    expect(graph.nodes.map((node) => node.id)).toEqual(["queued", "in-dev", "in-review", "completed"]);
    expect(graph.edges.map((edge) => edge.id)).toEqual(["advance-queued-in-dev-0-0"]);
    expect(graph.nodes[0]?.data.provider).toBe("anthropic");
    expect(graph.nodes[0]?.data.resumable).toBeNull();
    expect(graph.nodes[0]?.data.tooltip).toContain("phase: implementation");
    expect(dispatcher.journeyTelemetry?.activeJobs[0]?.jobId).toBe("ALS-001");
  } finally {
    await fixture.cleanup();
  }
});
