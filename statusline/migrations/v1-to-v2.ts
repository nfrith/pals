import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

export async function migrate(context: {
  system_root: string;
}): Promise<void> {
  const systemRoot = context.system_root;
  const legacyDeployedPulse = join(systemRoot, ".claude", "scripts", "pulse.ts");
  const pulseMetaPath = join(systemRoot, ".claude", "scripts", ".cache", "pulse", "meta.json");

  for (const pid of discoverLegacyPulsePids(systemRoot, pulseMetaPath)) {
    await stopLegacyPulse(pid);
  }

  if (existsSync(legacyDeployedPulse)) {
    rmSync(legacyDeployedPulse, { force: true });
  }
}

function discoverLegacyPulsePids(systemRoot: string, pulseMetaPath: string): number[] {
  const pids = new Set<number>();
  const metaPid = readMetaPid(pulseMetaPath);
  if (metaPid != null && isLegacyPulseProcess(metaPid, systemRoot)) {
    pids.add(metaPid);
  }

  try {
    const result = Bun.spawnSync({
      cmd: ["ps", "-axww", "-o", "pid=,command="],
      stdout: "pipe",
      stderr: "ignore",
    });
    if (result.exitCode !== 0) {
      return [...pids];
    }

    const table = new TextDecoder().decode(result.stdout);
    for (const line of table.split("\n")) {
      const match = line.trim().match(/^([0-9]+)\s+(.*)$/);
      if (!match) {
        continue;
      }

      const pid = Number(match[1]);
      const command = match[2] ?? "";
      if (
        Number.isFinite(pid)
        && command.includes(systemRoot)
        && (
          command.includes("/statusline/pulse.ts")
          || command.includes("/.claude/scripts/pulse.ts")
        )
        && !command.includes("/statusline/mcp-server/index.ts")
        && pidAlive(pid)
      ) {
        pids.add(pid);
      }
    }
  } catch {
    // Process table inspection is best-effort only.
  }

  return [...pids];
}

function readMetaPid(metaPath: string): number | null {
  if (!existsSync(metaPath)) {
    return null;
  }

  try {
    const parsed = JSON.parse(readFileSync(metaPath, "utf8")) as { pid?: number };
    return typeof parsed.pid === "number" ? parsed.pid : null;
  } catch {
    return null;
  }
}

function isLegacyPulseProcess(pid: number, systemRoot: string): boolean {
  if (!pidAlive(pid)) {
    return false;
  }

  try {
    const result = Bun.spawnSync({
      cmd: ["ps", "-p", String(pid), "-o", "command="],
      stdout: "pipe",
      stderr: "ignore",
    });
    if (result.exitCode !== 0) {
      return false;
    }

    const command = new TextDecoder().decode(result.stdout);
    return command.includes(systemRoot)
      && (
        command.includes("/statusline/pulse.ts")
        || command.includes("/.claude/scripts/pulse.ts")
      )
      && !command.includes("/statusline/mcp-server/index.ts");
  } catch {
    return false;
  }
}

async function stopLegacyPulse(pid: number): Promise<void> {
  if (!pidAlive(pid)) {
    return;
  }

  try {
    process.kill(pid, "SIGTERM");
  } catch {
    return;
  }

  await Bun.sleep(200);
  if (!pidAlive(pid)) {
    return;
  }

  try {
    process.kill(pid, "SIGHUP");
  } catch {
    return;
  }

  const deadline = Date.now() + 1500;
  while (Date.now() < deadline) {
    if (!pidAlive(pid)) {
      return;
    }
    await Bun.sleep(50);
  }

  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // Ignore races once the process is already gone.
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
