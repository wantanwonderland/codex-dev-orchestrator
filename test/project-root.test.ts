import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { canonicalRuntimeProjectRoot, workflowRuntimeRoot } from "../src/project-root.js";
import { StateStore } from "../src/state-store.js";

const run = promisify(execFile);

describe("canonical workflow runtime root", () => {
  it("shares runtime state across linked worktrees without redirecting active source paths", async () => {
    const root = await mkdtemp(join(tmpdir(), "cdo-worktree-root-"));
    await run("git", ["init", "-b", "main", root]);
    await run("git", ["-C", root, "config", "user.email", "cdo@example.test"]);
    await run("git", ["-C", root, "config", "user.name", "CDO Test"]);
    await writeFile(join(root, "README.md"), "fixture\n");
    await run("git", ["-C", root, "add", "README.md"]);
    await run("git", ["-C", root, "commit", "-m", "fixture"]);
    const worktree = join(root, ".worktrees", "feature");
    await mkdir(join(root, ".worktrees"), { recursive: true });
    await run("git", ["-C", root, "worktree", "add", "-b", "feature", worktree]);

    const mainStore = new StateStore(root, "wf-1");
    await mainStore.create({ objective: "shared runtime", tier: "normal", mode: "human_gated" });
    const worktreeStore = new StateStore(worktree, "wf-1");

    const physicalRoot = await realpath(root);
    expect(canonicalRuntimeProjectRoot(worktree)).toBe(physicalRoot);
    expect(workflowRuntimeRoot(worktree)).toBe(join(physicalRoot, ".codex", "workflow-runtime"));
    expect(worktreeStore.projectRoot).toBe(worktree);
    expect((await worktreeStore.load()).objective).toBe("shared runtime");
    expect(await readFile(join(root, ".codex", "workflow-runtime", "wf-1", "state.json"), "utf8")).toContain("shared runtime");
  });

  it("keeps non-Git projects local", async () => {
    const root = await mkdtemp(join(tmpdir(), "cdo-non-git-root-"));
    expect(canonicalRuntimeProjectRoot(root)).toBe(root);
  });
});
