import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type {
  DashboardDatabaseOptions,
  DashboardPaths,
  HistoryRecord,
  ProjectRecord,
  ProjectSnapshot,
  RootRecord,
  SessionRecord,
  TaskRecord,
  TokenCoverage,
  TokenSnapshot,
  TokenTotals,
  WorkflowRecord,
} from "./types.js";

const SCHEMA_VERSION = 4;

export function defaultDashboardPaths(home?: string): DashboardPaths {
  const userHome = home ?? homedir();
  const dataDir = home ? join(home, ".codex-dev-orchestrator") : resolve(process.env.CDO_DASHBOARD_HOME ?? join(userHome, ".codex-dev-orchestrator"));
  return {
    dataDir,
    databasePath: join(dataDir, "dashboard.sqlite"),
    codexStatePath: join(userHome, ".codex", "state_5.sqlite"),
    codexSessionsPath: join(userHome, ".codex", "sessions"),
  };
}

export class DashboardDatabase {
  readonly path: string;
  private readonly db: Database.Database;
  private readonly now: () => Date;

  constructor(options: DashboardDatabaseOptions = {}) {
    const defaults = defaultDashboardPaths();
    const dataDir = resolve(options.dataDir ?? defaults.dataDir);
    this.path = resolve(options.databasePath ?? join(dataDir, "dashboard.sqlite"));
    this.now = options.now ?? (() => new Date());
    if (!options.readonly) mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    this.db = new Database(this.path, { readonly: options.readonly ?? false, fileMustExist: options.readonly ?? false });
    this.db.pragma("foreign_keys = ON");
    if (!options.readonly) {
      this.db.pragma("journal_mode = WAL");
      this.migrate();
    }
  }

  close(): void {
    this.db.close();
  }

  registerRoot(path: string, label?: string): RootRecord {
    const normalized = resolve(path);
    const now = this.timestamp();
    this.db.prepare(`
      INSERT INTO roots(path, label, created_at, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(path) DO UPDATE SET label = COALESCE(excluded.label, roots.label), updated_at = excluded.updated_at
    `).run(normalized, label ?? null, now, now);
    return this.mapRow<RootRecord>(this.db.prepare("SELECT * FROM roots WHERE path = ?").get(normalized))!;
  }

  removeRoot(id: number): boolean {
    return this.db.transaction(() => {
      const projects = this.db.prepare("SELECT id FROM projects WHERE root_id = ?").all(id) as Array<{ id: string }>;
      for (const project of projects) {
        const replacement = this.db.prepare("SELECT root_id, path FROM project_locations WHERE project_id = ? AND root_id != ? ORDER BY path LIMIT 1").get(project.id, id) as { root_id: number; path: string } | undefined;
        if (replacement) this.db.prepare("UPDATE projects SET root_id = ?, path = ?, updated_at = ? WHERE id = ?").run(replacement.root_id, replacement.path, this.timestamp(), project.id);
      }
      return this.db.prepare("DELETE FROM roots WHERE id = ?").run(id).changes > 0;
    })();
  }

  listRoots(): RootRecord[] {
    return this.mapRows<RootRecord>(this.db.prepare("SELECT * FROM roots ORDER BY path").all());
  }

  updateRootScan(id: number, error: string | null): void {
    const now = this.timestamp();
    this.db.prepare("UPDATE roots SET last_scanned_at = ?, last_error = ?, updated_at = ? WHERE id = ?").run(now, error, now, id);
  }

