import { readdir } from "fs/promises";
import { join, resolve as resolvePath } from "path";

export interface DiscoveredBundle {
  name: string;
  systemRoot: string;
  bundleRoot: string;
}

export async function discoverDelamainRoots(systemRoot: string): Promise<string[]> {
  return [resolvePath(systemRoot)];
}

export async function discoverDelamainBundles(systemRoot: string): Promise<{
  roots: string[];
  bundles: DiscoveredBundle[];
}> {
  const roots = await discoverDelamainRoots(systemRoot);
  const bundles: DiscoveredBundle[] = [];

  for (const root of roots) {
    const delamainsDir = join(root, ".claude", "delamains");
    const entries = await readdir(delamainsDir, { withFileTypes: true }).catch(() => []);

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      bundles.push({
        name: entry.name,
        systemRoot: root,
        bundleRoot: join(delamainsDir, entry.name),
      });
    }
  }

  bundles.sort((left, right) => left.name.localeCompare(right.name));

  return {
    roots,
    bundles,
  };
}
