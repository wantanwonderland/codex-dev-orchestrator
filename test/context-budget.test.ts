import { describe, expect, it } from "vitest";
import { enforceContextBudget } from "../src/context-budget.js";

describe("context budgets", () => {
  it("rejects oversized handoffs instead of silently truncating them", () => {
    expect(() => enforceContextBudget("worker_handoff", "word ".repeat(9000))).toThrow(/8000 token budget/);
  });

  it("accepts a concise routing prompt", () => {
    expect(enforceContextBudget("routing_prompt", "read task file and report evidence")).toBeGreaterThan(0);
  });
});
