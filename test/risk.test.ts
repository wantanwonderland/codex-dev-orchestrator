import { describe, expect, it } from "vitest";
import { classifyRisk } from "../src/risk.js";

describe("classifyRisk", () => {
  it("requires a task review for every locked high-risk trigger", () => {
    const result = classifyRisk([
      "migration",
      "tenant RBAC",
      "privacy",
      "billing",
      "queue concurrency",
      "public API",
      "Stripe integration",
      "customer-visible UI",
    ]);

    expect(result.level).toBe("high");
    expect(result.requiresTaskReview).toBe(true);
    expect(result.triggers).toHaveLength(8);
  });

  it("keeps an ordinary internal refactor at normal risk", () => {
    expect(classifyRisk(["rename private helper"])).toEqual({
      level: "normal",
      requiresTaskReview: false,
      triggers: [],
    });
  });
});
