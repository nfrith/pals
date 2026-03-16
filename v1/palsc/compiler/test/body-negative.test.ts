import { expect, test } from "bun:test";
import { codes } from "../src/diagnostics.ts";
import { expectModuleDiagnostic, updateRecord, validateFixture, withFixtureSandbox } from "./helpers/fixture.ts";

const storyPath = "workspace/backlog/stories/STORY-0001.md";

test.concurrent("missing required sections are rejected", async () => {
  await withFixtureSandbox("body-missing-section", async ({ root }) => {
    await updateRecord(root, storyPath, (record) => {
      record.content = `# STORY-0001

## CONTEXT

Module contracts must reduce ambiguity for orchestrator and module skills.

## NOTES

null
`;
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnostic(result, "backlog", codes.BODY_MISSING_SECTION, "STORY-0001.md");
  });
});

test.concurrent("unknown sections are rejected", async () => {
  await withFixtureSandbox("body-unknown-section", async ({ root }) => {
    await updateRecord(root, storyPath, (record) => {
      record.content = `${record.content.trim()}\n\n## EXTRA\n\nUnexpected section.\n`;
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnostic(result, "backlog", codes.BODY_UNKNOWN_SECTION, "STORY-0001.md");
  });
});

test.concurrent("section order must match the shape", async () => {
  await withFixtureSandbox("body-order", async ({ root }) => {
    await updateRecord(root, storyPath, (record) => {
      record.content = `# STORY-0001

## ACCEPTANCE

- \`.pals/system.yaml\` declares deployed module pointers.
- \`.pals/modules/<module>/vN.yaml\` defines entity paths and record shape.

## CONTEXT

Module contracts must reduce ambiguity for orchestrator and module skills.

## NOTES

null
`;
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnostic(result, "backlog", codes.BODY_ORDER_MISMATCH, "STORY-0001.md");
  });
});

test.concurrent("non-nullable sections cannot contain null", async () => {
  await withFixtureSandbox("body-null-not-allowed", async ({ root }) => {
    await updateRecord(root, storyPath, (record) => {
      record.content = `# STORY-0001

## CONTEXT

null

## ACCEPTANCE

- \`.pals/system.yaml\` declares deployed module pointers.
- \`.pals/modules/<module>/vN.yaml\` defines entity paths and record shape.

## NOTES

null
`;
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnostic(result, "backlog", codes.BODY_NULL_NOT_ALLOWED, "STORY-0001.md");
  });
});

test.concurrent("empty sections are rejected even when nullable", async () => {
  await withFixtureSandbox("body-empty-section", async ({ root }) => {
    await updateRecord(root, storyPath, (record) => {
      record.content = `# STORY-0001

## CONTEXT

Module contracts must reduce ambiguity for orchestrator and module skills.

## ACCEPTANCE

- \`.pals/system.yaml\` declares deployed module pointers.
- \`.pals/modules/<module>/vN.yaml\` defines entity paths and record shape.

## NOTES

`;
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnostic(result, "backlog", codes.BODY_EMPTY_MARKER, "STORY-0001.md");
  });
});

test.concurrent("unsupported paragraph blocks fail list-only sections", async () => {
  await withFixtureSandbox("body-list-constraint", async ({ root }) => {
    await updateRecord(root, storyPath, (record) => {
      record.content = `# STORY-0001

## CONTEXT

Module contracts must reduce ambiguity for orchestrator and module skills.

## ACCEPTANCE

This should have been a list.

## NOTES

null
`;
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnostic(result, "backlog", codes.BODY_CONSTRAINT_VIOLATION, "STORY-0001.md");
  });
});

test.concurrent("subheadings are rejected when the section forbids them", async () => {
  await withFixtureSandbox("body-subheading", async ({ root }) => {
    await updateRecord(root, storyPath, (record) => {
      record.content = `# STORY-0001

## CONTEXT

Module contracts must reduce ambiguity for orchestrator and module skills.

### Illegal Subheading

This should fail.

## ACCEPTANCE

- \`.pals/system.yaml\` declares deployed module pointers.
- \`.pals/modules/<module>/vN.yaml\` defines entity paths and record shape.

## NOTES

null
`;
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnostic(result, "backlog", codes.BODY_CONSTRAINT_VIOLATION, "STORY-0001.md");
  });
});

test.concurrent("blockquotes are rejected when the section forbids them", async () => {
  await withFixtureSandbox("body-blockquote", async ({ root }) => {
    await updateRecord(root, storyPath, (record) => {
      record.content = `# STORY-0001

## CONTEXT

> Quoted context is not allowed here.

## ACCEPTANCE

- \`.pals/system.yaml\` declares deployed module pointers.
- \`.pals/modules/<module>/vN.yaml\` defines entity paths and record shape.

## NOTES

null
`;
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnostic(result, "backlog", codes.BODY_CONSTRAINT_VIOLATION, "STORY-0001.md");
  });
});

test.concurrent("code blocks are rejected when the section forbids them", async () => {
  await withFixtureSandbox("body-code-block", async ({ root }) => {
    await updateRecord(root, storyPath, (record) => {
      record.content = `# STORY-0001

## CONTEXT

\`\`\`
module contract
\`\`\`

## ACCEPTANCE

- \`.pals/system.yaml\` declares deployed module pointers.
- \`.pals/modules/<module>/vN.yaml\` defines entity paths and record shape.

## NOTES

null
`;
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnostic(result, "backlog", codes.BODY_CONSTRAINT_VIOLATION, "STORY-0001.md");
  });
});
