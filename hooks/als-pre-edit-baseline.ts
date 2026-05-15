#!/usr/bin/env bun

import {
  capturePreEditValidationBaseline,
  resolveTouchedPathTarget,
} from "../alsc/compiler/src/hook-runtime.ts";
import {
  extractCodexTouchedPaths,
  isCodexHookPayload,
  type CodexHookPayload,
} from "./codex-hook-adapter.ts";
import {
  derivePluginRootFromEntrypoint,
  parseHookInput,
} from "./hook-adapter.ts";

interface ClaudePreToolUsePayload {
  session_id?: string;
  tool_input?: {
    file_path?: string;
  };
}

try {
  const input = await parseHookInput<ClaudePreToolUsePayload | CodexHookPayload>();
  const sessionId = input?.session_id ?? "";
  const touchedPaths = isCodexHookPayload(input)
    ? extractCodexTouchedPaths(input)
    : input?.tool_input?.file_path
    ? [input.tool_input.file_path]
    : [];
  const baselinePaths = dedupeModulePaths(touchedPaths);

  for (const filePath of baselinePaths) {
    capturePreEditValidationBaseline({
      context: {
        plugin_root: derivePluginRootFromEntrypoint(import.meta.url),
      },
      file_path: filePath,
      session_id: sessionId,
    });
  }
} catch {
  process.exit(0);
}

function dedupeModulePaths(filePaths: string[]): string[] {
  const seenTargets = new Set<string>();
  const dedupedPaths: string[] = [];

  for (const filePath of filePaths) {
    const resolution = resolveTouchedPathTarget(filePath);
    if (resolution.status !== "module" || !resolution.target) {
      continue;
    }

    const key = `${resolution.target.system_root}:${resolution.target.module_id}`;
    if (seenTargets.has(key)) {
      continue;
    }

    seenTargets.add(key);
    dedupedPaths.push(filePath);
  }

  return dedupedPaths;
}
