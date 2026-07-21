import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { acquireWriterLease, releaseWriterLease } from "./lease.js";
import { StateStore } from "./state-store.js";
import { WriterRoleSchema, WorkflowStatusSchema } from "./types.js";
import { assessCompletionGate } from "./gates.js";
import { AssignmentStore, type CreateAssignmentInput } from "./assignments.js";
import { run } from "./process.js";
import { allTasksComplete, loadTaskGraph, markTaskComplete, markTaskDiagnosing, markTaskEvidencePending, markTaskPartial, markTaskRemediating, markTaskReviewing, markTaskRunning, nextReadyTask, taskById } from "./task-graph.js";
import type { AgentAssignment, ArtifactFrontmatter, WorkflowState, WorkflowStatus } from "./types.js";
import { boundWorktree, inspectWorkflowWorktree } from "./worktree.js";

export async function adoptWorkflowWorktree(projectRoot: string, workflowId: string, worktreePath: string): Promise<WorkflowState> {
  const store = new StateStore(projectRoot, workflowId);
  const state = await store.load();
  if (state.worktree) throw new Error("Workflow already has a worktree binding");
  const binding = await inspectWorkflowWorktree(projectRoot, worktreePath);
  return store.save({ ...state, schema: "cdo-state/v3", worktree: binding }, "workflow.worktree_adopted", binding);
}

export type DriveResult =
  | { action: "spawn"; assignment: AgentAssignment; state: WorkflowState }
  | { action: "wait"; assignment: AgentAssignment; state: WorkflowState }
  | { action: "route"; nextAction: string; state: WorkflowState }
  | { action: "human_gate"; reason: string; state: WorkflowState }
  | { action: "complete"; state: WorkflowState };

const DRIVER_STALE_MS = 5 * 60_000;

/**
 * Advance all deterministic lifecycle work until Codex must either spawn, wait,
 * make a product decision, or declare the workflow complete.  Goal-mode
 * coordinators call this after every child event instead of relying on prose.
 */
export async function driveWorkflow(projectRoot: string, workflowId: string, sessionId?: string, noLiveAgents = false): Promise<DriveResult> {
  if (sessionId?.startsWith("/")) throw new Error("Workflow driver requires the Codex parent session ID, not an agent routing path");
  const store = new StateStore(projectRoot, workflowId);
  let state = await store.load();
  if (sessionId) state = await claimDriver(store, state, sessionId);
  let routedNextAction: string | undefined;

  for (let steps = 0; steps < 16; steps += 1) {
    const root = boundWorktree(state, projectRoot);
    const assignments = new AssignmentStore(root, workflowId);
    const ledger = await assignments.load();
    const active = ledger.assignments.filter((assignment) => ["queued", "running", "stopped", "reconciling"].includes(assignment.status));
    const pending = active.find((assignment) => assignment.status === "stopped") ?? active.find((assignment) => assignment.status === "reconciling");
    if (pending) {
      if (pending.status === "stopped" && sessionId && state.writerLease?.sessionId === sessionId) state = await releaseLease(projectRoot, workflowId, sessionId);
      const reconciled = await reconcileAgentAssignment(projectRoot, workflowId, pending.id);
      routedNextAction = reconciled.nextAction;
      state = await store.load();
      continue;
    }
    const queued = active.find((assignment) => assignment.status === "queued");
    if (queued) return { action: "spawn", assignment: queued, state };
    const running = active.find((assignment) => assignment.status === "running");
    if (running && noLiveAgents) {
      if (sessionId && state.writerLease?.sessionId === sessionId) state = await releaseLease(projectRoot, workflowId, sessionId);
      await recordAgentFailure(projectRoot, workflowId, running.operationKey, "No live Codex subagent exists for a running assignment", "agent_runtime", running);
      state = await store.load();
      routedNextAction = `retry_${running.role}`;
      continue;
    }
    if (running) return { action: "wait", assignment: running, state };
    if (state.status === "needs_human") return { action: "human_gate", reason: state.humanGate?.reason ?? "Human decision required", state: sessionId ? await releaseDriver(store, state, sessionId) : state };
    if (state.status === "complete") return { action: "complete", state: sessionId ? await releaseDriver(store, state, sessionId) : state };
    return { action: "route", nextAction: routedNextAction ?? nextAction(state, [], ledger.assignments.at(-1)), state };
  }
  throw new Error("Workflow driver exceeded deterministic reconciliation limit");
}

