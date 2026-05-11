import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export async function parseHookInput<T>(): Promise<T | null> {
  try {
    const raw = await Bun.stdin.text();
    if (raw.trim().length === 0) {
      return null;
    }
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function derivePluginRootFromEntrypoint(entrypointUrl: string): string {
  return resolve(dirname(fileURLToPath(entrypointUrl)), "..");
}
