import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { StateStore } from "../src/state-store.js";
import { recordAgentFailure, recordAgentSuccess } from "../src/workflow.js";

describe("StateStore", () => {
  it("persists atomic state and append-only events", async () => {
    const root = await mkdtemp(join(tmpdir(), "cdo-state-"));
    const store = new StateStore(root, "wf-1");
    const state = await store.create({ objective: "ship feature", tier: "normal", mode: "human_gated" });
    await store.transition(state, "awaiting_plan_approval", "plan.created");

    const loaded = await store.load();
    expect(loaded.status).toBe("awaiting_plan_approval");
    const events = (await readFile(join(root, ".codex/workflow-runtime/wf-1/events.jsonl"), "utf8")).trim().split("\n");
    expect(events).toHaveLength(2);
  });

  it("refuses implementation before explicit plan approval", async () => {
    const root = await mkdtemp(join(tmpdir(), "cdo-state-"));
    const store = new StateStore(root, "wf-2");
    const state = await store.create({ objective: "ship feature", tier: "normal", mode: "human_gated" });
    await expect(store.transition(state, "executing", "execution.started")).rejects.toThrow(/plan approval/);
  });

  it("allows at most two remediation rounds", async () => {
    const root = await mkdtemp(join(tmpdir(), "cdo-state-"));
    const store = new StateStore(root, "wf-3");
    let state = await store.create({ objective: "ship feature", tier: "normal", mode: "human_gated" });
    state = await store.save({ ...state, status: "reviewing", planApproval: { approvedBy: "human", approvedAt: new Date().toISOString(), planSha256: "a".repeat(64) } }, "test.setup");
    state = await store.transition(state, "remediating", "round.one");
    expect(state.remediationRounds).toBe(1);
    state = await store.transition(state, "reviewing", "review.one");
    state = await store.transition(state, "remediating", "round.two");
    expect(state.remediationRounds).toBe(2);
    state = await store.transition(state, "reviewing", "review.two");
    await expect(store.transition(state, "remediating", "round.three")).rejects.toThrow(/maximum of 2/);
  });

  it("allows one fresh-session retry per operation and then blocks", async () => {
    const root = await mkdtemp(join(tmpdir(), "cdo-state-"));
    const store = new StateStore(root, "wf-4");
    await store.create({ objective: "ship feature", tier: "normal", mode: "human_gated" });
    expect((await recordAgentFailure(root, "wf-4", "task-1-review", "malformed output")).retry).toBe(true);
    const second = await recordAgentFailure(root, "wf-4", "task-1-review", "timeout");
    expect(second.retry).toBe(false);
    expect(second.state.status).toBe("blocked");
    await recordAgentSuccess(root, "wf-4", "task-1-review");
    expect((await store.load()).operationFailures["task-1-review"]).toBeUndefined();
  });
});
