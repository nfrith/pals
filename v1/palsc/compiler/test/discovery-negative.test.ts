import { expect, test } from "bun:test";
import { codes } from "../src/diagnostics.ts";
import {
  expectModuleDiagnostic,
  renamePath,
  updateRecord,
  updateTextFile,
  validateFixture,
  withFixtureSandbox,
  writePath,
} from "./helpers/fixture.ts";

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

test.concurrent("stray markdown files that match no entity are rejected", async () => {
  await withFixtureSandbox("discovery-stray-markdown", async ({ root }) => {
    await writePath(
      root,
      "workspace/backlog/stray.md",
      "---\nid: STRAY-0001\ntitle: Stray\nstatus: draft\n---\n\n# Stray\n",
    );

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnostic(result, "backlog", codes.PARSE_ENTITY_INFER, "workspace/backlog/stray.md");
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
