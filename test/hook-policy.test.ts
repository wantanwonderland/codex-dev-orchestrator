import { describe, expect, it } from "vitest";
import { evaluateToolUse } from "../src/hook-policy.js";

describe("hook policy", () => {
  it("allows ordinary source writes when no CDO workflow governs the repository", () => {
    const decision = evaluateToolUse({ tool_name: "apply_patch", session_id: "interactive-session", tool_input: {} });
    expect(decision.allow).toBe(true);
  });

  it("blocks source writes when the session does not own the writer lease", () => {
    const decision = evaluateToolUse(
      { tool_name: "apply_patch", session_id: "reviewer-session", tool_input: {} },
      { active: true, lease: { role: "executor", sessionId: "executor-session", acquiredAt: "2026-07-20T00:00:00.000Z" } },
    );
    expect(decision.allow).toBe(false);
  });

  it("allows the active writer and flags direct secret access", () => {
    expect(
      evaluateToolUse(
        { tool_name: "apply_patch", session_id: "executor-session", tool_input: {} },
        { active: true, lease: { role: "executor", sessionId: "executor-session", acquiredAt: "2026-07-20T00:00:00.000Z" } },
      ).allow,
    ).toBe(true);
    expect(
      evaluateToolUse(
        { tool_name: "Bash", session_id: "executor-session", tool_input: { cmd: "ls ~/.codex/workflow-secrets" } },
        { active: true, lease: { role: "executor", sessionId: "executor-session", acquiredAt: "2026-07-20T00:00:00.000Z" } },
      ).allow,
    ).toBe(false);
  });
});
