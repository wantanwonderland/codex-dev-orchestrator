import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DashboardDatabase } from "../src/dashboard/database.js";
import { scanRegisteredRoots } from "../src/dashboard/scanner.js";

async function createWorktreeProject(path: string, gitDir: string, id: string): Promise<void> {
  await mkdir(join(path, ".codex", "workflows", "wf-1", "tasks"), { recursive: true });
  await mkdir(join(path, ".codex", "workflow-runtime", "wf-1"), { recursive: true });
  await mkdir(gitDir, { recursive: true });
  await writeFile(join(path, ".git"), `gitdir: ${gitDir}\n`);
  await writeFile(join(gitDir, "commondir"), "../..\n");
  await writeFile(join(path, ".codex", "workflow.toml"), `[project]\nid = "${id}"\ndefault_branch = "main"\n`);
  await writeFile(join(path, ".codex", "workflows", "wf-1", "index.md"), "---\nschema: cdo/v2\nkind: index\nworkflow_id: wf-1\nstatus: approved\ncreated_at: 2026-07-20T00:00:00.000Z\nupdated_at: 2026-07-20T01:00:00.000Z\n---\nSECRET PROMPT BODY MUST NOT BE INDEXED\n");
  await writeFile(join(path, ".codex", "workflows", "wf-1", "tasks", "task-1.md"), "---\nschema: cdo/v2\nkind: task-brief\nworkflow_id: wf-1\ntask: task-1\nstatus: in_progress\ncreated_at: 2026-07-20T00:00:00.000Z\nupdated_at: 2026-07-20T02:00:00.000Z\n---\nPRIVATE TOOL OUTPUT\n");
  await writeFile(join(path, ".codex", "workflow-runtime", "wf-1", "state.json"), JSON.stringify({ status: "executing", phase: "phase-2", updatedAt: "2026-07-20T03:00:00.000Z" }));
  await writeFile(join(path, ".codex", "workflow-runtime", "wf-1", "sessions.json"), JSON.stringify({ assignments: [{ id: "a-1", operationKey: "task-1", role: "executor", stage: "implementation", expectedKind: "executor-report", status: "running", assignedAt: "2026-07-20T02:30:00.000Z" }] }));
  await writeFile(join(path, ".codex", "workflow-runtime", "wf-1", "events.jsonl"), `${JSON.stringify({ at: "2026-07-20T03:00:00.000Z", type: "execution.started", detail: { status: "executing", prompt: "DO NOT STORE" } })}\nnot-json\n`);
}

describe("dashboard project scanner", () => {
  it("scans recursively, deduplicates worktrees by common git directory, and stores metadata only", async () => {
    const root = await mkdtemp(join(tmpdir(), "cdo-dashboard-scan-"));
    const common = join(root, "repository", ".git");
    await mkdir(common, { recursive: true });
    const first = join(root, "projects", "one");
    const second = join(root, "projects", "two");
    await createWorktreeProject(first, join(common, "worktrees", "one"), "demo-one");
    await createWorktreeProject(second, join(common, "worktrees", "two"), "demo-two");
    await mkdir(join(second, ".codex", "workflows", "wf-2"), { recursive: true });
    await writeFile(join(second, ".codex", "workflows", "wf-2", "index.md"), "---\nschema: cdo/v2\nkind: index\nworkflow_id: wf-2\nstatus: draft\nupdated_at: 2026-07-21T00:00:00.000Z\n---\n");
    const database = new DashboardDatabase({ databasePath: join(root, "dashboard.sqlite") });
    database.registerRoot(join(root, "projects"));

    const result = await scanRegisteredRoots(database, { maxDepth: 4, maxDirectories: 50 });
    expect(result).toMatchObject({ projectsFound: 2, projectsStored: 1, truncated: false });
    expect(database.listProjects()).toHaveLength(1);
    expect(database.listWorkflows().find((workflow) => workflow.workflowId === "wf-1")).toMatchObject({ status: "executing", phase: "phase-2" });
    expect(database.listWorkflows().map((workflow) => workflow.workflowId).sort()).toEqual(["wf-1", "wf-2"]);
    expect(database.listTasks().map((task) => task.source).sort()).toEqual(["artifact", "assignment"]);
    expect(database.listHistory().map((event) => event.summary).join(" ")).not.toContain("SECRET PROMPT");
    expect(database.listHistory().find((event) => event.type === "execution.started")).toMatchObject({ summary: "execution.started: executing" });
    expect(result.issues.some((issue) => issue.path.endsWith("events.jsonl:2"))).toBe(true);

    await scanRegisteredRoots(database, { maxDepth: 4, maxDirectories: 50 });
    expect(database.listProjects()).toHaveLength(1);
    expect(database.listWorkflows()).toHaveLength(2);
    database.close();
  });

  it("bounds traversal and tolerates unreadable or corrupt metadata", async () => {
    const root = await mkdtemp(join(tmpdir(), "cdo-dashboard-bounded-"));
    await mkdir(join(root, "a", "b", "c"), { recursive: true });
    const project = join(root, "project");
    await mkdir(join(project, ".codex"), { recursive: true });
    await writeFile(join(project, ".codex", "workflow.toml"), "not valid [ toml");
    const database = new DashboardDatabase({ databasePath: join(root, "dashboard.sqlite") });
    database.registerRoot(root);
    const result = await scanRegisteredRoots(database, { maxDepth: 4, maxDirectories: 2 });
    expect(result.truncated).toBe(true);
    const complete = await scanRegisteredRoots(database, { maxDepth: 4, maxDirectories: 50 });
    expect(complete.issues.some((issue) => issue.path.endsWith("workflow.toml"))).toBe(true);
    expect(database.listProjects()).toHaveLength(1);
    database.close();
  });

  it("applies the directory budget independently to every registered root", async () => {
    const root = await mkdtemp(join(tmpdir(), "cdo-dashboard-multi-root-"));
    const database = new DashboardDatabase({ databasePath: join(root, "dashboard.sqlite") });
    for (const name of ["first", "second"]) {
      const scanRoot = join(root, name);
      await mkdir(join(scanRoot, ".codex"), { recursive: true });
      await writeFile(join(scanRoot, ".codex", "workflow.toml"), `[project]\nid = "${name}"\n`);
      database.registerRoot(scanRoot);
    }
    const result = await scanRegisteredRoots(database, { maxDirectories: 1 });
    expect(result).toMatchObject({ rootsScanned: 2, projectsStored: 2, truncated: false });
    expect(database.listProjects()).toHaveLength(2);
    database.close();
  });

  it("discovers Git repositories that do not yet have CDO workflow metadata", async () => {
    const root = await mkdtemp(join(tmpdir(), "cdo-dashboard-git-project-"));
    const project = join(root, "repository-only");
    await mkdir(join(project, ".git"), { recursive: true });
    const database = new DashboardDatabase({ databasePath: join(root, "dashboard.sqlite") });
    database.registerRoot(root);

    const result = await scanRegisteredRoots(database, { maxDirectories: 10 });

    expect(result).toMatchObject({ projectsFound: 1, projectsStored: 1, truncated: false });
    expect(database.listProjects()).toHaveLength(1);
    expect(database.listProjects()[0]).toMatchObject({ name: "repository-only", path: project, projectKey: null });
    expect(database.listWorkflows()).toEqual([]);
    database.close();
  });
});
