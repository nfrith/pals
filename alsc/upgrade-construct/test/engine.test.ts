import { expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile, cp } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import {
  createStatuslineProcessDefinition,
  executeDelamainConstructUpgrade,
  executeProcessConstructUpgrade,
  findPidInProcessTable,
  preflightDelamainConstructUpgrade,
  runConstructActionManifest,
} from "../src/index.ts";
import { detectKnownConstructFingerprint } from "../src/customization.ts";
import { DISPATCHER_KNOWN_VENDOR_FINGERPRINTS } from "../src/known-fingerprints.ts";
import {
  discoverSequentialMigrationSteps,
  executeSequentialMigrationChain,
  planSequentialMigrationChain,
} from "../src/migration-strategies/sequential.ts";

const alsRepoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const dispatcherV11FixtureRoot = resolve(alsRepoRoot, "alsc/upgrade-construct/test/fixtures/dispatcher-v11");

async function withTempDir(
  label: string,
  run: (root: string) => Promise<void> | void,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), `als-upgrade-construct-${label}-`));
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

test("sequential migration planning and execution walk each version hop in order", async () => {
  await withTempDir("sequential", async (root) => {
    const migrationsRoot = join(root, "migrations");
    const targetRoot = join(root, "target");
    await mkdir(migrationsRoot, { recursive: true });
    await mkdir(targetRoot, { recursive: true });
    await writeFile(join(migrationsRoot, "v1-to-v2.ts"), [
      "export async function migrate(context) {",
      "  await Bun.write(`${context.target_root}/m1.txt`, `${context.from_version}->${context.to_version}\\n`);",
      "}",
      "",
    ].join("\n"), "utf-8");
    await writeFile(join(migrationsRoot, "v2-to-v3.ts"), [
      "export async function migrate(context) {",
      "  await Bun.write(`${context.target_root}/m2.txt`, `${context.from_version}->${context.to_version}\\n`);",
      "}",
      "",
    ].join("\n"), "utf-8");

    const steps = await discoverSequentialMigrationSteps(migrationsRoot);
    const chain = planSequentialMigrationChain(steps, 1, 3);
    expect(chain.map((step) => `${step.from_version}->${step.to_version}`)).toEqual(["1->2", "2->3"]);

    await executeSequentialMigrationChain(chain, (step) => ({
      system_root: root,
      target_root: targetRoot,
      construct_name: "dispatcher",
      instance_id: "factory-jobs",
      from_version: step.from_version,
      to_version: step.to_version,
    }));

    expect(await readFile(join(targetRoot, "m1.txt"), "utf-8")).toBe("1->2\n");
    expect(await readFile(join(targetRoot, "m2.txt"), "utf-8")).toBe("2->3\n");
  });
});

test("sequential migration discovery rejects malformed directory entries", async () => {
  await withTempDir("sequential-malformed", async (root) => {
    const migrationsRoot = join(root, "migrations");
    await mkdir(migrationsRoot, { recursive: true });
    await writeFile(join(migrationsRoot, "v1-to-v2.ts"), "export async function migrate() {}\n", "utf-8");
    await writeFile(join(migrationsRoot, "_helpers.ts"), "export const helper = true;\n", "utf-8");

    await expect(discoverSequentialMigrationSteps(migrationsRoot)).rejects.toThrow("construct_manifest.migrations.malformed_name");
  });
});

test("canonical dispatcher bundle matches the current known vendor fingerprint", async () => {
  const fingerprint = await detectKnownConstructFingerprint(
    resolve(alsRepoRoot, "skills/new/references/dispatcher"),
    DISPATCHER_KNOWN_VENDOR_FINGERPRINTS,
  );

  expect(fingerprint).toEqual({
    matched_version: 13,
    customized: false,
  });
});

