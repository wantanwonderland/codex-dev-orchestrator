import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArtifact } from "./frontmatter.js";
import { classifyRisk } from "./risk.js";
import { run } from "./process.js";
import { WorkflowIdSchema } from "./types.js";
import { StateStore } from "./state-store.js";
import { boundWorktree, workflowArtifactRoot } from "./worktree.js";

export async function assessCompletionGate(projectRoot: string, workflowId: string): Promise<{
  ready: boolean;
  missing: string[];
  customerVisibleUi: boolean;
}> {
  workflowId = WorkflowIdSchema.parse(workflowId);
  let artifactRoot = projectRoot;
  let sourceRoot = projectRoot;
  try {
    const state = await new StateStore(projectRoot, workflowId).load();
    artifactRoot = workflowArtifactRoot(state, projectRoot);
    sourceRoot = boundWorktree(state, projectRoot);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const root = join(artifactRoot, ".codex", "workflows", workflowId);
  const planningText = await readAvailable([
    join(root, "index.md"),
    join(root, "spec.md"),
    join(root, "plan.md"),
    join(root, "tasks", "task-1.md"),
  ]);
  if (!planningText.length) throw new Error("Workflow planning artifacts are missing");
  const customerVisibleUi = classifyRisk(planningText).triggers.includes("customer-visible UI");
  const head = await currentHead(sourceRoot);
  const missing: string[] = [];
  if (!(await isPassed(join(root, "reviews", "phase-final.md"), "review", head))) missing.push("passed whole-phase review");
  if (customerVisibleUi && !(await isPassed(join(root, "browser", "report.md"), "browser-report", head))) {
    missing.push("passed live browser report");
  }
  return { ready: missing.length === 0, missing, customerVisibleUi };
}

async function isPassed(path: string, kind: "review" | "browser-report", expectedCommit?: string): Promise<boolean> {
  try {
    const artifact = parseArtifact(await readFile(path, "utf8"));
    return (
      artifact.frontmatter.kind === kind &&
      artifact.frontmatter.status === "passed" &&
      (!expectedCommit || artifact.frontmatter.target_commit === expectedCommit)
    );
  } catch {
    return false;
  }
}

async function currentHead(projectRoot: string): Promise<string | undefined> {
  try {
    return (await run("git", ["rev-parse", "HEAD"], projectRoot)).stdout.trim();
  } catch {
    return undefined;
  }
}

async function readAvailable(paths: string[]): Promise<string[]> {
  const result: string[] = [];
  for (const path of paths) {
    try {
      result.push(await readFile(path, "utf8"));
    } catch {
      // Tier-specific planning artifacts are optional.
    }
  }
  return result;
}
