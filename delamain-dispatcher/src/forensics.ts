export const DEFAULT_TEXT_EXCERPT_BYTES = 4096;

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonObject
  | JsonValue[];

export interface JsonObject {
  [key: string]: JsonValue;
}

export interface DispatchCorrelationIds {
  tick_id: string | null;
  dispatch_id: string | null;
  merge_attempt_id: string | null;
  repo_attempt_id: string | null;
}

export interface DispatchRelevantShas {
  base_commit: string | null;
  current_head: string | null;
  worktree_commit: string | null;
  integrated_commit: string | null;
  remote_head_before: string | null;
  remote_head_after: string | null;
  theirs_commit: string | null;
  pre_integration_head: string | null;
}

export interface DispatchCommandResult {
  exit_code: number | null;
  stdout_excerpt: string | null;
  stderr_excerpt: string | null;
  raw_command: string | null;
}

export interface DispatchIncidentContext {
  phase: string;
  cause: string;
  retryable: boolean;
  recommended_next_actor: "operator" | "automation" | "none";
  repo_role: string | null;
  repo_path: string | null;
  command_label: string | null;
  command_result: DispatchCommandResult | null;
  relevant_shas: DispatchRelevantShas;
  touched_paths: string[];
  moved_paths: string[];
  overlapping_paths: string[];
  dirty_paths: string[];
  unmerged_paths: string[];
  preserved_paths: string[];
  recovery_hint: string | null;
  canonical_ref: string | null;
  correlation_ids: DispatchCorrelationIds;
}

export interface DispatchPhaseTelemetry {
  event_type: string;
  phase?: string | null;
  cause?: string | null;
  retryable?: boolean | null;
  recommended_next_actor?: "operator" | "automation" | "none" | null;
  command_label?: string | null;
  command_result?: DispatchCommandResult | null;
  relevant_shas?: Partial<DispatchRelevantShas>;
  incident_kind?: string | null;
  worktree_commit?: string | null;
  integrated_commit?: string | null;
  merge_outcome?: string | null;
  error?: string | null;
  incident_context?: DispatchIncidentContext | null;
  attributes?: JsonObject | null;
  merge_attempt_id?: string | null;
  repo_attempt_id?: string | null;
}

export function sanitizeJsonObject(value: unknown): JsonObject | null {
  const normalized = sanitizeJsonValue(value);
  return isJsonObject(normalized) ? normalized : null;
}

export function sanitizeJsonValue(value: unknown): JsonValue | null {
  if (value === null) {
    return null;
  }

  if (typeof value === "string") {
    return sanitizeTextExcerpt(value);
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "boolean") {
    return value;
  }

  if (Array.isArray(value)) {
    return value
      .map((entry) => sanitizeJsonValue(entry))
      .filter((entry): entry is JsonValue => entry !== undefined);
  }

  if (!value || typeof value !== "object") {
    return null;
  }

  const object: JsonObject = {};
  for (const [key, entry] of Object.entries(value)) {
    const normalized = sanitizeJsonValue(entry);
    if (normalized === undefined) {
      continue;
    }
    object[key] = normalized;
  }

  return object;
}

export function buildCommandResult(input: {
  exitCode?: number | null;
  stdout?: string | null;
  stderr?: string | null;
  rawCommand?: string | null;
}): DispatchCommandResult | null {
  const commandResult: DispatchCommandResult = {
    exit_code: typeof input.exitCode === "number" ? input.exitCode : null,
    stdout_excerpt: sanitizeOptionalText(input.stdout ?? null),
    stderr_excerpt: sanitizeOptionalText(input.stderr ?? null),
    raw_command: sanitizeOptionalText(input.rawCommand ?? null),
  };

  return commandResult.exit_code !== null
      || commandResult.stdout_excerpt !== null
      || commandResult.stderr_excerpt !== null
      || commandResult.raw_command !== null
    ? commandResult
    : null;
}

export function buildIncidentContext(
  input: Partial<DispatchIncidentContext>
    & Pick<DispatchIncidentContext, "phase" | "cause" | "retryable" | "recommended_next_actor">,
): DispatchIncidentContext {
  return {
    phase: input.phase,
    cause: input.cause,
    retryable: input.retryable,
    recommended_next_actor: normalizeRecommendedNextActor(input.recommended_next_actor),
    repo_role: asString(input.repo_role),
    repo_path: asString(input.repo_path),
    command_label: asString(input.command_label),
    command_result: normalizeCommandResult(input.command_result),
    relevant_shas: normalizeRelevantShas(input.relevant_shas),
    touched_paths: stringArray(input.touched_paths),
    moved_paths: stringArray(input.moved_paths),
    overlapping_paths: stringArray(input.overlapping_paths),
    dirty_paths: stringArray(input.dirty_paths),
    unmerged_paths: stringArray(input.unmerged_paths),
    preserved_paths: stringArray(input.preserved_paths),
    recovery_hint: asString(input.recovery_hint),
    canonical_ref: asString(input.canonical_ref),
    correlation_ids: normalizeCorrelationIds(input.correlation_ids),
  };
}

