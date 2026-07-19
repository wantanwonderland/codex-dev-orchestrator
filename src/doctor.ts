import { access, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadProjectConfig } from "./config.js";

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
  return required;
}

export async function projectDoctor(projectRoot: string): Promise<string[]> {
  await loadProjectConfig(projectRoot);
  const checks = [".codex/workflow.toml", ".codex/agents/planner.toml", ".codex/agents/reviewer.toml"];
  for (const path of checks) await access(join(projectRoot, path));
  return checks;
}
