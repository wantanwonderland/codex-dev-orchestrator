import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderArtifact } from "../src/frontmatter.js";
import { StateStore } from "../src/state-store.js";
import { acquireLease, createAgentAssignment, reconcileAgentAssignment, recordAgentFailure, releaseLease } from "../src/workflow.js";
import { AssignmentStore } from "../src/assignments.js";

const now = "2026-07-21T00:00:00.000Z";

async function setup(status: "executing" | "reviewing") {
  const root = await mkdtemp(join(tmpdir(), "cdo-reconcile-"));
  const workflow = join(root, ".codex/workflows/wf-1");
  await mkdir(join(workflow, "tasks"), { recursive: true });
  await mkdir(join(workflow, "reports"), { recursive: true });
  await mkdir(join(workflow, "reviews"), { recursive: true });
  await writeFile(join(workflow, "index.md"), "Build a feature");
  const store = new StateStore(root, "wf-1");
  let state = await store.create({ objective: "ship", tier: "normal", mode: "autonomous" });
  state = await store.save({ ...state, status, researchComplete: true, decisionsComplete: true, tasks: [{ id: "task-1", title: "Task", path: "tasks/task-1.md", dependsOn: [], risk: "high", reviewRequired: true, customerVisibleUi: false, status: status === "executing" ? "ready" : "reviewing", attempts: 0, consecutiveNoProgress: 0 }] }, "test.setup");
  return { root, state };
}

async function completeExecutor(root: string, status: "complete" | "partial" = "complete") {
  const assignment = await createAgentAssignment(root, "wf-1", { operationKey: "task-1", role: "executor", stage: "implementation", taskId: "task-1", inputPath: "tasks/task-1.md", outputPath: "reports/task-1.md", expectedKind: "executor-report" });
  const assignments = new AssignmentStore(root, "wf-1");
  await assignments.bindStartedById(assignment.id, "agent-1");
  await acquireLease(root, "wf-1", "executor", "writer-1");
  await releaseLease(root, "wf-1", "writer-1");
  await assignments.bindStoppedById(assignment.id, "agent-1");
  await writeFile(join(root, ".codex/workflows/wf-1/reports/task-1.md"), renderArtifact({ schema: "cdo/v2", kind: "executor-report", workflow_id: "wf-1", task: "task-1", status, created_at: now, updated_at: now, assignment_id: assignment.id, operation_key: assignment.operationKey, agent_role: "executor" }, "# Handoff"));
  return { assignment, result: await reconcileAgentAssignment(root, "wf-1", assignment.id) };
}

describe("autonomous assignment reconciliation", () => {
  it("routes a high-risk completed task to independent review", async () => {
    const { root } = await setup("executing");
    const { result } = await completeExecutor(root);
    expect(result).toMatchObject({ nextAction: "assign_task_reviewer", state: { status: "reviewing", tasks: [{ status: "reviewing" }] }, assignment: { status: "reconciled" } });
  });

  it("continues partial work without human approval", async () => {
    const { root } = await setup("executing");
    const { result } = await completeExecutor(root, "partial");
    expect(result).toMatchObject({ nextAction: "continue_executor", state: { status: "executing", tasks: [{ status: "partial" }] }, assignment: { outcome: "continue" } });
  });

  it("diagnoses the third consecutive no-progress partial handoff", async () => {
    const { root } = await setup("executing");
    expect((await completeExecutor(root, "partial")).result.nextAction).toBe("continue_executor");
    expect((await completeExecutor(root, "partial")).result.nextAction).toBe("continue_executor");
    const third = (await completeExecutor(root, "partial")).result;
    expect(third).toMatchObject({ nextAction: "assign_diagnosis", state: { status: "diagnosing", tasks: [{ consecutiveNoProgress: 3 }] } });
  });

  it("routes malformed handoffs to evidence repair without consuming implementation retries", async () => {
    const { root } = await setup("reviewing");
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const assignment = await createAgentAssignment(root, "wf-1", { operationKey: "phase-review", role: "reviewer", stage: "phase_review", inputPath: "reports/task-1.md", outputPath: "reviews/phase-final.md", expectedKind: "review", sourceCommit: "base" });
      const assignments = new AssignmentStore(root, "wf-1");
      await assignments.bindStartedById(assignment.id, `reviewer-${attempt}`);
      await assignments.bindStoppedById(assignment.id, `reviewer-${attempt}`);
      const result = await reconcileAgentAssignment(root, "wf-1", assignment.id);
      expect(result.nextAction).toBe("repair_evidence");
    }
    expect((await new StateStore(root, "wf-1").load()).status).toBe("reviewing");
  });

  it("uses a typed human gate only for missing writer safety evidence", async () => {
    const { root } = await setup("executing");
    const assignment = await createAgentAssignment(root, "wf-1", { operationKey: "unsafe", role: "executor", stage: "implementation", taskId: "task-1", inputPath: "tasks/task-1.md", outputPath: "reports/task-1.md", expectedKind: "executor-report" });
    const assignments = new AssignmentStore(root, "wf-1");
    await assignments.bindStartedById(assignment.id, "agent");
    await assignments.bindStoppedById(assignment.id, "agent");
    const result = await reconcileAgentAssignment(root, "wf-1", assignment.id);
    expect(result).toMatchObject({ nextAction: "request_human", state: { status: "needs_human", humanGate: { kind: "destructive_action" } }, assignment: { status: "needs_human" } });
  });

  it("rejects an agent routing path as writer identity", async () => {
    const { root } = await setup("executing");
    await expect(acquireLease(root, "wf-1", "executor", "/root/task")).rejects.toThrow(/parent session ID/);
  });

  it("terminalizes a crashed assignment so a fresh retry can be assigned", async () => {
    const { root } = await setup("executing");
    const crashed = await createAgentAssignment(root, "wf-1", { operationKey: "crash", role: "executor", stage: "implementation", taskId: "task-1", inputPath: "tasks/task-1.md", outputPath: "reports/a.md", expectedKind: "executor-report" });
    await recordAgentFailure(root, "wf-1", "crash", "timeout");
    expect((await new AssignmentStore(root, "wf-1").get(crashed.id)).status).toBe("failed");
    const retry = await createAgentAssignment(root, "wf-1", { operationKey: "crash", role: "executor", stage: "implementation", taskId: "task-1", inputPath: "tasks/task-1.md", outputPath: "reports/b.md", expectedKind: "executor-report" });
    expect(retry.attempt).toBe(2);
  });
});
