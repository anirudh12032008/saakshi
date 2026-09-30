# Saakshi (साक्षी, "witness")

[![windows](https://github.com/anirudh12032008/saakshi/actions/workflows/windows.yml/badge.svg)](https://github.com/anirudh12032008/saakshi/actions/workflows/windows.yml)
[![server](https://github.com/anirudh12032008/saakshi/actions/workflows/server.yml/badge.svg)](https://github.com/anirudh12032008/saakshi/actions/workflows/server.yml)
[![licence](https://img.shields.io/badge/licence-Apache--2.0-blue)](LICENSE)

A resilient, provable computer-based testing system for high-stakes exams (Hackathon Challenge 6, Team Kawaai).

Every answer is signed and hash-chained at the exam seat, encrypted to the data centre, and countersigned on arrival. If something fails, nothing is lost. If someone tampers with a record, the evidence shows exactly where. Only candidates who were actually harmed are re-tested.

> We can't promise zero failures. We make every failure recoverable, contained and provable.

## How it works

Seat (exam PC) → Centre relay (untrusted) → Cells x3 (data centre) → Control → Witness

- **Seat**: Electron app. Signs and hash-chains each answer, saves it to disk, works offline.
- **Centre relay**: stores and forwards sealed answers. It cannot read them.
- **Cells**: three independent data-centre processes. They decrypt, verify, countersign, and seal a Merkle register per shift.
- **Control**: signs the register, runs audits, serves `/verify` and the evidence pack.
- **Witness**: separate process that co-signs the register only if it extends the previous one correctly.

Key limit: a seat signature proves a record was not altered after the device produced it, not that the candidate chose it. See `docs/threat-model.md`.

## Demo

Five scripted acts on real processes (not mocks):

| Act | Command | What it shows |
|---|---|---|
| 1. Before | `bun tools/act1.ts` | Integrity gate blocks AnyDesk and an overlay tool by name |
| 2. T0 | `bun tools/act2.ts` | 2-of-3 custodians release paper keys; a cut-off centre unlocks with a phoned code |
| 3. During | `bun tools/act3.ts` | WAN cut, cell wipe and rebuild, seat force-quit; 0 answers lost |
| 4. After | `bun tools/act4.ts` | Insider edit is located; `/verify` shows "Q17: record says C, the seat committed B" |
| 5. Decide | `bun tools/act5.ts [--full]` | Analytics on the cells' own export; only harmed candidates re-tested |

Acts need local loopback ports. Acts 2, 3 and 5 also need `uv`.

## Quickstart

Requirements: node >= 25, bun 1.3.14, pnpm 11.5, uv with Python >= 3.14.

    pnpm install --frozen-lockfile
    pnpm -r test
    (cd analytics && uv run pytest -q -m "not full")

Tested on macOS and Windows. Windows CI (`windows-latest`) runs the full test suite, builds the packaged seat, checks the gate blocks a renamed `AnyDesk.exe`, confirms the build refuses `--inspect` and remote debugging, and runs an end-to-end test of the packaged seat. The scripted acts are run on macOS.

## Measured results

One Apple M5 Mac, 3 real cells on loopback, 99 simulated centres, synthetic data. Not a real WAN.

| Measure | Result | Evidence (`docs/evidence/`) |
|---|---|---|
| Relay-to-cell ingest | p50 44 ms, p99 168 ms | `stage7-load.txt` |
| Entries at 20k candidates | 227,882 stored, 0 rejected | `stage7-load.txt` |
| Candidates unlocked | 19,803 of 19,803 | `stage7-load.txt` |
| Seat CPU / memory | 2.3% median / 166 MiB | `stage7-load.txt` |
| Chaos drill (20 runs) | 0 of 16,000 answers lost, recovery about 1 s | `stage8-chaos.txt` |
| Tamper lab | 1,000 of 1,000 edits located | `stage0-tamper-lab.txt` |
| Analytics (20k cohort) | 322 flags, 225 re-tested, 18,994 spared, ₹2,84,91,000 avoided | `stage6-act5-full.txt` |

## Limits and next steps

- The integrity gate detects tools by process and window name. The kernel-level monitor is planned.
- Analytics numbers come from synthetic data, not a real exam.
- Hindi and Tamil notices are machine-translated, pending native-speaker review.
- The witness runs on the same machine as control in the demo. Independent custody is planned.
- The server currently runs on Bun. A Rust rewrite is planned.
- Next: field pilot on a real WAN, TLS pinning, HSM-held keys, WORM archive.

## Docs

- [Claims ledger](docs/claims-ledger.md): every claim, its evidence and status
- [Traceability](docs/traceability.md): the 12 focus areas mapped to code and tests
- [Threat model](docs/threat-model.md): trust boundaries and limits
- [Protocol v1](docs/protocol-v1.md): the frozen spec

## Licence

Apache-2.0 ([LICENSE](LICENSE)). The bundled Noto Sans Devanagari font is under OFL-1.1.
