import { expect, test } from "bun:test";
import { codes } from "../src/diagnostics.ts";
import { moduleShapeSchema, systemConfigSchema, type VariantEntityShape } from "../src/schema.ts";
import { resolveEffectiveEntityContract } from "../src/validate.ts";
import { updateRecord, updateShapeYaml, validateFixture, withFixtureSandbox } from "./helpers/fixture.ts";

const syntheticDeprecationValues = [
  "synthetic-supported",
  "synthetic-deprecated",
] as const;
const backlogRecordIds = ["ITEM-0001", "ITEM-0002", "ITEM-0003"] as const;

async function configureSyntheticDeprecationFixture(root: string): Promise<void> {
  await updateShapeYaml(root, "backlog", 1, (shape) => {
    const entities = shape.entities as Record<string, Record<string, unknown>>;
    const itemFields = entities.item.fields as Record<string, Record<string, unknown>>;
    itemFields.warning_status = {
      type: "enum",
      allow_null: true,
      allowed_values: [...syntheticDeprecationValues],
    };
  });

  for (const recordId of backlogRecordIds) {
    await updateRecord(root, `workspace/backlog/items/${recordId}.md`, (record) => {
      record.data.warning_status = recordId === "ITEM-0001" ? "synthetic-deprecated" : null;
    });
  }
}

test("missing section definitions surface a shape diagnostic instead of crashing", () => {
  const entityShape: VariantEntityShape = {
    source_format: "markdown",
    path: "items/{id}.md",
    identity: {
      id_field: "id",
    },
    fields: {
      id: {
        type: "id",
        allow_null: false,
      },
      type: {
        type: "enum",
        allow_null: false,
        allowed_values: ["app"],
      },
    },
    discriminator: "type",
    body: {
      title: {
        source: {
          kind: "field",
          field: "id",
        },
      },
    },
    section_definitions: {},
    variants: {
      app: {
        fields: {},
        sections: ["DESCRIPTION"],
      },
    },
  };

  const result = resolveEffectiveEntityContract(
    entityShape,
    {
      id: "ITEM-0001",
      type: "app",
    },
    {
      module_id: "backlog",
      entity_name: "item",
      record_file: "workspace/backlog/items/ITEM-0001.md",
      shape_file: ".als/modules/backlog/v1/module.ts",
    },
  );

  expect(result.body).toBeNull();
  expect(result.known_field_names).toEqual(["id", "type"]);
  expect(result.diagnostics).toHaveLength(1);
  expect(result.body_diagnostics).toHaveLength(0);
  expect(result.diagnostics[0].code).toBe(codes.SHAPE_CONTRACT_INVALID);
});

test("system config schema rejects duplicate module mount paths", () => {
  const result = systemConfigSchema.safeParse({
    als_version: 1,
    system_id: "test-system",
    modules: {
      backlog: {
        path: "workspace/backlog",
        version: 1,
        skills: ["backlog"],
        description: "Track backlog work.",
      },
      archive: {
        path: "workspace/backlog",
        version: 1,
        skills: ["archive"],
        description: "Store archived work.",
      },
    },
  });

  expect(result.success).toBe(false);
  if (result.success) {
    throw new Error("Expected duplicate module mount paths to fail schema validation");
  }

  expect(result.error.issues.some((issue) => issue.path.join(".") === "modules.archive.path")).toBe(true);
});

test("system config schema rejects overlapping module mount paths", () => {
  const result = systemConfigSchema.safeParse({
    als_version: 1,
    system_id: "test-system",
    modules: {
      backlog: {
        path: "workspace/backlog",
        version: 1,
        skills: ["backlog"],
        description: "Track backlog work.",
      },
      workspace: {
        path: "workspace",
        version: 1,
        skills: ["workspace"],
        description: "Own workspace-level records.",
      },
    },
  });

  expect(result.success).toBe(false);
  if (result.success) {
    throw new Error("Expected overlapping module mount paths to fail schema validation");
  }

  expect(result.error.issues.some((issue) => issue.path.join(".") === "modules.workspace.path")).toBe(true);
});

test("variant entity shapes can omit body without crashing schema validation", () => {
  expect(() => {
    const result = moduleShapeSchema.safeParse({
      dependencies: [],
      entities: {
        item: {
          source_format: "markdown",
          path: "items/{id}.md",
          identity: {
            id_field: "id",
          },
          fields: {
            id: {
              type: "id",
              allow_null: false,
            },
            type: {
              type: "enum",
              allow_null: false,
              allowed_values: ["app"],
            },
          },
          discriminator: "type",
          body: undefined,
          section_definitions: {
            DESCRIPTION: {
              allow_null: false,
              content: {
                mode: "freeform",
                blocks: {
                  paragraph: {},
                },
              },
            },
          },
          variants: {
            app: {
              fields: {},
              sections: ["DESCRIPTION"],
            },
          },
        },
      },
    });

    expect(result.success).toBe(true);
  }).not.toThrow();
});