test("delamain construct preflight and execute stage the fleet upgrade without mutating the live system", async () => {
  await withTempDir("dispatcher-stage", async (root) => {
    const liveSystemRoot = join(root, "live");
    const stagingSystemRoot = join(root, "staging");
    const dispatcherA = join(
      liveSystemRoot,
      ".als",
      "modules",
      "backlog",
      "v1",
      "delamains",
      "factory-jobs",
      "dispatcher",
    );
    const dispatcherB = join(
      liveSystemRoot,
      ".als",
      "modules",
      "backlog",
      "v1",
      "delamains",
      "release-jobs",
      "dispatcher",
    );

    await mkdir(dispatcherA, { recursive: true });
    await mkdir(dispatcherB, { recursive: true });
    await cp(dispatcherV11FixtureRoot, dispatcherA, { recursive: true });
    await cp(dispatcherV11FixtureRoot, dispatcherB, { recursive: true });
    await cp(liveSystemRoot, stagingSystemRoot, { recursive: true });

    const preflight = await preflightDelamainConstructUpgrade({
      system_root: liveSystemRoot,
      plugin_root: alsRepoRoot,
    });
    expect(preflight.needs_upgrade).toBe(true);
    expect(preflight.current_version).toBe(11);
    expect(preflight.target_version).toBe(13);
    expect(preflight.prompts.filter((prompt) => prompt.intent === "pick-construct-lifecycle")).toHaveLength(2);
    expect(preflight.prompts.filter((prompt) => prompt.intent === "confirm-construct-overwrite")).toHaveLength(0);

    const execute = await executeDelamainConstructUpgrade({
      live_system_root: liveSystemRoot,
      staging_system_root: stagingSystemRoot,
      plugin_root: alsRepoRoot,
      operator_answers: {
        "dispatcher-lifecycle:factory-jobs": "drain",
        "dispatcher-lifecycle:release-jobs": "kill",
      },
    });

    expect(execute.needs_upgrade).toBe(true);
    expect(execute.action_manifest?.actions.map((action) => action.kind)).toEqual([
      "drain-then-restart",
      "kill-then-restart",
    ]);

    expect(await readFile(join(dispatcherA, "VERSION"), "utf-8")).toBe("11\n");
    expect(await readFile(join(
      stagingSystemRoot,
      ".als",
      "modules",
      "backlog",
      "v1",
      "delamains",
      "factory-jobs",
      "dispatcher",
      "VERSION",
    ), "utf-8")).toBe("13\n");
    expect(execute.validation?.requires_claude_deploy).toBe(true);
  });
});

test("process construct execute records the applied version and emits start-only when the process is absent", async () => {
  await withTempDir("statusline-state", async (root) => {
    const liveSystemRoot = join(root, "live");
    const stagingSystemRoot = join(root, "staging");
    await mkdir(join(liveSystemRoot, ".als"), { recursive: true });
    await cp(liveSystemRoot, stagingSystemRoot, { recursive: true });

    const definition = createStatuslineProcessDefinition(alsRepoRoot);
    const execute = await executeProcessConstructUpgrade({
      live_system_root: liveSystemRoot,
      staging_system_root: stagingSystemRoot,
      plugin_root: alsRepoRoot,
      definition,
    });

    expect(execute.needs_upgrade).toBe(true);
    expect(execute.action_manifest?.actions[0]?.kind).toBe("start-only");
    const state = JSON.parse(await readFile(
      join(stagingSystemRoot, ".als", "runtime", "construct-upgrades", "state.json"),
      "utf-8",
    )) as {
      constructs: Record<string, { applied_version: number }>;
    };
    expect(state.constructs.statusline.applied_version).toBe(1);
  });
});

test("argv-substring locator parses process-table output deterministically", async () => {
  const child = spawn("sleep", ["60"], {
    stdio: "ignore",
    detached: true,
  });
  child.unref();

  try {
    const processTable = [
      `99999 bun run other.ts`,
      `${child.pid} /bin/sleep 60 argv-target-demo`,
    ].join("\n");
    const pid = findPidInProcessTable(processTable, ["sleep", "argv-target-demo"]);
    expect(pid).toBe(child.pid);
  } finally {
    try {
      process.kill(child.pid!, "SIGKILL");
    } catch {
      // Ignore cleanup races.
    }
  }
});

