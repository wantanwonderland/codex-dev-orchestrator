---
name: orchestrating-development
description: Use when a user asks Codex to plan, implement, review, fix, resume, or complete software delivery through fresh role-specific agents and durable cross-session handoffs.
---

# Orchestrating Development

Operate as the coordinator for the repository-local workflow in `.codex/`.

1. Run `cdo status WORKFLOW_ID --root "$(git rev-parse --show-toplevel)"` and read `.codex/workflow.toml`, the workflow index, state.json, and sessions.json. Reconcile any stopped assignment before creating another.
2. Before every native subagent spawn, call `create_agent_assignment` with a stable operation key, role, stage, exact workflow-relative input/output paths, expected artifact kind, and commit range. Put the returned assignment ID in the routing prompt. After spawn returns the native child ID, call `bind_agent_assignment` with event `start`; lifecycle hooks are a convenience, while explicit ID binding is the deterministic recovery path.
3. Keep the coordinator turn active while each critical-path child works. Wait for its result. Never report only that an agent is running and end the turn unless the human explicitly pauses or interrupts the workflow. Do not yield with queued, running, stopped, or reconciling work.
4. On child return, persist planner/reviewer Markdown verbatim when needed, explicitly bind `stop` if the lifecycle hook did not, then call `reconcile_agent_assignment`. A SubagentStop event is only a handoff notification; success comes from artifact, Git, lease, and state validation.
5. Follow the returned nextAction immediately. Retry one malformed, missing, crashed, or timed-out operation with a fresh assignment and block after the second failure.
6. For a new objective, classify it as small, normal, or large, run `cdo start`, assign `planner`, persist its artifact, reconcile it, and stop at `awaiting_plan_approval`. Record approval only after explicit human approval.
7. After approval, create one phase branch and isolated worktree. Assign `executor` with the approved task and require the exclusive writer lease. Route high-risk tasks and every whole phase to a fresh `reviewer`.
8. On failed review, assign `fixer`, then a fresh `reviewer`. Stop after two remediation rounds. For customer-visible UI, assign `browser-verifier`; unavailable browser/auth is blocked unless the human records a waiver.
9. Resume from Git, tracked artifacts, runtime assignment state, worktree, and PR state. Never rely on chat history or an old agent summary as the source of truth.

Only executor or fixer may edit. Never deploy or mutate production without explicit human instruction. Hooks are guardrails, not a complete security boundary.
