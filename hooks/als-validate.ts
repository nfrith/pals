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
  type CodexHookPayload,
} from "./codex-hook-adapter.ts";
import {
  derivePluginRootFromEntrypoint,
  parseHookInput,
} from "./hook-adapter.ts";
import { writeClaudeAdditionalContext } from "./claude-hook-adapter.ts";

interface ClaudePostToolUsePayload {
  session_id?: string;
  tool_input?: {
    file_path?: string;
  };
}

try {
  const input = await parseHookInput<ClaudePostToolUsePayload | CodexHookPayload>();
  const pluginRoot = derivePluginRootFromEntrypoint(import.meta.url);
  const isCodex = isCodexHookPayload(input);
  const sessionId = input?.session_id ?? "";
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
      session_id: sessionId,
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
      session_id: sessionId,
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
  const contexts = results
    .map((result) => result.additional_context)
    .filter((value): value is string => typeof value === "string" && value.length > 0);

  if (contexts.length > 0) {
    emitAdvisory(contexts.join("\n\n"), isCodex);
  }
}

function emitValidationResult(result: PostEditValidationResult, isCodex: boolean): void {
  if (result.additional_context) {
    emitAdvisory(result.additional_context, isCodex);
  }
}

function emitAdvisory(additionalContext: string, isCodex: boolean): void {
  if (isCodex) {
    writeCodexPostToolUseAdditionalContext(additionalContext);
    return;
  }

  writeClaudeAdditionalContext("PostToolUse", additionalContext);
}