test("system config schema rejects duplicate skill ids inside one module", () => {
  const result = systemConfigSchema.safeParse({
    als_version: 1,
    system_id: "test-system",
    modules: {
      backlog: {
        path: "workspace/backlog",
        version: 1,
        skills: ["backlog", "backlog"],
        description: "Track backlog work.",
      },
    },
  });

  expect(result.success).toBe(false);
  if (result.success) {
    throw new Error("Expected duplicate skill ids to fail schema validation");
  }

  expect(result.error.issues.some((issue) => issue.path.join(".") === "modules.backlog.skills.1")).toBe(true);
});

for (const [label, description] of [
  ["blank", ""],
  ["trimmed", " backlog"],
  ["single-line", "Backlog work\nwith wrap"],
  ["too-long", "x".repeat(121)],
] as const) {
  test(`system config schema rejects invalid module descriptions (${label})`, () => {
    const result = systemConfigSchema.safeParse({
      als_version: 1,
      system_id: "test-system",
      modules: {
        backlog: {
          path: "workspace/backlog",
          version: 1,
          skills: ["backlog"],
          description,
        },
      },
    });

    expect(result.success).toBe(false);
    if (result.success) {
      throw new Error(`Expected invalid module description (${label}) to fail schema validation`);
    }

    expect(result.error.issues.some((issue) => issue.path.join(".") === "modules.backlog.description")).toBe(true);
  });
}

test("system config schema rejects missing module descriptions", () => {
  const result = systemConfigSchema.safeParse({
    als_version: 1,
    system_id: "test-system",
    modules: {
      backlog: {
        path: "workspace/backlog",
        version: 1,
        skills: ["backlog"],
      },
    },
  });

  expect(result.success).toBe(false);
  if (result.success) {
    throw new Error("Expected missing module description to fail schema validation");
  }

  expect(result.error.issues.some((issue) => issue.path.join(".") === "modules.backlog.description")).toBe(true);
});

test("jsonl entity shapes validate without markdown-only surfaces", () => {
  const result = moduleShapeSchema.safeParse({
    dependencies: [],
    entities: {
      "metric-stream": {
        source_format: "jsonl",
        path: "streams/{id}.jsonl",
        rows: {
          fields: {
            observed_at: {
              type: "string",
              allow_null: false,
            },
            value: {
              type: "number",
              allow_null: false,
            },
          },
        },
      },
    },
  });

  expect(result.success).toBe(true);
});

test("deprecated enum values downgrade otherwise-valid records to warn with a structured payload", async () => {
  await withFixtureSandbox("validate-unit-deprecation-warn", async ({ root }) => {
    await configureSyntheticDeprecationFixture(root);

    const result = validateFixture(root, "backlog");
    expect(result.status).toBe("warn");
    expect(result.summary.error_count).toBe(0);
    expect(result.summary.warning_count).toBe(1);

    const backlogReport = result.modules.find((report) => report.module_id === "backlog");
    expect(backlogReport).toBeDefined();
    expect(backlogReport?.status).toBe("warn");
    expect(backlogReport?.summary.warning_count).toBe(1);

    const warning = backlogReport?.diagnostics.find((diagnostic) => diagnostic.code === codes.FM_ENUM_DEPRECATED);
    expect(warning).toBeDefined();
    expect(warning?.severity).toBe("warning");
    expect(warning?.field).toBe("warning_status");
    expect(warning?.deprecation).toEqual({
      contract: "synthetic_deprecation_fixture",
      value: "synthetic-deprecated",
      since: "v1.4",
      removed_in: "v1.6",
      replacement: "synthetic-supported",
    });
  });
});

test("deprecated enum warnings survive alongside real validation errors", async () => {
  await withFixtureSandbox("validate-unit-deprecation-fail", async ({ root }) => {
    await configureSyntheticDeprecationFixture(root);
    await updateRecord(root, "workspace/backlog/items/ITEM-0001.md", (record) => {
      delete record.data.title;
    });

    const result = validateFixture(root, "backlog");
    expect(result.status).toBe("fail");
    expect(result.summary.error_count).toBeGreaterThan(0);
    expect(result.summary.warning_count).toBe(1);

    const backlogReport = result.modules.find((report) => report.module_id === "backlog");
    expect(backlogReport).toBeDefined();
    expect(backlogReport?.status).toBe("fail");
    expect(backlogReport?.diagnostics.some((diagnostic) => diagnostic.code === codes.FM_MISSING_FIELD)).toBe(true);
    expect(backlogReport?.diagnostics.some((diagnostic) => diagnostic.code === codes.FM_ENUM_DEPRECATED)).toBe(true);
  });
});
