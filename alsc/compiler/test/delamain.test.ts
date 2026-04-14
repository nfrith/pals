import { expect, test } from "bun:test";
import matter from "gray-matter";
import { join } from "node:path";
import { loadAuthoredSourceExport } from "../src/authored-load.ts";
import { codes } from "../src/diagnostics.ts";
import {
  expectModuleDiagnostic,
  expectNoModuleDiagnostic,
  updateRecord,
  updateShapeYaml,
  updateSystemYaml,
  updateTextFile,
  validateFixture,
  withFixtureSandbox,
  writePath,
} from "./helpers/fixture.ts";

test.concurrent("plain entities reject multiple Delamain-bound fields in the same effective schema", async () => {
  await withFixtureSandbox("delamain-plain-conflict", async ({ root }) => {
    await updateShapeYaml(root, "factory", 1, (shape) => {
      const entities = shape.entities as Record<string, Record<string, unknown>>;
      const fields = entities["work-item"].fields as Record<string, Record<string, unknown>>;
      fields.secondary_status = {
        type: "delamain",
        allow_null: false,
        delamain: "development-pipeline",
      };
    });

    for (const itemId of ["SWF-001", "SWF-002", "SWF-003"]) {
      await updateRecord(root, `workspace/factory/items/${itemId}.md`, (record) => {
        record.data.secondary_status = record.data.status;
      });
    }

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnostic(result, "factory", codes.DELAMAIN_CONTRACT_INVALID, ".als/modules/factory/v1/module.ts");
  });
});

test.concurrent("Delamain prompt assets must stay inside the active module version bundle", async () => {
  await withFixtureSandbox("delamain-path-escape", async ({ root }) => {
    await updateYamlTextFile(
      root,
      ".als/modules/factory/v1/delamains/development-pipeline/delamain.ts",
      (current) => {
        const states = current.states as Record<string, Record<string, unknown>>;
        states.planning.path = "../../../../../../../../tmp/planning.md";
      },
    );

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnostic(result, "factory", codes.DELAMAIN_FILE_INVALID, "development-pipeline/delamain.ts");
  });
});

test.concurrent("Delamain prompt assets must declare name and description frontmatter", async () => {
  await withFixtureSandbox("delamain-prompt-invalid", async ({ root }) => {
    await updateMarkdownFrontmatterFile(
      root,
      ".als/modules/factory/v1/delamains/development-pipeline/agents/planning.md",
      (data) => {
        delete data.description;
      },
    );

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnostic(result, "factory", codes.DELAMAIN_PROMPT_INVALID, "agents/planning.md");
  });
});

test.concurrent("malformed Delamain prompt frontmatter produces a diagnostic instead of crashing validation", async () => {
  await withFixtureSandbox("delamain-prompt-frontmatter-parse", async ({ root }) => {
    await updateTextFile(
      root,
      ".als/modules/factory/v1/delamains/development-pipeline/agents/planning.md",
      () => "---\nname: planning\ndescription: [broken\n---\n\nbody\n",
    );

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnostic(result, "factory", codes.DELAMAIN_PROMPT_INVALID, "agents/planning.md");
  });
});

test.concurrent("delegated is rejected on operator-owned states during bundle validation", async () => {
  await withFixtureSandbox("delamain-delegated-operator-state", async ({ root }) => {
    await updateYamlTextFile(
      root,
      ".als/modules/factory/v1/delamains/development-pipeline/delamain.ts",
      (current) => {
        const states = current.states as Record<string, Record<string, unknown>>;
        states["plan-input"].delegated = true;
      },
    );

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnostic(result, "factory", codes.DELAMAIN_INVALID, "development-pipeline/delamain.ts");
  });
});

