import { z } from "zod";

export const WorkflowTierSchema = z.enum(["small", "normal", "large"]);
export const WorkflowModeSchema = z.enum(["autonomous", "remote_auto"]);
export const WorkflowIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]*$/);
export const WorkflowStatusSchema = z.enum([
  "discovering",
  "brainstorming",
  "planning",
  "executing",
  "diagnosing",
  "reviewing",
  "remediating",
  "browser_verification",
  "needs_human",
  "controller_error",
  "cancelled",
  "superseded",
  "complete",
]);
export const WriterRoleSchema = z.enum(["executor", "fixer"]);
export const AgentRoleSchema = z.enum(["researcher", "planner", "executor", "reviewer", "fixer", "browser-verifier"]);
export const AssignmentStageSchema = z.enum([
  "research",
  "planning",
  "implementation",
  "diagnosis",
  "task_review",
  "phase_review",
  "remediation",
  "browser_verification",
]);
export const AssignmentStatusSchema = z.enum(["queued", "running", "stopped", "reconciling", "reconciled", "failed", "needs_human"]);
export const AssignmentOutcomeSchema = z.enum(["succeeded", "continue", "retry", "replan", "needs_human"]);
export const TaskRiskSchema = z.enum(["normal", "high"]);
export const TaskStatusSchema = z.enum(["pending", "ready", "running", "evidence_pending", "partial", "diagnosing", "reviewing", "remediating", "complete"]);
export const FailureClassSchema = z.enum(["implementation", "artifact_contract", "agent_runtime", "controller"]);
export const DiagnosisRecommendationSchema = z.enum(["retry_executor", "repair_evidence", "assign_fixer", "assign_planner", "cancel_task", "request_human"]);
export const HumanGateKindSchema = z.enum(["product_decision", "scope_expansion", "credentials", "destructive_action", "production", "merge", "external_blocker"]);

export const WriterLeaseSchema = z.object({
  role: WriterRoleSchema,
  sessionId: z.string().min(1),
  acquiredAt: z.string().datetime(),
});

export const WorkflowBindingSchema = z.object({
  worktreePath: z.string().min(1),
  branch: z.string().min(1),
  baseCommit: z.string().min(1),
  commonGitDir: z.string().min(1),
});

export const WorkflowTaskSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  title: z.string().min(1),
  path: z.string().min(1),
  dependsOn: z.array(z.string()).default([]),
  risk: TaskRiskSchema.default("normal"),
  reviewRequired: z.boolean().default(false),
  customerVisibleUi: z.boolean().default(false),
  status: TaskStatusSchema.default("pending"),
  attempts: z.number().int().min(0).default(0),
  consecutiveNoProgress: z.number().int().min(0).default(0),
  lastFailureFingerprint: z.string().optional(),
});

