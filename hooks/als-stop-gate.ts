#!/usr/bin/env bun

import { evaluateStopGateValidation } from "../alsc/compiler/src/hook-runtime.ts";
import {
  derivePluginRootFromEntrypoint,
  parseClaudeHookInput,
  writeClaudeAdditionalContext,
  writeClaudeBlock,
} from "./claude-hook-adapter.ts";

interface StopPayload {
  session_id?: string;
}

try {
  const input = await parseClaudeHookInput<StopPayload>();
  const result = evaluateStopGateValidation({
    context: {
      plugin_root: derivePluginRootFromEntrypoint(import.meta.url),
    },
    demo_mode: process.env.ALS_DEMO_MODE === "1",
    session_id: input?.session_id ?? "",
  });

  if (result.status === "warn" && result.additional_context) {
    writeClaudeAdditionalContext("Stop", result.additional_context);
  }

  if (result.status === "fail" && result.reason) {
    writeClaudeBlock("Stop", result.reason, result.additional_context);
    process.exit(2);
  }
} catch {
  process.exit(0);
}