export function normalizeIncidentContext(value: unknown): DispatchIncidentContext | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const input = value as Partial<DispatchIncidentContext>;
  if (!asString(input.phase) || !asString(input.cause)) {
    return null;
  }

  return buildIncidentContext({
    phase: input.phase!,
    cause: input.cause!,
    retryable: input.retryable === true,
    recommended_next_actor: normalizeRecommendedNextActor(input.recommended_next_actor),
    repo_role: input.repo_role ?? null,
    repo_path: input.repo_path ?? null,
    command_label: input.command_label ?? null,
    command_result: input.command_result ?? null,
    relevant_shas: normalizeRelevantShas(input.relevant_shas),
    touched_paths: input.touched_paths ?? [],
    moved_paths: input.moved_paths ?? [],
    overlapping_paths: input.overlapping_paths ?? [],
    dirty_paths: input.dirty_paths ?? [],
    unmerged_paths: input.unmerged_paths ?? [],
    preserved_paths: input.preserved_paths ?? [],
    recovery_hint: input.recovery_hint ?? null,
    canonical_ref: input.canonical_ref ?? null,
    correlation_ids: normalizeCorrelationIds(input.correlation_ids),
  });
}

export function normalizeCommandResult(value: unknown): DispatchCommandResult | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const input = value as Partial<DispatchCommandResult>;
  return buildCommandResult({
    exitCode: typeof input.exit_code === "number" ? input.exit_code : null,
    stdout: input.stdout_excerpt ?? null,
    stderr: input.stderr_excerpt ?? null,
    rawCommand: input.raw_command ?? null,
  });
}

export function normalizeCorrelationIds(value: unknown): DispatchCorrelationIds {
  const input = value && typeof value === "object" && !Array.isArray(value)
    ? value as Partial<DispatchCorrelationIds>
    : {};

  return {
    tick_id: asString(input.tick_id),
    dispatch_id: asString(input.dispatch_id),
    merge_attempt_id: asString(input.merge_attempt_id),
    repo_attempt_id: asString(input.repo_attempt_id),
  };
}

export function normalizeRelevantShas(value: unknown): DispatchRelevantShas {
  const input = value && typeof value === "object" && !Array.isArray(value)
    ? value as Partial<DispatchRelevantShas>
    : {};

  return {
    base_commit: asString(input.base_commit),
    current_head: asString(input.current_head),
    worktree_commit: asString(input.worktree_commit),
    integrated_commit: asString(input.integrated_commit),
    remote_head_before: asString(input.remote_head_before),
    remote_head_after: asString(input.remote_head_after),
    theirs_commit: asString(input.theirs_commit),
    pre_integration_head: asString(input.pre_integration_head),
  };
}

export function sanitizeTextExcerpt(
  value: string,
  maxBytes = DEFAULT_TEXT_EXCERPT_BYTES,
): string {
  return truncateUtf8(redactSensitiveText(value), maxBytes);
}

function sanitizeOptionalText(value: string | null): string | null {
  return value && value.length > 0 ? sanitizeTextExcerpt(value) : null;
}

function normalizeRecommendedNextActor(
  value: unknown,
): DispatchIncidentContext["recommended_next_actor"] {
  return value === "automation" || value === "none" ? value : "operator";
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((entry) => asString(entry)).filter((entry): entry is string => entry !== null)
    : [];
}

function truncateUtf8(value: string, maxBytes: number): string {
  if (utf8ByteLength(value) <= maxBytes) {
    return value;
  }

  let low = 0;
  let high = value.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    const candidate = `${value.slice(0, mid)}...`;
    if (utf8ByteLength(candidate) <= maxBytes) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }

  return `${value.slice(0, low)}...`;
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

function redactSensitiveText(value: string): string {
  return value
    .replace(/\bsk-[A-Za-z0-9_-]+\b/g, "[REDACTED_OPENAI_KEY]")
    .replace(/\bsk-proj-[A-Za-z0-9_-]+\b/g, "[REDACTED_OPENAI_PROJECT_KEY]")
    .replace(/\b(?:anthropic|claude)-api-key\s*[:=]\s*\S+/gi, "[REDACTED_ANTHROPIC_SECRET]")
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, "[REDACTED_AWS_KEY]");
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? sanitizeTextExcerpt(value) : null;
}

function isJsonObject(value: JsonValue | null): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
