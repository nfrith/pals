import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type ClaudeHookEventName = "PostToolUse" | "Stop";

export async function parseClaudeHookInput<T>(): Promise<T | null> {
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

export function writeClaudeAdditionalContext(
  hookEventName: ClaudeHookEventName,
  additionalContext: string,
): void {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName,
      additionalContext,
    },
  }));
}

export function writeClaudeBlock(
  hookEventName: ClaudeHookEventName,
  reason: string,
  additionalContext: string | null,
): void {
  const output: {
    decision: "block";
    reason: string;
    hookSpecificOutput?: {
      hookEventName: ClaudeHookEventName;
      additionalContext: string;
    };
  } = {
    decision: "block",
    reason,
  };

  if (additionalContext) {
    output.hookSpecificOutput = {
      hookEventName,
      additionalContext,
    };
  }

  process.stdout.write(JSON.stringify(output));
}
