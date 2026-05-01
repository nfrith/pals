import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  inspectConstructActionManifest,
  inspectConstructManifest,
} from "../src/construct-upgrade.ts";

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
    await mkdir(join(root, "migrations"), { recursive: true });
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "VERSION"), "12\n", "utf-8");
    await writeFile(join(root, "src", "index.ts"), "export const marker = 12;\n", "utf-8");
    await writeFile(join(root, "construct.json"), JSON.stringify({
      schema: "als-construct-manifest@1",
      name: "dispatcher",
      version: 12,
      migration_strategy: "sequential",
      lifecycle_strategy: "dispatcher-lifecycle",
      migrations_dir: "migrations",
      source_paths: [
        { path: "src", owner: "vendor" },
        { path: "package.json", owner: "vendor" },
      ],
    }, null, 2) + "\n", "utf-8");

    const inspection = inspectConstructManifest(root);
    expect(inspection.status).toBe("pass");
    expect(inspection.errors).toEqual([]);
    expect(inspection.manifest?.schema).toBe("als-construct-manifest@1");
    expect(inspection.manifest?.migration_strategy).toBe("sequential");
    expect(inspection.manifest?.lifecycle_strategy).toBe("dispatcher-lifecycle");
  });
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
