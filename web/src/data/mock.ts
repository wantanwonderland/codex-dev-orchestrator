import type { OverviewData, ProjectDetail, SettingsData, TokenData, WorkflowDetail } from "../types";

const now = Date.now();
const ago = (minutes: number) => new Date(now - minutes * 60_000).toISOString();

const sharedHistory = [
  { id: "ev-5", at: ago(4), actor: "executor", event: "Implementation checkpoint recorded", evidence: "web dashboard shell and overview", outcome: "success" as const },
  { id: "ev-4", at: ago(18), actor: "CDO runtime", event: "Writer lease renewed", evidence: "session 95c1 · phase-1", outcome: "info" as const },
  { id: "ev-3", at: ago(52), actor: "Maya Chen", event: "Plan approved", evidence: "docs/implementation-plan.md · sha256 verified", outcome: "success" as const },
  { id: "ev-2", at: ago(96), actor: "planner", event: "Plan artifact reconciled", evidence: "assignment 23b8 · passed", outcome: "success" as const },
  { id: "ev-1", at: ago(150), actor: "CDO runtime", event: "Workflow initialized", evidence: "main@8fa31d9", outcome: "info" as const },
];

export const overviewMock: OverviewData = {
  lastEventAt: ago(1),
  projects: [
    {
      id: "cdo-core", name: "CDO Core", path: "~/work/codex-dev-orchestrator", branch: "feat/0.3-monitoring",
      health: "healthy", live: true, workflowId: "workflow-030-dashboard", workflowName: "0.3 monitoring dashboard",
      phase: "Implementation", status: "executing", developed: "Multi-project monitor with durable telemetry", role: "executor",
      model: "gpt-5.6-terra", updatedAt: ago(1), tokens: 184320, progress: 62, coverage: "exact",
    },
    {
      id: "atlas-console", name: "Atlas Console", path: "~/work/atlas-console", branch: "phase/permissions",
      health: "warning", live: true, workflowId: "access-controls", workflowName: "Role-scoped access controls",
      phase: "Phase review", status: "reviewing", developed: "Policy editor and authorization matrix", role: "reviewer",
      model: "gpt-5.6-sol", updatedAt: ago(12), tokens: 126870, progress: 81, coverage: "exact",
    },
    {
      id: "relay-service", name: "Relay Service", path: "~/work/relay-service", branch: "main",
      health: "offline", live: false, workflowId: "event-recovery", workflowName: "Event recovery hardening",
      phase: "Remediation", status: "blocked", developed: "Idempotent event replay and dead-letter audit", role: "fixer",
      model: "gpt-5.6-terra", updatedAt: ago(196), tokens: 92340, progress: 74, coverage: "offline",
    },
    {
      id: "northstar-web", name: "Northstar Web", path: "~/work/northstar-web", branch: "feat/billing-v2",
      health: "healthy", live: true, workflowId: "billing-checkout", workflowName: "Billing checkout refresh",
      phase: "Browser verification", status: "reviewing", developed: "Accessible checkout and invoice history", role: "browser-verifier",
      model: "gpt-5.6-terra", updatedAt: ago(7), tokens: 73560, progress: 93, coverage: "partial",
    },
    {
      id: "signal-cli", name: "Signal CLI", path: "~/work/signal-cli", branch: "main",
      health: "healthy", live: true, workflowId: "release-17", workflowName: "Release 1.7 packaging",
      phase: "Complete", status: "complete", developed: "Signed artifacts and package validation", role: "coordinator",
      model: "gpt-5.6-terra", updatedAt: ago(38), tokens: 41820, progress: 100, coverage: "backfilled",
    },
  ],
  rateLimits: [
    { name: "5-hour session", used: 67, resetAt: new Date(now + 116 * 60_000).toISOString(), trend: 8, status: "normal" },
    { name: "Weekly", used: 83, resetAt: new Date(now + 4.2 * 86_400_000).toISOString(), trend: 11, status: "warning" },
  ],
};

