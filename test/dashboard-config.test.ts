import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { addDashboardRoot, dashboardConfigPath, loadDashboardConfig, removeDashboardRoot } from "../src/dashboard/config.js";
import { setupTelemetry, telemetryStatus } from "../src/dashboard/telemetry.js";

const originalHome = process.env.CDO_DASHBOARD_HOME;

afterEach(() => {
  if (originalHome === undefined) delete process.env.CDO_DASHBOARD_HOME;
  else process.env.CDO_DASHBOARD_HOME = originalHome;
});

describe("dashboard configuration", () => {
  it("registers normalized roots idempotently and persists private configuration", async () => {
    const home = await mkdtemp(join(tmpdir(), "cdo-dashboard-config-"));
    process.env.CDO_DASHBOARD_HOME = home;
    const project = join(home, "projects", "sample");

    await addDashboardRoot(project);
    await addDashboardRoot(join(project, "."));
    expect((await loadDashboardConfig()).roots).toEqual([project]);

    await removeDashboardRoot(project);
    expect((await loadDashboardConfig()).roots).toEqual([]);
    expect(JSON.parse(await readFile(dashboardConfigPath(), "utf8"))).toMatchObject({ host: "127.0.0.1" });
  });
});

describe("Codex telemetry setup", () => {
  it("adds one managed prompt-safe OTLP block", async () => {
    const root = await mkdtemp(join(tmpdir(), "cdo-otel-"));
    const path = join(root, "config.toml");
    await writeFile(path, 'model = "gpt-5.6-terra"\n');

    await setupTelemetry(path, 47831);
    await setupTelemetry(path, 47831);
    const content = await readFile(path, "utf8");
    expect(content.match(/\[otel\]/g)).toHaveLength(1);
    expect(content).toContain('endpoint = "http://127.0.0.1:47831/v1/logs"');
    expect(content).toContain("log_user_prompt = false");
    expect(await telemetryStatus(path)).toMatchObject({ configured: true, managed: true });
  });

  it("refuses to overwrite an unmanaged OTel table", async () => {
    const root = await mkdtemp(join(tmpdir(), "cdo-otel-owned-"));
    const path = join(root, "config.toml");
    await writeFile(path, '[otel]\nexporter = "none"\n');
    await expect(setupTelemetry(path)).rejects.toThrow("unmanaged [otel]");
  });
});
