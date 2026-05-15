import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { chmod } from "node:fs/promises";
import { join } from "node:path";
import { codes, reasons } from "../src/diagnostics.ts";
import {
  expectModuleDiagnostic,
  expectModuleDiagnosticContaining,
  expectNoModuleDiagnostic,
  renamePath,
  removePath,
  updateRecord,
  updateShapeYaml,
  updateTextFile,
  validateFixture,
  withFixtureSandbox,
  writePath,
} from "./helpers/fixture.ts";

function moduleIgnoredCount(
  result: ReturnType<typeof validateFixture>,
  moduleId: string,
): number {
  const moduleReport = result.modules.find((report) => report.module_id === moduleId);
  expect(moduleReport).toBeDefined();
  return moduleReport!.summary.files_ignored;
}

function reservedPathDelta(root: string, relativePath: string): 0 | 1 {
  return existsSync(join(root, relativePath)) ? 0 : 1;
}

function isRootUser(): boolean {
  return typeof process.getuid === "function" && process.getuid() === 0;
}

function groupedFactoryEntity(path: string): Record<string, unknown> {
  return {
    source_format: "markdown",
    path,
    identity: {
      id_field: "id",
    },
    fields: {
      id: {
        type: "id",
        allow_null: false,
      },
      title: {
        type: "string",
        allow_null: false,
      },
    },
    body: {
      title: {
        source: {
          kind: "field",
          field: "title",
        },
      },
      sections: [
        {
          name: "SUMMARY",
          allow_null: false,
          content: {
            mode: "freeform",
            blocks: {
              paragraph: {},
            },
          },
        },
      ],
    },
  };
}

async function configureFactoryGroupedMarkdownFixture(root: string): Promise<void> {
  await updateShapeYaml(root, "factory", 1, (shape) => {
    delete shape.delamains;
    shape.entities = {
      "video-analysis": groupedFactoryEntity("{id}/video-analysis.md"),
      "launch-session": groupedFactoryEntity("{id}/launch-session.md"),
      "thumbnail-design": groupedFactoryEntity("{id}/thumbnail-design.md"),
    };
  });

  await removePath(root, "workspace/factory/items");

  await writePath(
    root,
    "workspace/factory/b71-bmad-poem/video-analysis.md",
    [
      "---",
      "id: b71-bmad-poem",
      "title: BMAD poem video analysis",
      "---",
      "",
      "# BMAD poem video analysis",
      "",
      "## SUMMARY",
      "",
      "Grouped markdown validation fixture.",
      "",
    ].join("\n"),
  );
  await writePath(
    root,
    "workspace/factory/b71-bmad-poem/launch-session.md",
    [
      "---",
      "id: b71-bmad-poem",
      "title: BMAD poem launch session",
      "---",
      "",
      "# BMAD poem launch session",
      "",
      "## SUMMARY",
      "",
      "Grouped markdown validation fixture.",
      "",
    ].join("\n"),
  );
  await writePath(
    root,
    "workspace/factory/b71-bmad-poem/thumbnail-design.md",
    [
      "---",
      "id: b71-bmad-poem",
      "title: BMAD poem thumbnail design",
      "---",
      "",
      "# BMAD poem thumbnail design",
      "",
      "## SUMMARY",
      "",
      "Grouped markdown validation fixture.",
      "",
    ].join("\n"),
  );
}

test.concurrent("invalid frontmatter syntax fails parsing", async () => {
  await withFixtureSandbox("discovery-parse-frontmatter", async ({ root }) => {
    await updateTextFile(root, "workspace/backlog/items/ITEM-0001.md", (current) =>
      current.replace("title: Introduce Variant-Aware Backlog Items", "title: [broken"),
    );

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnostic(result, "backlog", codes.PARSE_FRONTMATTER, "ITEM-0001.md");
  });
});

