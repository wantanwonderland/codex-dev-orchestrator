import Database from "better-sqlite3";
import { createReadStream } from "node:fs";
import { open, readdir, stat } from "node:fs/promises";
import { createInterface } from "node:readline";
import { resolve } from "node:path";
import { defaultDashboardPaths, DashboardDatabase } from "./database.js";
import type {
  ScanIssue,
  SessionRecord,
  TokenImportOptions,
  TokenImportResult,
  TokenSnapshot,
  TokenUsage,
} from "./types.js";

const ZERO_USAGE: TokenUsage = { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0, totalTokens: 0 };

interface ThreadMetadata {
  id: string;
  rolloutPath: string | null;
  cwd: string | null;
  parentSessionId: string | null;
  source: string | null;
  model: string | null;
  role: string | null;
  agentPath: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  stateTokens: number;
}

interface ParsedRollout {
  metadata: Partial<ThreadMetadata>;
  snapshots: TokenSnapshot[];
  firstLastUsage: TokenUsage | null;
  invalidLines: number;
  incompleteTrailingLine: boolean;
}

export async function importCodexTokenHistory(
  database: DashboardDatabase,
  options: TokenImportOptions = {},
): Promise<TokenImportResult> {
  const defaults = defaultDashboardPaths();
  const statePath = resolve(options.statePath ?? defaults.codexStatePath);
  const sessionsPath = resolve(options.sessionsPath ?? defaults.codexSessionsPath);
  const maxRolloutFiles = options.maxRolloutFiles ?? 50_000;
  const issues: ScanIssue[] = [];
  const threads = readThreadDatabase(statePath, issues);
  const parsedRollouts = new Map<string, ParsedRollout>();
  const pendingFingerprints = new Map<string, { path: string; value: string }>();
  const incrementalSessions = new Set<string>();
  const rolloutPaths = new Set<string>();
  const rolloutOwners = new Map<string, string>();
  for (const thread of threads.values()) {
    if (!thread.rolloutPath) continue;
    const path = resolve(thread.rolloutPath);
    rolloutPaths.add(path);
    rolloutOwners.set(path, thread.id);
  }
  for (const path of await collectRolloutFiles(sessionsPath, maxRolloutFiles, issues)) rolloutPaths.add(path);

  let filesRead = 0;
  let filesSkipped = 0;
  let snapshotsImported = 0;
  for (const path of rolloutPaths) {
    let parsed: ParsedRollout;
    try {
      const info = await stat(path);
      const fingerprint = `${info.size}:${info.mtimeMs}`;
      const cached = database.getSourceFingerprint(path);
      const ownerId = rolloutOwners.get(path);
      const cacheOwnerIsCurrent = !ownerId || cached?.sessionId === ownerId;
      if (cached?.value === fingerprint && cacheOwnerIsCurrent && (database.getSession(cached.sessionId) || database.getSetting("history_cutoff"))) {
        filesSkipped += 1;
        continue;
      }
      const previousSize = cached ? Number.parseInt(cached.value.split(":", 1)[0], 10) : 0;
      const sessionId = ownerId ?? cached?.sessionId;
      const existingSnapshots = sessionId ? database.listTokenSnapshots(sessionId) : [];
      const canAppend = cached && cacheOwnerIsCurrent && sessionId && database.getSession(sessionId) && Number.isFinite(previousSize) && previousSize > 0 && info.size > previousSize;
      const nextOrdinal = (existingSnapshots.at(-1)?.ordinal ?? -1) + 1;
      parsed = await parseRollout(path, canAppend
        ? { start: previousSize, endExclusive: info.size, sessionId, ordinalStart: nextOrdinal }
        : { endExclusive: info.size });
      if (canAppend) incrementalSessions.add(sessionId);
      filesRead += 1;
      if (parsed.metadata.id) pendingFingerprints.set(parsed.metadata.id, { path, value: fingerprint });
    } catch (error) {
      filesSkipped += 1;
      issues.push({ path, message: errorMessage(error) });
      continue;
    }
    const id = parsed.metadata.id;
    if (!id) {
      filesSkipped += 1;
      issues.push({ path, message: "rollout has no session metadata" });
      continue;
    }
    const previous = threads.get(id);
    threads.set(id, {
      id,
      rolloutPath: path,
      cwd: parsed.metadata.cwd ?? previous?.cwd ?? null,
      parentSessionId: parsed.metadata.parentSessionId ?? previous?.parentSessionId ?? null,
      source: parsed.metadata.source ?? previous?.source ?? null,
      model: parsed.metadata.model ?? previous?.model ?? null,
      role: parsed.metadata.role ?? previous?.role ?? null,
      agentPath: parsed.metadata.agentPath ?? previous?.agentPath ?? null,
      createdAt: parsed.metadata.createdAt ?? previous?.createdAt ?? null,
      updatedAt: parsed.metadata.updatedAt ?? previous?.updatedAt ?? null,
      stateTokens: previous?.stateTokens ?? 0,
    });
    parsedRollouts.set(id, parsed);
  }

  for (const thread of threads.values()) {
    const parsed = parsedRollouts.get(thread.id);
    if (!parsed && database.getSession(thread.id)) continue;
    // Keep both the durable cursor and snapshots unchanged until the writer finishes its final JSON record.
    if (parsed?.incompleteTrailingLine) continue;
    if (incrementalSessions.has(thread.id) && parsed?.snapshots.length === 0) {
      const fingerprint = pendingFingerprints.get(thread.id);
      if (fingerprint && !parsed.incompleteTrailingLine) database.setSourceFingerprint(fingerprint.path, fingerprint.value, thread.id);
      continue;
    }
    let parent = thread.parentSessionId ? parsedRollouts.get(thread.parentSessionId) : undefined;
    if (!parent && thread.parentSessionId) {
      const snapshots = database.listTokenSnapshots(thread.parentSessionId);
      if (snapshots.length) parent = { metadata: {}, snapshots, firstLastUsage: null, invalidLines: 0, incompleteTrailingLine: false };
    }
    const existingSession = incrementalSessions.has(thread.id) ? database.getSession(thread.id) : undefined;
    const existingSnapshots = existingSession ? database.listTokenSnapshots(thread.id) : [];
    const existingRaw = existingSnapshots.at(-1);
    const inherited = existingSession && existingRaw ? subtractUsage(snapshotUsage(existingRaw), existingSession) : undefined;
    const computed = existingSession && parsed?.snapshots.at(-1)
      ? {
          coverage: parsed.invalidLines === 0 ? existingSession.coverage : "partial" as const,
          usage: subtractUsage(snapshotUsage(parsed.snapshots.at(-1)!), inherited ?? ZERO_USAGE),
          prefix: inherited ?? ZERO_USAGE,
          rawTotal: parsed.snapshots.at(-1)!.totalTokens,
        }
      : computeSessionUsage(thread, parsed, parent);
    const projectId = thread.cwd ? database.findProjectForPath(thread.cwd)?.id ?? null : null;
    const assignment = projectId && thread.agentPath ? database.listTasks(projectId).find((task) => task.agentId === thread.agentPath) : undefined;
    const record: SessionRecord = {
      id: thread.id,
      projectId,
      parentSessionId: thread.parentSessionId,
      rolloutPath: thread.rolloutPath,
      cwd: thread.cwd,
      // Codex titles commonly contain the first user prompt, so they are deliberately not imported.
      title: null,
      source: thread.source,
      model: thread.model,
      role: thread.role ?? assignment?.role ?? null,
      agentPath: thread.agentPath,
      createdAt: thread.createdAt,
      updatedAt: thread.updatedAt,
      coverage: computed.coverage,
      inheritedPrefixTokens: computed.prefix.totalTokens,
      rawTotalTokens: computed.rawTotal,
      ...computed.usage,
    };
    const snapshots = parsed?.snapshots ?? [];
    const fingerprint = parsed && !parsed.incompleteTrailingLine ? pendingFingerprints.get(thread.id) : undefined;
    database.persistImportedSession(record, snapshots, { append: Boolean(existingSession), fingerprint });
    snapshotsImported += snapshots.length;
  }
  // An offline Codex installation must not erase the last durable dashboard snapshot.
  if (threads.size > 0) database.deleteSessionsNotIn(threads.keys());
  return {
    sessionsImported: threads.size,
    snapshotsImported,
    filesRead,
    filesSkipped,
    issues,
    totals: database.getTokenTotals(),
  };
}

