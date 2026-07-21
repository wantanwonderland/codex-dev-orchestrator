import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { initializeProject, resetProject, startWorkflow, upgradeProject } from "../src/project.js";
import { statusSummary } from "../src/workflow.js";
import { projectDoctor } from "../src/doctor.js";
import { run } from "../src/process.js";
import { StateStore } from "../src/state-store.js";

async function initializeGit(root: string): Promise<void> {
  await run("git", ["init", "-b", "main"], root);
  await run("git", ["config", "user.email", "cdo@example.test"], root);
  await run("git", ["config", "user.name", "CDO Test"], root);
  await writeFile(join(root, "README.md"), "# Test\n");
  await run("git", ["add", "."], root);
  await run("git", ["commit", "-m", "initial"], root);
}

describe("project initialization", () => {
  it("creates config, agents, tracked artifacts, and untracked runtime rules", async () => {
    const root = await mkdtemp(join(tmpdir(), "cdo-project-"));
    await initializeProject(root, { projectId: "demo", defaultBranch: "main" });
    await initializeGit(root);
    await startWorkflow(root, { workflowId: "wf-demo", objective: "Build a feature", tier: "normal" });

    expect(await readFile(join(root, ".codex/workflow.toml"), "utf8")).toContain('coordinator = "gpt-5.6-terra"');
    expect(await readFile(join(root, ".codex/workflow.toml"), "utf8")).toContain("allow_direct_local_access = true");
    expect(await readFile(join(root, ".codex/agents/researcher.toml"), "utf8")).toContain('web_search = "live"');
    expect(await readFile(join(root, ".codex/agents/planner.toml"), "utf8")).toContain('model = "gpt-5.6-sol"');
    expect(await readFile(join(root, ".worktrees/wf-demo/.codex/workflows/wf-demo/spec.md"), "utf8")).toContain("Build a feature");
    expect(await readFile(join(root, ".codex/cdo-managed.json"), "utf8")).toContain('"version": "0.5.0"');
    expect(await readFile(join(root, ".gitignore"), "utf8")).toContain(".codex/workflow-runtime/");
    expect((await statusSummary(root, "wf-demo")).coordination.nextAction).toBe("assign_researcher");
    expect((await new StateStore(root, "wf-demo").load()).worktree).toMatchObject({ branch: "cdo/wf-demo", worktreePath: await realpath(join(root, ".worktrees", "wf-demo")) });
    await expect(readFile(join(root, ".codex/workflows/wf-demo/index.md"), "utf8")).rejects.toThrow();
  });

  it("checkpoints a dirty primary checkout before creating the workflow worktree", async () => {
    const root = await mkdtemp(join(tmpdir(), "cdo-project-"));
    await initializeProject(root, { projectId: "demo", defaultBranch: "main" });
    await initializeGit(root);
    await writeFile(join(root, "dirty.txt"), "preserve me\n");
    await startWorkflow(root, { workflowId: "wf-dirty", objective: "Build", tier: "small" });
    expect((await run("git", ["log", "-1", "--format=%s"], root)).stdout.trim()).toBe("chore(cdo): checkpoint before wf-dirty");
    expect(await readFile(join(root, ".worktrees/wf-dirty/dirty.txt"), "utf8")).toBe("preserve me\n");
  });

  it("creates research and brainstorming artifacts without placeholder tasks", async () => {
    const root = await mkdtemp(join(tmpdir(), "cdo-project-"));
    await initializeProject(root, { projectId: "demo", defaultBranch: "main" });
    await initializeGit(root);
    await startWorkflow(root, { workflowId: "wf-research", objective: "Build", tier: "normal" });
    expect(await readFile(join(root, ".worktrees/wf-research/.codex/workflows/wf-research/research.md"), "utf8")).toContain("current web sources");
    expect(await readFile(join(root, ".worktrees/wf-research/.codex/workflows/wf-research/decisions.md"), "utf8")).toContain("Brainstorming decisions");
    await expect(readFile(join(root, ".worktrees/wf-research/.codex/workflows/wf-research/tasks/task-1.md"), "utf8")).rejects.toThrow();
  });

  it("resets only managed workflow data", async () => {
    const root = await mkdtemp(join(tmpdir(), "cdo-project-"));
    await initializeProject(root, { projectId: "demo", defaultBranch: "main" });
    await initializeGit(root);
    await startWorkflow(root, { workflowId: "wf-reset", objective: "Build", tier: "normal" });
    await resetProject(root);
    expect(await readFile(join(root, ".codex/workflow.toml"), "utf8")).toContain('id = "demo"');
    await expect(readFile(join(root, ".worktrees/wf-reset/.codex/workflows/wf-reset/index.md"), "utf8")).resolves.toContain("wf-reset");
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
    expect(await readFile(join(root, ".codex/cdo-managed.json"), "utf8")).toContain('"version": "0.5.0"');
    const repeated = await upgradeProject(root);
    expect(repeated.recommended).toContain(".codex/agents/coordinator.cdo-recommended.toml");
    expect(await readFile(coordinator, "utf8")).toContain("project customization");
  });

  it("recognizes and replaces a stock 0.1.1 coordinator template", async () => {
    const root = await mkdtemp(join(tmpdir(), "cdo-project-"));
    await initializeProject(root, { projectId: "demo", defaultBranch: "main" });
    await initializeGit(root);
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
    expect(await readFile(coordinator, "utf8")).toContain("Own the workflow until it is complete");
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
    await initializeGit(root);
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