test.concurrent("reserved agent markdown files are ignored anywhere in module trees", async () => {
  await withFixtureSandbox("discovery-agent-files", async ({ root }) => {
    const baseline = validateFixture(root);
    const backlogDelta = reservedPathDelta(root, "workspace/backlog/AGENTS.md");
    const experimentsDelta = reservedPathDelta(
      root,
      "workspace/experiments/programs/PRG-0001/experiments/EXP-0001/CLAUDE.MD",
    );

    await writePath(root, "workspace/backlog/AGENTS.md", "# Backlog Agent\n");
    await writePath(
      root,
      "workspace/experiments/programs/PRG-0001/experiments/EXP-0001/CLAUDE.MD",
      "# Experiment Memory\n",
    );

    const result = validateFixture(root);
    expect(result.status).toBe("pass");
    expect(result.summary.files_checked).toBe(baseline.summary.files_checked);
    expect(result.summary.files_ignored).toBe(baseline.summary.files_ignored + backlogDelta + experimentsDelta);
    expect(moduleIgnoredCount(result, "backlog")).toBe(moduleIgnoredCount(baseline, "backlog") + backlogDelta);
    expect(moduleIgnoredCount(result, "experiments")).toBe(moduleIgnoredCount(baseline, "experiments") + experimentsDelta);
    expectNoModuleDiagnostic(result, "backlog", codes.PARSE_ENTITY_INFER, "AGENTS.md");
    expectNoModuleDiagnostic(result, "experiments", codes.PARSE_ENTITY_INFER, "CLAUDE.MD");
    expectNoModuleDiagnostic(result, "experiments", codes.PARSE_MARKDOWN_EXTENSION_CASE, "CLAUDE.MD");
  });
});

test.concurrent("reserved agent markdown files win over record path matching", async () => {
  await withFixtureSandbox("discovery-agent-precedence", async ({ root }) => {
    const baseline = validateFixture(root);
    const backlogDelta = reservedPathDelta(root, "workspace/backlog/items/Agents.md");

    await writePath(
      root,
      "workspace/backlog/items/Agents.md",
      "---\nid: [broken\n---\n",
    );

    const result = validateFixture(root);
    expect(result.status).toBe("pass");
    expect(result.summary.files_checked).toBe(baseline.summary.files_checked);
    expect(result.summary.files_ignored).toBe(baseline.summary.files_ignored + backlogDelta);
    expect(moduleIgnoredCount(result, "backlog")).toBe(moduleIgnoredCount(baseline, "backlog") + backlogDelta);
    expectNoModuleDiagnostic(result, "backlog", codes.PARSE_FRONTMATTER, "Agents.md");
    expectNoModuleDiagnostic(result, "backlog", codes.PARSE_ENTITY_INFER, "Agents.md");
  });
});

test.concurrent("module-declared ignored directories skip subtree validation and count record-like files as ignored", async () => {
  await withFixtureSandbox("discovery-ignored-directories", async ({ root }) => {
    const baseline = validateFixture(root);

    await updateShapeYaml(root, "backlog", 1, (shape) => {
      shape.ignored_directories = ["doctrine", "meta/drafts"];
    });
    await writePath(root, "workspace/backlog/doctrine/BRAND.md", "# Brand\n");
    await writePath(root, "workspace/backlog/doctrine/CURRENT.MD", "# Current\n");
    await writePath(root, "workspace/backlog/doctrine/archive.jsonl", "{broken\n");
    await writePath(root, "workspace/backlog/meta/drafts/launch-outline.md", "# Draft\n");

    const result = validateFixture(root);
    expect(result.status).toBe("pass");
    expect(result.summary.files_checked).toBe(baseline.summary.files_checked);
    expect(result.summary.files_ignored).toBe(baseline.summary.files_ignored + 4);
    expect(moduleIgnoredCount(result, "backlog")).toBe(moduleIgnoredCount(baseline, "backlog") + 4);
    expectNoModuleDiagnostic(result, "backlog", codes.PARSE_ENTITY_INFER, "BRAND.md");
    expectNoModuleDiagnostic(result, "backlog", codes.PARSE_MARKDOWN_EXTENSION_CASE, "CURRENT.MD");
    expectNoModuleDiagnostic(result, "backlog", codes.PARSE_JSONL, "archive.jsonl");
    expectNoModuleDiagnostic(result, "backlog", codes.PARSE_ENTITY_INFER, "launch-outline.md");
  });
});

