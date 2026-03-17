import { expect, test } from "bun:test";
import { codes } from "../src/diagnostics.ts";
import { expectModuleDiagnostic, updateRecord, validateFixture, withFixtureSandbox } from "./helpers/fixture.ts";

const itemPath = "workspace/backlog/items/ITEM-0001.md";
const researchItemPath = "workspace/backlog/items/ITEM-0003.md";

test.concurrent("missing required sections are rejected", async () => {
  await withFixtureSandbox("body-missing-section", async ({ root }) => {
    await updateRecord(root, itemPath, (record) => {
      record.content = `# ITEM-0001

## DESCRIPTION

Refactor the backlog module so one item entity can represent different work types.

## REQUIREMENTS

- Preserve a single backlog item identity shape for refs and search.

## ARCHITECTURE

Represent type as a discriminator.
`;
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnostic(result, "backlog", codes.BODY_MISSING_SECTION, "ITEM-0001.md");
  });
});

test.concurrent("unknown sections are rejected", async () => {
  await withFixtureSandbox("body-unknown-section", async ({ root }) => {
    await updateRecord(root, itemPath, (record) => {
      record.content = `${record.content.trim()}\n\n## EXTRA\n\nUnexpected section.\n`;
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnostic(result, "backlog", codes.BODY_UNKNOWN_SECTION, "ITEM-0001.md");
  });
});

test.concurrent("sections from other variants are rejected", async () => {
  await withFixtureSandbox("body-cross-variant-section", async ({ root }) => {
    await updateRecord(root, itemPath, (record) => {
      record.content = `${record.content.trim()}\n\n## HYPOTHESIS\n\nThis research-only section should not appear on an app item.\n`;
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnostic(result, "backlog", codes.BODY_UNKNOWN_SECTION, "ITEM-0001.md");
  });
});

test.concurrent("section order must match the shape", async () => {
  await withFixtureSandbox("body-order", async ({ root }) => {
    await updateRecord(root, itemPath, (record) => {
      record.content = `# ITEM-0001

## DESCRIPTION

Refactor the backlog module so one item entity can represent different work types.

## ACTIVITY_LOG

- 2026-03-17: Captured the design goal for type-discriminated backlog items.

## REQUIREMENTS

- Preserve a single backlog item identity shape for refs and search.

## ARCHITECTURE

Represent type as a discriminator.
`;
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnostic(result, "backlog", codes.BODY_ORDER_MISMATCH, "ITEM-0001.md");
  });
});

test.concurrent("research section order must match the selected variant", async () => {
  await withFixtureSandbox("body-order-research", async ({ root }) => {
    await updateRecord(root, researchItemPath, (record) => {
      record.content = `# ITEM-0003

## DESCRIPTION

Test whether a derived coarse status bucket adds enough value for rollups without leaking business logic into the compiler.

## HYPOTHESIS

A derived bucket may be useful for filtering and dashboards, but it should remain outside the baseline validation contract.

## ACTIVITY_LOG

- 2026-03-15: Captured the open question about coarse-grained reporting states.
- 2026-03-17: Deferred a decision until the variant-local status model feels stable.

## FINDINGS

- Explicit per-variant status sets are clearly needed.
- Bucket mapping should stay tentative until runtime behavior is designed.
`;
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnostic(result, "backlog", codes.BODY_ORDER_MISMATCH, "ITEM-0003.md");
  });
});

test.concurrent("non-nullable sections cannot contain null", async () => {
  await withFixtureSandbox("body-null-not-allowed", async ({ root }) => {
    await updateRecord(root, itemPath, (record) => {
      record.content = `# ITEM-0001

## DESCRIPTION

null

## REQUIREMENTS

null

## ARCHITECTURE

Represent type as a discriminator.

## ACTIVITY_LOG

- 2026-03-17: Captured the design goal for type-discriminated backlog items.
`;
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnostic(result, "backlog", codes.BODY_NULL_NOT_ALLOWED, "ITEM-0001.md");
  });
});

test.concurrent("empty sections are rejected even when nullable", async () => {
  await withFixtureSandbox("body-empty-section", async ({ root }) => {
    await updateRecord(root, itemPath, (record) => {
      record.content = `# ITEM-0001

## DESCRIPTION

Refactor the backlog module so one item entity can represent different work types.

## REQUIREMENTS

- Preserve a single backlog item identity shape for refs and search.

## ARCHITECTURE

## ACTIVITY_LOG

- 2026-03-17: Captured the design goal for type-discriminated backlog items.
`;
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnostic(result, "backlog", codes.BODY_EMPTY_MARKER, "ITEM-0001.md");
  });
});

test.concurrent("unsupported paragraph blocks fail list-only sections", async () => {
  await withFixtureSandbox("body-list-constraint", async ({ root }) => {
    await updateRecord(root, itemPath, (record) => {
      record.content = `# ITEM-0001

## DESCRIPTION

Refactor the backlog module so one item entity can represent different work types.

## REQUIREMENTS

This should have been a list.

## ARCHITECTURE

Represent type as a discriminator.

## ACTIVITY_LOG

- 2026-03-17: Captured the design goal for type-discriminated backlog items.
`;
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnostic(result, "backlog", codes.BODY_CONSTRAINT_VIOLATION, "ITEM-0001.md");
  });
});

test.concurrent("subheadings are rejected when the section forbids them", async () => {
  await withFixtureSandbox("body-subheading", async ({ root }) => {
    await updateRecord(root, itemPath, (record) => {
      record.content = `# ITEM-0001

## DESCRIPTION

Refactor the backlog module so one item entity can represent different work types.

### Illegal Subheading

This should fail.

## REQUIREMENTS

null

## ARCHITECTURE

Represent type as a discriminator.

## ACTIVITY_LOG

- 2026-03-17: Captured the design goal for type-discriminated backlog items.
`;
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnostic(result, "backlog", codes.BODY_CONSTRAINT_VIOLATION, "ITEM-0001.md");
  });
});

test.concurrent("blockquotes are rejected when the section forbids them", async () => {
  await withFixtureSandbox("body-blockquote", async ({ root }) => {
    await updateRecord(root, itemPath, (record) => {
      record.content = `# ITEM-0001

## DESCRIPTION

> Quoted context is not allowed here.

## REQUIREMENTS

null

## ARCHITECTURE

Represent type as a discriminator.

## ACTIVITY_LOG

- 2026-03-17: Captured the design goal for type-discriminated backlog items.
`;
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnostic(result, "backlog", codes.BODY_CONSTRAINT_VIOLATION, "ITEM-0001.md");
  });
});

test.concurrent("code blocks are rejected when the section forbids them", async () => {
  await withFixtureSandbox("body-code-block", async ({ root }) => {
    await updateRecord(root, itemPath, (record) => {
      record.content = `# ITEM-0001

## DESCRIPTION

\`\`\`
module contract
\`\`\`

## REQUIREMENTS

null

## ARCHITECTURE

Represent type as a discriminator.

## ACTIVITY_LOG

- 2026-03-17: Captured the design goal for type-discriminated backlog items.
`;
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnostic(result, "backlog", codes.BODY_CONSTRAINT_VIOLATION, "ITEM-0001.md");
  });
});
