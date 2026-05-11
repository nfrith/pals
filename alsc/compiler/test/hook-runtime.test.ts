import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  buildOperatorConfigSessionStart,
  evaluatePostEditValidation,
  evaluateStopGateValidation,
  recordTouchedPathBreadcrumb,
  resolveTouchedPathTarget,
  SYSTEM_BREADCRUMB_ID,
} from "../src/hook-runtime.ts";
import {
  serializeActiveOperatorSelection,
  serializeOperatorConfigSource,
  serializeOperatorRosterSource,
  type OperatorConfig,
} from "../src/operator-config.ts";
import {
  removePath,
  updateRecord,
  updateShapeYaml,
  withFixtureSandbox,
} from "./helpers/fixture.ts";
import {
  acquireSyntheticDeprecationFixture,
  releaseSyntheticDeprecationFixture,
  SYNTHETIC_DEPRECATION_VALUES,
} from "./helpers/deprecation-fixture.ts";

const VALID_OPERATOR_CONFIG: OperatorConfig = {
  id: "nick-frith",
  first_name: "Nick",
  last_name: "Frith",
  display_name: "0xnfrith",
  primary_email: "nick@example.com",
  role: "Founder",
  profiles: ["edgerunner"],
  owns_company: true,
  company_name: "Example Co",
  company_type: "llc",
  company_type_other: null,
  revenue_band: "100k-1M",
};

const backlogRecordIds = ["ITEM-0001", "ITEM-0002", "ITEM-0003"] as const;

beforeAll(() => {
  acquireSyntheticDeprecationFixture();
});

afterAll(() => {
  releaseSyntheticDeprecationFixture();
});

async function configureSyntheticDeprecationFixture(root: string): Promise<void> {
  await updateShapeYaml(root, "backlog", 1, (shape) => {
    const entities = shape.entities as Record<string, Record<string, unknown>>;
    const itemFields = entities.item.fields as Record<string, Record<string, unknown>>;
    itemFields.warning_status = {
      type: "enum",
      allow_null: true,
      allowed_values: [...SYNTHETIC_DEPRECATION_VALUES],
    };
  });

  for (const recordId of backlogRecordIds) {
    await updateRecord(root, `workspace/backlog/items/${recordId}.md`, (record) => {
      record.data.warning_status = recordId === "ITEM-0001" ? "synthetic-deprecated" : null;
    });
  }
}

test("buildOperatorConfigSessionStart reuses the compiler-owned session-start semantics", async () => {
  await withFixtureSandbox("hook-runtime-session-start", async ({ root }) => {
    await removePath(root, ".als/skip-operator-config");
    await mkdir(join(root, ".als", "operators"), { recursive: true });
    await writeFile(
      join(root, ".als", "operator-roster.ts"),
      serializeOperatorRosterSource({
        operator_paths: ["./operators/nick-frith.ts"],
      }),
      "utf-8",
    );
    await writeFile(
      join(root, ".als", "operators", "nick-frith.ts"),
      serializeOperatorConfigSource(VALID_OPERATOR_CONFIG),
      "utf-8",
    );
    await mkdir(join(root, ".als", "local"), { recursive: true });
    await writeFile(
      join(root, ".als", "local", "active-operator.json"),
      serializeActiveOperatorSelection({
        schema: "als-active-operator-selection@1",
        operator_id: "nick-frith",
      }),
      "utf-8",
    );

    const output = buildOperatorConfigSessionStart({
      context: {
        plugin_root: "/tmp/plugin-root",
      },
      cwd: join(root, "workspace"),
    });

    expect(output).toContain("<system-reminder>");
    expect(output).toContain("Example Co");
  });
});

test("resolveTouchedPathTarget can widen .als paths to a system target for breadcrumb use", async () => {
  await withFixtureSandbox("hook-runtime-system-target", async ({ root }) => {
    const resolution = resolveTouchedPathTarget(
      `${root}/.als/system.ts`,
      { include_system_files: true },
    );

    expect(resolution).toEqual({
      status: "system",
      diagnostic: null,
      relative_path: ".als/system.ts",
      target: {
        kind: "system",
        system_root: root,
        module_id: null,
      },
    });
  });
});

test("recordTouchedPathBreadcrumb deduplicates module entries and records system entries", async () => {
  await withFixtureSandbox("hook-runtime-breadcrumb", async ({ root }) => {
    const breadcrumbDirectory = await mkdtemp(join(tmpdir(), "als-hook-runtime-"));

    const first = recordTouchedPathBreadcrumb({
      context: {
        plugin_root: "/tmp/plugin-root",
        breadcrumb_directory: breadcrumbDirectory,
      },
      file_path: `${root}/workspace/backlog/items/ITEM-0001.md`,
      session_id: "session-1",
    });
    const duplicate = recordTouchedPathBreadcrumb({
      context: {
        plugin_root: "/tmp/plugin-root",
        breadcrumb_directory: breadcrumbDirectory,
      },
      file_path: `${root}/workspace/backlog/items/ITEM-0001.md`,
      session_id: "session-1",
    });
    const system = recordTouchedPathBreadcrumb({
      context: {
        plugin_root: "/tmp/plugin-root",
        breadcrumb_directory: breadcrumbDirectory,
      },
      file_path: `${root}/.als/system.ts`,
      session_id: "session-1",
    });

    expect(first.status).toBe("recorded");
    expect(duplicate.status).toBe("duplicate");
    expect(system.status).toBe("recorded");

    const breadcrumbPath = join(breadcrumbDirectory, "als-touched-session-1");
    const contents = await readFile(breadcrumbPath, "utf-8");
    expect(contents.split(/\r?\n/).filter(Boolean)).toEqual([
      `${root}:backlog`,
      `${root}:${SYSTEM_BREADCRUMB_ID}`,
    ]);
  });
});

test("evaluatePostEditValidation returns warn-only context for deprecated values", async () => {
  await withFixtureSandbox("hook-runtime-post-warn", async ({ root }) => {
    await configureSyntheticDeprecationFixture(root);

    const result = evaluatePostEditValidation({
      context: {
        plugin_root: "/tmp/plugin-root",
      },
      demo_mode: false,
      file_path: `${root}/workspace/backlog/items/ITEM-0001.md`,
    });

    expect(result.status).toBe("warn");
    expect(result.decision).toBe("allow");
    expect(result.target?.module_id).toBe("backlog");
    expect(result.additional_context).toContain("synthetic-deprecated");
  });
});

test("evaluateStopGateValidation collapses module entries under a system breadcrumb", async () => {
  await withFixtureSandbox("hook-runtime-stop-system-collapse", async ({ root }) => {
    const breadcrumbDirectory = await mkdtemp(join(tmpdir(), "als-hook-stop-"));
    const breadcrumbPath = join(breadcrumbDirectory, "als-touched-session-2");
    await writeFile(
      breadcrumbPath,
      `${root}:backlog\n${root}:${SYSTEM_BREADCRUMB_ID}\n${root}:general-purpose-factory\n`,
      "utf-8",
    );

    const result = evaluateStopGateValidation({
      context: {
        plugin_root: "/tmp/plugin-root",
        breadcrumb_directory: breadcrumbDirectory,
      },
      session_id: "session-2",
    });

    expect(result.targets).toEqual([
      {
        kind: "system",
        system_root: root,
        module_id: null,
      },
    ]);
  });
});