test.concurrent("ignored directories do not weaken stray markdown rejection outside ignored subtrees", async () => {
  await withFixtureSandbox("discovery-ignored-directories-strict-outside", async ({ root }) => {
    await updateShapeYaml(root, "backlog", 1, (shape) => {
      shape.ignored_directories = ["doctrine"];
    });
    await writePath(root, "workspace/backlog/doctrine/ignored.md", "# Ignored\n");
    await writePath(root, "workspace/backlog/README.md", "# Stray\n");

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnostic(result, "backlog", codes.PARSE_ENTITY_INFER, "workspace/backlog/README.md");
    expectNoModuleDiagnostic(result, "backlog", codes.PARSE_ENTITY_INFER, "ignored.md");
  });
});

test.concurrent("missing ignored directories surface warnings without failing validation", async () => {
  await withFixtureSandbox("discovery-ignored-directories-missing", async ({ root }) => {
    await updateShapeYaml(root, "backlog", 1, (shape) => {
      shape.ignored_directories = ["doctrine", "meta/drafts", "incubator/sketches"];
    });
    await writePath(root, "workspace/backlog/doctrine/BRAND.md", "# Brand\n");
    await writePath(root, "workspace/backlog/meta/drafts/launch-outline.md", "# Draft\n");

    const result = validateFixture(root);
    expect(result.status).toBe("warn");
    expect(result.summary.error_count).toBe(0);
    expect(result.summary.warning_count).toBe(1);

    const backlogReport = result.modules.find((report) => report.module_id === "backlog");
    expect(backlogReport).toBeDefined();
    expect(backlogReport?.status).toBe("warn");
    expect(backlogReport?.summary.warning_count).toBe(1);

    const diagnostic = expectModuleDiagnosticContaining(
      result,
      "backlog",
      codes.SHAPE_CONTRACT_INVALID,
      "incubator/sketches",
      ".als/modules/backlog/v1/module.ts",
    );
    expect(diagnostic.severity).toBe("warning");
    expect(diagnostic.reason).toBe(reasons.MODULE_IGNORED_DIRECTORY_MISSING);
  });
});

test.concurrent("non-reserved stray markdown files that match no entity are rejected", async () => {
  await withFixtureSandbox("discovery-stray-markdown", async ({ root }) => {
    await writePath(
      root,
      "workspace/backlog/README.md",
      "---\nid: STRAY-0001\ntitle: Stray\nstatus: draft\n---\n\n# Stray\n",
    );

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnostic(result, "backlog", codes.PARSE_ENTITY_INFER, "workspace/backlog/README.md");
  });
});

test.concurrent("non-reserved markdown files with uppercase extension fail cleanly", async () => {
  await withFixtureSandbox("discovery-uppercase-markdown", async ({ root }) => {
    const baseline = validateFixture(root);

    await writePath(
      root,
      "workspace/backlog/README.MD",
      "---\nid: STRAY-0002\ntitle: Uppercase\nstatus: draft\n---\n\n# Uppercase\n",
    );

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expect(result.summary.files_checked).toBe(baseline.summary.files_checked + 1);
    expect(result.summary.files_failed).toBe(baseline.summary.files_failed + 1);
    expectModuleDiagnostic(result, "backlog", codes.PARSE_MARKDOWN_EXTENSION_CASE, "workspace/backlog/README.MD");
    expectNoModuleDiagnostic(result, "backlog", codes.PARSE_ENTITY_INFER, "README.MD");
  });
});

