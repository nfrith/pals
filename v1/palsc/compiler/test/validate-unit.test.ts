import { expect, test } from "bun:test";
import { codes } from "../src/diagnostics.ts";
import { type VariantEntityShape } from "../src/schema.ts";
import { resolveEffectiveEntityContract } from "../src/validate.ts";

test("missing section definitions surface a shape diagnostic instead of crashing", () => {
  const entityShape: VariantEntityShape = {
    path: "items/{id}.md",
    identity: {
      id_field: "id",
    },
    fields: {
      id: {
        type: "id",
        required: true,
        allow_null: false,
      },
      type: {
        type: "enum",
        required: true,
        allow_null: false,
        allowed_values: ["app"],
      },
    },
    discriminator: "type",
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
      shape_file: ".pals/modules/backlog/v1.yaml",
    },
  );

  expect(result.sections).toBeNull();
  expect(result.diagnostics).toHaveLength(1);
  expect(result.diagnostics[0].code).toBe(codes.SHAPE_CONTRACT_INVALID);
});
