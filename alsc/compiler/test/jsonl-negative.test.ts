import { expect, test } from "bun:test";
import { codes } from "../src/diagnostics.ts";
import {
  expectModuleDiagnostic,
  updateRecord,
  updateShapeYaml,
  updateTextFile,
  validateFixture,
  withFixtureSandbox,
} from "./helpers/fixture.ts";

test.concurrent("jsonl lines must parse as valid json objects", async () => {
  await withFixtureSandbox("jsonl-invalid-line", async ({ root }) => {
    await updateTextFile(root, "workspace/observability/streams/STR-0001.jsonl", () => [
      "{\"observed_at\":\"2026-04-01T10:00:00Z\",\"metric\":\"latency_ms\",\"window\":\"p50\",\"value\":41.8,\"tags\":[\"api-gateway\",\"baseline\"]}",
      "{\"observed_at\":",
    ].join("\n"));

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnostic(result, "observability", codes.PARSE_JSONL, "STR-0001.jsonl");
  });
});

test.concurrent("jsonl parse errors do not suppress row-schema diagnostics from valid lines", async () => {
  await withFixtureSandbox("jsonl-parse-and-row-errors", async ({ root }) => {
    await updateTextFile(root, "workspace/observability/streams/STR-0001.jsonl", () => [
      "{\"observed_at\":\"2026-04-01T10:00:00Z\",\"window\":\"p50\",\"value\":41.8,\"tags\":[\"api-gateway\",\"baseline\"]}",
      "{\"observed_at\":",
    ].join("\n"));

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnostic(result, "observability", codes.PARSE_JSONL, "STR-0001.jsonl");
    expectModuleDiagnostic(result, "observability", codes.ROW_MISSING_FIELD, "STR-0001.jsonl");
  });
});

test.concurrent("jsonl lines must be objects", async () => {
  await withFixtureSandbox("jsonl-non-object-line", async ({ root }) => {
    await updateTextFile(root, "workspace/observability/streams/STR-0001.jsonl", () => [
      "{\"observed_at\":\"2026-04-01T10:00:00Z\",\"metric\":\"latency_ms\",\"window\":\"p50\",\"value\":41.8,\"tags\":[\"api-gateway\",\"baseline\"]}",
      "42",
    ].join("\n"));

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnostic(result, "observability", codes.PARSE_JSONL, "STR-0001.jsonl");
  });
});

test.concurrent("empty jsonl entity files are valid", async () => {
  await withFixtureSandbox("jsonl-empty-file", async ({ root }) => {
    await updateTextFile(root, "workspace/observability/streams/STR-0001.jsonl", () => "");

    const result = validateFixture(root);
    expect(result.status).toBe("pass");
    expect(result.summary.error_count).toBe(0);
  });
});

test.concurrent("jsonl rows must include every declared field", async () => {
  await withFixtureSandbox("jsonl-missing-row-field", async ({ root }) => {
    await updateTextFile(root, "workspace/observability/streams/STR-0001.jsonl", () => [
      "{\"observed_at\":\"2026-04-01T10:00:00Z\",\"window\":\"p50\",\"value\":41.8,\"tags\":[\"api-gateway\",\"baseline\"]}",
    ].join("\n"));

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnostic(result, "observability", codes.ROW_MISSING_FIELD, "STR-0001.jsonl");
  });
});

test.concurrent("jsonl rows reject undeclared extra fields", async () => {
  await withFixtureSandbox("jsonl-extra-row-field", async ({ root }) => {
    await updateTextFile(root, "workspace/observability/streams/STR-0001.jsonl", () => [
      "{\"observed_at\":\"2026-04-01T10:00:00Z\",\"metric\":\"latency_ms\",\"window\":\"p50\",\"value\":41.8,\"tags\":[\"api-gateway\",\"baseline\"],\"extra\":true}",
    ].join("\n"));

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnostic(result, "observability", codes.ROW_UNKNOWN_FIELD, "STR-0001.jsonl");
  });
});

test.concurrent("jsonl row fields must match declared scalar types", async () => {
  await withFixtureSandbox("jsonl-row-type-mismatch", async ({ root }) => {
    await updateTextFile(root, "workspace/observability/streams/STR-0001.jsonl", () => [
      "{\"observed_at\":\"2026-04-01T10:00:00Z\",\"metric\":\"latency_ms\",\"window\":\"p50\",\"value\":\"41.8\",\"tags\":[\"api-gateway\",\"baseline\"]}",
    ].join("\n"));

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnostic(result, "observability", codes.ROW_TYPE_MISMATCH, "STR-0001.jsonl");
  });
});

