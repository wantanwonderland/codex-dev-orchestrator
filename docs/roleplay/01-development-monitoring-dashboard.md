# Roleplay: Multi-Project Development Monitoring

**Scenario:** A development lead monitors several concurrent CDO projects, follows one workflow from active execution through review, validates token accounting, and delegates a settings change while one project is offline.

**Actors:**
- **Maya Chen** — Development Lead, responsible for delivery health across multiple repositories and looking for stalled or expensive workflows before they become release risks.
- **Idris Rahman** — Platform Administrator, responsible for CDO data retention and project-root registration without changing development workflow state.
- **CDO Runtime** — Automated event source that updates workflow and project telemetry through `/api/events`.

**Test data:**
- Project `cdo-core`, healthy with an executing workflow.
- Project `atlas-console`, warning because its workflow is awaiting review.
- Project `relay-service`, offline with partial and backfilled token coverage.
- Workflow `workflow-030-dashboard`, currently in implementation and assigned to an executor.

## Scene 1 — Maya Scans the Fleet

**App:** CDO Development Monitor (`web`)
**URL:** `/`
**Page:** Overview

> Maya begins her morning by checking the whole development fleet. She needs to identify active delivery, unhealthy projects, and telemetry gaps without opening each repository.

**What Maya sees:**
- A visible **Development data** indicator when the API is unavailable and fallback data is rendered.
- Live connection state, last event time, and fleet totals for projects, active workflows, blocked work, and token usage.
- A project-health table showing repository, branch, health, current workflow phase, developed outcome, active role/model, last activity, and token total.
- Attention items for blocked work, review queues, offline projects, and rate-limit pressure.
- Token allocation and rate-limit panels that separate allocated from unallocated usage.

**Action:** Maya selects **cdo-core** from the project-health table.

> The browser navigates to `/projects/cdo-core`; the selected project is not editable from the monitoring view.

## Scene 2 — Maya Reviews One Project

**App:** CDO Development Monitor (`web`)
**URL:** `/projects/cdo-core`
**Page:** Project detail

> Maya inspects the project’s current branch and durable development history to understand what changed and whether the current workflow has dependable evidence.

**What Maya sees:**
- Project health, repository root, default and active branches, live/offline state, and last synchronization time.
- A concise **What developed** summary tied to the current workflow.
- Current workflow, phase, completion, active agent role/model, and task counts.
- Durable history entries with timestamp, actor, event, artifact or commit evidence, and outcome.
- Token coverage labeled **Exact**, **Backfilled**, **Partial**, or **Offline**, never implied to be exact when it is not.

**Action:** Maya opens workflow **workflow-030-dashboard**.

> The browser navigates to `/projects/cdo-core/workflows/workflow-030-dashboard`.

## Scene 3 — Maya Follows the Workflow

**App:** CDO Development Monitor (`web`)
**URL:** `/projects/cdo-core/workflows/workflow-030-dashboard`
**Page:** Workflow detail

> Maya follows the active workflow from its approved plan into implementation. She needs task-level ownership and model information, not only a percentage complete.

**What Maya sees:**
- Objective, tier, mode, status, current phase, branch, started time, and latest durable update.
- A phase rail covering planning, approval, implementation, review, remediation, and browser verification.
- Tasks with status, owner role, model, effort, elapsed time, and evidence path.
- Agent assignments for planner, executor, reviewer, fixer, and browser verifier, including queued or idle roles.
- A durable event history that distinguishes system transitions from human approval and agent evidence.

**Action:** Maya selects **View token detail**.

> The browser navigates to `/tokens` with the workflow available in the token breakdown.

## Scene 4 — Maya Audits Token Coverage

**App:** CDO Development Monitor (`web`)
**URL:** `/tokens`
**Page:** Tokens

> Maya checks whether current usage is attributable and whether cached or reasoning tokens are masking the actual cost of a workflow.

**What Maya sees:**
- Totals for input, cached input, output, reasoning, and total tokens.
- Allocated and unallocated totals shown separately with their percentage of all observed usage.
- A per-project and per-workflow breakdown containing every token category, model, role, source coverage, and observation time.
- Coverage legend and counts for **Exact**, **Backfilled**, **Partial**, and **Offline** records.
- Rate-limit windows with used percentage, reset time, trend, and warning state.

**Action:** Maya filters coverage to **Partial**.

> Only partial records remain, totals continue to describe the full observation window, and the filter state is visibly active.

