import fastifyStatic from "@fastify/static";
import chokidar, { type FSWatcher } from "chokidar";
import Fastify, { type FastifyInstance } from "fastify";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ServerResponse } from "node:http";
import { addDashboardRoot, loadDashboardConfig, removeDashboardRoot } from "./config.js";
import { DashboardDatabase } from "./database.js";
import { queryCodexRateLimits } from "./rate-limits.js";
import { scanRegisteredRoots } from "./scanner.js";
import { dashboardServiceStatus } from "./service.js";
import { telemetryStatus } from "./telemetry.js";
import { importCodexTokenHistory } from "./tokens.js";
import type { HistoryRecord, ProjectRecord, SessionRecord, TaskRecord, TokenCoverage, WorkflowRecord } from "./types.js";

export interface DashboardServerOptions {
  host?: string;
  port?: number;
  databasePath?: string;
  dataDir?: string;
  codexStatePath?: string;
  codexSessionsPath?: string;
  assetsPath?: string;
  watch?: boolean;
  reconcileIntervalMs?: number;
}

export interface RunningDashboard {
  app: FastifyInstance;
  database: DashboardDatabase;
  url: string;
  refresh(): Promise<void>;
  close(): Promise<void>;
}

const DEFAULT_ASSETS = join(dirname(fileURLToPath(import.meta.url)), "dashboard-web");

