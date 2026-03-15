import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { parseShapeFile } from "../src/parser/shape-parser.js";
import { validate } from "../src/validator/runtime.js";

const SHAPES_DIR = resolve(import.meta.dirname, "../shapes");
const FIXTURE_DIR = resolve(
  import.meta.dirname,
  "../../../../example-systems/pristine-happy-path/workspace/experiments",
);

describe("experiments module — pristine fixture", () => {
  it("passes clean with zero diagnostics", () => {
    const shape = parseShapeFile(resolve(SHAPES_DIR, "experiments.yaml"));
    const result = validate(shape, FIXTURE_DIR);
    expect(result.status).toBe("pass");
    expect(result.diagnostics).toHaveLength(0);
    expect(result.summary.files_checked).toBe(8);
    expect(result.summary.files_passed).toBe(8);
  });

  it("correctly handles duplicate local IDs across different parents", () => {
    // EXP-0001 exists under both PRG-0001 and PRG-0002
    // These should be distinct canonical identities
    const shape = parseShapeFile(resolve(SHAPES_DIR, "experiments.yaml"));
    const result = validate(shape, FIXTURE_DIR);

    const dupErrors = result.diagnostics.filter((d) => d.code === "PAL-RV-ID-002");
    expect(dupErrors).toHaveLength(0);
  });
});

describe("experiments module — 3-level nesting", () => {
  it("infers correct entity types at each level", () => {
    const shape = parseShapeFile(resolve(SHAPES_DIR, "experiments.yaml"));
    // The shape has 3 entities with nested path templates
    expect(shape.entities.size).toBe(3);
    expect(shape.entities.get("program")!.path_template).toBe("programs/{id}/{id}.md");
    expect(shape.entities.get("experiment")!.path_template).toBe(
      "programs/{program}/experiments/{id}/{id}.md",
    );
    expect(shape.entities.get("run")!.path_template).toBe(
      "programs/{program}/experiments/{experiment}/runs/{id}.md",
    );
  });

  it("correctly declares parent chains", () => {
    const shape = parseShapeFile(resolve(SHAPES_DIR, "experiments.yaml"));
    expect(shape.entities.get("program")!.parent).toBeUndefined();
    expect(shape.entities.get("experiment")!.parent).toEqual({
      entity: "program",
      via_field: "program_ref",
    });
    expect(shape.entities.get("run")!.parent).toEqual({
      entity: "experiment",
      via_field: "experiment_ref",
    });
  });
});
