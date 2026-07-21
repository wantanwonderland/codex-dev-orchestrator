import { execFile } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { findRelevantGovernance } from "../src/hook-governance.js";

const run = promisify(execFile);

async function writeState(root: string, status: "executing" | "complete", withLease = false) {
  const runtime = join(root, ".codex/workflow-runtime/wf-1");
  await mkdir(runtime, { recursive: true });
  const now = new Date().toISOString();
  await writeFile(join(runtime, "state.json"), JSON.stringify({
    schema: "cdo-state/v2",
    workflowId: "wf-1",
    projectRoot: root,
    objective: "test hook governance",
    tier: "normal",
    mode: "autonomous",
    status,
    phase: "phase-1",
    writerLease: withLease ? { role: "executor", sessionId: "writer-session", acquiredAt: now } : undefined,
    researchComplete: true,
    decisionsComplete: true,
    planRevision: 1,
    tasks: [],
    operationFailures: {},
    createdAt: now,
    updatedAt: now,
  }));
}

describe("hook governance discovery", () => {
  it("does not govern a repository that has no active workflow", async () => {
    const root = await mkdtemp(join(tmpdir(), "cdo-hook-"));
    expect(await findRelevantGovernance(root, "interactive-session")).toEqual({ active: false });
    await writeState(root, "complete");
    expect(await findRelevantGovernance(root, "interactive-session")).toEqual({ active: false, lease: undefined });
  });

  it("finds active governance and the owning lease from a repository subdirectory", async () => {
    const root = await mkdtemp(join(tmpdir(), "cdo-hook-"));
    const nested = join(root, "apps/api");
    await mkdir(nested, { recursive: true });
    await writeState(root, "executing", true);
    expect(await findRelevantGovernance(nested, "writer-session")).toMatchObject({
      active: true,
      lease: { role: "executor", sessionId: "writer-session" },
    });
  });

  it("ignores a stale worktree-local runtime copy and uses the common repository ledger", async () => {
    const root = await mkdtemp(join(tmpdir(), "cdo-hook-worktree-"));
    await run("git", ["init", "-b", "main", root]);
    await run("git", ["-C", root, "config", "user.email", "cdo@example.test"]);
    await run("git", ["-C", root, "config", "user.name", "CDO Test"]);
    await writeFile(join(root, "README.md"), "fixture\n");
    await run("git", ["-C", root, "add", "README.md"]);
    await run("git", ["-C", root, "commit", "-m", "fixture"]);
    const worktree = join(root, ".worktrees", "feature");
    await mkdir(join(root, ".worktrees"), { recursive: true });
    await run("git", ["-C", root, "worktree", "add", "-b", "feature", worktree]);
    await writeState(root, "executing", true);
    await writeState(worktree, "executing", false);

    expect(await findRelevantGovernance(worktree, "writer-session")).toMatchObject({
      active: true,
      lease: { sessionId: "writer-session" },
    });
  });
});
