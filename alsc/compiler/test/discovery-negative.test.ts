import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { chmod } from "node:fs/promises";
import { join } from "node:path";
import { codes } from "../src/diagnostics.ts";
import {
  expectModuleDiagnostic,
  expectNoModuleDiagnostic,
  renamePath,
  updateRecord,
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

test.concurrent("record ids must match filename stems", async () => {
  await withFixtureSandbox("discovery-filename-id", async ({ root }) => {
    await renamePath(
      root,
      "workspace/backlog/items/ITEM-0001.md",
      "workspace/backlog/items/ITEM-9999.md",
    );

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnostic(result, "backlog", codes.ID_FILENAME_MISMATCH, "ITEM-9999.md");
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

test.concurrent("duplicate canonical identities are rejected", async () => {
  await withFixtureSandbox("discovery-duplicate-id", async ({ root }) => {
    await updateRecord(root, "workspace/backlog/items/ITEM-0002.md", (record) => {
      record.data.id = "ITEM-0001";
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnostic(result, "backlog", codes.ID_DUPLICATE, "ITEM-0002.md");
  });
});
