import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArtifact } from "./frontmatter.js";
import { WorkflowTaskSchema, type WorkflowState, type WorkflowTask } from "./types.js";

const PLACEHOLDER = /\b(TBD|TODO|implement later|planner-owned|to be completed|write tests for the above|similar to task)\b/i;

export async function loadTaskGraph(projectRoot: string, workflowId: string): Promise<WorkflowTask[]> {
  const root = join(projectRoot, ".codex", "workflows", workflowId, "tasks");
  const entries = (await readdir(root, { withFileTypes: true })).filter((entry) => entry.isFile() && entry.name.endsWith(".md"));
  if (!entries.length) throw new Error("The implementation plan must contain at least one task brief");
  const tasks: WorkflowTask[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const relativePath = `tasks/${entry.name}`;
    const parsed = parseArtifact(await readFile(join(root, entry.name), "utf8"));
    const fm = parsed.frontmatter;
    if (fm.schema !== "cdo/v2" || fm.kind !== "task-brief" || fm.workflow_id !== workflowId || fm.status !== "ready") {
      throw new Error(`${relativePath} must be a ready cdo/v2 task-brief for ${workflowId}`);
    }
    if (!fm.task || !fm.risk || fm.review_required === undefined || fm.customer_visible_ui === undefined) {
      throw new Error(`${relativePath} is missing task, risk, review_required, or customer_visible_ui metadata`);
    }
    validateTaskBody(relativePath, parsed.body);
    const heading = parsed.body.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? fm.task;
    tasks.push(WorkflowTaskSchema.parse({
      id: fm.task,
      title: heading,
      path: relativePath,
      dependsOn: fm.depends_on ?? [],
      risk: fm.risk,
      reviewRequired: fm.review_required || fm.risk === "high",
      customerVisibleUi: fm.customer_visible_ui,
      status: "pending",
    }));
  }
  validateDependencies(tasks);
  return markReady(tasks);
}

export function nextReadyTask(state: WorkflowState): WorkflowTask | undefined {
  return state.tasks.find((task) => task.status === "ready");
}

export function markTaskRunning(state: WorkflowState, taskId: string): WorkflowState {
  return updateTask(state, taskId, (task) => ({ ...task, status: "running", attempts: task.attempts + 1 }), taskId);
}

export function markTaskPartial(state: WorkflowState, taskId: string, fingerprint?: string): WorkflowState {
  return updateTask(state, taskId, (task) => ({
    ...task,
    status: "partial",
    lastFailureFingerprint: fingerprint,
    consecutiveNoProgress: fingerprint && fingerprint === task.lastFailureFingerprint ? task.consecutiveNoProgress + 1 : 1,
  }), taskId);
}

export function markTaskReviewing(state: WorkflowState, taskId: string): WorkflowState {
  return updateTask(state, taskId, (task) => ({ ...task, status: "reviewing" }), taskId);
}

export function markTaskRemediating(state: WorkflowState, taskId: string): WorkflowState {
  return updateTask(state, taskId, (task) => ({ ...task, status: "remediating" }), taskId);
}

export function markTaskComplete(state: WorkflowState, taskId: string): WorkflowState {
  const updated = updateTask(state, taskId, (task) => ({ ...task, status: "complete", consecutiveNoProgress: 0, lastFailureFingerprint: undefined }), undefined);
  return { ...updated, tasks: markReady(updated.tasks) };
}

export function allTasksComplete(state: WorkflowState): boolean {
  return state.tasks.length > 0 && state.tasks.every((task) => task.status === "complete");
}

export function taskById(state: WorkflowState, taskId?: string): WorkflowTask | undefined {
  return taskId ? state.tasks.find((task) => task.id === taskId) : undefined;
}

function updateTask(
  state: WorkflowState,
  taskId: string,
  update: (task: WorkflowTask) => WorkflowTask,
  activeTaskId: string | undefined,
): WorkflowState {
  if (!state.tasks.some((task) => task.id === taskId)) throw new Error(`Task ${taskId} was not found`);
  return { ...state, activeTaskId, tasks: state.tasks.map((task) => task.id === taskId ? update(task) : task) };
}

function markReady(tasks: WorkflowTask[]): WorkflowTask[] {
  const complete = new Set(tasks.filter((task) => task.status === "complete").map((task) => task.id));
  return tasks.map((task) => task.status === "pending" && task.dependsOn.every((dependency) => complete.has(dependency))
    ? { ...task, status: "ready" }
    : task);
}

function validateTaskBody(path: string, body: string): void {
  if (PLACEHOLDER.test(body)) throw new Error(`${path} contains placeholder language`);
  for (const heading of ["## Context", "## Acceptance criteria", "## Steps", "## Verification"]) {
    if (!body.includes(heading)) throw new Error(`${path} is missing ${heading}`);
  }
  if (!/`[^`/]+\/[^`]+`/.test(body)) throw new Error(`${path} must name at least one exact file path`);
  if (!/```[\s\S]+?```/.test(body)) throw new Error(`${path} must contain exact commands or code in a fenced block`);
}

function validateDependencies(tasks: WorkflowTask[]): void {
  const ids = new Set<string>();
  for (const task of tasks) {
    if (ids.has(task.id)) throw new Error(`Duplicate task ID ${task.id}`);
    ids.add(task.id);
  }
  for (const task of tasks) {
    for (const dependency of task.dependsOn) {
      if (!ids.has(dependency)) throw new Error(`Task ${task.id} depends on missing task ${dependency}`);
      if (dependency === task.id) throw new Error(`Task ${task.id} cannot depend on itself`);
    }
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const visit = (id: string): void => {
    if (visiting.has(id)) throw new Error(`Task dependency cycle includes ${id}`);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of byId.get(id)?.dependsOn ?? []) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  };
  for (const task of tasks) visit(task.id);
}
