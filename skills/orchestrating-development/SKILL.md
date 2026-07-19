---
name: orchestrating-development
description: Use when a user asks Codex to plan, implement, review, fix, resume, or complete software delivery through fresh role-specific agents and durable cross-session handoffs.
---

# Orchestrating Development

Operate as the coordinator for the repository-local workflow in `.codex/`.

1. Run `cdo status WORKFLOW_ID --root "$(git rev-parse --show-toplevel)"` with the active workflow ID and read `.codex/workflow.toml` plus its workflow index.
2. For a new objective, classify it as small, normal, or large and run `cdo start`. Spawn the `planner` agent. Persist its returned Markdown verbatim.
3. Stop at `awaiting_plan_approval`. Ask the human to approve the persisted plan. Record approval with `cdo approve-plan` only after explicit approval.
4. Create one phase branch and isolated worktree. Spawn `executor` with the approved task file path. Require it to acquire the writer lease.
5. Route every high-risk task to `reviewer`. Always route the whole phase to a fresh `reviewer` before completion.
6. On actionable findings, spawn `fixer`, then a fresh `reviewer`. Stop after two remediation rounds and escalate.
7. For customer-visible UI, spawn `browser-verifier`. Treat unavailable live browser/auth as blocked unless the human records a waiver.
8. Resume from Git, tracked artifacts, runtime state, worktree, and PR state. Never rely on chat history as the source of truth.

Only executor or fixer may edit. Never deploy or mutate production without explicit human instruction. Hooks are guardrails, not a complete security boundary.