async function claimDriver(store: StateStore, state: WorkflowState, sessionId: string): Promise<WorkflowState> {
  const existing = state.driverLease;
  const stale = existing && Date.now() - Date.parse(existing.heartbeatAt) > DRIVER_STALE_MS;
  if (existing && existing.sessionId !== sessionId && !stale) throw new Error(`Workflow is already driven by session ${existing.sessionId}`);
  const now = new Date().toISOString();
  return store.save({ ...state, driverLease: existing ? { ...existing, heartbeatAt: now } : { sessionId, acquiredAt: now, heartbeatAt: now } }, "workflow.driver_heartbeat", { sessionId });
}

async function releaseDriver(store: StateStore, state: WorkflowState, sessionId: string): Promise<WorkflowState> {
  if (state.driverLease?.sessionId !== sessionId) return state;
  return store.save({ ...state, driverLease: undefined }, "workflow.driver_released", { sessionId });
}

export async function acquireLease(projectRoot: string, workflowId: string, role: string, sessionId: string) {
  const store = new StateStore(projectRoot, workflowId);
  const state = await store.load();
  const writerRole = WriterRoleSchema.parse(role);
  if (sessionId.startsWith("/")) throw new Error("Writer lease requires the Codex parent session ID, not an agent routing path");
  const next = await store.save({ ...state, writerLease: acquireWriterLease(state.writerLease, writerRole, sessionId) }, "writer.acquired", { role, sessionId });
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
  return store.save({ ...state, writerLease: releaseWriterLease(state.writerLease, sessionId) }, "writer.released", { sessionId });
}

export async function transitionWorkflow(projectRoot: string, workflowId: string, status: string) {
  const store = new StateStore(projectRoot, workflowId);
  const state = await store.load();
  const parsed = WorkflowStatusSchema.parse(status);
  if (parsed === "complete") {
    const gate = await assessCompletionGate(boundWorktree(state, projectRoot), workflowId);
    if (!gate.ready) throw new Error(`Completion gate is not satisfied: ${gate.missing.join(", ")}`);
  }
  return store.transition(state, parsed, `workflow.${parsed}`);
}

export async function recordBrainstormDecisions(projectRoot: string, workflowId: string): Promise<WorkflowState> {
  const store = new StateStore(projectRoot, workflowId);
  const state = await store.load();
  if (state.status !== "brainstorming") throw new Error("Workflow is not brainstorming");
  const root = boundWorktree(state, projectRoot);
  const artifact = (await import("./frontmatter.js")).parseArtifact(await readFile(join(root, ".codex", "workflows", workflowId, "decisions.md"), "utf8"));
  if (artifact.frontmatter.kind !== "decisions" || !["ready", "complete"].includes(artifact.frontmatter.status)) throw new Error("decisions.md must be ready or complete");
  return store.transition(await store.save({ ...state, decisionsComplete: true }, "brainstorm.completed"), "planning", "workflow.planning");
}

export async function resumeWorkflow(projectRoot: string, workflowId: string, status: string): Promise<WorkflowState> {
  const store = new StateStore(projectRoot, workflowId);
  const state = await store.load();
  if (state.status !== "needs_human") throw new Error("Only a needs_human workflow can be resumed");
  return store.transition({ ...state, humanGate: undefined }, WorkflowStatusSchema.parse(status), "workflow.resumed");
}

export async function statusSummary(projectRoot: string, workflowId: string) {
  const state = await new StateStore(projectRoot, workflowId).load();
  const root = boundWorktree(state, projectRoot);
  await readFile(join(root, ".codex", "workflows", workflowId, "index.md"), "utf8");
  const assignments = (await new AssignmentStore(root, workflowId).load()).assignments;
  const activeAssignments = assignments.filter((a) => ["queued", "running", "stopped", "reconciling"].includes(a.status));
  const lastAssignment = assignments.at(-1);
  return { ...state, coordination: { activeAssignments, lastAssignment, nextAction: nextAction(state, activeAssignments, lastAssignment), blockers: state.status === "needs_human" ? [state.humanGate?.reason ?? lastAssignment?.error ?? "Human decision required"] : [] } };
}