export const reconcileCodexTokens = importCodexTokenHistory;

function computeSessionUsage(thread: ThreadMetadata, parsed?: ParsedRollout, parent?: ParsedRollout): {
  coverage: SessionRecord["coverage"];
  usage: TokenUsage;
  prefix: TokenUsage;
  rawTotal: number;
} {
  const final = parsed?.snapshots.at(-1);
  if (final) {
    const rollout = parsed!;
    const raw = snapshotUsage(final);
    let prefix = { ...ZERO_USAGE };
    let coverage: SessionRecord["coverage"] = rollout.invalidLines === 0 ? "exact" : "partial";
    if (thread.parentSessionId) {
      const copiedPrefix = commonSnapshotPrefix(rollout.snapshots, parent?.snapshots ?? []);
      if (copiedPrefix) prefix = snapshotUsage(copiedPrefix);
      else if (rollout.firstLastUsage) prefix = subtractUsage(snapshotUsage(rollout.snapshots[0]), rollout.firstLastUsage);
      else {
        prefix = snapshotUsage(rollout.snapshots[0]);
        coverage = "partial";
      }
    }
    return { coverage, usage: subtractUsage(raw, prefix), prefix, rawTotal: raw.totalTokens };
  }
  if (thread.stateTokens > 0 && !thread.parentSessionId) {
    const usage = { ...ZERO_USAGE, totalTokens: thread.stateTokens };
    return { coverage: "backfilled", usage, prefix: { ...ZERO_USAGE }, rawTotal: thread.stateTokens };
  }
  if (thread.stateTokens > 0) {
    return { coverage: "partial", usage: { ...ZERO_USAGE }, prefix: { ...ZERO_USAGE, totalTokens: thread.stateTokens }, rawTotal: thread.stateTokens };
  }
  return { coverage: "offline", usage: { ...ZERO_USAGE }, prefix: { ...ZERO_USAGE }, rawTotal: 0 };
}

