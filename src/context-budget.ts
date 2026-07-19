export const CONTEXT_BUDGETS = {
  routing_prompt: 2_000,
  worker_handoff: 8_000,
  executor_report: 3_000,
  review: 5_000,
} as const;

export type ContextKind = keyof typeof CONTEXT_BUDGETS;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function enforceContextBudget(kind: ContextKind, text: string): number {
  const estimated = estimateTokens(text);
  const budget = CONTEXT_BUDGETS[kind];
  if (estimated > budget) {
    throw new Error(`${kind} is approximately ${estimated} tokens and exceeds the ${budget} token budget; return to planning and split the task`);
  }
  return estimated;
}
