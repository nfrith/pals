export type LanguageUpgradeTelemetryEventType =
  | "hop_started"
  | "hop_completed"
  | "step_started"
  | "step_completed"
  | "step_failed"
  | "step_skipped"
  | "recovery_triggered"
  | "operator_prompt_paused"
  | "operator_prompt_resumed";

export interface LanguageUpgradeTelemetryEvent {
  type: LanguageUpgradeTelemetryEventType;
  at: string;
  hop_id: string;
  step_id: string | null;
  message: string | null;
  error_code: string | null;
}

export function createTelemetryEvent(
  type: LanguageUpgradeTelemetryEventType,
  input: {
    hop_id: string;
    step_id?: string | null;
    message?: string | null;
    error_code?: string | null;
    at?: string;
  },
): LanguageUpgradeTelemetryEvent {
  return {
    type,
    at: input.at ?? new Date().toISOString(),
    hop_id: input.hop_id,
    step_id: input.step_id ?? null,
    message: input.message ?? null,
    error_code: input.error_code ?? null,
  };
}
