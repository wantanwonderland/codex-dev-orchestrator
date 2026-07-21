import type { WriterLease } from "./types.js";

export interface ToolUseInput {
  tool_name?: string;
  session_id?: string;
  tool_input?: Record<string, unknown>;
}

export interface PolicyDecision {
  allow: boolean;
  reason?: string;
}

export interface GovernanceContext {
  active: boolean;
  lease?: WriterLease;
}

const WRITE_TOOL = /^(apply_patch|Edit|Write)$/;
const SHELL_WRITE = /(^|\s)(rm|mv|cp|touch|mkdir|git\s+(commit|merge|rebase|push)|sed\s+-i|perl\s+-pi|npm\s+version)(\s|$)|(^|[^>])>{1,2}[^>]/i;
const PRODUCTION_MUTATION = /\b(kubectl\s+(apply|delete|rollout|scale)|terraform\s+apply|helm\s+(upgrade|install|uninstall)|docker\s+compose\s+.*\bup\b|ssh\s+\S+\s+.*\b(restart|deploy|migrate)\b)\b/i;

export function evaluateToolUse(input: ToolUseInput, governance: GovernanceContext = { active: false }): PolicyDecision {
  const tool = input.tool_name ?? "";
  const command = typeof input.tool_input?.cmd === "string" ? input.tool_input.cmd : "";
  if (PRODUCTION_MUTATION.test(command) && process.env.CDO_PRODUCTION_APPROVAL !== "approved") {
    return { allow: false, reason: "Production mutation requires explicit human approval for this invocation" };
  }
  const mutating = WRITE_TOOL.test(tool) || (tool === "Bash" && SHELL_WRITE.test(command));
  if (mutating && governance.active && (!governance.lease || !input.session_id || governance.lease.sessionId !== input.session_id)) {
    return { allow: false, reason: "Source mutation requires the active executor/fixer writer lease" };
  }
  return { allow: true };
}
