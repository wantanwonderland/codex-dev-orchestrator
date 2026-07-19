import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "smol-toml";
import { ProjectConfigSchema, type ProjectConfig } from "./types.js";

export async function loadProjectConfig(projectRoot: string): Promise<ProjectConfig> {
  const raw = await readFile(join(projectRoot, ".codex", "workflow.toml"), "utf8");
  return ProjectConfigSchema.parse(parse(raw));
}
