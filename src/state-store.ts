import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  WorkflowStateSchema,
  type WorkflowMode,
  type WorkflowState,
  type WorkflowStatus,
  type WorkflowTier,
} from "./types.js";

const TRANSITIONS: Record<WorkflowStatus, WorkflowStatus[]> = {
  draft_plan: ["awaiting_plan_approval", "blocked"],
  awaiting_plan_approval: ["executing", "blocked"],
  executing: ["reviewing", "browser_verification", "blocked"],
  reviewing: ["remediating", "browser_verification", "complete", "blocked"],
  remediating: ["reviewing", "blocked"],
  browser_verification: ["remediating", "complete", "blocked"],
  blocked: ["draft_plan", "awaiting_plan_approval", "executing", "reviewing", "browser_verification"],
  complete: [],
};

export class StateStore {
  readonly runtimeDir: string;
  readonly statePath: string;
  readonly eventsPath: string;

  constructor(
    readonly projectRoot: string,
    readonly workflowId: string,
  ) {
    this.runtimeDir = join(projectRoot, ".codex", "workflow-runtime", workflowId);
    this.statePath = join(this.runtimeDir, "state.json");
    this.eventsPath = join(this.runtimeDir, "events.jsonl");
  }

  async create(input: { objective: string; tier: WorkflowTier; mode: WorkflowMode }): Promise<WorkflowState> {
    const now = new Date().toISOString();
    const state = WorkflowStateSchema.parse({
      schema: "cdo-state/v1",
      workflowId: this.workflowId,
      projectRoot: this.projectRoot,
      objective: input.objective,
      tier: input.tier,
      mode: input.mode,
      status: "draft_plan",
      phase: "phase-1",
      retryCount: 0,
      remediationRounds: 0,
      operationFailures: {},
      createdAt: now,
      updatedAt: now,
    });
    await this.persist(state);
    await this.appendEvent("workflow.created", { status: state.status });
    return state;
  }

  async load(): Promise<WorkflowState> {
    return WorkflowStateSchema.parse(JSON.parse(await readFile(this.statePath, "utf8")));
  }

  async save(state: WorkflowState, event: string, detail: Record<string, unknown> = {}): Promise<WorkflowState> {
    const next = WorkflowStateSchema.parse({ ...state, updatedAt: new Date().toISOString() });
    await this.persist(next);
    await this.appendEvent(event, detail);
    return next;
  }

  async transition(state: WorkflowState, status: WorkflowStatus, event: string): Promise<WorkflowState> {
    if (status === "executing" && !state.planApproval) {
      throw new Error("Explicit plan approval is required before execution");
    }
    if (!TRANSITIONS[state.status].includes(status)) {
      throw new Error(`Invalid workflow transition: ${state.status} -> ${status}`);
    }
    if (status === "complete" && state.writerLease) {
      throw new Error("Cannot complete a workflow while a writer lease is active");
    }
    if (status === "remediating" && state.remediationRounds >= 2) {
      throw new Error("The maximum of 2 remediation rounds has been reached; human escalation is required");
    }
    const remediationRounds = status === "remediating" ? state.remediationRounds + 1 : state.remediationRounds;
    return this.save({ ...state, status, remediationRounds }, event, { from: state.status, to: status, remediationRounds });
  }

  private async persist(state: WorkflowState): Promise<void> {
    await mkdir(dirname(this.statePath), { recursive: true });
    const temporary = `${this.statePath}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, this.statePath);
  }

  private async appendEvent(type: string, detail: Record<string, unknown>): Promise<void> {
    await mkdir(dirname(this.eventsPath), { recursive: true });
    await appendFile(
      this.eventsPath,
      `${JSON.stringify({ schema: "cdo-event/v1", at: new Date().toISOString(), type, workflowId: this.workflowId, detail })}\n`,
      { mode: 0o600 },
    );
  }
}
