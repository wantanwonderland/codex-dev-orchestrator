#!/usr/bin/env node
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { evaluateToolUse, type ToolUseInput } from "./hook-policy.js";
import { WorkflowStateSchema, type WriterLease } from "./types.js";

let raw = "";
for await (const chunk of process.stdin) raw += String(chunk);
const input = JSON.parse(raw || "{}") as ToolUseInput & { cwd?: string; hook_event_name?: string };

if (input.hook_event_name === "SessionStart") {
  process.stdout.write(JSON.stringify({ systemMessage: "Codex Dev Orchestrator is active. Resume from .codex workflow artifacts and runtime state; deployment always needs explicit human instruction." }));
  process.exit(0);
}

const lease = await findRelevantLease(input.cwd ?? process.cwd(), input.session_id);
const decision = evaluateToolUse(input, lease);
if (!decision.allow) {
  process.stderr.write(`Codex Dev Orchestrator blocked tool use: ${decision.reason}\n`);
  process.exit(2);
}

async function findRelevantLease(projectRoot: string, sessionId?: string): Promise<WriterLease | undefined> {
  const root = join(projectRoot, ".codex", "workflow-runtime");
  try {
    let other: WriterLease | undefined;
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      try {
        const state = WorkflowStateSchema.parse(JSON.parse(await readFile(join(root, entry.name, "state.json"), "utf8")));
        if (state.writerLease?.sessionId === sessionId) return state.writerLease;
        other ??= state.writerLease;
      } catch {
        // Ignore incomplete runtime directories; doctor reports durable corruption.
      }
    }
    return other;
  } catch {
    return undefined;
  }
}
