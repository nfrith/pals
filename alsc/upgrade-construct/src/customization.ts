import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import type { ConstructVersionFingerprint } from "./types.ts";

export async function computeFingerprintMap(
  root: string,
  relativePaths: string[],
): Promise<Record<string, string>> {
  const entries = await Promise.all(
    relativePaths.map(async (relativePath) => [relativePath, await hashRelativePath(root, relativePath)] as const),
  );
  return Object.fromEntries(entries);
}

export async function detectKnownConstructFingerprint(
  root: string,
  knownFingerprints: ConstructVersionFingerprint[],
): Promise<{
  matched_version: number | null;
  customized: boolean;
}> {
  for (const fingerprint of knownFingerprints) {
    const computed = await computeFingerprintMap(root, Object.keys(fingerprint.hashes));
    const matches = Object.entries(fingerprint.hashes).every(([relativePath, expectedHash]) => {
      return computed[relativePath] === expectedHash;
    });
    if (matches) {
      return {
        matched_version: fingerprint.version,
        customized: false,
      };
    }
  }

  return {
    matched_version: null,
    customized: true,
  };
}

async function hashRelativePath(root: string, relativePath: string): Promise<string> {
  const target = resolve(root, relativePath);
  const targetStat = await stat(target);

  if (targetStat.isDirectory()) {
    const children = (await readdir(target)).sort();
    const hash = createHash("sha256");
    hash.update("dir\0");
    for (const child of children) {
      const childRelative = relative(target, join(target, child));
      hash.update(child);
      hash.update("\0");
      hash.update(await hashRelativePath(target, childRelative));
      hash.update("\0");
    }
    return hash.digest("hex");
  }

  const contents = await readFile(target);
  return createHash("sha256")
    .update("file\0")
    .update(contents)
    .digest("hex");
}
