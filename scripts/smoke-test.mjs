#!/usr/bin/env node
import { access, constants, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const cli = join(root, "dist", "cli.js");
const demo = await mkdtemp(join(tmpdir(), "cdo-smoke-"));

await access(cli, constants.X_OK);

function run(program, args, expect = 0) {
  return runWithInput(program, args, undefined, expect);
}

function runWithInput(program, args, input, expect = 0) {
  const result = spawnSync(program, args, { cwd: demo, encoding: "utf8", input });
  if (result.status !== expect) {
    throw new Error(`${program} ${args.join(" ")} returned ${result.status}, expected ${expect}\n${result.stdout}\n${result.stderr}`);
  }
  return `${result.stdout}${result.stderr}`;
}

try {
  run("git", ["init", "-b", "main"]);
  run("git", ["config", "user.name", "CDO Smoke"]);
  run("git", ["config", "user.email", "cdo-smoke@example.invalid"]);
  await writeFile(join(demo, ".keep"), "\n");
  run("git", ["add", ".keep"]);
  run("git", ["commit", "-m", "init"]);
  run(process.execPath, [cli, "init", "--project-id", "demo-project", "--default-branch", "main"]);
  run(process.execPath, [cli, "doctor"]);
  const restrictedHook = spawnSync(join(root, "scripts", "run-hook.sh"), [], {
    cwd: demo,
    encoding: "utf8",
    input: JSON.stringify({ hook_event_name: "SessionStart", cwd: demo, source: "startup" }),
    env: { HOME: process.env.HOME, PATH: "/usr/bin:/bin", PLUGIN_ROOT: root },
  });
  if (restrictedHook.status !== 0) {
    throw new Error(`Hook failed with restricted PATH (${restrictedHook.status})\n${restrictedHook.stdout}\n${restrictedHook.stderr}`);
  }
  run(process.execPath, [cli, "start", "Build a customer-visible account settings page", "--id", "account-settings", "--tier", "large"]);
  const worktree = join(demo, ".worktrees", "account-settings");
  run(process.execPath, [cli, "validate-artifacts", "account-settings"]);
  const researchAssignment = JSON.parse(run(process.execPath, [cli, "assign", "account-settings", "--operation", "research", "--role", "researcher", "--stage", "research", "--input", "index.md", "--output", "research.md", "--kind", "research"]));
  run(process.execPath, [cli, "bind-agent", "account-settings", researchAssignment.id, "--event", "start", "--agent", "researcher-1"]);
  const researchHead = run("git", ["-C", worktree, "rev-parse", "HEAD"]).trim();
  await writeFile(join(worktree, ".codex/workflows/account-settings/research.md"), `---\nschema: cdo/v2\nkind: research\nworkflow_id: account-settings\nstatus: complete\ncreated_at: 2026-07-21T00:00:00.000Z\nupdated_at: 2026-07-21T00:00:00.000Z\ntarget_commit: ${researchHead}\nassignment_id: ${researchAssignment.id}\noperation_key: research\nagent_role: researcher\n---\n# Research\n\nRepository and current web evidence with source URLs and access dates.\n`);
  run(process.execPath, [cli, "bind-agent", "account-settings", researchAssignment.id, "--event", "stop", "--agent", "researcher-1"]);
  const researched = JSON.parse(run(process.execPath, [cli, "reconcile", "account-settings", researchAssignment.id]));
  if (researched.nextAction !== "brainstorm_with_human") throw new Error("Research did not reach brainstorming");
  await writeFile(join(worktree, ".codex/workflows/account-settings/decisions.md"), `---\nschema: cdo/v2\nkind: decisions\nworkflow_id: account-settings\nstatus: ready\ncreated_at: 2026-07-21T00:00:00.000Z\nupdated_at: 2026-07-21T00:00:00.000Z\n---\n# Decisions\n\nUse a customer-visible settings form with audit history.\n`);
  run(process.execPath, [cli, "record-decisions", "account-settings"]);
  const planAssignment = JSON.parse(run(process.execPath, [cli, "assign", "account-settings", "--operation", "planning", "--role", "planner", "--stage", "planning", "--input", "spec.md", "--output", "plan.md", "--kind", "plan"]));
  run(process.execPath, [cli, "bind-agent", "account-settings", planAssignment.id, "--event", "start", "--agent", "planner-1"]);
  const planningHead = run("git", ["-C", worktree, "rev-parse", "HEAD"]).trim();
  await writeFile(join(worktree, ".codex/workflows/account-settings/plan.md"), `---\nschema: cdo/v2\nkind: plan\nworkflow_id: account-settings\nstatus: ready\ncreated_at: 2026-07-21T00:00:00.000Z\nupdated_at: 2026-07-21T00:00:00.000Z\ntarget_commit: ${planningHead}\nassignment_id: ${planAssignment.id}\noperation_key: planning\nagent_role: planner\n---\n# Account settings implementation plan\n\nImplement and verify the customer-visible settings flow.\n`);
  await writeFile(join(worktree, ".codex/workflows/account-settings/tasks/task-1.md"), `---\nschema: cdo/v2\nkind: task-brief\nworkflow_id: account-settings\nphase: phase-1\ntask: task-1\nstatus: ready\ncreated_at: 2026-07-21T00:00:00.000Z\nupdated_at: 2026-07-21T00:00:00.000Z\ndepends_on: []\nrisk: high\nreview_required: true\ncustomer_visible_ui: true\n---\n# Account settings page\n\n## Context\n\nImplement the customer-visible flow in \`src/account-settings.ts\`.\n\n## Acceptance criteria\n\nThe saved setting is audited and visible.\n\n## Steps\n\nCreate \`src/account-settings.ts\` and its tests.\n\n\`\`\`ts\nexport const accountSettings = true;\n\`\`\`\n\n## Verification\n\n\`\`\`bash\npnpm test\n\`\`\`\n`);
  run(process.execPath, [cli, "bind-agent", "account-settings", planAssignment.id, "--event", "stop", "--agent", "planner-1", "--reason", "completed"]);
  const planned = JSON.parse(run(process.execPath, [cli, "reconcile", "account-settings", planAssignment.id]));
  if (planned.nextAction !== "assign_executor" || planned.state.status !== "executing") throw new Error("Planner handoff did not start execution");
  const assignment = JSON.parse(run(process.execPath, [cli, "assign", "account-settings", "--operation", "task-1", "--role", "executor", "--stage", "implementation", "--task", "task-1", "--input", "tasks/task-1.md", "--output", "reports/task-1.md", "--kind", "executor-report"]));
  runWithInput(process.execPath, [join(root, "dist", "hook.js")], JSON.stringify({ hook_event_name: "SubagentStart", cwd: demo, agent_type: "executor", agent_id: "agent-1", session_id: "parent-session" }));
  run(process.execPath, [cli, "acquire-writer", "account-settings", "--role", "executor", "--session", "parent-session"]);
  const conflict = run(process.execPath, [cli, "acquire-writer", "account-settings", "--role", "fixer", "--session", "other-session"], 1);
  if (!conflict.includes("held by executor/parent-session")) throw new Error("Writer conflict was not explained");
  run(process.execPath, [cli, "release-writer", "account-settings", "--session", "parent-session"]);
  const head = run("git", ["-C", worktree, "rev-parse", "HEAD"]).trim();
  await writeFile(join(worktree, ".codex/workflows/account-settings/reports/task-1.md"), `---\nschema: cdo/v2\nkind: executor-report\nworkflow_id: account-settings\nstatus: complete\ncreated_at: 2026-07-21T00:00:00.000Z\nupdated_at: 2026-07-21T00:00:00.000Z\nsource_commit: ${head}\ntarget_commit: ${head}\nassignment_id: ${assignment.id}\noperation_key: task-1\nagent_role: executor\n---\n# Executor report\n`);
  runWithInput(process.execPath, [join(root, "dist", "hook.js")], JSON.stringify({ hook_event_name: "SubagentStop", cwd: demo, agent_type: "executor", agent_id: "agent-1", stop_reason: "end_turn", session_id: "parent-session" }));
  const reconciled = JSON.parse(run(process.execPath, [cli, "reconcile", "account-settings", assignment.id]));
  if (reconciled.nextAction !== "assign_task_reviewer") throw new Error("High-risk executor handoff was not routed to review");
  const status = run(process.execPath, [cli, "status", "account-settings", "--json"]);
  if (!status.includes('"nextAction": "assign_task_reviewer"')) throw new Error("Status did not expose the next owner");
  const gate = run(process.execPath, [cli, "gate", "account-settings"], 2);
  if (!gate.includes("passed whole-phase review") || !gate.includes("passed live browser report")) {
    throw new Error("Completion gate did not require review and browser proof");
  }
  console.log("disposable repository smoke test OK");
} finally {
  await rm(demo, { recursive: true, force: true });
}
