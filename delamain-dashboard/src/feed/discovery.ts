import { readFile, readdir } from "fs/promises";
import { join, resolve as resolvePath } from "path";

export interface DiscoveredBundle {
  name: string;
  systemRoot: string;
  bundleRoot: string;
}

export async function discoverDelamainRoots(systemRoot: string): Promise<string[]> {
  const roots = [resolvePath(systemRoot)];
  const rootsFile = join(systemRoot, ".claude", "delamain-roots");

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

  return [...new Set(roots)];
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
