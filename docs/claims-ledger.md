# Claims ledger

This ledger lists every claim the pitch, the deck and the README make, the evidence behind each one, and its status. It reflects commit `1f7a07a`: Stages 0–4 and analytics A1–A4 are built; Stages 5–8 are not.

## Statuses

| Status | Meaning |
|---|---|
| **Proven** | A test, script or CI job exercises the claim, and it passes. Numbers come from a commit message, a test assertion or a CI artifact |
| **Built, not measured** | The code exists, but the specific property is not measured, or holds only by design |
| **Planned (Stage N)** | Not built. When in doubt, a claim goes here |

"Synthetic" means the evidence comes from generators we wrote, not from a real exam.

## Recovery: "never lose an answer"

| # | Claim | Evidence | Status |
|---|---|---|---|
| R1 | Killing the cell mid-stream loses nothing it acknowledged, and a wiped cell rebuilds from the relay with sent = stored, lost = 0 | `bun tools/chaos-kill.ts`: 1600 sent / 1600 stored / 0 lost, 3/3 runs (commit `0613963`); CI `server` job; `forward.test.ts` | **Proven** (one cell, one machine, 8 seats × 200 entries). **Proven at swarm scale** for a wiped cell serving several relays: `act3.ts` steps 5–6 (sent = verified = stored = 6,593–6,602 entries across three runs, lost 0); `ingest-stage4.test.ts` "Review Focus #1" |
| R2 | The seat keeps working offline; nothing is lost; the backlog drains when the link returns | `sync.test.ts` "offline: ✓ keeps growing, nothing is lost…"; `forward.test.ts` "cell down: the relay keeps acking" | **Proven** |
| R3 | A seat crash or restart resumes with every answer, and the timer never runs backwards | `exam.test.ts` "resume…", "the receipt survives a restart"; `journal-store.test.ts` torn tail | **Proven** |
| R4 | Relay and cell ack only after the commit is durable (group commit every 10 ms or 500 entries) | `store.test.ts` (commit visibility, 500-row flush, shared window); pragmas WAL + `synchronous=FULL` + `fullfsync` checked at boot | **Proven** for behaviour; throughput **Planned (Stage 7)** |
| R5 | Power-loss durability | WAL, `synchronous=FULL`, `fullfsync` on the servers; seat fsync, which is not `F_FULLFSYNC` on macOS | **Built, not measured** (holds by design) |
| R6 | A spare relay takes over | Seat side: `sync.test.ts` "a fresh (spare) relay gets the whole journal again" | **Proven**: `chaos.ts` spare-relay runs (lost 0, RTO ~1.3–1.9 s, `docs/evidence/stage4-chaos.jsonl`), the control button "Replace Centre 42's relay with the spare". Limit: after a *move*, a spare relay cannot refill the entries before the move from the new seat (see threat model) |
| R7 | Cells ×3 are independent failure domains, with a blast radius shown live | Three independent cells (`cell-1`, `cell-2`, `cell-3`) run together, each countersigning its own share of the cohort: `bun tools/act2.ts` | **Proven**: the P1 card with its blast radius (1 cell · N centres · ≈candidates), `incidents.test.ts`, `act3.ts` step 5 |
| R8 | RPO and RTO are measured; 20 chaos runs are logged | `docs/evidence/stage4-chaos.jsonl` (3 runs shown here: kill-cell, wipe-cell, spare-relay; lost 0, RPO 0, RTO 1.3–1.9 s; `bun tools/chaos.ts --runs 20` runs the full 20-run exit check) | **Measured**: RTO per scenario (p50/max) and RPO = 0, `docs/evidence/stage4-chaos.jsonl` (8 seats × 100 entries, DEV mode, this Mac); swarm-scale rebuild times in `stage4-act3.txt` (`ACT3-NUMBERS`). **Not measured:** RPO/RTO at 20k over a real WAN; power loss |
| R9 | Signed per-shift archive to 2 independent stores | Control writes one archive copy at seal (`control.ts`) | **Proven**: `archive.test.ts`, `ops-routes.test.ts`, `act3.ts` step 9 — two stores, verified against the signed STH, purge only on an authority-signed order after both verify (write 9–11 ms, verify 15–32 ms across three runs; relay entries purged 19–28). WORM is **simulated** (write-once, read-only files) |
| R10 | Resume on another seat (old-key signature, or PIN + invigilator); credited time approved | — | **Proven**: `handover.test.ts`, `relay-handover.test.ts`, `move.test.ts`, `act3.ts` step 7 — PIN + invigilator (3 tries), or the old key's signed claim; answers restored sealed to the new seat; credit measured by the relay's clock (move credit 42.3–51.6 s across three runs) |
| R11 | Time is credited by the relay's clock, capped at 30 min, two gaps → review, over the cap → re-test eligible; nothing is auto-penalised | `time-audit.test.ts`, `exam-stage4.test.ts` | **Proven** on synthetic chains |
| R12 | The hard stop keeps late entries as evidence (LATE), never deletes them | `ingest-stage4.test.ts` | **Proven** |

