#!/usr/bin/env node
import { Command } from "commander";
import { resolve } from "node:path";
import { initializeProject, resetProject, startWorkflow, upgradeProject } from "./project.js";
import { acquireLease, adoptWorkflowWorktree, bindAgentAssignment, createAgentAssignment, driveWorkflow, listAgentAssignments, reconcileAgentAssignment, recordBrainstormDecisions, releaseLease, resumeWorkflow, statusSummary } from "./workflow.js";
import { AgentRoleSchema, ArtifactKindSchema, AssignmentStageSchema, WorkflowModeSchema, WorkflowTierSchema } from "./types.js";
import { classifyRisk } from "./risk.js";
import { validateWorkflowArtifacts } from "./artifacts.js";
import { projectDoctor, selfDoctor } from "./doctor.js";
import { assessCompletionGate } from "./gates.js";
import { deleteBrowserAuthState, issueBrowserAuthState } from "./credentials.js";
import { mergePullRequest, publishCheckpoint } from "./github.js";
import { spawn } from "node:child_process";
import { addDashboardRoot, DASHBOARD_HOST, DASHBOARD_PORT, loadDashboardConfig, removeDashboardRoot } from "./dashboard/config.js";
import { startDashboardServer } from "./dashboard/server.js";
import { dashboardServiceStatus, installDashboardService, uninstallDashboardService } from "./dashboard/service.js";
import { setupTelemetry, telemetryStatus } from "./dashboard/telemetry.js";

function rootOf(options: { root?: string }): string {
  return resolve(options.root ?? process.cwd());
}

const program = new Command();
program.name("cdo").description("Autonomous, durable Codex development orchestration").version("0.6.0");

async function serveDashboard(options: { open?: boolean; port?: string }): Promise<void> {
  const config = await loadDashboardConfig();
  const port = options.port ? Number.parseInt(options.port, 10) : config.port;
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("--port must be a valid TCP port");
  const url = `http://${DASHBOARD_HOST}:${port}`;
  try {
    const response = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(600) });
    if (response.ok) {
      if (options.open !== false) openBrowser(url);
      console.log(`CDO dashboard already running at ${url}`);
      return;
    }
  } catch { /* no healthy existing dashboard */ }
  const running = await startDashboardServer({ port });
  if (options.open !== false) openBrowser(running.url);
  console.log(`CDO dashboard running at ${running.url}`);
  await new Promise<void>((resolve) => {
    const stop = () => void running.close().finally(resolve);
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
}

function openBrowser(url: string): void {
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  const child = spawn(command, args, { detached: true, stdio: "ignore" });
  child.unref();
}

const dashboard = program.command("dashboard").description("Monitor development across registered CDO projects");
dashboard.option("--no-open", "do not open a browser").option("--port <port>", "loopback port", String(DASHBOARD_PORT)).action((options) => serveDashboard(options));
const dashboardServe = dashboard.command("serve").option("--no-open", "do not open a browser").option("--port <port>", "loopback port", String(DASHBOARD_PORT));
dashboardServe.action(() => serveDashboard(dashboard.opts()));
dashboard.command("add-root").argument("<path>").action(async (path) => {
  const config = await addDashboardRoot(path);
  console.log(`Registered ${resolve(path)} (${config.roots.length} roots)`);
});
dashboard.command("remove-root").argument("<path>").action(async (path) => {
  const config = await removeDashboardRoot(path);
  console.log(`Removed ${resolve(path)} (${config.roots.length} roots remain)`);
});
dashboard.command("status").option("--port <port>", "loopback port").action(async (options) => {
  const config = await loadDashboardConfig();
  const port = Number.parseInt(dashboard.opts().port ?? options.port ?? String(config.port), 10);
  let healthy = false;
  try { healthy = (await fetch(`http://${config.host}:${port}/api/health`, { signal: AbortSignal.timeout(700) })).ok; } catch { /* offline */ }
  console.log(JSON.stringify({ running: healthy, url: `http://${config.host}:${port}`, roots: config.roots, telemetry: await telemetryStatus(), service: await dashboardServiceStatus() }, null, 2));
});
dashboard.command("setup-otel").action(async () => {
  const result = await setupTelemetry();
  console.log(`Codex OTLP JSON telemetry configured in ${result.path}; restart active Codex sessions`);
});
dashboard.command("install-service").action(async () => console.log(`Installed dashboard service at ${await installDashboardService()}`));
dashboard.command("uninstall-service").action(async () => { await uninstallDashboardService(); console.log("Uninstalled dashboard service"); });
dashboard.command("purge").requiredOption("--before <iso-date>").requiredOption("--confirm").option("--port <port>", "loopback port").action(async (options) => {
  const config = await loadDashboardConfig();
  const port = Number.parseInt(dashboard.opts().port ?? options.port ?? String(config.port), 10);
  const response = await fetch(`http://${config.host}:${port}/api/purge`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ before: options.before, confirm: options.confirm }) });
  if (!response.ok) throw new Error(`Dashboard purge failed with HTTP ${response.status}`);
  console.log(JSON.stringify(await response.json(), null, 2));
});

