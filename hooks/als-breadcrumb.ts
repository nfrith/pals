#!/usr/bin/env bun

import { recordTouchedPathBreadcrumb } from "../alsc/compiler/src/hook-runtime.ts";
import {
  extractCodexTouchedPaths,
  isCodexHookPayload,
  type CodexHookPayload,
} from "./codex-hook-adapter.ts";
import {
  derivePluginRootFromEntrypoint,
  parseHookInput,
} from "./hook-adapter.ts";

interface ClaudePostToolUsePayload {
  session_id?: string;
  tool_input?: {
    file_path?: string;
  };
}

try {
  const input = await parseHookInput<ClaudePostToolUsePayload | CodexHookPayload>();
  const sessionId = input?.session_id ?? "";
  const touchedPaths = isCodexHookPayload(input)
    ? extractCodexTouchedPaths(input)
    : input?.tool_input?.file_path
    ? [input.tool_input.file_path]
    : [];

  for (const filePath of touchedPaths) {
    recordTouchedPathBreadcrumb({
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
