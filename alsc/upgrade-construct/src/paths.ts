import { resolve } from "node:path";

export interface RuntimePathRoots {
  system_root: string;
  plugin_root: string;
}

export function resolveRuntimePlaceholderPath(
  value: string,
  roots: RuntimePathRoots,
): string {
  if (value.startsWith("$ALS_SYSTEM_ROOT")) {
    return resolve(roots.system_root, `.${value.slice("$ALS_SYSTEM_ROOT".length)}`);
  }

  if (value.startsWith("$CLAUDE_PLUGIN_ROOT")) {
    return resolve(roots.plugin_root, `.${value.slice("$CLAUDE_PLUGIN_ROOT".length)}`);
  }

  throw new Error(`Unsupported runtime placeholder path '${value}'.`);
}

export function resolveRuntimeCommand(
  command: string[],
  roots: RuntimePathRoots,
): string[] {
  return command.map((part) => part.startsWith("$")
    ? resolveRuntimePlaceholderPath(part, roots)
    : part);
}

export function assertWithinRoot(root: string, candidate: string): void {
  const resolvedRoot = resolve(root);
  const resolvedCandidate = resolve(candidate);
  if (
    resolvedCandidate !== resolvedRoot
    && !resolvedCandidate.startsWith(`${resolvedRoot}/`)
  ) {
    throw new Error(`Refusing to write outside staging root: ${resolvedCandidate}`);
  }
}
