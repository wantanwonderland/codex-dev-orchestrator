import { access, mkdir, realpath } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { run } from "./process.js";
import type { WorkflowState } from "./types.js";

export async function createWorkflowWorktree(projectRoot: string, workflowId: string, options: { directory: string; branchPrefix: string }): Promise<{ worktreePath: string; branch: string; baseCommit: string; commonGitDir: string }> {
  const root = (await run("git", ["rev-parse", "--show-toplevel"], projectRoot)).stdout.trim();
  if (await realpath(projectRoot) !== await realpath(root)) throw new Error("cdo start must run from the primary repository checkout");
  const detached = (await run("git", ["symbolic-ref", "--quiet", "--short", "HEAD"], root).catch(() => ({ stdout: "" }))).stdout.trim();
  if (!detached) throw new Error("cdo start refuses a detached HEAD");
  const commonGitDir = await awaitGitDir(root);
  for (const marker of ["MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "rebase-merge", "rebase-apply"]) {
    try { await access(join(commonGitDir, marker)); throw new Error("cdo start refuses an in-progress Git operation"); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  const dirty = (await run("git", ["status", "--porcelain"], root)).stdout.trim();
  if (dirty) {
    await run("git", ["add", "-A"], root);
    await run("git", ["commit", "-m", `chore(cdo): checkpoint before ${workflowId}`], root);
  }
  const branch = `${options.branchPrefix}/${workflowId}`;
  const existing = (await run("git", ["branch", "--list", branch], root)).stdout.trim();
  if (existing) throw new Error(`Workflow branch already exists: ${branch}`);
  const worktreePath = resolve(root, options.directory, workflowId);
  try { await access(worktreePath); throw new Error(`Workflow worktree path already exists: ${worktreePath}`); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  await mkdir(dirname(worktreePath), { recursive: true });
  await run("git", ["worktree", "add", "-b", branch, worktreePath, "HEAD"], root);
  return { worktreePath, branch, baseCommit: (await run("git", ["rev-parse", "HEAD"], worktreePath)).stdout.trim(), commonGitDir };
}

export function boundWorktree(state: WorkflowState, fallback: string): string {
  return state.worktree?.worktreePath ?? fallback;
}

/** Explicitly bind a legacy workflow to an already-created Git worktree. */
export async function inspectWorkflowWorktree(projectRoot: string, worktreePath: string): Promise<{ worktreePath: string; branch: string; baseCommit: string; commonGitDir: string }> {
  const primary = (await run("git", ["rev-parse", "--show-toplevel"], projectRoot)).stdout.trim();
  const candidate = (await run("git", ["rev-parse", "--show-toplevel"], worktreePath)).stdout.trim();
  const [primaryGit, candidateGit] = await Promise.all([awaitGitDir(primary), awaitGitDir(candidate)]);
  if (primaryGit !== candidateGit) throw new Error("Adopted worktree must belong to the same Git repository");
  const branch = (await run("git", ["symbolic-ref", "--quiet", "--short", "HEAD"], candidate)).stdout.trim();
  if (!branch) throw new Error("Adopted worktree must not be detached");
  return { worktreePath: await realpath(candidate), branch, baseCommit: (await run("git", ["rev-parse", "HEAD"], candidate)).stdout.trim(), commonGitDir: candidateGit };
}

async function awaitGitDir(root: string): Promise<string> {
  const output = (await run("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], root)).stdout.trim();
  return resolve(root, output);
}
