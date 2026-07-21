---
schema: cdo/v1
kind: spec
workflow_id: codex-dev-orchestrator-v1
status: approved
created_at: 2026-07-20T00:00:00.000Z
updated_at: 2026-07-20T00:00:00.000Z
---

# Codex Dev Orchestrator v1 product contract

Deliver a reusable, local-first Codex plugin in which one persistent coordinator creates explicit assignments, waits for fresh native Codex subagents, receives lifecycle notifications, reconciles durable evidence, and routes the next team owner. Use Sol/high only for planning and review and Terra/medium for coordination, execution, remediation, and browser verification. Require explicit approval of the persisted plan, one phase branch and isolated worktree, exclusive executor/fixer writer ownership, risk-based task review, mandatory whole-phase review, and live browser proof for customer-visible UI.

The deterministic TypeScript layer owns assignment lifecycle, serialized ledger writes, crash-recoverable reconciliation, schemas, state transitions, event journaling, context budgets, leases, credential adapters, completion gates, and guarded GitHub commands. Native child IDs are explicitly bindable to assignment IDs; `SubagentStart` and `SubagentStop` update the runtime ledger automatically only when routing is unambiguous and never establish success by themselves. Plan approval requires a successfully reconciled planner artifact. Tracked Markdown is the cross-session contract; untracked JSON/JSONL is runtime state. Hooks are guardrails rather than an absolute security boundary. Deployment and production mutation always require explicit human instruction.