export async function createAgentAssignment(projectRoot: string, workflowId: string, input: CreateAssignmentInput): Promise<AgentAssignment> {
  const store = new StateStore(projectRoot, workflowId);
  let state = await store.load();
  const root = boundWorktree(state, projectRoot);
  assertStageAllowed(state, input.stage);
  if (input.stage === "implementation" && input.taskId) {
    state = markTaskRunning(state, input.taskId);
    await store.save(state, "task.started", { taskId: input.taskId });
  }
  const head = await currentHead(root);
  return new AssignmentStore(root, workflowId).create({
    ...input,
    sourceCommit: input.sourceCommit ?? (["implementation", "remediation"].includes(input.stage) ? head : undefined),
    targetCommit: input.targetCommit ?? (["task_review", "phase_review", "diagnosis", "browser_verification"].includes(input.stage) ? head : undefined),
    baseCommit: input.baseCommit ?? input.sourceCommit ?? (["implementation", "remediation"].includes(input.stage) ? head : undefined),
    headCommit: input.headCommit ?? input.targetCommit ?? (["task_review", "phase_review", "diagnosis", "browser_verification"].includes(input.stage) ? head : undefined),
    worktreePath: state.worktree?.worktreePath,
    branch: state.worktree?.branch,
  });
}

export async function bindAgentAssignment(projectRoot: string, workflowId: string, assignmentId: string, event: "start" | "stop", agentId: string, stopReason?: string): Promise<AgentAssignment> {
  const state = await new StateStore(projectRoot, workflowId).load();
  const assignments = new AssignmentStore(boundWorktree(state, projectRoot), workflowId);
  return event === "start" ? assignments.bindStartedById(assignmentId, agentId) : assignments.bindStoppedById(assignmentId, agentId, stopReason);
}

export async function listAgentAssignments(projectRoot: string, workflowId: string): Promise<AgentAssignment[]> {
  const state = await new StateStore(projectRoot, workflowId).load();
  return (await new AssignmentStore(boundWorktree(state, projectRoot), workflowId).load()).assignments;
}

export async function reconcileAgentAssignment(projectRoot: string, workflowId: string, assignmentId: string) {
  const store = new StateStore(projectRoot, workflowId);
  const state = await store.load();
  const root = boundWorktree(state, projectRoot);
  const assignments = new AssignmentStore(root, workflowId);
  let assignment = await assignments.get(assignmentId);
  if (["reconciled", "failed", "needs_human"].includes(assignment.status) && assignment.nextAction) return { assignment, nextAction: assignment.nextAction, state };
  if (assignment.status === "reconciling") return completeReconciliation(projectRoot, workflowId, assignments, assignment);
  if (["executor", "fixer"].includes(assignment.role) && (state.writerLease || !assignment.writerLeaseSessionId)) {
    return humanGate(projectRoot, workflowId, assignments, assignment, "destructive_action", state.writerLease ? "Writer must release its lease before reconciliation" : "Writer lease evidence is missing");
  }
  let frontmatter: ArtifactFrontmatter;
  try {
    const head = await currentHead(root);
    if (head && ["implementation", "remediation"].includes(assignment.stage)) assignment = await assignments.recordHeadCommit(assignment.id, head);
    await assertCommitRange(root, assignment);
    frontmatter = await assignments.validateOutput(assignment, head);
    assertTerminalArtifactStatus(assignment, frontmatter);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const failure = await recordAgentFailure(projectRoot, workflowId, assignment.operationKey, reason, "artifact_contract", assignment);
    const finished = await assignments.finish(assignment.id, { status: "failed", outcome: "retry", error: reason, nextAction: "repair_evidence" });
    return { assignment: finished, nextAction: finished.nextAction, state: failure.state };
  }
  const decision = await reconciliationDecision(projectRoot, workflowId, assignment, frontmatter, state);
  if (decision.humanGate) return humanGate(projectRoot, workflowId, assignments, assignment, decision.humanGate.kind, decision.humanGate.reason);
  assignment = await assignments.beginReconciliation(assignment.id, { artifactStatus: frontmatter.status, nextAction: decision.nextAction, targetWorkflowStatus: decision.targetWorkflowStatus });
  return completeReconciliation(projectRoot, workflowId, assignments, assignment);
}

