import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { acquireWriterLease, releaseWriterLease } from "./lease.js";
import { StateStore } from "./state-store.js";
import { WriterRoleSchema, WorkflowStatusSchema } from "./types.js";
import { assessCompletionGate } from "./gates.js";
import { AssignmentStore, type CreateAssignmentInput } from "./assignments.js";
import { run } from "./process.js";
import type { AgentAssignment, ArtifactFrontmatter, WorkflowState, WorkflowStatus } from "./types.js";

export async function acquireLease(projectRoot: string, workflowId: string, role: string, sessionId: string) {
  const store = new StateStore(projectRoot, workflowId);
  const state = await store.load();
  const writerRole = WriterRoleSchema.parse(role);
  if (sessionId.startsWith("/")) {
    throw new Error("Writer lease requires the Codex parent session ID from SubagentStart, not an agent routing path");
  }
  const writerLease = acquireWriterLease(state.writerLease, writerRole, sessionId);
  const next = await store.save({ ...state, writerLease }, "writer.acquired", { role, sessionId });
  try {
    await new AssignmentStore(projectRoot, workflowId).recordWriterLease(writerRole, sessionId);
    return next;
  } catch (error) {
    await store.save({ ...next, writerLease: undefined }, "writer.acquisition_rolled_back", { role, sessionId });
    throw error;
  }
}

export async function releaseLease(projectRoot: string, workflowId: string, sessionId: string) {
  const store = new StateStore(projectRoot, workflowId);
  const state = await store.load();
  const writerLease = releaseWriterLease(state.writerLease, sessionId);
  return store.save({ ...state, writerLease }, "writer.released", { sessionId });
}

export async function transitionWorkflow(projectRoot: string, workflowId: string, status: string) {
  const store = new StateStore(projectRoot, workflowId);
  const state = await store.load();
  const parsedStatus = WorkflowStatusSchema.parse(status);
  if (parsedStatus === "executing" && state.planApproval) {
    const planPath = join(projectRoot, ".codex", "workflows", workflowId, state.tier === "small" ? "tasks/task-1.md" : "plan.md");
    const currentHash = createHash("sha256").update(await readFile(planPath)).digest("hex");
    if (currentHash !== state.planApproval.planSha256) {
      throw new Error("The persisted plan changed after approval; obtain a new explicit approval");
    }
  }
  if (parsedStatus === "complete") {
    const gate = await assessCompletionGate(projectRoot, workflowId);
    if (!gate.ready) throw new Error(`Completion gate is blocked: ${gate.missing.join(", ")}`);
  }
  return store.transition(state, parsedStatus, `workflow.${status}`);
}

export async function statusSummary(projectRoot: string, workflowId: string) {
  const state = await new StateStore(projectRoot, workflowId).load();
  const indexPath = join(projectRoot, ".codex", "workflows", workflowId, "index.md");
  await readFile(indexPath, "utf8");
  const assignments = (await new AssignmentStore(projectRoot, workflowId).load()).assignments;
  const activeAssignments = assignments.filter((assignment) => ["queued", "running", "stopped", "reconciling"].includes(assignment.status));
  const lastAssignment = assignments.at(-1);
  return {
    ...state,
    coordination: {
      activeAssignments,
      lastAssignment,
      nextAction: nextAction(state, activeAssignments, lastAssignment),
      blockers: state.status === "blocked" ? [lastAssignment?.error ?? "Workflow requires human reconciliation"] : [],
    },
  };
}

export async function createAgentAssignment(
  projectRoot: string,
  workflowId: string,
  input: CreateAssignmentInput,
): Promise<AgentAssignment> {
  const state = await new StateStore(projectRoot, workflowId).load();
  assertStageAllowed(state, input.stage);
  const head = await currentHead(projectRoot);
  if (["task_review", "phase_review"].includes(input.stage) && !input.sourceCommit) {
    throw new Error(`${input.stage} requires --source-commit for the exact base commit being reviewed`);
  }
  return new AssignmentStore(projectRoot, workflowId).create({
    ...input,
    sourceCommit: input.sourceCommit ?? (["implementation", "remediation"].includes(input.stage) ? head : undefined),
    targetCommit: input.targetCommit ?? (["task_review", "phase_review", "browser_verification"].includes(input.stage) ? head : undefined),
  });
}

export async function bindAgentAssignment(
  projectRoot: string,
  workflowId: string,
  assignmentId: string,
  event: "start" | "stop",
  agentId: string,
  stopReason?: string,
): Promise<AgentAssignment> {
  await new StateStore(projectRoot, workflowId).load();
  const assignments = new AssignmentStore(projectRoot, workflowId);
  return event === "start"
    ? assignments.bindStartedById(assignmentId, agentId)
    : assignments.bindStoppedById(assignmentId, agentId, stopReason);
}

export async function listAgentAssignments(projectRoot: string, workflowId: string): Promise<AgentAssignment[]> {
  await new StateStore(projectRoot, workflowId).load();
  return (await new AssignmentStore(projectRoot, workflowId).load()).assignments;
}