test.concurrent("record-like markdown files with uppercase extension fail before entity inference", async () => {
  await withFixtureSandbox("discovery-uppercase-record", async ({ root }) => {
    const baseline = validateFixture(root);

    await writePath(
      root,
      "workspace/backlog/items/ITEM-UPPER.MD",
      "---\nid: ITEM-UPPER\ntitle: Uppercase\nstatus: draft\ntype: app\nowner_ref: null\npriority: 1\n---\n\n## DESCRIPTION\n\nValid body.\n\n## ACTIVITY_LOG\n\n- 2026-03-20: Created.\n",
    );

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expect(result.summary.files_checked).toBe(baseline.summary.files_checked + 1);
    expect(result.summary.files_failed).toBe(baseline.summary.files_failed + 1);
    expectModuleDiagnostic(result, "backlog", codes.PARSE_MARKDOWN_EXTENSION_CASE, "ITEM-UPPER.MD");
    expectNoModuleDiagnostic(result, "backlog", codes.PARSE_ENTITY_INFER, "ITEM-UPPER.MD");
    expectNoModuleDiagnostic(result, "backlog", codes.PARSE_FRONTMATTER, "ITEM-UPPER.MD");
  });
});

test.concurrent("non-reserved jsonl files with uppercase extension fail cleanly", async () => {
  await withFixtureSandbox("discovery-uppercase-jsonl", async ({ root }) => {
    const baseline = validateFixture(root);

    await writePath(
      root,
      "workspace/backlog/README.JSONL",
      "{\"id\":\"STRAY-0001\"}\n",
    );

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expect(result.summary.files_checked).toBe(baseline.summary.files_checked + 1);
    expect(result.summary.files_failed).toBe(baseline.summary.files_failed + 1);
    expectModuleDiagnostic(result, "backlog", codes.PARSE_JSONL_EXTENSION_CASE, "workspace/backlog/README.JSONL");
    expectNoModuleDiagnostic(result, "backlog", codes.PARSE_ENTITY_INFER, "README.JSONL");
  });
});

test.concurrent("stray jsonl files that match no entity are rejected", async () => {
  await withFixtureSandbox("discovery-stray-jsonl", async ({ root }) => {
    await writePath(
      root,
      "workspace/backlog/README.jsonl",
      "{\"id\":\"STRAY-0001\"}\n",
    );

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnostic(result, "backlog", codes.PARSE_ENTITY_INFER, "workspace/backlog/README.jsonl");
  });
});

test.concurrent("unreadable directories fail cleanly and discovery continues", async () => {
  await withFixtureSandbox("discovery-unreadable-dir", async ({ root }) => {
    if (isRootUser()) return;

    const lockedDir = join(root, "workspace/backlog/locked");
    await writePath(root, "workspace/backlog/locked/README.md", "# Hidden\n");
    await writePath(root, "workspace/backlog/README.md", "# Visible\n");
    await chmod(lockedDir, 0o000);

    try {
      const result = validateFixture(root);
      expect(result.status).toBe("fail");
      expectModuleDiagnostic(result, "backlog", codes.PARSE_DISCOVERY_UNREADABLE_DIR, "workspace/backlog/locked");
      expectModuleDiagnostic(result, "backlog", codes.PARSE_ENTITY_INFER, "workspace/backlog/README.md");
    } finally {
      await chmod(lockedDir, 0o700);
    }
  });
});

test.concurrent("unreadable record files fail cleanly and validation continues", async () => {
  await withFixtureSandbox("discovery-unreadable-record", async ({ root }) => {
    if (isRootUser()) return;

    const lockedFile = join(root, "workspace/backlog/items/ITEM-0001.md");
    await chmod(lockedFile, 0o000);

    try {
      const result = validateFixture(root);
      expect(result.status).toBe("fail");
      const diagnostic = expectModuleDiagnostic(result, "backlog", codes.PARSE_FRONTMATTER, "ITEM-0001.md");
      expect(diagnostic.message).toContain("Could not read record file");
      expect(diagnostic.hint).toContain("Check file permissions");
    } finally {
      await chmod(lockedFile, 0o600);
    }
  });
});

test.concurrent("record ids must match current entity path bindings", async () => {
  await withFixtureSandbox("discovery-filename-id", async ({ root }) => {
    await renamePath(
      root,
      "workspace/backlog/items/ITEM-0001.md",
      "workspace/backlog/items/ITEM-9999.md",
    );

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    const diagnostic = expectModuleDiagnostic(result, "backlog", codes.ID_PATH_BINDING_MISMATCH, "ITEM-9999.md");
    expect(diagnostic.reason).toBe(reasons.ID_PATH_BINDING_MISMATCH);
    expect(diagnostic.message).toContain("path-bound id");
  });
});