## Trust: "prove it"

| # | Claim | Evidence | Status |
|---|---|---|---|
| T1 | Any one-byte change in a signed journal is located at its entry | `journal.test.ts`: 1,000 of 1,000 flips; `node tools/tamper-lab.ts`; [`evidence/stage0-tamper-lab.txt`](evidence/stage0-tamper-lab.txt) | **Proven** |
| T2 | Signatures made natively verify in the browser (noble), and vice versa | `sig.test.ts`: 1,000 native → noble; vectors under both | **Proven** |
| T3 | The relay cannot read answers | `ingest.test.ts` "relay: stores only headers and sealed envelopes"; `body.test.ts` "the envelope does not leak the answer to the relay" | **Proven** |
| T4 | The relay cannot forge an entry or a blue tick | `ingest.test.ts` (`BAD_SUBMISSION` vs `FORK`); `sync.test.ts` "a forged or mismatched ack never turns a tick blue" | **Proven** |
| T5 | The receipt code is computed on the seat at submit, even offline, and equals the cell's countersigned code | `exam.test.ts` "submit … returns the receipt the cell will compute"; `submit.test.ts`; `tools/act4.ts` | **Proven** |
| T6 | The cell replays the chain, rejects a submit whose `finalHash` does not match, and rejects anything after a submit | `submit.test.ts` | **Proven** |
| T7 | An insider's edit to an answer is located, and the original is recovered | `tamper.test.ts`; `audit.test.ts` (recovery from the archive, and option search without one); `tools/act4.ts` | **Proven** |
| T8 | A deleted row, a truncated chain, a changed signature and an edited header are each located | `tamper.test.ts` (7 cases); `audit.test.ts` | **Proven** |
| T9 | `/verify` shows "Q17: record says C — the seat committed B" | `verify.test.ts`; `verify-page.test.ts`; `tools/act4.ts` | **Proven** |
| T10 | `/verify` is one offline file: no network, no Node, no private keys | `verify-page.test.ts`; 84 KB, works from `file://` with DNS blocked (manual check, commit `f95c76f`) | **Proven** |
| T11 | `/verify` re-checks the golden vectors in the browser on every load | `selftest.test.ts`: 30 of 30 checks | **Proven** |
| T12 | Per-shift Merkle register with a signed STH, inclusion proofs and a consistent re-seal | `seal.test.ts`; `merkle.test.ts` (RFC 6962/9162 vectors; proofs up to size 33) | **Proven** |
| T13 | A per-centre-shift reconciliation report turns red on any count or head mismatch | `recon.test.ts` | **Proven** |
| T14 | A one-click evidence pack (manifest, proof, STH, custody log, s.63 template, offline `verify.html`) | `evidence.test.ts`; `tools/act4.ts` checks the manifest | **Proven**. The s.63 file is a **template**; admissibility is not claimed |
| T15 | An independent witness co-signs the register | — | **Planned (Stage 7, S6)** |
| T16 | TLS with pinned certificates on seat → relay → cell | — | **Planned (Stage 7, S7)** |
| T17 | Cell and control refuse to bind off loopback while their routes are unauthenticated | `main.test.ts` (commit `6e0c31e`) | **Proven** |
| T9 (Stage 4 addendum) | For **enrolled** candidates, `/verify` pins only the authority key; the record carries the bind and cell certificates | Addendum C.1; `addendum-c.test.ts`, `verify-certs.test.ts`; `act3.ts` step 8: `/verify` for the moved candidate C0001 (2 key epochs) passes with only the authority key pinned | **Proven** |

## Prevention: custody, enrolment, integrity

