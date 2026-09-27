# Saakshi (साक्षी, "witness")

[![windows](https://github.com/anirudh12032008/saakshi/actions/workflows/windows.yml/badge.svg)](https://github.com/anirudh12032008/saakshi/actions/workflows/windows.yml)
[![server](https://github.com/anirudh12032008/saakshi/actions/workflows/server.yml/badge.svg)](https://github.com/anirudh12032008/saakshi/actions/workflows/server.yml)
[![licence](https://img.shields.io/badge/licence-Apache--2.0-blue)](LICENSE)

**A resilient, provable CBT exam ecosystem. Hackathon Challenge 6: Prevention → Detection → Response → Recovery → Trust.**

> **We can't promise zero failures. We make every failure recoverable, contained, provable.**

### Why this is needed

Sources for every figure are in [`docs/research.md`](docs/research.md), which links each primary source. Some figures there are marked for re-verification before they go on a slide.

- **NEET-UG 2026** was a pen-and-paper exam for about 22.7 lakh candidates. It was cancelled on 12 May after a paper leak from inside the paper's own custody chain, and re-held on 21 June. **NEET moves to CBT from 2027.** ([India §](docs/research.md#research-india))
- **CUET-UG 2026:** a TCS iON fault delayed a shift by about 2 hours. 3,765 candidates who had left got a re-test. ([India §](docs/research.md#research-india))
- **SSC 2025:** the Phase 13 re-exam for 59,500 candidates was identified by analysing server logs. At a Dhanbad centre (SSC CGL 2025), the server manager was arrested; candidates "moved the mouse" while answers were auto-selected. ([India §](docs/research.md#research-india), [landscape §](docs/research.md#research-landscape))
- **JEE Main 2025:** a candidate's pop-up said 46 attempted, but the response sheet said 29. It went to the Delhi High Court, because nothing let the candidate prove their own record. ([landscape §](docs/research.md#research-landscape))
- **NEET-UG 2024:** the Supreme Court refused a full re-test because the leak was localised and the beneficiaries could be separated. Our decision engine encodes that test. ([India §](docs/research.md#research-india))

### How it works

```
Seat (Electron) ──LAN──► Centre relay (untrusted) ──WAN──► Cell (national DC) ──► Control
 signs + seals each       stores and forwards;             opens, verifies,        seals the register (STH),
 answer, fsyncs → ✓       cannot read answers → ✓✓         countersigns → blue ✓✓  audit, /verify, evidence pack
```

**Status (27 Sep 2026):**
- **Done:** Stages 0–3 (foundations, "never lose an answer", "prove it", custody + enrolment + swarm) and analytics A1–A4.
- **Not built:** Stages 4–8. See [Honest limits](#honest-limits).

---

## What's proven so far

Every number below comes from a test, a commit message, or a CI artifact, and can be reproduced with the command shown. **Synthetic** means the data comes from generators we wrote, not from a real exam.

| What | Result | Reproduce | Record |
|---|---|---|---|
| Kill test: `SIGKILL` the cell mid-stream, restart it, then wipe its DB and rebuild from the relay | **sent 1600 · relay-acked 1600 · cell-acked 1600 · stored 1600 · lost 0** (8 seats × 200 entries; every stored chain verifies and every body opens). 3/3 consecutive runs | `bun tools/chaos-kill.ts` | commit `0613963`; CI `server` job |
| Byte flips in a signed journal | **1,000 of 1,000** random flips located at the exact entry | `pnpm --filter @saakshi/core test` | `packages/core/test/journal.test.ts` |
| Native signatures (P-256, low-S) verified by the browser library (noble) | **1,000 of 1,000** | same | `packages/core/test/sig.test.ts` |
| Golden vectors re-checked in the browser on every `/verify` load | **30 of 30** checks pass (protocol v1 + Addendum A) | same | `packages/core/test/selftest.test.ts` |
| Tampering on a real cell DB: edit, deleted row, truncated chain, changed signature, edited header, removed submit | **every case located**; edits and deleted rows are restored from the sealed archive | `bun test --timeout 60000 apps/server` | `apps/server/test/tamper.test.ts`, `audit.test.ts` |
| Act 4 end to end (real seat session → relay → cell → control) | Slip code = the cell's countersigned code; the audit reports **"Q17: record says C — the seat committed B"** and recovers B; `/verify` fails only `bodies`; the evidence pack's manifest verifies | `bun tools/act4.ts` | commit `d7efb47`; CI `server` job |
| Act 2 end to end (real processes: provision → package → 3 cells + the Centre 42 relay + control; a swarm of simulated centres; a real seat at Centre 42, test mode, camera off) | 2-of-3 custodians release; 6 of 7 centres go green while Centre 42 stays locked (its link cut); a typo and another centre's code are refused; the **phoned code** unlocks Centre 42 and the seat checks it against `kc_f`; a forged key pushed by the relay is rejected; a relay restart re-delivers the release with exactly one unlock; 6,585 entries committed, 300 candidates submitted | `bun tools/act2.ts` | commit `cec0ebb`; CI `server` job |
| Swarm throughput (`tools/swarm.ts`, 99 simulated centres in one process, replaying the full G1 cohort) | ~1.1k entries/s sustained on one core (Apple M5, full G1 cohort at `--speed 20`, cells in-process); lower under heavy machine load; the cross-process HTTP number is not yet measured | `bun tools/swarm.ts --exam data/exam --cohort data/g1/cohort.jsonl --speed 20` | commit `5cd2f0a` |
| The relay cannot read answers | No answer text reaches the relay's disk | `bun test --timeout 60000 apps/server` | `apps/server/test/ingest.test.ts` |
| Offline `/verify` | One 84 KB file with no external URLs; works from `file://` with DNS blocked | `bun test --timeout 60000 apps/server` | commit `f95c76f`; `verify-page.test.ts` |
| Packaged Windows exe probe self-test | JSON from koffi (user32) and `tasklist` on `windows-latest` | CI `windows` job | [`docs/evidence/stage0-windows-probe.json`](docs/evidence/stage0-windows-probe.json) |
| Radar on G1, 20k candidates (**synthetic**; the calibration set) | Leak recall 0.847, ring recall 1.000, precision 1.000; honest false-positive rate **0.00%** of 19,618; no look-alike group flagged | `generate` + `radar --truth` (below) | commit `1ccf73c`; [`analytics/README.md`](analytics/README.md) |
| Radar on G2, an independent generator (**synthetic**), calibrated on honest G1 only | Any signal: precision **1.000**, honest FPR **0.00%** of 19,614. Leak recall 0.933 (signal 1 or 3), ring recall 0.769. Mid-exam leak recall 0.217 → 0.700 once CUSUM is added | `uv run python -m saakshi_analytics.evaluate` | commit `ce77375`; `analytics/README.md` |
| Fairness on G2 (**synthetic**) | 0 honest flags in EN, HI, TA, PwD, and in each of the 100 centres | same | `analytics/README.md` |
| Decision engine golden cases (**synthetic** 2k cohort) | CUET-2026 replay → **Compensated 161 · Re-tested 29 · Re-conducted 0 · Spared 160**. NEET-2024 separable → no full re-conduct (10 centre-shifts in 4 centres; 1,318 spared). Systemic, not separable → full re-conduct. Leak of 10 items → re-score, nothing re-conducted | `uv run pytest -q tests/test_decide.py tests/test_a4.py` | commits `f3d171e`, `db2b95e` |
| Centre risk model (**synthetic** histories; fit on seed 1, measured on 4,000 independent histories, seed 2) | "At risk" precision **0.290** (2.1× the base rate of 0.138); "do not allot" precision **0.523** (3.8×) | `uv run python -m saakshi_analytics.scorecard` | commit `db2b95e` |
| Test suites at `cec0ebb` | core 77 · seat 61 · server 153 · analytics 66, all passing | see Quickstart | — |

Run the analytics commands from `analytics/`.

The kill test prints its restart and rebuild times: 8.1 s and 10.9 s in commit `0613963`. They vary with machine load, so **they are not RTO measurements**; RTO is measured in Stage 4. Power-loss durability holds by design (WAL, `synchronous=FULL`, `fullfsync`) but has not been measured.

The full claim-by-claim status is in [`docs/claims-ledger.md`](docs/claims-ledger.md).

---

## Quickstart

**Prerequisites:** node ≥ 25, bun 1.3.14, pnpm 11.5, uv with Python ≥ 3.14. Development happens on macOS arm64; Windows is covered by CI. The server tests, the kill test and Act 4 open loopback ports.

```sh
pnpm install --frozen-lockfile
```

### Tests

```sh
pnpm -r test                                       # core (node + bun), seat, server
bun test --timeout 60000 apps/server               # server only
(cd analytics && uv run pytest -q -m "not full")   # analytics fast suite (2k cohort, ~30 s)
(cd analytics && uv run pytest -q)                 # adds the full 20k G1 → G2 run
```

### The scripted proofs

```sh
bun tools/chaos-kill.ts [--seats 8] [--entries 200]   # kill -9 + wipe the cell → sent = stored, lost = 0, PASS
bun tools/act4.ts                                     # submit → seal → rogue insider → audit → /verify → evidence, PASS
bun tools/act2.ts [--cohort path/to/cohort.jsonl]     # provision → package → 3 cells + relay + control → custody release → phoned-code unlock → PASS
node tools/tamper-lab.ts [--entries 40] [--offset N]  # flip one byte of a signed journal → "located exactly: line N"
node tools/tamper-lab.ts verify <journal.jsonl>       # re-verify a file you edited by hand (reads <file>.pub.json)
bun tools/swarm.ts --exam data/exam --cohort data/g1/cohort.jsonl [--speed 20]   # 99 simulated centres, one process, entries/s printed live
```

### Analytics: radar, decision engine, scorecard

```sh
cd analytics
uv run python -m saakshi_analytics.generate OUT                                  # G1: 20k candidates, 100 centres, seed 7
uv run python -m saakshi_analytics.radar OUT/cohort.jsonl --key OUT/key.json --truth OUT/truth.json --json OUT/flags.json
uv run python -m saakshi_analytics.evaluate                                      # calibrate on honest G1, score G2 (~2 min)

uv run python -m saakshi_analytics.generate SMALL --n 2000 --centres 10 --seed 7   # the golden-case cohort
uv run python -m saakshi_analytics.decide --policy policy.illustrative.json \
    --incident golden/cuet-2026.incident.json --cohort SMALL/cohort.jsonl \
    [--flags SMALL/flags.json] [--key SMALL/key.json --centres centres.mock.json \
     --tickets golden/tickets.jsonl --admit-cards cards.txt] [--json report.json]
uv run python -m saakshi_analytics.scorecard [--centres 10] [--seed 7] [--telemetry drill.json]
```

The golden incidents are in `analytics/golden/`: `cuet-2026`, `neet-2024-separable`, `systemic` and `rescore-items`. The policy file is labelled **ILLUSTRATIVE**: every threshold in it is a committee parameter. For the options and sample reports, see [`analytics/README.md`](analytics/README.md).

### Run the stack by hand

The fixture keys are published, so every server mode refuses to start without `DEV=1` (see [Honest limits](#honest-limits)). State goes to `./data`; start each demo from a fresh directory.

```sh
DEV=1 MODE=cell    bun apps/server/src/main.ts   # :7080, loopback only; its terminal prints the rogue UPDATE
DEV=1 MODE=relay   bun apps/server/src/main.ts   # :7070 on 0.0.0.0; seat grid at http://127.0.0.1:7070/console
DEV=1 MODE=control bun apps/server/src/main.ts   # :7090, loopback only; http://127.0.0.1:7090/control and /verify
```

**Server environment variables:**

| Variable | Default |
|---|---|
| `PORT` | 7080 / 7070 / 7090 |
| `HOST` | Loopback, except the relay. A cell or control given a non-loopback `HOST` refuses to start |
| `DB` | `data/<mode>.db` |
| `DIR` | control: `data/control` |
| `CELL_URL` | `http://127.0.0.1:7080` |
| `RELAY_URL` | `http://127.0.0.1:7070` |
| `CELL_ID` | `cell-1` |
| `KEYS` | `fixtures/keys.json` |
| `FORMS` | `fixtures/paper/forms.json` |

**The seat (Electron):**

```sh
(cd apps/seat && SAAKSHI_NO_CAMERA=1 pnpm dev)                   # dev mode
(cd apps/seat && pnpm pack:mac)                                  # packaged macOS app: fuses on, ad-hoc signed
open apps/seat/release/mac-arm64/Saakshi.app --args --relay http://127.0.0.1:7070 --cand C0001 --no-camera
apps/seat/release/mac-arm64/Saakshi.app/Contents/MacOS/Saakshi --probe-selftest   # probe JSON, then exit
(cd apps/seat && pnpm pack:win)                                  # Windows: release\win-unpacked\Saakshi.exe (built in CI)
```

**Seat flags:**

| Flag | Environment variable | Meaning |
|---|---|---|
| `--relay URL` | `SAAKSHI_RELAY` | The relay to sync with |
| `--cand C0001…C0008` | `SAAKSHI_CAND` | The DEV candidate |
| `--no-camera` | `SAAKSHI_NO_CAMERA=1` | Webcam off; nothing touches getUserMedia or MediaPipe |
| `--probe-selftest [--out f.json]` | — | Run the probes and print JSON |
| — | `SAAKSHI_ZOOM=2` | Zoom test |

Leave `--no-camera` off to see the live face count. Quit the app afterwards, because the face check holds the camera.

**Act 4 by hand:** press the buttons on `/control`, or use curl:

```sh
curl -s -X POST localhost:7090/v1/seal
curl -s -X POST localhost:7090/v1/rogue -H 'content-type: application/json' -d '{"cand":"C0001","q":17,"answer":"C"}'
curl -s -X POST localhost:7090/v1/audit
curl -sOJ 'localhost:7090/v1/evidence?cand=C0001'   # tar.gz: proof, STH, manifest, custody log, s.63 template, offline verify.html
```

---

## Protocol summary

The frozen spec is [`docs/protocol-v1.md`](docs/protocol-v1.md) (v1, plus the additive Addendum A). The golden vectors are in `fixtures/vectors/`, and they decide any disagreement between the spec and the code.

**Encoding and signatures**
- **Canonical encoding:** every hashed or signed structure is a type-tagged JSON array. Only strings, safe integers and arrays are allowed; any other spelling is rejected.
- **Domain bytes:** each hash starts with a domain byte (`0x00`–`0x07`: Merkle leaf and node, entry, genesis, body, receipt, finalHash, key commitment).
- **Signatures:** ECDSA P-256 / SHA-256, IEEE-P1363, low-S. Every signature is cross-verified between native `node:crypto` and noble in the browser.

**Journal and receipts**
- **Journal entries:** a signed header `["entry",v,exam,shift,attempt,cand,keyEpoch,seq,prev,kind,tMonoMs,activeMs,bodyCommit]`, hash-chained through `prev` from a per-candidate genesis.
- **Body envelope:** the answer body is sealed to the cell (ephemeral ECDH → HKDF-SHA256 → XChaCha20-Poly1305). The relay sees only `bodyCommit`.
- **Check order at relay and cell:** signature → `prev` → fork. An invalid entry is `BAD_SUBMISSION` and never `FORK`. A gap gets `NEED{head}`. An exact resend is a no-op.
- **Submit and receipt:** the cell replays the chain to recompute `finalHash`. The receipt code is 16 Crockford symbols plus a check symbol. The seat computes it at submit, even offline, and the cell countersigns it later.

**Register and custody**
- **Register:** one RFC 9162 Merkle tree per shift, with a signed STH and inclusion and consistency proofs. Leaves are pseudonymous (`HMAC(K_pseud, roll)`).
- **Custody (primitives only so far):** Shamir 2-of-3 over the paper keys, the commitment `kc_f`, and per-centre, per-shift offline codes.

---

## Repo layout

```
apps/seat/          Electron seat. main/: journal, sync, exam session, probes (koffi on Windows); renderer/: NTA-style exam UI, slip, face chip
apps/server/        One Bun binary, MODE=cell|relay|control: ingest, store, forwarder, SSE console, seal, audit, recon, evidence, /control, /verify
packages/core/      Protocol v1: canon, hashes, signatures, body envelope, Merkle, custody, journal, response-sheet verifier, golden self-test
analytics/          Python (uv): G1/G2 generators, radar, history, evaluation, decision engine, scorecard; golden incidents
tools/              chaos-kill.ts, act4.ts, tamper-lab.ts, sim-seat.ts, fixture and vector generators (run once; they refuse to overwrite)
fixtures/           DEV keys (published), bilingual paper, schemas, golden vectors, cohort stub
docs/               plan, research, protocol spec, threat model, claims ledger, traceability, stage plans, evidence
.github/workflows/  windows.yml (tests, packaged exe probe self-test, NSIS on dispatch), server.yml (macOS: tests, kill test, Act 4)
```

**Docs:**
- [`docs/threat-model.md`](docs/threat-model.md): actors, what we stop or catch, residual risk, and the current detection matrix.
- [`docs/claims-ledger.md`](docs/claims-ledger.md): every claim, with its evidence and status.
- [`docs/traceability.md`](docs/traceability.md): the 12 focus areas of the brief → features → code → tests.
- [`docs/plan.md`](docs/plan.md): the full plan and stages.

---

## Honest limits

### DEV keys

- `fixtures/keys.json` holds the **private** keys for the authority, 3 cells and 8 seats. It is published and bundled into the seat app.
- The pseudonym key `K_pseud` is also a published DEV value.
- Every server mode refuses to start without `DEV=1`.
- Enrolment and binding certificates use these same published DEV cell keys; production keys come from an HSM, provisioned by control (nothing in the protocol changes).

### What runs today, and what doesn't

**Topology**
- The hand-run quickstart above is one relay, one cell and one control. `bun tools/act2.ts` runs the three-cell layout and the directory together with a real seat; the spare relay is still Stage 4.
- Relay → cell traffic is plain HTTP.
- Cell and control routes are unauthenticated, so both refuse to bind anywhere but loopback (commit `6e0c31e`).

**Trust anchors**
- The authority signs the STH alone. There is no witness yet.
- The sealed archive is a single copy in control's directory, not two independent stores.

**Durability**
- Process-crash durability is measured by the kill test. Power-loss durability holds by design only.
- On macOS, Node's `fsync` on the seat is not `F_FULLFSYNC`.

**Integrity checks**
- The probes run only as a self-test (`--probe-selftest`).
- There is no pre-exam gate, in-exam monitor, kiosk mode or content protection yet.
- The face chip counts faces on the device, but it raises no flags.

**Analytics**
- Every radar, decision and risk number comes from synthetic data we generated.
- G2 differs from G1 in noise and pacing, not in structure, and the same team wrote both. These are model results, not field results.

### Not built yet, by stage

| Stage | Not built yet |
|---|---|
| 4 | Resume on another seat (old-key signature, or PIN + invigilator); `rxWall`; suspend gaps and caps; spare relay, archive to 2 stores; `tools/chaos.ts --runs 20` with RTO; incidents P0–P3, escalation ladder, CERT-In template; SYNC_LAG prediction; in-exam banner and status page; Addendum C (`/verify` for enrolled candidates) |
| 5 | Integrity gate and in-exam monitor; VM score; egress and accommodation allowlists (NVDA, VoiceOver, scribe seat); pointer provenance; face flags and review queue; readiness board; fused-build smoke test; Playwright e2e |
| 6 | Radar and decision engine reading the cells' export live; Claude provider (templates by default); scorecard on the readiness board; Tamil |
| 7 | Windows laptop bring-up; detection matrix on both OSes; measured load (p50/p99, RPO/RTO, WAN bytes, seat CPU); witness (S6); TLS (S7) |
| R, 8 | Optional Rust cell ingest; 20 logged chaos runs, deck, video |

### Claims we deliberately don't make

- **"Cheat-proof" or "tamper-proof".** We claim **deterrence + detection** at the seat, and **tamper-evident** records.
- **"Lockdown" on its own.** Neither OS can be fully locked down from user space. On macOS 15+ there is no public API to block screen capture.
- **"Time-lock" for the paper.** It is split custody across institutions, plus a public commitment and audited offline fallback.
- **"Blockchain".** The register is an RFC 9162 Merkle log.
- **That a seat signature proves the candidate chose an answer.** *A seat signature proves the record wasn't altered after the device produced it — not that the candidate chose it.*
- **Auto-disqualification.** Every flag is evidence for human review. Nothing is auto-penalised.
- **Court admissibility.** The evidence pack carries a BSA 2023 s.63 certificate **template**, which a responsible person must complete.

---

## Licence

Apache-2.0 ([`LICENSE`](LICENSE)), in line with the GoI open-source policy. The bundled Noto Sans Devanagari font is under OFL-1.1.
