import { z } from "zod";

export const WorkflowTierSchema = z.enum(["small", "normal", "large"]);
export const WorkflowModeSchema = z.enum(["human_gated", "local_auto", "remote_auto"]);
export const WorkflowIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]*$/);
export const WorkflowStatusSchema = z.enum([
  "draft_plan",
  "awaiting_plan_approval",
  "executing",
  "reviewing",
  "remediating",
  "browser_verification",
  "blocked",
  "complete",
]);
export const WriterRoleSchema = z.enum(["executor", "fixer"]);
export const AgentRoleSchema = z.enum(["planner", "executor", "reviewer", "fixer", "browser-verifier"]);
export const AssignmentStageSchema = z.enum([
  "planning",
  "implementation",
  "task_review",
  "phase_review",
  "remediation",
  "browser_verification",
]);
export const AssignmentStatusSchema = z.enum(["queued", "running", "stopped", "reconciling", "reconciled", "failed", "blocked"]);
export const AssignmentOutcomeSchema = z.enum(["succeeded", "retry", "blocked"]);

export const WriterLeaseSchema = z.object({
  role: WriterRoleSchema,
  sessionId: z.string().min(1),
  acquiredAt: z.string().datetime(),
});

export const WorkflowStateSchema = z.object({
  schema: z.literal("cdo-state/v1"),
  workflowId: WorkflowIdSchema,
  projectRoot: z.string().min(1),
  objective: z.string().min(1),
  tier: WorkflowTierSchema,
  mode: WorkflowModeSchema,
  status: WorkflowStatusSchema,
  phase: z.string().default("phase-1"),
  branch: z.string().optional(),
  planApproval: z
    .object({
      approvedBy: z.string().min(1),
      approvedAt: z.string().datetime(),
      planSha256: z.string().regex(/^[a-f0-9]{64}$/),
    })
    .optional(),
  writerLease: WriterLeaseSchema.optional(),
  retryCount: z.number().int().min(0).max(1).default(0),
  remediationRounds: z.number().int().min(0).max(2).default(0),
  operationFailures: z.record(z.number().int().min(0).max(2)).default({}),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type WorkflowTier = z.infer<typeof WorkflowTierSchema>;
export type WorkflowMode = z.infer<typeof WorkflowModeSchema>;
export type WorkflowStatus = z.infer<typeof WorkflowStatusSchema>;
export type WriterRole = z.infer<typeof WriterRoleSchema>;
export type WriterLease = z.infer<typeof WriterLeaseSchema>;
export type WorkflowState = z.infer<typeof WorkflowStateSchema>;

export const ArtifactKindSchema = z.enum([
  "index",
  "spec",
  "plan",
  "phase-plan",
  "task-brief",
  "executor-report",
  "review",
  "browser-report",
]);

export const ArtifactFrontmatterSchema = z.object({
  schema: z.literal("cdo/v1"),
  kind: ArtifactKindSchema,
  workflow_id: z.string().min(1),
  phase: z.string().optional(),
  task: z.string().optional(),
  status: z.enum(["draft", "awaiting_approval", "approved", "in_progress", "blocked", "passed", "failed", "complete"]),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  source_commit: z.string().optional(),
  target_commit: z.string().optional(),
  assignment_id: z.string().uuid().optional(),
  operation_key: z.string().min(1).optional(),
  agent_role: AgentRoleSchema.optional(),
});

export type ArtifactFrontmatter = z.infer<typeof ArtifactFrontmatterSchema>;
export type ArtifactKind = z.infer<typeof ArtifactKindSchema>;

export const AgentAssignmentSchema = z.object({
  id: z.string().uuid(),
  workflowId: WorkflowIdSchema,
  operationKey: z.string().min(1),
  role: AgentRoleSchema,
  stage: AssignmentStageSchema,
  inputPath: z.string().min(1),
  outputPath: z.string().min(1),
  expectedKind: ArtifactKindSchema,
  attempt: z.number().int().min(1).max(2),
  status: AssignmentStatusSchema,
  agentId: z.string().min(1).optional(),
  writerLeaseSessionId: z.string().min(1).optional(),
  sourceCommit: z.string().min(1).optional(),
  targetCommit: z.string().min(1).optional(),
  assignedAt: z.string().datetime(),
  startedAt: z.string().datetime().optional(),
  stoppedAt: z.string().datetime().optional(),
  reconciledAt: z.string().datetime().optional(),
  stopReason: z.string().optional(),
  error: z.string().optional(),
  outcome: AssignmentOutcomeSchema.optional(),
  artifactStatus: ArtifactFrontmatterSchema.shape.status.optional(),
  nextAction: z.string().min(1).optional(),
  targetWorkflowStatus: WorkflowStatusSchema.optional(),
});

export const SessionLedgerSchema = z.object({
  schema: z.literal("cdo-sessions/v1"),
  workflowId: WorkflowIdSchema,
  assignments: z.array(AgentAssignmentSchema),
});

export type AgentRole = z.infer<typeof AgentRoleSchema>;
export type AssignmentStage = z.infer<typeof AssignmentStageSchema>;
export type AssignmentStatus = z.infer<typeof AssignmentStatusSchema>;
export type AgentAssignment = z.infer<typeof AgentAssignmentSchema>;
export type SessionLedger = z.infer<typeof SessionLedgerSchema>;

export const ProjectConfigSchema = z.object({
  project: z.object({
    id: z.string().min(1),
    default_branch: z.string().min(1),
  }),
  models: z.object({
    coordinator: z.string(),
    planner: z.string(),
    reviewer: z.string(),
    worker: z.string(),
  }),
  effort: z.object({
    coordinator: z.literal("medium"),
    planner: z.literal("high"),
    reviewer: z.literal("high"),
    worker: z.literal("medium"),
  }),
  workflow: z.object({
    max_retry: z.literal(1),
    max_remediation_rounds: z.literal(2),
    require_plan_approval: z.literal(true),
    auto_commit: z.boolean(),
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
  }),
  git: z.object({
    auto_push_checkpoint: z.boolean(),
    auto_draft_pr: z.boolean(),
    require_approval_if_deploy_coupled: z.boolean(),
  }),
});

export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;
