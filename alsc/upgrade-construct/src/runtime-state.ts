import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { ConstructUpgradeRuntimeState } from "./types.ts";

export const CONSTRUCT_UPGRADE_RUNTIME_STATE_SCHEMA = "als-construct-upgrade-runtime-state@1";

export function resolveConstructUpgradeRuntimeStatePath(systemRoot: string): string {
  return join(resolve(systemRoot), ".als", "runtime", "construct-upgrades", "state.json");
}

export function createConstructUpgradeRuntimeState(
  systemRoot: string,
): ConstructUpgradeRuntimeState {
  return {
    schema: CONSTRUCT_UPGRADE_RUNTIME_STATE_SCHEMA,
    system_root: resolve(systemRoot),
    constructs: {},
    updated_at: new Date().toISOString(),
  };
}

export async function readConstructUpgradeRuntimeState(
  systemRoot: string,
): Promise<ConstructUpgradeRuntimeState> {
  const statePath = resolveConstructUpgradeRuntimeStatePath(systemRoot);
  let raw: string;
  try {
    raw = await readFile(statePath, "utf-8");
  } catch (error) {
    if (isMissing(error)) {
      return createConstructUpgradeRuntimeState(systemRoot);
    }
    throw error;
  }

  const parsed = JSON.parse(raw) as Partial<ConstructUpgradeRuntimeState>;
  if (parsed.schema !== CONSTRUCT_UPGRADE_RUNTIME_STATE_SCHEMA) {
    throw new Error(
      `Unsupported construct-upgrade runtime state schema '${parsed.schema ?? "<missing>"}'.`,
    );
  }

  return {
    schema: CONSTRUCT_UPGRADE_RUNTIME_STATE_SCHEMA,
    system_root: typeof parsed.system_root === "string" ? parsed.system_root : resolve(systemRoot),
    constructs: typeof parsed.constructs === "object" && parsed.constructs !== null
      ? Object.fromEntries(
        Object.entries(parsed.constructs).flatMap(([key, value]) => {
          if (!value || typeof value !== "object") {
            return [];
          }
          const record = value as Partial<ConstructUpgradeRuntimeState["constructs"][string]>;
          if (typeof record.applied_version !== "number") {
            return [];
          }
          return [[key, {
            applied_version: record.applied_version,
            updated_at: typeof record.updated_at === "string" ? record.updated_at : new Date().toISOString(),
          }]];
        }),
      )
      : {},
    updated_at: typeof parsed.updated_at === "string" ? parsed.updated_at : new Date().toISOString(),
  };
}

export async function writeConstructUpgradeRuntimeState(
  systemRoot: string,
  state: ConstructUpgradeRuntimeState,
): Promise<void> {
  const statePath = resolveConstructUpgradeRuntimeStatePath(systemRoot);
  await mkdir(dirname(statePath), { recursive: true });
  const nextState = {
    ...state,
    schema: CONSTRUCT_UPGRADE_RUNTIME_STATE_SCHEMA,
    system_root: resolve(systemRoot),
    updated_at: new Date().toISOString(),
  } satisfies ConstructUpgradeRuntimeState;
  const tempPath = `${statePath}.tmp`;
  await writeFile(tempPath, JSON.stringify(nextState, null, 2) + "\n", "utf-8");
  await rename(tempPath, statePath);
}

export async function recordAppliedConstructVersion(
  systemRoot: string,
  construct: string,
  version: number,
): Promise<ConstructUpgradeRuntimeState> {
  const state = await readConstructUpgradeRuntimeState(systemRoot);
  state.constructs[construct] = {
    applied_version: version,
    updated_at: new Date().toISOString(),
  };
  await writeConstructUpgradeRuntimeState(systemRoot, state);
  return state;
}

function isMissing(error: unknown): error is NodeJS.ErrnoException {
  return Boolean(
    error
    && typeof error === "object"
    && "code" in error
    && (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}