export async function reconcileAgentAssignment(projectRoot: string, workflowId: string, assignmentId: string) {
  const assignments = new AssignmentStore(projectRoot, workflowId);
  let assignment = await assignments.get(assignmentId);
  if (["reconciled", "failed", "blocked"].includes(assignment.status) && assignment.nextAction) {
    return { assignment, nextAction: assignment.nextAction, state: await new StateStore(projectRoot, workflowId).load() };
  }
  let state = await new StateStore(projectRoot, workflowId).load();

  if (assignment.status === "reconciling") {
    return completeReconciliation(projectRoot, workflowId, assignments, assignment);
  }

  if (["executor", "fixer"].includes(assignment.role) && state.writerLease) {
    return blockPolicyFailure(projectRoot, workflowId, assignments, assignment, "Writer must release the lease before reconciliation");
  }
  if (["executor", "fixer"].includes(assignment.role) && !assignment.writerLeaseSessionId) {
    return blockPolicyFailure(projectRoot, workflowId, assignments, assignment, "Assignment has no evidence that its writer lease was acquired");
  }

  let frontmatter: ArtifactFrontmatter;
  try {
    frontmatter = await assignments.validateOutput(assignment, await currentHead(projectRoot));
    assertTerminalArtifactStatus(assignment, frontmatter);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const failure = await recordAgentFailure(projectRoot, workflowId, assignment.operationKey, reason);
    const outcome = failure.retry ? "retry" : "blocked";
    const nextAction = failure.retry ? `retry_${assignment.role}` : "human_reconciliation";
    const finished = await assignments.finish(assignment.id, { status: failure.retry ? "failed" : "blocked", outcome, error: reason, nextAction });
    return {
      assignment: finished,
      nextAction,
      state: failure.state,
    };
  }

  const decision = await reconciliationDecision(projectRoot, workflowId, assignment, frontmatter, state);
  assignment = await assignments.beginReconciliation(assignment.id, {
    artifactStatus: frontmatter.status,
    nextAction: decision.nextAction,
    targetWorkflowStatus: decision.targetWorkflowStatus,
  });
  return completeReconciliation(projectRoot, workflowId, assignments, assignment);
}

export async function recordAgentFailure(projectRoot: string, workflowId: string, operationKey: string, reason: string) {
  const store = new StateStore(projectRoot, workflowId);
  const state = await store.load();
  const failures = (state.operationFailures[operationKey] ?? 0) + 1;
  const operationFailures = { ...state.operationFailures, [operationKey]: Math.min(failures, 2) };
  const retry = failures === 1;
  const next = await store.save(
    { ...state, operationFailures, status: retry ? state.status : "blocked" },
    retry ? "agent.retry_scheduled" : "agent.retry_exhausted",
    { operationKey, reason, failures },
  );
  const assignments = new AssignmentStore(projectRoot, workflowId);
  const ledger = await assignments.load();
  const pending = ledger.assignments.filter(
    (assignment) => assignment.operationKey === operationKey && ["queued", "running", "stopped", "reconciling"].includes(assignment.status),
  );
  if (pending.length === 1) {
    await assignments.finish(pending[0].id, {
      status: retry ? "failed" : "blocked",
      outcome: retry ? "retry" : "blocked",
      error: reason,
      nextAction: retry ? `retry_${pending[0].role}` : "human_reconciliation",
    });
  }
  return { retry, state: next };
}

export async function recordAgentSuccess(projectRoot: string, workflowId: string, operationKey: string) {
  const store = new StateStore(projectRoot, workflowId);
  const state = await store.load();
  const operationFailures = { ...state.operationFailures };
  delete operationFailures[operationKey];
  return store.save({ ...state, operationFailures }, "agent.operation_succeeded", { operationKey });
}

async function reconciliationDecision(
  projectRoot: string,
  workflowId: string,
  assignment: AgentAssignment,
  frontmatter: ArtifactFrontmatter,
  state: WorkflowState,
): Promise<{ nextAction: string; targetWorkflowStatus?: WorkflowStatus }> {
  if (frontmatter.status === "blocked") {
    return { nextAction: "human_reconciliation", targetWorkflowStatus: "blocked" };
  }
  switch (assignment.stage) {
    case "planning":
      return { nextAction: "await_plan_approval" };
    case "implementation":
    case "remediation":
      return { nextAction: "assign_reviewer", targetWorkflowStatus: "reviewing" };
    case "task_review":
      if (frontmatter.status === "failed") {
        return state.remediationRounds >= 2
          ? { nextAction: "human_reconciliation", targetWorkflowStatus: "blocked" }
          : { nextAction: "assign_fixer", targetWorkflowStatus: "remediating" };
      }
      return { nextAction: "continue_approved_plan", targetWorkflowStatus: "executing" };
    case "phase_review": {
      if (frontmatter.status === "failed") {
        return state.remediationRounds >= 2
          ? { nextAction: "human_reconciliation", targetWorkflowStatus: "blocked" }
          : { nextAction: "assign_fixer", targetWorkflowStatus: "remediating" };
      }
      const gate = await assessCompletionGate(projectRoot, workflowId);
      if (gate.customerVisibleUi) {
        return { nextAction: "assign_browser-verifier", targetWorkflowStatus: "browser_verification" };
      }
      return { nextAction: "complete", targetWorkflowStatus: "complete" };
    }
    case "browser_verification":
      if (frontmatter.status === "failed") {
        return state.remediationRounds >= 2
          ? { nextAction: "human_reconciliation", targetWorkflowStatus: "blocked" }
          : { nextAction: "assign_fixer", targetWorkflowStatus: "remediating" };
      }
      return { nextAction: "complete", targetWorkflowStatus: "complete" };
  }
}

