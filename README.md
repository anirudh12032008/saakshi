# Saakshi (साक्षी, "witness")

[![windows](https://github.com/anirudh12032008/saakshi/actions/workflows/windows.yml/badge.svg)](https://github.com/anirudh12032008/saakshi/actions/workflows/windows.yml)
[![server](https://github.com/anirudh12032008/saakshi/actions/workflows/server.yml/badge.svg)](https://github.com/anirudh12032008/saakshi/actions/workflows/server.yml)
[![licence](https://img.shields.io/badge/licence-Apache--2.0-blue)](LICENSE)

Hackathon Challenge 6 submission: a resilient, provable CBT exam ecosystem. It signs and hash-chains every answer at the seat, keeps working through relay/cell/link failures, makes any tampering after the fact locatable and recoverable, and runs synthetic-data analytics that flag likely cheating and decide who gets compensated, re-tested or re-conducted — without ever auto-penalising a candidate. Tested on macOS and Windows. Every number below is cited to a file in `docs/evidence/`.

> **We can't promise zero failures. We make every failure recoverable, contained, provable.**

---

## Architecture

```mermaid
flowchart LR
    Seat["Seat (Electron)\nsigns + hash-chains\nevery answer"] -- LAN --> Relay["Centre relay (untrusted)\nstores and forwards\ncannot read answers"]
    Relay -- WAN --> Cell["Cell (national DC)\nopens, verifies,\ncountersigns"]
    Cell --> Control["Control\nseals the register (STH)\naudit, /verify, evidence pack"]
    Control -- STH + consistency proof --> Witness["Witness\nindependent co-signer"]
```

- **Seat** — Electron app at the exam PC. Signs and hash-chains every answer locally, fsyncs, and keeps working offline.
- **Cell relay** — untrusted store-and-forward at the centre. Sees only sealed envelopes, never answer text.
- **Cell** — one of three independent national-DC processes. Opens bodies, verifies chains, countersigns, seals a per-shift Merkle register.
- **Control** — signs the sealed register's tree head (STH), runs the audit, serves `/verify` and the evidence pack.
- **Witness** — a separate `MODE=witness` process that polls control's STH, checks an RFC 9162 consistency proof against the last head it cosigned, and cosigns only consistent heads; a rewritten or forked register raises a P0 TAMPER incident at control. **Built** (T15 in `docs/claims-ledger.md`; `apps/server/test/witness.test.ts`). In the demo it runs on the same machine as control, so it is independent in code; independent custody is on the roadmap.

The key limit the whole design is built around: *a seat signature proves the record wasn't altered after the device produced it — not that the candidate chose it* (`docs/threat-model.md`).

---

## The five demo acts

Each act runs real seat/relay/cell/control processes (not mocks). Numbers are cited to their evidence file.

**Act 1 — Before (integrity gate).** `tools/act1.ts` provisions a scribe seat and two others, brings up 3 cells + a relay + control, then runs a seat with AnyDesk and an overlay-sim tool "running": the gate blocks and names both, closes and re-checks green, and a 3-faces sample raises one `face-extra` flag that a reviewer clears. Evidence: [`docs/evidence/stage5-act1.txt`](docs/evidence/stage5-act1.txt), [`docs/evidence/stage5-gate-selftest.json`](docs/evidence/stage5-gate-selftest.json) (CI gate self-test blocks a renamed `AnyDesk.exe` by name).

**Act 2 — T0 (custody release).** `tools/act2.ts` runs 3 real cells, the Centre 42 relay, control, and a real seat, with a small swarm of simulated centres. 2-of-3 custodians release the paper keys; 6 of 7 centres go green while Centre 42 (link cut) stays locked; a typo and another centre's code are refused; the phoned offline code unlocks Centre 42; a forged key pushed by the relay is rejected; 308 candidates at 7 centres, 6,586 entries committed. Evidence: [`docs/evidence/stage8-act2.txt`](docs/evidence/stage8-act2.txt).

**Act 3 — During (chaos).** `tools/act3.ts` degrades and then cuts Centre 42's WAN link (SYNC_LAG predicts the cut before it happens), wipes Data Centre 2's cell mid-stream, and force-quits a seat: candidates keep answering throughout, the wiped cell rebuilds with sent = stored = verified and lost = 0, and the force-quit seat resumes on another seat via PIN + invigilator approval with credited time. Evidence: [`docs/evidence/stage4-chaos.jsonl`](docs/evidence/stage4-chaos.jsonl) (RPO 0, RTO 1.3–1.9 s across three chaos-drill runs), [`docs/evidence/stage4-act3.txt`](docs/evidence/stage4-act3.txt).

**Act 4 — After (tamper audit).** `tools/act4.ts` runs a real seat session through relay → cell, seals the register, then has a rogue insider edit an answer directly in the cell's DB. The audit locates the edit; `/verify` shows *"Q17: record says C — the seat committed B"* and recovers B; the evidence pack's manifest verifies. Evidence: [`docs/evidence/stage0-tamper-lab.txt`](docs/evidence/stage0-tamper-lab.txt) (1,000/1,000 byte-flip locations); commit `d7efb47`, CI `server` job.

**Act 5 — Decide (analytics on the real export).** `tools/act5.ts` replays a G1 twin cohort through the full stack, then runs the analytics pipeline on what the cells actually exported (not a separate generator run). At 2k candidates: 203,031 entries, export matches the replayed cohort on 200,000 checked fields, 53 flags (planted leak centres CEN005/CEN008/CEN009/CEN010), no honest candidate flagged, headline *"Compensated 0 · Re-tested 193 · Re-conducted 3 centres · Spared 1,190 · ₹ avoided 17,85,000"*, notice approved and shown in EN/HI/TA, decision sign-off signature verifies. Evidence: [`docs/evidence/stage6-act5.txt`](docs/evidence/stage6-act5.txt). At full 20k scale (`--full`): 1,981,100 export rows, 322 flags, 55 corroborated, headline *"Compensated 0 · Re-tested 225 · Re-conducted 3 centres · Spared 18,994 · ₹ avoided 2,84,91,000"*, matching the pinned golden. Evidence: [`docs/evidence/stage6-act5-full.txt`](docs/evidence/stage6-act5-full.txt). All figures here are **synthetic** — see Limits and roadmap.

---

## Quickstart

**Prerequisites:** node ≥ 25, bun 1.3.14, pnpm 11.5, uv with Python ≥ 3.14. Tested on macOS and Windows. macOS arm64 is the development machine; Windows runs automated CI on `windows-latest`, including an end-to-end test of the packaged seat. The server tests and the scripted acts open loopback ports.

### macOS

```sh
pnpm install --frozen-lockfile
pnpm -r test                                       # core, seat, server
(cd analytics && uv run pytest -q -m "not full")   # analytics fast suite
bun tools/act4.ts                                  # or act1/act2/act3/act5 — see below
```

### Windows

```powershell
pnpm install --frozen-lockfile
pnpm -r test
```

On every commit, `.github/workflows/windows.yml` runs on a real `windows-latest` machine: the full workspace test suite, a build of the packaged Windows seat, its probe self-test, a gate self-test (a renamed `AnyDesk.exe` and the overlay-sim tool must be blocked by name), a check that the fused build refuses `--inspect` and `--remote-debugging-port`, and a Playwright end-to-end test of the packaged seat. The scripted acts (`bun tools/actN.ts`) and the chaos/tamper tools are run and evidenced on macOS.

---

## How to run acts 1–5

```sh
bun tools/act1.ts [--cohort path/to/cohort.jsonl]   # integrity gate: block by name, face flag, review
bun tools/act2.ts [--cohort path/to/cohort.jsonl]   # custody release: 2-of-3, phoned offline code
bun tools/act3.ts [--cohort path/to/cohort.jsonl]   # chaos: WAN cut, cell wipe/rebuild, seat move
bun tools/act4.ts                                   # tamper: rogue edit, audit, /verify, evidence pack
bun tools/act5.ts [--full]                          # analytics on the cells' own export (2k, or 20k with --full)
```

All five need local loopback ports and are meant to run unsandboxed; `act2`/`act3`/`act5` also need `uv` (they generate a small cohort unless `--cohort` is given).

---

## Measured numbers

Measured on one Apple M5 Mac (16 GiB), 3 real cells on loopback, 99 simulated centres, synthetic G1 cohort. Not real WAN.

| Measure | Result | Source |
|---|---|---|
| Ingest latency, relay to cell (3,697 calls) | p50 44.1 ms, p99 168.1 ms | `docs/evidence/stage7-load.txt` |
| Entries stored / rejected at 20k candidates | 227,882 / 0 | `docs/evidence/stage7-load.txt` |
| Candidates unlocked | 19,803 of 19,803 | `docs/evidence/stage7-load.txt` |
| Relay-to-cell traffic | about 1.06 MB per candidate-hour | `docs/evidence/stage7-load.txt` |
| Seat CPU / RSS | 2.3% median (max 4.3%) / 166 MiB | `docs/evidence/stage7-load.txt` |
| Chaos drill (kill-cell, wipe-cell, spare-relay) | 20/20 pass, 0 of 16,000 answers lost, RTO median 0.96 to 1.23 s | `docs/evidence/stage8-chaos.txt` |
| Offline-start act | PASS, 308 candidates at 7 centres, 6,586 entries committed | `docs/evidence/stage8-act2.txt` |

Caveats: the per-candidate-hour figure extrapolates a 60 s measurement window and is not a real exam duty cycle. Seat CPU/RSS cover the Node main process only, over about 10 s. All of it is loopback on one host, so it says nothing about real WAN.

---

## Limits and roadmap

What the evidence covers, and what comes next.

- **Scope of detection.** The integrity gate detects tools by process/window name, proven against a renamed binary and the seat's own overlay-sim. The live camera face check is run by hand (`docs/claims-ledger.md`, `docs/traceability.md`).
- **Languages.** Tamil UI, banner, notices and status page are built and shown live in Act 5. Question text is English in TA mode until a Tamil item bank exists, and the HI/TA notice drafts are machine translations pending native-speaker review (`docs/claims-ledger.md` D17).
- **Synthetic data.** Every radar, decision-engine and centre-risk number comes from generators we wrote (G1/G2), not a real exam: model results, not field results.
- **Next:** field pilot on a real WAN with measured throughput and RTO; independent-custody witness under a separate organisation; TLS pinning between components; HSM-held sign-off key; real archive WORM storage; Tamil item bank with native review.

Full detail and trust boundaries: [`docs/threat-model.md`](docs/threat-model.md).

---

## Links

- [`docs/claims-ledger.md`](docs/claims-ledger.md) — every claim, its evidence, and its status
- [`docs/traceability.md`](docs/traceability.md) — the 12 brief focus areas → features → code → tests
- [`docs/threat-model.md`](docs/threat-model.md) — trust boundaries, actors, limits
- [`docs/protocol-v1.md`](docs/protocol-v1.md) — the frozen protocol spec

---

Chaos: 20 runs — see docs/evidence/stage8-chaos.txt (20/20 PASS, 16,000 sent = 16,000 stored, 0 lost; median RTO kill-cell 1234 ms, wipe-cell 1220 ms, spare-relay 955 ms)

---

## Licence

Apache-2.0 ([`LICENSE`](LICENSE)), in line with the GoI open-source policy. The bundled Noto Sans Devanagari font is under OFL-1.1.