  replaceProjectSnapshot(snapshot: ProjectSnapshot): void {
    this.db.transaction(() => {
      const now = this.timestamp();
      const project = snapshot.project;
      this.db.prepare(`
        INSERT INTO projects(id, root_id, path, canonical_path, git_common_dir, name, project_key, default_branch, discovered_at, updated_at)
        VALUES (@id, @rootId, @path, @canonicalPath, @gitCommonDir, @name, @projectKey, @defaultBranch, @now, @now)
        ON CONFLICT(id) DO UPDATE SET
          root_id=excluded.root_id, path=excluded.path, canonical_path=excluded.canonical_path,
          git_common_dir=excluded.git_common_dir, name=excluded.name, project_key=excluded.project_key,
          default_branch=excluded.default_branch, updated_at=excluded.updated_at
      `).run({ ...project, now });
      this.db.prepare("DELETE FROM project_locations WHERE project_id = ?").run(project.id);
      const insertLocation = this.db.prepare("INSERT OR IGNORE INTO project_locations(project_id, root_id, path) VALUES (?, ?, ?)");
      for (const location of snapshot.locations) insertLocation.run(project.id, location.rootId, resolve(location.path));

      this.db.prepare("DELETE FROM workflows WHERE project_id = ?").run(project.id);
      this.db.prepare("DELETE FROM tasks WHERE project_id = ?").run(project.id);
      this.db.prepare("DELETE FROM history WHERE project_id = ?").run(project.id);
      const workflow = this.db.prepare(`INSERT INTO workflows(project_id, workflow_id, path, kind, status, phase, created_at, updated_at)
        VALUES (@projectId, @workflowId, @path, @kind, @status, @phase, @createdAt, @updatedAt)`);
      for (const row of snapshot.workflows) workflow.run({ ...row, projectId: project.id });
      const task = this.db.prepare(`INSERT INTO tasks(project_id, workflow_id, task_key, source, kind, status, role, stage, operation_key, agent_id, file_name, updated_at)
        VALUES (@projectId, @workflowId, @taskKey, @source, @kind, @status, @role, @stage, @operationKey, @agentId, @fileName, @updatedAt)`);
      for (const row of snapshot.tasks) task.run({ ...row, agentId: row.agentId ?? null, projectId: project.id });
      const history = this.db.prepare(`INSERT INTO history(project_id, workflow_id, event_key, type, status, summary, occurred_at, source_path)
        VALUES (@projectId, @workflowId, @eventKey, @type, @status, @summary, @occurredAt, @sourcePath)`);
      const cutoff = this.getSetting("history_cutoff");
      for (const row of snapshot.history) {
        if (!cutoff || (row.occurredAt !== null && row.occurredAt >= cutoff)) history.run({ ...row, projectId: project.id });
      }
    })();
  }

  listProjects(): ProjectRecord[] {
    return this.mapRows<ProjectRecord>(this.db.prepare("SELECT * FROM projects ORDER BY name, path").all());
  }

  listProjectLocations(): Array<{ projectId: string; rootId: number; path: string }> {
    return this.mapRows(this.db.prepare("SELECT project_id, root_id, path FROM project_locations ORDER BY path").all());
  }

  getProject(id: string): ProjectRecord | undefined {
    return this.mapRow<ProjectRecord>(this.db.prepare("SELECT * FROM projects WHERE id = ?").get(id));
  }

  findProjectForPath(path: string): ProjectRecord | undefined {
    const candidate = resolve(path);
    const rows = this.db.prepare(`SELECT p.* FROM projects p JOIN project_locations l ON l.project_id=p.id
      WHERE ? = l.path OR ? LIKE l.path || '/%' ORDER BY length(l.path) DESC LIMIT 1`).get(candidate, candidate);
    return this.mapRow<ProjectRecord>(rows);
  }

  listWorkflows(projectId?: string): WorkflowRecord[] {
    const rows = projectId
      ? this.db.prepare("SELECT * FROM workflows WHERE project_id = ? ORDER BY updated_at DESC, workflow_id").all(projectId)
      : this.db.prepare("SELECT * FROM workflows ORDER BY updated_at DESC, workflow_id").all();
    return this.mapRows<WorkflowRecord>(rows);
  }