export const WorkflowStateSchema = z.object({
  schema: z.union([z.literal("cdo-state/v2"), z.literal("cdo-state/v3")]),
  workflowId: WorkflowIdSchema,
  projectRoot: z.string().min(1),
  objective: z.string().min(1),
  tier: WorkflowTierSchema,
  mode: WorkflowModeSchema,
  status: WorkflowStatusSchema,
  phase: z.string().default("phase-1"),
  branch: z.string().optional(),
  worktree: WorkflowBindingSchema.optional(),
  diagnosisOrigin: z.object({
    taskId: z.string().optional(),
    previousStatus: WorkflowStatusSchema,
    previousTaskStatus: TaskStatusSchema.optional(),
    assignmentId: z.string().uuid().optional(),
  }).optional(),
  researchComplete: z.boolean().default(false),
  decisionsComplete: z.boolean().default(false),
  planRevision: z.number().int().min(0).default(0),
  tasks: z.array(WorkflowTaskSchema).default([]),
  activeTaskId: z.string().optional(),
  writerLease: WriterLeaseSchema.optional(),
  operationFailures: z.record(z.number().int().min(0)).default({}),
  humanGate: z.object({
    kind: HumanGateKindSchema,
    reason: z.string().min(1),
    requestedAt: z.string().datetime(),
  }).optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type WorkflowTier = z.infer<typeof WorkflowTierSchema>;
export type WorkflowMode = z.infer<typeof WorkflowModeSchema>;
export type WorkflowStatus = z.infer<typeof WorkflowStatusSchema>;
export type WriterRole = z.infer<typeof WriterRoleSchema>;
export type WriterLease = z.infer<typeof WriterLeaseSchema>;
export type WorkflowTask = z.infer<typeof WorkflowTaskSchema>;
export type WorkflowState = z.infer<typeof WorkflowStateSchema>;

export const ArtifactKindSchema = z.enum([
  "index",
  "research",
  "decisions",
  "spec",
  "plan",
  "phase-plan",
  "task-brief",
  "executor-report",
  "review",
  "browser-report",
  "diagnosis",
]);

export const ArtifactStatusSchema = z.enum([
  "draft",
  "ready",
  "in_progress",
  "partial",
  "needs_context",
  "retryable_failure",
  "needs_replan",
  "external_blocker",
  "safety_gate",
  "passed",
  "failed",
  "complete",
]);

export const ArtifactFrontmatterSchema = z.object({
  schema: z.literal("cdo/v2"),
  kind: ArtifactKindSchema,
  workflow_id: z.string().min(1),
  phase: z.string().optional(),
  task: z.string().optional(),
  status: ArtifactStatusSchema,
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  source_commit: z.string().optional(),
  target_commit: z.string().optional(),
  assignment_id: z.string().uuid().optional(),
  operation_key: z.string().min(1).optional(),
  agent_role: AgentRoleSchema.optional(),
  depends_on: z.array(z.string()).optional(),
  risk: TaskRiskSchema.optional(),
  review_required: z.boolean().optional(),
  customer_visible_ui: z.boolean().optional(),
  diagnosis_recommendation: DiagnosisRecommendationSchema.optional(),
});

export type ArtifactFrontmatter = z.infer<typeof ArtifactFrontmatterSchema>;
export type ArtifactStatus = z.infer<typeof ArtifactStatusSchema>;
export type ArtifactKind = z.infer<typeof ArtifactKindSchema>;

export const AgentAssignmentSchema = z.object({
  id: z.string().uuid(),
  workflowId: WorkflowIdSchema,
  operationKey: z.string().min(1),
  role: AgentRoleSchema,
  stage: AssignmentStageSchema,
  taskId: z.string().optional(),
  inputPath: z.string().min(1),
  outputPath: z.string().min(1),
  expectedKind: ArtifactKindSchema,
  attempt: z.number().int().min(1),
  status: AssignmentStatusSchema,
  agentId: z.string().min(1).optional(),
  writerLeaseSessionId: z.string().min(1).optional(),
  worktreePath: z.string().min(1).optional(),
  branch: z.string().min(1).optional(),
  baseCommit: z.string().min(1).optional(),
  headCommit: z.string().min(1).optional(),
  failureClass: FailureClassSchema.optional(),
  evidenceSourceAssignmentId: z.string().uuid().optional(),
  sourceCommit: z.string().min(1).optional(),
  targetCommit: z.string().min(1).optional(),
  assignedAt: z.string().datetime(),
  startedAt: z.string().datetime().optional(),
  stoppedAt: z.string().datetime().optional(),
  reconciledAt: z.string().datetime().optional(),
  stopReason: z.string().optional(),
  error: z.string().optional(),
  outcome: AssignmentOutcomeSchema.optional(),
  artifactStatus: ArtifactStatusSchema.optional(),
  nextAction: z.string().min(1).optional(),
  targetWorkflowStatus: WorkflowStatusSchema.optional(),
});

export const SessionLedgerSchema = z.object({
  schema: z.union([z.literal("cdo-sessions/v2"), z.literal("cdo-sessions/v3")]),
  workflowId: WorkflowIdSchema,
  assignments: z.array(AgentAssignmentSchema),
});

export type AgentRole = z.infer<typeof AgentRoleSchema>;
export type AssignmentStage = z.infer<typeof AssignmentStageSchema>;
export type AssignmentStatus = z.infer<typeof AssignmentStatusSchema>;
export type AgentAssignment = z.infer<typeof AgentAssignmentSchema>;
export type SessionLedger = z.infer<typeof SessionLedgerSchema>;

export const ProjectConfigSchema = z.object({
  project: z.object({ id: z.string().min(1), default_branch: z.string().min(1) }),
  models: z.object({ coordinator: z.string(), researcher: z.string(), planner: z.string(), reviewer: z.string(), worker: z.string() }),
  effort: z.object({ coordinator: z.string(), researcher: z.string(), planner: z.string(), reviewer: z.string(), worker: z.string() }),
  workflow: z.object({
    no_progress_limit: z.number().int().min(2).default(3),
    require_brainstorm_for: z.array(WorkflowTierSchema).default(["normal", "large"]),
    auto_commit: z.boolean(),
    worktree_dir: z.string().default(".worktrees"),
    branch_prefix: z.string().default("cdo"),
  }),
  browser: z.object({
    desktop_viewport: z.string(),
    mobile_viewport: z.string(),
    require_live_for_customer_ui: z.boolean(),
    allowed_roles: z.array(z.string()),
  }),
  credentials: z.object({
    profile_names: z.array(z.string()),
    allowed_environments: z.array(z.string()),
    allowed_hosts: z.array(z.string()),
    allow_direct_local_access: z.boolean().default(true),
  }),
  git: z.object({
    auto_push_checkpoint: z.boolean(),
    auto_draft_pr: z.boolean(),
    require_approval_if_deploy_coupled: z.boolean(),
  }),
});

export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;
