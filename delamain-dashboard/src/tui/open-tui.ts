import { setRenderLibPath } from "@opentui/core";

let configured = false;

const PLATFORM_PACKAGES: Record<string, string> = {
  "darwin-arm64": "@opentui/core-darwin-arm64",
  "darwin-x64": "@opentui/core-darwin-x64",
  "linux-arm64": "@opentui/core-linux-arm64",
  "linux-x64": "@opentui/core-linux-x64",
  "win32-arm64": "@opentui/core-win32-arm64",
  "win32-x64": "@opentui/core-win32-x64",
};

export async function configureOpenTui(): Promise<void> {
  if (configured) return;

  const key = `${process.platform}-${process.arch}`;
  const packageName = PLATFORM_PACKAGES[key];
  if (!packageName) {
    throw new Error(`Unsupported OpenTUI platform: ${key}`);
  }

  const module = await import(packageName);
  setRenderLibPath(module.default);
  configured = true;
}