test.concurrent("jsonl non-nullable row fields reject explicit null", async () => {
  await withFixtureSandbox("jsonl-row-nullability", async ({ root }) => {
    await updateTextFile(root, "workspace/observability/streams/STR-0001.jsonl", () => [
      "{\"observed_at\":\"2026-04-01T10:00:00Z\",\"metric\":\"latency_ms\",\"window\":\"p50\",\"value\":41.8,\"tags\":null}",
    ].join("\n"));

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnostic(result, "observability", codes.ROW_TYPE_MISMATCH, "STR-0001.jsonl");
  });
});

test.concurrent("jsonl row dates remain YYYY-MM-DD only", async () => {
  await withFixtureSandbox("jsonl-date-format", async ({ root }) => {
    await updateShapeYaml(root, "observability", 1, (shape) => {
      const entities = shape.entities as Record<string, Record<string, unknown>>;
      const metricStream = entities["metric-stream"];
      const rows = metricStream.rows as Record<string, Record<string, unknown>>;
      const fields = rows.fields as Record<string, unknown>;
      fields.observed_on = {
        type: "date",
        allow_null: false,
      };
    });

    await updateTextFile(root, "workspace/observability/streams/STR-0001.jsonl", () => [
      "{\"observed_at\":\"2026-04-01T10:00:00Z\",\"metric\":\"latency_ms\",\"window\":\"p50\",\"value\":41.8,\"tags\":[\"api-gateway\",\"baseline\"],\"observed_on\":\"2026-04-01T10:00:00Z\"}",
    ].join("\n"));

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnostic(result, "observability", codes.ROW_DATE_FORMAT, "STR-0001.jsonl");
  });
});

test.concurrent("jsonl rows reject invalid enum values", async () => {
  await withFixtureSandbox("jsonl-row-enum-invalid", async ({ root }) => {
    await updateTextFile(root, "workspace/observability/streams/STR-0001.jsonl", () => [
      "{\"observed_at\":\"2026-04-01T10:00:00Z\",\"metric\":\"latency_ms\",\"window\":\"p75\",\"value\":41.8,\"tags\":[\"api-gateway\",\"baseline\"]}",
    ].join("\n"));

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnostic(result, "observability", codes.ROW_ENUM_INVALID, "STR-0001.jsonl");
  });
});

test.concurrent("nullable jsonl row fields allow explicit null while still requiring presence", async () => {
  await withFixtureSandbox("jsonl-nullable-row-field", async ({ root }) => {
    await updateShapeYaml(root, "observability", 1, (shape) => {
      const entities = shape.entities as Record<string, Record<string, unknown>>;
      const metricStream = entities["metric-stream"];
      const rows = metricStream.rows as Record<string, Record<string, unknown>>;
      const fields = rows.fields as Record<string, Record<string, unknown>>;
      fields.tags.allow_null = true;
    });

    await updateTextFile(root, "workspace/observability/streams/STR-0001.jsonl", () => [
      "{\"observed_at\":\"2026-04-01T10:00:00Z\",\"metric\":\"latency_ms\",\"window\":\"p50\",\"value\":41.8,\"tags\":null}",
      "{\"observed_at\":\"2026-04-01T10:05:00Z\",\"metric\":\"latency_ms\",\"window\":\"p95\",\"value\":88.4,\"tags\":[\"api-gateway\",\"canary\"]}",
    ].join("\n"));

    const result = validateFixture(root);
    expect(result.status).toBe("pass");
    expect(result.summary.error_count).toBe(0);
  });
});

test.concurrent("jsonl list fields reject invalid item types", async () => {
  await withFixtureSandbox("jsonl-row-array-item", async ({ root }) => {
    await updateTextFile(root, "workspace/observability/streams/STR-0001.jsonl", () => [
      "{\"observed_at\":\"2026-04-01T10:00:00Z\",\"metric\":\"latency_ms\",\"window\":\"p50\",\"value\":41.8,\"tags\":[123]}",
    ].join("\n"));

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnostic(result, "observability", codes.ROW_ARRAY_ITEM, "STR-0001.jsonl");
  });
});

test.concurrent("markdown refs to jsonl entities must resolve", async () => {
  await withFixtureSandbox("jsonl-ref-unresolved", async ({ root }) => {
    await updateRecord(root, "workspace/observability/dashboards/DB-0001.md", (record) => {
      record.data.stream_ref = "[STR-9999](als://reference-system/observability/metric-stream/STR-9999)";
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnostic(result, "observability", codes.REF_UNRESOLVED, "DB-0001.md");
  });
});
