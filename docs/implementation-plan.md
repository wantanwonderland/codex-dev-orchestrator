---
schema: cdo/v2
kind: plan
workflow_id: codex-dev-orchestrator-v2
status: complete
created_at: 2026-07-21T00:00:00.000Z
updated_at: 2026-07-21T00:00:00.000Z
---

# CDO 0.4 autonomous orchestration implementation

1. Replace v1 approval and retry-limit schemas with the v2 research, brainstorming, task-graph, diagnosis, typed outcome, and typed human-gate contracts.
2. Initialize clean research and decision artifacts without fabricated placeholder tasks; add a safe managed-data reset command.
3. Add a live-web researcher and update coordinator, planner, worker, reviewer, fixer, and browser prompts for autonomous continuation and exact decomposition.
4. Reconcile partial/context/retry outcomes into continuation, repeated failure into diagnosis, replanning requests into planning, and only safety/external outcomes into `needs_human`.
5. Permit direct local workflow-secret access while retaining writer-lease and production-mutation policy guards.
6. Update CLI and MCP contracts, remove plan approval, add brainstorming decision recording and human-gate resume operations.
7. Update the dashboard to show discovery, brainstorming, diagnosis, and human gates; remove plan-approval language.
8. Write and execute the autonomous-delivery roleplay, run all unit, web, build, package, MCP, dashboard, and doctor checks, then reinstall the plugin from a cache-busted local build.
