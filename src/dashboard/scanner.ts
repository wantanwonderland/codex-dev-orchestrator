import { createHash } from "node:crypto";
import type { Dirent } from "node:fs";
import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { parse as parseToml } from "smol-toml";
import { parse as parseYaml } from "yaml";
import { DashboardDatabase } from "./database.js";
import type { HistoryRecord, ProjectSnapshot, ScanIssue, ScanOptions, ScanResult, TaskRecord, WorkflowRecord } from "./types.js";

const DEFAULT_IGNORED = new Set([".git", "node_modules", "dist", "build", "coverage", ".next", ".cache", ".gradle", ".idea", ".venv", "Pods", "target", "vendor"]);
const MAX_METADATA_BYTES = 1024 * 1024;

interface Candidate {
  rootId: number;
  projectPath: string;
  canonicalPath: string;
  gitCommonDir: string | null;
  identity: string;
}

interface ArtifactMetadata {
  schema?: unknown;
  kind?: unknown;
  workflow_id?: unknown;
  task?: unknown;
  status?: unknown;
  phase?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
  agent_role?: unknown;
  operation_key?: unknown;
}

export async function scanRegisteredRoots(database: DashboardDatabase, options: ScanOptions = {}): Promise<ScanResult> {
  const maxDepth = options.maxDepth ?? 8;
  const maxDirectories = options.maxDirectories ?? 25_000;
  const ignored = new Set(options.ignoredDirectoryNames ?? DEFAULT_IGNORED);
  const issues: ScanIssue[] = [];
  const candidates: Candidate[] = [];
  let directoriesVisited = 0;
  let truncated = false;
  const roots = database.listRoots();

  for (const root of roots) {
    let rootError: string | null = null;
    let rootDirectoriesVisited = 0;
    const queue: Array<{ path: string; depth: number }> = [{ path: root.path, depth: 0 }];
    while (queue.length > 0) {
      if (rootDirectoriesVisited >= maxDirectories) {
        truncated = true;
        rootError = `scan stopped at the ${maxDirectories} directory limit`;
        break;
      }
      const current = queue.shift()!;
      directoriesVisited += 1;
      rootDirectoriesVisited += 1;
      let entries;
      try {
        entries = await readdir(current.path, { withFileTypes: true });
      } catch (error) {
        const message = errorMessage(error);
        issues.push({ path: current.path, message });
        rootError ??= message;
        continue;
      }
      const codex = entries.find((entry) => entry.isDirectory() && entry.name === ".codex");
      if (codex && await isFile(join(current.path, ".codex", "workflow.toml"))) {
        try {
          const canonicalPath = await realpath(current.path);
          const gitCommonDir = await resolveGitCommonDir(current.path);
          candidates.push({
            rootId: root.id,
            projectPath: resolve(current.path),
            canonicalPath,
            gitCommonDir,
            identity: gitCommonDir ?? canonicalPath,
          });
        } catch (error) {
          issues.push({ path: current.path, message: errorMessage(error) });
        }
        continue;
      }
      if (current.depth >= maxDepth) continue;
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.isSymbolicLink() || ignored.has(entry.name)) continue;
        queue.push({ path: join(current.path, entry.name), depth: current.depth + 1 });
      }
    }
    database.updateRootScan(root.id, rootError);
  }

  const grouped = new Map<string, Candidate[]>();
  for (const candidate of candidates) grouped.set(candidate.identity, [...(grouped.get(candidate.identity) ?? []), candidate]);
  let projectsStored = 0;
  for (const group of grouped.values()) {
    const preferred = [...group].sort((left, right) => left.projectPath.length - right.projectPath.length)[0];
    try {
      const snapshot = await readProject(preferred, group, issues);
      database.replaceProjectSnapshot(snapshot);
      projectsStored += 1;
    } catch (error) {
      issues.push({ path: preferred.projectPath, message: errorMessage(error) });
    }
  }

  return {
    rootsScanned: roots.length,
    directoriesVisited,
    projectsFound: candidates.length,
    projectsStored,
    issues,
    truncated,
  };
}

export const scanDashboardProjects = scanRegisteredRoots;

