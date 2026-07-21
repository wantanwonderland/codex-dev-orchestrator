#!/usr/bin/env node
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const client = new Client({ name: "cdo-smoke-client", version: "0.1.0" });
const transport = new StdioClientTransport({ command: "node", args: [join(root, "dist", "mcp.js")], cwd: root });
await client.connect(transport);
try {
  const result = await client.listTools();
  const expected = [
    "acquire_writer_lease",
    "bind_agent_assignment",
    "classify_task_risk",
    "completion_gate",
    "create_agent_assignment",
    "delete_browser_auth_state",
    "issue_browser_auth_state",
    "list_agent_assignments",
    "persist_workflow_artifact",
    "reconcile_agent_assignment",
    "record_agent_failure",
    "record_agent_success",
    "release_writer_lease",
    "transition_workflow",
    "workflow_status",
  ];
  const actual = result.tools.map((tool) => tool.name).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`MCP tools mismatch: ${actual.join(", ")}`);
  console.log(`MCP smoke test OK (${actual.length} tools)`);
} finally {
  await client.close();
}
