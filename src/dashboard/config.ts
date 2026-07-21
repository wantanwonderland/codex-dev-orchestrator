import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export const DASHBOARD_HOST = "127.0.0.1";
export const DASHBOARD_PORT = 47831;

export interface DashboardConfig {
  roots: string[];
  host: string;
  port: number;
  reconcileIntervalMs: number;
}

export function dashboardHome(): string {
  return resolve(process.env.CDO_DASHBOARD_HOME ?? join(homedir(), ".codex-dev-orchestrator"));
}

export function dashboardDatabasePath(): string {
  return join(dashboardHome(), "dashboard.sqlite");
}

export function dashboardConfigPath(): string {
  return join(dashboardHome(), "dashboard.json");
}

export async function loadDashboardConfig(): Promise<DashboardConfig> {
  const defaults: DashboardConfig = {
    roots: [],
    host: DASHBOARD_HOST,
    port: DASHBOARD_PORT,
    reconcileIntervalMs: 60_000,
  };
  try {
    const parsed = JSON.parse(await readFile(dashboardConfigPath(), "utf8")) as Partial<DashboardConfig>;
    return {
      ...defaults,
      ...parsed,
      host: DASHBOARD_HOST,
      roots: [...new Set((parsed.roots ?? []).map((root) => resolve(root)))],
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return defaults;
  }
}

export async function saveDashboardConfig(config: DashboardConfig): Promise<void> {
  const path = dashboardConfigPath();
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify({ ...config, host: DASHBOARD_HOST }, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
  await chmod(path, 0o600);
}

export async function addDashboardRoot(root: string): Promise<DashboardConfig> {
  const config = await loadDashboardConfig();
  const normalized = resolve(root);
  if (!config.roots.includes(normalized)) config.roots.push(normalized);
  await saveDashboardConfig(config);
  return config;
}

export async function removeDashboardRoot(root: string): Promise<DashboardConfig> {
  const config = await loadDashboardConfig();
  const normalized = resolve(root);
  config.roots = config.roots.filter((candidate) => candidate !== normalized);
  await saveDashboardConfig(config);
  return config;
}
