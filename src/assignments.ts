import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { parseArtifact } from "./frontmatter.js";
import { StateStore } from "./state-store.js";
import { workflowRuntimeRoot } from "./project-root.js";
import {
  AgentAssignmentSchema,
  AgentRoleSchema,
  AssignmentStageSchema,
  ArtifactKindSchema,
  SessionLedgerSchema,
  WorkflowIdSchema,
  type AgentAssignment,
  type AgentRole,
  type ArtifactFrontmatter,
  type ArtifactKind,
  type AssignmentStage,
  type SessionLedger,
  type WorkflowStatus,
} from "./types.js";

const PENDING = new Set(["queued", "running", "stopped", "reconciling"]);
const LOCK_TIMEOUT_MS = 5_000;
const STALE_LOCK_MS = 30_000;

const STAGE_CONTRACT: Record<AssignmentStage, { role: AgentRole; kinds: ArtifactKind[] }> = {
  research: { role: "researcher", kinds: ["research"] },
  planning: { role: "planner", kinds: ["plan", "task-brief"] },
  implementation: { role: "executor", kinds: ["executor-report"] },
  diagnosis: { role: "reviewer", kinds: ["diagnosis"] },
  task_review: { role: "reviewer", kinds: ["review"] },
  phase_review: { role: "reviewer", kinds: ["review"] },
  remediation: { role: "fixer", kinds: ["executor-report"] },
  browser_verification: { role: "browser-verifier", kinds: ["browser-report"] },
};

export interface CreateAssignmentInput {
  operationKey: string;
  role: AgentRole;
  stage: AssignmentStage;
  taskId?: string;
  inputPath: string;
  outputPath: string;
  expectedKind: ArtifactKind;
  sourceCommit?: string;
  targetCommit?: string;
  baseCommit?: string;
  headCommit?: string;
  worktreePath?: string;
  branch?: string;
}

export class AssignmentStore {
  readonly workflowId: string;
  readonly path: string;
  readonly lockPath: string;

  constructor(
    readonly projectRoot: string,
    workflowId: string,
  ) {
    this.workflowId = WorkflowIdSchema.parse(workflowId);
    this.path = join(workflowRuntimeRoot(projectRoot), this.workflowId, "sessions.json");
    this.lockPath = join(dirname(this.path), "sessions.lock");
  }

  async load(): Promise<SessionLedger> {
    try {
      const ledger = SessionLedgerSchema.parse(JSON.parse(await readFile(this.path, "utf8")));
      if (ledger.workflowId !== this.workflowId) throw new Error("Assignment ledger workflow identity mismatch");
      return ledger;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      return { schema: "cdo-sessions/v3", workflowId: this.workflowId, assignments: [] };
    }
  }

  async create(input: CreateAssignmentInput): Promise<AgentAssignment> {
    const role = AgentRoleSchema.parse(input.role);
    const stage = AssignmentStageSchema.parse(input.stage);
    const expectedKind = ArtifactKindSchema.parse(input.expectedKind);
    const contract = STAGE_CONTRACT[stage];
    if (contract.role !== role || !contract.kinds.includes(expectedKind)) {
      throw new Error(`Assignment stage ${stage} requires ${contract.role} with ${contract.kinds.join(" or ")}`);
    }
    validateWorkflowPath(this.projectRoot, this.workflowId, input.inputPath);
    validateWorkflowPath(this.projectRoot, this.workflowId, input.outputPath);
    if (["task_review", "phase_review"].includes(stage) && !input.sourceCommit) {
      throw new Error(`${stage} requires the exact source commit being reviewed`);
    }
    if (stage === "phase_review" && input.outputPath !== "reviews/phase-final.md") {
      throw new Error("A phase review must write reviews/phase-final.md");
    }
    if (stage === "browser_verification" && input.outputPath !== "browser/report.md") {
      throw new Error("Browser verification must write browser/report.md");
    }

    const assignment = await this.mutate((ledger) => {
      const pending = ledger.assignments.find((candidate) => candidate.role === role && PENDING.has(candidate.status));
      if (pending) throw new Error(`Role ${role} already has pending assignment ${pending.id}`);
      const attempt = ledger.assignments.filter((candidate) => candidate.operationKey === input.operationKey).length + 1;
      const created = AgentAssignmentSchema.parse({
        id: randomUUID(),
        workflowId: this.workflowId,
        ...input,
        role,
        stage,
        expectedKind,
        attempt,
        status: "queued",
        assignedAt: new Date().toISOString(),
      });
      return [{ ...ledger, assignments: [...ledger.assignments, created] }, created];
    });
    await this.record("agent.assignment_created", assignment);
    return assignment;
  }

  async bindStarted(role: AgentRole, agentId?: string): Promise<{ assignment?: AgentAssignment; reason?: string }> {
    return this.bindByRole(role, "start", { agentId });
  }