export async function startDashboardServer(options: DashboardServerOptions = {}): Promise<RunningDashboard> {
  const config = await loadDashboardConfig();
  const host = options.host ?? config.host;
  if (host !== "127.0.0.1") throw new Error("The single-user dashboard may only bind to 127.0.0.1");
  const port = options.port ?? config.port;
  const database = new DashboardDatabase({ databasePath: options.databasePath, dataDir: options.dataDir });
  for (const root of config.roots) database.registerRoot(root);
  const app = Fastify({ logger: false, bodyLimit: 2 * 1024 * 1024 });
  const clients = new Set<ServerResponse>();
  let watcher: FSWatcher | undefined;
  let refreshPromise: Promise<void> | undefined;
  let refreshTimer: NodeJS.Timeout | undefined;
  let tokenRefreshPromise: Promise<void> | undefined;
  let tokenRefreshTimer: NodeJS.Timeout | undefined;
  let lastEventAt = new Date().toISOString();

  const emit = (type: string, detail: Record<string, unknown> = {}) => {
    lastEventAt = new Date().toISOString();
    const payload = `id: ${lastEventAt}\ndata: ${JSON.stringify({ type, at: lastEventAt, ...detail })}\n\n`;
    for (const client of clients) client.write(payload);
  };
  const refresh = async () => {
    if (refreshPromise) return refreshPromise;
    refreshPromise = (async () => {
      await scanRegisteredRoots(database);
      await importCodexTokenHistory(database, { statePath: options.codexStatePath, sessionsPath: options.codexSessionsPath });
      watcher?.add(database.listProjectLocations().map((location) => join(location.path, ".codex")));
      emit("dashboard.reconciled");
    })().finally(() => { refreshPromise = undefined; });
    return refreshPromise;
  };
  const scheduleRefresh = () => {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => void refresh().catch((error) => emit("dashboard.error", { message: errorMessage(error) })), 350);
  };
  const refreshTokens = async () => {
    if (tokenRefreshPromise) return tokenRefreshPromise;
    tokenRefreshPromise = importCodexTokenHistory(database, { statePath: options.codexStatePath, sessionsPath: options.codexSessionsPath })
      .then(() => emit("tokens.reconciled"))
      .finally(() => { tokenRefreshPromise = undefined; });
    return tokenRefreshPromise;
  };
  const scheduleTokenRefresh = () => {
    if (tokenRefreshTimer) clearTimeout(tokenRefreshTimer);
    tokenRefreshTimer = setTimeout(() => void refreshTokens().catch((error) => emit("dashboard.error", { message: errorMessage(error) })), 350);
  };

  app.addHook("onRequest", async (request, reply) => {
    const hostname = request.hostname;
    if (hostname !== "127.0.0.1" && hostname !== "localhost") return reply.code(403).send({ error: "Loopback access only" });
    const origin = request.headers.origin;
    if (origin) {
      try {
        const parsed = new URL(origin);
        if (!(["127.0.0.1", "localhost"].includes(parsed.hostname) && Number(parsed.port || (parsed.protocol === "https:" ? 443 : 80)) === port)) {
          return reply.code(403).send({ error: "Cross-origin access denied" });
        }
      } catch { return reply.code(403).send({ error: "Invalid origin" }); }
    }
  });

  app.get("/api/health", async () => ({ ok: true, version: "0.4.0", lastEventAt }));
  app.get("/api/overview", async () => {
    const projects = database.listProjects().map((project) => projectSummary(database, project));
    const rateLimits = await queryCodexRateLimits();
    return { projects, tokenTotals: database.getTokenTotals(), rateLimits: rateLimits.limits, rateLimitsAvailable: rateLimits.available, lastEventAt };
  });
  app.get<{ Params: { id: string } }>("/api/projects/:id", async (request, reply) => {
    const project = database.getProject(request.params.id);
    if (!project) return reply.code(404).send({ error: "Project not found" });
    const summary = projectSummary(database, project);
    const history = database.listHistory(project.id, undefined, 300).map(historyView);
    const tasks = database.listTasks(project.id);
    return {
      ...summary,
      defaultBranch: project.defaultBranch ?? "unknown",
      createdAt: project.discoveredAt,
      lastSync: project.updatedAt,
      tasks: taskCounts(tasks),
      history,
    };
  });
  app.get<{ Params: { id: string }; Querystring: { projectId?: string } }>("/api/workflows/:id", async (request, reply) => {
    const matches = database.listWorkflows(request.query.projectId).filter((candidate) => candidate.workflowId === request.params.id);
    if (!request.query.projectId && matches.length > 1) return reply.code(409).send({ error: "Workflow ID exists in multiple projects; projectId is required" });
    const workflow = matches[0];
    if (!workflow) return reply.code(404).send({ error: "Workflow not found" });
    const project = database.getProject(workflow.projectId)!;
    const tasks = database.listTasks(project.id, workflow.workflowId);
    const sessions = database.listSessions(project.id);
    const roles = ["researcher", "planner", "executor", "reviewer", "fixer", "browser-verifier"];
    return {
      id: workflow.workflowId,
      name: workflow.workflowId,
      projectId: project.id,
      projectName: project.name,
      objective: `Durable workflow ${workflow.workflowId}`,
      tier: "tracked",
      mode: "autonomous",
      status: workflowStatus(workflow.status),
      phase: workflow.phase ?? "unknown",
      branch: project.defaultBranch ?? "unknown",
      startedAt: workflow.createdAt ?? project.discoveredAt,
      updatedAt: workflow.updatedAt ?? project.updatedAt,
      phases: phaseRail(workflow),
      tasks: tasks.map((task) => taskView(task, sessions)),
      assignments: roles.map((role) => assignmentView(role, tasks, sessions)),
      history: database.listHistory(project.id, workflow.workflowId, 300).map(historyView),
    };
  });
  app.get("/api/tokens", async () => {
    const sessions = database.listSessions();
    const projects = new Map(database.listProjects().map((project) => [project.id, project]));
    const workflowByAgent = new Map(database.listTasks().filter((task) => task.agentId).map((task) => [task.agentId!, task.workflowId]));
    const rateLimits = await queryCodexRateLimits();
    return {
      totals: database.getTokenTotals(),
      records: sessions.map((session) => tokenRecord(
        session,
        projects.get(session.projectId ?? ""),
        session.agentPath ? workflowByAgent.get(session.agentPath) : undefined,
      )),
      rateLimits: rateLimits.limits,
      rateLimitsAvailable: rateLimits.available,
      rateLimitsReason: rateLimits.reason,
    };
  });
  app.get("/api/settings", async () => ({
    roots: database.listRoots().map((root) => ({ id: String(root.id), path: root.path, state: root.lastError?.startsWith("scan stopped at") ? "warning" : root.lastError ? "unavailable" : "active", lastScan: root.lastScannedAt ?? root.createdAt, projects: database.listProjects().filter((project) => project.rootId === root.id).length, warning: root.lastError })),
    retentionDays: 0,
    eventStreamUrl: "/api/events",
    lastPurgeAt: database.getSetting("last_purge_at") ?? "",
    telemetry: await telemetryStatus(),
    service: await dashboardServiceStatus(),
  }));
  app.post<{ Body: { path?: string } }>("/api/roots", async (request, reply) => {
    if (!request.body?.path) return reply.code(400).send({ error: "path is required" });
    await addDashboardRoot(request.body.path);
    const root = database.registerRoot(request.body.path);
    await refresh();
    return reply.code(201).send({ id: String(root.id), path: root.path, state: root.lastError ? "unavailable" : "active", lastScan: root.lastScannedAt ?? root.createdAt, projects: database.listProjects().filter((project) => project.rootId === root.id).length });
  });
  app.delete<{ Params: { id: string } }>("/api/roots/:id", async (request, reply) => {
    const root = database.listRoots().find((candidate) => String(candidate.id) === request.params.id);
    if (!root) return reply.code(404).send({ error: "Root not found" });
    await removeDashboardRoot(root.path);
    database.removeRoot(root.id);
    emit("root.removed", { rootId: root.id });
    return { removed: true };
  });
  app.post<{ Body: { before?: string; confirm?: boolean } }>("/api/purge", async (request, reply) => {
    if (!request.body?.confirm) return reply.code(400).send({ error: "Explicit confirmation is required" });
    const removed = database.purgeHistory(request.body.before);
    emit("history.purged", { removed });
    return { removed, purgedAt: new Date().toISOString() };
  });
  app.post("/v1/logs", async (request, reply) => {
    if (!hasCodexTokenSignal(request.body)) return reply.code(202).send();
    scheduleTokenRefresh();
    emit("tokens.observed");
    return reply.code(200).send();
  });
  app.get("/api/events", async (request, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    clients.add(reply.raw);
    reply.raw.write(`id: ${lastEventAt}\ndata: ${JSON.stringify({ type: "connected", at: lastEventAt })}\n\n`);
    request.raw.once("close", () => clients.delete(reply.raw));
  });

  const assetsPath = options.assetsPath ?? DEFAULT_ASSETS;
  if (existsSync(assetsPath)) {
    await app.register(fastifyStatic, { root: assetsPath, wildcard: false });
    app.get("/*", async (_request, reply) => reply.sendFile("index.html"));
  }

  const needsInitialDiscovery = database.listProjects().length === 0;
  // Bind before a potentially large first discovery pass. The frontend keeps its
  // event stream open and refreshes when reconciliation completes, rather than
  // appearing offline while a registered workspace is being scanned.
  await app.listen({ host, port });
  if (needsInitialDiscovery) await refresh();
  else await refreshTokens();
  if (options.watch !== false) {
    const projectRoots = database.listProjectLocations().map((location) => join(location.path, ".codex"));
    if (projectRoots.length) {
      watcher = chokidar.watch(projectRoots, {
        ignoreInitial: true,
        ignored: (path) => path.includes("workflow-secrets") || path.includes("browser-auth"),
      });
      watcher.on("all", scheduleRefresh);
    }
  }
  const interval = setInterval(() => void refresh().catch((error) => emit("dashboard.error", { message: errorMessage(error) })), options.reconcileIntervalMs ?? config.reconcileIntervalMs);
  if (!needsInitialDiscovery) scheduleRefresh();
  return {
    app,
    database,
    url: `http://${host}:${port}`,
    refresh,
    close: async () => {
      clearInterval(interval);
      if (refreshTimer) clearTimeout(refreshTimer);
      if (tokenRefreshTimer) clearTimeout(tokenRefreshTimer);
      await watcher?.close();
      for (const client of clients) client.end();
      await app.close();
      database.close();
    },
  };
}

