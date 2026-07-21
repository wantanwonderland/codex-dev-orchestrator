import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { addDashboardRoot } from "../src/dashboard/config.js";
import { startDashboardServer } from "../src/dashboard/server.js";

const originalDashboardHome = process.env.CDO_DASHBOARD_HOME;

afterEach(() => {
  if (originalDashboardHome === undefined) delete process.env.CDO_DASHBOARD_HOME;
  else process.env.CDO_DASHBOARD_HOME = originalDashboardHome;
});

describe("dashboard server", () => {
  it("serves loopback monitoring APIs and guards mutations", async () => {
    const root = await mkdtemp(join(tmpdir(), "cdo-dashboard-server-"));
    const project = join(root, "project");
    await mkdir(join(project, ".codex", "workflows", "shared"), { recursive: true });
    await writeFile(join(project, ".codex", "workflow.toml"), '[project]\nid = "server-fixture"\ndefault_branch = "main"\n');
    await writeFile(join(project, ".codex", "workflows", "shared", "index.md"), "---\nschema: cdo/v2\nkind: index\nworkflow_id: shared\nstatus: draft\n---\n");
    const second = join(root, "second");
    await mkdir(join(second, ".codex", "workflows", "shared"), { recursive: true });
    await writeFile(join(second, ".codex", "workflow.toml"), '[project]\nid = "second-fixture"\ndefault_branch = "main"\n');
    await writeFile(join(second, ".codex", "workflows", "shared", "index.md"), "---\nschema: cdo/v2\nkind: index\nworkflow_id: shared\nstatus: draft\n---\n");
    process.env.CDO_DASHBOARD_HOME = join(root, "dashboard-home");
    await addDashboardRoot(root);

    const running = await startDashboardServer({
      port: 0,
      watch: true,
      databasePath: join(root, "dashboard.sqlite"),
      codexStatePath: join(root, "missing-state.sqlite"),
      codexSessionsPath: join(root, "missing-sessions"),
      assetsPath: join(root, "missing-assets"),
      reconcileIntervalMs: 60_000,
    });
    try {
      const health = await running.app.inject({ method: "GET", url: "/api/health", headers: { host: "127.0.0.1" } });
      expect(health.statusCode).toBe(200);
      expect(health.json()).toMatchObject({ ok: true, version: "0.6.0" });

      const settings = await running.app.inject({ method: "GET", url: "/api/settings", headers: { host: "127.0.0.1" } });
      expect(settings.json().roots[0]).toMatchObject({ path: root, projects: 2 });

      const ambiguous = await running.app.inject({ method: "GET", url: "/api/workflows/shared", headers: { host: "127.0.0.1" } });
      expect(ambiguous.statusCode).toBe(409);
      const projectId = running.database.listProjects().find((candidate) => candidate.name === "server-fixture")!.id;
      const scoped = await running.app.inject({ method: "GET", url: `/api/workflows/shared?projectId=${projectId}`, headers: { host: "127.0.0.1" } });
      expect(scoped.statusCode).toBe(200);
      expect(scoped.json()).toMatchObject({ projectId, id: "shared" });

      await new Promise((resolve) => setTimeout(resolve, 150));
      await writeFile(join(project, ".codex", "workflows", "shared", "index.md"), "---\nschema: cdo/v2\nkind: index\nworkflow_id: shared\nstatus: complete\nupdated_at: 2026-07-21T00:00:00.000Z\n---\n");
      let observed = false;
      for (let attempt = 0; attempt < 20 && !observed; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        const updated = await running.app.inject({ method: "GET", url: `/api/workflows/shared?projectId=${projectId}`, headers: { host: "127.0.0.1" } });
        observed = updated.json().status === "complete";
      }
      expect(observed).toBe(true);

      const rejected = await running.app.inject({ method: "POST", url: "/api/purge", headers: { host: "127.0.0.1", origin: "https://example.com", "content-type": "application/json" }, payload: { confirm: true } });
      expect(rejected.statusCode).toBe(403);

      const unconfirmed = await running.app.inject({ method: "POST", url: "/api/purge", headers: { host: "127.0.0.1", "content-type": "application/json" }, payload: {} });
      expect(unconfirmed.statusCode).toBe(400);

      const telemetry = await running.app.inject({ method: "POST", url: "/v1/logs", headers: { host: "127.0.0.1", "content-type": "application/json" }, payload: { resourceLogs: [] } });
      expect(telemetry.statusCode).toBe(202);
    } finally {
      await running.close();
    }
  });
});