test("drain-then-restart action runner waits for drain acknowledgement and restarts the dispatcher", async () => {
  await withTempDir("drain-runner", async (root) => {
    const pluginRoot = join(root, "plugin");
    const systemRoot = join(root, "system");
    const scriptPath = join(pluginRoot, "fake-dispatcher.ts");
    await mkdir(pluginRoot, { recursive: true });
    await mkdir(join(systemRoot, ".claude", "delamains", "factory-jobs", "dispatcher", "control"), { recursive: true });
    await writeFile(scriptPath, [
      "import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';",
      "import { dirname, join } from 'node:path';",
      "const systemRoot = process.argv[2];",
      "const statusPath = join(systemRoot, '.claude', 'delamains', 'factory-jobs', 'status.json');",
      "const drainPath = join(systemRoot, '.claude', 'delamains', 'factory-jobs', 'dispatcher', 'control', 'drain-request.json');",
      "mkdirSync(dirname(statusPath), { recursive: true });",
      "let mode = 'running';",
      "let active = 1;",
      "const writeStatus = () => {",
      "  writeFileSync(statusPath, JSON.stringify({",
      "    pid: process.pid,",
      "    last_tick: new Date().toISOString(),",
      "    active_dispatches: active,",
      "    lifecycle_mode: mode",
      "  }) + '\\n');",
      "};",
      "writeStatus();",
      "const interval = setInterval(() => {",
      "  if (mode === 'running' && existsSync(drainPath)) {",
      "    mode = 'draining';",
      "    writeStatus();",
      "    setTimeout(() => {",
      "      active = 0;",
      "      writeStatus();",
      "      clearInterval(interval);",
      "      process.exit(0);",
      "    }, 300);",
      "    return;",
      "  }",
      "  writeStatus();",
      "}, 100);",
      "const stop = () => { clearInterval(interval); try { rmSync(statusPath, { force: true }); } catch {} process.exit(0); };",
      "process.on('SIGTERM', stop);",
      "process.on('SIGINT', stop);",
      "",
    ].join("\n"), "utf-8");

    const firstProcess = spawn("bun", ["run", scriptPath, systemRoot], {
      stdio: "ignore",
      detached: true,
    });
    firstProcess.unref();
    await Bun.sleep(400);

    const manifest = {
      schema: "als-construct-action-manifest@1" as const,
      actions: [
        {
          kind: "drain-then-restart" as const,
          construct: "dispatcher",
          instance_id: "factory-jobs",
          display_name: "Factory Jobs",
          start: {
            command: ["bun", "run", "$CLAUDE_PLUGIN_ROOT/fake-dispatcher.ts", "$ALS_SYSTEM_ROOT"],
            cwd: "$ALS_SYSTEM_ROOT",
          },
          process_locator: {
            kind: "json-file-pid" as const,
            path: "$ALS_SYSTEM_ROOT/.claude/delamains/factory-jobs/status.json",
            pid_field: "pid",
          },
          drain_signal: {
            kind: "json-file-write" as const,
            path: "$ALS_SYSTEM_ROOT/.claude/delamains/factory-jobs/dispatcher/control/drain-request.json",
            payload: {
              requested_at: new Date().toISOString(),
            },
          },
        },
      ],
    };

    const result = await runConstructActionManifest(manifest, {
      system_root: systemRoot,
      plugin_root: pluginRoot,
      poll_ms: 100,
      drain_ack_timeout_ms: 5_000,
      start_timeout_ms: 5_000,
      dispatcher_heartbeat_stale_threshold_ms: 5_000,
    });

    expect(result.success).toBe(true);
    const status = JSON.parse(await readFile(
      join(systemRoot, ".claude", "delamains", "factory-jobs", "status.json"),
      "utf-8",
    )) as {
      pid: number;
      lifecycle_mode: string;
    };
    expect(status.lifecycle_mode).toBe("running");

    try {
      process.kill(status.pid, "SIGKILL");
    } catch {
      // Ignore cleanup races.
    }
  });
});
