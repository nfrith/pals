import { expect, test } from "bun:test";
import { codes } from "../src/diagnostics.ts";
import { expectModuleDiagnostic, expectNoModuleDiagnostic, updateRecord, updateShapeYaml, validateFixture, withFixtureSandbox } from "./helpers/fixture.ts";

test("missing declared frontmatter fields are rejected", async () => {
  await withFixtureSandbox("frontmatter-missing-field", async ({ root }) => {
    await updateRecord(root, "workspace/backlog/items/ITEM-0001.md", (record) => {
      delete record.data.title;
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnostic(result, "backlog", codes.FM_MISSING_FIELD, "ITEM-0001.md");
  });
});

test("unknown frontmatter fields are rejected", async () => {
  await withFixtureSandbox("frontmatter-unknown-field", async ({ root }) => {
    await updateRecord(root, "workspace/backlog/items/ITEM-0001.md", (record) => {
      record.data.surprise = true;
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnostic(result, "backlog", codes.FM_UNKNOWN_FIELD, "ITEM-0001.md");
  });
});

test("enum values must be declared", async () => {
  await withFixtureSandbox("frontmatter-enum", async ({ root }) => {
    await updateRecord(root, "workspace/backlog/items/ITEM-0001.md", (record) => {
      record.data.status = "findings-ready";
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnostic(result, "backlog", codes.FM_ENUM_INVALID, "ITEM-0001.md");
  });
});

test("missing discriminators emit explicit unresolved-variant diagnostics", async () => {
  await withFixtureSandbox("frontmatter-missing-discriminator", async ({ root }) => {
    await updateRecord(root, "workspace/backlog/items/ITEM-0001.md", (record) => {
      delete record.data.type;
      record.content = `# ITEM-0001

## TOTALLY_CUSTOM

This body should be ignored because variant resolution failed.
`;
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnostic(result, "backlog", codes.FM_MISSING_FIELD, "ITEM-0001.md");
    expectModuleDiagnostic(result, "backlog", codes.FM_VARIANT_UNRESOLVED, "ITEM-0001.md");
    expectModuleDiagnostic(result, "backlog", codes.BODY_VARIANT_UNRESOLVED, "ITEM-0001.md");
    expectNoModuleDiagnostic(result, "backlog", codes.FM_UNKNOWN_FIELD, "ITEM-0001.md");

    const backlogReport = result.modules.find((report) => report.module_id === "backlog");
    expect(backlogReport).toBeDefined();
    const bodyDiagnostics = backlogReport!.diagnostics.filter(
      (diagnostic) => diagnostic.file.endsWith("ITEM-0001.md") && diagnostic.phase === "record_body",
    );
    expect(bodyDiagnostics).toHaveLength(1);
    expect(bodyDiagnostics[0].code).toBe(codes.BODY_VARIANT_UNRESOLVED);
  });
});

test("non-string discriminators emit explicit unresolved-variant diagnostics", async () => {
  await withFixtureSandbox("frontmatter-discriminator-type", async ({ root }) => {
    await updateRecord(root, "workspace/backlog/items/ITEM-0001.md", (record) => {
      record.data.type = 101;
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnostic(result, "backlog", codes.FM_TYPE_MISMATCH, "ITEM-0001.md");
    expectModuleDiagnostic(result, "backlog", codes.FM_VARIANT_UNRESOLVED, "ITEM-0001.md");
    expectModuleDiagnostic(result, "backlog", codes.BODY_VARIANT_UNRESOLVED, "ITEM-0001.md");
    expectNoModuleDiagnostic(result, "backlog", codes.FM_UNKNOWN_FIELD, "ITEM-0001.md");
  });
});

test("invalid discriminators emit explicit unresolved-variant diagnostics", async () => {
  await withFixtureSandbox("frontmatter-discriminator-enum", async ({ root }) => {
    await updateRecord(root, "workspace/backlog/items/ITEM-0001.md", (record) => {
      record.data.type = "application";
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnostic(result, "backlog", codes.FM_ENUM_INVALID, "ITEM-0001.md");
    expectModuleDiagnostic(result, "backlog", codes.FM_VARIANT_UNRESOLVED, "ITEM-0001.md");
    expectModuleDiagnostic(result, "backlog", codes.BODY_VARIANT_UNRESOLVED, "ITEM-0001.md");
    expectNoModuleDiagnostic(result, "backlog", codes.FM_UNKNOWN_FIELD, "ITEM-0001.md");
  });
});

test("variant-local declared fields are enforced", async () => {
  await withFixtureSandbox("frontmatter-variant-required", async ({ root }) => {
    await updateShapeYaml(root, "backlog", 1, (shape) => {
      const entities = shape.entities as Record<string, Record<string, unknown>>;
      const item = entities.item;
      const variants = item.variants as Record<string, Record<string, unknown>>;
      const app = variants.app;
      const fields = app.fields as Record<string, unknown>;
      fields.delivery_scope = {
        type: "string",
        allow_null: false,
      };
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnostic(result, "backlog", codes.FM_MISSING_FIELD, "ITEM-0001.md");
  });
});

test("fields from other variants are rejected", async () => {
  await withFixtureSandbox("frontmatter-variant-unknown", async ({ root }) => {
    await updateShapeYaml(root, "backlog", 1, (shape) => {
      const entities = shape.entities as Record<string, Record<string, unknown>>;
      const item = entities.item;
      const variants = item.variants as Record<string, Record<string, unknown>>;
      const research = variants.research;
      const fields = research.fields as Record<string, unknown>;
      fields.finding_label = {
        type: "string",
        allow_null: true,
      };
    });

    await updateRecord(root, "workspace/backlog/items/ITEM-0001.md", (record) => {
      record.data.finding_label = "cross-variant";
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnostic(result, "backlog", codes.FM_UNKNOWN_FIELD, "ITEM-0001.md");
  });
});

test("nullable declared fields cannot be omitted", async () => {
  await withFixtureSandbox("frontmatter-missing-nullable-field", async ({ root }) => {
    await updateRecord(root, "workspace/backlog/items/ITEM-0003.md", (record) => {
      delete record.data.collaborator_refs;
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnostic(result, "backlog", codes.FM_MISSING_FIELD, "ITEM-0003.md");
  });
});

test("number fields must remain numeric", async () => {
  await withFixtureSandbox("frontmatter-number", async ({ root }) => {
    await updateRecord(
      root,
      "workspace/experiments/programs/PRG-0001/experiments/EXP-0001/EXP-0001.md",
      (record) => {
        record.data.budget = "plenty";
      },
    );

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnostic(result, "experiments", codes.FM_TYPE_MISMATCH, "EXP-0001.md");
  });
});

test("string fields must remain strings", async () => {
  await withFixtureSandbox("frontmatter-string", async ({ root }) => {
    await updateRecord(root, "workspace/backlog/items/ITEM-0001.md", (record) => {
      record.data.title = 101;
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnostic(result, "backlog", codes.FM_TYPE_MISMATCH, "ITEM-0001.md");
  });
});

test("string fields reject empty strings", async () => {
  await withFixtureSandbox("frontmatter-string-empty", async ({ root }) => {
    await updateRecord(root, "workspace/backlog/items/ITEM-0001.md", (record) => {
      record.data.title = "";
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnostic(result, "backlog", codes.FM_TYPE_MISMATCH, "ITEM-0001.md");
  });
});

test("id fields must be non-empty strings", async () => {
  await withFixtureSandbox("frontmatter-id-empty", async ({ root }) => {
    await updateRecord(root, "workspace/backlog/items/ITEM-0001.md", (record) => {
      record.data.id = "";
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnostic(result, "backlog", codes.FM_TYPE_MISMATCH, "ITEM-0001.md");
  });
});

test("id fields reject non-string values", async () => {
  await withFixtureSandbox("frontmatter-id-type", async ({ root }) => {
    await updateRecord(root, "workspace/backlog/items/ITEM-0001.md", (record) => {
      record.data.id = 101;
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnostic(result, "backlog", codes.FM_TYPE_MISMATCH, "ITEM-0001.md");
  });
});

test("non-null fields cannot be set to null", async () => {
  await withFixtureSandbox("frontmatter-nullability", async ({ root }) => {
    await updateRecord(root, "workspace/backlog/items/ITEM-0001.md", (record) => {
      record.data.owner_ref = null;
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnostic(result, "backlog", codes.FM_TYPE_MISMATCH, "ITEM-0001.md");
  });
});

test("enum fields must be strings before enum validation applies", async () => {
  await withFixtureSandbox("frontmatter-enum-type", async ({ root }) => {
    await updateRecord(root, "workspace/backlog/items/ITEM-0001.md", (record) => {
      record.data.status = 101;
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnostic(result, "backlog", codes.FM_TYPE_MISMATCH, "ITEM-0001.md");
  });
});

test("date fields must use YYYY-MM-DD", async () => {
  await withFixtureSandbox("frontmatter-date-format", async ({ root }) => {
    await updateRecord(
      root,
      "workspace/experiments/programs/PRG-0001/experiments/EXP-0001/runs/RUN-0001.md",
      (record) => {
        record.data.started_on = "03/01/2026";
      },
    );

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnostic(result, "experiments", codes.FM_DATE_FORMAT, "RUN-0001.md");
  });
});

test("date fields reject non-string non-Date values", async () => {
  await withFixtureSandbox("frontmatter-date-type", async ({ root }) => {
    await updateRecord(
      root,
      "workspace/experiments/programs/PRG-0001/experiments/EXP-0001/runs/RUN-0001.md",
      (record) => {
        record.data.started_on = 101;
      },
    );

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnostic(result, "experiments", codes.FM_TYPE_MISMATCH, "RUN-0001.md");
  });
});

test("list fields must remain arrays", async () => {
  await withFixtureSandbox("frontmatter-list-type", async ({ root }) => {
    await updateRecord(root, "workspace/people/persons/PPL-000101.md", (record) => {
      record.data.tags = "product";
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnostic(result, "people", codes.FM_TYPE_MISMATCH, "PPL-000101.md");
  });
});

test("list items must match the declared item type", async () => {
  await withFixtureSandbox("frontmatter-list-item", async ({ root }) => {
    await updateRecord(root, "workspace/people/persons/PPL-000101.md", (record) => {
      record.data.tags = ["product", 101];
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnostic(result, "people", codes.FM_ARRAY_ITEM, "PPL-000101.md");
  });
});

test("truly undeclared fields still fail when the variant is unresolved", async () => {
  await withFixtureSandbox("frontmatter-unresolved-unknown-field", async ({ root }) => {
    await updateRecord(root, "workspace/backlog/items/ITEM-0001.md", (record) => {
      delete record.data.type;
      record.data.surprise = true;
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnostic(result, "backlog", codes.FM_VARIANT_UNRESOLVED, "ITEM-0001.md");
    expectModuleDiagnostic(result, "backlog", codes.FM_UNKNOWN_FIELD, "ITEM-0001.md");
  });
});
