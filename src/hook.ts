#!/usr/bin/env node
import { evaluateToolUse, type ToolUseInput } from "./hook-policy.js";
import { findRelevantGovernance } from "./hook-governance.js";
import { handleAgentLifecycle, type AgentLifecycleInput } from "./agent-lifecycle.js";

let raw = "";
for await (const chunk of process.stdin) raw += String(chunk);
const input = JSON.parse(raw || "{}") as ToolUseInput & AgentLifecycleInput;

if (input.hook_event_name === "SessionStart") {
  process.stdout.write(JSON.stringify({ systemMessage: "Codex Dev Orchestrator is active. Resume from tracked workflow artifacts, runtime state, and pending assignments; deployment always needs explicit human instruction." }));
  process.exit(0);
}

if (input.hook_event_name === "SubagentStart" || input.hook_event_name === "SubagentStop") {
  const result = await handleAgentLifecycle(input);
  if (result.assignment) {
    const writerIdentity = ["executor", "fixer"].includes(result.assignment.role) && input.session_id
      ? ` Use Codex parent session ID ${input.session_id} for writer-lease acquisition and release; never use the agent routing path.`
      : "";
    const action = input.hook_event_name === "SubagentStop"
      ? `Assignment ${result.assignment.id} stopped. Coordinator: persist the expected ${result.assignment.expectedKind} at ${result.assignment.outputPath}, run reconcile_agent_assignment, then route its returned nextAction.`
      : `CDO assignment ${result.assignment.id} is active for ${result.assignment.operationKey}. Produce ${result.assignment.expectedKind} at ${result.assignment.outputPath} and include the assignment metadata in cdo/v1 front matter.${writerIdentity}`;
    process.stdout.write(JSON.stringify({ systemMessage: action }));
  } else if (result.warning) {
    process.stdout.write(JSON.stringify({ systemMessage: result.warning }));
  }
  process.exit(0);
}

const governance = await findRelevantGovernance(input.cwd ?? process.cwd(), input.session_id);
const decision = evaluateToolUse(input, governance);
if (!decision.allow) {
  process.stderr.write(`Codex Dev Orchestrator blocked tool use: ${decision.reason}\n`);
  process.exit(2);
}
