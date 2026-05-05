import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import {
  inspectConstructActionManifest,
  inspectConstructManifest,
} from "../src/construct-upgrade.ts";

const alsRepoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

async function withTempDir(
  label: string,
  run: (root: string) => Promise<void> | void,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), `als-construct-upgrade-${label}-`));
  let runError: unknown = null;
  try {
    await run(root);
  } catch (error) {
    runError = error;
  }

  try {
    await rm(root, { recursive: true, force: true });
  } catch (cleanupError) {
    if (!runError) {
      throw cleanupError;
    }
  }

  if (runError) {
    throw runError;
  }
}

test("construct manifest inspection accepts the canonical authored surface", async () => {
  await withTempDir("manifest-pass", async (root) => {
    await writeConstructFixture(root, {
      version: 12,
      migrations: {
        "v11-to-v12.ts": "export async function migrate() {}\n",
      },
      source_paths: [
        { path: "src", owner: "vendor" },
        { path: "package.json", owner: "vendor" },
      ],
    });

    const inspection = inspectConstructManifest(root);
    expect(inspection.status).toBe("pass");
    expect(inspection.errors).toEqual([]);
    expect(inspection.manifest?.schema).toBe("als-construct-manifest@1");
    expect(inspection.manifest?.migration_strategy).toBe("sequential");
    expect(inspection.manifest?.lifecycle_strategy).toBe("dispatcher-lifecycle");
  });
});

test("construct manifest inspection accepts shipped construct bundles", () => {
  for (const constructRoot of [
    resolve(alsRepoRoot, "delamain-dispatcher"),
    resolve(alsRepoRoot, "statusline"),
    resolve(alsRepoRoot, "delamain-dashboard"),
  ]) {
    const inspection = inspectConstructManifest(constructRoot);
    expect(inspection.status).toBe("pass");
    expect(inspection.errors).toEqual([]);
  }
});

test("construct manifest inspection rejects version mismatches and bundle-escape paths", async () => {
  await withTempDir("manifest-fail", async (root) => {
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "VERSION"), "11\n", "utf-8");
    await writeFile(join(root, "construct.json"), JSON.stringify({
      schema: "als-construct-manifest@1",
      name: "dispatcher",
      version: 12,
      migration_strategy: "sequential",
      lifecycle_strategy: "dispatcher-lifecycle",
      migrations_dir: "../migrations",
      source_paths: [
        { path: "../src", owner: "vendor" },
      ],
    }, null, 2) + "\n", "utf-8");

    const inspection = inspectConstructManifest(root);
    expect(inspection.status).toBe("fail");
    expect(inspection.errors.some((entry) => entry.code === "construct_manifest.version.mismatch")).toBe(true);
    expect(inspection.errors.some((entry) => entry.code === "construct_manifest.path.escapes_bundle")).toBe(true);
  });
});

test("construct manifest inspection rejects malformed migration directory entries", async () => {
  await withTempDir("manifest-malformed-migration", async (root) => {
    await writeConstructFixture(root, {
      version: 2,
      migrations: {
        "_helpers.ts": "export const helper = true;\n",
        "v1-to-v2.ts": "export async function migrate() {}\n",
      },
    });

    const inspection = inspectConstructManifest(root);
    expect(inspection.status).toBe("fail");
    expect(inspection.errors.some((entry) => entry.code === "construct_manifest.migrations.malformed_name")).toBe(true);
  });
});

test("construct manifest inspection rejects multi-hop migrations", async () => {
  await withTempDir("manifest-multi-hop", async (root) => {
    await writeConstructFixture(root, {
      version: 3,
      migrations: {
        "v1-to-v3.ts": "export async function migrate() {}\n",
      },
    });

    const inspection = inspectConstructManifest(root);
    expect(inspection.status).toBe("fail");
    expect(inspection.errors.some((entry) => entry.code === "construct_manifest.migrations.multi_hop_forbidden")).toBe(true);
  });
});

test("construct manifest inspection rejects duplicate migration hops", async () => {
  await withTempDir("manifest-duplicate-hop", async (root) => {
    await writeConstructFixture(root, {
      version: 2,
      migrations: {
        "v1-to-v2.js": "export async function migrate() {}\n",
        "v1-to-v2.ts": "export async function migrate() {}\n",
      },
    });

    const inspection = inspectConstructManifest(root);
    expect(inspection.status).toBe("fail");
    expect(inspection.errors.some((entry) => entry.code === "construct_manifest.migrations.duplicate")).toBe(true);
  });
});

test("construct manifest inspection rejects migration gaps", async () => {
  await withTempDir("manifest-gap", async (root) => {
    await writeConstructFixture(root, {
      version: 4,
      migrations: {
        "v1-to-v2.ts": "export async function migrate() {}\n",
        "v3-to-v4.ts": "export async function migrate() {}\n",
      },
    });

    const inspection = inspectConstructManifest(root);
    expect(inspection.status).toBe("fail");
    expect(inspection.errors.some((entry) => entry.code === "construct_manifest.migrations.gap")).toBe(true);
  });
});