function projectSummary(database: DashboardDatabase, project: ProjectRecord) {
  const workflows = database.listWorkflows(project.id);
  const workflow = workflows[0];
  const tasks = workflow ? database.listTasks(project.id, workflow.workflowId) : [];
  const sessions = database.listSessions(project.id);
  const currentTask = tasks.find((task) => ["running", "active", "started"].includes(task.status ?? "")) ?? tasks[0];
  const currentSession = sessions.find((session) => session.agentPath && session.agentPath === currentTask?.agentId) ?? sessions.find((session) => session.role === currentTask?.role) ?? sessions[0];
  const counts = taskCounts(tasks);
  const complete = workflows.length > 0 && workflows.every((item) => workflowStatus(item.status) === "complete");
  const coverage = coverageFor(sessions);
  return {
    id: project.id,
    name: project.name,
    path: project.path,
    branch: project.defaultBranch ?? "unknown",
    health: coverage === "offline" ? "offline" : workflowStatus(workflow?.status) === "needs human" ? "critical" : workflowStatus(workflow?.status) === "reviewing" ? "warning" : "healthy",
    live: coverage !== "offline",
    workflowId: workflow?.workflowId ?? "none",
    workflowName: workflow?.workflowId ?? "No workflow",
    phase: workflow?.phase ?? "idle",
    status: complete ? "complete" : workflowStatus(workflow?.status),
    developed: developedSummary(database.listHistory(project.id, workflow?.workflowId, 20), workflow),
    role: currentTask?.role ?? currentSession?.role ?? "coordinator",
    model: currentSession?.model ?? "not observed",
    updatedAt: workflow?.updatedAt ?? project.updatedAt,
    tokens: database.getTokenTotals(project.id).totalTokens,
    progress: counts.total ? Math.round((counts.complete / counts.total) * 100) : complete ? 100 : 0,
    coverage,
  };
}

function taskCounts(tasks: TaskRecord[]) {
  return { complete: tasks.filter((task) => ["complete", "completed", "reconciled", "succeeded"].includes(task.status ?? "")).length, total: tasks.length, blocked: tasks.filter((task) => task.status === "needs_human").length };
}

function developedSummary(history: HistoryRecord[], workflow?: WorkflowRecord): string {
  const artifact = history.find((event) => event.type.startsWith("artifact."));
  return artifact?.summary ?? (workflow ? `${workflow.workflowId} is ${workflowStatus(workflow.status)}` : "No tracked development yet");
}

