import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { handleAgentLifecycle } from "../src/agent-lifecycle.js";
import { AssignmentStore } from "../src/assignments.js";
import { StateStore } from "../src/state-store.js";

describe("subagent lifecycle hooks", () => {
  it("binds start and stop events to the queued role assignment", async () => {
    const root = await mkdtemp(join(tmpdir(), "cdo-lifecycle-"));
    await mkdir(join(root, ".codex/workflows/wf-1/tasks"), { recursive: true });
    await writeFile(join(root, ".codex/workflows/wf-1/tasks/task-1.md"), "task");
    await new StateStore(root, "wf-1").create({ objective: "ship", tier: "normal", mode: "autonomous" });
    const assignments = new AssignmentStore(root, "wf-1");
    const queued = await assignments.create({
      operationKey: "task-1",
      role: "executor",
      stage: "implementation",
      inputPath: "tasks/task-1.md",
      outputPath: "reports/task-1.md",
      expectedKind: "executor-report",
    });

    const started = await handleAgentLifecycle({ hook_event_name: "SubagentStart", cwd: root, agent_type: "executor", agent_id: "agent-1" });
    expect(started.assignment).toMatchObject({ id: queued.id, status: "running", agentId: "agent-1" });
    const stopped = await handleAgentLifecycle({ hook_event_name: "SubagentStop", cwd: root, agent_type: "executor", agent_id: "agent-1", stop_reason: "end_turn" });
    expect(stopped.assignment).toMatchObject({ id: queued.id, status: "stopped", stopReason: "end_turn" });
  });

  it("ignores unrelated agents when no CDO assignment is queued", async () => {
    const root = await mkdtemp(join(tmpdir(), "cdo-lifecycle-"));
    expect(await handleAgentLifecycle({ hook_event_name: "SubagentStart", cwd: root, agent_type: "explorer" })).toEqual({});
  });

  it("reports corrupt active runtime state instead of silently ignoring it", async () => {
    const root = await mkdtemp(join(tmpdir(), "cdo-lifecycle-"));
    await mkdir(join(root, ".codex/workflow-runtime/wf-broken"), { recursive: true });
    await writeFile(join(root, ".codex/workflow-runtime/wf-broken/state.json"), "not-json");
    const result = await handleAgentLifecycle({ hook_event_name: "SubagentStart", cwd: root, agent_type: "executor" });
    expect(result.warning).toContain("could not inspect workflow wf-broken");
  });
});
