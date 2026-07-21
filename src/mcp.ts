#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { acquireLease, bindAgentAssignment, createAgentAssignment, listAgentAssignments, reconcileAgentAssignment, recordAgentFailure, recordAgentSuccess, releaseLease, statusSummary, transitionWorkflow } from "./workflow.js";
import { classifyRisk } from "./risk.js";
import { issueBrowserAuthState, deleteBrowserAuthState } from "./credentials.js";
import { assessCompletionGate } from "./gates.js";
import { persistWorkflowArtifact } from "./artifacts.js";

const server = new McpServer(
  { name: "codex-dev-orchestrator", version: "0.3.0" },
  {
    instructions:
      "Create a durable assignment before every native subagent spawn, wait for the child, reconcile its cdo/v1 artifact and Git evidence, then follow nextAction. Use tracked .codex/workflows Markdown as the handoff contract and runtime state only for coordination. Require explicit plan approval before execution. Only an executor or fixer holding the writer lease may mutate source. Deployment and production mutations always require explicit human instruction.",
  },
);

const text = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] });
const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const additive = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } as const;
const destructive = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false } as const;

server.registerTool("workflow_status", { description: "Read durable workflow status before routing work.", inputSchema: { projectRoot: z.string(), workflowId: z.string() }, annotations: readOnly }, async ({ projectRoot, workflowId }) => text(await statusSummary(projectRoot, workflowId)));
server.registerTool("create_agent_assignment", { description: "Register a durable role assignment before spawning a native Codex subagent.", inputSchema: { projectRoot: z.string(), workflowId: z.string(), operationKey: z.string(), role: z.enum(["planner", "executor", "reviewer", "fixer", "browser-verifier"]), stage: z.enum(["planning", "implementation", "task_review", "phase_review", "remediation", "browser_verification"]), inputPath: z.string(), outputPath: z.string(), expectedKind: z.enum(["plan", "task-brief", "executor-report", "review", "browser-report"]), sourceCommit: z.string().optional(), targetCommit: z.string().optional() }, annotations: additive }, async (input) => text(await createAgentAssignment(input.projectRoot, input.workflowId, input)));
server.registerTool("list_agent_assignments", { description: "List durable assignment and handoff state for a workflow.", inputSchema: { projectRoot: z.string(), workflowId: z.string() }, annotations: readOnly }, async (input) => text(await listAgentAssignments(input.projectRoot, input.workflowId)));
server.registerTool("bind_agent_assignment", { description: "Explicitly bind a native subagent ID to one durable assignment when lifecycle hook routing is ambiguous or needs recovery.", inputSchema: { projectRoot: z.string(), workflowId: z.string(), assignmentId: z.string().uuid(), event: z.enum(["start", "stop"]), agentId: z.string().min(1), stopReason: z.string().optional() }, annotations: additive }, async (input) => text(await bindAgentAssignment(input.projectRoot, input.workflowId, input.assignmentId, input.event, input.agentId, input.stopReason)));
server.registerTool("reconcile_agent_assignment", { description: "Validate a stopped agent's expected artifact and route the workflow to its next owner or retry gate.", inputSchema: { projectRoot: z.string(), workflowId: z.string(), assignmentId: z.string().uuid() }, annotations: destructive }, async (input) => text(await reconcileAgentAssignment(input.projectRoot, input.workflowId, input.assignmentId)));
server.registerTool("classify_task_risk", { description: "Classify fixed review triggers for a task.", inputSchema: { text: z.array(z.string()) }, annotations: readOnly }, async ({ text: input }) => text(classifyRisk(input)));
server.registerTool("acquire_writer_lease", { description: "Acquire the exclusive writer lease for an executor or fixer session.", inputSchema: { projectRoot: z.string(), workflowId: z.string(), role: z.enum(["executor", "fixer"]), sessionId: z.string() }, annotations: additive }, async (input) => text(await acquireLease(input.projectRoot, input.workflowId, input.role, input.sessionId)));
server.registerTool("release_writer_lease", { description: "Release a writer lease owned by this session.", inputSchema: { projectRoot: z.string(), workflowId: z.string(), sessionId: z.string() }, annotations: destructive }, async (input) => text(await releaseLease(input.projectRoot, input.workflowId, input.sessionId)));
server.registerTool("transition_workflow", { description: "Apply a validated workflow state transition; execution is rejected before plan approval.", inputSchema: { projectRoot: z.string(), workflowId: z.string(), status: z.string() }, annotations: destructive }, async (input) => text(await transitionWorkflow(input.projectRoot, input.workflowId, input.status)));
server.registerTool("completion_gate", { description: "Check mandatory whole-phase review and conditional live browser evidence.", inputSchema: { projectRoot: z.string(), workflowId: z.string() }, annotations: readOnly }, async (input) => text(await assessCompletionGate(input.projectRoot, input.workflowId)));
server.registerTool("persist_workflow_artifact", { description: "Persist planner, reviewer, report, or browser Markdown verbatim inside the tracked workflow directory after validating front matter and path containment.", inputSchema: { projectRoot: z.string(), workflowId: z.string(), relativePath: z.string(), markdown: z.string() }, annotations: additive }, async (input) => text({ path: await persistWorkflowArtifact(input.projectRoot, input.workflowId, input.relativePath, input.markdown) }));
server.registerTool("record_agent_failure", { description: "Record crash, timeout, malformed output, or missing evidence; allow one fresh-session retry and block on the second failure.", inputSchema: { projectRoot: z.string(), workflowId: z.string(), operationKey: z.string(), reason: z.string() }, annotations: additive }, async (input) => text(await recordAgentFailure(input.projectRoot, input.workflowId, input.operationKey, input.reason)));
server.registerTool("record_agent_success", { description: "Clear the retry counter for a successful routed operation.", inputSchema: { projectRoot: z.string(), workflowId: z.string(), operationKey: z.string() }, annotations: destructive }, async (input) => text(await recordAgentSuccess(input.projectRoot, input.workflowId, input.operationKey)));
server.registerTool("issue_browser_auth_state", { description: "Use a predefined external adapter and return only a short-lived browser storage-state path.", inputSchema: { projectRoot: z.string(), projectId: z.string(), profile: z.string(), host: z.string(), secretsRoot: z.string().optional() }, annotations: additive }, async (input) => text(await issueBrowserAuthState(input)));
server.registerTool("delete_browser_auth_state", { description: "Delete a short-lived browser storage-state file after verification.", inputSchema: { path: z.string(), secretsRoot: z.string().optional() }, annotations: destructive }, async (input) => {
  await deleteBrowserAuthState(input.path, input.secretsRoot);
  return text({ deleted: true });
});

await server.connect(new StdioServerTransport());