function workflowStatus(status?: string | null): "researching" | "brainstorming" | "planning" | "executing" | "diagnosing" | "reviewing" | "needs human" | "complete" {
  if (!status) return "planning";
  if (status === "needs_human") return "needs human";
  if (status.includes("discover") || status.includes("research")) return "researching";
  if (status.includes("brainstorm")) return "brainstorming";
  if (status.includes("diagnos")) return "diagnosing";
  if (status.includes("review") || status.includes("verification")) return "reviewing";
  if (status.includes("complete") || status.includes("merged") || status === "done") return "complete";
  if (status.includes("plan") || status === "draft") return "planning";
  return "executing";
}

function workflowTaskStatus(status: string | null): "complete" | "running" | "queued" | "partial" | "needs human" {
  if (status === "needs_human") return "needs human";
  if (["partial", "failed", "retryable_failure", "needs_context"].includes(status ?? "")) return "partial";
  if (["complete", "completed", "reconciled", "succeeded"].includes(status ?? "")) return "complete";
  if (["running", "active", "started", "stopped", "reviewing", "remediating"].includes(status ?? "")) return "running";
  return "queued";
}

function taskView(task: TaskRecord, sessions: SessionRecord[]) {
  const session = sessions.find((candidate) => candidate.agentPath && candidate.agentPath === task.agentId) ?? sessions.find((candidate) => candidate.role === task.role);
  return { id: `${task.source}:${task.taskKey}`, title: task.operationKey ?? task.taskKey, status: workflowTaskStatus(task.status), role: task.role ?? "unassigned", model: session?.model ?? "not observed", effort: "configured", elapsed: "-", evidence: task.fileName ?? "No evidence yet" };
}

function assignmentView(role: string, tasks: TaskRecord[], sessions: SessionRecord[]) {
  const task = tasks.find((candidate) => candidate.source === "assignment" && candidate.role === role);
  const session = sessions.find((candidate) => candidate.agentPath && candidate.agentPath === task?.agentId) ?? sessions.find((candidate) => candidate.role === role);
  const status = task ? workflowTaskStatus(task.status) : "queued";
  return { role, model: session?.model ?? "not observed", status: status === "running" ? "running" : status === "complete" ? "complete" : "queued", assignmentId: task?.taskKey };
}

function historyView(event: HistoryRecord) {
  return { id: String(event.id), at: event.occurredAt ?? "", actor: event.type.startsWith("agent.") ? "agent" : "system", event: event.summary, evidence: event.sourcePath, outcome: event.status === "needs_human" || event.status === "failed" ? "warning" : event.status ? "success" : "info" };
}

function phaseRail(workflow: WorkflowRecord) {
  const names = ["Research", "Brainstorm", "Planning", "Implementation", "Review", "Browser verification"];
  const status = workflowStatus(workflow.status);
  const explicit = names.findIndex((name) => workflow.phase?.toLowerCase().includes(name.split(" ")[0].toLowerCase()));
  const active = explicit >= 0 ? explicit : status === "researching" ? 0 : status === "brainstorming" ? 1 : status === "planning" ? 2 : status === "executing" || status === "diagnosing" ? 3 : status === "reviewing" ? 4 : 5;
  const complete = status === "complete";
  return names.map((name, index) => ({ name, status: complete || index < active ? "complete" : index === active ? "active" : "queued" }));
}

function coverageFor(sessions: SessionRecord[]): TokenCoverage {
  if (!sessions.length || sessions.every((session) => session.coverage === "offline")) return "offline";
  if (sessions.some((session) => session.coverage === "partial")) return "partial";
  if (sessions.some((session) => session.coverage === "backfilled")) return "backfilled";
  return "exact";
}

function tokenRecord(session: SessionRecord, project?: ProjectRecord, workflowId?: string) {
  return { id: session.id, projectId: project?.id ?? "unallocated", project: project?.name ?? "Unallocated", workflow: workflowId ?? "Unallocated", role: session.role ?? "unallocated", model: session.model ?? "unknown", input: session.coverage === "backfilled" ? null : session.inputTokens, cached: session.coverage === "backfilled" ? null : session.cachedInputTokens, output: session.coverage === "backfilled" ? null : session.outputTokens, reasoning: session.coverage === "backfilled" ? null : session.reasoningOutputTokens, total: session.totalTokens, allocated: project ? session.totalTokens : 0, coverage: session.coverage, observedAt: session.updatedAt ?? session.createdAt ?? "" };
}

function hasCodexTokenSignal(body: unknown): boolean {
  const text = JSON.stringify(body ?? {});
  return text.includes("codex.sse_event") && (text.includes("response.completed") || text.includes("token"));
}

function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
