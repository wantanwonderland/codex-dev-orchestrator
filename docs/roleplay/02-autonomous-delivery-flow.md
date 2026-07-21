# Roleplay: Autonomous delivery with typed human gates

## Purpose

Verify that CDO 0.4 continues ordinary development autonomously, exposes its progress clearly, and pauses only for a legitimate human decision or safety boundary.

## Actors

- Maya, product owner: supplies the objective and participates in brainstorming.
- Orion, coordinator: owns the workflow and routes all specialist work.
- Rhea, researcher: inspects the repository and current primary web sources.
- Ezra, executor: implements focused task briefs under the writer lease.
- Priya, reviewer: independently checks task and phase evidence.
- Bea, browser verifier: executes the named-persona browser journey.

## Preconditions

- CDO is freshly installed and an isolated fixture repository is initialized.
- The dashboard is running on loopback.
- No production or destructive operation is authorized.
- Local test credentials may be read directly, but must not appear in evidence.

## Scene 1: Research before planning

Maya starts a normal workflow. Orion routes Rhea before the planner. Rhea records repository evidence, current web sources, URLs, access dates, and open decisions. The dashboard shows Research as active and does not show plan approval.

Expected: research completion advances to Brainstorming.

## Scene 2: Interactive brainstorming

Orion presents findings and alternatives to Maya, asks material product questions, and records her decisions in `decisions.md`. No implementation begins before the decisions artifact is ready.

Expected: recording decisions advances directly to Planning without a plan-approval gate.

## Scene 3: Detailed decomposition

The planner creates multiple exact, dependency-ordered task briefs. Each has paths, steps, acceptance criteria, verification commands, risk, review policy, and UI visibility. A placeholder or cyclic task bundle is rejected.

Expected: a valid bundle advances to Execution and identifies the next ready task.

## Scene 4: Ordinary failure recovery

Ezra reports partial work, then a retryable failure. Orion preserves evidence and continues with a fresh assignment. The third repeated no-progress result routes to Diagnosis, not Maya.

Expected: no human gate is created; the dashboard shows Partial or Diagnosing.

## Scene 5: Review and remediation

Priya fails a high-risk task review. Orion routes a fixer and a fresh reviewer until the finding is resolved, with no arbitrary round limit.

Expected: remediation cycles remain autonomous and auditable.

## Scene 6: Legitimate human gate

An operation would delete material data or mutate production. Orion records a typed safety gate with the exact action, target, reason, and requested authority.

Expected: status becomes Needs Human; no mutation occurs before Maya explicitly approves.

## Scene 7: Live UI verification

Bea tests the dashboard at 1440x900 and 390x844. She verifies Research, Brainstorming, Planning, Executing, Diagnosing, Reviewing, and Needs Human labels; keyboard focus; responsive layout; console/network errors; and that secret values are absent.

Expected: screenshots and a `cdo/v2` browser report provide evidence for every scene.

## Execution evidence

Executed on 2026-07-21 against the packaged loopback dashboard and an isolated initialized normal-tier workflow.

- Desktop 1440x900: `.playwright-cli/cdo04-workflow.png`
- Mobile 390x844: `.playwright-cli/cdo04-live-mobile.png`
- Accessibility snapshots: `.playwright-cli/cdo04-workflow.yaml` and `.playwright-cli/cdo04-live-mobile.yaml`
- Real API checks: `/api/overview`, `/api/events`, and `/api/workflows/autonomous-flow` returned HTTP 200.
- Browser console: zero errors and zero warnings on the packaged dashboard.
- Responsive proof: document width equaled the 390px viewport with no page-level horizontal overflow.
- Content proof: Researching status, all six delivery phases, researcher assignment, and the autonomous-workflow policy banner were present.
