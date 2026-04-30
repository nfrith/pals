export interface DispatchLimitsInput {
  maxTurns?: number;
  maxBudgetUsd?: number;
}

export interface ResolvedDispatchLimits {
  maxTurns: number;
  maxBudgetUsd: number;
}

export const DEFAULT_MAX_TURNS = 50;
export const DEFAULT_MAX_BUDGET_USD = 10.0;

export function resolveDispatchLimits(limits?: DispatchLimitsInput): ResolvedDispatchLimits {
  return {
    maxTurns: limits?.maxTurns ?? DEFAULT_MAX_TURNS,
    maxBudgetUsd: limits?.maxBudgetUsd ?? DEFAULT_MAX_BUDGET_USD,
  };
}
