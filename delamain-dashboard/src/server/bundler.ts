import { mkdir, rm } from "fs/promises";
import { basename, extname, resolve } from "path";

export interface DashboardClientAssets {
  files: Map<string, string>;
  scriptPaths: string[];
  stylePaths: string[];
}

const packageRoot = resolve(import.meta.dir, "..", "..");
const bundleRoot = resolve(packageRoot, ".bundle");
const clientEntrypoint = resolve(packageRoot, "src", "client", "main.tsx");

export async function buildDashboardClientBundle(): Promise<DashboardClientAssets> {
  await rm(bundleRoot, { recursive: true, force: true });
  await mkdir(bundleRoot, { recursive: true });

  const result = await Bun.build({
    entrypoints: [clientEntrypoint],
    minify: false,
    outdir: bundleRoot,
    sourcemap: "none",
    target: "browser",
  });

  if (!result.success) {
    throw new Error(
      result.logs.map((log) => log.message).join("\n") || "Bun.build failed for delamain-dashboard client",
    );
  }

  const files = new Map<string, string>();
  const scriptPaths: string[] = [];
  const stylePaths: string[] = [];

  for (const output of result.outputs) {
    const fileName = basename(output.path);
    files.set(fileName, output.path);

    if (fileName.endsWith(".js")) {
      scriptPaths.push(`/assets/${fileName}`);
    } else if (fileName.endsWith(".css")) {
      stylePaths.push(`/assets/${fileName}`);
    }
  }

  return {
    files,
    scriptPaths,
    stylePaths,
  };
}

export function resolveAssetPath(
  assets: DashboardClientAssets,
  pathname: string,
): string | null {
  if (pathname === "/app.js") {
    const legacyName = assets.scriptPaths[0]?.replace("/assets/", "");
    return legacyName ? assets.files.get(legacyName) ?? null : null;
  }

  if (!pathname.startsWith("/assets/")) return null;
  const fileName = pathname.slice("/assets/".length);
  if (!fileName || fileName.includes("/")) return null;
  return assets.files.get(fileName) ?? null;
}

export function contentTypeForAsset(pathname: string): string {
  const extension = extname(pathname);
  if (extension === ".css") return "text/css; charset=utf-8";
  if (extension === ".js") return "text/javascript; charset=utf-8";
  return "application/octet-stream";
}