  async bindStopped(role: AgentRole, input: { agentId?: string; stopReason?: string }): Promise<{ assignment?: AgentAssignment; reason?: string }> {
    return this.bindByRole(role, "stop", input);
  }

  async bindStartedById(assignmentId: string, agentId: string): Promise<AgentAssignment> {
    return this.bindById(assignmentId, "start", { agentId });
  }

  async bindStoppedById(assignmentId: string, agentId: string, stopReason?: string): Promise<AgentAssignment> {
    return this.bindById(assignmentId, "stop", { agentId, stopReason });
  }

  async get(assignmentId: string): Promise<AgentAssignment> {
    const assignment = (await this.load()).assignments.find((candidate) => candidate.id === assignmentId);
    if (!assignment) throw new Error(`Assignment ${assignmentId} was not found`);
    return assignment;
  }

  async beginReconciliation(
    assignmentId: string,
    input: { artifactStatus: ArtifactFrontmatter["status"]; nextAction: string; targetWorkflowStatus?: WorkflowStatus },
  ): Promise<AgentAssignment> {
    return this.update(assignmentId, (existing) => {
      if (existing.status === "reconciling") return existing;
      if (existing.status !== "stopped") throw new Error(`Assignment ${assignmentId} must stop before reconciliation`);
      return AgentAssignmentSchema.parse({ ...existing, ...input, status: "reconciling" });
    }, "agent.assignment_reconciling");
  }

  async recordWriterLease(role: "executor" | "fixer", sessionId: string): Promise<AgentAssignment> {
    const ledger = await this.load();
    const matches = ledger.assignments.filter((assignment) => assignment.role === role && assignment.status === "running");
    if (matches.length !== 1) throw new Error(`Expected one running ${role} assignment for writer lease, found ${matches.length}`);
    return this.update(matches[0].id, (existing) => {
      if (existing.writerLeaseSessionId && existing.writerLeaseSessionId !== sessionId) {
        throw new Error("Assignment writer lease identity mismatch");
      }
      return AgentAssignmentSchema.parse({ ...existing, writerLeaseSessionId: sessionId });
    }, "agent.assignment_writer_lease_recorded");
  }

  async finish(
    assignmentId: string,
    update: Pick<AgentAssignment, "status" | "outcome"> & { error?: string; nextAction?: string },
  ): Promise<AgentAssignment> {
    return this.update(assignmentId, (existing) => {
      if (["reconciled", "failed", "needs_human"].includes(existing.status) && existing.status === update.status) return existing;
      return AgentAssignmentSchema.parse({ ...existing, ...update, reconciledAt: new Date().toISOString() });
    }, `agent.assignment_${update.status}`);
  }

  async recordHeadCommit(assignmentId: string, headCommit: string): Promise<AgentAssignment> {
    return this.update(assignmentId, (existing) => AgentAssignmentSchema.parse({
      ...existing,
      headCommit,
      targetCommit: headCommit,
    }), "agent.assignment_head_recorded");
  }

  async validateOutput(assignment: AgentAssignment, currentCommit?: string): Promise<ArtifactFrontmatter> {
    if (!["stopped", "reconciling"].includes(assignment.status)) {
      throw new Error(`Assignment ${assignment.id} must stop before reconciliation`);
    }
    const path = validateWorkflowPath(this.projectRoot, this.workflowId, assignment.outputPath);
    const frontmatter = parseArtifact(await readFile(path, "utf8")).frontmatter;
    if (frontmatter.workflow_id !== this.workflowId) throw new Error("Assignment artifact workflow identity mismatch");
    if (frontmatter.kind !== assignment.expectedKind) throw new Error(`Expected ${assignment.expectedKind}, found ${frontmatter.kind}`);
    if (frontmatter.assignment_id !== assignment.id) throw new Error("Assignment artifact identity mismatch");
    if (frontmatter.operation_key !== assignment.operationKey) throw new Error("Assignment artifact operation key mismatch");
    if (frontmatter.agent_role !== assignment.role) throw new Error("Assignment artifact role mismatch");
    const expectedBase = assignment.baseCommit ?? assignment.sourceCommit;
    if (expectedBase && frontmatter.source_commit !== expectedBase) {
      throw new Error("Assignment artifact source commit mismatch");
    }
    const expectedTarget = assignment.headCommit ?? assignment.targetCommit ?? currentCommit;
    if (expectedTarget && frontmatter.target_commit !== expectedTarget) {
      throw new Error("Assignment artifact target commit mismatch");
    }
    return frontmatter;
  }