export async function recordAgentFailure(projectRoot: string, workflowId: string, operationKey: string, reason: string, failureClass: "implementation" | "artifact_contract" | "agent_runtime" | "controller" = "implementation", assignment?: AgentAssignment) {
  const store = new StateStore(projectRoot, workflowId);
  const state = await store.load();
  if (failureClass === "artifact_contract") {
    const taskId = assignment?.taskId ?? state.activeTaskId;
    const next = taskId ? await store.save(markTaskEvidencePending(state, taskId), "agent.evidence_repair_scheduled", { operationKey, reason, failureClass, taskId }) : state;
    return { retry: true, diagnose: false, reason, state: next };
  }
  const failures = (state.operationFailures[operationKey] ?? 0) + 1;
  const diagnose = failures >= 3;
  const diagnosed = diagnose && (assignment?.taskId ?? state.activeTaskId)
    ? markTaskDiagnosing({ ...state, operationFailures: { ...state.operationFailures, [operationKey]: failures }, status: "diagnosing" }, assignment?.taskId ?? state.activeTaskId!)
    : { ...state, operationFailures: { ...state.operationFailures, [operationKey]: failures }, status: diagnose ? "diagnosing" : state.status };
  const next = await store.save(diagnosed, diagnose ? "agent.diagnosis_scheduled" : "agent.retry_scheduled", { operationKey, reason, failures, failureClass });
  const assignments = new AssignmentStore(boundWorktree(state, projectRoot), workflowId);
  const pending = (await assignments.load()).assignments.find((assignment) => assignment.operationKey === operationKey && ["queued", "running", "stopped", "reconciling"].includes(assignment.status));
  if (pending) await assignments.finish(pending.id, { status: "failed", outcome: diagnose ? "continue" : "retry", error: reason, nextAction: diagnose ? "assign_diagnosis" : `retry_${pending.role}` });
  return { retry: !diagnose, diagnose, reason, state: next };
}

export async function recordAgentSuccess(projectRoot: string, workflowId: string, operationKey: string) {
  const store = new StateStore(projectRoot, workflowId);
  const state = await store.load();
  const operationFailures = { ...state.operationFailures };
  delete operationFailures[operationKey];
  return store.save({ ...state, operationFailures }, "agent.operation_succeeded", { operationKey });
}

async function reconciliationDecision(projectRoot: string, workflowId: string, assignment: AgentAssignment, fm: ArtifactFrontmatter, state: WorkflowState): Promise<{ nextAction: string; targetWorkflowStatus?: WorkflowStatus; humanGate?: { kind: "external_blocker" | "destructive_action" | "production" | "credentials" | "product_decision" | "scope_expansion" | "merge"; reason: string } }> {
  if (["external_blocker", "safety_gate"].includes(fm.status)) return { nextAction: "request_human", humanGate: { kind: fm.status === "external_blocker" ? "external_blocker" : "destructive_action", reason: `Agent reported ${fm.status} for ${assignment.operationKey}` } };
  if (["partial", "needs_context", "retryable_failure"].includes(fm.status)) return { nextAction: `continue_${assignment.role}`, targetWorkflowStatus: assignment.stage === "diagnosis" ? "diagnosing" : state.status };
  if (fm.status === "needs_replan") return { nextAction: "assign_planner", targetWorkflowStatus: "planning" };
  switch (assignment.stage) {
    case "research": return { nextAction: "brainstorm_with_human", targetWorkflowStatus: "brainstorming" };
    case "planning": return { nextAction: "assign_executor", targetWorkflowStatus: "executing" };
    case "implementation":
    case "remediation": {
      const task = taskById(state, assignment.taskId ?? state.activeTaskId);
      if (task && (task.reviewRequired || assignment.stage === "remediation")) return { nextAction: "assign_task_reviewer", targetWorkflowStatus: "reviewing" };
      return { nextAction: "advance_task", targetWorkflowStatus: "executing" };
    }
    case "diagnosis": {
      switch (fm.diagnosis_recommendation) {
        case "assign_fixer": return { nextAction: "assign_fixer", targetWorkflowStatus: "remediating" };
        case "repair_evidence": return { nextAction: "repair_evidence", targetWorkflowStatus: "executing" };
        case "assign_planner": return { nextAction: "assign_planner", targetWorkflowStatus: "planning" };
        case "retry_executor": return { nextAction: "retry_executor", targetWorkflowStatus: "executing" };
        case "cancel_task": return { nextAction: "request_human", humanGate: { kind: "product_decision", reason: "Diagnosis recommends cancelling the task" } };
        case "request_human": return { nextAction: "request_human", humanGate: { kind: "product_decision", reason: "Diagnosis requires a human decision" } };
        default: throw new Error("Diagnosis artifact requires diagnosis_recommendation");
      }
    }
    case "task_review": return fm.status === "failed" ? { nextAction: "assign_fixer", targetWorkflowStatus: "remediating" } : { nextAction: "advance_task", targetWorkflowStatus: "executing" };
    case "phase_review": {
      if (fm.status === "failed") return { nextAction: "assign_fixer", targetWorkflowStatus: "remediating" };
      const gate = await assessCompletionGate(boundWorktree(state, projectRoot), workflowId);
      return gate.customerVisibleUi ? { nextAction: "assign_browser-verifier", targetWorkflowStatus: "browser_verification" } : { nextAction: "complete", targetWorkflowStatus: "complete" };
    }
    case "browser_verification": return fm.status === "failed" ? { nextAction: "assign_fixer", targetWorkflowStatus: "remediating" } : { nextAction: "complete", targetWorkflowStatus: "complete" };
  }
}

