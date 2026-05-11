#!/usr/bin/env bun

import { evaluatePostEditValidation } from "../alsc/compiler/src/hook-runtime.ts";
import {
  derivePluginRootFromEntrypoint,
  parseClaudeHookInput,
  writeClaudeAdditionalContext,
  writeClaudeBlock,
} from "./claude-hook-adapter.ts";

interface PostToolUsePayload {
  tool_input?: {
    file_path?: string;
  };
}

try {
  const input = await parseClaudeHookInput<PostToolUsePayload>();
  const result = evaluatePostEditValidation({
    context: {
      plugin_root: derivePluginRootFromEntrypoint(import.meta.url),
    },
    demo_mode: process.env.ALS_DEMO_MODE === "1",
    file_path: input?.tool_input?.file_path ?? "",
  });

  if (result.status === "warn" && result.additional_context) {
    writeClaudeAdditionalContext("PostToolUse", result.additional_context);
  }

  if (result.status === "fail" && result.reason) {
    writeClaudeBlock("PostToolUse", result.reason, result.additional_context);
    process.exit(2);
  }
} catch {
  process.exit(0);
}
