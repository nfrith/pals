#!/usr/bin/env bun

import { recordTouchedPathBreadcrumb } from "../alsc/compiler/src/hook-runtime.ts";
import {
  derivePluginRootFromEntrypoint,
  parseClaudeHookInput,
} from "./claude-hook-adapter.ts";

interface PostToolUsePayload {
  session_id?: string;
  tool_input?: {
    file_path?: string;
  };
}

try {
  const input = await parseClaudeHookInput<PostToolUsePayload>();
  recordTouchedPathBreadcrumb({
    context: {
      plugin_root: derivePluginRootFromEntrypoint(import.meta.url),
    },
    file_path: input?.tool_input?.file_path ?? "",
    session_id: input?.session_id ?? "",
  });
} catch {
  process.exit(0);
}
