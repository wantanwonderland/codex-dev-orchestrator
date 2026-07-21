import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  WorkflowIdSchema,
  WorkflowStateSchema,
  type WorkflowMode,
  type WorkflowState,
  type WorkflowStatus,
  type WorkflowTier,
} from "./types.js";
import { workflowRuntimeRoot } from "./project-root.js";

const TRANSITIONS: Record<WorkflowStatus, WorkflowStatus[]> = {
  discovering: ["brainstorming", "planning", "needs_human"],
  brainstorming: ["planning", "needs_human"],
  planning: ["executing", "needs_human"],
  executing: ["planning", "diagnosing", "reviewing", "browser_verification", "needs_human"],
  diagnosing: ["planning", "executing", "reviewing", "needs_human"],
  reviewing: ["executing", "remediating", "browser_verification", "complete", "needs_human"],
  remediating: ["diagnosing", "reviewing", "needs_human"],
  browser_verification: ["remediating", "complete", "needs_human"],
  needs_human: ["discovering", "brainstorming", "planning", "executing", "diagnosing", "reviewing", "browser_verification"],
  complete: [],
};

export class StateStore {
  readonly workflowId: string;
  readonly runtimeDir: string;
  readonly statePath: string;
  readonly eventsPath: string;

  constructor(readonly projectRoot: string, workflowId: string) {
    this.workflowId = WorkflowIdSchema.parse(workflowId);
    this.runtimeDir = join(workflowRuntimeRoot(projectRoot), this.workflowId);
    this.statePath = join(this.runtimeDir, "state.json");
    this.eventsPath = join(this.runtimeDir, "events.jsonl");
  }

  async create(input: { objective: string; tier: WorkflowTier; mode: WorkflowMode }): Promise<WorkflowState> {
    const now = new Date().toISOString();
    const state = WorkflowStateSchema.parse({
      schema: "cdo-state/v2",
      workflowId: this.workflowId,
      projectRoot: this.projectRoot,
      objective: input.objective,
      tier: input.tier,
      mode: input.mode,
      status: input.tier === "small" ? "planning" : "discovering",
      phase: "phase-1",
      researchComplete: input.tier === "small",
      decisionsComplete: input.tier === "small",
      planRevision: 0,
      tasks: [],
      operationFailures: {},
      createdAt: now,
      updatedAt: now,
    });
    await this.persist(state);
    await this.appendEvent("workflow.created", { status: state.status, mode: state.mode, tier: state.tier });
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
    if (!TRANSITIONS[state.status].includes(status)) throw new Error(`Invalid workflow transition: ${state.status} -> ${status}`);
    if (status === "complete" && state.writerLease) throw new Error("Cannot complete a workflow while a writer lease is active");
    return this.save({ ...state, status, humanGate: status === "needs_human" ? state.humanGate : undefined }, event, { from: state.status, to: status });
  }

  async recordEvent(type: string, detail: Record<string, unknown> = {}): Promise<void> {
    await this.appendEvent(type, detail);
  }

  private async persist(state: WorkflowState): Promise<void> {
    await mkdir(dirname(this.statePath), { recursive: true, mode: 0o700 });
    const temporary = `${this.statePath}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, this.statePath);
  }

  private async appendEvent(type: string, detail: Record<string, unknown>): Promise<void> {
    await mkdir(dirname(this.eventsPath), { recursive: true, mode: 0o700 });
    await appendFile(
      this.eventsPath,
      `${JSON.stringify({ schema: "cdo-event/v2", at: new Date().toISOString(), type, workflowId: this.workflowId, detail })}\n`,
      { mode: 0o600 },
    );
  }
}
