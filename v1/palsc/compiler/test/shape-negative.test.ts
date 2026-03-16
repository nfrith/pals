import { expect, test } from "bun:test";
import { codes } from "../src/diagnostics.ts";
import { expectModuleDiagnostic, updateShapeYaml, validateFixture, withFixtureSandbox } from "./helpers/fixture.ts";

test.concurrent("shape files must declare the expected schema literal", async () => {
  await withFixtureSandbox("shape-schema-literal", async ({ root }) => {
    await updateShapeYaml(root, "backlog", 1, (shape) => {
      delete shape.schema;
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnostic(result, "backlog", codes.SHAPE_INVALID, ".pals/modules/backlog/v1.yaml");
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
    expectModuleDiagnostic(result, "experiments", codes.SHAPE_INVALID, ".pals/modules/experiments/v2.yaml");
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
    expectModuleDiagnostic(result, "backlog", codes.SHAPE_CONTRACT_INVALID, ".pals/modules/backlog/v1.yaml");
  });
});

test.concurrent("entity shapes must declare an id field", async () => {
  await withFixtureSandbox("shape-missing-id-field", async ({ root }) => {
    await updateShapeYaml(root, "backlog", 1, (shape) => {
      const entities = shape.entities as Record<string, Record<string, unknown>>;
      const story = entities.story;
      const fields = story.fields as Record<string, unknown>;
      delete fields.id;
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnostic(result, "backlog", codes.SHAPE_INVALID, ".pals/modules/backlog/v1.yaml");
  });
});

test.concurrent("entity paths must include the id placeholder", async () => {
  await withFixtureSandbox("shape-path-id-placeholder", async ({ root }) => {
    await updateShapeYaml(root, "backlog", 1, (shape) => {
      const entities = shape.entities as Record<string, Record<string, unknown>>;
      entities.story.path = "stories/story.md";
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnostic(result, "backlog", codes.SHAPE_INVALID, ".pals/modules/backlog/v1.yaml");
  });
});

test.concurrent("duplicate section names are rejected", async () => {
  await withFixtureSandbox("shape-duplicate-sections", async ({ root }) => {
    await updateShapeYaml(root, "backlog", 1, (shape) => {
      const entities = shape.entities as Record<string, Record<string, unknown>>;
      const sections = entities.story.sections as Array<Record<string, unknown>>;
      sections[2].name = "CONTEXT";
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnostic(result, "backlog", codes.SHAPE_INVALID, ".pals/modules/backlog/v1.yaml");
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
    expectModuleDiagnostic(result, "experiments", codes.SHAPE_INVALID, ".pals/modules/experiments/v2.yaml");
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
    expectModuleDiagnostic(result, "experiments", codes.SHAPE_INVALID, ".pals/modules/experiments/v2.yaml");
  });
});

test.concurrent("parent ref fields must use ref type", async () => {
  await withFixtureSandbox("shape-parent-ref-type", async ({ root }) => {
    await updateShapeYaml(root, "experiments", 2, (shape) => {
      const entities = shape.entities as Record<string, Record<string, unknown>>;
      const runFields = entities.run.fields as Record<string, Record<string, unknown>>;
      runFields.experiment_ref = {
        type: "string",
        required: true,
        allow_null: false,
      };
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnostic(result, "experiments", codes.SHAPE_INVALID, ".pals/modules/experiments/v2.yaml");
  });
});

test.concurrent("parent ref fields must stay required and non-null", async () => {
  await withFixtureSandbox("shape-parent-ref-nullability", async ({ root }) => {
    await updateShapeYaml(root, "experiments", 2, (shape) => {
      const entities = shape.entities as Record<string, Record<string, unknown>>;
      const runFields = entities.run.fields as Record<string, Record<string, Record<string, unknown>>>;
      runFields.experiment_ref.allow_null = true;
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnostic(result, "experiments", codes.SHAPE_INVALID, ".pals/modules/experiments/v2.yaml");
  });
});

test.concurrent("cross-module ref targets must have declared dependencies", async () => {
  await withFixtureSandbox("shape-cross-module-dependency", async ({ root }) => {
    await updateShapeYaml(root, "experiments", 2, (shape) => {
      shape.dependencies = [{ module: "people" }];
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnostic(result, "experiments", codes.SHAPE_CONTRACT_INVALID, ".pals/modules/experiments/v2.yaml");
  });
});

test.concurrent("cross-module ref lists must also have declared dependencies", async () => {
  await withFixtureSandbox("shape-list-dependency", async ({ root }) => {
    await updateShapeYaml(root, "backlog", 1, (shape) => {
      shape.dependencies = [];
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnostic(result, "backlog", codes.SHAPE_CONTRACT_INVALID, ".pals/modules/backlog/v1.yaml");
  });
});