## Scene 5 — Runtime Event Updates the Monitor

**App:** System (automated)
**URL:** `/api/events`
**Page:** Live event stream

> The CDO Runtime reconciles the executor assignment and emits a workflow update. The dashboard receives the server-sent event without requiring a manual refresh.

**System update:**
- Workflow `workflow-030-dashboard` advances from **Executing** to **Reviewing**.
- The executor task becomes **Complete** and receives a durable evidence path.
- The reviewer assignment becomes **Running**.
- Overview and project timestamps advance, and the live-status indicator reports a connected stream.

## Scene 6 — Maya Confirms the System Update

> **— Actor switch: automated CDO Runtime update returns control to Maya’s monitoring session —**

**App:** CDO Development Monitor (`web`)
**URL:** `/projects/cdo-core/workflows/workflow-030-dashboard`
**Page:** Workflow detail

> Maya returns to the workflow and confirms that the runtime transition propagated consistently through the monitoring surface.

**What Maya sees:**
- Workflow status **Reviewing** and the review phase marked active.
- Executor task **Complete** and reviewer assignment **Running**.
- A new durable-history row describing reconciliation and its evidence.
- No control that mutates, approves, retries, or advances the workflow.

**Action:** Maya asks Idris to review retention settings while she continues monitoring.

## Scene 7 — Idris Updates Monitoring Settings

> **— Actor switch: close Maya’s session and open Idris’s administrator session —**

**App:** CDO Development Monitor (`web`)
**URL:** `/settings`
**Page:** Settings

> Idris reviews project discovery and retention policy. Settings is the only route where a user can mutate dashboard configuration.

**What Idris sees:**
- Registered project roots with path, discovery state, last scan, and a remove action.
- A form to register a new root using `POST /api/roots`.
- History-retention settings and a guarded purge control using `POST /api/purge`.
- Read-only stream and API status information.

**Form completed:**
| Field | Value |
|---|---|
| Project root | `/workspace/customer-portal` |

**Action:** Idris submits **Add project root**.

> Toast: "Project root added."
> The root appears in the registered-roots list. No workflow or project development state changes.

## Scene 8 — Offline Project and Incomplete Tokens (Edge Case)

**App:** CDO Development Monitor (`web`)
**URL:** `/projects/relay-service`
**Page:** Project detail

> Maya opens an offline project whose current process cannot report exact tokens. The dashboard must preserve the last durable state without presenting stale estimates as live truth.

**What Maya sees:**
- A prominent **Offline** live-status indicator and the timestamp of the last successful observation.
- Project details and durable history remain available from the last successful snapshot.
- Current token coverage is **Offline**; older records can remain **Backfilled** or **Partial**.
- A plain-language notice states that live token totals may be incomplete and identifies fallback/development data when applicable.
- No fabricated zero values, green health state, or false live timestamp.

**Action:** Maya opens `/tokens` and filters coverage to **Offline**.

> The relay-service record remains visible with its last observation time. Allocated and unallocated values retain their known values, and unavailable categories display as unavailable rather than silently becoming zero.

## Scene 9 — Idris Uses the Guarded Purge

**App:** CDO Development Monitor (`web`)
**URL:** `/settings`
**Page:** Settings

> Idris needs to remove expired local observations while preserving active workflow state. Because this is destructive, the dashboard requires explicit confirmation.

**Action:** Idris clicks **Purge expired history**, reads the scope in the confirmation dialog, and confirms the purge.

> Toast: "Expired monitoring history purged."
> Active projects, workflows, registered roots, and current snapshots remain. The settings page reports the purge completion time.

## End State

Maya has successfully:
1. Identified fleet health, active development, and delivery risks from `/`.
2. Traced a project through `/projects/cdo-core` into `/projects/cdo-core/workflows/workflow-030-dashboard`.
3. Verified task ownership, agent roles/models, phase state, and durable evidence.
4. Audited detailed token categories, allocation, coverage quality, and rate limits at `/tokens`.
5. Confirmed that an SSE-driven runtime transition appears consistently without exposing workflow mutation controls.
6. Recognized an offline project and incomplete token evidence without mistaking fallback or stale data for live telemetry.

Idris has successfully:
1. Registered a project root from `/settings`.
2. Purged only expired monitoring history after explicit confirmation.

The system now shows workflow `workflow-030-dashboard` in **Reviewing**, preserves durable offline evidence for `relay-service`, clearly labels development fallback data when the API is unavailable, and confines all mutation controls to `/settings`.
