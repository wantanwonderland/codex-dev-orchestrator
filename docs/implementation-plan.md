---
schema: cdo/v1
kind: plan
workflow_id: codex-dev-orchestrator-v1
status: complete
created_at: 2026-07-20T00:00:00.000Z
updated_at: 2026-07-20T00:00:00.000Z
---

# V1 implementation plan

1. Scaffold a valid standalone plugin, TypeScript package, MIT license, and local marketplace workflow.
2. Implement validated artifact, project-config, runtime-state, risk, context-budget, and writer-lease contracts test-first.
3. Add coordinator, planner, executor, reviewer, fixer, and browser-verifier native agent templates with the locked model/effort policy.
4. Add the concise orchestration skill, deterministic MCP tools, and lifecycle hook guardrails.
5. Add the external credential broker, browser completion gate, and guarded GitHub checkpoint/merge commands.
6. Document architecture, installation, initialization, workflows, browser QA, credentials, recovery, GitHub policy, security limits, and contribution workflow in an executable README.
7. Verify unit tests, type-check, build, plugin schema, skill schema, CLI smoke flow, local installation, and a disposable target repository before creating a local checkpoint commit.

## V0.2 team-handoff extension

1. Add a versioned runtime assignment ledger with explicit role, stage, evidence path, commit, attempt, and lifecycle state.
2. Bind native child IDs explicitly to assignment IDs, with `SubagentStart` and `SubagentStop` hooks as automatic notifications when routing is unambiguous.
3. Reconcile stopped assignments through a persisted crash-recovery checkpoint against cdo/v1 artifacts, Git, writer lease release, retry policy, and deterministic next-role routing.
4. Expose assignment, reconciliation, and status operations through the CLI and MCP server.
5. Add safe project-template upgrades using managed hashes and recommendation sidecars for customized agents.
6. Update the role prompts, orchestration skill, process-flow UI, smoke tests, and roleplay verification.
7. Serialize concurrent assignment-ledger mutations, validate workflow IDs before filesystem access, and require reconciled planner evidence before approval.
