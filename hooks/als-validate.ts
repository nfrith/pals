#!/usr/bin/env bun

import {
  evaluatePostEditValidation,
  resolveTouchedPathTarget,
  type PostEditValidationResult,
} from "../alsc/compiler/src/hook-runtime.ts";
import {
  extractCodexTouchedPaths,
  isCodexHookPayload,
  writeCodexPostToolUseAdditionalContext,
  writeCodexPostToolUseBlock,
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

interface ClaudePostToolUsePayload {
  tool_input?: {
    file_path?: string;
  };
}

try {
  const input = await parseHookInput<ClaudePostToolUsePayload | CodexHookPayload>();
  const pluginRoot = derivePluginRootFromEntrypoint(import.meta.url);
  const isCodex = isCodexHookPayload(input);
  const touchedPaths = isCodex
    ? extractCodexTouchedPaths(input)
    : input?.tool_input?.file_path
    ? [input.tool_input.file_path]
    : [];
  const validationPaths = dedupeValidationPaths(touchedPaths);

  if (validationPaths.length === 0) {
    process.exit(0);
  }

  if (validationPaths.length === 1) {
    const result = evaluatePostEditValidation({
      context: {
        plugin_root: pluginRoot,
      },
      file_path: validationPaths[0],
    });
    emitValidationResult(result, isCodex);
    process.exit(0);
  }

  const results = validationPaths.map((filePath) =>
    evaluatePostEditValidation({
      context: {
        plugin_root: pluginRoot,
      },
      file_path: filePath,
    })
  );
  emitAggregateValidationResult(results, isCodex);
} catch {
  process.exit(0);
}

function dedupeValidationPaths(filePaths: string[]): string[] {
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

function emitAggregateValidationResult(results: PostEditValidationResult[], isCodex: boolean): void {
  const failures = results.filter((result) => result.status === "fail" && result.reason);
  const contexts = results
    .map((result) => result.additional_context)
    .filter((value): value is string => typeof value === "string" && value.length > 0);

  if (failures.length > 0) {
    const reason = failures.length === 1
      ? failures[0].reason
      : `ALS validation failed for ${failures.length} touched module(s). STOP: fix all errors before making any more edits.`;
    emitBlock(reason, contexts.join("\n\n") || null, isCodex);
    return;
  }

  const warnings = results.filter((result) => result.status === "warn");
  if (warnings.length > 0) {
    emitWarn(contexts.join("\n\n") || null, isCodex);
  }
}

function emitValidationResult(result: PostEditValidationResult, isCodex: boolean): void {
  if (result.status === "warn" && result.additional_context) {
    emitWarn(result.additional_context, isCodex);
  }

  if (result.status === "fail" && result.reason) {
    emitBlock(result.reason, result.additional_context, isCodex);
  }
}

function emitWarn(additionalContext: string | null, isCodex: boolean): void {
  if (!additionalContext) {
    return;
  }

  if (isCodex) {
    writeCodexPostToolUseAdditionalContext(additionalContext);
    return;
  }

  writeClaudeAdditionalContext("PostToolUse", additionalContext);
}

function emitBlock(reason: string, additionalContext: string | null, isCodex: boolean): void {
  if (isCodex) {
    writeCodexPostToolUseBlock(reason, additionalContext);
    return;
  }

  writeClaudeBlock("PostToolUse", reason, additionalContext);
  process.exit(2);
}
