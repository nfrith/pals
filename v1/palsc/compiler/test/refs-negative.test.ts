import { expect, test } from "bun:test";
import { codes } from "../src/diagnostics.ts";
import { expectModuleDiagnostic, updateRecord, validateFixture, withFixtureSandbox } from "./helpers/fixture.ts";

test.concurrent("ref fields must be markdown links", async () => {
  await withFixtureSandbox("refs-markdown-link", async ({ root }) => {
    await updateRecord(root, "workspace/backlog/items/ITEM-0001.md", (record) => {
      record.data.owner_ref = "pals://centralized-happy-path/people/person/PPL-000101";
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnostic(result, "backlog", codes.FM_REF_FORMAT, "ITEM-0001.md");
  });
});

test.concurrent("ref fields must use valid pals uris", async () => {
  await withFixtureSandbox("refs-pals-uri", async ({ root }) => {
    await updateRecord(root, "workspace/backlog/items/ITEM-0001.md", (record) => {
      record.data.owner_ref = "[owner](https://example.test/PPL-000101)";
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnostic(result, "backlog", codes.FM_REF_FORMAT, "ITEM-0001.md");
  });
});

test.concurrent("ref fields must target the declared system and module", async () => {
  await withFixtureSandbox("refs-system-module", async ({ root }) => {
    await updateRecord(root, "workspace/backlog/items/ITEM-0001.md", (record) => {
      record.data.owner_ref = "[owner](pals://other-system/people/person/PPL-000101)";
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnostic(result, "backlog", codes.REF_CONTRACT_MISMATCH, "ITEM-0001.md");
  });
});

test.concurrent("ref fields must target the declared entity", async () => {
  await withFixtureSandbox("refs-entity", async ({ root }) => {
    await updateRecord(root, "workspace/backlog/items/ITEM-0001.md", (record) => {
      record.data.owner_ref = "[item](pals://centralized-happy-path/backlog/item/ITEM-0001)";
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnostic(result, "backlog", codes.REF_ENTITY_MISMATCH, "ITEM-0001.md");
  });
});

test.concurrent("ref targets must resolve to existing records", async () => {
  await withFixtureSandbox("refs-unresolved", async ({ root }) => {
    await updateRecord(root, "workspace/backlog/items/ITEM-0001.md", (record) => {
      record.data.owner_ref = "[ghost](pals://centralized-happy-path/people/person/PPL-9999)";
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnostic(result, "backlog", codes.REF_UNRESOLVED, "ITEM-0001.md");
  });
});

test.concurrent("ref list items must resolve individually", async () => {
  await withFixtureSandbox("refs-list-item", async ({ root }) => {
    await updateRecord(root, "workspace/backlog/items/ITEM-0002.md", (record) => {
      record.data.collaborator_refs = [
        "[alex-rivera](pals://centralized-happy-path/people/person/PPL-000101)",
        "[ghost](pals://centralized-happy-path/people/person/PPL-9999)",
      ];
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnostic(result, "backlog", codes.REF_UNRESOLVED, "ITEM-0002.md");
  });
});

test.concurrent("child records must stay under the parent ref prefix", async () => {
  await withFixtureSandbox("refs-parent-prefix", async ({ root }) => {
    await updateRecord(
      root,
      "workspace/experiments/programs/PRG-0001/experiments/EXP-0001/runs/RUN-0001.md",
      (record) => {
        record.data.experiment_ref =
          "[experiment-0002](pals://centralized-happy-path/experiments/program/PRG-0002/experiment/EXP-0002)";
      },
    );

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectModuleDiagnostic(result, "experiments", codes.REF_PARENT_PREFIX, "RUN-0001.md");
  });
});