async function completeReconciliation(projectRoot: string, workflowId: string, assignments: AssignmentStore, assignment: AgentAssignment) {
  const store = new StateStore(projectRoot, workflowId);
  let state = await store.load();
  try {
    if (assignment.stage === "research") state = await store.save({ ...state, researchComplete: true }, "research.completed");
    const root = boundWorktree(state, projectRoot);
    if (assignment.stage === "planning") state = await store.save({ ...state, tasks: await loadTaskGraph(root, workflowId), planRevision: state.planRevision + 1 }, "plan.persisted");
    const taskId = assignment.taskId ?? state.activeTaskId;
    if (taskId && ["partial", "needs_context", "retryable_failure"].includes(assignment.artifactStatus ?? "")) {
      state = await store.save(markTaskPartial(state, taskId, assignment.artifactStatus), "task.partial", { taskId });
      if ((taskById(state, taskId)?.consecutiveNoProgress ?? 0) >= 3) {
        assignment = { ...assignment, nextAction: "assign_diagnosis", targetWorkflowStatus: "diagnosing" };
      }
    }
    if (taskId && ["implementation", "remediation"].includes(assignment.stage) && assignment.artifactStatus === "complete") state = assignment.nextAction === "assign_task_reviewer" ? await store.save(markTaskReviewing(state, taskId), "task.reviewing", { taskId }) : await store.save(markTaskComplete(state, taskId), "task.completed", { taskId });
    if (taskId && assignment.stage === "task_review") state = assignment.artifactStatus === "passed" ? await store.save(markTaskComplete(state, taskId), "task.completed", { taskId }) : await store.save(markTaskRemediating(state, taskId), "task.remediating", { taskId });
    if (taskId && assignment.stage === "diagnosis" && assignment.nextAction === "assign_fixer") state = await store.save(markTaskRemediating(state, taskId), "task.remediating", { taskId });
    if (taskId && assignment.stage === "diagnosis" && assignment.nextAction === "repair_evidence") state = await store.save(markTaskEvidencePending(state, taskId), "task.evidence_pending", { taskId });
    if (assignment.nextAction === "advance_task" && allTasksComplete(state)) assignment = { ...assignment, nextAction: "assign_phase_reviewer", targetWorkflowStatus: "reviewing" };
    if (assignment.targetWorkflowStatus && state.status !== assignment.targetWorkflowStatus) state = await transitionWorkflow(projectRoot, workflowId, assignment.targetWorkflowStatus);
    await recordAgentSuccess(projectRoot, workflowId, assignment.operationKey);
    const finished = await assignments.finish(assignment.id, { status: "reconciled", outcome: assignment.artifactStatus === "needs_replan" ? "replan" : ["partial", "needs_context", "retryable_failure"].includes(assignment.artifactStatus ?? "") ? "continue" : "succeeded", nextAction: assignment.nextAction });
    return { assignment: finished, nextAction: finished.nextAction, state: await store.load() };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const failure = await recordAgentFailure(projectRoot, workflowId, assignment.operationKey, reason, "controller", assignment);
    const failed = await assignments.get(assignment.id);
    return { assignment: failed, nextAction: failure.diagnose ? "assign_diagnosis" : `retry_${assignment.role}`, state: failure.state };
  }
}

