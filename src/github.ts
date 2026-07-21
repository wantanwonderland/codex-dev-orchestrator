import { loadProjectConfig } from "./config.js";
import { run } from "./process.js";
import { StateStore } from "./state-store.js";
import { assessCompletionGate } from "./gates.js";

export async function publishCheckpoint(
  projectRoot: string,
  input: { workflowId: string; deploymentReviewed: boolean; title: string; bodyFile: string },
): Promise<void> {
  const config = await loadProjectConfig(projectRoot);
  const state = await new StateStore(projectRoot, input.workflowId).load();
  if (!state.tasks.length || ["discovering", "brainstorming", "planning", "needs_human"].includes(state.status)) {
    throw new Error("Remote publication requires a persisted task graph and an active workflow");
  }
  if (config.git.require_approval_if_deploy_coupled && !input.deploymentReviewed) {
    throw new Error("Remote publication is blocked until deployment coupling is reviewed and explicitly approved");
  }
  const branch = (await run("git", ["branch", "--show-current"], projectRoot)).stdout.trim();
  if (!branch || branch === config.project.default_branch) throw new Error("Refusing to publish from the default branch");
  const status = (await run("git", ["status", "--porcelain"], projectRoot)).stdout;
  if (status.trim()) throw new Error("Refusing to publish a checkpoint from a dirty worktree");
  await run("git", ["push", "-u", "origin", branch], projectRoot);
  try {
    await run("gh", ["pr", "view", "--json", "number"], projectRoot);
  } catch {
    await run("gh", ["pr", "create", "--draft", "--base", config.project.default_branch, "--title", input.title, "--body-file", input.bodyFile], projectRoot);
  }
}

export async function mergePullRequest(projectRoot: string, workflowId: string, humanApproved: boolean): Promise<void> {
  if (!humanApproved) throw new Error("PR merge requires explicit human approval for this invocation");
  const state = await new StateStore(projectRoot, workflowId).load();
  const gate = await assessCompletionGate(projectRoot, workflowId);
  if (state.status !== "complete" || !gate.ready) throw new Error("PR merge requires a complete workflow with all local gates passed");
  await run("gh", ["pr", "checks", "--required"], projectRoot);
  await run("gh", ["pr", "ready"], projectRoot);
  await run("gh", ["pr", "merge", "--squash", "--delete-branch"], projectRoot);
}
