#!/usr/bin/env bun

import { evaluateStopGateValidation } from "../alsc/compiler/src/hook-runtime.ts";
import {
  isCodexHookPayload,
  writeCodexStopBlock,
  type CodexHookPayload,
} from "./codex-hook-adapter.ts";
import {
  derivePluginRootFromEntrypoint,
  parseHookInput,
} from "./hook-adapter.ts";
import {
  writeClaudeAdditionalContext,
  writeClaudeBlock,
} from "./claude-hook-adapter.ts";

interface StopPayload {
  session_id?: string;
}

try {
  const input = await parseHookInput<StopPayload | CodexHookPayload>();
  const isCodex = isCodexHookPayload(input);
  const result = evaluateStopGateValidation({
    context: {
      plugin_root: derivePluginRootFromEntrypoint(import.meta.url),
    },
    session_id: input?.session_id ?? "",
  });

  if (!isCodex && result.status === "warn" && result.additional_context) {
    writeClaudeAdditionalContext("Stop", result.additional_context);
  }

  if (result.status === "fail" && result.reason) {
    if (isCodex) {
      writeCodexStopBlock(result.reason);
      process.exit(0);
    }

    writeClaudeBlock("Stop", result.reason, result.additional_context);
    process.exit(2);
  }
} catch {
  process.exit(0);
}