async function readProject(preferred: Candidate, locations: Candidate[], issues: ScanIssue[]): Promise<ProjectSnapshot> {
  const configPath = join(preferred.projectPath, ".codex", "workflow.toml");
  let projectKey: string | null = null;
  let defaultBranch: string | null = null;
  try {
    const config = parseToml(await readMetadataFile(configPath)) as { project?: { id?: unknown; default_branch?: unknown } };
    projectKey = stringValue(config.project?.id);
    defaultBranch = stringValue(config.project?.default_branch);
  } catch (error) {
    issues.push({ path: configPath, message: errorMessage(error) });
  }
  const workflows: ProjectSnapshot["workflows"] = [];
  const tasks: ProjectSnapshot["tasks"] = [];
  const history: ProjectSnapshot["history"] = [];
  for (const location of locations) {
    const workflowRoot = join(location.projectPath, ".codex", "workflows");
    let workflowEntries: Dirent[] = [];
    try {
      workflowEntries = (await readdir(workflowRoot, { withFileTypes: true })).filter((entry) => entry.isDirectory());
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") issues.push({ path: workflowRoot, message: errorMessage(error) });
    }
    for (const entry of workflowEntries) {
      const parsed = await readWorkflow(location.projectPath, entry.name, issues);
      workflows.push(parsed.workflow);
      tasks.push(...parsed.tasks);
      history.push(...parsed.history);
    }
  }
  return {
    project: {
      id: stableId(preferred.identity),
      rootId: preferred.rootId,
      path: preferred.projectPath,
      canonicalPath: preferred.canonicalPath,
      gitCommonDir: preferred.gitCommonDir,
      name: projectKey ?? basename(preferred.projectPath),
      projectKey,
      defaultBranch,
    },
    locations: locations.map((candidate) => ({ rootId: candidate.rootId, path: candidate.projectPath })),
    workflows: newestBy(workflows, (workflow) => workflow.workflowId, (workflow) => workflow.updatedAt),
    tasks: newestBy(tasks, (task) => `${task.workflowId}:${task.source}:${task.taskKey}`, (task) => task.updatedAt),
    history: newestBy(history, (event) => `${event.workflowId}:${event.eventKey}`, (event) => event.occurredAt),
  };
}

async function readWorkflow(projectPath: string, workflowId: string, issues: ScanIssue[]): Promise<{
  workflow: Omit<WorkflowRecord, "id" | "projectId">;
  tasks: Array<Omit<TaskRecord, "id" | "projectId">>;
  history: Array<Omit<HistoryRecord, "id" | "projectId">>;
}> {
  const workflowPath = join(projectPath, ".codex", "workflows", workflowId);
  const files = await collectMetadataFiles(workflowPath, 3, issues);
  const metadata: Array<{ path: string; value: ArtifactMetadata }> = [];
  for (const path of files.filter((path) => path.endsWith(".md"))) {
    try {
      const frontmatter = parseFrontmatter(await readMetadataFile(path));
      if (frontmatter) metadata.push({ path, value: frontmatter });
    } catch (error) {
      issues.push({ path, message: errorMessage(error) });
    }
  }
  const index = metadata.find((item) => item.value.kind === "index") ?? metadata.find((item) => basename(item.path) === "index.md") ?? metadata[0];
  const runtimePath = join(projectPath, ".codex", "workflow-runtime", workflowId);
  const state = await readJsonObject(join(runtimePath, "state.json"), issues);
  const ledger = await readJsonObject(join(runtimePath, "sessions.json"), issues);
  const tasks: Array<Omit<TaskRecord, "id" | "projectId">> = [];
  const history: Array<Omit<HistoryRecord, "id" | "projectId">> = [];

  for (const item of metadata) {
    const kind = stringValue(item.value.kind);
    const taskKey = stringValue(item.value.task) ?? basename(item.path, ".md");
    if (kind === "task-brief" || kind === "executor-report" || kind === "review" || kind === "browser-report") {
      tasks.push({
        workflowId,
        taskKey,
        source: "artifact",
        kind,
        status: stringValue(item.value.status),
        role: stringValue(item.value.agent_role),
        stage: null,
        operationKey: stringValue(item.value.operation_key),
        agentId: null,
        fileName: relative(workflowPath, item.path),
        updatedAt: dateValue(item.value.updated_at),
      });
    }
    history.push({
      workflowId,
      eventKey: `artifact:${relative(workflowPath, item.path)}`,
      type: `artifact.${kind ?? "metadata"}`,
      status: stringValue(item.value.status),
      summary: `${kind ?? "artifact"}: ${relative(workflowPath, item.path)}`,
      occurredAt: dateValue(item.value.updated_at) ?? dateValue(item.value.created_at),
      sourcePath: item.path,
    });
  }

  const assignments = Array.isArray(ledger?.assignments) ? ledger.assignments : [];
  for (let index = 0; index < assignments.length; index += 1) {
    const value = objectValue(assignments[index]);
    if (!value) continue;
    const key = stringValue(value.operationKey) ?? stringValue(value.id) ?? `assignment-${index + 1}`;
    tasks.push({
      workflowId,
      taskKey: key,
      source: "assignment",
      kind: stringValue(value.expectedKind),
      status: stringValue(value.status),
      role: stringValue(value.role),
      stage: stringValue(value.stage),
      operationKey: stringValue(value.operationKey),
      agentId: stringValue(value.agentId),
      fileName: stringValue(value.outputPath),
      updatedAt: dateValue(value.reconciledAt) ?? dateValue(value.stoppedAt) ?? dateValue(value.startedAt) ?? dateValue(value.assignedAt),
    });
  }
  await readRuntimeEvents(join(runtimePath, "events.jsonl"), workflowId, history, issues);

  return {
    workflow: {
      workflowId,
      path: workflowPath,
      kind: stringValue(index?.value.kind),
      status: stringValue(state?.status) ?? stringValue(index?.value.status),
      phase: stringValue(state?.phase) ?? stringValue(index?.value.phase),
      createdAt: dateValue(state?.createdAt) ?? dateValue(index?.value.created_at),
      updatedAt: dateValue(state?.updatedAt) ?? dateValue(index?.value.updated_at),
    },
    tasks: dedupe(tasks, (task) => `${task.source}:${task.taskKey}`),
    history: dedupe(history, (event) => event.eventKey),
  };
}

