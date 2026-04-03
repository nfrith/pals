import { expect, test } from "bun:test";
import { codes } from "../src/diagnostics.ts";
import { moduleShapeSchema, systemConfigSchema, type VariantEntityShape } from "../src/schema.ts";
import { resolveEffectiveEntityContract } from "../src/validate.ts";

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
      shape_file: ".als/modules/backlog/v1/shape.yaml",
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
      },
      archive: {
        path: "workspace/backlog",
        version: 1,
        skills: ["archive"],
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
      },
      workspace: {
        path: "workspace",
        version: 1,
        skills: ["workspace"],
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
      },
    },
  });

  expect(result.success).toBe(false);
  if (result.success) {
    throw new Error("Expected duplicate skill ids to fail schema validation");
  }

  expect(result.error.issues.some((issue) => issue.path.join(".") === "modules.backlog.skills.1")).toBe(true);
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
