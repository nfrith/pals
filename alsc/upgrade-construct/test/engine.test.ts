import { expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile, cp } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import {
  createDashboardProcessDefinition,
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
    resolve(alsRepoRoot, "delamain-dispatcher"),
    DISPATCHER_KNOWN_VENDOR_FINGERPRINTS,
  );

  expect(fingerprint).toEqual({
    matched_version: 19,
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
      "constructs",
      "delamain-dispatcher",
      "factory-jobs",
    );
    const dispatcherB = join(
      liveSystemRoot,
      ".als",
      "constructs",
      "delamain-dispatcher",
      "release-jobs",
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
    expect(preflight.target_version).toBe(19);
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
    expect(execute.action_manifest?.actions[0]?.start.command).toEqual([
      "bun",
      "run",
      "$ALS_SYSTEM_ROOT/.claude/delamains/factory-jobs/dispatcher/src/index.ts",
    ]);

    expect(await readFile(join(dispatcherA, "VERSION"), "utf-8")).toBe("11\n");
    expect(await readFile(join(
      stagingSystemRoot,
      ".als",
      "constructs",
      "delamain-dispatcher",
      "factory-jobs",
      "VERSION",
    ), "utf-8")).toBe("19\n");
    expect(execute.validation?.requires_claude_deploy).toBe(true);
  });
});

test("delamain construct execute can emit Codex dispatcher lifecycle actions", async () => {
  await withTempDir("dispatcher-codex-stage", async (root) => {
    const liveSystemRoot = join(root, "live");
    const stagingSystemRoot = join(root, "staging");
    const dispatcherRoot = join(
      liveSystemRoot,
      ".als",
      "constructs",
      "delamain-dispatcher",
      "factory-jobs",
    );

    await mkdir(dispatcherRoot, { recursive: true });
    await cp(dispatcherV11FixtureRoot, dispatcherRoot, { recursive: true });
    await cp(liveSystemRoot, stagingSystemRoot, { recursive: true });

    const execute = await executeDelamainConstructUpgrade({
      live_system_root: liveSystemRoot,
      staging_system_root: stagingSystemRoot,
      plugin_root: alsRepoRoot,
      harness: "codex",
      operator_answers: {
        "dispatcher-lifecycle:factory-jobs": "drain",
      },
    });

    expect(execute.needs_upgrade).toBe(true);
    expect(execute.action_manifest?.actions[0]?.start.command).toEqual([
      "bun",
      "run",
      "$ALS_SYSTEM_ROOT/.codex/delamains/factory-jobs/dispatcher/src/index.ts",
    ]);
    expect(execute.action_manifest?.actions[0]?.process_locator?.path).toBe(
      "$ALS_SYSTEM_ROOT/.codex/delamains/factory-jobs/status.json",
    );
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
    expect(execute.action_manifest?.actions[0]?.start.command).toEqual([
      "bun",
      "run",
      "$ALS_PLUGIN_ROOT/statusline/pulse.ts",
      "$ALS_SYSTEM_ROOT",
    ]);
    const state = JSON.parse(await readFile(
      join(stagingSystemRoot, ".als", "runtime", "construct-upgrades", "state.json"),
      "utf-8",
    )) as {
      constructs: Record<string, { applied_version: number }>;
    };
    expect(state.constructs.statusline.applied_version).toBe(1);
  });
});