async function readRuntimeEvents(path: string, workflowId: string, target: Array<Omit<HistoryRecord, "id" | "projectId">>, issues: ScanIssue[]): Promise<void> {
  let text: string;
  try {
    text = await readMetadataFile(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") issues.push({ path, message: errorMessage(error) });
    return;
  }
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    try {
      const value = objectValue(JSON.parse(line));
      if (!value) continue;
      const type = stringValue(value.type) ?? "workflow.event";
      const detail = objectValue(value.detail);
      const status = stringValue(detail?.status) ?? stringValue(detail?.to) ?? stringValue(detail?.outcome);
      target.push({
        workflowId,
        eventKey: `runtime:${index + 1}:${type}`,
        type,
        status,
        summary: status ? `${type}: ${status}` : type,
        occurredAt: dateValue(value.at),
        sourcePath: path,
      });
    } catch (error) {
      issues.push({ path: `${path}:${index + 1}`, message: errorMessage(error) });
    }
  }
}

async function collectMetadataFiles(root: string, maxDepth: number, issues: ScanIssue[]): Promise<string[]> {
  const files: string[] = [];
  const queue = [{ path: root, depth: 0 }];
  while (queue.length) {
    const current = queue.shift()!;
    try {
      for (const entry of await readdir(current.path, { withFileTypes: true })) {
        const path = join(current.path, entry.name);
        if (entry.isFile() && entry.name.endsWith(".md")) files.push(path);
        else if (entry.isDirectory() && current.depth < maxDepth) queue.push({ path, depth: current.depth + 1 });
      }
    } catch (error) {
      issues.push({ path: current.path, message: errorMessage(error) });
    }
  }
  return files.sort();
}

async function resolveGitCommonDir(projectPath: string): Promise<string | null> {
  const dotGit = join(projectPath, ".git");
  try {
    const info = await lstat(dotGit);
    if (info.isDirectory()) return realpath(dotGit);
    if (!info.isFile()) return null;
    const pointer = await readMetadataFile(dotGit);
    const match = pointer.match(/^gitdir:\s*(.+)\s*$/m);
    if (!match) return null;
    const gitDir = resolve(projectPath, match[1]);
    try {
      const common = (await readMetadataFile(join(gitDir, "commondir"))).trim();
      return realpath(resolve(gitDir, common));
    } catch {
      return realpath(gitDir);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function readMetadataFile(path: string): Promise<string> {
  const value = await readFile(path);
  if (value.byteLength > MAX_METADATA_BYTES) throw new Error(`metadata file exceeds ${MAX_METADATA_BYTES} bytes`);
  return value.toString("utf8");
}

function parseFrontmatter(text: string): ArtifactMetadata | null {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return null;
  return objectValue(parseYaml(match[1])) as ArtifactMetadata | null;
}

async function readJsonObject(path: string, issues: ScanIssue[]): Promise<Record<string, unknown> | null> {
  try {
    return objectValue(JSON.parse(await readMetadataFile(path)));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") issues.push({ path, message: errorMessage(error) });
    return null;
  }
}

async function isFile(path: string): Promise<boolean> {
  try { return (await lstat(path)).isFile(); } catch { return false; }
}

function stableId(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 24);
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function dateValue(value: unknown): string | null {
  const text = stringValue(value);
  return text && !Number.isNaN(Date.parse(text)) ? new Date(text).toISOString() : null;
}

function dedupe<T>(values: T[], key: (value: T) => string): T[] {
  return [...new Map(values.map((value) => [key(value), value])).values()];
}

function newestBy<T>(values: T[], key: (value: T) => string, timestamp: (value: T) => string | null): T[] {
  const result = new Map<string, T>();
  for (const value of values) {
    const previous = result.get(key(value));
    if (!previous || (timestamp(value) ?? "") >= (timestamp(previous) ?? "")) result.set(key(value), value);
  }
  return [...result.values()];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
