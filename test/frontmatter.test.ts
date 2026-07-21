import { describe, expect, it } from "vitest";
import { parseArtifact, renderArtifact } from "../src/frontmatter.js";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { persistWorkflowArtifact } from "../src/artifacts.js";
import { StateStore } from "../src/state-store.js";
import { statusSummary } from "../src/workflow.js";

describe("workflow artifacts", () => {
  it("round-trips validated YAML front matter", () => {
    const markdown = renderArtifact(
      {
        schema: "cdo/v2",
        kind: "task-brief",
        workflow_id: "wf-1",
        status: "ready",
        created_at: "2026-07-20T00:00:00.000Z",
        updated_at: "2026-07-20T00:00:00.000Z",
      },
      "# Task\n\nDo the work.\n",
    );
    expect(parseArtifact(markdown).body).toContain("Do the work.");
  });

  it("rejects missing workflow identity", () => {
    expect(() => parseArtifact("---\nschema: cdo/v2\nkind: plan\n---\n# Plan")).toThrow();
  });

  it("persists coordinator-owned workflow artifacts but rejects path traversal", async () => {
    const root = await mkdtemp(join(tmpdir(), "cdo-artifact-"));
    const markdown = renderArtifact(
      { schema: "cdo/v2", kind: "review", workflow_id: "wf-1", status: "passed", created_at: "2026-07-20T00:00:00.000Z", updated_at: "2026-07-20T00:00:00.000Z" },
      "# GO",
    );
    const path = await persistWorkflowArtifact(root, "wf-1", "reviews/phase-final.md", markdown);
    expect(await readFile(path, "utf8")).toBe(markdown);
    await expect(persistWorkflowArtifact(root, "wf-1", "../../source.ts", markdown)).rejects.toThrow(/inside the workflow directory/);
  });

  it("keeps legacy workflow evidence in the canonical checkout when source uses a worktree", async () => {
    const root = await mkdtemp(join(tmpdir(), "cdo-artifact-legacy-"));
    const source = join(root, "source-worktree");
    await mkdir(source);
    const store = new StateStore(root, "wf-legacy");
    const state = await store.create({ objective: "ship", tier: "small", mode: "autonomous" });
    await store.save({ ...state, worktree: { worktreePath: source, branch: "feature/legacy", baseCommit: "base", commonGitDir: join(root, ".git") } }, "test.bound_worktree");
    await mkdir(join(root, ".codex/workflows/wf-legacy"), { recursive: true });
    await writeFile(join(root, ".codex/workflows/wf-legacy/index.md"), "# Legacy workflow");
    const markdown = renderArtifact(
      { schema: "cdo/v2", kind: "review", workflow_id: "wf-legacy", status: "passed", created_at: "2026-07-20T00:00:00.000Z", updated_at: "2026-07-20T00:00:00.000Z" },
      "# Evidence",
    );
    const path = await persistWorkflowArtifact(root, "wf-legacy", "reviews/phase-final.md", markdown);
    expect(path).toBe(join(root, ".codex/workflows/wf-legacy/reviews/phase-final.md"));
    await expect(statusSummary(root, "wf-legacy")).resolves.toMatchObject({ workflowId: "wf-legacy" });
  });
});
