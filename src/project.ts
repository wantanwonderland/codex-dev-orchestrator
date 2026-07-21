import { createHash } from "node:crypto";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { renderArtifact } from "./frontmatter.js";
import { StateStore } from "./state-store.js";
import { loadProjectConfig } from "./config.js";
import { createWorkflowWorktree } from "./worktree.js";
import { WorkflowIdSchema, type WorkflowMode, type WorkflowTier } from "./types.js";

const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const CDO_VERSION = "0.5.0";
const AGENT_NAMES = ["coordinator", "researcher", "planner", "executor", "reviewer", "fixer", "browser-verifier"] as const;
const V011_AGENT_HASHES: Partial<Record<(typeof AGENT_NAMES)[number], string>> = {
  "browser-verifier": "c48dc2dd83ee5a3f7c3a9a350bea55a00277520d2756c8548aa03d1ada84b389",
  coordinator: "56f5ab6446b16102db9de9eed01e31ee5edb0a18f7127def219f1bbcae7504ae",
  executor: "19a34fcd7a824634e603d35b400bfc156f995c9994051d776a7e83d4006e1b11",
  fixer: "24d99c389b52239061112f475f29ca2bd94bb175bbe128603672662f7d2496c3",
  planner: "26459cfc0f7ccd6010b637632007d2031c2ada4655c308e85f581e6294cf632e",
  reviewer: "20d0af9b649e0c552326f7af9cf70a54467ec9797e37a2f9c2960322d783264c",
};

export async function initializeProject(
  projectRoot: string,
  input: { projectId: string; defaultBranch: string },
): Promise<void> {
  await mkdir(join(projectRoot, ".codex", "agents"), { recursive: true });
  await mkdir(join(projectRoot, ".codex", "workflows"), { recursive: true });
  await mkdir(join(projectRoot, ".codex", "workflow-runtime"), { recursive: true, mode: 0o700 });
  await writeFile(join(projectRoot, ".codex", "workflow.toml"), projectConfig(input), { flag: "wx" });
  await installCodexConfig(projectRoot);

  for (const name of AGENT_NAMES) {
    const source = join(PACKAGE_ROOT, "agents", `${name}.toml`);
    await writeFile(join(projectRoot, ".codex", "agents", `${name}.toml`), await readFile(source, "utf8"), { flag: "wx" });
  }
  await writeManagedManifest(projectRoot);
  await appendUnique(join(projectRoot, ".gitignore"), ".codex/workflow-runtime/\n");
}

