export type Health = "healthy" | "warning" | "critical" | "offline";
export type Coverage = "exact" | "backfilled" | "partial" | "offline";
export type WorkflowStatus = "researching" | "brainstorming" | "planning" | "executing" | "diagnosing" | "reviewing" | "needs human" | "complete";

export interface ProjectSummary {
  id: string;
  name: string;
  path: string;
  branch: string;
  health: Health;
  live: boolean;
  workflowId: string;
  workflowName: string;
  phase: string;
  status: WorkflowStatus;
  developed: string;
  role: string;
  model: string;
  updatedAt: string;
  tokens: number;
  progress: number;
  coverage: Coverage;
}

export interface HistoryEvent {
  id: string;
  at: string;
  actor: string;
  event: string;
  evidence: string;
  outcome: "success" | "info" | "warning";
}

export interface ProjectDetail extends ProjectSummary {
  defaultBranch: string;
  createdAt: string;
  lastSync: string;
  tasks: { complete: number; total: number; blocked: number };
  history: HistoryEvent[];
}

export interface WorkflowTask {
  id: string;
  title: string;
  status: "complete" | "running" | "queued" | "partial" | "needs human";
  role: string;
  model: string;
  effort: string;
  elapsed: string;
  evidence: string;
}

export interface Assignment {
  role: string;
  model: string;
  status: "complete" | "running" | "queued" | "idle";
  assignmentId?: string;
}

export interface WorkflowDetail {
  id: string;
  name: string;
  projectId: string;
  projectName: string;
  objective: string;
  tier: string;
  mode: string;
  status: WorkflowStatus;
  phase: string;
  branch: string;
  startedAt: string;
  updatedAt: string;
  phases: { name: string; status: "complete" | "active" | "queued" | "blocked" }[];
  tasks: WorkflowTask[];
  assignments: Assignment[];
  history: HistoryEvent[];
}

export interface TokenRecord {
  id: string;
  projectId: string;
  project: string;
  workflow: string;
  role: string;
  model: string;
  input: number | null;
  cached: number | null;
  output: number | null;
  reasoning: number | null;
  total: number;
  allocated: number;
  coverage: Coverage;
  observedAt: string;
}

export interface RateLimit {
  name: string;
  used: number;
  resetAt: string;
  trend: number;
  status: "normal" | "warning" | "critical";
}

export interface TokenData {
  records: TokenRecord[];
  rateLimits: RateLimit[];
}

export interface OverviewData {
  projects: ProjectSummary[];
  rateLimits: RateLimit[];
  lastEventAt: string;
  tokenTotals?: { totalTokens: number; allocatedTokens: number; unallocatedTokens: number };
}

export interface RootEntry {
  id: string;
  path: string;
  state: "active" | "scanning" | "warning" | "unavailable";
  lastScan: string;
  projects: number;
}

export interface SettingsData {
  roots: RootEntry[];
  retentionDays: number;
  eventStreamUrl: string;
  lastPurgeAt: string;
  telemetry?: { configured: boolean; managed: boolean; path: string; reason?: string };
  service?: { installed: boolean; path: string };
}
