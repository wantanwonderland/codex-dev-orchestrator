import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Sqlite from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { DashboardDatabase, defaultDashboardPaths } from "../src/dashboard/database.js";

describe("DashboardDatabase", () => {
  it("uses private-home defaults and persists roots across reopen", async () => {
    const home = await mkdtemp(join(tmpdir(), "cdo-dashboard-db-home-"));
    expect(defaultDashboardPaths(home).databasePath).toBe(join(home, ".codex-dev-orchestrator", "dashboard.sqlite"));
    const path = join(home, "injected.sqlite");
    let database = new DashboardDatabase({ databasePath: path, now: () => new Date("2026-07-21T00:00:00Z") });
    const first = database.registerRoot(join(home, "projects"), "Work");
    expect(first).toMatchObject({ id: 1, label: "Work", lastScannedAt: null });
    database.close();

    database = new DashboardDatabase({ databasePath: path });
    expect(database.listRoots()).toHaveLength(1);
    expect(database.registerRoot(join(home, "projects"))).toMatchObject({ id: 1, label: "Work" });
    database.close();
  });

  it("replaces project metadata transactionally and aggregates token coverage", async () => {
    const root = await mkdtemp(join(tmpdir(), "cdo-dashboard-db-"));
    const database = new DashboardDatabase({ databasePath: join(root, "dashboard.sqlite") });
    const registered = database.registerRoot(root);
    database.replaceProjectSnapshot({
      project: { id: "project-1", rootId: registered.id, path: root, canonicalPath: root, gitCommonDir: null, name: "demo", projectKey: "demo", defaultBranch: "main" },
      locations: [{ rootId: registered.id, path: root }],
      workflows: [{ workflowId: "wf-1", path: join(root, ".codex/workflows/wf-1"), kind: "index", status: "executing", phase: "phase-1", createdAt: null, updatedAt: null }],
      tasks: [{ workflowId: "wf-1", taskKey: "task-1", source: "assignment", kind: "executor-report", status: "running", role: "executor", stage: "implementation", operationKey: "task-1", fileName: "reports/task-1.md", updatedAt: null }],
      history: [{ workflowId: "wf-1", eventKey: "event-1", type: "workflow.created", status: "draft_plan", summary: "workflow.created: draft_plan", occurredAt: null, sourcePath: "events.jsonl" }],
    });
    database.replaceSession({
      id: "session-1", projectId: "project-1", parentSessionId: null, rolloutPath: null, cwd: root, title: null,
      source: "user", model: "gpt-test", role: null, createdAt: null, updatedAt: null, coverage: "exact",
      inheritedPrefixTokens: 0, rawTotalTokens: 12, inputTokens: 10, cachedInputTokens: 4,
      outputTokens: 2, reasoningOutputTokens: 1, totalTokens: 12,
    }, []);
    expect(database.listWorkflows("project-1")).toHaveLength(1);
    expect(database.listTasks("project-1", "wf-1")[0]).toMatchObject({ role: "executor", status: "running" });
    expect(database.listHistory("project-1", "wf-1")[0].summary).toBe("workflow.created: draft_plan");
    expect(database.getTokenTotals()).toMatchObject({ totalTokens: 12, allocatedTokens: 12, coverage: { exact: 1, backfilled: 0, partial: 0, offline: 0 } });
    database.close();
  });

  it("persists a purge cutoff and prevents old observations from being re-imported", async () => {
    const root = await mkdtemp(join(tmpdir(), "cdo-dashboard-purge-"));
    const database = new DashboardDatabase({ databasePath: join(root, "dashboard.sqlite"), now: () => new Date("2026-07-21T00:00:00Z") });
    const registered = database.registerRoot(root);
    const snapshot = {
      project: { id: "project", rootId: registered.id, path: root, canonicalPath: root, gitCommonDir: null, name: "demo", projectKey: "demo", defaultBranch: "main" },
      locations: [{ rootId: registered.id, path: root }],
      workflows: [{ workflowId: "wf", path: root, kind: "index", status: "complete", phase: "review", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z" }],
      tasks: [],
      history: [{ workflowId: "wf", eventKey: "old", type: "old", status: "complete", summary: "old", occurredAt: "2026-01-02T00:00:00.000Z", sourcePath: "events.jsonl" }],
    };
    database.replaceProjectSnapshot(snapshot);
    const oldSession = { id: "old", projectId: "project", parentSessionId: null, rolloutPath: null, cwd: root, title: null, source: "user", model: "gpt-test", role: null, agentPath: null, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z", coverage: "exact" as const, inheritedPrefixTokens: 0, rawTotalTokens: 10, inputTokens: 10, cachedInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0, totalTokens: 10 };
    database.replaceSession(oldSession, []);
    expect(database.purgeHistory("2026-06-01T00:00:00.000Z")).toBe(2);
    database.replaceProjectSnapshot(snapshot);
    database.replaceSession(oldSession, []);
    expect(database.listHistory()).toHaveLength(0);
    expect(database.listSessions()).toHaveLength(0);
    expect(database.getSetting("history_cutoff")).toBe("2026-06-01T00:00:00.000Z");
    database.purgeHistory("2026-05-01T00:00:00.000Z");
    expect(database.getSetting("history_cutoff")).toBe("2026-06-01T00:00:00.000Z");
    expect(database.getSetting("last_purge_at")).toBe("2026-07-21T00:00:00.000Z");
    database.close();
  });

  it("rejects a database created by a newer dashboard schema", async () => {
    const root = await mkdtemp(join(tmpdir(), "cdo-dashboard-future-"));
    const path = join(root, "dashboard.sqlite");
    const future = new Sqlite(path);
    future.exec("CREATE TABLE schema_meta(version INTEGER NOT NULL); INSERT INTO schema_meta VALUES (99)");
    future.close();
    expect(() => new DashboardDatabase({ databasePath: path })).toThrow("newer than supported");
  });

  it("retains a project discovered through overlapping registered roots", async () => {
    const root = await mkdtemp(join(tmpdir(), "cdo-dashboard-overlap-"));
    const database = new DashboardDatabase({ databasePath: join(root, "dashboard.sqlite") });
    const first = database.registerRoot(root);
    const second = database.registerRoot(join(root, "nested"));
    database.replaceProjectSnapshot({
      project: { id: "shared", rootId: first.id, path: join(root, "project"), canonicalPath: join(root, "project"), gitCommonDir: null, name: "shared", projectKey: "shared", defaultBranch: "main" },
      locations: [{ rootId: first.id, path: join(root, "project") }, { rootId: second.id, path: join(root, "project") }],
      workflows: [], tasks: [], history: [],
    });
    expect(database.listProjectLocations()).toHaveLength(2);
    database.removeRoot(first.id);
    expect(database.getProject("shared")).toMatchObject({ rootId: second.id });
    database.close();
  });
});