export const workflowMock: WorkflowDetail = {
  id: "workflow-030-dashboard", name: "0.3 monitoring dashboard", projectId: "cdo-core", projectName: "CDO Core",
  objective: "Build a production-grade multi-project development monitor with durable workflow, agent, and token visibility.",
  tier: "Normal", mode: "Human gated", status: "executing", phase: "Implementation", branch: "feat/0.3-monitoring",
  startedAt: ago(154), updatedAt: ago(1),
  phases: [
    { name: "Planning", status: "complete" }, { name: "Approval", status: "complete" },
    { name: "Implementation", status: "active" }, { name: "Review", status: "queued" },
    { name: "Remediation", status: "queued" }, { name: "Browser verify", status: "queued" },
  ],
  tasks: [
    { id: "t1", title: "Define monitoring contract and roleplay", status: "complete", role: "planner", model: "gpt-5.6-sol", effort: "high", elapsed: "18m", evidence: "docs/roleplay/01-development-monitoring-dashboard.md" },
    { id: "t2", title: "Implement responsive dashboard shell", status: "running", role: "executor", model: "gpt-5.6-terra", effort: "medium", elapsed: "41m", evidence: "web/src" },
    { id: "t3", title: "Validate data coverage semantics", status: "queued", role: "reviewer", model: "gpt-5.6-sol", effort: "high", elapsed: "—", evidence: "Pending" },
    { id: "t4", title: "Desktop and mobile roleplay", status: "queued", role: "browser-verifier", model: "gpt-5.6-terra", effort: "medium", elapsed: "—", evidence: "Pending" },
  ],
  assignments: [
    { role: "planner", model: "gpt-5.6-sol", status: "complete", assignmentId: "23b8f3ea" },
    { role: "executor", model: "gpt-5.6-terra", status: "running", assignmentId: "95c1a2d0" },
    { role: "reviewer", model: "gpt-5.6-sol", status: "queued" },
    { role: "fixer", model: "gpt-5.6-terra", status: "idle" },
    { role: "browser-verifier", model: "gpt-5.6-terra", status: "queued" },
  ],
  history: sharedHistory,
};

export const projectMocks: Record<string, ProjectDetail> = Object.fromEntries(
  overviewMock.projects.map((project) => [project.id, {
    ...project,
    defaultBranch: "main",
    createdAt: ago(12_420),
    lastSync: project.updatedAt,
    tasks: project.id === "relay-service" ? { complete: 5, total: 8, blocked: 1 } : { complete: 3, total: 5, blocked: 0 },
    history: project.id === "cdo-core" ? sharedHistory : [
      { id: `${project.id}-2`, at: project.updatedAt, actor: project.live ? project.role : "CDO runtime", event: project.live ? "Workflow state reconciled" : "Project became unreachable", evidence: project.workflowId, outcome: project.live ? "success" : "warning" },
      { id: `${project.id}-1`, at: ago(310), actor: "coordinator", event: "Durable snapshot recorded", evidence: `${project.branch}@a17c92f`, outcome: "info" },
    ],
  }]),
);

export const tokenMock: TokenData = {
  records: [
    { id: "tok-1", projectId: "cdo-core", project: "CDO Core", workflow: "0.3 monitoring dashboard", role: "executor", model: "gpt-5.6-terra", input: 82140, cached: 52240, output: 21680, reasoning: 28260, total: 184320, allocated: 173900, coverage: "exact", observedAt: ago(1) },
    { id: "tok-2", projectId: "atlas-console", project: "Atlas Console", workflow: "Role-scoped access controls", role: "reviewer", model: "gpt-5.6-sol", input: 59400, cached: 31800, output: 14920, reasoning: 20750, total: 126870, allocated: 126870, coverage: "exact", observedAt: ago(12) },
    { id: "tok-3", projectId: "relay-service", project: "Relay Service", workflow: "Event recovery hardening", role: "fixer", model: "gpt-5.6-terra", input: null, cached: null, output: 11200, reasoning: null, total: 92340, allocated: 70200, coverage: "offline", observedAt: ago(196) },
    { id: "tok-4", projectId: "northstar-web", project: "Northstar Web", workflow: "Billing checkout refresh", role: "browser-verifier", model: "gpt-5.6-terra", input: 38200, cached: 17740, output: 8960, reasoning: null, total: 73560, allocated: 64800, coverage: "partial", observedAt: ago(7) },
    { id: "tok-5", projectId: "signal-cli", project: "Signal CLI", workflow: "Release 1.7 packaging", role: "coordinator", model: "gpt-5.6-terra", input: 24100, cached: 8200, output: 5420, reasoning: 4100, total: 41820, allocated: 41820, coverage: "backfilled", observedAt: ago(38) },
  ],
  rateLimits: overviewMock.rateLimits,
};

export const settingsMock: SettingsData = {
  roots: [
    { id: "root-1", path: "/Users/maya/work", state: "active", lastScan: ago(3), projects: 4 },
    { id: "root-2", path: "/srv/cdo/projects", state: "active", lastScan: ago(8), projects: 1 },
    { id: "root-3", path: "/Volumes/archive/legacy", state: "unavailable", lastScan: ago(810), projects: 0 },
  ],
  retentionDays: 30,
  eventStreamUrl: "/api/events",
  lastPurgeAt: ago(8_400),
};
