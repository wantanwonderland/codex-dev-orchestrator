import { readdir, readFile } from "node:fs/promises";
import { dirname, join, parse } from "node:path";
import type { GovernanceContext } from "./hook-policy.js";
import { WorkflowStateSchema } from "./types.js";
import { workflowRuntimeRoot } from "./project-root.js";

const TERMINAL_STATUSES = new Set(["blocked", "complete"]);

export async function findRelevantGovernance(cwd: string, sessionId?: string): Promise<GovernanceContext> {
  const runtimeRoot = await findRuntimeRoot(cwd);
  if (!runtimeRoot) return { active: false };

  let active = false;
  let otherLease: GovernanceContext["lease"];
  for (const entry of await readdir(runtimeRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    try {
      const state = WorkflowStateSchema.parse(JSON.parse(await readFile(join(runtimeRoot, entry.name, "state.json"), "utf8")));
      if (TERMINAL_STATUSES.has(state.status)) continue;
      active = true;
      if (state.writerLease?.sessionId === sessionId) return { active: true, lease: state.writerLease };
      otherLease ??= state.writerLease;
    } catch {
      // Ignore incomplete runtime directories; doctor reports durable corruption.
    }
  }
  return { active, lease: otherLease };
}

async function findRuntimeRoot(start: string): Promise<string | undefined> {
  const canonical = workflowRuntimeRoot(start);
  try {
    await readdir(canonical);
    return canonical;
  } catch {
    // Fall back to walking upward for initialized non-Git projects.
  }
  let current = start;
  const filesystemRoot = parse(current).root;
  while (true) {
    const candidate = join(current, ".codex", "workflow-runtime");
    try {
      await readdir(candidate);
      return candidate;
    } catch {
      // Continue upward so hooks also work when Codex starts in a repository subdirectory.
    }
    if (current === filesystemRoot) return undefined;
    current = dirname(current);
  }
}
