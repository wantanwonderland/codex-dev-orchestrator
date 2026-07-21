import { access, readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadProjectConfig } from "./config.js";
import { AssignmentStore } from "./assignments.js";
import { StateStore } from "./state-store.js";
import { workflowRuntimeRoot } from "./project-root.js";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

export async function selfDoctor(): Promise<string[]> {
  const required = [
    ".codex-plugin/plugin.json",
    "hooks/hooks.json",
    "skills/orchestrating-development/SKILL.md",
    "agents/planner.toml",
    "agents/reviewer.toml",
    "dist/mcp.js",
    "dist/hook.js",
  ];
  for (const path of required) await access(join(ROOT, path));
  const manifest = JSON.parse(await readFile(join(ROOT, ".codex-plugin/plugin.json"), "utf8"));
  if (manifest.name !== "codex-dev-orchestrator") throw new Error("Plugin manifest name mismatch");
  const hooks = JSON.parse(await readFile(join(ROOT, "hooks/hooks.json"), "utf8"));
  if (!hooks.hooks?.SubagentStart || !hooks.hooks?.SubagentStop) throw new Error("Subagent lifecycle hooks are missing");
  return required;
}

export async function projectDoctor(projectRoot: string): Promise<string[]> {
  await loadProjectConfig(projectRoot);
  const checks = [".codex/workflow.toml", ".codex/cdo-managed.json", ".codex/agents/planner.toml", ".codex/agents/reviewer.toml"];
  for (const path of checks) {
    try {
      await access(join(projectRoot, path));
    } catch (error) {
      if (path === ".codex/cdo-managed.json") throw new Error("Project agent templates predate CDO 0.3.0; run cdo upgrade-project");
      throw error;
    }
  }
  const managed = JSON.parse(await readFile(join(projectRoot, ".codex/cdo-managed.json"), "utf8"));
  if (managed.version !== "0.3.0") throw new Error("Project agent templates are outdated; run cdo upgrade-project");
  const runtimeRoot = workflowRuntimeRoot(projectRoot);
  for (const entry of await readdir(runtimeRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    await new StateStore(projectRoot, entry.name).load();
    await new AssignmentStore(projectRoot, entry.name).load();
    checks.push(`.codex/workflow-runtime/${entry.name}`);
  }
  return checks;
}
