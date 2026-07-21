import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AssignmentStore } from "../src/assignments.js";
import { renderArtifact } from "../src/frontmatter.js";
import { StateStore } from "../src/state-store.js";

const now = "2026-07-21T00:00:00.000Z";

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "cdo-assignment-"));
  await mkdir(join(root, ".codex/workflows/wf-1/tasks"), { recursive: true });
  await mkdir(join(root, ".codex/workflows/wf-1/reports"), { recursive: true });
  await writeFile(join(root, ".codex/workflows/wf-1/tasks/task-1.md"), "task");
  await new StateStore(root, "wf-1").create({ objective: "ship", tier: "normal", mode: "autonomous" });
  return { root, store: new AssignmentStore(root, "wf-1") };
}

describe("agent assignments", () => {
  it("records queued, running, and stopped lifecycle state", async () => {
    const { root, store } = await setup();
    const assignment = await store.create({
      operationKey: "task-1-implementation",
      role: "executor",
      stage: "implementation",
      inputPath: "tasks/task-1.md",
      outputPath: "reports/task-1.md",
      expectedKind: "executor-report",
    });
    expect(assignment.status).toBe("queued");
    expect((await store.bindStarted("executor", "agent-1")).assignment?.status).toBe("running");
    expect((await store.bindStopped("executor", { agentId: "agent-1", stopReason: "end_turn" })).assignment?.status).toBe("stopped");

    const events = await readFile(join(root, ".codex/workflow-runtime/wf-1/events.jsonl"), "utf8");
    expect(events).toContain("agent.assignment_created");
    expect(events).toContain("agent.assignment_started");
    expect(events).toContain("agent.assignment_stopped");
  });

  it("enforces stage contracts and one pending assignment per role", async () => {
    const { store } = await setup();
    await expect(store.create({
      operationKey: "bad",
      role: "reviewer",
      stage: "implementation",
      inputPath: "tasks/task-1.md",
      outputPath: "reports/task-1.md",
      expectedKind: "review",
    })).rejects.toThrow(/requires executor/);

    await store.create({
      operationKey: "task-1-implementation",
      role: "executor",
      stage: "implementation",
      inputPath: "tasks/task-1.md",
      outputPath: "reports/task-1.md",
      expectedKind: "executor-report",
    });
    await expect(store.create({
      operationKey: "task-2-implementation",
      role: "executor",
      stage: "implementation",
      inputPath: "tasks/task-1.md",
      outputPath: "reports/task-2.md",
      expectedKind: "executor-report",
    })).rejects.toThrow(/pending assignment/);
  });

  it("serializes concurrent ledger writes without losing assignments", async () => {
    const { store } = await setup();
    const [executor, planner] = await Promise.all([
      store.create({
        operationKey: "concurrent-executor", role: "executor", stage: "implementation",
        inputPath: "tasks/task-1.md", outputPath: "reports/task-1.md", expectedKind: "executor-report",
      }),
      store.create({
        operationKey: "concurrent-planner", role: "planner", stage: "planning",
        inputPath: "tasks/task-1.md", outputPath: "tasks/task-2.md", expectedKind: "task-brief",
      }),
    ]);
    const ids = (await store.load()).assignments.map((assignment) => assignment.id);
    expect(ids).toEqual(expect.arrayContaining([executor.id, planner.id]));
    expect(ids).toHaveLength(2);
  });

  it("allows only one concurrent pending assignment for the same role", async () => {
    const { store } = await setup();
    const results = await Promise.allSettled(["one", "two"].map((key) => store.create({
      operationKey: `same-role-${key}`, role: "executor", stage: "implementation",
      inputPath: "tasks/task-1.md", outputPath: `reports/${key}.md`, expectedKind: "executor-report",
    })));
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect((await store.load()).assignments).toHaveLength(1);
  });

  it("binds lifecycle events by assignment ID idempotently", async () => {
    const { store } = await setup();
    const assignment = await store.create({
      operationKey: "explicit-bind", role: "executor", stage: "implementation",
      inputPath: "tasks/task-1.md", outputPath: "reports/task-1.md", expectedKind: "executor-report",
    });
    expect((await store.bindStartedById(assignment.id, "agent-1")).status).toBe("running");
    expect((await store.bindStartedById(assignment.id, "agent-1")).status).toBe("running");
    expect((await store.bindStoppedById(assignment.id, "agent-1")).status).toBe("stopped");
    expect((await store.bindStoppedById(assignment.id, "agent-1")).status).toBe("stopped");
  });

  it("validates the durable artifact identity before reconciliation", async () => {
    const { root, store } = await setup();
    const assignment = await store.create({
      operationKey: "task-1-implementation",
      role: "executor",
      stage: "implementation",
      inputPath: "tasks/task-1.md",
      outputPath: "reports/task-1.md",
      expectedKind: "executor-report",
    });
    await store.bindStarted("executor", "agent-1");
    await store.bindStopped("executor", { agentId: "agent-1" });
    await writeFile(join(root, ".codex/workflows/wf-1/reports/task-1.md"), renderArtifact({
      schema: "cdo/v2",
      kind: "executor-report",
      workflow_id: "wf-1",
      status: "complete",
      created_at: now,
      updated_at: now,
      assignment_id: assignment.id,
      operation_key: assignment.operationKey,
      agent_role: "executor",
    }, "# Report"));
    expect((await store.validateOutput(await store.get(assignment.id))).status).toBe("complete");
  });
});