test("dashboard process definition scopes lifecycle lookup to the selected harness", () => {
  const definition = createDashboardProcessDefinition(alsRepoRoot, "codex");

  expect(definition.start.command).toContain("--harness");
  expect(definition.start.command).toContain("codex");
  expect(definition.process_locator.kind).toBe("argv-substring");
  if (definition.process_locator.kind === "argv-substring") {
    expect(definition.process_locator.argv_contains).toContain("--harness");
    expect(definition.process_locator.argv_contains).toContain("codex");
  }
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

    const result = await runConstructActionManifest(buildDrainManifest(), {
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

test("drain-then-restart acknowledges worst-case timing without waiting for a 30s scan tick", async () => {
  await withTempDir("drain-runner-worst-case", async (root) => {
    const pluginRoot = join(root, "plugin");
    const systemRoot = join(root, "system");
    const ackFile = join(root, "ack.json");
    await mkdir(pluginRoot, { recursive: true });
    await mkdir(join(systemRoot, ".claude", "delamains", "factory-jobs", "dispatcher", "control"), { recursive: true });

    const scriptPath = await writeGenericFakeDispatcher(pluginRoot);
    const configPath = buildFakeDispatcherConfigPath(systemRoot);
    await writeFile(configPath, JSON.stringify({
      tickMs: 30_000,
      watchDrain: true,
      controlPollMs: 250,
      exitDelayMs: 200,
      ackFile,
    }, null, 2) + "\n", "utf-8");

    const firstProcess = spawn("bun", ["run", scriptPath, systemRoot, configPath], {
      stdio: "ignore",
      detached: true,
    });
    firstProcess.unref();
    await Bun.sleep(300);

    const result = await runConstructActionManifest(buildDrainManifest(), {
      system_root: systemRoot,
      plugin_root: pluginRoot,
      poll_ms: 100,
      drain_ack_timeout_ms: 5_000,
      start_timeout_ms: 5_000,
      dispatcher_heartbeat_stale_threshold_ms: 5_000,
    });

    expect(result.success).toBe(true);
    const ack = JSON.parse(await readFile(ackFile, "utf-8")) as {
      source: string;
      requested_at: string;
      acknowledged_at: string;
    };
    const latencyMs = Date.parse(ack.acknowledged_at) - Date.parse(ack.requested_at);
    expect(["watch", "control-poll"]).toContain(ack.source);
    expect(latencyMs).toBeLessThan(1_000);

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

test("drain-then-restart still reports lifecycle-drain-stalled for a frozen dispatcher", async () => {
  await withTempDir("drain-runner-frozen", async (root) => {
    const pluginRoot = join(root, "plugin");
    const systemRoot = join(root, "system");
    await mkdir(pluginRoot, { recursive: true });
    await mkdir(join(systemRoot, ".claude", "delamains", "factory-jobs", "dispatcher", "control"), { recursive: true });

    const scriptPath = await writeGenericFakeDispatcher(pluginRoot);
    const configPath = buildFakeDispatcherConfigPath(systemRoot);
    await writeFile(configPath, JSON.stringify({
      tickMs: 30_000,
      watchDrain: true,
      controlPollMs: 250,
      exitDelayMs: 200,
    }, null, 2) + "\n", "utf-8");

    const firstProcess = spawn("bun", ["run", scriptPath, systemRoot, configPath], {
      stdio: "ignore",
      detached: true,
    });
    firstProcess.unref();
    await Bun.sleep(300);
    process.kill(firstProcess.pid!, "SIGSTOP");

    try {
      const result = await runConstructActionManifest(buildDrainManifest(), {
        system_root: systemRoot,
        plugin_root: pluginRoot,
        poll_ms: 100,
        drain_ack_timeout_ms: 1_000,
        start_timeout_ms: 5_000,
        dispatcher_heartbeat_stale_threshold_ms: 5_000,
      });

      expect(result.success).toBe(false);
      expect(result.failure?.precise_failure_state).toBe("lifecycle-drain-stalled");
      expect(result.failure?.message).toContain("did not acknowledge drain before");
    } finally {
      try {
        process.kill(firstProcess.pid!, "SIGCONT");
      } catch {
        // Ignore cleanup races.
      }
      try {
        process.kill(firstProcess.pid!, "SIGKILL");
      } catch {
        // Ignore cleanup races.
      }
    }
  });
});

function buildDrainManifest() {
  return {
    schema: "als-construct-action-manifest@1" as const,
    actions: [
      {
        kind: "drain-then-restart" as const,
        construct: "dispatcher",
        instance_id: "factory-jobs",
        display_name: "Factory Jobs",
        start: {
          command: [
            "bun",
            "run",
            "$CLAUDE_PLUGIN_ROOT/fake-dispatcher.ts",
            "$ALS_SYSTEM_ROOT",
            "$ALS_SYSTEM_ROOT/.claude/delamains/factory-jobs/dispatcher/fake-dispatcher-config.json",
          ],
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
}

function buildFakeDispatcherConfigPath(systemRoot: string): string {
  return join(
    systemRoot,
    ".claude",
    "delamains",
    "factory-jobs",
    "dispatcher",
    "fake-dispatcher-config.json",
  );
}

async function writeGenericFakeDispatcher(pluginRoot: string): Promise<string> {
  const scriptPath = join(pluginRoot, "fake-dispatcher.ts");
  await writeFile(scriptPath, [
    "import { existsSync, mkdirSync, readFileSync, rmSync, watch, writeFileSync } from 'node:fs';",
    "import { dirname, join } from 'node:path';",
    "const systemRoot = process.argv[2];",
    "const config = JSON.parse(readFileSync(process.argv[3], 'utf-8'));",
    "const statusPath = join(systemRoot, '.claude', 'delamains', 'factory-jobs', 'status.json');",
    "const drainPath = join(systemRoot, '.claude', 'delamains', 'factory-jobs', 'dispatcher', 'control', 'drain-request.json');",
    "mkdirSync(dirname(statusPath), { recursive: true });",
    "mkdirSync(dirname(drainPath), { recursive: true });",
    "let mode = 'running';",
    "let active = 1;",
    "let acknowledged = false;",
    "const writeStatus = () => {",
    "  writeFileSync(statusPath, JSON.stringify({",
    "    pid: process.pid,",
    "    last_tick: new Date().toISOString(),",
    "    active_dispatches: active,",
    "    lifecycle_mode: mode",
    "  }) + '\\n');",
    "};",
    "const clearIntervals = () => {",
    "  clearInterval(tickInterval);",
    "  if (controlInterval) clearInterval(controlInterval);",
    "  if (drainWatcher) {",
    "    try {",
    "      drainWatcher.close();",
    "    } catch {}",
    "  }",
    "};",
    "const recordAck = (source) => {",
    "  if (!config.ackFile) return;",
    "  const request = JSON.parse(readFileSync(drainPath, 'utf-8'));",
    "  writeFileSync(config.ackFile, JSON.stringify({",
    "    source,",
    "    requested_at: request.requested_at ?? null,",
    "    acknowledged_at: new Date().toISOString()",
    "  }) + '\\n');",
    "};",
    "const acknowledge = (source) => {",
    "  if (mode !== 'running' || acknowledged || !existsSync(drainPath)) return;",
    "  acknowledged = true;",
    "  mode = 'draining';",
    "  writeStatus();",
    "  recordAck(source);",
    "  if (config.hangAfterAck) return;",
    "  setTimeout(() => {",
    "    active = 0;",
    "    writeStatus();",
    "    clearIntervals();",
    "    process.exit(0);",
    "  }, config.exitDelayMs ?? 300);",
    "};",
    "const reconcile = (source) => {",
    "  acknowledge(source);",
    "};",
    "writeStatus();",
    "const tickInterval = setInterval(() => {",
    "  reconcile('tick');",
    "  writeStatus();",
    "}, config.tickMs ?? 100);",
    "const controlInterval = typeof config.controlPollMs === 'number'",
    "  ? setInterval(() => { reconcile('control-poll'); }, config.controlPollMs)",
    "  : null;",
    "const drainWatcher = config.watchDrain",
    "  ? watch(dirname(drainPath), () => { reconcile('watch'); })",
    "  : null;",
    "const stop = () => {",
    "  clearIntervals();",
    "  try { rmSync(statusPath, { force: true }); } catch {}",
    "  process.exit(0);",
    "};",
    "process.on('SIGTERM', stop);",
    "process.on('SIGINT', stop);",
    "",
  ].join("\n"), "utf-8");

  return scriptPath;
}