function commonSnapshotPrefix(child: TokenSnapshot[], parent: TokenSnapshot[]): TokenSnapshot | undefined {
  let last: TokenSnapshot | undefined;
  for (let index = 0; index < Math.min(child.length, parent.length); index += 1) {
    const childUsage = snapshotUsage(child[index]);
    const parentUsage = snapshotUsage(parent[index]);
    if (Object.keys(childUsage).some((key) => childUsage[key as keyof TokenUsage] !== parentUsage[key as keyof TokenUsage])) break;
    last = child[index];
  }
  return last;
}

function readThreadDatabase(path: string, issues: ScanIssue[]): Map<string, ThreadMetadata> {
  const result = new Map<string, ThreadMetadata>();
  let db: Database.Database | undefined;
  try {
    db = new Database(path, { readonly: true, fileMustExist: true });
    const columns = new Set((db.prepare("PRAGMA table_info(threads)").all() as Array<{ name: string }>).map((row) => row.name));
    if (!columns.has("id")) throw new Error("threads table is unavailable");
    const field = (name: string, fallback: string) => columns.has(name) ? name : `${fallback} AS ${name}`;
    const rows = db.prepare(`SELECT id, ${field("rollout_path", "NULL")}, ${field("cwd", "NULL")},
      ${field("source", "NULL")}, ${field("model", "NULL")}, ${field("agent_role", "NULL")}, ${field("agent_path", "NULL")},
      ${field("created_at_ms", columns.has("created_at") ? "created_at * 1000" : "NULL")},
      ${field("updated_at_ms", columns.has("updated_at") ? "updated_at * 1000" : "NULL")},
      ${field("tokens_used", "0")} FROM threads`).all() as Array<Record<string, unknown>>;
    const parents = new Map<string, string>();
    const tables = new Set((db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>).map((row) => row.name));
    if (tables.has("thread_spawn_edges")) {
      for (const row of db.prepare("SELECT parent_thread_id, child_thread_id FROM thread_spawn_edges").all() as Array<{ parent_thread_id: string; child_thread_id: string }>) {
        parents.set(row.child_thread_id, row.parent_thread_id);
      }
    }
    for (const row of rows) {
      const id = text(row.id);
      if (!id) continue;
      result.set(id, {
        id,
        rolloutPath: text(row.rollout_path),
        cwd: text(row.cwd),
        parentSessionId: parents.get(id) ?? null,
        source: text(row.source),
        model: text(row.model),
        role: text(row.agent_role),
        agentPath: text(row.agent_path),
        createdAt: epochDate(row.created_at_ms),
        updatedAt: epochDate(row.updated_at_ms),
        stateTokens: integer(row.tokens_used),
      });
    }
  } catch (error) {
    issues.push({ path, message: errorMessage(error) });
  } finally {
    db?.close();
  }
  return result;
}