  listTasks(projectId?: string, workflowId?: string): TaskRecord[] {
    let rows: unknown[];
    if (projectId && workflowId) rows = this.db.prepare("SELECT * FROM tasks WHERE project_id=? AND workflow_id=? ORDER BY updated_at DESC, task_key").all(projectId, workflowId);
    else if (projectId) rows = this.db.prepare("SELECT * FROM tasks WHERE project_id=? ORDER BY updated_at DESC, task_key").all(projectId);
    else rows = this.db.prepare("SELECT * FROM tasks ORDER BY updated_at DESC, task_key").all();
    return this.mapRows<TaskRecord>(rows);
  }

  listHistory(projectId?: string, workflowId?: string, limit = 200): HistoryRecord[] {
    let rows: unknown[];
    if (projectId && workflowId) rows = this.db.prepare("SELECT * FROM history WHERE project_id=? AND workflow_id=? ORDER BY occurred_at DESC, id DESC LIMIT ?").all(projectId, workflowId, limit);
    else if (projectId) rows = this.db.prepare("SELECT * FROM history WHERE project_id=? ORDER BY occurred_at DESC, id DESC LIMIT ?").all(projectId, limit);
    else rows = this.db.prepare("SELECT * FROM history ORDER BY occurred_at DESC, id DESC LIMIT ?").all(limit);
    return this.mapRows<HistoryRecord>(rows);
  }

  purgeHistory(before?: string): number {
    const requested = new Date(before ?? this.timestamp());
    const existing = this.getSetting("history_cutoff");
    const cutoff = existing && new Date(existing) > requested ? new Date(existing) : requested;
    if (Number.isNaN(cutoff.getTime())) throw new Error("History purge cutoff must be a valid date");
    return this.db.transaction(() => {
      const value = cutoff.toISOString();
      this.setSetting("history_cutoff", value);
      this.setSetting("last_purge_at", this.timestamp());
      const history = this.db.prepare("DELETE FROM history WHERE occurred_at IS NULL OR occurred_at < ?").run(value).changes;
      const sessions = this.db.prepare("DELETE FROM sessions WHERE COALESCE(updated_at, created_at, '') < ?").run(value).changes;
      return history + sessions;
    })();
  }

  getSetting(key: string): string | undefined {
    return (this.db.prepare("SELECT value FROM dashboard_settings WHERE key = ?").get(key) as { value?: string } | undefined)?.value;
  }

  getSourceFingerprint(path: string): { value: string; sessionId: string } | undefined {
    const row = this.db.prepare("SELECT fingerprint, session_id FROM source_files WHERE path = ?").get(path) as { fingerprint: string; session_id: string } | undefined;
    return row ? { value: row.fingerprint, sessionId: row.session_id } : undefined;
  }

  setSourceFingerprint(path: string, value: string, sessionId: string): void {
    this.upsertSourceFingerprint(path, value, sessionId);
  }

