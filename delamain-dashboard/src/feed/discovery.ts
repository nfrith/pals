import { readFile, readdir } from "fs/promises";
import { join, resolve as resolvePath } from "path";
import {
  getHarnessRuntimeSpec,
  listHarnessRuntimeSpecs,
  type HarnessTarget,
} from "../../../alsc/shared/harnesses.ts";

export interface DiscoveredBundle {
  name: string;
  systemRoot: string;
  bundleRoot: string;
  harness: HarnessTarget;
}

export async function discoverDelamainRoots(
  systemRoot: string,
  harnesses?: readonly HarnessTarget[],
): Promise<string[]> {
  const roots = [resolvePath(systemRoot)];
  const specs = harnesses
    ? harnesses.map((target) => getHarnessRuntimeSpec(target))
    : listHarnessRuntimeSpecs();

  for (const spec of specs) {
    const rootsFile = join(systemRoot, spec.delamain_roots_file);
    try {
      const raw = await readFile(rootsFile, "utf-8");
      for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        roots.push(resolvePath(trimmed));
      }
    } catch {
      // Optional roots file.
    }
  }

  return [...new Set(roots)];
}

export async function discoverDelamainBundles(
  systemRoot: string,
  harnesses?: readonly HarnessTarget[],
): Promise<{
  roots: string[];
  bundles: DiscoveredBundle[];
}> {
  const specs = harnesses
    ? harnesses.map((target) => getHarnessRuntimeSpec(target))
    : listHarnessRuntimeSpecs();
  const roots = await discoverDelamainRoots(systemRoot, harnesses);
  const bundles: DiscoveredBundle[] = [];

  for (const root of roots) {
    for (const spec of specs) {
      const delamainsDir = join(root, spec.delamain_runtime_root);
      const entries = await readdir(delamainsDir, { withFileTypes: true }).catch(() => []);

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        bundles.push({
          name: entry.name,
          systemRoot: root,
          bundleRoot: join(delamainsDir, entry.name),
          harness: spec.target,
        });
      }
    }
  }

  bundles.sort((left, right) =>
    left.name.localeCompare(right.name) || left.harness.localeCompare(right.harness)
  );

  return {
    roots,
    bundles,
  };
}
