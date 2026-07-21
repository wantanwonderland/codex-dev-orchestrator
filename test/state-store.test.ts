import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { StateStore } from "../src/state-store.js";
import { recordAgentFailure, recordAgentSuccess } from "../src/workflow.js";

describe("StateStore v2", () => {
  it("starts normal work in research and persists append-only events", async () => {
    const root = await mkdtemp(join(tmpdir(), "cdo-state-"));
    const store = new StateStore(root, "wf-1");
    const state = await store.create({ objective: "ship feature", tier: "normal", mode: "autonomous" });
    const next = await store.transition(state, "brainstorming", "research.completed");
    expect(next.status).toBe("brainstorming");
    expect((await readFile(join(root, ".codex/workflow-runtime/wf-1/events.jsonl"), "utf8")).trim().split("\n")).toHaveLength(2);
  });

  it("lets small work plan immediately", async () => {
    const root = await mkdtemp(join(tmpdir(), "cdo-state-"));
    const state = await new StateStore(root, "wf-small").create({ objective: "small fix", tier: "small", mode: "autonomous" });
    expect(state).toMatchObject({ status: "planning", researchComplete: true, decisionsComplete: true });
  });

  it("routes the third repeated operational failure to diagnosis instead of a human", async () => {
    const root = await mkdtemp(join(tmpdir(), "cdo-state-"));
    const store = new StateStore(root, "wf-2");
    await store.create({ objective: "ship feature", tier: "normal", mode: "autonomous" });
    expect((await recordAgentFailure(root, "wf-2", "task", "same failure")).retry).toBe(true);
    expect((await recordAgentFailure(root, "wf-2", "task", "same failure")).retry).toBe(true);
    const third = await recordAgentFailure(root, "wf-2", "task", "same failure");
    expect(third).toMatchObject({ retry: false, diagnose: true, state: { status: "diagnosing" } });
    await recordAgentSuccess(root, "wf-2", "task");
    expect((await store.load()).operationFailures.task).toBeUndefined();
  });

  it("does not impose a fixed remediation-round ceiling", async () => {
    const root = await mkdtemp(join(tmpdir(), "cdo-state-"));
    const store = new StateStore(root, "wf-3");
    let state = await store.create({ objective: "ship", tier: "small", mode: "autonomous" });
    state = await store.transition(state, "executing", "plan.ready");
    state = await store.transition(state, "reviewing", "review.started");
    for (let index = 0; index < 4; index += 1) {
      state = await store.transition(state, "remediating", `fix.${index}`);
      state = await store.transition(state, "reviewing", `review.${index}`);
    }
    expect(state.status).toBe("reviewing");
  });
});
