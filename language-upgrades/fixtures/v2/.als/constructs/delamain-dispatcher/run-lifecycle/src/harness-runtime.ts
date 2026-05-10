export const HARNESS_TARGETS = ["claude", "codex"] as const;

export type HarnessTarget = typeof HARNESS_TARGETS[number];

const DELAMAIN_RUNTIME_ROOTS: Record<HarnessTarget, string> = Object.freeze({
  claude: ".claude/delamains",
  codex: ".codex/delamains",
});

export function isHarnessTarget(value: unknown): value is HarnessTarget {
  return typeof value === "string" && (HARNESS_TARGETS as readonly string[]).includes(value);
}

export function delamainRuntimeRootForHarness(target: HarnessTarget): string {
  return DELAMAIN_RUNTIME_ROOTS[target];
}

export function inferHarnessFromBundleRoot(bundleRoot: string): HarnessTarget | null {
  const normalized = bundleRoot.replace(/\\/g, "/");
  for (const target of HARNESS_TARGETS) {
    if (normalized.includes(`/${delamainRuntimeRootForHarness(target)}/`)) {
      return target;
    }
  }
  return null;
}