test.concurrent("records moved outside their declared path templates fail entity inference", async () => {
  await withFixtureSandbox("discovery-path-template", async ({ root }) => {
    await renamePath(
      root,
      "workspace/experiments/programs/PRG-0001/experiments/EXP-0001/runs/RUN-0001.md",
      "workspace/experiments/programs/PRG-0001/experiments/EXP-0001/RUN-0001.md",
    );

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnostic(result, "experiments", codes.PARSE_ENTITY_INFER, "EXP-0001/RUN-0001.md");
  });
});

test.concurrent("grouped markdown sibling records can bind ids from directory segments", async () => {
  await withFixtureSandbox("discovery-grouped-markdown-pass", async ({ root }) => {
    await configureFactoryGroupedMarkdownFixture(root);

    const result = validateFixture(root, "factory");
    expect(result.status).toBe("pass");
    expectNoModuleDiagnostic(result, "factory", codes.PARSE_ENTITY_INFER, "video-analysis.md");
    expectNoModuleDiagnostic(result, "factory", codes.PARSE_ENTITY_INFER, "launch-session.md");
    expectNoModuleDiagnostic(result, "factory", codes.PARSE_ENTITY_INFER, "thumbnail-design.md");
  });
});

test.concurrent("grouped markdown frontmatter ids must match the directory-bound {id}", async () => {
  await withFixtureSandbox("discovery-grouped-markdown-id-mismatch", async ({ root }) => {
    await configureFactoryGroupedMarkdownFixture(root);
    await updateRecord(root, "workspace/factory/b71-bmad-poem/video-analysis.md", (record) => {
      record.data.id = "b65-guy-monroe-marketing-plan";
    });

    const result = validateFixture(root, "factory");
    expect(result.status).toBe("fail");
    const diagnostic = expectModuleDiagnostic(result, "factory", codes.ID_PATH_BINDING_MISMATCH, "video-analysis.md");
    expect(diagnostic.reason).toBe(reasons.ID_PATH_BINDING_MISMATCH);
    expect(diagnostic.hint).toContain("Update the markdown frontmatter id");
  });
});

test.concurrent("undeclared grouped literal leaf variants fail entity inference", async () => {
  await withFixtureSandbox("discovery-grouped-markdown-literal-leaf-variant", async ({ root }) => {
    await configureFactoryGroupedMarkdownFixture(root);
    await renamePath(
      root,
      "workspace/factory/b71-bmad-poem/video-analysis.md",
      "workspace/factory/b71-bmad-poem/video-analysis-draft.md",
    );

    const result = validateFixture(root, "factory");
    expect(result.status).toBe("fail");
    expectModuleDiagnostic(result, "factory", codes.PARSE_ENTITY_INFER, "video-analysis-draft.md");
  });
});

test.concurrent("repeated current-entity {id} bindings must agree across directory and leaf segments", async () => {
  await withFixtureSandbox("discovery-repeated-id-disagreement", async ({ root }) => {
    await renamePath(
      root,
      "workspace/experiments/programs/PRG-0001/PRG-0001.md",
      "workspace/experiments/programs/PRG-0001/PRG-9999.md",
    );

    const result = validateFixture(root, "experiments");
    expect(result.status).toBe("fail");
    expectModuleDiagnostic(result, "experiments", codes.PARSE_ENTITY_INFER, "PRG-9999.md");
  });
});

test.concurrent("frontmatter-only id collisions do not override path-bound canonical identity", async () => {
  await withFixtureSandbox("discovery-duplicate-id", async ({ root }) => {
    await updateRecord(root, "workspace/backlog/items/ITEM-0002.md", (record) => {
      record.data.id = "ITEM-0001";
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectNoModuleDiagnostic(result, "backlog", codes.ID_DUPLICATE, "ITEM-0002.md");
    expectModuleDiagnostic(result, "backlog", codes.ID_PATH_BINDING_MISMATCH, "ITEM-0002.md");
  });
});
