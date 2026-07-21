import { readdir } from "node:fs/promises";
import { dirname, join, parse } from "node:path";
import { AssignmentStore } from "./assignments.js";
import { StateStore } from "./state-store.js";
import { AgentRoleSchema, type AgentAssignment, type AgentRole } from "./types.js";
import { workflowRuntimeRoot } from "./project-root.js";

export interface AgentLifecycleInput {
  hook_event_name?: string;
  cwd?: string;
  agent_id?: string;
  agent_type?: string;
  stop_reason?: string;
}

export interface AgentLifecycleResult {
  assignment?: AgentAssignment;
  warning?: string;
}

export async function handleAgentLifecycle(input: AgentLifecycleInput): Promise<AgentLifecycleResult> {
  const role = parseRole(input.agent_type);
  if (!role) return {};
  const { stores, warnings } = await candidateStores(input.cwd ?? process.cwd(), role, input.hook_event_name === "SubagentStop" ? "running" : "queued");
  if (stores.length === 0) return warnings.length ? { warning: warnings.join("; ") } : {};
  if (stores.length > 1) {
    return { warning: `CDO found ${stores.length} ${role} assignments across workflows. Bind the returned agent ID to the intended assignment explicitly with cdo bind-agent.` };
  }
  const store = stores[0];
  const result = input.hook_event_name === "SubagentStop"
    ? await store.bindStopped(role, { agentId: input.agent_id, stopReason: input.stop_reason })
    : await store.bindStarted(role, input.agent_id);
  return result.assignment
    ? { assignment: result.assignment, warning: warnings.length ? warnings.join("; ") : undefined }
    : { warning: [result.reason, ...warnings].filter(Boolean).join("; ") };
}

async function candidateStores(cwd: string, role: AgentRole, status: "queued" | "running"): Promise<{ stores: AssignmentStore[]; warnings: string[] }> {
  const runtimeRoot = await findRuntimeRoot(cwd);
  if (!runtimeRoot) return { stores: [], warnings: [] };
  const stores: AssignmentStore[] = [];
  const warnings: string[] = [];
  for (const entry of await readdir(runtimeRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const projectRoot = dirname(dirname(runtimeRoot));
    try {
      const state = await new StateStore(projectRoot, entry.name).load();
      if (["needs_human", "complete"].includes(state.status)) continue;
      const store = new AssignmentStore(projectRoot, entry.name);
      const matches = (await store.load()).assignments.filter((assignment) => assignment.role === role && assignment.status === status);
      if (matches.length === 1) stores.push(store);
    } catch (error) {
      warnings.push(`CDO could not inspect workflow ${entry.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { stores, warnings };
}

function parseRole(value?: string): AgentRole | undefined {
  if (!value) return undefined;
  const parsed = AgentRoleSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

async function findRuntimeRoot(start: string): Promise<string | undefined> {
  const canonical = workflowRuntimeRoot(start);
  try {
    await readdir(canonical);
    return canonical;
  } catch {
    // Fall back to walking upward for initialized non-Git projects.
  }
  let current = start;
  const filesystemRoot = parse(current).root;
  while (true) {
    const candidate = join(current, ".codex", "workflow-runtime");
    try {
      await readdir(candidate);
      return candidate;
    } catch {
      // Continue upward for agents started from a repository subdirectory.
    }
    if (current === filesystemRoot) return undefined;
    current = dirname(current);
  }
}
