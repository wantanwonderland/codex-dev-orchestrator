#!/usr/bin/env node
import { lstat, readFile, realpath, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pluginRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const marketplacePath = join(homedir(), ".agents", "plugins", "marketplace.json");
const linkPath = join(homedir(), "plugins", "codex-dev-orchestrator");
const cliTarget = join(pluginRoot, "dist", "cli.js");
const cliPath = join(homedir(), ".local", "bin", "cdo");
const mcpTarget = join(pluginRoot, "dist", "mcp.js");
const existingMcp = spawnSync("codex", ["mcp", "get", "codex-dev-orchestrator"], { encoding: "utf8" });
if (existingMcp.error) throw new Error(`Unable to run Codex CLI: ${existingMcp.error.message}`);
if (existingMcp.status === 0 && !existingMcp.stdout.includes(mcpTarget)) {
  throw new Error("Refusing to remove an unrelated Codex MCP registration named codex-dev-orchestrator");
}

for (const [path, target, label] of [[linkPath, pluginRoot, "source symlink"], [cliPath, cliTarget, "CLI symlink"]]) {
  try {
    const info = await lstat(path);
    if (!info.isSymbolicLink() || (await realpath(path)) !== (await realpath(target))) {
      throw new Error(`Refusing to remove ${path}; it is not this checkout's ${label}`);
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}
const marketplace = JSON.parse(await readFile(marketplacePath, "utf8"));
marketplace.plugins = marketplace.plugins.filter((item) => item.name !== "codex-dev-orchestrator");
await writeFile(marketplacePath, `${JSON.stringify(marketplace, null, 2)}\n`);
try {
  await unlink(linkPath);
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}
try {
  await unlink(cliPath);
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}
if (existingMcp.status === 0) {
  const removedMcp = spawnSync("codex", ["mcp", "remove", "codex-dev-orchestrator"], { encoding: "utf8" });
  if (removedMcp.status !== 0) throw new Error(`Unable to remove Codex MCP server: ${removedMcp.stderr || removedMcp.stdout}`);
}
console.log("Removed the local marketplace entry and source symlink.");
console.log("Run first when still installed: codex plugin remove codex-dev-orchestrator@personal");
