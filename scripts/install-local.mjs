#!/usr/bin/env node
import { chmod, mkdir, readFile, realpath, symlink, writeFile, lstat } from "node:fs/promises";
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
if (existingMcp.status === 0 && !existingMcp.stdout.includes(mcpTarget) && !existingMcp.stdout.includes("$PLUGIN_ROOT/dist/mcp.js")) {
  throw new Error("Refusing to replace an unrelated Codex MCP registration named codex-dev-orchestrator");
}
await mkdir(dirname(marketplacePath), { recursive: true });
await mkdir(dirname(linkPath), { recursive: true });
await mkdir(dirname(cliPath), { recursive: true });

try {
  const info = await lstat(linkPath);
  if (!info.isSymbolicLink() || (await realpath(linkPath)) !== (await realpath(pluginRoot))) {
    throw new Error(`${linkPath} already exists and is not this source checkout`);
  }
} catch (error) {
  if (error?.code === "ENOENT") await symlink(pluginRoot, linkPath, "dir");
  else throw error;
}

let marketplace = { name: "personal", interface: { displayName: "Personal" }, plugins: [] };
try {
  marketplace = JSON.parse(await readFile(marketplacePath, "utf8"));
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}
if (marketplace.name !== "personal") throw new Error(`Expected personal marketplace at ${marketplacePath}`);
const entry = {
  name: "codex-dev-orchestrator",
  source: { source: "local", path: "./plugins/codex-dev-orchestrator" },
  policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
  category: "Productivity",
};
marketplace.plugins = [...marketplace.plugins.filter((item) => item.name !== entry.name), entry];
await writeFile(marketplacePath, `${JSON.stringify(marketplace, null, 2)}\n`);
await chmod(cliTarget, 0o755);
try {
  const info = await lstat(cliPath);
  if (!info.isSymbolicLink() || (await realpath(cliPath)) !== (await realpath(cliTarget))) {
    throw new Error(`${cliPath} already exists and is not this checkout's CLI`);
  }
} catch (error) {
  if (error?.code === "ENOENT") await symlink(cliTarget, cliPath);
  else throw error;
}
if (existingMcp.status === 0) {
  const removedMcp = spawnSync("codex", ["mcp", "remove", "codex-dev-orchestrator"], { encoding: "utf8" });
  if (removedMcp.status !== 0) throw new Error(`Unable to refresh Codex MCP server: ${removedMcp.stderr || removedMcp.stdout}`);
}
const addedMcp = spawnSync("codex", ["mcp", "add", "codex-dev-orchestrator", "--", "node", mcpTarget], { encoding: "utf8" });
if (addedMcp.status !== 0) throw new Error(`Unable to register Codex MCP server: ${addedMcp.stderr || addedMcp.stdout}`);
console.log(`Personal marketplace entry ready at ${marketplacePath}`);
console.log(`CLI ready at ${cliPath}`);
console.log(`MCP server ready at ${mcpTarget}`);
console.log("Next: codex plugin add codex-dev-orchestrator@personal");
