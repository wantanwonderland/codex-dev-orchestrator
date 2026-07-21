#!/usr/bin/env node
import { Command } from "commander";
import { resolve } from "node:path";
import { approvePlan, initializeProject, startWorkflow, upgradeProject } from "./project.js";
import { acquireLease, bindAgentAssignment, createAgentAssignment, listAgentAssignments, reconcileAgentAssignment, releaseLease, statusSummary, transitionWorkflow } from "./workflow.js";
import { AgentRoleSchema, ArtifactKindSchema, AssignmentStageSchema, WorkflowModeSchema, WorkflowTierSchema } from "./types.js";
import { classifyRisk } from "./risk.js";
import { validateWorkflowArtifacts } from "./artifacts.js";
import { projectDoctor, selfDoctor } from "./doctor.js";
import { assessCompletionGate } from "./gates.js";
import { deleteBrowserAuthState, issueBrowserAuthState } from "./credentials.js";
import { mergePullRequest, publishCheckpoint } from "./github.js";

function rootOf(options: { root?: string }): string {
  return resolve(options.root ?? process.cwd());
}

const program = new Command();
program.name("cdo").description("Durable Codex-only development orchestration").version("0.2.0");

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
  .option("--mode <mode>", "human_gated, local_auto, or remote_auto", "human_gated")
  .option("--root <path>")
  .action(async (objective, options) => {
    await startWorkflow(rootOf(options), {
      workflowId: options.id,
      objective,
      tier: WorkflowTierSchema.parse(options.tier),
      mode: WorkflowModeSchema.parse(options.mode),
    });
    console.log(`Workflow ${options.id} is awaiting persisted plan approval`);
  });

program
  .command("upgrade-project")
  .option("--root <path>", "project root")
  .action(async (options) => {
    const result = await upgradeProject(rootOf(options));
    console.log(`Project templates upgraded: ${result.updated.length} updated, ${result.unchanged.length} unchanged, ${result.recommended.length} preserved with recommendations`);
    for (const path of result.recommended) console.log(`Review recommended template: ${path}`);
  });

program
  .command("approve-plan")
  .argument("<workflow-id>")
  .requiredOption("--by <identity>")
  .option("--root <path>")
  .action(async (workflowId, options) => {
    await approvePlan(rootOf(options), workflowId, options.by);
    console.log(`Approved the persisted plan for ${workflowId}`);
  });

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
  .command("transition")
  .argument("<workflow-id>")
  .argument("<status>")
  .option("--root <path>")
  .action(async (workflowId, status, options) => {
    console.log(JSON.stringify(await transitionWorkflow(rootOf(options), workflowId, status), null, 2));
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
