#!/usr/bin/env node
import { evaluateToolUse, type ToolUseInput } from "./hook-policy.js";
import { findRelevantGovernance } from "./hook-governance.js";

let raw = "";
for await (const chunk of process.stdin) raw += String(chunk);
const input = JSON.parse(raw || "{}") as ToolUseInput & { cwd?: string; hook_event_name?: string };

if (input.hook_event_name === "SessionStart") {
  process.stdout.write(JSON.stringify({ systemMessage: "Codex Dev Orchestrator is active. Resume from .codex workflow artifacts and runtime state; deployment always needs explicit human instruction." }));
  process.exit(0);
}

const governance = await findRelevantGovernance(input.cwd ?? process.cwd(), input.session_id);
const decision = evaluateToolUse(input, governance);
if (!decision.allow) {
  process.stderr.write(`Codex Dev Orchestrator blocked tool use: ${decision.reason}\n`);
  process.exit(2);
}