export async function upgradeProject(projectRoot: string): Promise<{ updated: string[]; recommended: string[]; unchanged: string[] }> {
  await access(join(projectRoot, ".codex", "workflow.toml"));
  const managed = await readManagedManifest(projectRoot);
  const updated: string[] = [];
  const recommended: string[] = [];
  const unchanged: string[] = [];

  for (const name of AGENT_NAMES) {
    const relativePath = `.codex/agents/${name}.toml`;
    const target = join(projectRoot, relativePath);
    const source = await readFile(join(PACKAGE_ROOT, "agents", `${name}.toml`), "utf8");
    const sourceHash = sha256(source);
    let existing: string;
    try {
      existing = await readFile(target, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await writeFile(target, source);
      updated.push(relativePath);
      continue;
    }
    const existingHash = sha256(existing);
    const knownManagedHash = managed?.agentHashes[name] ?? V011_AGENT_HASHES[name];
    if (existingHash === sourceHash) {
      unchanged.push(relativePath);
    } else if (existingHash === knownManagedHash) {
      await writeFile(target, source);
      updated.push(relativePath);
    } else {
      const recommendation = join(projectRoot, ".codex", "agents", `${name}.cdo-recommended.toml`);
      await writeFile(recommendation, source);
      recommended.push(relative(projectRoot, recommendation));
    }
  }
  await writeManagedManifest(projectRoot);
  return { updated, recommended, unchanged };
}

export async function startWorkflow(
  projectRoot: string,
  input: { workflowId: string; objective: string; tier: WorkflowTier; mode?: WorkflowMode },
): Promise<{ worktreePath: string; branch: string; baseCommit: string }> {
  const workflowId = WorkflowIdSchema.parse(input.workflowId);
  const config = await loadProjectConfig(projectRoot);
  const binding = await createWorkflowWorktree(projectRoot, workflowId, { directory: config.workflow.worktree_dir, branchPrefix: config.workflow.branch_prefix });
  const root = join(binding.worktreePath, ".codex", "workflows", workflowId);
  await mkdir(join(root, "tasks"), { recursive: true });
  await mkdir(join(root, "reports"), { recursive: true });
  await mkdir(join(root, "reviews"), { recursive: true });
  await mkdir(join(root, "browser"), { recursive: true });
  const now = new Date().toISOString();
  await writeFile(
    join(root, "index.md"),
    renderArtifact(
      { schema: "cdo/v2", kind: "index", workflow_id: workflowId, status: "in_progress", created_at: now, updated_at: now },
      `# ${workflowId}\n\n## Objective\n\n${input.objective}\n\n## Operating mode\n\nThe coordinator continues autonomously through research, planning, implementation, review, remediation, and verification. Human input is requested only for a typed safety or product-decision gate.`,
    ),
    { flag: "wx" },
  );
  if (input.tier !== "small") {
    await writeFile(
      join(root, "research.md"),
      renderArtifact(
        { schema: "cdo/v2", kind: "research", workflow_id: workflowId, status: "draft", created_at: now, updated_at: now },
        `# Research\n\nThe researcher will persist repository findings and current web sources with URLs and access dates.`,
      ),
      { flag: "wx" },
    );
    await writeFile(
      join(root, "decisions.md"),
      renderArtifact(
        { schema: "cdo/v2", kind: "decisions", workflow_id: workflowId, status: "draft", created_at: now, updated_at: now },
        `# Brainstorming decisions\n\n## Questions\n\nThe coordinator records material product choices here before planning.\n\n## Decisions\n\nNo decisions recorded yet.`,
      ),
      { flag: "wx" },
    );
    await writeFile(
      join(root, "spec.md"),
      renderArtifact(
        { schema: "cdo/v2", kind: "spec", workflow_id: workflowId, status: "draft", created_at: now, updated_at: now },
        `# Specification\n\n## Problem\n\n${input.objective}\n\n## Scope\n\nDerived from research and brainstorming.\n\n## Acceptance criteria\n\nDefined before execution.`,
      ),
      { flag: "wx" },
    );
  }
  await writeFile(join(root, "plan.md"), renderArtifact(
    { schema: "cdo/v2", kind: "plan", workflow_id: workflowId, status: "draft", created_at: now, updated_at: now },
    `# Implementation plan\n\nThe planner replaces this draft with a complete dependency-ordered task bundle.`,
  ), { flag: "wx" });
  if (input.tier === "large") {
    await mkdir(join(root, "phases"), { recursive: true });
    await writeFile(
      join(root, "phases", "phase-1.md"),
      renderArtifact(
        { schema: "cdo/v2", kind: "phase-plan", workflow_id: workflowId, phase: "phase-1", status: "draft", created_at: now, updated_at: now },
        "# Phase 1\n\nThe planner replaces this draft with the phase contract, integration points, and release gates.",
      ),
      { flag: "wx" },
    );
  }
  const store = new StateStore(binding.worktreePath, workflowId);
  await store.create({ objective: input.objective, tier: input.tier, mode: input.mode ?? "autonomous", worktree: binding });
  await (await import("./process.js")).run("git", ["add", `.codex/workflows/${workflowId}`], binding.worktreePath);
  await (await import("./process.js")).run("git", ["commit", "-m", `chore(cdo): start ${workflowId}`], binding.worktreePath);
  return binding;
}

export async function resetProject(projectRoot: string): Promise<void> {
  const manifest = join(projectRoot, ".codex", "cdo-managed.json");
  await access(manifest);
  await rm(join(projectRoot, ".codex", "workflow-runtime"), { recursive: true, force: true });
  await rm(join(projectRoot, ".codex", "workflows"), { recursive: true, force: true });
  await mkdir(join(projectRoot, ".codex", "workflow-runtime"), { recursive: true, mode: 0o700 });
  await mkdir(join(projectRoot, ".codex", "workflows"), { recursive: true });
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
  return `[project]\nid = "${input.projectId}"\ndefault_branch = "${input.defaultBranch}"\n\n[models]\ncoordinator = "gpt-5.6-terra"\nresearcher = "gpt-5.6-sol"\nplanner = "gpt-5.6-sol"\nreviewer = "gpt-5.6-sol"\nworker = "gpt-5.6-terra"\n\n[effort]\ncoordinator = "high"\nresearcher = "high"\nplanner = "high"\nreviewer = "high"\nworker = "medium"\n\n[workflow]\nno_progress_limit = 3\nrequire_brainstorm_for = ["normal", "large"]\nauto_commit = true\nworktree_dir = ".worktrees"\nbranch_prefix = "cdo"\n\n[browser]\ndesktop_viewport = "1440x900"\nmobile_viewport = "390x844"\nrequire_live_for_customer_ui = true\nallowed_roles = ["admin", "member", "customer"]\n\n[credentials]\nprofile_names = ["local"]\nallowed_environments = ["local", "test"]\nallowed_hosts = ["localhost", "127.0.0.1"]\nallow_direct_local_access = true\n\n[git]\nauto_push_checkpoint = true\nauto_draft_pr = true\nrequire_approval_if_deploy_coupled = true\n`;
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

interface ManagedManifest {
  schema: "cdo-managed/v1";
  version: string;
  agentHashes: Record<string, string>;
}

async function writeManagedManifest(projectRoot: string): Promise<void> {
  const agentHashes: Record<string, string> = {};
  for (const name of AGENT_NAMES) {
    agentHashes[name] = sha256(await readFile(join(PACKAGE_ROOT, "agents", `${name}.toml`), "utf8"));
  }
  const manifest: ManagedManifest = { schema: "cdo-managed/v1", version: CDO_VERSION, agentHashes };
  await writeFile(join(projectRoot, ".codex", "cdo-managed.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

async function readManagedManifest(projectRoot: string): Promise<ManagedManifest | undefined> {
  try {
    const value = JSON.parse(await readFile(join(projectRoot, ".codex", "cdo-managed.json"), "utf8")) as ManagedManifest;
    return value.schema === "cdo-managed/v1" ? value : undefined;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