test.concurrent("Delamain session fields cannot collide with explicit fields on the same effective schema", async () => {
  await withFixtureSandbox("delamain-session-field-collision", async ({ root }) => {
    await updateShapeYaml(root, "factory", 1, (shape) => {
      const entities = shape.entities as Record<string, Record<string, unknown>>;
      const fields = entities["work-item"].fields as Record<string, Record<string, unknown>>;
      fields.planner_session = {
        type: "string",
        allow_null: true,
      };
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnostic(result, "factory", codes.DELAMAIN_CONTRACT_INVALID, ".als/modules/factory/v1/module.ts");
  });
});

test.concurrent("invalid persisted Delamain state values are rejected in record frontmatter", async () => {
  await withFixtureSandbox("delamain-invalid-state-value", async ({ root }) => {
    await updateRecord(root, "workspace/factory/items/SWF-001.md", (record) => {
      record.data.status = "imaginary-state";
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnostic(result, "factory", codes.FM_ENUM_INVALID, "workspace/factory/items/SWF-001.md");
  });
});

test.concurrent("missing Delamain bundles fail closed during record validation without spurious unknown session-field errors", async () => {
  await withFixtureSandbox("delamain-bundle-missing", async ({ root }) => {
    await updateTextFile(
      root,
      "workspace/factory/items/SWF-001.md",
      (current) => current.replace("status: plan-input", "status: not-a-state"),
    );
    await updateTextFile(
      root,
      ".als/modules/factory/v1/delamains/development-pipeline/delamain.ts",
      () => "",
    );

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnostic(result, "factory", codes.DELAMAIN_INVALID, "development-pipeline/delamain.ts");
    expectModuleDiagnostic(result, "factory", codes.DELAMAIN_CONTRACT_INVALID, "workspace/factory/items/SWF-001.md");
    expectNoModuleDiagnostic(result, "factory", codes.FM_UNKNOWN_FIELD, "workspace/factory/items/SWF-001.md");
  });
});

test.concurrent("variant entities reject base and variant Delamain bindings in the same effective schema", async () => {
  await withFixtureSandbox("delamain-variant-base-plus-variant", async ({ root }) => {
    await installVariantDelamainModule(root);

    await updateShapeYaml(root, "delamain-variants", 1, (shape) => {
      const entities = shape.entities as Record<string, Record<string, unknown>>;
      const fields = entities.ticket.fields as Record<string, Record<string, unknown>>;
      fields.workflow = {
        type: "delamain",
        allow_null: false,
        delamain: "alpha-flow",
      };
    });

    await updateRecord(root, "workspace/delamain-variants/tickets/TKT-001.md", (record) => {
      record.data.workflow = "draft";
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnostic(result, "delamain-variants", codes.DELAMAIN_CONTRACT_INVALID, ".als/modules/delamain-variants/v1/module.ts");
  });
});

test.concurrent("variant entities can bind different Delamains in separate effective schemas", async () => {
  await withFixtureSandbox("delamain-variant-separate", async ({ root }) => {
    await installVariantDelamainModule(root);

    const result = validateFixture(root);
    expect(result.status).toBe("pass");
    expect(result.summary.error_count).toBe(0);
  });
});

async function installVariantDelamainModule(root: string): Promise<void> {
  await updateSystemYaml(root, (system) => {
    const modules = system.modules as Record<string, Record<string, unknown>>;
    modules["delamain-variants"] = {
      path: "workspace/delamain-variants",
      version: 1,
      skills: [],
    };
  });

  const delamainShape = {
    phases: ["intake", "closed"],
    states: {
      draft: {
        initial: true,
        phase: "intake",
        actor: "operator",
      },
      completed: {
        phase: "closed",
        terminal: true,
      },
    },
    transitions: [
      {
        class: "exit",
        from: "draft",
        to: "completed",
      },
    ],
  };

  await writePath(
    root,
    ".als/modules/delamain-variants/v1/module.ts",
    serializeAuthoredDefinition("module", {
      dependencies: [],
      delamains: {
        "alpha-flow": {
          path: "delamains/alpha-flow/delamain.ts",
        },
        "beta-flow": {
          path: "delamains/beta-flow/delamain.ts",
        },
      },
      entities: {
        ticket: {
          source_format: "markdown",
          path: "tickets/{id}.md",
          identity: {
            id_field: "id",
          },
          discriminator: "type",
          fields: {
            id: {
              type: "id",
              allow_null: false,
            },
            title: {
              type: "string",
              allow_null: false,
            },
            type: {
              type: "enum",
              allow_null: false,
              allowed_values: ["alpha", "beta"],
            },
          },
          body: {
            title: {
              source: {
                kind: "field",
                field: "id",
              },
            },
          },
          section_definitions: {
            DESCRIPTION: {
              allow_null: false,
              content: {
                mode: "freeform",
                blocks: {
                  paragraph: {},
                },
              },
            },
          },
          variants: {
            alpha: {
              fields: {
                status: {
                  type: "delamain",
                  allow_null: false,
                  delamain: "alpha-flow",
                },
              },
              sections: ["DESCRIPTION"],
            },
            beta: {
              fields: {
                status: {
                  type: "delamain",
                  allow_null: false,
                  delamain: "beta-flow",
                },
              },
              sections: ["DESCRIPTION"],
            },
          },
        },
      },
    }),
  );

  await writePath(
    root,
    ".als/modules/delamain-variants/v1/delamains/alpha-flow/delamain.ts",
    serializeAuthoredDefinition("delamain", delamainShape),
  );
  await writePath(
    root,
    ".als/modules/delamain-variants/v1/delamains/beta-flow/delamain.ts",
    serializeAuthoredDefinition("delamain", delamainShape),
  );
  await writePath(
    root,
    "workspace/delamain-variants/tickets/TKT-001.md",
    matter.stringify(
      "\n# TKT-001\n\n## DESCRIPTION\n\nAlpha ticket.\n",
      {
        id: "TKT-001",
        title: "Alpha ticket",
        type: "alpha",
        status: "draft",
      },
    ),
  );
}

async function updateYamlTextFile(
  root: string,
  relativePath: string,
  transform: (current: Record<string, unknown>) => void | Promise<void>,
): Promise<void> {
  await updateTextFile(root, relativePath, async (current) => {
    const exportName = relativePath.endsWith("/delamain.ts") ? "delamain" : "module";
    const loaded = loadAuthoredSourceExport(join(root, relativePath), exportName, "module_shape", "fixture", null);
    if (!loaded.success || typeof loaded.data !== "object" || loaded.data === null || Array.isArray(loaded.data)) {
      throw new Error(`Expected authored object at '${relativePath}'`);
    }

    const parsed = structuredClone(loaded.data as Record<string, unknown>);
    await transform(parsed);
    return serializeAuthoredDefinition(exportName, parsed);
  });
}

async function updateMarkdownFrontmatterFile(
  root: string,
  relativePath: string,
  transform: (data: Record<string, unknown>) => void | Promise<void>,
): Promise<void> {
  await updateTextFile(root, relativePath, async (current) => {
    const parsed = matter(current);
    const data = structuredClone(parsed.data as Record<string, unknown>);
    await transform(data);
    return matter.stringify(parsed.content, data);
  });
}

function serializeAuthoredDefinition(
  exportName: "module" | "delamain",
  value: Record<string, unknown>,
): string {
  const helperName = exportName === "module" ? "defineModule" : "defineDelamain";
  const importPath = exportName === "module" ? "../../../authoring.ts" : "../../../../../authoring.ts";
  return `import { ${helperName} } from ${JSON.stringify(importPath)};\n\nexport const ${exportName} = ${helperName}(${JSON.stringify(value, null, 2)} as const);\n\nexport default ${exportName};\n`;
}