program
  .command("init")
  .requiredOption("--project-id <id>")
  .option("--default-branch <branch>", "default integration branch", "main")
  .option("--root <path>", "project root")
  .action(async (options) => {
    await initializeProject(rootOf(options), { projectId: options.projectId, defaultBranch: options.defaultBranch });
    console.log(`Initialized Codex Dev Orchestrator in ${rootOf(options)}`);
  });

program
  .command("start")
  .argument("<objective>")
  .requiredOption("--id <workflow-id>")
  .option("--tier <tier>", "small, normal, or large", "normal")
  .option("--mode <mode>", "autonomous or remote_auto", "autonomous")
  .option("--root <path>")
  .action(async (objective, options) => {
    const binding = await startWorkflow(rootOf(options), {
      workflowId: options.id,
      objective,
      tier: WorkflowTierSchema.parse(options.tier),
      mode: WorkflowModeSchema.parse(options.mode),
    });
    console.log(`Workflow ${options.id} started in ${binding.worktreePath} on ${binding.branch}; next: ${options.tier === "small" ? "planning" : "repository and live-web research"}`);
  });

program
  .command("upgrade-project")
  .option("--root <path>", "project root")
  .action(async (options) => {
    const result = await upgradeProject(rootOf(options));
    console.log(`Project templates upgraded: ${result.updated.length} updated, ${result.unchanged.length} unchanged, ${result.recommended.length} preserved with recommendations`);
    for (const path of result.recommended) console.log(`Review recommended template: ${path}`);
  });

program.command("record-decisions").argument("<workflow-id>").option("--root <path>").action(async (workflowId, options) => console.log(JSON.stringify(await recordBrainstormDecisions(rootOf(options), workflowId), null, 2)));
program.command("adopt-worktree").argument("<workflow-id>").requiredOption("--worktree <path>").option("--root <path>").action(async (workflowId, options) => console.log(JSON.stringify(await adoptWorkflowWorktree(rootOf(options), workflowId, resolve(options.worktree)), null, 2)));
program.command("resume").argument("<workflow-id>").requiredOption("--to <status>").option("--root <path>").action(async (workflowId, options) => console.log(JSON.stringify(await resumeWorkflow(rootOf(options), workflowId, options.to), null, 2)));
program.command("reset-project").option("--root <path>").requiredOption("--confirm", "confirm removal of CDO workflow artifacts and runtime only").action(async (options) => { await resetProject(rootOf(options)); console.log("Removed CDO workflow artifacts and runtime; project configuration and agents were preserved"); });

program
  .command("status")
  .argument("<workflow-id>")
  .option("--root <path>")
  .option("--json")
  .action(async (workflowId, options) => {
    const state = await statusSummary(rootOf(options), workflowId);
    const active = state.coordination.activeAssignments.map((assignment) => `${assignment.role}/${assignment.status}`).join(", ");
    console.log(options.json ? JSON.stringify(state, null, 2) : `${state.workflowId}: ${state.status} (${state.phase}) | ${active || "no active agent"} | next: ${state.coordination.nextAction}`);
  });

program
  .command("assign")
  .argument("<workflow-id>")
  .requiredOption("--operation <key>")
  .requiredOption("--role <role>")
  .requiredOption("--stage <stage>")
  .requiredOption("--input <relative-path>")
  .requiredOption("--output <relative-path>")
  .requiredOption("--kind <artifact-kind>")
  .option("--task <task-id>")
  .option("--source-commit <sha>")
  .option("--target-commit <sha>")
  .option("--root <path>")
  .action(async (workflowId, options) => {
    const assignment = await createAgentAssignment(rootOf(options), workflowId, {
      operationKey: options.operation,
      role: AgentRoleSchema.parse(options.role),
      stage: AssignmentStageSchema.parse(options.stage),
      inputPath: options.input,
      outputPath: options.output,
      expectedKind: ArtifactKindSchema.parse(options.kind),
      taskId: options.task,
      sourceCommit: options.sourceCommit,
      targetCommit: options.targetCommit,
    });
    console.log(JSON.stringify(assignment, null, 2));
  });

program
  .command("assignments")
  .argument("<workflow-id>")
  .option("--root <path>")
  .option("--json")
  .action(async (workflowId, options) => {
    const assignments = await listAgentAssignments(rootOf(options), workflowId);
    console.log(options.json ? JSON.stringify(assignments, null, 2) : assignments.map((assignment) => `${assignment.id} ${assignment.role} ${assignment.status} ${assignment.operationKey}`).join("\n"));
  });

