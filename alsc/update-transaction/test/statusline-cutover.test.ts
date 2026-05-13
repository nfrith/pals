import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import {
  runPreparedUpdateTransaction,
  type PreparedUpdateTransaction,
  type UpdateTransactionServices,
} from "../src/index.ts";

const alsRepoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const pulsePath = resolve(alsRepoRoot, "statusline", "pulse.ts");

test("runPreparedUpdateTransaction executes the statusline v1-to-v2 cutover in isolation", async () => {
  await withTempRepo("statusline-cutover", async (repoRoot) => {
    await writeFixtureFile(repoRoot, ".claude/scripts/pulse.ts", "# legacy pulse copy\n");

    const pulse = Bun.spawn({
      cmd: [process.execPath, pulsePath, repoRoot],
      env: {
        ...process.env,
        PULSE_TICK_MS: "60",
        PULSE_SIGNAL_WINDOW_MS: "200",
        OBS_WS_TIMEOUT_MS: "20",
      },
      stdout: "ignore",
      stderr: "pipe",
    });

    const meta = await waitForPulseMeta(repoRoot);
    expect(meta.pid).toBe(pulse.pid);

    const prepared: PreparedUpdateTransaction = {
      status: "ready",
      repo_root: repoRoot,
      system_root: repoRoot,
      plugin_root: alsRepoRoot,
      language: null,
      constructs: {
        dispatcher: {
          construct: "dispatcher",
          current_version: null,
          target_version: 23,
          needs_upgrade: false,
          prompts: [],
          validation: null,
          telemetry: [],
        },
        statusline: {
          construct: "statusline",
          current_version: 1,
          target_version: 2,
          needs_upgrade: true,
          prompts: [],
          validation: {
            requires_claude_deploy: false,
            touched_paths: [".als/runtime/construct-upgrades/state.json"],
          },
          telemetry: [],
        },
        dashboard: {
          construct: "dashboard",
          current_version: null,
          target_version: 2,
          needs_upgrade: false,
          prompts: [],
          validation: null,
          telemetry: [],
        },
      },
      prompts: [],
      requires_changes: true,
      manual_follow_up_note: "If statusline data goes stale, run `/reload-plugins`.",
    };

    const services: UpdateTransactionServices = {
      validate_system() {
        return {
          status: "pass",
          als_version: 5,
        } as ReturnType<NonNullable<UpdateTransactionServices["validate_system"]>>;
      },
      deploy_claude() {
        return {
          status: "pass",
        } as ReturnType<NonNullable<UpdateTransactionServices["deploy_claude"]>>;
      },
      async run_action_manifest(manifest) {
        return {
          success: true,
          completed_action_count: manifest.actions.length,
          total_action_count: manifest.actions.length,
          failure: null,
        };
      },
    };

    const result = await runPreparedUpdateTransaction({
      prepared,
      services,
    });

    expect(result.status).toBe("completed");
    if (result.status !== "completed") {
      return;
    }

    expect(result.action_count).toBe(0);
    expect(result.manual_follow_up_note).toContain("/reload-plugins");
    expect(await pathExists(join(repoRoot, ".claude", "scripts", "pulse.ts"))).toBe(false);
    await waitFor(() => !pidAlive(meta.pid), "legacy pulse shutdown");

    const runtimeState = JSON.parse(
      await readFile(join(repoRoot, ".als", "runtime", "construct-upgrades", "state.json"), "utf-8"),
    ) as {
      constructs: Record<string, { applied_version: number }>;
    };
    expect(runtimeState.constructs.statusline.applied_version).toBe(2);
    expect(result.postconditions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "statusline.data-freshness",
        command_to_run: "/reload-plugins",
      }),
    ]));

    try {
      process.kill(pulse.pid, "SIGKILL");
    } catch {
      // The cutover should already have stopped it.
    }
    await pulse.exited;
  });
});

async function withTempRepo(
  label: string,
  run: (repoRoot: string) => Promise<void> | void,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), `als-statusline-cutover-${label}-`));
  const repoRoot = join(root, "repo");
  let runError: unknown = null;

  try {
    await mkdir(join(repoRoot, ".als"), { recursive: true });
    await writeFixtureFile(
      repoRoot,
      ".als/system.ts",
      "export const system = { als_version: 5, system_id: \"statusline-cutover\", modules: {} } as const;\n",
    );
    await writeFixtureFile(
      repoRoot,
      ".als/runtime/construct-upgrades/state.json",
      JSON.stringify({
        schema: "als-construct-upgrade-runtime-state@1",
        system_root: repoRoot,
        constructs: {
          statusline: {
            applied_version: 1,
            updated_at: new Date().toISOString(),
          },
        },
        updated_at: new Date().toISOString(),
      }, null, 2) + "\n",
    );
    await writeFixtureFile(repoRoot, ".claude/scripts/pulse.ts", "# legacy pulse copy\n");
    initializeGitRepository(repoRoot);
    await run(repoRoot);
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

async function writeFixtureFile(root: string, relativePath: string, contents: string): Promise<void> {
  const filePath = join(root, relativePath);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, contents, "utf-8");
}

function initializeGitRepository(root: string): void {
  git(root, ["init"]);
  git(root, ["config", "user.name", "ALS Cutover Tests"]);
  git(root, ["config", "user.email", "als-cutover-tests@local"]);
  git(root, ["add", "."]);
  git(root, ["add", "-f", ".claude/scripts/pulse.ts"]);
  git(root, ["commit", "--no-gpg-sign", "-m", "Initial fixture snapshot"]);
}

function git(root: string, args: string[]): string {
  const result = Bun.spawnSync({
    cmd: ["git", ...args],
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    throw new Error(
      Buffer.from(result.stderr).toString("utf-8").trim()
      || Buffer.from(result.stdout).toString("utf-8").trim()
      || `git ${args.join(" ")} failed`,
    );
  }
  return Buffer.from(result.stdout).toString("utf-8").trim();
}

async function waitForPulseMeta(repoRoot: string): Promise<{ pid: number; last_tick: number }> {
  const metaPath = join(repoRoot, ".claude", "scripts", ".cache", "pulse", "meta.json");
  return waitFor(async () => {
    if (!(await pathExists(metaPath))) {
      return null;
    }
    return JSON.parse(await readFile(metaPath, "utf-8")) as { pid: number; last_tick: number };
  }, `pulse meta at ${metaPath}`);
}

async function waitFor<T>(
  poll: () => Promise<T | null> | T | null,
  label: string,
  timeoutMs = 3000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await poll();
    if (value != null) {
      return value;
    }
    await Bun.sleep(50);
  }

  throw new Error(`Timed out waiting for ${label}`);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await readFile(path, "utf-8");
    return true;
  } catch {
    return false;
  }
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