async function humanGate(projectRoot: string, workflowId: string, assignments: AssignmentStore, assignment: AgentAssignment, kind: NonNullable<WorkflowState["humanGate"]>["kind"], reason: string) {
  const store = new StateStore(projectRoot, workflowId);
  const state = await store.load();
  const gated = await store.save({ ...state, status: "needs_human", humanGate: { kind, reason, requestedAt: new Date().toISOString() } }, "workflow.needs_human", { assignmentId: assignment.id, kind, reason });
  const finished = await assignments.finish(assignment.id, { status: "needs_human", outcome: "needs_human", error: reason, nextAction: "request_human" });
  return { assignment: finished, nextAction: "request_human", state: gated };
}

function assertStageAllowed(state: WorkflowState, stage: CreateAssignmentInput["stage"]): void {
  const allowed: Record<CreateAssignmentInput["stage"], WorkflowState["status"][]> = { research: ["discovering"], planning: ["planning"], implementation: ["executing"], diagnosis: ["diagnosing"], task_review: ["reviewing"], phase_review: ["reviewing"], remediation: ["remediating"], browser_verification: ["browser_verification"] };
  if (!allowed[stage].includes(state.status)) throw new Error(`Cannot assign ${stage} while workflow is ${state.status}`);
}

function assertTerminalArtifactStatus(assignment: AgentAssignment, fm: ArtifactFrontmatter): void {
  const common: ArtifactFrontmatter["status"][] = ["partial", "needs_context", "retryable_failure", "needs_replan", "external_blocker", "safety_gate"];
  const allowed: Record<CreateAssignmentInput["stage"], ArtifactFrontmatter["status"][]> = { research: ["complete", ...common], planning: ["ready", "complete", ...common], implementation: ["complete", ...common], diagnosis: ["complete", ...common], task_review: ["passed", "failed", ...common], phase_review: ["passed", "failed", ...common], remediation: ["complete", ...common], browser_verification: ["passed", "failed", ...common] };
  if (!allowed[assignment.stage].includes(fm.status)) throw new Error(`Artifact status ${fm.status} is not terminal for ${assignment.stage}`);
}

function nextAction(state: WorkflowState, active: AgentAssignment[], last?: AgentAssignment): string {
  const pending = active.find((a) => a.status === "stopped") ?? active.find((a) => a.status === "reconciling") ?? active.find((a) => a.status === "running") ?? active.find((a) => a.status === "queued");
  if (pending) return pending.status === "stopped" ? `reconcile_assignment:${pending.id}` : pending.status === "reconciling" ? `resume_reconciliation:${pending.id}` : pending.status === "running" ? `wait_for_${pending.role}` : `spawn_${pending.role}`;
  if (last?.nextAction && ["retry", "continue", "replan"].includes(last.outcome ?? "")) return last.nextAction;
  const actions: Record<WorkflowState["status"], string> = { discovering: "assign_researcher", brainstorming: "brainstorm_with_human", planning: "assign_planner", executing: allTasksComplete(state) ? "assign_phase_reviewer" : nextReadyTask(state) ? `assign_executor:${nextReadyTask(state)?.id}` : "diagnose_task_graph", diagnosing: "assign_diagnosis", reviewing: "assign_reviewer", remediating: "assign_fixer", browser_verification: "assign_browser-verifier", needs_human: "request_human", controller_error: "recover_controller", cancelled: "cancelled", superseded: "superseded", complete: "complete" };
  return actions[state.status];
}

async function currentHead(projectRoot: string): Promise<string | undefined> {
  try { return (await run("git", ["rev-parse", "HEAD"], projectRoot)).stdout.trim() || undefined; } catch { return undefined; }
}

async function assertCommitRange(projectRoot: string, assignment: AgentAssignment): Promise<void> {
  const base = assignment.baseCommit ?? assignment.sourceCommit;
  const head = assignment.headCommit ?? assignment.targetCommit;
  if (!base || !head) return;
  try {
    await run("git", ["merge-base", "--is-ancestor", base, head], projectRoot);
  } catch {
    throw new Error("Assignment commit range is not an ancestor relationship in its bound worktree");
  }
}

export function failureFingerprint(reason: string): string { return createHash("sha256").update(reason.trim().toLowerCase()).digest("hex").slice(0, 16); }
