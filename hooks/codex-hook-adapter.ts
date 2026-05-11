import { resolve } from "node:path";

export interface CodexHookPayload {
  hook_event_name?: string;
  cwd?: string;
  session_id?: string;
  tool_name?: string;
  tool_input?: {
    command?: string;
    file_path?: string;
  };
}

export function isCodexHookPayload(value: unknown): value is CodexHookPayload {
  return isRecord(value) && typeof value.hook_event_name === "string";
}

export function extractCodexTouchedPaths(payload: CodexHookPayload): string[] {
  const touchedPaths = new Set<string>();
  const cwd = typeof payload.cwd === "string" && payload.cwd.length > 0
    ? payload.cwd
    : process.cwd();

  const directFilePath = typeof payload.tool_input?.file_path === "string" && payload.tool_input.file_path.length > 0
    ? payload.tool_input.file_path
    : null;
  if (directFilePath) {
    touchedPaths.add(resolve(cwd, directFilePath));
  }

  const command = typeof payload.tool_input?.command === "string"
    ? payload.tool_input.command
    : "";
  for (const path of extractPatchPaths(command)) {
    touchedPaths.add(resolve(cwd, path));
  }

  return [...touchedPaths];
}

export function writeCodexPostToolUseAdditionalContext(additionalContext: string): void {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext,
    },
  }));
}

export function writeCodexPostToolUseBlock(reason: string, additionalContext: string | null): void {
  const output: {
    decision: "block";
    reason: string;
    hookSpecificOutput?: {
      hookEventName: "PostToolUse";
      additionalContext: string;
    };
  } = {
    decision: "block",
    reason,
  };

  if (additionalContext) {
    output.hookSpecificOutput = {
      hookEventName: "PostToolUse",
      additionalContext,
    };
  }

  process.stdout.write(JSON.stringify(output));
}

export function writeCodexStopBlock(reason: string): void {
  process.stdout.write(JSON.stringify({
    decision: "block",
    reason,
  }));
}

function extractPatchPaths(command: string): string[] {
  const paths: string[] = [];

  for (const match of command.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)) {
    const path = match[1]?.trim();
    if (path) {
      paths.push(path);
    }
  }

  for (const match of command.matchAll(/^\*\*\* Move to: (.+)$/gm)) {
    const path = match[1]?.trim();
    if (path) {
      paths.push(path);
    }
  }

  return paths;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
