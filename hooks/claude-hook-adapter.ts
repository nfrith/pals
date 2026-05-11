export type ClaudeHookEventName = "PostToolUse" | "Stop";

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
