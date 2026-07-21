---
name: orchestrating-development
description: Use when a user asks Codex to research, brainstorm, plan, implement, review, fix, resume, or complete software delivery through fresh role-specific agents and durable cross-session handoffs.
---

# Orchestrating Development

Own the repository-local workflow in `.codex/` until completion.

1. Read `.codex/workflow.toml`, the workflow index, runtime `state.json`, and `sessions.json`. Run `cdo status`. Reconcile stopped or reconciling assignments before new work.
2. Classify a new objective as small, normal, or large and run `cdo start`. Small work proceeds to planning. Normal and large work must first assign `researcher` to inspect the real repository and conduct live web research using primary/current sources with URLs and access dates.
3. After research, run a genuine interactive brainstorming session with the human. Present repository and web findings, explore alternatives and tradeoffs, ask only material product questions, and persist the answers in `decisions.md` as `ready`. Call `record_brainstorm_decisions`; brainstorming is required context, not plan approval.
4. Assign `planner`. Require a complete plan plus dependency-ordered `tasks/*.md` briefs. Every task must be sized for one focused executor session and include exact paths, concrete steps, acceptance criteria, verification commands, dependencies, risk, review need, and UI visibility. Reject placeholders and split oversized tasks.
5. Before every subagent spawn, call `create_agent_assignment` with a stable operation key, optional task ID, role, stage, exact workflow-relative paths, artifact kind, and commit evidence. Bind the returned native agent ID. Wait for the child; never end the coordinator turn with unresolved critical-path work unless the human explicitly pauses.
6. Persist returned artifacts verbatim, bind stop, and reconcile. Follow `nextAction` immediately. `partial`, `needs_context`, and `retryable_failure` mean continue or retry with a fresh context. `needs_replan` returns to planning. Three repeated operational failures route to diagnosis. Incomplete approved scope is never itself a human gate.
7. Executors and fixers acquire the exclusive writer lease, implement one task, verify it, make an atomic checkpoint commit when configured, release the lease, and report a typed outcome. Review high-risk tasks independently. When all tasks finish, require a fresh whole-phase review.
8. Failed review routes to a fixer and then a fresh reviewer without an arbitrary remediation limit. If a task is too large, split and replan it. If the same defect repeats, diagnose its root cause before another attempt.
9. Customer-visible UI requires a written named-persona roleplay and live browser verification at desktop and mobile viewports, including role switches, error states, accessibility signals, console/network errors, and screenshots.
10. Ask the human only for a typed product decision, material scope expansion, unavailable credentials, destructive action, production mutation, merge/deploy authorization, or genuine external blocker. Local workflow secrets may be read directly when project policy permits, but secret values must never enter prompts, artifacts, logs, commits, or screenshots.
11. Resume from Git, tracked artifacts, runtime state, assignment ledger, worktree, and PR evidence. Chat summaries are not the source of truth.

Only executor or fixer may edit source while a workflow is active. Never deploy, merge, perform destructive operations, or mutate production without explicit current human authorization.