async function parseRollout(path: string, options: { endExclusive: number; start?: number; sessionId?: string; ordinalStart?: number }): Promise<ParsedRollout> {
  const stream = createReadStream(path, {
    encoding: "utf8",
    start: options.start,
    end: Math.max(0, options.endExclusive - 1),
  });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  const metadata: Partial<ThreadMetadata> = options.sessionId ? { id: options.sessionId } : {};
  const snapshots: TokenSnapshot[] = [];
  let firstLastUsage: TokenUsage | null = null;
  let invalidLines = 0;
  let lastNonBlankLineInvalidJson = false;
  let lastTimestamp: string | null = null;
  for await (const line of lines) {
    if (!line.trim()) continue;
    let entry: Record<string, unknown>;
    try {
      entry = object(JSON.parse(line)) ?? {};
      lastNonBlankLineInvalidJson = false;
    } catch {
      invalidLines += 1;
      lastNonBlankLineInvalidJson = true;
      continue;
    }
    const timestamp = isoDate(entry.timestamp);
    if (timestamp) lastTimestamp = timestamp;
    const payload = object(entry.payload);
    if (entry.type === "session_meta" && payload) {
      // Forked rollouts can embed the parent's session_meta later in the file; the first record owns identity.
      if (!metadata.id) assign(metadata, "id", text(payload.id) ?? text(payload.session_id));
      if (!metadata.parentSessionId) assign(metadata, "parentSessionId", text(payload.parent_thread_id) ?? text(payload.forked_from_id));
      if (!metadata.cwd) assign(metadata, "cwd", text(payload.cwd));
      if (!metadata.source) assign(metadata, "source", text(payload.thread_source) ?? text(payload.source));
      if (!metadata.model) assign(metadata, "model", text(payload.model));
      if (!metadata.role) assign(metadata, "role", text(payload.agent_role));
      if (!metadata.createdAt) assign(metadata, "createdAt", isoDate(payload.timestamp) ?? timestamp);
    } else if (entry.type === "turn_context" && payload) {
      metadata.model = text(payload.model) ?? metadata.model;
    } else if (entry.type === "event_msg" && payload?.type === "token_count") {
      const info = object(payload.info);
      const total = usage(object(info?.total_token_usage));
      if (!total || !metadata.id) {
        invalidLines += 1;
        continue;
      }
      const last = usage(object(info?.last_token_usage));
      if (snapshots.length === 0) firstLastUsage = last;
      snapshots.push({ sessionId: metadata.id, observedAt: timestamp ?? new Date(0).toISOString(), ordinal: (options.ordinalStart ?? 0) + snapshots.length, ...total });
    }
  }
  metadata.updatedAt = lastTimestamp ?? metadata.createdAt;
  return {
    metadata,
    snapshots,
    firstLastUsage,
    invalidLines,
    incompleteTrailingLine: lastNonBlankLineInvalidJson && !(await fileEndsWithNewline(path, options.endExclusive)),
  };
}

async function fileEndsWithNewline(path: string, endExclusive: number): Promise<boolean> {
  if (endExclusive === 0) return true;
  const handle = await open(path, "r");
  try {
    const byte = Buffer.allocUnsafe(1);
    await handle.read(byte, 0, 1, endExclusive - 1);
    return byte[0] === 0x0a || byte[0] === 0x0d;
  } finally {
    await handle.close();
  }
}

async function collectRolloutFiles(root: string, limit: number, issues: ScanIssue[]): Promise<string[]> {
  const files: string[] = [];
  const queue = [root];
  while (queue.length && files.length < limit) {
    const current = queue.shift()!;
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") issues.push({ path: current, message: errorMessage(error) });
      continue;
    }
    for (const entry of entries) {
      const path = resolve(current, entry.name);
      if (entry.isDirectory() && !entry.isSymbolicLink()) queue.push(path);
      else if (entry.isFile() && entry.name.endsWith(".jsonl")) files.push(path);
      if (files.length >= limit) break;
    }
  }
  if (queue.length) issues.push({ path: root, message: `rollout discovery stopped at the ${limit} file limit` });
  return files;
}

function usage(value: Record<string, unknown> | null): TokenUsage | null {
  if (!value || value.total_tokens === undefined) return null;
  return {
    inputTokens: integer(value.input_tokens),
    cachedInputTokens: integer(value.cached_input_tokens),
    outputTokens: integer(value.output_tokens),
    reasoningOutputTokens: integer(value.reasoning_output_tokens),
    totalTokens: integer(value.total_tokens),
  };
}

function snapshotUsage(value: TokenSnapshot): TokenUsage {
  return { inputTokens: value.inputTokens, cachedInputTokens: value.cachedInputTokens, outputTokens: value.outputTokens, reasoningOutputTokens: value.reasoningOutputTokens, totalTokens: value.totalTokens };
}

function subtractUsage(total: TokenUsage, prefix: TokenUsage): TokenUsage {
  return {
    inputTokens: Math.max(0, total.inputTokens - prefix.inputTokens),
    cachedInputTokens: Math.max(0, total.cachedInputTokens - prefix.cachedInputTokens),
    outputTokens: Math.max(0, total.outputTokens - prefix.outputTokens),
    reasoningOutputTokens: Math.max(0, total.reasoningOutputTokens - prefix.reasoningOutputTokens),
    totalTokens: Math.max(0, total.totalTokens - prefix.totalTokens),
  };
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function assign<K extends keyof ThreadMetadata>(target: Partial<ThreadMetadata>, key: K, value: ThreadMetadata[K] | null): void {
  if (value !== null) target[key] = value;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function integer(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

function isoDate(value: unknown): string | null {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) return null;
  return new Date(value).toISOString();
}

function epochDate(value: unknown): string | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? new Date(value).toISOString() : null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
