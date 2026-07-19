import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { acquireWriterLease, releaseWriterLease } from "./lease.js";
import { StateStore } from "./state-store.js";
import { WriterRoleSchema, WorkflowStatusSchema } from "./types.js";
import { assessCompletionGate } from "./gates.js";

export async function acquireLease(projectRoot: string, workflowId: string, role: string, sessionId: string) {
  const store = new StateStore(projectRoot, workflowId);
  const state = await store.load();
  const writerLease = acquireWriterLease(state.writerLease, WriterRoleSchema.parse(role), sessionId);
  return store.save({ ...state, writerLease }, "writer.acquired", { role, sessionId });
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
  return state;
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
  return { retry, state: next };
}

export async function recordAgentSuccess(projectRoot: string, workflowId: string, operationKey: string) {
  const store = new StateStore(projectRoot, workflowId);
  const state = await store.load();
  const operationFailures = { ...state.operationFailures };
  delete operationFailures[operationKey];
  return store.save({ ...state, operationFailures }, "agent.operation_succeeded", { operationKey });
}
