import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { approvePlan, initializeProject, startWorkflow, upgradeProject } from "../src/project.js";
import { createAgentAssignment, reconcileAgentAssignment, statusSummary, transitionWorkflow } from "../src/workflow.js";
import { AssignmentStore } from "../src/assignments.js";
import { renderArtifact } from "../src/frontmatter.js";
import { projectDoctor } from "../src/doctor.js";

async function reconcilePlan(root: string, workflowId: string): Promise<void> {
  const assignment = await createAgentAssignment(root, workflowId, {
    operationKey: "planning",
    role: "planner",
    stage: "planning",
    inputPath: "spec.md",
    outputPath: "plan.md",
    expectedKind: "plan",
  });
  const assignments = new AssignmentStore(root, workflowId);
  await assignments.bindStartedById(assignment.id, "planner-agent");
  await assignments.bindStoppedById(assignment.id, "planner-agent");
  const now = new Date().toISOString();
  await writeFile(join(root, ".codex/workflows", workflowId, "plan.md"), renderArtifact({
    schema: "cdo/v1",
    kind: "plan",
    workflow_id: workflowId,
    status: "awaiting_approval",
    created_at: now,
    updated_at: now,
    assignment_id: assignment.id,
    operation_key: assignment.operationKey,
    agent_role: "planner",
  }, "# Verified implementation plan\n\nImplement and test the requested feature."));
  await reconcileAgentAssignment(root, workflowId, assignment.id);
}

