import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { discoverDelamainBundles } from "./discovery.ts";

test("discoverDelamainBundles only scans the current ALS system root", async () => {
  const root = await mkdtemp(join(tmpdir(), "als-dashboard-discovery-"));
  const extraRoot = await mkdtemp(join(tmpdir(), "als-dashboard-discovery-extra-"));
  const retiredRootsFile = ["delamain", "roots"].join("-");

  try {
    await mkdir(join(root, ".claude", "delamains", "primary"), { recursive: true });
    await writeFile(join(root, ".claude", "delamains", "primary", "delamain.yaml"), "name: primary\n", "utf-8");

    await mkdir(join(extraRoot, ".claude", "delamains", "extra"), { recursive: true });
    await writeFile(join(extraRoot, ".claude", "delamains", "extra", "delamain.yaml"), "name: extra\n", "utf-8");

    await writeFile(join(root, ".claude", retiredRootsFile), `${extraRoot}\n`, "utf-8");

    const discovered = await discoverDelamainBundles(root);

    expect(discovered.roots).toEqual([resolve(root)]);
    expect(discovered.bundles).toEqual([
      {
        name: "primary",
        systemRoot: resolve(root),
        bundleRoot: join(resolve(root), ".claude", "delamains", "primary"),
      },
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(extraRoot, { recursive: true, force: true });
  }
});
