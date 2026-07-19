import { createHash } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArtifact, renderArtifact } from "./frontmatter.js";
import { StateStore } from "./state-store.js";
import type { WorkflowMode, WorkflowTier } from "./types.js";

const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

export async function initializeProject(
  projectRoot: string,
  input: { projectId: string; defaultBranch: string },
): Promise<void> {
  await mkdir(join(projectRoot, ".codex", "agents"), { recursive: true });
  await mkdir(join(projectRoot, ".codex", "workflows"), { recursive: true });
  await mkdir(join(projectRoot, ".codex", "workflow-runtime"), { recursive: true, mode: 0o700 });
  await writeFile(join(projectRoot, ".codex", "workflow.toml"), projectConfig(input), { flag: "wx" });
  await installCodexConfig(projectRoot);

  for (const name of ["coordinator", "planner", "executor", "reviewer", "fixer", "browser-verifier"]) {
    const source = join(PACKAGE_ROOT, "agents", `${name}.toml`);
    await writeFile(join(projectRoot, ".codex", "agents", `${name}.toml`), await readFile(source, "utf8"), { flag: "wx" });
  }
  await appendUnique(join(projectRoot, ".gitignore"), ".codex/workflow-runtime/\n");
}

export async function startWorkflow(
  projectRoot: string,
  input: { workflowId: string; objective: string; tier: WorkflowTier; mode?: WorkflowMode },
): Promise<void> {
  const root = join(projectRoot, ".codex", "workflows", input.workflowId);
  await mkdir(join(root, "tasks"), { recursive: true });
  await mkdir(join(root, "reports"), { recursive: true });
  await mkdir(join(root, "reviews"), { recursive: true });
  await mkdir(join(root, "browser"), { recursive: true });
  const now = new Date().toISOString();
  await writeFile(
    join(root, "index.md"),
    renderArtifact(
      { schema: "cdo/v1", kind: "index", workflow_id: input.workflowId, status: "draft", created_at: now, updated_at: now },
      `# ${input.workflowId}\n\n## Objective\n\n${input.objective}\n\n## Gate\n\nImplementation is blocked until the persisted plan is explicitly approved.`,
    ),
    { flag: "wx" },
  );
  if (input.tier !== "small") {
    await writeFile(
      join(root, "spec.md"),
      renderArtifact(
        { schema: "cdo/v1", kind: "spec", workflow_id: input.workflowId, status: "draft", created_at: now, updated_at: now },
        `# Specification\n\n## Problem\n\n${input.objective}\n\n## Scope\n\nTo be completed by the planner.\n\n## Acceptance criteria\n\nTo be completed by the planner.`,
      ),
      { flag: "wx" },
    );
  }
  const planKind = input.tier === "small" ? "task-brief" : "plan";
  const planName = input.tier === "small" ? join(root, "tasks", "task-1.md") : join(root, "plan.md");
  await writeFile(
    planName,
    renderArtifact(
      { schema: "cdo/v1", kind: planKind, workflow_id: input.workflowId, status: "awaiting_approval", created_at: now, updated_at: now },
      `# Implementation plan\n\nPlanner-owned content. The coordinator persists the planner output verbatim.`,
    ),
    { flag: "wx" },
  );
  if (input.tier === "large") {
    await mkdir(join(root, "phases"), { recursive: true });
    await writeFile(
      join(root, "phases", "phase-1.md"),
      renderArtifact(
        { schema: "cdo/v1", kind: "phase-plan", workflow_id: input.workflowId, phase: "phase-1", status: "draft", created_at: now, updated_at: now },
        "# Phase 1\n\nPlanner-owned phase contract, tasks, integration points, and release gates.",
      ),
      { flag: "wx" },
    );
    await writeFile(
      join(root, "tasks", "task-1.md"),
      renderArtifact(
        { schema: "cdo/v1", kind: "task-brief", workflow_id: input.workflowId, phase: "phase-1", task: "task-1", status: "draft", created_at: now, updated_at: now },
        "# Task 1\n\nPlanner-owned implementation brief with exact files, tests, and evidence requirements.",
      ),
      { flag: "wx" },
    );
  }
  const store = new StateStore(projectRoot, input.workflowId);
  const state = await store.create({ objective: input.objective, tier: input.tier, mode: input.mode ?? "human_gated" });
  await store.transition(state, "awaiting_plan_approval", "plan.created");
}

export async function approvePlan(projectRoot: string, workflowId: string, approvedBy: string): Promise<void> {
  const store = new StateStore(projectRoot, workflowId);
  const state = await store.load();
  if (state.status !== "awaiting_plan_approval") throw new Error("Workflow is not awaiting plan approval");
  const planPath = join(projectRoot, ".codex", "workflows", workflowId, state.tier === "small" ? "tasks/task-1.md" : "plan.md");
  const parsed = parseArtifact(await readFile(planPath, "utf8"));
  if (parsed.frontmatter.workflow_id !== workflowId) throw new Error("Plan workflow identity does not match runtime state");
  const approvedPlan = renderArtifact(
    { ...parsed.frontmatter, status: "approved", updated_at: new Date().toISOString() },
    parsed.body,
  );
  await writeFile(planPath, approvedPlan);
  const planSha256 = createHash("sha256").update(approvedPlan).digest("hex");
  await store.save(
    { ...state, planApproval: { approvedBy, approvedAt: new Date().toISOString(), planSha256 } },
    "plan.approved",
    { approvedBy, planSha256 },
  );
}

async function appendUnique(path: string, line: string): Promise<void> {
  let existing = "";
  try {
    existing = await readFile(path, "utf8");
  } catch {
    await mkdir(dirname(path), { recursive: true });
  }
  if (!existing.includes(line.trim())) await writeFile(path, `${existing}${existing && !existing.endsWith("\n") ? "\n" : ""}${line}`);
}

function projectConfig(input: { projectId: string; defaultBranch: string }): string {
  return `[project]\nid = "${input.projectId}"\ndefault_branch = "${input.defaultBranch}"\n\n[models]\ncoordinator = "gpt-5.6-terra"\nplanner = "gpt-5.6-sol"\nreviewer = "gpt-5.6-sol"\nworker = "gpt-5.6-terra"\n\n[effort]\ncoordinator = "medium"\nplanner = "high"\nreviewer = "high"\nworker = "medium"\n\n[workflow]\nmax_retry = 1\nmax_remediation_rounds = 2\nrequire_plan_approval = true\nauto_commit = true\n\n[browser]\ndesktop_viewport = "1440x900"\nmobile_viewport = "390x844"\nrequire_live_for_customer_ui = true\nallowed_roles = ["admin", "member", "customer"]\n\n[credentials]\nprofile_names = ["local"]\nallowed_environments = ["local", "test"]\nallowed_hosts = ["localhost", "127.0.0.1"]\n\n[git]\nauto_push_checkpoint = true\nauto_draft_pr = true\nrequire_approval_if_deploy_coupled = true\n`;
}

async function installCodexConfig(projectRoot: string): Promise<void> {
  const target = join(projectRoot, ".codex", "config.toml");
  const recommended = `model = "gpt-5.6-terra"\nmodel_reasoning_effort = "medium"\n\n[agents]\nmax_threads = 4\nmax_depth = 1\n`;
  try {
    await writeFile(target, recommended, { flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    await writeFile(join(projectRoot, ".codex", "config.cdo-recommended.toml"), recommended, { flag: "wx" });
  }
}

export async function projectIsInitialized(projectRoot: string): Promise<boolean> {
  try {
    await access(join(projectRoot, ".codex", "workflow.toml"));
    return true;
  } catch {
    return false;
  }
}
