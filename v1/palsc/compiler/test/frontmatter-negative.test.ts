import { expect, test } from "bun:test";
import { codes } from "../src/diagnostics.ts";
import { expectModuleDiagnostic, updateRecord, validateFixture, withFixtureSandbox } from "./helpers/fixture.ts";

test.concurrent("missing required frontmatter fields are rejected", async () => {
  await withFixtureSandbox("frontmatter-missing-field", async ({ root }) => {
    await updateRecord(root, "workspace/backlog/stories/STORY-0001.md", (record) => {
      delete record.data.title;
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnostic(result, "backlog", codes.FM_MISSING_FIELD, "STORY-0001.md");
  });
});

test.concurrent("unknown frontmatter fields are rejected", async () => {
  await withFixtureSandbox("frontmatter-unknown-field", async ({ root }) => {
    await updateRecord(root, "workspace/backlog/stories/STORY-0001.md", (record) => {
      record.data.surprise = true;
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnostic(result, "backlog", codes.FM_UNKNOWN_FIELD, "STORY-0001.md");
  });
});

test.concurrent("enum values must be declared", async () => {
  await withFixtureSandbox("frontmatter-enum", async ({ root }) => {
    await updateRecord(root, "workspace/backlog/stories/STORY-0001.md", (record) => {
      record.data.status = "blocked";
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnostic(result, "backlog", codes.FM_ENUM_INVALID, "STORY-0001.md");
  });
});

test.concurrent("number fields must remain numeric", async () => {
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

test.concurrent("string fields must remain strings", async () => {
  await withFixtureSandbox("frontmatter-string", async ({ root }) => {
    await updateRecord(root, "workspace/backlog/stories/STORY-0001.md", (record) => {
      record.data.title = 101;
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnostic(result, "backlog", codes.FM_TYPE_MISMATCH, "STORY-0001.md");
  });
});

test.concurrent("id fields must be non-empty strings", async () => {
  await withFixtureSandbox("frontmatter-id-empty", async ({ root }) => {
    await updateRecord(root, "workspace/backlog/stories/STORY-0001.md", (record) => {
      record.data.id = "";
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnostic(result, "backlog", codes.FM_TYPE_MISMATCH, "STORY-0001.md");
  });
});

test.concurrent("id fields reject non-string values", async () => {
  await withFixtureSandbox("frontmatter-id-type", async ({ root }) => {
    await updateRecord(root, "workspace/backlog/stories/STORY-0001.md", (record) => {
      record.data.id = 101;
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnostic(result, "backlog", codes.FM_TYPE_MISMATCH, "STORY-0001.md");
  });
});

test.concurrent("non-null fields cannot be set to null", async () => {
  await withFixtureSandbox("frontmatter-nullability", async ({ root }) => {
    await updateRecord(root, "workspace/backlog/stories/STORY-0001.md", (record) => {
      record.data.epic_ref = null;
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnostic(result, "backlog", codes.FM_TYPE_MISMATCH, "STORY-0001.md");
  });
});

test.concurrent("enum fields must be strings before enum validation applies", async () => {
  await withFixtureSandbox("frontmatter-enum-type", async ({ root }) => {
    await updateRecord(root, "workspace/backlog/stories/STORY-0001.md", (record) => {
      record.data.status = 101;
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnostic(result, "backlog", codes.FM_TYPE_MISMATCH, "STORY-0001.md");
  });
});

test.concurrent("date fields must use YYYY-MM-DD", async () => {
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

test.concurrent("date fields reject non-string non-Date values", async () => {
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

test.concurrent("list fields must remain arrays", async () => {
  await withFixtureSandbox("frontmatter-list-type", async ({ root }) => {
    await updateRecord(root, "workspace/people/persons/PPL-000101.md", (record) => {
      record.data.tags = "product";
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnostic(result, "people", codes.FM_TYPE_MISMATCH, "PPL-000101.md");
  });
});

test.concurrent("list items must match the declared item type", async () => {
  await withFixtureSandbox("frontmatter-list-item", async ({ root }) => {
    await updateRecord(root, "workspace/people/persons/PPL-000101.md", (record) => {
      record.data.tags = ["product", 101];
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnostic(result, "people", codes.FM_ARRAY_ITEM, "PPL-000101.md");
  });
});
