import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { approvePlan, initializeProject, startWorkflow } from "../src/project.js";
import { transitionWorkflow } from "../src/workflow.js";

describe("project initialization", () => {
  it("creates config, agents, tracked artifacts, and untracked runtime rules", async () => {
    const root = await mkdtemp(join(tmpdir(), "cdo-project-"));
    await initializeProject(root, { projectId: "demo", defaultBranch: "main" });
    await startWorkflow(root, { workflowId: "wf-demo", objective: "Build a feature", tier: "normal" });

    expect(await readFile(join(root, ".codex/workflow.toml"), "utf8")).toContain('coordinator = "gpt-5.6-terra"');
    expect(await readFile(join(root, ".codex/agents/planner.toml"), "utf8")).toContain('model = "gpt-5.6-sol"');
    expect(await readFile(join(root, ".codex/workflows/wf-demo/spec.md"), "utf8")).toContain("Build a feature");
    expect(await readFile(join(root, ".gitignore"), "utf8")).toContain(".codex/workflow-runtime/");
  });

  it("invalidates approval when the persisted plan changes", async () => {
    const root = await mkdtemp(join(tmpdir(), "cdo-project-"));
    await initializeProject(root, { projectId: "demo", defaultBranch: "main" });
    await startWorkflow(root, { workflowId: "wf-change", objective: "Build a feature", tier: "normal" });
    await approvePlan(root, "wf-change", "human");
    await writeFile(join(root, ".codex/workflows/wf-change/plan.md"), "changed after approval\n");
    await expect(transitionWorkflow(root, "wf-change", "executing")).rejects.toThrow(/changed after approval/);
  });
});
