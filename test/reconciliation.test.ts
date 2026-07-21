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
  await writeFile(join(workflow, "index.md"), "Build a backend feature");
  await writeFile(join(workflow, "plan.md"), "Build a backend feature");
  await writeFile(join(workflow, "tasks/task-1.md"), "task");
  const store = new StateStore(root, "wf-1");
  let state = await store.create({ objective: "ship", tier: "normal", mode: "local_auto" });
  state = await store.save({
    ...state,
    status,
    planApproval: { approvedBy: "human", approvedAt: now, planSha256: "a".repeat(64) },
  }, "test.setup");
  return { root, state };
}

describe("assignment reconciliation", () => {
  it("rejects an agent routing path as writer-lease identity", async () => {
    const { root } = await setup("executing");
    await expect(acquireLease(root, "wf-1", "executor", "/root/executor-task")).rejects.toThrow(/parent session ID/);
  });

  it("routes a completed executor handoff to review", async () => {
    const { root } = await setup("executing");
    const assignment = await createAgentAssignment(root, "wf-1", {
      operationKey: "task-1",
      role: "executor",
      stage: "implementation",
      inputPath: "tasks/task-1.md",
      outputPath: "reports/task-1.md",
      expectedKind: "executor-report",
    });
    const assignments = new AssignmentStore(root, "wf-1");
    await assignments.bindStarted("executor", "agent-1");
    await acquireLease(root, "wf-1", "executor", "writer-1");
    await releaseLease(root, "wf-1", "writer-1");
    await assignments.bindStopped("executor", { agentId: "agent-1" });
    await writeFile(join(root, ".codex/workflows/wf-1/reports/task-1.md"), renderArtifact({
      schema: "cdo/v1",
      kind: "executor-report",
      workflow_id: "wf-1",
      status: "complete",
      created_at: now,
      updated_at: now,
      assignment_id: assignment.id,
      operation_key: assignment.operationKey,
      agent_role: "executor",
    }, "# Complete"));

    const result = await reconcileAgentAssignment(root, "wf-1", assignment.id);
    expect(result.nextAction).toBe("assign_reviewer");
    expect(result.state.status).toBe("reviewing");
    expect(result.assignment.status).toBe("reconciled");
  });

  it("retries one malformed handoff and blocks the second attempt", async () => {
    const { root } = await setup("reviewing");
    const first = await createAgentAssignment(root, "wf-1", {
      operationKey: "phase-review",
      role: "reviewer",
      stage: "phase_review",
      inputPath: "plan.md",
      outputPath: "reviews/phase-final.md",
      expectedKind: "review",
      sourceCommit: "base-commit",
    });
    const assignments = new AssignmentStore(root, "wf-1");
    await assignments.bindStarted("reviewer", "agent-1");
    await assignments.bindStopped("reviewer", { agentId: "agent-1" });
    expect((await reconcileAgentAssignment(root, "wf-1", first.id)).nextAction).toBe("retry_reviewer");

    const second = await createAgentAssignment(root, "wf-1", {
      operationKey: "phase-review",
      role: "reviewer",
      stage: "phase_review",
      inputPath: "plan.md",
      outputPath: "reviews/phase-final.md",
      expectedKind: "review",
      sourceCommit: "base-commit",
    });
    await assignments.bindStarted("reviewer", "agent-2");
    await assignments.bindStopped("reviewer", { agentId: "agent-2" });
    const result = await reconcileAgentAssignment(root, "wf-1", second.id);
    expect(result.nextAction).toBe("human_reconciliation");
    expect(result.state.status).toBe("blocked");
  });

  it("returns the persisted routing result when reconciliation is repeated", async () => {
    const { root } = await setup("executing");
    const assignment = await createAgentAssignment(root, "wf-1", {
      operationKey: "idempotent-task",
      role: "executor",
      stage: "implementation",
      inputPath: "tasks/task-1.md",
      outputPath: "reports/task-1.md",
      expectedKind: "executor-report",
    });
    const assignments = new AssignmentStore(root, "wf-1");
    await assignments.bindStartedById(assignment.id, "agent-1");
    await acquireLease(root, "wf-1", "executor", "writer-1");
    await releaseLease(root, "wf-1", "writer-1");
    await assignments.bindStoppedById(assignment.id, "agent-1");
    await writeFile(join(root, ".codex/workflows/wf-1/reports/task-1.md"), renderArtifact({
      schema: "cdo/v1", kind: "executor-report", workflow_id: "wf-1", status: "complete",
      created_at: now, updated_at: now, assignment_id: assignment.id,
      operation_key: assignment.operationKey, agent_role: "executor",
    }, "# Complete"));

    const first = await reconcileAgentAssignment(root, "wf-1", assignment.id);
    const second = await reconcileAgentAssignment(root, "wf-1", assignment.id);
    expect(second.nextAction).toBe(first.nextAction);
    expect(second.assignment).toEqual(first.assignment);
    expect(second.state.status).toBe("reviewing");
  });

  it("resumes from a persisted reconciliation checkpoint after interruption", async () => {
    const { root } = await setup("executing");
    const assignment = await createAgentAssignment(root, "wf-1", {
      operationKey: "interrupted-route", role: "executor", stage: "implementation",
      inputPath: "tasks/task-1.md", outputPath: "reports/task-1.md", expectedKind: "executor-report",
    });
    const assignments = new AssignmentStore(root, "wf-1");
    await assignments.bindStartedById(assignment.id, "agent-1");
    await acquireLease(root, "wf-1", "executor", "writer-1");
    await releaseLease(root, "wf-1", "writer-1");
    await assignments.bindStoppedById(assignment.id, "agent-1");
    await assignments.beginReconciliation(assignment.id, {
      artifactStatus: "complete", nextAction: "assign_reviewer", targetWorkflowStatus: "reviewing",
    });

    const resumed = await reconcileAgentAssignment(root, "wf-1", assignment.id);
    expect(resumed.assignment.status).toBe("reconciled");
    expect(resumed.nextAction).toBe("assign_reviewer");
    expect(resumed.state.status).toBe("reviewing");
  });

  it("terminalizes a crashed assignment so a fresh retry can be created", async () => {
    const { root } = await setup("executing");
    const crashed = await createAgentAssignment(root, "wf-1", {
      operationKey: "crashed-task", role: "executor", stage: "implementation",
      inputPath: "tasks/task-1.md", outputPath: "reports/task-1.md", expectedKind: "executor-report",
    });
    await recordAgentFailure(root, "wf-1", crashed.operationKey, "agent timed out");
    expect((await new AssignmentStore(root, "wf-1").get(crashed.id)).status).toBe("failed");
    const retry = await createAgentAssignment(root, "wf-1", {
      operationKey: "crashed-task", role: "executor", stage: "implementation",
      inputPath: "tasks/task-1.md", outputPath: "reports/task-1-retry.md", expectedKind: "executor-report",
    });
    expect(retry.attempt).toBe(2);
  });

  it("blocks executor reconciliation when no writer lease was ever acquired", async () => {
    const { root } = await setup("executing");
    const assignment = await createAgentAssignment(root, "wf-1", {
      operationKey: "unleased-task", role: "executor", stage: "implementation",
      inputPath: "tasks/task-1.md", outputPath: "reports/unleased.md", expectedKind: "executor-report",
    });
    const assignments = new AssignmentStore(root, "wf-1");
    await assignments.bindStartedById(assignment.id, "agent-1");
    await assignments.bindStoppedById(assignment.id, "agent-1");
    const result = await reconcileAgentAssignment(root, "wf-1", assignment.id);
    expect(result.nextAction).toBe("human_reconciliation");
    expect(result.assignment.error).toContain("no evidence");
    expect(result.state.status).toBe("blocked");
  });

  it("escalates a failed review after two remediation rounds without scheduling another fixer", async () => {
    const { root } = await setup("reviewing");
    const stateStore = new StateStore(root, "wf-1");
    const state = await stateStore.load();
    await stateStore.save({ ...state, remediationRounds: 2 }, "test.remediation_exhausted");
    const assignment = await createAgentAssignment(root, "wf-1", {
      operationKey: "review-after-remediation",
      role: "reviewer",
      stage: "task_review",
      inputPath: "reports/task-1.md",
      outputPath: "reviews/task-1.md",
      expectedKind: "review",
      sourceCommit: "base-commit",
    });
    const assignments = new AssignmentStore(root, "wf-1");
    await assignments.bindStartedById(assignment.id, "reviewer-1");
    await assignments.bindStoppedById(assignment.id, "reviewer-1");
    await writeFile(join(root, ".codex/workflows/wf-1/reviews/task-1.md"), renderArtifact({
      schema: "cdo/v1", kind: "review", workflow_id: "wf-1", status: "failed",
      created_at: now, updated_at: now, assignment_id: assignment.id,
      operation_key: assignment.operationKey, agent_role: "reviewer", source_commit: "base-commit",
    }, "# Failed review"));

    const result = await reconcileAgentAssignment(root, "wf-1", assignment.id);
    expect(result.nextAction).toBe("human_reconciliation");
    expect(result.assignment.status).toBe("blocked");
    expect(result.state.status).toBe("blocked");
    expect(result.state.operationFailures).toEqual({});
  });
});