async function completeReconciliation(
  projectRoot: string,
  workflowId: string,
  assignments: AssignmentStore,
  assignment: AgentAssignment,
) {
  const nextAction = assignment.nextAction ?? "human_reconciliation";
  try {
    if (assignment.targetWorkflowStatus) {
      const current = await new StateStore(projectRoot, workflowId).load();
      if (current.status !== assignment.targetWorkflowStatus) {
        await transitionWorkflow(projectRoot, workflowId, assignment.targetWorkflowStatus);
      }
    }
    await recordAgentSuccess(projectRoot, workflowId, assignment.operationKey);
    const blocked = assignment.targetWorkflowStatus === "blocked" || assignment.artifactStatus === "blocked";
    const finished = await assignments.finish(assignment.id, {
      status: blocked ? "blocked" : "reconciled",
      outcome: blocked ? "blocked" : "succeeded",
      error: blocked ? "Agent or routing policy requires human reconciliation" : undefined,
      nextAction,
    });
    return { assignment: finished, nextAction, state: await new StateStore(projectRoot, workflowId).load() };
  } catch (error) {
    return blockPolicyFailure(
      projectRoot,
      workflowId,
      assignments,
      assignment,
      error instanceof Error ? error.message : String(error),
    );
  }
}

async function blockPolicyFailure(
  projectRoot: string,
  workflowId: string,
  assignments: AssignmentStore,
  assignment: AgentAssignment,
  reason: string,
) {
  const store = new StateStore(projectRoot, workflowId);
  const state = await store.load();
  const blockedState = state.status === "blocked"
    ? state
    : await store.save({ ...state, status: "blocked" }, "workflow.policy_blocked", { assignmentId: assignment.id, reason });
  const finished = await assignments.finish(assignment.id, {
    status: "blocked",
    outcome: "blocked",
    error: reason,
    nextAction: "human_reconciliation",
  });
  return { assignment: finished, nextAction: "human_reconciliation", state: blockedState };
}

function assertStageAllowed(state: WorkflowState, stage: CreateAssignmentInput["stage"]): void {
  const allowed: Record<CreateAssignmentInput["stage"], WorkflowState["status"][]> = {
    planning: ["draft_plan", "awaiting_plan_approval"],
    implementation: ["executing"],
    task_review: ["reviewing"],
    phase_review: ["reviewing"],
    remediation: ["remediating"],
    browser_verification: ["browser_verification"],
  };
  if (!allowed[stage].includes(state.status)) throw new Error(`Cannot assign ${stage} while workflow is ${state.status}`);
}

function assertTerminalArtifactStatus(assignment: AgentAssignment, frontmatter: ArtifactFrontmatter): void {
  const allowed: Record<CreateAssignmentInput["stage"], ArtifactFrontmatter["status"][]> = {
    planning: ["awaiting_approval", "blocked"],
    implementation: ["complete", "blocked"],
    task_review: ["passed", "failed", "blocked"],
    phase_review: ["passed", "failed", "blocked"],
    remediation: ["complete", "blocked"],
    browser_verification: ["passed", "failed", "blocked"],
  };
  if (!allowed[assignment.stage].includes(frontmatter.status)) {
    throw new Error(`Artifact status ${frontmatter.status} is not terminal for ${assignment.stage}`);
  }
}

function nextAction(state: WorkflowState, active: AgentAssignment[], last?: AgentAssignment): string {
  const stopped = active.find((assignment) => assignment.status === "stopped");
  if (stopped) return `reconcile_assignment:${stopped.id}`;
  const reconciling = active.find((assignment) => assignment.status === "reconciling");
  if (reconciling) return `resume_reconciliation:${reconciling.id}`;
  const running = active.find((assignment) => assignment.status === "running");
  if (running) return `wait_for_${running.role}`;
  const queued = active.find((assignment) => assignment.status === "queued");
  if (queued) return `spawn_${queued.role}`;
  if (last?.outcome === "retry") return `retry_${last.role}`;
  const byStatus: Record<WorkflowState["status"], string> = {
    draft_plan: "assign_planner",
    awaiting_plan_approval: last?.stage === "planning" && last.status === "reconciled" && last.outcome === "succeeded"
      ? "await_plan_approval"
      : "assign_planner",
    executing: "assign_executor",
    reviewing: "assign_reviewer",
    remediating: "assign_fixer",
    browser_verification: "assign_browser-verifier",
    blocked: "human_reconciliation",
    complete: "complete",
  };
  return byStatus[state.status];
}

async function currentHead(projectRoot: string): Promise<string | undefined> {
  try {
    return (await run("git", ["rev-parse", "HEAD"], projectRoot)).stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}
