#!/usr/bin/env node
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const packaged = await mkdtemp(join(tmpdir(), "cdo-packaged-"));
try {
  await cp(join(root, "dist"), join(packaged, "dist"), { recursive: true });
  await writeFile(join(packaged, "package.json"), '{"type":"module"}\n');
  const client = new Client({ name: "cdo-packaged-smoke", version: "0.1.0" });
  const transport = new StdioClientTransport({ command: "node", args: [join(packaged, "dist", "mcp.js")], cwd: packaged });
  await client.connect(transport);
  try {
    const result = await client.callTool({ name: "classify_task_risk", arguments: { text: ["tenant RBAC"] } });
    const payload = JSON.parse(result.content[0].text);
    if (!payload.triggers.includes("auth/RBAC/tenancy")) throw new Error("Packaged MCP returned the wrong classification");
    console.log("packaged MCP smoke test OK (no node_modules)");
  } finally {
    await client.close();
  }
} finally {
  await rm(packaged, { recursive: true, force: true });
}
