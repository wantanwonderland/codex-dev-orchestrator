export type TokenCoverage = "exact" | "backfilled" | "partial" | "offline";

export interface DashboardPaths {
  dataDir: string;
  databasePath: string;
  codexStatePath: string;
  codexSessionsPath: string;
}

export interface DashboardDatabaseOptions {
  dataDir?: string;
  databasePath?: string;
  readonly?: boolean;
  now?: () => Date;
}

export interface RootRecord {
  id: number;
  path: string;
  label: string | null;
  createdAt: string;
  updatedAt: string;
  lastScannedAt: string | null;
  lastError: string | null;
}

export interface ProjectRecord {
  id: string;
  rootId: number;
  path: string;
  canonicalPath: string;
  gitCommonDir: string | null;
  name: string;
  projectKey: string | null;
  defaultBranch: string | null;
  discoveredAt: string;
  updatedAt: string;
}

export interface WorkflowRecord {
  id: number;
  projectId: string;
  workflowId: string;
  path: string;
  kind: string | null;
  status: string | null;
  phase: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface TaskRecord {
  id: number;
  projectId: string;
  workflowId: string;
  taskKey: string;
  source: "artifact" | "assignment";
  kind: string | null;
  status: string | null;
  role: string | null;
  stage: string | null;
  operationKey: string | null;
  agentId: string | null;
  fileName: string | null;
  updatedAt: string | null;
}

export interface HistoryRecord {
  id: number;
  projectId: string;
  workflowId: string;
  eventKey: string;
  type: string;
  status: string | null;
  summary: string;
  occurredAt: string | null;
  sourcePath: string;
}

export interface TokenUsage {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
}

export interface TokenSnapshot extends TokenUsage {
  sessionId: string;
  observedAt: string;
  ordinal: number;
}

export interface SessionRecord extends TokenUsage {
  id: string;
  projectId: string | null;
  parentSessionId: string | null;
  rolloutPath: string | null;
  cwd: string | null;
  title: string | null;
  source: string | null;
  model: string | null;
  role: string | null;
  agentPath: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  coverage: TokenCoverage;
  inheritedPrefixTokens: number;
  rawTotalTokens: number;
}

export interface TokenTotals extends TokenUsage {
  allocatedTokens: number;
  unallocatedTokens: number;
  sessions: number;
  coverage: Record<TokenCoverage, number>;
}

export interface ProjectSnapshot {
  project: Omit<ProjectRecord, "discoveredAt" | "updatedAt">;
  locations: Array<{ rootId: number; path: string }>;
  workflows: Array<Omit<WorkflowRecord, "id" | "projectId">>;
  tasks: Array<Omit<TaskRecord, "id" | "projectId">>;
  history: Array<Omit<HistoryRecord, "id" | "projectId">>;
}

export interface ScanOptions {
  maxDepth?: number;
  maxDirectories?: number;
  ignoredDirectoryNames?: Iterable<string>;
}

export interface ScanIssue {
  path: string;
  message: string;
}

export interface ScanResult {
  rootsScanned: number;
  directoriesVisited: number;
  projectsFound: number;
  projectsStored: number;
  issues: ScanIssue[];
  truncated: boolean;
}

export interface TokenImportOptions {
  statePath?: string;
  sessionsPath?: string;
  maxRolloutFiles?: number;
}

export interface TokenImportResult {
  sessionsImported: number;
  snapshotsImported: number;
  filesRead: number;
  filesSkipped: number;
  issues: ScanIssue[];
  totals: TokenTotals;
}