describe("project initialization", () => {
  it("creates config, agents, tracked artifacts, and untracked runtime rules", async () => {
    const root = await mkdtemp(join(tmpdir(), "cdo-project-"));
    await initializeProject(root, { projectId: "demo", defaultBranch: "main" });
    await startWorkflow(root, { workflowId: "wf-demo", objective: "Build a feature", tier: "normal" });

    expect(await readFile(join(root, ".codex/workflow.toml"), "utf8")).toContain('coordinator = "gpt-5.6-terra"');
    expect(await readFile(join(root, ".codex/agents/planner.toml"), "utf8")).toContain('model = "gpt-5.6-sol"');
    expect(await readFile(join(root, ".codex/workflows/wf-demo/spec.md"), "utf8")).toContain("Build a feature");
    expect(await readFile(join(root, ".codex/cdo-managed.json"), "utf8")).toContain('"version": "0.2.0"');
    expect(await readFile(join(root, ".gitignore"), "utf8")).toContain(".codex/workflow-runtime/");
    expect((await statusSummary(root, "wf-demo")).coordination.nextAction).toBe("assign_planner");
  });

  it("invalidates approval when the persisted plan changes", async () => {
    const root = await mkdtemp(join(tmpdir(), "cdo-project-"));
    await initializeProject(root, { projectId: "demo", defaultBranch: "main" });
    await startWorkflow(root, { workflowId: "wf-change", objective: "Build a feature", tier: "normal" });
    await reconcilePlan(root, "wf-change");
    await approvePlan(root, "wf-change", "human");
    await writeFile(join(root, ".codex/workflows/wf-change/plan.md"), "changed after approval\n");
    await expect(transitionWorkflow(root, "wf-change", "executing")).rejects.toThrow(/changed after approval/);
  });

  it("rejects approval of the generated placeholder plan", async () => {
    const root = await mkdtemp(join(tmpdir(), "cdo-project-"));
    await initializeProject(root, { projectId: "demo", defaultBranch: "main" });
    await startWorkflow(root, { workflowId: "wf-placeholder", objective: "Build a feature", tier: "normal" });
    await expect(approvePlan(root, "wf-placeholder", "human")).rejects.toThrow(/reconciled planner assignment/);
  });

  it("rejects unsafe workflow IDs before creating directories", async () => {
    const root = await mkdtemp(join(tmpdir(), "cdo-project-"));
    await initializeProject(root, { projectId: "demo", defaultBranch: "main" });
    await expect(startWorkflow(root, { workflowId: "../escape", objective: "unsafe", tier: "normal" })).rejects.toThrow();
    await expect(readFile(join(root, ".codex/escape/index.md"), "utf8")).rejects.toThrow();
  });

  it("upgrades stock agent templates and preserves customized files", async () => {
    const root = await mkdtemp(join(tmpdir(), "cdo-project-"));
    await initializeProject(root, { projectId: "demo", defaultBranch: "main" });
    const coordinator = join(root, ".codex/agents/coordinator.toml");
    await writeFile(coordinator, `${await readFile(coordinator, "utf8")}\n# project customization\n`);

    const result = await upgradeProject(root);
    expect(result.recommended).toContain(".codex/agents/coordinator.cdo-recommended.toml");
    expect(await readFile(coordinator, "utf8")).toContain("project customization");
    expect(await readFile(join(root, ".codex/cdo-managed.json"), "utf8")).toContain('"version": "0.2.0"');
    const repeated = await upgradeProject(root);
    expect(repeated.recommended).toContain(".codex/agents/coordinator.cdo-recommended.toml");
    expect(await readFile(coordinator, "utf8")).toContain("project customization");
  });

  it("recognizes and replaces a stock 0.1.1 coordinator template", async () => {
    const root = await mkdtemp(join(tmpdir(), "cdo-project-"));
    await initializeProject(root, { projectId: "demo", defaultBranch: "main" });
    const coordinator = join(root, ".codex/agents/coordinator.toml");
    await writeFile(coordinator, `name = "coordinator"
description = "Persistent workflow brain that routes planning, execution, review, remediation, and verification."
model = "gpt-5.6-terra"
model_reasoning_effort = "medium"
sandbox_mode = "workspace-write"
developer_instructions = """
Act as the workflow coordinator, not the primary implementer. Read .codex/workflow.toml, the active tracked workflow artifacts, and runtime state before routing work. Require explicit persisted plan approval before execution. Spawn fresh role-specific agents and give them file paths plus concise routing metadata, never a rewritten copy of planner or reviewer content. Enforce one writer at a time. Route high-risk tasks to independent review and always require a whole-phase reviewer before completion. Require live browser verification for customer-visible UI. Do not deploy or perform production mutations without explicit current human instruction.
"""
`);
    await writeFile(join(root, ".codex/cdo-managed.json"), JSON.stringify({ schema: "cdo-managed/v1", version: "0.1.1", agentHashes: {} }));

    const result = await upgradeProject(root);
    expect(result.updated).toContain(".codex/agents/coordinator.toml");
    expect(await readFile(coordinator, "utf8")).toContain("Create a durable assignment before every spawn");
  });

  it("restores a missing managed template during upgrade", async () => {
    const root = await mkdtemp(join(tmpdir(), "cdo-project-"));
    await initializeProject(root, { projectId: "demo", defaultBranch: "main" });
    const planner = join(root, ".codex/agents/planner.toml");
    await rm(planner);
    const result = await upgradeProject(root);
    expect(result.updated).toContain(".codex/agents/planner.toml");
    expect(await readFile(planner, "utf8")).toContain('name = "planner"');
  });

  it("fails doctor when an active assignment ledger is corrupt", async () => {
    const root = await mkdtemp(join(tmpdir(), "cdo-project-"));
    await initializeProject(root, { projectId: "demo", defaultBranch: "main" });
    await startWorkflow(root, { workflowId: "wf-corrupt", objective: "Build", tier: "normal" });
    await writeFile(join(root, ".codex/workflow-runtime/wf-corrupt/sessions.json"), "not-json");
    await expect(projectDoctor(root)).rejects.toThrow();
  });

  it("does not overwrite templates when the managed manifest is malformed", async () => {
    const root = await mkdtemp(join(tmpdir(), "cdo-project-"));
    await initializeProject(root, { projectId: "demo", defaultBranch: "main" });
    const coordinator = join(root, ".codex/agents/coordinator.toml");
    const before = await readFile(coordinator, "utf8");
    await writeFile(join(root, ".codex/cdo-managed.json"), "not-json");
    await expect(upgradeProject(root)).rejects.toThrow();
    expect(await readFile(coordinator, "utf8")).toBe(before);
  });
});
