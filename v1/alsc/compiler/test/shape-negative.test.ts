import { expect, test } from "bun:test";
import { codes, reasons } from "../src/diagnostics.ts";
import {
  expectModuleDiagnostic,
  updateShapeYaml,
  updateTextFile,
  validateFixture,
  withExampleSystemSandbox,
  withFixtureSandbox,
} from "./helpers/fixture.ts";

test.concurrent("stale top-level schema fields in shape files are rejected", async () => {
  await withFixtureSandbox("shape-stale-schema-field", async ({ root }) => {
    await updateShapeYaml(root, "backlog", 1, (shape) => {
      shape.schema = "als-module@1";
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    const diagnostic = expectModuleDiagnostic(result, "backlog", codes.SHAPE_INVALID, ".als/modules/backlog/v1/shape.yaml");
    expect(diagnostic.reason).toBe(reasons.MODULE_SHAPE_SCHEMA_REMOVED);
  });
});

test.concurrent("stale schema diagnostics do not suppress other shape parse errors", async () => {
  await withFixtureSandbox("shape-stale-schema-plus-missing-dependencies", async ({ root }) => {
    await updateShapeYaml(root, "backlog", 1, (shape) => {
      shape.schema = "als-module@1";
      delete shape.dependencies;
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    const backlogReport = result.modules.find((report) => report.module_id === "backlog");
    expect(backlogReport).toBeDefined();
    expect(backlogReport!.diagnostics.some((diagnostic) => diagnostic.reason === reasons.MODULE_SHAPE_SCHEMA_REMOVED)).toBe(true);
    expect(
      backlogReport!.diagnostics.some(
        (diagnostic) =>
          diagnostic.code === codes.SHAPE_INVALID
          && diagnostic.field === "dependencies",
      ),
    ).toBe(true);
  });
});

test.concurrent("malformed shape yaml fails parsing cleanly", async () => {
  await withFixtureSandbox("shape-yaml-parse-error", async ({ root }) => {
    await updateTextFile(root, ".als/modules/backlog/v1/shape.yaml", () => "dependencies: [broken\n");

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    const diagnostic = expectModuleDiagnostic(result, "backlog", codes.SHAPE_INVALID, ".als/modules/backlog/v1/shape.yaml");
    expect(diagnostic.message).toContain("Failed to parse YAML");
  });
});

test.concurrent("duplicate dependencies are rejected", async () => {
  await withFixtureSandbox("shape-duplicate-dependency", async ({ root }) => {
    await updateShapeYaml(root, "experiments", 2, (shape) => {
      const dependencies = shape.dependencies as Array<Record<string, unknown>>;
      dependencies.push({ module: "people" });
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnostic(result, "experiments", codes.SHAPE_INVALID, ".als/modules/experiments/v2/shape.yaml");
  });
});

test.concurrent("dependencies must point at declared modules", async () => {
  await withFixtureSandbox("shape-unknown-dependency", async ({ root }) => {
    await updateShapeYaml(root, "backlog", 1, (shape) => {
      const dependencies = shape.dependencies as Array<Record<string, unknown>>;
      dependencies.push({ module: "ghosts" });
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnostic(result, "backlog", codes.SHAPE_CONTRACT_INVALID, ".als/modules/backlog/v1/shape.yaml");
  });
});

test.concurrent("entity shapes must declare an id field", async () => {
  await withFixtureSandbox("shape-missing-id-field", async ({ root }) => {
    await updateShapeYaml(root, "backlog", 1, (shape) => {
      const entities = shape.entities as Record<string, Record<string, unknown>>;
      const item = entities.item;
      const fields = item.fields as Record<string, unknown>;
      delete fields.id;
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnostic(result, "backlog", codes.SHAPE_INVALID, ".als/modules/backlog/v1/shape.yaml");
  });
});

test.concurrent("id fields cannot allow null", async () => {
  await withFixtureSandbox("shape-id-nullability", async ({ root }) => {
    await updateShapeYaml(root, "backlog", 1, (shape) => {
      const entities = shape.entities as Record<string, Record<string, unknown>>;
      const itemFields = entities.item.fields as Record<string, Record<string, unknown>>;
      itemFields.id.allow_null = true;
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnostic(result, "backlog", codes.SHAPE_INVALID, ".als/modules/backlog/v1/shape.yaml");
  });
});

test.concurrent("entity paths must include the id placeholder", async () => {
  await withFixtureSandbox("shape-path-id-placeholder", async ({ root }) => {
    await updateShapeYaml(root, "backlog", 1, (shape) => {
      const entities = shape.entities as Record<string, Record<string, unknown>>;
      entities.item.path = "items/item.md";
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnostic(result, "backlog", codes.SHAPE_INVALID, ".als/modules/backlog/v1/shape.yaml");
  });
});

test.concurrent("duplicate variant section names are rejected", async () => {
  await withFixtureSandbox("shape-duplicate-variant-sections", async ({ root }) => {
    await updateShapeYaml(root, "backlog", 1, (shape) => {
      const entities = shape.entities as Record<string, Record<string, unknown>>;
      const variants = entities.item.variants as Record<string, Record<string, unknown>>;
      const appSections = variants.app.sections as string[];
      appSections[3] = "DESCRIPTION";
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnostic(result, "backlog", codes.SHAPE_INVALID, ".als/modules/backlog/v1/shape.yaml");
  });
});

test.concurrent("discriminator fields must be non-null enums", async () => {
  await withFixtureSandbox("shape-discriminator-field", async ({ root }) => {
    await updateShapeYaml(root, "backlog", 1, (shape) => {
      const entities = shape.entities as Record<string, Record<string, unknown>>;
      const itemFields = entities.item.fields as Record<string, Record<string, unknown>>;
      itemFields.type = {
        type: "string",
        allow_null: false,
      };
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnostic(result, "backlog", codes.SHAPE_INVALID, ".als/modules/backlog/v1/shape.yaml");
  });
});

test.concurrent("legacy required keys on fields are rejected", async () => {
  await withFixtureSandbox("shape-legacy-required-field", async ({ root }) => {
    await updateShapeYaml(root, "backlog", 1, (shape) => {
      const entities = shape.entities as Record<string, Record<string, unknown>>;
      const itemFields = entities.item.fields as Record<string, Record<string, unknown>>;
      itemFields.type.required = true;
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnostic(result, "backlog", codes.SHAPE_INVALID, ".als/modules/backlog/v1/shape.yaml");
  });
});

test.concurrent("discriminator fields cannot allow null", async () => {
  await withFixtureSandbox("shape-discriminator-nullability", async ({ root }) => {
    await updateShapeYaml(root, "backlog", 1, (shape) => {
      const entities = shape.entities as Record<string, Record<string, unknown>>;
      const itemFields = entities.item.fields as Record<string, Record<string, unknown>>;
      itemFields.type.allow_null = true;
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnostic(result, "backlog", codes.SHAPE_INVALID, ".als/modules/backlog/v1/shape.yaml");
  });
});

test.concurrent("variant keys must match the discriminator enum values", async () => {
  await withFixtureSandbox("shape-variant-keys", async ({ root }) => {
    await updateShapeYaml(root, "backlog", 1, (shape) => {
      const entities = shape.entities as Record<string, Record<string, unknown>>;
      const variants = entities.item.variants as Record<string, unknown>;
      delete variants.research;
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnostic(result, "backlog", codes.SHAPE_INVALID, ".als/modules/backlog/v1/shape.yaml");
  });
});

test.concurrent("extra variant keys outside the discriminator enum are rejected", async () => {
  await withFixtureSandbox("shape-extra-variant-key", async ({ root }) => {
    await updateShapeYaml(root, "backlog", 1, (shape) => {
      const entities = shape.entities as Record<string, Record<string, unknown>>;
      const variants = entities.item.variants as Record<string, Record<string, unknown>>;
      variants.delivery = {
        fields: {},
        sections: ["DESCRIPTION", "ACTIVITY_LOG"],
      };
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnostic(result, "backlog", codes.SHAPE_INVALID, ".als/modules/backlog/v1/shape.yaml");
  });
});

test.concurrent("variant fields cannot collide with root fields", async () => {
  await withFixtureSandbox("shape-variant-field-collision", async ({ root }) => {
    await updateShapeYaml(root, "backlog", 1, (shape) => {
      const entities = shape.entities as Record<string, Record<string, unknown>>;
      const variants = entities.item.variants as Record<string, Record<string, unknown>>;
      const appFields = variants.app.fields as Record<string, unknown>;
      appFields.title = {
        type: "string",
        allow_null: true,
      };
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnostic(result, "backlog", codes.SHAPE_INVALID, ".als/modules/backlog/v1/shape.yaml");
  });
});

test.concurrent("legacy required keys on inline sections are rejected", async () => {
  await withFixtureSandbox("shape-legacy-required-inline-section", async ({ root }) => {
    await updateShapeYaml(root, "people", 1, (shape) => {
      const entities = shape.entities as Record<string, Record<string, unknown>>;
      const body = entities.person.body as Record<string, unknown>;
      const sections = body.sections as Array<Record<string, unknown>>;
      sections[0].required = true;
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnostic(result, "people", codes.SHAPE_INVALID, ".als/modules/people/v1/shape.yaml");
  });
});

test.concurrent("legacy required keys on section definitions are rejected", async () => {
  await withFixtureSandbox("shape-legacy-required-section-definition", async ({ root }) => {
    await updateShapeYaml(root, "backlog", 1, (shape) => {
      const entities = shape.entities as Record<string, Record<string, unknown>>;
      const definitions = entities.item.section_definitions as Record<string, Record<string, unknown>>;
      definitions.DESCRIPTION.required = true;
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnostic(result, "backlog", codes.SHAPE_INVALID, ".als/modules/backlog/v1/shape.yaml");
  });
});

test.concurrent("variant sections must reference declared section definitions", async () => {
  await withFixtureSandbox("shape-variant-sections-unknown", async ({ root }) => {
    await updateShapeYaml(root, "backlog", 1, (shape) => {
      const entities = shape.entities as Record<string, Record<string, unknown>>;
      const variants = entities.item.variants as Record<string, Record<string, unknown>>;
      const appSections = variants.app.sections as string[];
      appSections[1] = "DELIVERY_PLAN";
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnostic(result, "backlog", codes.SHAPE_INVALID, ".als/modules/backlog/v1/shape.yaml");
  });
});

test.concurrent("parent entities must exist in the same shape file", async () => {
  await withFixtureSandbox("shape-parent-entity", async ({ root }) => {
    await updateShapeYaml(root, "experiments", 2, (shape) => {
      const entities = shape.entities as Record<string, Record<string, unknown>>;
      const runIdentity = (entities.run.identity as Record<string, unknown>).parent as Record<string, unknown>;
      runIdentity.entity = "ghost";
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnostic(result, "experiments", codes.SHAPE_INVALID, ".als/modules/experiments/v2/shape.yaml");
  });
});

test.concurrent("parent ref fields must be declared", async () => {
  await withFixtureSandbox("shape-parent-ref-missing", async ({ root }) => {
    await updateShapeYaml(root, "experiments", 2, (shape) => {
      const entities = shape.entities as Record<string, Record<string, unknown>>;
      const runFields = entities.run.fields as Record<string, unknown>;
      delete runFields.experiment_ref;
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnostic(result, "experiments", codes.SHAPE_INVALID, ".als/modules/experiments/v2/shape.yaml");
  });
});

test.concurrent("parent ref fields must use ref type", async () => {
  await withFixtureSandbox("shape-parent-ref-type", async ({ root }) => {
    await updateShapeYaml(root, "experiments", 2, (shape) => {
      const entities = shape.entities as Record<string, Record<string, unknown>>;
      const runFields = entities.run.fields as Record<string, Record<string, unknown>>;
      runFields.experiment_ref = {
        type: "string",
        allow_null: false,
      };
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnostic(result, "experiments", codes.SHAPE_INVALID, ".als/modules/experiments/v2/shape.yaml");
  });
});

test.concurrent("parent ref fields must stay non-null", async () => {
  await withFixtureSandbox("shape-parent-ref-nullability", async ({ root }) => {
    await updateShapeYaml(root, "experiments", 2, (shape) => {
      const entities = shape.entities as Record<string, Record<string, unknown>>;
      const runFields = entities.run.fields as Record<string, Record<string, Record<string, unknown>>>;
      runFields.experiment_ref.allow_null = true;
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnostic(result, "experiments", codes.SHAPE_INVALID, ".als/modules/experiments/v2/shape.yaml");
  });
});

test.concurrent("cross-module ref targets must have declared dependencies", async () => {
  await withFixtureSandbox("shape-cross-module-dependency", async ({ root }) => {
    await updateShapeYaml(root, "experiments", 2, (shape) => {
      shape.dependencies = [{ module: "people" }];
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnostic(result, "experiments", codes.SHAPE_CONTRACT_INVALID, ".als/modules/experiments/v2/shape.yaml");
  });
});

test.concurrent("cross-module ref lists must also have declared dependencies", async () => {
  await withFixtureSandbox("shape-list-dependency", async ({ root }) => {
    await updateShapeYaml(root, "backlog", 1, (shape) => {
      shape.dependencies = [];
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnostic(result, "backlog", codes.SHAPE_CONTRACT_INVALID, ".als/modules/backlog/v1/shape.yaml");
  });
});

test.concurrent("variant-local ref fields must also have declared dependencies", async () => {
  await withFixtureSandbox("shape-variant-ref-dependency", async ({ root }) => {
    await updateShapeYaml(root, "backlog", 1, (shape) => {
      const entities = shape.entities as Record<string, Record<string, unknown>>;
      const variants = entities.item.variants as Record<string, Record<string, unknown>>;
      const appFields = variants.app.fields as Record<string, unknown>;
      appFields.client_ref = {
        type: "ref",
        allow_null: true,
        target: {
          module: "client-registry",
          entity: "client",
        },
      };
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnostic(result, "backlog", codes.SHAPE_CONTRACT_INVALID, ".als/modules/backlog/v1/shape.yaml");
  });
});

test.concurrent("table blocks must use a supported syntax", async () => {
  await withExampleSystemSandbox("rich-body-design-reference", "shape-table-syntax", async ({ root }) => {
    await updateShapeYaml(root, "research", 1, (shape) => {
      const entities = shape.entities as Record<string, Record<string, unknown>>;
      const synthesis = entities.synthesis;
      const body = synthesis.body as Record<string, unknown>;
      const sections = body.sections as Array<Record<string, unknown>>;
      const targetSection = sections.find((section) => section.name === "SYNTHESIS");
      const content = targetSection?.content as Record<string, unknown>;
      const blocks = content.blocks as Record<string, Record<string, unknown>>;
      blocks.table.syntax = "grid";
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnostic(result, "research", codes.SHAPE_INVALID, ".als/modules/research/v1/shape.yaml");
  });
});

test.concurrent("table blocks must declare syntax explicitly", async () => {
  await withExampleSystemSandbox("rich-body-design-reference", "shape-table-missing-syntax", async ({ root }) => {
    await updateShapeYaml(root, "planning", 1, (shape) => {
      const entities = shape.entities as Record<string, Record<string, unknown>>;
      const dossier = entities.dossier;
      const body = dossier.body as Record<string, unknown>;
      const sections = body.sections as Array<Record<string, unknown>>;
      const targetSection = sections.find((section) => section.name === "OPTIONS");
      const content = targetSection?.content as Record<string, unknown>;
      const blocks = content.blocks as Record<string, Record<string, unknown>>;
      delete blocks.table.syntax;
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnostic(result, "planning", codes.SHAPE_INVALID, ".als/modules/planning/v1/shape.yaml");
  });
});