program
  .command("bind-agent")
  .argument("<workflow-id>")
  .argument("<assignment-id>")
  .requiredOption("--event <start-or-stop>")
  .requiredOption("--agent <agent-id>")
  .option("--reason <stop-reason>")
  .option("--root <path>")
  .action(async (workflowId, assignmentId, options) => {
    if (!["start", "stop"].includes(options.event)) throw new Error("--event must be start or stop");
    console.log(JSON.stringify(await bindAgentAssignment(rootOf(options), workflowId, assignmentId, options.event, options.agent, options.reason), null, 2));
  });

program
  .command("reconcile")
  .argument("<workflow-id>")
  .argument("<assignment-id>")
  .option("--root <path>")
  .action(async (workflowId, assignmentId, options) => {
    console.log(JSON.stringify(await reconcileAgentAssignment(rootOf(options), workflowId, assignmentId), null, 2));
  });

program
  .command("drive")
  .argument("<workflow-id>")
  .option("--session <session-id>", "Codex parent session ID")
  .option("--no-live-agents", "recover a running assignment after Codex confirms no child remains")
  .option("--root <path>")
  .option("--json")
  .action(async (workflowId, options) => {
    const result = await driveWorkflow(rootOf(options), workflowId, options.session, options.noLiveAgents);
    console.log(options.json ? JSON.stringify(result, null, 2) : `${result.action}${"nextAction" in result ? `: ${result.nextAction}` : ""}`);
  });

program
  .command("acquire-writer")
  .argument("<workflow-id>")
  .requiredOption("--role <executor-or-fixer>")
  .requiredOption("--session <session-id>")
  .option("--root <path>")
  .action(async (workflowId, options) => {
    console.log(JSON.stringify(await acquireLease(rootOf(options), workflowId, options.role, options.session), null, 2));
  });

program
  .command("release-writer")
  .argument("<workflow-id>")
  .requiredOption("--session <session-id>")
  .option("--root <path>")
  .action(async (workflowId, options) => {
    console.log(JSON.stringify(await releaseLease(rootOf(options), workflowId, options.session), null, 2));
  });

program
  .command("risk")
  .argument("<text...>")
  .action((text) => console.log(JSON.stringify(classifyRisk(text), null, 2)));

program
  .command("validate-artifacts")
  .argument("<workflow-id>")
  .option("--root <path>")
  .action(async (workflowId, options) => console.log(`Validated ${(await validateWorkflowArtifacts(rootOf(options), workflowId)).length} artifacts`));

program
  .command("gate")
  .argument("<workflow-id>")
  .option("--root <path>")
  .action(async (workflowId, options) => {
    const gate = await assessCompletionGate(rootOf(options), workflowId);
    console.log(JSON.stringify(gate, null, 2));
    if (!gate.ready) process.exitCode = 2;
  });

program
  .command("auth-state")
  .requiredOption("--project-id <id>")
  .requiredOption("--profile <name>")
  .requiredOption("--host <hostname>")
  .option("--secrets-root <path>")
  .option("--root <path>")
  .action(async (options) => console.log(JSON.stringify(await issueBrowserAuthState({ projectRoot: rootOf(options), projectId: options.projectId, profile: options.profile, host: options.host, secretsRoot: options.secretsRoot }), null, 2)));

program
  .command("delete-auth-state")
  .argument("<path>")
  .option("--secrets-root <path>")
  .action(async (path, options) => {
    await deleteBrowserAuthState(path, options.secretsRoot);
    console.log("Deleted short-lived browser auth state");
  });

program
  .command("publish-checkpoint")
  .argument("<workflow-id>")
  .requiredOption("--title <title>")
  .requiredOption("--body-file <path>")
  .requiredOption("--deployment-reviewed", "confirm deployment coupling was reviewed")
  .option("--root <path>")
  .action(async (workflowId, options) => {
    await publishCheckpoint(rootOf(options), { workflowId, deploymentReviewed: options.deploymentReviewed, title: options.title, bodyFile: options.bodyFile });
    console.log("Pushed checkpoint and created or updated the draft PR");
  });

program
  .command("merge-pr")
  .argument("<workflow-id>")
  .requiredOption("--human-approved", "record explicit human approval")
  .option("--root <path>")
  .action(async (workflowId, options) => {
    await mergePullRequest(rootOf(options), workflowId, options.humanApproved);
    console.log("Required checks passed and the PR was squash-merged");
  });

program
  .command("doctor")
  .option("--self")
  .option("--root <path>")
  .action(async (options) => {
    const checks = options.self ? await selfDoctor() : await projectDoctor(rootOf(options));
    console.log(`Doctor OK (${checks.length} checks)`);
  });

program.parseAsync().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