  private async bindByRole(
    role: AgentRole,
    event: "start" | "stop",
    input: { agentId?: string; stopReason?: string },
  ): Promise<{ assignment?: AgentAssignment; reason?: string }> {
    const expected = event === "start" ? "queued" : "running";
    const ledger = await this.load();
    const matches = ledger.assignments.filter((assignment) =>
      assignment.role === role && assignment.status === expected &&
      (!input.agentId || !assignment.agentId || assignment.agentId === input.agentId));
    if (matches.length !== 1) return { reason: `Expected one ${expected} ${role} assignment, found ${matches.length}` };
    return { assignment: await this.bindById(matches[0].id, event, input) };
  }

  private async bindById(
    assignmentId: string,
    event: "start" | "stop",
    input: { agentId?: string; stopReason?: string },
  ): Promise<AgentAssignment> {
    const assignment = await this.update(assignmentId, (existing) => {
      const target = event === "start" ? "running" : "stopped";
      if (existing.status === target && (!input.agentId || existing.agentId === input.agentId)) return existing;
      const expected = event === "start" ? "queued" : "running";
      if (existing.status !== expected) throw new Error(`Cannot bind ${event} for assignment ${assignmentId} while it is ${existing.status}`);
      if (existing.agentId && input.agentId && existing.agentId !== input.agentId) throw new Error("Assignment agent identity mismatch");
      const now = new Date().toISOString();
      return AgentAssignmentSchema.parse({
        ...existing,
        agentId: input.agentId ?? existing.agentId,
        status: target,
        ...(event === "start" ? { startedAt: now } : { stoppedAt: now, stopReason: input.stopReason }),
      });
    }, `agent.assignment_${event === "start" ? "started" : "stopped"}`);
    return assignment;
  }

  private async update(
    assignmentId: string,
    transform: (assignment: AgentAssignment) => AgentAssignment,
    event: string,
  ): Promise<AgentAssignment> {
    const assignment = await this.mutate((ledger) => {
      const existing = ledger.assignments.find((candidate) => candidate.id === assignmentId);
      if (!existing) throw new Error(`Assignment ${assignmentId} was not found`);
      const next = transform(existing);
      return [{ ...ledger, assignments: ledger.assignments.map((candidate) => candidate.id === assignmentId ? next : candidate) }, next];
    });
    await this.record(event, assignment);
    return assignment;
  }

  private async mutate<T>(transform: (ledger: SessionLedger) => [SessionLedger, T]): Promise<T> {
    const owner = await this.acquireLock();
    try {
      const [ledger, result] = transform(await this.load());
      await this.persist(ledger);
      return result;
    } finally {
      await this.releaseLock(owner);
    }
  }

  private async acquireLock(): Promise<string> {
    await mkdir(dirname(this.lockPath), { recursive: true, mode: 0o700 });
    const started = Date.now();
    while (true) {
      try {
        await mkdir(this.lockPath, { mode: 0o700 });
        const owner = `${process.pid}:${randomUUID()}`;
        await writeFile(join(this.lockPath, "owner"), owner, { mode: 0o600 });
        return owner;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        try {
          if (Date.now() - (await stat(this.lockPath)).mtimeMs > STALE_LOCK_MS) {
            await rm(this.lockPath, { recursive: true, force: true });
            continue;
          }
        } catch (statError) {
          if ((statError as NodeJS.ErrnoException).code !== "ENOENT") throw statError;
        }
        if (Date.now() - started >= LOCK_TIMEOUT_MS) throw new Error("Timed out waiting for the assignment ledger lock");
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 20));
      }
    }
  }

  private async releaseLock(owner: string): Promise<void> {
    try {
      if ((await readFile(join(this.lockPath, "owner"), "utf8")) === owner) {
        await rm(this.lockPath, { recursive: true, force: true });
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  private async persist(ledger: SessionLedger): Promise<void> {
    const validated = SessionLedgerSchema.parse(ledger);
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    const temporary = `${this.path}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(validated, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, this.path);
  }

  private async record(event: string, assignment: AgentAssignment): Promise<void> {
    await new StateStore(this.projectRoot, this.workflowId).recordEvent(event, eventDetail(assignment));
  }
}

export function validateWorkflowPath(projectRoot: string, workflowId: string, path: string): string {
  const id = WorkflowIdSchema.parse(workflowId);
  const workflowRoot = resolve(projectRoot, ".codex", "workflows", id);
  const target = resolve(workflowRoot, path);
  const relation = relative(workflowRoot, target);
  if (isAbsolute(path) || relation.startsWith("..") || isAbsolute(relation)) {
    throw new Error("Assignment paths must stay inside the workflow directory");
  }
  return target;
}

function eventDetail(assignment: AgentAssignment): Record<string, unknown> {
  return {
    assignmentId: assignment.id,
    operationKey: assignment.operationKey,
    role: assignment.role,
    stage: assignment.stage,
    attempt: assignment.attempt,
    status: assignment.status,
    outcome: assignment.outcome,
    nextAction: assignment.nextAction,
  };
}
