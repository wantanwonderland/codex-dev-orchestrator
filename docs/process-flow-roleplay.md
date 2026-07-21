# Roleplay: CDO Team Handoff Process

**Scenario:** An engineering lead and two specialists use the process-flow page to verify that CDO assigns work, receives child-agent notifications, reconciles evidence, and routes the next owner like an accountable development team.
**Date:** July 2026
**Actors:**
- **Nadia Rahman** — Engineering lead, responsible for knowing who owns the next delivery action.
- **Arun Patel** — Software engineer, checking how implementation work is assigned and handed to review.
- **Mei Lin Tan** — Senior reviewer, checking that child completion cannot bypass independent evidence review.

## Scene 1 — Nadia Confirms The Installation Boundary

**App:** Static documentation site (`docs/process-flow.html`)
**URL:** `file://.../docs/process-flow.html`
**Page:** Codex Dev Orchestrator process flow

> Nadia needs to explain which parts are installed for the current user and which parts belong to each repository.

**What Nadia sees:**
- Separate user-level and per-project lanes.
- `cdo-managed.json` listed with the tracked project contract.
- Runtime assignment state separated from tracked workflow evidence.

**Action:** Nadia reads both install lanes and the State And Files section.

> **Result:** She can identify the user-level plugin, CLI, MCP, and hooks, then the per-project policy, agents, managed hashes, artifacts, and ignored runtime ledger.

## Scene 2 — Arun Follows An Implementation Handoff

> — Actor switch: Nadia hands the process review to Arun. —

**App:** Static documentation site (`docs/process-flow.html`)
**URL:** `file://.../docs/process-flow.html#lifecycle`
**Page:** Delivery Lifecycle

> Arun wants to know what happens between receiving an approved task and a reviewer seeing his work.

**What Arun sees:**
- A Handoff loop tab.
- Five stages: assign owner, acknowledge, do the work, notify lead, verify and route.
- Explicit `queued`, `running`, `SubagentStop`, and `nextAction` labels.

**Action:** Arun selects **Handoff loop** and follows the sequence from left to right.

> **Result:** The five handoff nodes are highlighted. Arun can explain that the coordinator waits for him, receives the stop notification, validates his report and Git evidence, and routes a reviewer automatically.

## Scene 3 — Mei Checks The Failure Boundary

> — Actor switch: Arun closes his view and Mei opens the same lifecycle section as reviewer. —

**App:** Static documentation site (`docs/process-flow.html`)
**URL:** `file://.../docs/process-flow.html#lifecycle`
**Page:** Delivery Lifecycle

> Mei checks the edge case where a child agent ends but does not produce valid evidence.

**What Mei sees:**
- A warning that a stopped agent is not a successful agent.
- One fresh-session retry for missing or malformed evidence.
- Human reconciliation after the second failure.
- Independent reviewer, fixer, and browser-verifier roles remain separate.

**Action:** Mei selects **Review gate**, then returns to **Handoff loop**.

> **Result:** She confirms that stop notification, evidence reconciliation, remediation, and re-review are distinct steps; no child self-approves its own work.

## Scene 4 — Nadia Verifies The Mobile Handoff View

> — Actor switch: Nadia opens the page at a phone-sized viewport before sharing it with the team. —

**App:** Static documentation site (`docs/process-flow.html`)
**URL:** `file://.../docs/process-flow.html`
**Page:** Codex Dev Orchestrator process flow

> Nadia must ensure the assignment loop remains readable when the page is viewed on a narrow screen.

**What Nadia sees:**
- Handoff nodes stack vertically without clipping.
- Tab labels remain usable through horizontal toolbar scrolling.
- No text overlaps buttons, process nodes, or the failure warning.

**Action:** Nadia scrolls from installation through lifecycle, agents, and state.

> **Result:** The same team ownership and recovery rules remain readable at the mobile viewport.

## End State

Nadia can identify the current owner and next action. Arun understands how an implementation handoff reaches review. Mei confirms that lifecycle notification cannot replace evidence-based approval.

**Workflow contract:** Assignment → start acknowledgement → specialist work → stop notification → reconciliation → automatic next-role routing.

## Roleplay Test Result — CDO Team Handoff Process

**Date:** 21 July 2026
**Actors:** Nadia Rahman, Arun Patel, Mei Lin Tan
**App:** Static documentation site served locally at `http://127.0.0.1:4173/process-flow.html`

### Scene Results

✅ Scene 1 — Installation boundary: user-level and per-project ownership, managed hashes, tracked evidence, and ignored runtime state were visible.

✅ Scene 2 — Implementation handoff: selecting **Handoff loop** highlighted all five assignment stages and exposed the coordinator's automatic next-role routing.

✅ Scene 3 — Failure boundary: the page stated that stop is not success, one malformed handoff is retried, and the second blocks for human reconciliation.

✅ Scene 4 — Mobile view: the 390×844 viewport had zero page overflow, zero overflowing process panels, and vertically ordered handoff nodes.

### Verification Gate

✅ Desktop viewport: 1440×900, five handoff nodes, no overflowing labels, no page overflow.

✅ Mobile viewport: 390×844, no panel clipping or text overlap.

✅ Interaction: Handoff loop tab selected and all five matching nodes highlighted.

✅ Browser console: zero errors and zero warnings in fresh desktop and mobile sessions.

✅ Edge case and cross-role handoffs covered.

**RESULT:** All four scenes passed.