  private setSetting(key: string, value: string): void {
    this.db.prepare("INSERT INTO dashboard_settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(key, value);
  }

  replaceSession(session: SessionRecord, snapshots: TokenSnapshot[]): void {
    this.writeSession(session, snapshots, true);
  }

  appendSession(session: SessionRecord, snapshots: TokenSnapshot[]): void {
    this.writeSession(session, snapshots, false);
  }

  persistImportedSession(
    session: SessionRecord,
    snapshots: TokenSnapshot[],
    options: { append: boolean; fingerprint?: { path: string; value: string } },
  ): void {
    this.writeSession(session, snapshots, !options.append, options.fingerprint);
  }

  private writeSession(
    session: SessionRecord,
    snapshots: TokenSnapshot[],
    replaceSnapshots: boolean,
    fingerprint?: { path: string; value: string },
  ): void {
    const cutoff = this.getSetting("history_cutoff");
    const observedAt = session.updatedAt ?? session.createdAt;
    if (cutoff && (!observedAt || observedAt < cutoff)) {
      this.db.transaction(() => {
        this.db.prepare("DELETE FROM sessions WHERE id = ?").run(session.id);
        if (fingerprint) this.upsertSourceFingerprint(fingerprint.path, fingerprint.value, session.id);
      })();
      return;
    }
    this.db.transaction(() => {
      this.db.prepare(`INSERT INTO sessions(id, project_id, parent_session_id, rollout_path, cwd, title, source, model, role, agent_path,
          created_at, updated_at, coverage, inherited_prefix_tokens, raw_total_tokens, input_tokens, cached_input_tokens,
          output_tokens, reasoning_output_tokens, total_tokens)
        VALUES (@id,@projectId,@parentSessionId,@rolloutPath,@cwd,@title,@source,@model,@role,@agentPath,@createdAt,@updatedAt,@coverage,
          @inheritedPrefixTokens,@rawTotalTokens,@inputTokens,@cachedInputTokens,@outputTokens,@reasoningOutputTokens,@totalTokens)
        ON CONFLICT(id) DO UPDATE SET project_id=excluded.project_id,parent_session_id=excluded.parent_session_id,
          rollout_path=excluded.rollout_path,cwd=excluded.cwd,title=excluded.title,source=excluded.source,model=excluded.model,
          role=excluded.role,agent_path=excluded.agent_path,created_at=excluded.created_at,updated_at=excluded.updated_at,coverage=excluded.coverage,
          inherited_prefix_tokens=excluded.inherited_prefix_tokens,raw_total_tokens=excluded.raw_total_tokens,
          input_tokens=excluded.input_tokens,cached_input_tokens=excluded.cached_input_tokens,output_tokens=excluded.output_tokens,
          reasoning_output_tokens=excluded.reasoning_output_tokens,total_tokens=excluded.total_tokens`).run({ ...session, agentPath: session.agentPath ?? null });
      if (replaceSnapshots) this.db.prepare("DELETE FROM token_snapshots WHERE session_id = ?").run(session.id);
      const insert = this.db.prepare(`INSERT INTO token_snapshots(session_id, observed_at, ordinal, input_tokens,
        cached_input_tokens, output_tokens, reasoning_output_tokens, total_tokens)
        VALUES (@sessionId,@observedAt,@ordinal,@inputTokens,@cachedInputTokens,@outputTokens,@reasoningOutputTokens,@totalTokens)`);
      for (const snapshot of snapshots) {
        try {
          insert.run(snapshot);
        } catch (error) {
          throw new Error(`Unable to persist token snapshot ${snapshot.sessionId}:${snapshot.ordinal} while importing ${session.id}`, { cause: error });
        }
      }
      if (fingerprint) this.upsertSourceFingerprint(fingerprint.path, fingerprint.value, session.id);
    })();
  }

  private upsertSourceFingerprint(path: string, value: string, sessionId: string): void {
    this.db.prepare("INSERT INTO source_files(path, fingerprint, session_id) VALUES (?, ?, ?) ON CONFLICT(path) DO UPDATE SET fingerprint=excluded.fingerprint, session_id=excluded.session_id").run(path, value, sessionId);
  }

  listSessions(projectId?: string): SessionRecord[] {
    const rows = projectId
      ? this.db.prepare("SELECT * FROM sessions WHERE project_id=? ORDER BY updated_at DESC, id").all(projectId)
      : this.db.prepare("SELECT * FROM sessions ORDER BY updated_at DESC, id").all();
    return this.mapRows<SessionRecord>(rows);
  }

  getSession(id: string): SessionRecord | undefined {
    return this.mapRow<SessionRecord>(this.db.prepare("SELECT * FROM sessions WHERE id = ?").get(id));
  }

  listTokenSnapshots(sessionId: string): TokenSnapshot[] {
    return this.mapRows<TokenSnapshot>(this.db.prepare("SELECT * FROM token_snapshots WHERE session_id = ? ORDER BY ordinal").all(sessionId));
  }

  deleteSessionsNotIn(ids: Iterable<string>): void {
    const values = [...ids];
    if (values.length === 0) {
      this.db.prepare("DELETE FROM sessions").run();
      return;
    }
    const placeholders = values.map(() => "?").join(",");
    this.db.prepare(`DELETE FROM sessions WHERE id NOT IN (${placeholders})`).run(...values);
  }

  getTokenTotals(projectId?: string): TokenTotals {
    const where = projectId ? "WHERE project_id = ?" : "";
    const args = projectId ? [projectId] : [];
    const total = this.db.prepare(`SELECT COUNT(*) sessions, COALESCE(SUM(input_tokens),0) input_tokens,
      COALESCE(SUM(cached_input_tokens),0) cached_input_tokens, COALESCE(SUM(output_tokens),0) output_tokens,
      COALESCE(SUM(reasoning_output_tokens),0) reasoning_output_tokens, COALESCE(SUM(total_tokens),0) total_tokens,
      COALESCE(SUM(CASE WHEN project_id IS NULL THEN total_tokens ELSE 0 END),0) unallocated_tokens,
      COALESCE(SUM(CASE WHEN project_id IS NOT NULL THEN total_tokens ELSE 0 END),0) allocated_tokens
      FROM sessions ${where}`).get(...args) as Record<string, number>;
    const coverageRows = this.db.prepare(`SELECT coverage, COUNT(*) count FROM sessions ${where} GROUP BY coverage`).all(...args) as Array<{ coverage: TokenCoverage; count: number }>;
    const coverage: Record<TokenCoverage, number> = { exact: 0, backfilled: 0, partial: 0, offline: 0 };
    for (const row of coverageRows) coverage[row.coverage] = row.count;
    return {
      sessions: total.sessions,
      inputTokens: total.input_tokens,
      cachedInputTokens: total.cached_input_tokens,
      outputTokens: total.output_tokens,
      reasoningOutputTokens: total.reasoning_output_tokens,
      totalTokens: total.total_tokens,
      allocatedTokens: total.allocated_tokens,
      unallocatedTokens: total.unallocated_tokens,
      coverage,
    };
  }

  private timestamp(): string {
    return this.now().toISOString();
  }

  private mapRows<T>(rows: unknown[]): T[] {
    return rows.map((row) => this.mapRow<T>(row)!);
  }

  private mapRow<T>(row: unknown): T | undefined {
    if (!row) return undefined;
    const value = row as Record<string, unknown>;
    const mapped: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) mapped[key.replace(/_([a-z])/g, (_, char: string) => char.toUpperCase())] = item;
    return mapped as T;
  }

