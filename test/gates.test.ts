import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assessCompletionGate } from "../src/gates.js";
import { renderArtifact } from "../src/frontmatter.js";

const now = "2026-07-20T00:00:00.000Z";

describe("completion gate", () => {
  it("requires whole-phase review and live browser evidence for customer-visible UI", async () => {
    const root = await mkdtemp(join(tmpdir(), "cdo-gate-"));
    const workflow = join(root, ".codex/workflows/wf-ui");
    await mkdir(join(workflow, "reviews"), { recursive: true });
    await mkdir(join(workflow, "browser"), { recursive: true });
    await writeFile(join(workflow, "plan.md"), "Build a customer-visible UI page");
    expect((await assessCompletionGate(root, "wf-ui")).missing).toEqual([
      "passed whole-phase review",
      "passed live browser report",
    ]);

    await writeFile(
      join(workflow, "reviews/phase-final.md"),
      renderArtifact(
        { schema: "cdo/v1", kind: "review", workflow_id: "wf-ui", status: "passed", created_at: now, updated_at: now },
        "# GO",
      ),
    );
    await writeFile(
      join(workflow, "browser/report.md"),
      renderArtifact(
        { schema: "cdo/v1", kind: "browser-report", workflow_id: "wf-ui", status: "passed", created_at: now, updated_at: now },
        "# Browser evidence",
      ),
    );
    expect((await assessCompletionGate(root, "wf-ui")).ready).toBe(true);
  });
});
