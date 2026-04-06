import { expect, test } from "bun:test";
import { codes, reasons } from "../src/diagnostics.ts";
import {
  expectModuleDiagnostic,
  expectModuleDiagnosticContaining,
  expectNoModuleDiagnostic,
  updateRecord,
  updateShapeYaml,
  validateFixture,
  withFixtureSandbox,
} from "./helpers/fixture.ts";

const itemPath = "workspace/backlog/items/ITEM-0001.md";
const incidentPath = "workspace/incident-response/reports/INC-0001.md";

function moduleDiagnostics(
  result: ReturnType<typeof validateFixture>,
  moduleId: string,
) {
  const moduleReport = result.modules.find((report) => report.module_id === moduleId);
  expect(moduleReport).toBeDefined();
  return moduleReport!.diagnostics;
}

test.concurrent("missing declared h1 titles are rejected", async () => {
  await withFixtureSandbox("body-missing-title", async ({ root }) => {
    await updateRecord(root, itemPath, (record) => {
      record.content = record.content.replace("# ITEM-0001\n\n", "");
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnosticContaining(result, "backlog", codes.BODY_CONSTRAINT_VIOLATION, "Missing declared h1 title", "ITEM-0001.md");
  });
});

test.concurrent("multiple top-level h1 headings are rejected", async () => {
  await withFixtureSandbox("body-multiple-h1", async ({ root }) => {
    await updateRecord(root, itemPath, (record) => {
      record.content = record.content.replace(
        "\n## DESCRIPTION\n\n",
        "\n# Unexpected Second Title\n\n## DESCRIPTION\n\n",
      );
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    const diagnostic = expectModuleDiagnosticContaining(
      result,
      "backlog",
      codes.BODY_CONSTRAINT_VIOLATION,
      "Multiple top-level h1 headings are not allowed",
      "ITEM-0001.md",
    );
    expect(diagnostic.reason).toBe(reasons.BODY_TITLE_MULTIPLE_H1);
  });
});

test.concurrent("content before the declared h1 title is rejected", async () => {
  await withFixtureSandbox("body-content-before-title", async ({ root }) => {
    await updateRecord(root, itemPath, (record) => {
      record.content = record.content.replace(
        "# ITEM-0001",
        "This content should fail because it appears before the declared h1 title.\n\n# ITEM-0001",
      );
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnosticContaining(result, "backlog", codes.BODY_CONSTRAINT_VIOLATION, "Content before the declared h1 title is not allowed", "ITEM-0001.md");
  });
});

test.concurrent("undeclared h1 titles are rejected when the shape does not declare a title", async () => {
  await withFixtureSandbox("body-undeclared-h1", async ({ root }) => {
    await updateShapeYaml(root, "backlog", 1, (shape) => {
      const entities = shape.entities as Record<string, Record<string, unknown>>;
      const item = entities.item;
      const body = item.body as Record<string, unknown>;
      delete body.title;
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnosticContaining(result, "backlog", codes.BODY_CONSTRAINT_VIOLATION, "Undeclared h1 title content is not allowed", "ITEM-0001.md");
  });
});

test.concurrent("undeclared top-level preamble content is rejected", async () => {
  await withFixtureSandbox("body-undeclared-preamble", async ({ root }) => {
    await updateRecord(root, itemPath, (record) => {
      record.content = record.content.replace(
        "# ITEM-0001\n\n",
        "# ITEM-0001\n\nThis paragraph should fail because backlog items do not declare a top-level preamble.\n\n",
      );
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnosticContaining(result, "backlog", codes.BODY_CONSTRAINT_VIOLATION, "Undeclared top-level preamble content is not allowed", "ITEM-0001.md");
  });
});

test.concurrent("duplicate top-level sections are rejected", async () => {
  await withFixtureSandbox("body-duplicate-sections", async ({ root }) => {
    await updateRecord(root, itemPath, (record) => {
      record.content = record.content.replace(
        "\n## REQUIREMENTS\n\n",
        "\n## DESCRIPTION\n\nThis duplicate section should fail.\n\n## REQUIREMENTS\n\n",
      );
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnosticContaining(result, "backlog", codes.BODY_CONSTRAINT_VIOLATION, "Duplicate top-level section '## DESCRIPTION' is not allowed", "ITEM-0001.md");
  });
});

test.concurrent("template title sources can validate exact rendered h1 text", async () => {
  await withFixtureSandbox("body-template-title-pass", async ({ root }) => {
    await updateShapeYaml(root, "backlog", 1, (shape) => {
      const entities = shape.entities as Record<string, Record<string, unknown>>;
      const item = entities.item;
      const body = item.body as Record<string, unknown>;
      body.title = {
        source: {
          kind: "template",
          parts: [
            { kind: "field", field: "id" },
            { kind: "literal", value: " " },
            { kind: "field", field: "title" },
          ],
        },
      };
    });

    await updateRecord(root, itemPath, (record) => {
      record.content = record.content.replace("# ITEM-0001", "# ITEM-0001 Introduce Variant-Aware Backlog Items");
    });
    await updateRecord(root, "workspace/backlog/items/ITEM-0002.md", (record) => {
      record.content = record.content.replace("# ITEM-0002", "# ITEM-0002 Harden Module Validation Output");
    });
    await updateRecord(root, "workspace/backlog/items/ITEM-0003.md", (record) => {
      record.content = record.content.replace("# ITEM-0003", "# ITEM-0003 Evaluate Global Status Buckets");
    });

    const result = validateFixture(root);
    expect(result.status).toBe("pass");
    expectNoModuleDiagnostic(result, "backlog", codes.BODY_CONSTRAINT_VIOLATION, "ITEM-0001.md");
  });
});

test.concurrent("field-backed title sources fail closed on non-string frontmatter values", async () => {
  await withFixtureSandbox("body-title-invalid-source-field", async ({ root }) => {
    await updateShapeYaml(root, "backlog", 1, (shape) => {
      const entities = shape.entities as Record<string, Record<string, unknown>>;
      const item = entities.item;
      const body = item.body as Record<string, unknown>;
      body.title = {
        source: {
          kind: "field",
          field: "title",
        },
      };
    });

    await updateRecord(root, itemPath, (record) => {
      record.data.title = 42;
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnosticContaining(result, "backlog", codes.BODY_CONSTRAINT_VIOLATION, "Cannot validate the declared h1 title", "ITEM-0001.md");
  });
});

test.concurrent("top-level definitions are rejected with a dedicated markdown diagnostic", async () => {
  await withFixtureSandbox("body-definition-unsupported", async ({ root }) => {
    await updateRecord(root, itemPath, (record) => {
      record.content = record.content.replace(
        "Refactor the backlog module so one item entity can represent different work types without forcing every type into one shared workflow.\n",
        "[backlog-link]: https://example.com/backlog\n",
      );
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    const diagnostic = expectModuleDiagnosticContaining(
      result,
      "backlog",
      codes.BODY_UNSUPPORTED_MARKDOWN,
      "Reference-style links and images are not supported",
      "ITEM-0001.md",
    );
    expect(diagnostic.reason).toBe(reasons.BODY_MARKDOWN_REFERENCE_STYLE_UNSUPPORTED);
    expect(moduleDiagnostics(result, "backlog").filter((diagnostic) => diagnostic.code === codes.BODY_UNSUPPORTED_MARKDOWN)).toHaveLength(1);
    expectNoModuleDiagnostic(result, "backlog", codes.BODY_CONSTRAINT_VIOLATION, "ITEM-0001.md");
  });
});

test.concurrent("reference-style links are rejected with a dedicated markdown diagnostic", async () => {
  await withFixtureSandbox("body-reference-link-unsupported", async ({ root }) => {
    await updateRecord(root, itemPath, (record) => {
      record.content = record.content.replace(
        "Refactor the backlog module so one item entity can represent different work types without forcing every type into one shared workflow.\n",
        "A [reference-style link][backlog-link].\n\n[backlog-link]: https://example.com/backlog\n",
      );
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnosticContaining(
      result,
      "backlog",
      codes.BODY_UNSUPPORTED_MARKDOWN,
      "Reference-style links and images are not supported",
      "ITEM-0001.md",
    );
    expectNoModuleDiagnostic(result, "backlog", codes.BODY_CONSTRAINT_VIOLATION, "ITEM-0001.md");
  });
});

test.concurrent("reference-style links are rejected when nested inside allowed list content", async () => {
  await withFixtureSandbox("body-reference-link-list-nested", async ({ root }) => {
    await updateRecord(root, itemPath, (record) => {
      record.content = record.content.replace(
        "- Preserve a single backlog item identity shape for refs and search.\n",
        "- Preserve a [reference-style link][backlog-doc] for refs and search.\n\n  [backlog-doc]: https://example.com/backlog-doc\n",
      );
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnosticContaining(
      result,
      "backlog",
      codes.BODY_UNSUPPORTED_MARKDOWN,
      "Reference-style links and images are not supported",
      "ITEM-0001.md",
    );
    expect(moduleDiagnostics(result, "backlog").filter((diagnostic) => diagnostic.code === codes.BODY_UNSUPPORTED_MARKDOWN)).toHaveLength(1);
    expectNoModuleDiagnostic(result, "backlog", codes.BODY_CONSTRAINT_VIOLATION, "ITEM-0001.md");
  });
});

test.concurrent("reference-style images are rejected with a dedicated markdown diagnostic", async () => {
  await withFixtureSandbox("body-reference-image-unsupported", async ({ root }) => {
    await updateRecord(root, itemPath, (record) => {
      record.content = record.content.replace(
        "Refactor the backlog module so one item entity can represent different work types without forcing every type into one shared workflow.\n",
        "![Backlog diagram][backlog-image]\n\n[backlog-image]: https://example.com/backlog.png\n",
      );
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnosticContaining(
      result,
      "backlog",
      codes.BODY_UNSUPPORTED_MARKDOWN,
      "Reference-style links and images are not supported",
      "ITEM-0001.md",
    );
    expectNoModuleDiagnostic(result, "backlog", codes.BODY_CONSTRAINT_VIOLATION, "ITEM-0001.md");
  });
});

test.concurrent("html blocks are rejected with a dedicated markdown diagnostic", async () => {
  await withFixtureSandbox("body-flow-html-unsupported", async ({ root }) => {
    await updateRecord(root, itemPath, (record) => {
      record.content = record.content.replace(
        "Refactor the backlog module so one item entity can represent different work types without forcing every type into one shared workflow.\n",
        "<div>Backlog HTML block</div>\n",
      );
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnosticContaining(
      result,
      "backlog",
      codes.BODY_UNSUPPORTED_MARKDOWN,
      "HTML blocks are not allowed",
      "ITEM-0001.md",
    );
    expectNoModuleDiagnostic(result, "backlog", codes.BODY_CONSTRAINT_VIOLATION, "ITEM-0001.md");
  });
});

test.concurrent("inline html is rejected with a dedicated markdown diagnostic", async () => {
  await withFixtureSandbox("body-inline-html-unsupported", async ({ root }) => {
    await updateRecord(root, itemPath, (record) => {
      record.content = record.content.replace(
        "Refactor the backlog module so one item entity can represent different work types without forcing every type into one shared workflow.\n",
        "Refactor the <span>backlog</span> module without raw HTML.\n",
      );
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnosticContaining(
      result,
      "backlog",
      codes.BODY_UNSUPPORTED_MARKDOWN,
      "Inline HTML is not allowed",
      "ITEM-0001.md",
    );
    expectNoModuleDiagnostic(result, "backlog", codes.BODY_CONSTRAINT_VIOLATION, "ITEM-0001.md");
  });
});

test.concurrent("inline html is rejected when nested inside allowed list content", async () => {
  await withFixtureSandbox("body-inline-html-list-nested", async ({ root }) => {
    await updateRecord(root, itemPath, (record) => {
      record.content = record.content.replace(
        "- Preserve a single backlog item identity shape for refs and search.\n",
        "- Preserve a <span>single</span> backlog item identity shape for refs and search.\n",
      );
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnosticContaining(
      result,
      "backlog",
      codes.BODY_UNSUPPORTED_MARKDOWN,
      "Inline HTML is not allowed",
      "ITEM-0001.md",
    );
    expectNoModuleDiagnostic(result, "backlog", codes.BODY_CONSTRAINT_VIOLATION, "ITEM-0001.md");
  });
});

test.concurrent("thematic breaks are rejected with a dedicated markdown diagnostic", async () => {
  await withFixtureSandbox("body-thematic-break-unsupported", async ({ root }) => {
    await updateRecord(root, itemPath, (record) => {
      record.content = record.content.replace(
        "Refactor the backlog module so one item entity can represent different work types without forcing every type into one shared workflow.\n",
        "***\n",
      );
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnosticContaining(
      result,
      "backlog",
      codes.BODY_UNSUPPORTED_MARKDOWN,
      "Thematic breaks are not supported",
      "ITEM-0001.md",
    );
    expectNoModuleDiagnostic(result, "backlog", codes.BODY_CONSTRAINT_VIOLATION, "ITEM-0001.md");
  });
});

test.concurrent("flow and inline html produce distinct markdown diagnostics", async () => {
  await withFixtureSandbox("body-html-flow-inline-combined", async ({ root }) => {
    await updateRecord(root, itemPath, (record) => {
      record.content = record.content.replace(
        "Refactor the backlog module so one item entity can represent different work types without forcing every type into one shared workflow.\n",
        "<div>Backlog HTML block</div>\n",
      ).replace(
        "Represent type as a discriminator and treat app-specific structure as a variant layered on top of shared item identity and shared base sections.\n",
        "Represent the <span>type</span> as a discriminator and treat app-specific structure as a variant layered on top of shared item identity and shared base sections.\n",
      );
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    const markdownDiagnostics = moduleDiagnostics(result, "backlog").filter((diagnostic) =>
      diagnostic.code === codes.BODY_UNSUPPORTED_MARKDOWN
    );
    expect(markdownDiagnostics).toHaveLength(2);
    expect(markdownDiagnostics.some((diagnostic) => diagnostic.message.includes("HTML blocks are not allowed"))).toBe(true);
    expect(markdownDiagnostics.some((diagnostic) => diagnostic.message.includes("Inline HTML is not allowed"))).toBe(true);
    expectNoModuleDiagnostic(result, "backlog", codes.BODY_CONSTRAINT_VIOLATION, "ITEM-0001.md");
  });
});

test.concurrent("inline links remain allowed in body content", async () => {
  await withFixtureSandbox("body-inline-link-allowed", async ({ root }) => {
    await updateRecord(root, itemPath, (record) => {
      record.content = record.content.replace(
        "Refactor the backlog module so one item entity can represent different work types without forcing every type into one shared workflow.\n",
        "Refactor the [backlog contract](https://example.com/backlog-contract) so one item entity can represent different work types without forcing every type into one shared workflow.\n",
      );
    });

    const result = validateFixture(root);
    expect(result.status).toBe("pass");
    expectNoModuleDiagnostic(result, "backlog", codes.BODY_UNSUPPORTED_MARKDOWN, "ITEM-0001.md");
  });
});

test.concurrent("tables are rejected when the region does not declare table support", async () => {
  await withFixtureSandbox("body-table-forbidden", async ({ root }) => {
    await updateRecord(root, itemPath, (record) => {
      record.content = record.content.replace(
        "Refactor the backlog module so one item entity can represent different work types without forcing every type into one shared workflow.\n",
        "| Region | Effect |\n| --- | --- |\n| backlog | variant-aware item shape |\n",
      );
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    const diagnostic = expectModuleDiagnosticContaining(
      result,
      "backlog",
      codes.BODY_CONSTRAINT_VIOLATION,
      "unsupported markdown block 'table'",
      "ITEM-0001.md",
    );
    expect(diagnostic.reason).toBe(reasons.BODY_REGION_BLOCK_UNSUPPORTED);
  });
});

test.concurrent("valid gfm tables are accepted when the region declares table support", async () => {
  await withFixtureSandbox("body-table-allowed", async ({ root }) => {
    await updateShapeYaml(root, "backlog", 1, (shape) => {
      const entities = shape.entities as Record<string, Record<string, unknown>>;
      const definitions = entities.item.section_definitions as Record<string, Record<string, unknown>>;
      const description = definitions.DESCRIPTION;
      const content = description.content as Record<string, unknown>;
      content.blocks = {
        table: {
          syntax: "gfm",
        },
      };
    });

    const descriptionTableByPath: Record<string, string> = {
      "workspace/backlog/items/ITEM-0001.md": "| Region | Effect |\n| --- | --- |\n| backlog | variant-aware item shape |\n",
      "workspace/backlog/items/ITEM-0002.md": "| Area | Goal |\n| --- | --- |\n| diagnostics | easier triage during fixture development |\n",
      "workspace/backlog/items/ITEM-0003.md": "| Question | Intent |\n| --- | --- |\n| status buckets | evaluate rollup value without changing validation |\n",
    };

    for (const [path, table] of Object.entries(descriptionTableByPath)) {
      await updateRecord(root, path, (record) => {
        record.content = record.content.replace(
          /## DESCRIPTION\n\n[\s\S]*?\n## /,
          `## DESCRIPTION\n\n${table}\n## `,
        );
      });
    }

    const result = validateFixture(root);
    expect(result.status).toBe("pass");
    expectNoModuleDiagnostic(result, "backlog", codes.BODY_CONSTRAINT_VIOLATION, "ITEM-0001.md");
  });
});

test.concurrent("malformed pipe text is not treated as a table", async () => {
  await withFixtureSandbox("body-table-malformed", async ({ root }) => {
    await updateShapeYaml(root, "backlog", 1, (shape) => {
      const entities = shape.entities as Record<string, Record<string, unknown>>;
      const definitions = entities.item.section_definitions as Record<string, Record<string, unknown>>;
      const description = definitions.DESCRIPTION;
      const content = description.content as Record<string, unknown>;
      content.blocks = {
        table: {
          syntax: "gfm",
        },
      };
    });

    await updateRecord(root, itemPath, (record) => {
      record.content = record.content.replace(
        "Refactor the backlog module so one item entity can represent different work types without forcing every type into one shared workflow.\n",
        "| Region | Effect |\n| backlog | variant-aware item shape |\n",
      );
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnosticContaining(result, "backlog", codes.BODY_CONSTRAINT_VIOLATION, "unsupported markdown block 'paragraph'", "ITEM-0001.md");
  });
});

test.concurrent("tables are rejected inside outline nodes that do not declare table support", async () => {
  await withFixtureSandbox("body-outline-table-forbidden", async ({ root }) => {
    await updateRecord(root, incidentPath, (record) => {
      record.content = record.content.replace(
        "### Affected Flows\n\n- Incident-recovery agents handling multi-step retries\n- Escalation planners that depend on the latest safety policy manifest\n",
        "### Affected Flows\n\n| Flow | Impact |\n| --- | --- |\n| Incident-recovery agents | degraded |\n\n- Incident-recovery agents handling multi-step retries\n- Escalation planners that depend on the latest safety policy manifest\n",
      );
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnosticContaining(result, "incident-response", codes.BODY_CONSTRAINT_VIOLATION, "unsupported markdown block 'table'", "INC-0001.md");
  });
});

test.concurrent("template title mismatches are rejected", async () => {
  await withFixtureSandbox("body-template-title-fail", async ({ root }) => {
    await updateShapeYaml(root, "backlog", 1, (shape) => {
      const entities = shape.entities as Record<string, Record<string, unknown>>;
      const item = entities.item;
      const body = item.body as Record<string, unknown>;
      body.title = {
        source: {
          kind: "template",
          parts: [
            { kind: "field", field: "id" },
            { kind: "literal", value: " " },
            { kind: "field", field: "title" },
          ],
        },
      };
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnosticContaining(result, "backlog", codes.BODY_CONSTRAINT_VIOLATION, "The h1 title does not match the declared title source", "ITEM-0001.md");
  });
});

test.concurrent("paragraph min_count violations are rejected", async () => {
  await withFixtureSandbox("body-paragraph-min-count", async ({ root }) => {
    await updateShapeYaml(root, "backlog", 1, (shape) => {
      const entities = shape.entities as Record<string, Record<string, unknown>>;
      const definitions = entities.item.section_definitions as Record<string, Record<string, unknown>>;
      const description = definitions.DESCRIPTION;
      const content = description.content as Record<string, unknown>;
      const blocks = content.blocks as Record<string, unknown>;
      blocks.paragraph = { min_count: 2 };
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnosticContaining(result, "backlog", codes.BODY_CONSTRAINT_VIOLATION, "too few 'paragraph' blocks", "ITEM-0001.md");
  });
});

test.concurrent("paragraph max_count violations are rejected", async () => {
  await withFixtureSandbox("body-paragraph-max-count", async ({ root }) => {
    await updateShapeYaml(root, "backlog", 1, (shape) => {
      const entities = shape.entities as Record<string, Record<string, unknown>>;
      const definitions = entities.item.section_definitions as Record<string, Record<string, unknown>>;
      const description = definitions.DESCRIPTION;
      const content = description.content as Record<string, unknown>;
      const blocks = content.blocks as Record<string, unknown>;
      blocks.paragraph = { max_count: 1 };
    });

    await updateRecord(root, itemPath, (record) => {
      record.content = record.content.replace(
        "Refactor the backlog module so one item entity can represent different work types without forcing every type into one shared workflow.\n",
        "Refactor the backlog module so one item entity can represent different work types without forcing every type into one shared workflow.\n\nThis extra paragraph should violate the max_count constraint.\n",
      );
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnosticContaining(result, "backlog", codes.BODY_CONSTRAINT_VIOLATION, "too many 'paragraph' blocks", "ITEM-0001.md");
  });
});

test.concurrent("list min_items violations are rejected", async () => {
  await withFixtureSandbox("body-list-min-items", async ({ root }) => {
    await updateShapeYaml(root, "backlog", 1, (shape) => {
      const entities = shape.entities as Record<string, Record<string, unknown>>;
      const definitions = entities.item.section_definitions as Record<string, Record<string, unknown>>;
      const requirements = definitions.REQUIREMENTS;
      const content = requirements.content as Record<string, unknown>;
      const blocks = content.blocks as Record<string, unknown>;
      blocks.bullet_list = { min_items: 4 };
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnosticContaining(result, "backlog", codes.BODY_CONSTRAINT_VIOLATION, "has too few items", "ITEM-0001.md");
  });
});

test.concurrent("list max_items violations are rejected", async () => {
  await withFixtureSandbox("body-list-max-items", async ({ root }) => {
    await updateShapeYaml(root, "backlog", 1, (shape) => {
      const entities = shape.entities as Record<string, Record<string, unknown>>;
      const definitions = entities.item.section_definitions as Record<string, Record<string, unknown>>;
      const activityLog = definitions.ACTIVITY_LOG;
      const content = activityLog.content as Record<string, unknown>;
      const blocks = content.blocks as Record<string, unknown>;
      blocks.bullet_list = { max_items: 1 };
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnosticContaining(result, "backlog", codes.BODY_CONSTRAINT_VIOLATION, "has too many items", "ITEM-0001.md");
  });
});

test.concurrent("heading depth violations are rejected", async () => {
  await withFixtureSandbox("body-heading-depth", async ({ root }) => {
    await updateRecord(root, incidentPath, (record) => {
      record.content = record.content.replace("#### Cache Shard 07", "### Cache Shard 07");
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnosticContaining(result, "incident-response", codes.BODY_CONSTRAINT_VIOLATION, "Heading depth 3 is structural", "INC-0001.md");
  });
});

test.concurrent("code blocks that omit languages are rejected when require_language is true", async () => {
  await withFixtureSandbox("body-require-language", async ({ root }) => {
    await updateRecord(root, incidentPath, (record) => {
      record.content = record.content.replace("```yaml", "```");
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnosticContaining(result, "incident-response", codes.BODY_CONSTRAINT_VIOLATION, "must declare a language", "INC-0001.md");
  });
});

test.concurrent("missing required outline nodes are rejected", async () => {
  await withFixtureSandbox("body-outline-missing-node", async ({ root }) => {
    await updateRecord(root, incidentPath, (record) => {
      record.content = record.content.replace(
        /\n### Recovery Lead Notes\n\n> If the cached policy version and the prompt contract disagree, treat the cache as advisory, not authoritative\.\n/s,
        "\n",
      );
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnostic(result, "incident-response", codes.BODY_CONSTRAINT_VIOLATION, "INC-0001.md");
  });
});

test.concurrent("undeclared outline preamble content is rejected", async () => {
  await withFixtureSandbox("body-outline-undeclared-preamble", async ({ root }) => {
    await updateRecord(root, incidentPath, (record) => {
      record.content = record.content.replace(
        "## IMPACT\n\n",
        "## IMPACT\n\nUnexpected lead-in before the first outlined heading.\n\n",
      );
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnostic(result, "incident-response", codes.BODY_CONSTRAINT_VIOLATION, "INC-0001.md");
  });
});