  private migrate(): void {
    this.db.transaction(() => {
      this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_meta(version INTEGER NOT NULL);
      INSERT INTO schema_meta(version) SELECT 0 WHERE NOT EXISTS (SELECT 1 FROM schema_meta);
      CREATE TABLE IF NOT EXISTS dashboard_settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS source_files(path TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, session_id TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS roots(
        id INTEGER PRIMARY KEY, path TEXT NOT NULL UNIQUE, label TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        last_scanned_at TEXT, last_error TEXT
      );
      CREATE TABLE IF NOT EXISTS projects(
        id TEXT PRIMARY KEY, root_id INTEGER NOT NULL REFERENCES roots(id) ON DELETE CASCADE, path TEXT NOT NULL,
        canonical_path TEXT NOT NULL, git_common_dir TEXT, name TEXT NOT NULL, project_key TEXT, default_branch TEXT,
        discovered_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS project_locations(
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        root_id INTEGER NOT NULL REFERENCES roots(id) ON DELETE CASCADE, path TEXT NOT NULL,
        PRIMARY KEY(project_id, root_id, path)
      );
      CREATE INDEX IF NOT EXISTS project_locations_path ON project_locations(path);
      CREATE TABLE IF NOT EXISTS workflows(
        id INTEGER PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        workflow_id TEXT NOT NULL, path TEXT NOT NULL, kind TEXT, status TEXT, phase TEXT, created_at TEXT, updated_at TEXT,
        UNIQUE(project_id, workflow_id)
      );
      CREATE TABLE IF NOT EXISTS tasks(
        id INTEGER PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        workflow_id TEXT NOT NULL, task_key TEXT NOT NULL, source TEXT NOT NULL, kind TEXT, status TEXT, role TEXT,
        stage TEXT, operation_key TEXT, agent_id TEXT, file_name TEXT, updated_at TEXT,
        UNIQUE(project_id, workflow_id, task_key, source)
      );
      CREATE TABLE IF NOT EXISTS history(
        id INTEGER PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        workflow_id TEXT NOT NULL, event_key TEXT NOT NULL, type TEXT NOT NULL, status TEXT, summary TEXT NOT NULL,
        occurred_at TEXT, source_path TEXT NOT NULL, UNIQUE(project_id, workflow_id, event_key)
      );
      CREATE TABLE IF NOT EXISTS sessions(
        id TEXT PRIMARY KEY, project_id TEXT REFERENCES projects(id) ON DELETE SET NULL, parent_session_id TEXT,
        rollout_path TEXT, cwd TEXT, title TEXT, source TEXT, model TEXT, role TEXT, agent_path TEXT, created_at TEXT, updated_at TEXT,
        coverage TEXT NOT NULL CHECK(coverage IN ('exact','backfilled','partial','offline')),
        inherited_prefix_tokens INTEGER NOT NULL DEFAULT 0, raw_total_tokens INTEGER NOT NULL DEFAULT 0,
        input_tokens INTEGER NOT NULL DEFAULT 0, cached_input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0, reasoning_output_tokens INTEGER NOT NULL DEFAULT 0,
        total_tokens INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS token_snapshots(
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, observed_at TEXT NOT NULL, ordinal INTEGER NOT NULL,
        input_tokens INTEGER NOT NULL, cached_input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL,
        reasoning_output_tokens INTEGER NOT NULL, total_tokens INTEGER NOT NULL,
        PRIMARY KEY(session_id, ordinal)
      );
    `);
      const version = (this.db.prepare("SELECT version FROM schema_meta LIMIT 1").get() as { version: number }).version;
      if (version > SCHEMA_VERSION) throw new Error(`Dashboard database schema ${version} is newer than supported schema ${SCHEMA_VERSION}`);
      const locationPrimaryKey = (this.db.prepare("PRAGMA table_info(project_locations)").all() as Array<{ name: string; pk: number }>).filter((column) => column.pk > 0).map((column) => column.name);
      if (!locationPrimaryKey.includes("root_id")) {
        this.db.exec(`
          ALTER TABLE project_locations RENAME TO project_locations_v3;
          CREATE TABLE project_locations(
            project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            root_id INTEGER NOT NULL REFERENCES roots(id) ON DELETE CASCADE, path TEXT NOT NULL,
            PRIMARY KEY(project_id, root_id, path)
          );
          INSERT OR IGNORE INTO project_locations(project_id, root_id, path) SELECT project_id, root_id, path FROM project_locations_v3;
          DROP TABLE project_locations_v3;
          CREATE INDEX IF NOT EXISTS project_locations_path ON project_locations(path);
        `);
      }
      const taskColumns = new Set((this.db.prepare("PRAGMA table_info(tasks)").all() as Array<{ name: string }>).map((row) => row.name));
      if (!taskColumns.has("agent_id")) this.db.exec("ALTER TABLE tasks ADD COLUMN agent_id TEXT");
      const sessionColumns = new Set((this.db.prepare("PRAGMA table_info(sessions)").all() as Array<{ name: string }>).map((row) => row.name));
      if (!sessionColumns.has("agent_path")) this.db.exec("ALTER TABLE sessions ADD COLUMN agent_path TEXT");
      this.db.prepare("UPDATE schema_meta SET version = ?").run(SCHEMA_VERSION);
    })();
  }
}

export function openDashboardDatabase(options: DashboardDatabaseOptions = {}): DashboardDatabase {
  return new DashboardDatabase(options);
}
