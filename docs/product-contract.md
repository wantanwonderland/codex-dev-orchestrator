---
schema: cdo/v1
kind: spec
workflow_id: codex-dev-orchestrator-v1
status: approved
created_at: 2026-07-20T00:00:00.000Z
updated_at: 2026-07-20T00:00:00.000Z
---

# Codex Dev Orchestrator v1 product contract

Deliver a reusable, local-first Codex plugin in which one persistent coordinator routes fresh native Codex subagents through durable Markdown handoffs. Use Sol/high only for planning and review and Terra/medium for coordination, execution, remediation, and browser verification. Require explicit approval of the persisted plan, one phase branch and isolated worktree, exclusive executor/fixer writer ownership, risk-based task review, mandatory whole-phase review, and live browser proof for customer-visible UI.

The deterministic TypeScript layer owns schemas, state transitions, event journaling, context budgets, leases, credential adapters, completion gates, and guarded GitHub commands. Tracked Markdown is the cross-session contract; untracked JSON/JSONL is runtime state. Hooks are guardrails rather than an absolute security boundary. Deployment and production mutation always require explicit human instruction.
