# Traceability: the challenge's 12 focus areas → features → code → tests

This document traces each of the 12 focus areas of the Challenge 6 brief to the features that address it, the code that implements them and the tests that cover them. It reflects Stage 6 ("Decide fairly"): Stages 0–6 are built and M1–M12 are frozen (see [`claims-ledger.md`](claims-ledger.md)'s MoSCoW freeze table); Stages 7–8 are not.

**Sources:**
- The feature IDs (M = Must, S = Should) and the stage numbers are defined in [`plan.md`](plan.md) §1 and §5.
- The measured numbers are in [`claims-ledger.md`](claims-ledger.md).

**Status values:**

| Status | Meaning |
|---|---|
| **Built** | Code and tests exist for the core of the requirement |
| **Partly built** | Some of the listed features exist; the rest are planned, with their stage named |
| **Planned** | Nothing yet beyond groundwork |

## Summary

| # | Focus area | Features | Status | Planned remainder |
|---|---|---|---|---|
| 1 | Real-time monitoring | M8, M2, M4 | **Partly built** | In-exam monitor (Stage 5) |
| 2 | Early failure prediction | M8 readiness, S4 predicted risk, SYNC_LAG | **Partly built** | SYNC_LAG (Stage 4); readiness board (Stages 5–6) |
| 3 | Incident detection, classification, escalation | M8 rules and ladder, S3 classification | **Built** | — |
| 4 | Backup and DR | M2, M3 | **Partly built** | Spare relay, 2-store archive, RPO/RTO (Stage 4) |
| 5 | Tamper-evident storage | M1, M5, M7, S6 | **Built (without S6)** | Witness (Stage 7) |
| 6 | Suspicious patterns | M4, M11, S1, S5 | **Partly built** | Integrity gate and monitor, pointer provenance (Stage 5) |
| 7 | Reconciliation and validation | M1 NEED protocol, M7 reconciliation report | **Built** | — |
| 8 | Candidate communication | M9, S3 notices | **Built** | Tamil question text (the bank has none) |
| 9 | Re-schedule / re-conduct decision | M12, S2 | **Built**, live on the cells' export | — |
| 10 | Fairness when disrupted | M6, M12 | **Partly built** | Gap journal, caps, handover (Stage 4) |
| 11 | Audit trail and evidence reports | M7 evidence pack, S6 | **Built** (without S6) | Witness (Stage 7) |
| 12 | AI analytics for systemic risk | S1, S3, S4 | **Built** | Field accuracy (no field data) |

## Detail

Paths are relative to the repo root.

### 1. Real-time monitoring: M8, M2, M4

**Built:**
- **What:** relay seat-grid console over SSE (15 s ping, Last-Event-ID replay), with each seat's tick heads and a silent-seat state after 30 s; control-room tiles with per-centre tone, registered/unlocked counts and entries/s, fed by the swarm.
- **Code:** `apps/server/src/console.ts`, `console-view.ts`, `sse.ts`, `serve.ts`, `fleet.ts`, `control-view.ts`, `control-page.ts`.
- **Tests:** `apps/server/test/console-view.test.ts`, `sse.test.ts`, `serve.test.ts`, `fleet.test.ts`; `bun tools/act2.ts` (control-room tiles turn green live as the swarm enrols).

**Planned:**
- In-exam integrity monitor (M4): **Stage 5**.

### 2. Early failure prediction: M8 readiness, S4 predicted risk, SYNC_LAG

**Built:**
- **What:** the S4 predicted-risk model and scorecard (allot / add observer / do not allot, with the top 3 reasons each), on synthetic drill telemetry.
- **Code:** `analytics/src/saakshi_analytics/scorecard.py`.
- **Tests:** `analytics/tests/test_scorecard.py`.

**Planned:**
- SYNC_LAG prediction: **Stage 4**.
- Readiness board: **Stage 5**.
- Scorecard on the board: **Stage 6**.

### 3. Incident detection, classification, escalation: M8 rules and ladder, S3 classification

**Built:**
- **What:** rules P0–P3, blast radius, the escalation ladder and the CERT-In template (Stage 4); an invigilator's free-text report is classified (template or opt-in Claude), linked to the matching open incident (e.g. `CENTRE_OUTAGE` at CEN042), and drafts a notice for human approval (Stage 6).
- **Code:** `apps/server/src/incidents.ts`, `report-routes.ts`, `llm.ts`.
- **Tests:** `incidents.test.ts`; `bun tools/act3.ts` (TAMPER to the regulator rung, CERT-In draft); `bun tools/act5.ts` (report "lab 2 power gone, 14 seats" → `CENTRE_OUTAGE`, 14 seats, linked to the open `RELAY_WAN_DOWN` incident at CEN042).

### 4. Backup and DR: M2, M3

**Built:**
- **What:** relay store-and-forward; cell REBUILDING (503 for live traffic, then the relay replays from genesis); cell keys held outside the database, provisioned by control; seat resync to a fresh relay; 3 independent cells running together; the kill test (lost = 0).
- **Code:** `apps/server/src/forward.ts`, `ingest.ts`, `store.ts`, `main.ts`; `apps/seat/src/main/sync.ts`; `tools/chaos-kill.ts`, `provision.ts`.
- **Tests:** `forward.test.ts`, `ingest.test.ts`, `store.test.ts`, `apps/seat/test/sync.test.ts`; `bun tools/chaos-kill.ts`, which also runs in CI; `bun tools/act2.ts` (three cells: `cell-1`, `cell-2`, `cell-3`).

**Planned:**
- Spare-relay operations, archive to 2 stores and RPO/RTO: **Stage 4**.
- Measured load: **Stage 7**.

### 5. Tamper-evident storage: M1, M5, M7, S6

**Built:**
- **What:** signed hash-chained journal (M1); per-shift Merkle register with signed STH and proofs (M7); audit and recovery (M7); custody: Shamir 2-of-3, `kc_f`, offline wrap, the packager, `/custodian` and the 2-of-3 release flow, push with pull fallback, and the phoned-code fallback (M5).
- **Code:** `packages/core/src/journal.ts`, `merkle.ts`, `log.ts`, `custody.ts`, `node.ts`, `sig.ts`; `apps/seat/src/main/journal-store.ts`; `apps/server/src/seal.ts`, `audit.ts`, `custodian-view.ts`, `release-control.ts`; `tools/package.ts`.
- **Tests:** `packages/core/test/journal.test.ts` (1,000 flips), `sig.test.ts` (1,000 signatures), `merkle.test.ts`, `custody.test.ts`, `vectors.test.ts`, `addendum.test.ts`, `stage3-core.test.ts`; `apps/server/test/seal.test.ts`, `audit.test.ts`, `tamper.test.ts`, `release-control.test.ts`, `package.test.ts`, `relay-routes.test.ts`; `apps/seat/test/journal-store.test.ts`, `release.test.ts`, `seat.test.ts`; `bun tools/act2.ts`.

**Planned:**
- Witness (S6): **Stage 7**.

### 6. Suspicious patterns: M4, M11, S1, S5

**Built (synthetic data):**
- **What:** radar signals 1–2 (M11) and 3 (CUSUM, S1); history used as corroboration only; G2 calibration; fairness breakdown.
- **Code:** `analytics/src/saakshi_analytics/radar.py`, `history.py`, `evaluate.py`, `generate.py`.
- **Tests:** `analytics/tests/test_radar.py`, `test_a3.py`, `test_generate.py`.

**Probe self-test only:**
- **Code:** `apps/seat/src/main/probes.ts`, `probes-win.ts`.
- **Tests:** `probe-parse.test.ts`; the CI `windows` job.

**Planned:**
- Integrity gate and monitor (M4), and pointer provenance (S5): **Stage 5**.

### 7. Reconciliation and validation: M1 NEED protocol, M7 reconciliation report

**Built:**
- **What:** check order signature → `prev` → fork; `NEED` / gap resend; duplicate no-op; per-destination acked heads; a per-centre-shift reconciliation report (registered / submitted / receipts / leaves; relay head = cell head).
- **Code:** `apps/server/src/ingest.ts`, `recon.ts`; `apps/seat/src/main/sync.ts`; `packages/core/src/wire.ts`.
- **Tests:** `ingest.test.ts`, `recon.test.ts`, `apps/seat/test/sync.test.ts`, `packages/core/test/wire.test.ts`.

### 8. Candidate communication: M9, S3 notices

**Built:**
- **What:** tick states (✓ / ✓✓ / blue ✓✓), the offline message and the receipt slip, in EN and HI.
- **Code:** `apps/seat/src/renderer/src/App.tsx`, `Slip.tsx`, `i18n.ts`, `exam-state.ts`.
- **Tests:** `apps/seat/test/exam-state.test.ts`.

**Also built (Stage 6):**
- **What:** an approved notice reaches the public status page and the seat banner in EN/HI/TA; templates by default, Claude drafts opt-in and human-approved.
- **Code:** `apps/server/src/llm.ts`, `report-routes.ts`; `apps/seat/src/renderer/src/i18n.ts` (TA catalogue).
- **Tests:** `bun tools/act5.ts` (notice approved EN/HI/TA on `/status`).

**Planned:** Tamil question text — the bank has no Tamil items, so TA mode shows EN question text with a note.

### 9. Re-schedule / re-conduct decision: M12, S2

**Built (synthetic data):**
- **What:**
  - NEET-UG 2024 Supreme Court tier-1 test;
  - per-candidate compensate or re-test;
  - leak branches (localised / re-score / full);
  - TOST comparability;
  - greedy re-test allocator (PwD, language);
  - mock admit cards and dispute tickets;
  - golden cases CUET-2026, NEET-2024 separable, systemic and rescore-items.
- **Code:** `analytics/src/saakshi_analytics/decide.py`; `analytics/policy.illustrative.json`; `analytics/golden/`.
- **Tests:** `analytics/tests/test_decide.py`, `test_a4.py`.

**Also built (Stage 6):** the radar and decision engine read what actually flowed through the cells. Control fetches `/v1/shift` from every cell in the directory (refuses 409 on a partial or `REBUILDING` cell), turns it into cohort rows (Addendum E.1), and runs radar → history → decide → scorecard as one pipeline (`pipeline.py`, `analytics-routes.ts`). Evidence: `test_radar_reads_cell_export_rows` (schema); `bun tools/act5.ts` (export rows match the replayed cohort row by row on every radar field; headline in [`evidence/stage6-act5.txt`](evidence/stage6-act5.txt)).

### 10. Fairness when disrupted: M6, M12

**Built:**
- **What:**
  - active time journaled, and never running backwards on resume;
  - the active-time timer tied to the unlock: `remaining = D_i − activeMs`, and `activeMs` never runs backwards within the epoch even if the clock does;
  - in the engine, credited gaps up to the 30-minute cap are compensated, beyond it the candidate is re-tested, and two or more gaps go to review;
  - TOST comparability;
  - a PwD- and language-aware allocator.
- **Code:** `apps/seat/src/main/exam.ts`; `analytics/src/saakshi_analytics/decide.py`.
- **Tests:** `apps/seat/test/exam.test.ts` ("Stage 3 timer: remaining = D_i − activeMs …"); `test_decide.py` (`test_per_candidate_gap_rules`), `test_a4.py`.

**Planned:**
- `rxWall` stamps, suspend gaps, caps enforced by relay and cell, and handover with `D_i`: **Stage 4**.

### 11. Audit trail and evidence reports: M7 evidence pack, S6

**Built:**
- **What:**
  - the audit (edit, deleted row, truncation, changed signature, count mismatch; recovery order);
  - offline `/verify`;
  - a one-click evidence pack (tar.gz with the manifest, proof, STH, custody log, BSA s.63 template and offline `verify.html`).
- **Code:** `apps/server/src/audit.ts`, `evidence.ts`, `control.ts`, `verify-page.ts`, `verify-view.ts`; `packages/core/src/verify.ts`, `selftest.ts`; `tools/act4.ts`.
- **Tests:** `audit.test.ts`, `tamper.test.ts`, `evidence.test.ts`, `verify-page.test.ts`, `control.test.ts`; `packages/core/test/verify.test.ts`, `selftest.test.ts`; `bun tools/act4.ts`, which also runs in CI.

**Planned:** witness co-signature (S6), **Stage 7**.

### 12. AI analytics for systemic risk: S1, S3, S4

**Built (synthetic data):**
- **What:** S1 (CUSUM, G2 evaluation, fairness breakdown) and S4 (risk model, scorecard, and a named hook for Claude's note that returns template text).
- **Code:** `analytics/src/saakshi_analytics/radar.py`, `evaluate.py`, `scorecard.py`.
- **Tests:** `analytics/tests/test_a3.py`, `test_scorecard.py`.

**Also built (Stage 6):** the S3 `Provider` interface — `templateProvider` (default) and `claudeProvider` (opt-in, `SAAKSHI_LLM=claude`, disk-cached, PII-guarded) — classifies invigilator reports, drafts notices and writes scorecard notes; every reply is schema-checked and human-approved. Code: `apps/server/src/llm.ts`. Tests: `bun tools/act5.ts`; `SAAKSHI_LLM=claude` is not exercised in CI by design (cost/availability; templates are the tested default).

**Planned:** field evaluation of classification accuracy (no field data).

## Demo acts

The live demo runs in five acts, numbered 0–5 in [`plan.md`](plan.md) §6.

| Act | Focus areas | Runnable today? |
|---|---|---|
| 0 Hook | 1 | **Yes:** `bun tools/swarm.ts` (99 simulated centres, full G1 cohort, one process); wired to real cell/relay/control at demo scale by `bun tools/act2.ts` |
| 1 Before | 2, 6 | No: needs the gate and readiness board (Stage 5) |
| 2 T0 | 2, 5, 8 | **Yes:** `bun tools/act2.ts` (custody release by 2 of 3 custodians, simulated centres go green, Centre 42 unlocked by the phoned code with its link cut) |
| 3 During | 1, 3, 4, 7, 10 | Partly. Ticks, `kill -9` of the cell and rebuild, and three cells running together, run today; blast radius, escalation and handover are Stage 4 |
| 4 After | 5, 7, 11 | **Yes:** `bun tools/act4.ts`, or `/control` by hand |
| 5 Decide | 9, 10, 12 | **Yes:** `bun tools/act5.ts` — the cells' export drives the radar, history corroborates a queued flag, the decision engine's headline, "CEN042 → add observer" on the scorecard, an approved notice in EN/HI/TA, and a signed sign-off, all in CI |