test("construct manifest inspection rejects chains that do not end at VERSION", async () => {
  await withTempDir("manifest-chain-end", async (root) => {
    await writeConstructFixture(root, {
      version: 5,
      migrations: {
        "v3-to-v4.ts": "export async function migrate() {}\n",
      },
    });

    const inspection = inspectConstructManifest(root);
    expect(inspection.status).toBe("fail");
    expect(inspection.errors.some((entry) => entry.code === "construct_manifest.migrations.chain_end_mismatch")).toBe(true);
  });
});

test("construct manifest inspection rejects empty migrations when version is greater than one", async () => {
  await withTempDir("manifest-empty", async (root) => {
    await writeConstructFixture(root, {
      version: 2,
      migrations: {
        ".gitkeep": "",
      },
    });

    const inspection = inspectConstructManifest(root);
    expect(inspection.status).toBe("fail");
    expect(inspection.errors.some((entry) => entry.code === "construct_manifest.migrations.empty_with_nontrivial_version")).toBe(true);
  });
});

test("construct action manifest inspection accepts the approved action kinds and placeholder contract", async () => {
  await withTempDir("action-pass", async (root) => {
    await writeFile(join(root, "action-manifest.json"), JSON.stringify({
      schema: "als-construct-action-manifest@1",
      actions: [
        {
          kind: "drain-then-restart",
          construct: "dispatcher",
          instance_id: "factory-jobs",
          display_name: "Factory Jobs",
          start: {
            command: ["bun", "run", "$ALS_SYSTEM_ROOT/.claude/delamains/factory-jobs/dispatcher/src/index.ts"],
            cwd: "$ALS_SYSTEM_ROOT",
          },
          process_locator: {
            kind: "json-file-pid",
            path: "$ALS_SYSTEM_ROOT/.claude/delamains/factory-jobs/status.json",
            pid_field: "pid",
          },
          drain_signal: {
            kind: "json-file-write",
            path: "$ALS_SYSTEM_ROOT/.claude/delamains/factory-jobs/dispatcher/control/drain-request.json",
            payload: {
              requested_at: "2026-05-01T10:00:00.000Z",
            },
          },
        },
        {
          kind: "start-only",
          construct: "statusline",
          instance_id: "pulse",
          display_name: "Statusline Pulse",
          start: {
            command: ["bun", "run", "$CLAUDE_PLUGIN_ROOT/statusline/pulse.ts", "$ALS_SYSTEM_ROOT"],
            cwd: "$ALS_SYSTEM_ROOT",
          },
        },
      ],
    }, null, 2) + "\n", "utf-8");

    const inspection = inspectConstructActionManifest(root);
    expect(inspection.status).toBe("pass");
    expect(inspection.errors).toEqual([]);
    expect(inspection.manifest?.schema).toBe("als-construct-action-manifest@1");
    expect(inspection.action_count).toBe(2);
  });
});

test("construct action manifest inspection rejects absolute paths and invalid per-kind fields", async () => {
  await withTempDir("action-fail", async (root) => {
    await writeFile(join(root, "action-manifest.json"), JSON.stringify({
      schema: "als-construct-action-manifest@1",
      actions: [
        {
          kind: "kill-then-restart",
          construct: "dashboard",
          instance_id: "dashboard",
          display_name: "Dashboard",
          start: {
            command: ["bun", "run", "/tmp/dashboard.ts"],
            cwd: "/tmp",
          },
          drain_signal: {
            kind: "json-file-write",
            path: "$ALS_SYSTEM_ROOT/.claude/delamains/factory-jobs/dispatcher/control/drain-request.json",
            payload: {},
          },
        },
      ],
    }, null, 2) + "\n", "utf-8");

    const inspection = inspectConstructActionManifest(root);
    expect(inspection.status).toBe("fail");
    expect(inspection.errors.some((entry) => entry.code === "construct_action.path.absolute_forbidden")).toBe(true);
    expect(inspection.errors.some((entry) => entry.code === "construct_action.process_locator.required")).toBe(true);
    expect(inspection.errors.some((entry) => entry.code === "construct_action.drain_signal.forbidden")).toBe(true);
  });
});

async function writeConstructFixture(
  root: string,
  input: {
    version: number;
    migrations: Record<string, string>;
    source_paths?: Array<{ path: string; owner: "vendor" | "operator" }>;
  },
): Promise<void> {
  await mkdir(join(root, "migrations"), { recursive: true });
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "VERSION"), `${input.version}\n`, "utf-8");
  await writeFile(join(root, "src", "index.ts"), `export const marker = ${input.version};\n`, "utf-8");

  for (const [name, contents] of Object.entries(input.migrations)) {
    await writeFile(join(root, "migrations", name), contents, "utf-8");
  }

  await writeFile(join(root, "construct.json"), JSON.stringify({
    schema: "als-construct-manifest@1",
    name: "dispatcher",
    version: input.version,
    migration_strategy: "sequential",
    lifecycle_strategy: "dispatcher-lifecycle",
    migrations_dir: "migrations",
    source_paths: input.source_paths ?? [
      { path: "src", owner: "vendor" },
    ],
  }, null, 2) + "\n", "utf-8");
}