| # | Claim | Evidence | Status |
|---|---|---|---|
| P1 | Any 2 of 3 custodians (NTA, NIC, observer) can release the paper keys; 1 cannot | `custody.test.ts`; `release-control.test.ts` (two distinct custodians; one custodian twice counts once; a damaged share cannot release); `bun tools/act2.ts` | **Proven** |
| P2 | An offline code unlocks only its own centre and shift, and tolerates phone dictation | `custody.test.ts`; `package.test.ts`; `relay-routes.test.ts` "Review Focus #3"; `bun tools/act2.ts` (a typo and another centre's code fail; the phoned code unlocks Centre 42) | **Proven** |
| P3 | A wrong or corrupted key is rejected against the public commitment `kc_f` | `custody.test.ts` "a corrupted share is caught by the published key commitment"; `stage3-core.test.ts` "checkRelease (B.7)"; `release.test.ts` and `seat.test.ts` "exit check — kc_f on both paths"; `bun tools/act2.ts` (a forged key pushed by the relay is rejected) | **Proven** |
| P4 | The paper cannot be read before T0; the exam starts on time even offline | `package.test.ts` "ciphertext only"; the seat bundle carries no plaintext paper or private key (`(cd apps/seat && pnpm build)`, then grep `out/` for the paper text and for `"priv"`); `bun tools/act2.ts` (the paper stays ciphertext on disk; the phoned code starts Centre 42 with its WAN link cut) | **Proven** |
| P5 | Enrolment and binding certificates (attestHash, PIN, provisional binding) | `bindings.test.ts`; `identity.test.ts`; `seat.test.ts` "provisional (no WAN at check-in) …" | **Proven** |
| P6 | Remote-access tools, capture-excluded overlays and VMs are blocked before start, and flagged (never auto-submitted) during the exam | **Proven (name matching):** the Windows CI gate self-test blocks a renamed `notepad.exe` (as `AnyDesk.exe`) and `overlay-sim`, naming both ([`evidence/stage5-gate-selftest.json`](evidence/stage5-gate-selftest.json), run 36330823424, commit `18e0b1f`); `bun tools/act1.ts` blocks seat A by name in-process ([`evidence/stage5-act1.txt`](evidence/stage5-act1.txt)); macOS capture probe on `overlay-sim` ([`evidence/stage5-mac-capture.txt`](evidence/stage5-mac-capture.txt)) | **Proven (name matching)**. Limits: a renamed *and* re-labelled tool evades name matching; the VM score is a heuristic (2+ signal classes); GitHub's own `windows-latest` runner scores as a VM (score 2: model, bios), so the self-test asserts names, not a clean verdict |
| P7 | The packaged Windows exe runs its probes | CI `windows` job; [`evidence/stage0-windows-probe.json`](evidence/stage0-windows-probe.json) | **Proven** (it runs; detection of real tools is not yet shown) |
| P8 | Face presence runs on the device; no video, no face recognition | Live count in the packaged macOS app ([evidence](evidence/stage0-seat-faces-1.png)); `FaceChip.tsx`. **Built**: flags and the review queue are scripted end to end in `bun tools/act1.ts` with synthetic samples (no camera) — a scribe seat expects 2 faces, 3 faces for 5 of 5 samples raises one `face-extra` flag, a reviewer clears it ([`evidence/stage5-act1.txt`](evidence/stage5-act1.txt)) | **Built; flags and review scripted in act1 with synthetic samples; live on the Mac with the camera by hand** (pending — camera check not run by this agent) |
| P9 | Hardened Electron: fuses, context isolation, sandbox, CSP, `app://` | `electron-builder.yml`, `apps/seat/src/main/index.ts`; `app-path.test.ts`; fused build refuses `--inspect`/`--remote-debugging-port` (exit 3), `ELECTRON_RUN_AS_NODE` ignored, second instance exits 0 — on both the Mac fused build and Windows CI ([`evidence/stage5-fuse.txt`](evidence/stage5-fuse.txt), [`evidence/stage5-gate-selftest.json`](evidence/stage5-gate-selftest.json) `fuse.json`) | **Proven: the fused build refuses `--inspect` / `--remote-debugging-port`, RunAsNode is off (Windows CI and Mac)** |
| P10 | Centre risk model: "at risk" precision 0.290 (2.1× base rate), "do not allot" precision 0.523 (3.8×) | `scorecard` CLI; `test_scorecard.py` (asserts ≥ 1.8× the base rate); commit `db2b95e` | **Proven on synthetic histories** |
| S5 | Pointer-provenance summary (moves, path, clicks, keys, `untrusted`, `lastMoveMs`) travels sealed inside every `answer`/`mark`/`clear` body (Addendum D.5) | `bun tools/act1.ts` "answers carry provenance"; sealed inside the same box as the answer, so B.4/verify already cover it | **Recorded in the sealed body; analysed in Stage 6** |
| — | Review queue: face flags open with the review key, a human clears or confirms, thumbnails purge after `retentionMs` | `bun tools/act1.ts` (face-extra flag opened and cleared by REVIEWER-1); the 30-day purge is unit-tested (Task 8) | **Built, not measured**. 30-day thumbnail deletion is unit-tested, not observed over real time |

**Act 1 demo notes:** `sh tools/overlay-sim.sh start` → the seat shows "Blocked — AnyDesk, overlay-sim" → `sh tools/overlay-sim.sh stop` → press **Re-check** → green. Held back for Q&A rather than shown live: `--inspect` is refused on the fused build (see [`evidence/stage5-fuse.txt`](evidence/stage5-fuse.txt)).

**Stage 3 honest limits** (detail in [`threat-model.md`](threat-model.md)): the `/custodian` page is served by control, so a compromised control could serve a page that captures a passphrase; enrolment is first-come, so a rogue relay could try to bind a candidate before they arrive (the real candidate is then refused with `ALREADY_BOUND`); while `DEV=1`, the relay's chaos routes (`/v1/dev/wan`, `/v1/dev/forge`) are reachable on the centre LAN; control zeroises `K_f` after every cell has the release, but this is best effort in a garbage-collected runtime; `/verify` used to pin the fixture seat keys from `fixtures/trust-dev.json`, so an **enrolled** candidate's proof showed the keys row failing there; **fixed in Stage 4** (Addendum C, see T9 above) — DEV-mode records still use the pinned fixture keys, labelled "pinned DEV keys".

## Detection and response: analytics

| # | Claim | Evidence | Status |
|---|---|---|---|
| D1 | The radar finds the planted leak and rings with 0 honest false positives (G1, 20k) | Leak recall 0.847, ring recall 1.0, FPR 0.00% (commit `1ccf73c`); `test_radar.py` asserts recall ≥ 0.8 and FPR ≤ 0.5% | **Proven on synthetic data** (G1 is the calibration set) |
| D2 | Out of sample (G2, calibrated on honest G1 only): precision 1.000, honest FPR 0.00% | `uv run python -m saakshi_analytics.evaluate`; `test_full_20k_calibrate_g1_evaluate_g2` | **Proven on synthetic data**. G2 is independent in noise and pacing, not in structure |
| D3 | CUSUM finds the mid-exam leak signal 1 misses (0.22 → 0.70 on G2) and dates it | commit `ce77375`; `test_a3.py` | **Proven on synthetic data** |
| D4 | Honest look-alikes (Hindi-medium, PwD, rapid guessers, improvers, high flyers) are not flagged; no honest flags by language, PwD or centre | `analytics/README.md` tables; `test_radar.py` | **Proven on synthetic data** |
| D5 | Past-performance history (a mock APAAR registry) only annotates flags that are already queued; it never creates or escalates one | `test_history_only_annotates_queued_flags` (with an adversarial registry) | **Proven** |
| D6 | Every flag shows its reason, observed vs expected, and a p-value; nothing is auto-penalised | `test_every_flag_explains_itself`; `test_escalation_ladder` | **Proven** |
| D7 | The decision engine applies the NEET-UG 2024 Supreme Court tier-1 test | `test_tier1_full_reconduct_only_when_systemic_and_not_separable`; golden `neet-2024-separable`, `systemic` | **Proven** |
| D8 | CUET-2026 replay → Compensated 161 · Re-tested 29 · Re-conducted 0 · Spared 160 | `test_golden_cuet_2026_replay` | **Proven on synthetic data** |
| D9 | "₹ avoided" | Spared × ₹1,500, an **illustrative** policy value and not an NTA figure; the report prints this assumption | **Proven** as arithmetic only |
| D10 | Leak branches: localised → re-conduct those centre-shifts; ≤ 10% of items → re-score; systemic and not separable → full re-conduct | `test_leak_branches`; golden `rescore-items` | **Proven** |
| D11 | TOST comparability flags a group that was harmed after the disruption | `test_comparability_catches_a_group_that_was_hurt_after_the_disruption` | **Proven** on a doctored synthetic room |
| D12 | The re-test allocator respects PwD access and language | `test_allocator_is_greedy_nearest_with_seats_pwd_and_language` | **Proven** (greedy, not optimal) |
| D13 | Signed dispute tickets from a candidate's "raise objection" | `test_objection_ticket_hash_and_listing` | **Proven** for hashed tickets. Ticket signing and the "raise objection" button on `/verify` are **Planned** (no stage assigned yet; Stage 6 connects the analytics) |
| D14 | The radar and the decision engine analyse what actually flowed through the cells | `test_radar_reads_cell_export_rows` (schema compatibility) | Format **Proven**; live wiring **Planned (Stage 6)** |
| D15 | Incidents P0–P3 with blast radius, the escalation ladder, and the CERT-In template | `incidents.test.ts` (P0–P3, blast radius, ladder, debounce, CERT-In at the regulator rung), `act3.ts` steps 4, 5, 10 (TAMPER reached the regulator rung and drafted a CERT-In 6-hour report; [`evidence/stage4-certin.html`](evidence/stage4-certin.html)) | **Proven**. The CERT-In file is a **draft template**, not filed |
| D16 | SYNC_LAG predicts WAN failure | `link.test.ts`; `act3.ts` (`ACT3-NUMBERS.predictedBeforeDownMs`): SYNC_LAG raised 5.0–14.1 s after the degrade began, 1.0–1.9 s before the cut across three runs | **Proven on our chaos drill only**. Not validated on real WAN data |
| D17 | Claude classifies invigilator reports, drafts notices and writes scorecard notes (templates by default, human-approved) | `scorecard.claude_note_hook` returns template text only | **Planned (Stage 6)** |

## Candidate experience and scale

| # | Claim | Evidence | Status |
|---|---|---|---|
| C1 | NTA-style exam UI: palette states, Save & Next, Mark for Review, Clear Response | `exam-state.test.ts` | **Proven** |
| C2 | EN and HI with a bundled Devanagari font | `exam-state.test.ts` "EN and HI catalogues have the same keys … HI is Devanagari" | **Proven**. Tamil **Planned (Stage 6)** |
| C3 | Accessible: keyboard-only use, ARIA, 200% zoom | Built in Stage 1 and checked by hand; Playwright e2e now runs against the packaged Windows e2e build in CI (`--test-mode --no-camera --use-fake-device-for-media-stream`), green | **Playwright e2e passing; the WCAG audit is still not done** |
| C4 | In-exam banner, public status page, notice outbox | `exam-state.test.ts`, `move.test.ts` (banner); `status-view.test.ts`, `ops-routes.test.ts`, `act3.ts` step 11 (public status page with no PII); mock outbox channels | **Proven on our chaos drill**. Claude-drafted notices and Tamil: **Planned (Stage 6)** |
| C5 | 20k live candidates across 100 centres | `tools/swarm.ts`: 99 simulated centres replay the full G1 cohort (≈20k candidates) in one process, live (commit `5cd2f0a`); `bun tools/act2.ts` runs the same flow end to end on real cell/relay/control processes with a small cohort (300 candidates, 7 centres) | **Built**. Throughput: **~1.1k entries/s sustained on one core** (Apple M5, full G1 cohort at `--speed 20`, cells in-process; commit `5cd2f0a`), lower under heavy machine load; the cross-process HTTP number is **Planned (Stage 7)** |
| C6 | Throughput, p50/p99, WAN bytes per candidate-hour, seat CPU on low-end hardware | — | **Planned (Stage 7)** |
| C7 | A Rust cell ingest matches the TypeScript one on the same vectors | — | **Planned (optional Stage R)** |

## Claims we deliberately don't make

| Not claimed | What we say instead |
|---|---|
| "Cheat-proof", "tamper-proof" | Deterrence + detection at the seat; tamper-**evident** records |
| "Lockdown" on its own | Kiosk and fullscreen are deterrents (Stage 5). In production, managed PCs use Assigned Access or MDM. macOS 15+ has no API to block capture |
| "Time-lock" | Split custody across institutions, a public commitment, and an audited per-centre fallback. Control sees `K_f` at T0; setters see the plaintext paper |
| "Blockchain" | An RFC 9162 Merkle log with signed tree heads |
| "The signature proves the candidate chose it" | *A seat signature proves the record wasn't altered after the device produced it — not that the candidate chose it.* |
| Field accuracy for the radar or the risk model | Model results on synthetic cohorts; G2 is a stronger check than G1, not field data |
| "Court-ready" / admissible | The evidence pack includes a BSA 2023 s.63 certificate **template** for a responsible person to complete |
| "Zero failures" | Every failure is recoverable, contained and provable |
