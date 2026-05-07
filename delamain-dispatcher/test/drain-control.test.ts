import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDrainControlPlane } from "../src/drain-control.js";

async function withTempDir(
  label: string,
  run: (root: string) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), `als-dispatcher-${label}-`));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function waitFor<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`Timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

test("drain control startup reconciliation detects a pre-existing drain request", async () => {
  await withTempDir("drain-control-startup", async (root) => {
    const drainRequestFile = join(root, "dispatcher", "control", "drain-request.json");
    await mkdir(join(root, "dispatcher", "control"), { recursive: true });
    await writeFile(drainRequestFile, JSON.stringify({ requested: true }) + "\n", "utf-8");

    let resolveDetection: ((source: string) => void) | null = null;
    const detected = new Promise<string>((resolve) => {
      resolveDetection = resolve;
    });

    const plane = createDrainControlPlane({
      drainRequestFile,
      controlPollMs: 250,
      onDrainRequested: ({ source }) => {
        resolveDetection?.(source);
      },
    });

    try {
      await plane.start();
      await expect(waitFor(detected, 500)).resolves.toBe("startup");
      expect(plane.snapshot().last_drain_detection_source).toBe("startup");
    } finally {
      plane.stop();
    }
  });
});

test("drain control watcher acknowledges a new drain request without waiting for the fallback poll", async () => {
  await withTempDir("drain-control-watch", async (root) => {
    const drainRequestFile = join(root, "dispatcher", "control", "drain-request.json");

    let resolveDetection: ((source: string) => void) | null = null;
    const detected = new Promise<string>((resolve) => {
      resolveDetection = resolve;
    });
    let emitWatchEvent: (() => void) | null = null;

    const plane = createDrainControlPlane({
      drainRequestFile,
      controlPollMs: 5_000,
      watchFactory: (_path, listener) => {
        emitWatchEvent = () => {
          listener("rename", "drain-request.json");
        };
        return {
          close() {},
          on() {
            return this;
          },
        };
      },
      onDrainRequested: ({ source }) => {
        resolveDetection?.(source);
      },
    });

    try {
      await plane.start();
      await writeFile(drainRequestFile, JSON.stringify({ requested: true }) + "\n", "utf-8");
      emitWatchEvent?.();
      await expect(waitFor(detected, 1_000)).resolves.toBe("watch");
      expect(plane.snapshot().watch_state).toBe("active");
    } finally {
      plane.stop();
    }
  });
});

test("drain control fallback poll still detects drain requests when watcher attach fails", async () => {
  await withTempDir("drain-control-poll", async (root) => {
    const drainRequestFile = join(root, "dispatcher", "control", "drain-request.json");

    let resolveDetection: ((source: string) => void) | null = null;
    const detected = new Promise<string>((resolve) => {
      resolveDetection = resolve;
    });

    const plane = createDrainControlPlane({
      drainRequestFile,
      controlPollMs: 50,
      watchFactory: () => {
        throw new Error("synthetic watcher attach failure");
      },
      onDrainRequested: ({ source }) => {
        resolveDetection?.(source);
      },
    });

    try {
      await plane.start();
      await writeFile(drainRequestFile, JSON.stringify({ requested: true }) + "\n", "utf-8");
      await expect(waitFor(detected, 1_000)).resolves.toBe("control-poll");
      expect(plane.snapshot().watch_state).toBe("retrying");
      expect(plane.snapshot().last_watch_error).toBe("synthetic watcher attach failure");
    } finally {
      plane.stop();
    }
  });
});
