import { expect, test } from "bun:test";
import { chmodSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { join, sep } from "node:path";
import { codes, reasons } from "../src/diagnostics.ts";
import {
  serializeOperatorConfigSource,
  serializeOperatorRosterSource,
} from "../src/operator-config.ts";
import {
  expectModuleDiagnostic,
  expectNoModuleDiagnostic,
  updateRecord,
  updateShapeYaml,
  updateTextFile,
  validateFixture,
  withFixtureSandbox,
  withFixtureSandboxFromSource,
  writePath,
} from "./helpers/fixture.ts";

const v5FixtureRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../language-upgrades/fixtures/v5");
const factoryItemIds = ["SWF-001", "SWF-002", "SWF-003", "SWF-004"] as const;

async function configurePeopleTagsAsEnumList(root: string, allowedValues = ["product", "orchestration", "research"]): Promise<void> {
  await updateShapeYaml(root, "people", 1, (shape) => {
    const entities = shape.entities as Record<string, Record<string, unknown>>;
    const personFields = entities.person.fields as Record<string, Record<string, unknown>>;
    personFields.tags = {
      type: "list",
      allow_null: true,
      items: {
        type: "enum",
        allowed_values: allowedValues,
      },
    };
  });
}

async function writeValidOperatorRoster(root: string): Promise<void> {
  await writePath(
    root,
    ".als/operator-roster.ts",
    serializeOperatorRosterSource({
      operator_paths: ["./operators/nick-frith.ts"],
    }),
  );
  await writePath(
    root,
    ".als/operators/nick-frith.ts",
    serializeOperatorConfigSource({
      id: "nick-frith",
      first_name: "Nick",
      last_name: "Frith",
      display_name: "0xnfrith",
      primary_email: "nick@example.com",
      role: "Founder",
      profiles: ["edgerunner"],
      owns_company: false,
      company_name: null,
      company_type: null,
      company_type_other: null,
      revenue_band: null,
    }),
  );
}

async function configureFactoryOperatorAssignment(
  root: string,
  mode: "opportunistic" | "strict",
  allowNull: boolean,
): Promise<void> {
  await updateShapeYaml(root, "factory", 1, (shape) => {
    const entities = shape.entities as Record<string, Record<string, unknown>>;
    const itemFields = entities["work-item"].fields as Record<string, Record<string, unknown>>;
    itemFields.assigned_operator = {
      type: "operator-ref",
      allow_null: allowNull,
    };
  });
  await updateTextFile(
    root,
    ".als/modules/factory/v1/delamains/development-pipeline/delamain.ts",
    (current) => current.replace(
      '  "transitions": [',
      `  "requires_active_operator": {\n    "field": "assigned_operator",\n    "mode": "${mode}"\n  },\n  "transitions": [`,
    ),
  );
}

async function seedFactoryAssignedOperators(root: string, operatorId: string | null): Promise<void> {
  for (const itemId of factoryItemIds) {
    await updateRecord(root, `workspace/factory/items/${itemId}.md`, (record) => {
      record.data.assigned_operator = operatorId;
    });
  }
}

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

test("variant-local non-null fields cannot be set to null", async () => {
  await withFixtureSandbox("frontmatter-variant-nullability", async ({ root }) => {
    await updateRecord(root, "workspace/backlog/items/ITEM-0001.md", (record) => {
      record.data.status = null;
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnostic(result, "backlog", codes.FM_TYPE_MISMATCH, "ITEM-0001.md");
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

test("operator-ref values must exist in the roster", async () => {
  await withFixtureSandboxFromSource("frontmatter-operator-ref-unknown", v5FixtureRoot, async ({ root }) => {
    await writeValidOperatorRoster(root);
    await configureFactoryOperatorAssignment(root, "opportunistic", true);
    await seedFactoryAssignedOperators(root, null);
    await updateRecord(root, "workspace/factory/items/SWF-001.md", (record) => {
      record.data.assigned_operator = "alice-operator";
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    const diagnostic = expectModuleDiagnostic(result, "factory", codes.FM_ENUM_INVALID, "SWF-001.md");
    expect(diagnostic.reason).toBe(reasons.OPERATOR_REF_UNKNOWN);
  });
});

test("strict active-operator assignments cannot omit the declared field", async () => {
  await withFixtureSandboxFromSource("frontmatter-operator-ref-strict-missing", v5FixtureRoot, async ({ root }) => {
    await writeValidOperatorRoster(root);
    await configureFactoryOperatorAssignment(root, "strict", false);
    await seedFactoryAssignedOperators(root, "nick-frith");
    await updateRecord(root, "workspace/factory/items/SWF-001.md", (record) => {
      delete record.data.assigned_operator;
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnostic(result, "factory", codes.FM_MISSING_FIELD, "SWF-001.md");
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

test("system-root file paths reject dot segments that escape the ALS root", async () => {
  await withFixtureSandbox("frontmatter-file-path-dotdot", async ({ root }) => {
    await updateRecord(root, "workspace/backlog/items/ITEM-0001.md", (record) => {
      record.data.context_file = "../content/briefs/variant-backlog-design.md";
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    const diagnostic = expectModuleDiagnostic(result, "backlog", codes.FM_FILE_PATH_FORMAT, "ITEM-0001.md");
    expect(diagnostic.field).toBe("context_file");
    expect(diagnostic.reason).toBe(reasons.FRONTMATTER_FILE_PATH_INVALID);
  });
});

test("scalar file path fields must be strings", async () => {
  await withFixtureSandbox("frontmatter-file-path-scalar-type", async ({ root }) => {
    await updateRecord(root, "workspace/backlog/items/ITEM-0001.md", (record) => {
      record.data.context_file = 101;
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    const diagnostic = expectModuleDiagnostic(result, "backlog", codes.FM_TYPE_MISMATCH, "ITEM-0001.md");
    expect(diagnostic.field).toBe("context_file");
    expect(diagnostic.reason).toBeNull();
  });
});

test("system-root file paths reject empty strings", async () => {
  await withFixtureSandbox("frontmatter-file-path-empty", async ({ root }) => {
    await updateRecord(root, "workspace/backlog/items/ITEM-0001.md", (record) => {
      record.data.context_file = "";
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    const diagnostic = expectModuleDiagnostic(result, "backlog", codes.FM_FILE_PATH_FORMAT, "ITEM-0001.md");
    expect(diagnostic.field).toBe("context_file");
    expect(diagnostic.reason).toBe(reasons.FRONTMATTER_FILE_PATH_INVALID);
  });
});

test("system-root file paths reject markdown link syntax", async () => {
  await withFixtureSandbox("frontmatter-file-path-markdown-link", async ({ root }) => {
    await updateRecord(root, "workspace/backlog/items/ITEM-0001.md", (record) => {
      record.data.context_file = "[brief](content/briefs/variant-backlog-design.md)";
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    const diagnostic = expectModuleDiagnostic(result, "backlog", codes.FM_FILE_PATH_FORMAT, "ITEM-0001.md");
    expect(diagnostic.field).toBe("context_file");
    expect(diagnostic.reason).toBe(reasons.FRONTMATTER_FILE_PATH_INVALID);
  });
});

test("system-root file paths reject URI values", async () => {
  await withFixtureSandbox("frontmatter-file-path-uri", async ({ root }) => {
    await updateRecord(root, "workspace/backlog/items/ITEM-0001.md", (record) => {
      record.data.context_file = "file:///tmp/variant-backlog-design.md";
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    const diagnostic = expectModuleDiagnostic(result, "backlog", codes.FM_FILE_PATH_FORMAT, "ITEM-0001.md");
    expect(diagnostic.field).toBe("context_file");
    expect(diagnostic.reason).toBe(reasons.FRONTMATTER_FILE_PATH_INVALID);
  });
});

test("system-root file paths reject leading slashes", async () => {
  await withFixtureSandbox("frontmatter-file-path-leading-slash", async ({ root }) => {
    await updateRecord(root, "workspace/backlog/items/ITEM-0001.md", (record) => {
      record.data.context_file = "/content/briefs/variant-backlog-design.md";
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    const diagnostic = expectModuleDiagnostic(result, "backlog", codes.FM_FILE_PATH_FORMAT, "ITEM-0001.md");
    expect(diagnostic.field).toBe("context_file");
    expect(diagnostic.reason).toBe(reasons.FRONTMATTER_FILE_PATH_INVALID);
  });
});

test("system-root file paths reject drive-prefixed values", async () => {
  await withFixtureSandbox("frontmatter-file-path-drive-prefix", async ({ root }) => {
    await updateRecord(root, "workspace/backlog/items/ITEM-0001.md", (record) => {
      record.data.context_file = "C:relative/path.md";
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    const diagnostic = expectModuleDiagnostic(result, "backlog", codes.FM_FILE_PATH_FORMAT, "ITEM-0001.md");
    expect(diagnostic.field).toBe("context_file");
    expect(diagnostic.reason).toBe(reasons.FRONTMATTER_FILE_PATH_INVALID);
  });
});

test("host-absolute file paths reject relative values", async () => {
  await withFixtureSandbox("frontmatter-file-path-host-absolute-relative", async ({ root }) => {
    await updateShapeYaml(root, "backlog", 1, (shape) => {
      const entities = shape.entities as Record<string, Record<string, unknown>>;
      const itemFields = entities.item.fields as Record<string, Record<string, unknown>>;
      itemFields.context_file.base = "host_absolute";
    });
    await updateRecord(root, "workspace/backlog/items/ITEM-0001.md", (record) => {
      record.data.context_file = "content/briefs/variant-backlog-design.md";
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    const diagnostic = expectModuleDiagnostic(result, "backlog", codes.FM_FILE_PATH_FORMAT, "ITEM-0001.md");
    expect(diagnostic.field).toBe("context_file");
    expect(diagnostic.reason).toBe(reasons.FRONTMATTER_FILE_PATH_INVALID);
  });
});

test("host-absolute file paths reject trailing separators", async () => {
  await withFixtureSandbox("frontmatter-file-path-host-absolute-trailing-separator", async ({ root }) => {
    await updateShapeYaml(root, "backlog", 1, (shape) => {
      const entities = shape.entities as Record<string, Record<string, unknown>>;
      const itemFields = entities.item.fields as Record<string, Record<string, unknown>>;
      itemFields.context_file.base = "host_absolute";
    });
    await updateRecord(root, "workspace/backlog/items/ITEM-0001.md", (record) => {
      record.data.context_file = `${join(root, "content", "briefs", "variant-backlog-design.md")}${sep}`;
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    const diagnostic = expectModuleDiagnostic(result, "backlog", codes.FM_FILE_PATH_FORMAT, "ITEM-0001.md");
    expect(diagnostic.field).toBe("context_file");
    expect(diagnostic.reason).toBe(reasons.FRONTMATTER_FILE_PATH_INVALID);
  });
});

test("host-absolute file paths reject dot segments", async () => {
  await withFixtureSandbox("frontmatter-file-path-host-absolute-dot-segments", async ({ root }) => {
    await updateShapeYaml(root, "backlog", 1, (shape) => {
      const entities = shape.entities as Record<string, Record<string, unknown>>;
      const itemFields = entities.item.fields as Record<string, Record<string, unknown>>;
      itemFields.context_file.base = "host_absolute";
    });
    await updateRecord(root, "workspace/backlog/items/ITEM-0001.md", (record) => {
      record.data.context_file = `${join(root, "content", "briefs")}${sep}..${sep}briefs${sep}variant-backlog-design.md`;
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    const diagnostic = expectModuleDiagnostic(result, "backlog", codes.FM_FILE_PATH_FORMAT, "ITEM-0001.md");
    expect(diagnostic.field).toBe("context_file");
    expect(diagnostic.reason).toBe(reasons.FRONTMATTER_FILE_PATH_INVALID);
  });
});

test("file paths must resolve to existing files", async () => {
  await withFixtureSandbox("frontmatter-file-path-missing-target", async ({ root }) => {
    await updateRecord(root, "workspace/backlog/items/ITEM-0001.md", (record) => {
      record.data.context_file = "content/briefs/missing.md";
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    const diagnostic = expectModuleDiagnostic(result, "backlog", codes.FM_FILE_PATH_TARGET, "ITEM-0001.md");
    expect(diagnostic.field).toBe("context_file");
    expect(diagnostic.reason).toBe(reasons.FRONTMATTER_FILE_PATH_TARGET_MISSING);
  });
});

test("file paths reject inaccessible targets", async () => {
  await withFixtureSandbox("frontmatter-file-path-inaccessible-target", async ({ root }) => {
    if (process.platform === "win32") {
      return;
    }

    await writePath(root, "content/locked/secret.md", "locked\n");
    await updateRecord(root, "workspace/backlog/items/ITEM-0001.md", (record) => {
      record.data.context_file = "content/locked/secret.md";
    });

    const lockedDir = join(root, "content", "locked");
    const originalMode = statSync(lockedDir).mode;
    chmodSync(lockedDir, 0o000);

    try {
      const result = validateFixture(root);
      expect(result.status).toBe("fail");
      const diagnostic = expectModuleDiagnostic(result, "backlog", codes.FM_FILE_PATH_TARGET, "ITEM-0001.md");
      expect(diagnostic.field).toBe("context_file");
      expect(diagnostic.reason).toBe(reasons.FRONTMATTER_FILE_PATH_TARGET_UNREADABLE);
    } finally {
      chmodSync(lockedDir, originalMode);
    }
  });
});

test("file paths reject directory targets", async () => {
  await withFixtureSandbox("frontmatter-file-path-directory", async ({ root }) => {
    await updateRecord(root, "workspace/backlog/items/ITEM-0001.md", (record) => {
      record.data.context_file = "content/sessions";
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    const diagnostic = expectModuleDiagnostic(result, "backlog", codes.FM_FILE_PATH_TARGET, "ITEM-0001.md");
    expect(diagnostic.field).toBe("context_file");
    expect(diagnostic.reason).toBe(reasons.FRONTMATTER_FILE_PATH_TARGET_NOT_FILE);
  });
});

test("list file path items reject non-string members", async () => {
  await withFixtureSandbox("frontmatter-list-file-path-item-type", async ({ root }) => {
    await updateRecord(root, "workspace/backlog/items/ITEM-0001.md", (record) => {
      record.data.session_files = ["content/sessions/2026-03-17-variant-backlog-kickoff.md", 101];
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    const diagnostic = expectModuleDiagnostic(result, "backlog", codes.FM_ARRAY_ITEM, "ITEM-0001.md");
    expect(diagnostic.field).toBe("session_files[1]");
    expect(diagnostic.reason).toBeNull();
  });
});

test("enum list items must be declared enum members", async () => {
  await withFixtureSandbox("frontmatter-list-enum-invalid", async ({ root }) => {
    await configurePeopleTagsAsEnumList(root);
    await updateRecord(root, "workspace/people/persons/PPL-000101.md", (record) => {
      record.data.tags = ["product", "delivery"];
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    const diagnostic = expectModuleDiagnostic(result, "people", codes.FM_ENUM_INVALID, "PPL-000101.md");
    expect(diagnostic.field).toBe("tags[1]");
    expect(diagnostic.actual).toBe("delivery");
  });
});

test("enum list items reject non-string values", async () => {
  await withFixtureSandbox("frontmatter-list-enum-type", async ({ root }) => {
    await configurePeopleTagsAsEnumList(root);
    await updateRecord(root, "workspace/people/persons/PPL-000101.md", (record) => {
      record.data.tags = ["product", 101];
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    const diagnostic = expectModuleDiagnostic(result, "people", codes.FM_ARRAY_ITEM, "PPL-000101.md");
    expect(diagnostic.field).toBe("tags[1]");
    expect(diagnostic.reason).toBeNull();
  });
});

test("enum list items reject null values", async () => {
  await withFixtureSandbox("frontmatter-list-enum-null", async ({ root }) => {
    await configurePeopleTagsAsEnumList(root);
    await updateRecord(root, "workspace/people/persons/PPL-000101.md", (record) => {
      record.data.tags = ["product", null];
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    const diagnostic = expectModuleDiagnostic(result, "people", codes.FM_ARRAY_ITEM, "PPL-000101.md");
    expect(diagnostic.field).toBe("tags[1]");
    expect(diagnostic.reason).toBeNull();
    expect(diagnostic.actual).toBe("object");
  });
});

test("enum list items reject duplicate declared values", async () => {
  await withFixtureSandbox("frontmatter-list-enum-duplicate", async ({ root }) => {
    await configurePeopleTagsAsEnumList(root);
    await updateRecord(root, "workspace/people/persons/PPL-000101.md", (record) => {
      record.data.tags = ["product", "orchestration", "product"];
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    const diagnostic = expectModuleDiagnostic(result, "people", codes.FM_ARRAY_ITEM, "PPL-000101.md");
    expect(diagnostic.field).toBe("tags[2]");
    expect(diagnostic.reason).toBe(reasons.FRONTMATTER_LIST_ITEM_DUPLICATE);
    expect(diagnostic.actual).toBe("product");
  });
});

test("invalid enum list items do not also emit duplicate diagnostics", async () => {
  await withFixtureSandbox("frontmatter-list-enum-invalid-duplicate", async ({ root }) => {
    await configurePeopleTagsAsEnumList(root);
    await updateRecord(root, "workspace/people/persons/PPL-000101.md", (record) => {
      record.data.tags = ["delivery", "delivery"];
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    const peopleReport = result.modules.find((report) => report.module_id === "people");
    expect(peopleReport).toBeDefined();
    expect(
      peopleReport!.diagnostics.filter(
        (diagnostic) => diagnostic.file.endsWith("PPL-000101.md") && diagnostic.code === codes.FM_ENUM_INVALID,
      ),
    ).toHaveLength(2);
    expect(
      peopleReport!.diagnostics.some(
        (diagnostic) =>
          diagnostic.file.endsWith("PPL-000101.md")
          && diagnostic.reason === reasons.FRONTMATTER_LIST_ITEM_DUPLICATE,
      ),
    ).toBe(false);
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
