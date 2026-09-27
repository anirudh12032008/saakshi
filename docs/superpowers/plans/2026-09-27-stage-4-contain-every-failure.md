# Stage 4 — "Contain every failure" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Act 3 works end to end, and every failure the plan lists is detected, contained, recovered from and measured.
- "Pull the plug on Data Centre 2" SIGKILLs cell-2 **and deletes its database**. A **P1** card shows the blast radius ("1 cell · 2 centres · 96 candidates · answers lost: checked when it rebuilds"); candidates keep answering; the relays replay; the card closes with **answers lost 0**, and `sent = verified = stored`.
- "Degrade Centre 42's link" makes the relay's link monitor raise **SYNC_LAG** ("WAN failure likely …") *before* the link is cut; the cut opens RELAY_WAN_DOWN, which records how many seconds earlier the prediction came.
- An unacknowledged alert **climbs the escalation ladder** (invigilator → superintendent → control → regulator) on DEMO timers of 10 s; TAMPER at the regulator rung drafts a **CERT-In 6-hour report template**.
- With ✓✓ at backlog 0, seat A is force-quit. Seat B: PIN → the invigilator approves at the relay console → the cell signs a **keyEpoch 2** binding and a grant, and restores the answers **sealed to seat B's key** → the candidate resumes with the same answers and time, "+1:48 credited · approved by INV-42-A". Seat A, revived, is **ORPHANED** (evidence, not tampering).
- The seats show an **in-exam banner** (cause, ETA, "your time and answers are preserved" with tick counts). A **public status page** shows centres and incidents with **no PII**. An approved notice goes to the **outbox** (mock SMS / e-mail / DigiLocker).
- The sealed shift is archived to **2 write-once stores**; both hash-verify against the STH before control signs a **purge order** for the relay.
- `/verify` pins **only the exam authority key**: an enrolled candidate's proof carries its bind certificates and the cell's key certificate (the Stage 3 fix, **Task 1**).
- `bun tools/chaos.ts --runs 20` logs lost = 0 and the RTO on every run.

**Architecture:**
- **Addendum C (Task 1)** is the only protocol change: proofs carry certificates; the handover claim, PIN box, new binding, grant and restore box; the relay's `rxWall`; the hard stop; the gap convention; the signed purge order. Additive only (`V` stays 1), with vectors, checked in the browser by `/verify` on every load.
- **Key epochs at relay and cell (Task 2):** an entry must be after its epoch's `fromSeq`; an old-epoch entry after the next epoch's `fromSeq` is **ORPHANED** evidence (line + envelope), never FORK, never committed. The relay stamps `rxWall`; the cell stores it and its own. Entries after the hard stop are **LATE** evidence. A rebuilding cell waits for **every relay it serves** (grace timeout for a dead one), and a relay attaches its bindings whenever the cell does not know a stream, so a late relay heals.
- **Handover:** seat B → relay (`/v1/handover`, pending) → invigilator approves on `/console` → relay adds its own head (`fromSeq`, `fromHead`) → cell checks the PIN against the sealed PIN record (3 tries), requires `fromSeq` = its head, signs the keyEpoch-2 bind and the grant, seals the answers to seat B → relay stores the new binding → seat B verifies everything against the policy-pinned cell key and continues the chain from `fromHead`. The old-key path (seat A signs the claim) needs no approval but its credit does.
- **Detection and response (control):** a monitor polls the fleet, every cell's `/v1/events` (evidence rows), the demo relay's `/v1/link` and `/v1/heads`, and the release status, and feeds a pure rules engine (P0–P3, blast radius, ladder, debounce). CERT-In drafts, the time audit (gaps, caps, credit measured by the relay's clock), notices and the public status are pure modules around it.
- **Recovery ops:** `tools/stack.ts` supervises the demo processes (control's chaos buttons SIGKILL, wipe and restart through it); `tools/chaos.ts` runs the three failure scenarios N times and logs RPO/RTO; `tools/reset.ts` returns to a clean slate; archive and purge live in `archive.ts`.

**Tech Stack:**
- TypeScript on Node 25 and Bun 1.3.14; `bun:sqlite`; `Bun.serve` routes with HTML imports.
- `@noble/*`, `shamir-secret-sharing`, native `node:crypto`. Electron 44 (`powerMonitor`), React 19. `node:test` in core and seat; `bun:test` in server.
- Python via `uv` only to generate the small G1 cohort for `tools/act3.ts`.
- **No new dependencies.**

**Spec:**
- `docs/plan.md`: §2 (failure handling), §3.2 (handover), §3.6 (time, resume, gaps, caps, rxWall, the hard stop), §3.7 (archive: 2 WORM stores, purge after hash-verify, RPO/RTO), §3.10 (incidents, prediction, comms), §3.11 (control room, chaos buttons), §5 "Stage 4" and Act 3 in §6.
- `docs/protocol-v1.md` is **frozen**. Task 1 appends **Addendum C** (§16), additive only, with new vectors.
- The Stage 3 plan's Conflicts section: "/verify and enrolled keys" is fixed by Task 1.

## Decisions (open questions, settled)

1. **Handover needs the cell.** The PIN is checked against the PIN record sealed to the cell, so a PIN handover waits for the WAN (the relay retries; the console says so). The plan's "WAN down → continue provisionally, earlier answers restoring" is not built (see Conflicts).
2. **`fromSeq` = the cell's head.** The cell issues keyEpoch E+1 only when its committed head for the stream equals `fromSeq` and nothing is pending (`BEHIND` → the relay retries; `AHEAD` → refused). This is why the demo waits for blue ✓✓ at backlog 0.
3. **Restore = the A.5 responses at `fromSeq`** (without NV rows), sealed to the new seat key, bound by `respHash` in the cell-signed grant. The relay cannot read or change them.
4. **Credit is measured by the relay's clock** (`rxWall`), never the seat's. A gap body carries the seat's own `pausedMs` for comparison. The time audit runs at control from the cell's export; approvals: the invigilator's handover approval, or control's "Approve credited time".
5. **The hard stop rejects as LATE but keeps everything** (line + envelope in the evidence table). A human can admit late entries; nothing is deleted.
6. **Incidents are rebuilt, not persisted.** State rules re-derive from live state; event rules re-derive from each cell's `/v1/events` (re-read from 0 when a cell was wiped). `incidents.json` is written on every change for the record only.
7. **Seat and centre silence** (SEAT_SILENT, CENTRE_OUTAGE) are evaluated for the relays control can reach (the demo relay). The 99 simulated centres report through their cells only (RELAY_WAN_DOWN is per real relay; CELL_DOWN covers all).
8. **Ops parameters** (gap cap 30 min, slack 10 min, ladder timers, debounce, PIN tries, release delay) live in `Directory.ops`, written by `tools/provision.ts` (`--demo` → `OPS_DEMO`, ladder 10 s). The control page labels DEMO timers.
9. **Chaos goes through a supervisor.** Control never spawns processes. `STACK_URL` (the `tools/stack.ts` HTTP port, 127.0.0.1:7099) is how "Pull the plug" and "Restart" reach real processes. Without it those buttons say how to start the stack.
10. **WORM is simulated**: write-once (`wx`) files, read-only mode (not on Windows), two directories. The relay purges only on an **authority-signed purge order** that control issues after both stores verify.
11. **`/verify` keeps the DEV pins for DEV records.** EXAM-mode records carry certificates and verify with only the authority key; Stage 2's DEV-mode Act 4 still verifies with the fixture keys (labelled "pinned DEV keys").

## Protocol Addendum C (Task 1 appends it to `docs/protocol-v1.md` as §16)

Additive only: no byte defined in §1–§15 changes, so `V` stays 1. Vectors: `fixtures/vectors/protocol-v1-addendum-c.json`.

| # | Addendum | Why |
|---|---|---|
| C.1 | A response sheet may carry `binds` (its bind certificates, every epoch; `pinBox` may be `''`); a proof may carry `cells: [{id, keyId, pub, cert}]` (B.2 cell key certificates). A verifier that pins only the authority key accepts a seat key for `(cand, keyEpoch)` iff a bind in `binds` verifies under a cell whose certificate verifies under the authority, names this `exam, shift, attempt, cand`, and has this `pub`. Certified epochs must be `1, 2, …` with epoch 1 `fromSeq 0` and increasing `fromSeq`; with them, entry `seq` must be signed at `epochAt(seq)` = the highest epoch whose `fromSeq < seq`. A receipt countersignature is checked under the named certified cell. DEV records without certificates may still use pinned keys. | Stage 3 conflict: enrolled candidates failed `/verify`'s keys row |
| C.2 | Handover claim `["handover",exam,shift,attempt,cand,keyEpoch,fromSeq,fromHead,newPub]`, signed (A.1 style) by the key of `keyEpoch` (the **old** epoch); `fromHead` 64 hex (`genesisPrev` when `fromSeq = 0`); `newPub` 130 hex | Fixes the §5 reserved layout |
| C.3 | Handover PIN: UTF-8 of the 6-digit PIN in a B.4 box to the cell, `info = ["saakshi-handover-pin",1,exam,shift,attempt,cand,seatId,newPub]`. The new seat also sends a fresh B.5 record (B.4 box, `pinInfo(seatId)`) holding the same PIN. The cell checks both against the current epoch's record; wrong PINs are limited per candidate | Plan §3.2 (ii) |
| C.4 | New binding: the cell signs a B.1 bind with `keyEpoch = E+1`, `fromSeq = F` only if F equals its committed head for the stream, `h(F) = fromHead`, nothing is pending and the stream is not submitted. Relay and cell: `seq ≤ fromSeq(keyEpoch)` → BAD_SUBMISSION; `seq > fromSeq(keyEpoch+1)` → **ORPHANED**, kept as evidence with its envelope, never FORK, never committed | Plan §3.2 ORPHANED |
| C.5 | Grant `["grant",exam,shift,attempt,cand,keyEpoch,fromSeq,fromHead,activeMs,creditedMs,respHash]`, signed by the cell (A.1). `activeMs` = entry F's; `creditedMs` = the cell's clock at the grant − `rxWall(F)` (≥ 0; 0 when F = 0); `respHash = hex(SHA-256(UTF-8(canon(["responses", R]))))`, R = the A.5 responses at F in form order without `NV` rows. Restore box: B.4 to `newPub`, `info = ["saakshi-restore",1,exam,shift,attempt,cand,keyEpoch,fromSeq]`, `pt = UTF-8(canon(["responses", R]))`. The new seat accepts only if bind and grant verify under its policy-pinned cell key, match each other and its own key, and `respHash` matches the opened box | Plan §3.2 "re-encrypts the answer state to the new seat key" |
| C.6 | Convention (not checked): the first entry of keyEpoch E+1 is kind `handover` at seq F+1, `prev = fromHead`, `activeMs` = the grant's, body `["body","","","",[via,F,creditedMs]]`, `via ∈ {pin, key}` | Evidence of how the move happened |
| C.7 | `rxWall`: the relay stamps its wall clock (ms since the Unix epoch) on each entry it commits and forwards it as `WireEntry.rx`; the cell stores the relay's value and its own. Not signed: the nodes' claims, used only for the time audit (C.9) and the hard stop (C.8). The §12 export field `rxWall` is the relay's value; `SheetEntry.rx = [relayRx, cellRx]` | Plan §3.6 (deferred in Stage 1) |
| C.8 | Hard stop: relay and cell reject a new entry whose `rxWall` (relay: its own clock; cell: the relay's `rx`, else its own) is later than `rxWall(seq 1) + D_i + gapCapMs + slackMs` as **LATE**, kept as evidence with its envelope | Plan §3.6 |
| C.9 | Gap convention (not checked): `gap` body `["body","","","",[cause,pausedMs]]`, `cause ∈ {suspend, lock-screen, restart}`, `pausedMs` the seat's own measure (0 if unknown). Credit for a gap or handover entry g after entry p is measured as `max(0, (rx_g − rx_p) − Δactive)`, Δactive = 0 across epochs | Plan §3.6 gaps and caps |
| C.10 | Purge order `["purge",exam,shift,sthId,ts]`, signed (A.1) by the exam authority; a relay deletes a shift's entries only on a valid order | Plan §3.7 "purge only after both stores hash-verify" |

Non-normative JSON (types in core, Task 1): `HandoverReq`, `HandoverGrant`, `HandoverApproval`, `CellCert`, `StreamSnap`, `PurgeOrder`; `Ops`, `Incident`, `CellEvent`, `LinkView`, `CentreStatus`, `RoundSample`, `TimeRow`, `Approval`, `Notice`, `PublicStatus`, `ArchiveReport`.

## Global Constraints

**Protocol and code reuse**
- Protocol v1 is frozen. All hashing, signing, sealing and wrapping goes through `packages/core`.
  - No task may change a byte that §1–§15 define. If a task believes it must, it **stops and reports**.
  - Task 1 is the only task that adds core modules (`handover.ts`, `ops.ts`) or edits `wire.ts`, `sheet.ts`, `journal.ts`, `verify.ts`, `selftest.ts`, `directory.ts`.
- **Browser-safe core.** `handover.ts` and `ops.ts` import nothing from `node.ts`, `wire.ts` (except `import type`) or `node:*`. `incidents.ts`, `certin.ts`, `time-audit.ts`, `status-view.ts`, `control-view.ts` are browser-safe too (they are bundled into pages).
- Reuse what exists: `Bindings`, `createIngest`, `Forwarder`, `ReleaseStore`, `Hub`, `openDb`, `shiftExport`, `seal`/`proofFor`, `verifySheet`/`verifyProof`, `fleet`, `SeatJournal`, `ExamSession`, `SeatSync`, `SeatIdentity`, `Seat`, `SimSeat`, `simBindReq`, `Swarm`, `provision`, `buildPackage`, `checkPin`, `openPinBox`, `makeBindReq`, `pinRecord`, `sealBox`/`openBox`, `responsesOf`, `rootOf`, `leafHashHex`, `sthMessage`, `sthId`.
- **Imports:** core as `@saakshi/core/<module>` in apps; `tools/*.ts` import core and server code by relative path. Relative TS imports carry `.ts`. JSON in `apps/server/src` uses `with { type: 'json' }`. No barrel files.
- **TypeScript:** `erasableSyntaxOnly` — no enums, namespaces or constructor parameter properties.
- **Dependencies:** none. If a task needs a package, it stops and reports. Only Task 1 may run `pnpm`, and then only as `pnpm … --config.confirm-modules-purge=false </dev/null`.
- `tools/sim-seat.ts`, `tools/sim-custody.ts`, `tools/provision.ts`, `tools/package.ts` stay `node:*`-and-core only (the seat's `node --test` suite imports some of them). New CLIs run under Bun behind `if (import.meta.main)`.

**Shared types (Task 1; exact names)**

```ts
// core/handover.ts (browser-safe)
interface HandoverClaim extends Ctx { keyEpoch: number; fromSeq: number; fromHead: string; newPub: string }   // keyEpoch = OLD epoch
handoverArray(h): Canon[]; interface Grant extends Ctx { keyEpoch; fromSeq; fromHead; activeMs; creditedMs; respHash }  // keyEpoch = NEW
grantArray(g): Canon[]; respHash(rs: Response[]): string; restoreInfo(c, keyEpoch, fromSeq); handoverPinInfo(c, seatId, newPub)
sealRestore(newPub, c, keyEpoch, fromSeq, rs, k?): string /*hex*/; openRestore(priv, c, keyEpoch, fromSeq, box, k?): Response[]
sealHandoverPin(cellPub, c, seatId, newPub, pin, k?): string; openHandoverPin(cellPriv, c, seatId, newPub, box, k?): string
type HandoverProof = { via: 'pin'; pin: string /*hex C.3 box*/ } | { via: 'key'; keyEpoch: number; fromSeq: number; fromHead: string; sig: string }
interface HandoverReq extends Ctx { seatId: string; pub: string; attestHash: string; pinBox: string /*B.5 record box*/; proof: HandoverProof }
interface HandoverApproval { by: string; at: number }
interface HandoverGrant { bind: WireBind; grant: Grant; sig: string; restore: string; via: 'pin' | 'key'; approvedBy: string }
checkGrant(g, want: Ctx & { seatId; pub }, cellPub, seatPriv, mk?, k?): { bind: Bind; grant: Grant; responses: Response[] }
interface CellCert { id; keyId; pub; cert }; checkCellCert(c, exam, authority: Verify): Uint8Array
interface Epoch { keyEpoch; fromSeq }; epochAt(epochs, seq): number | undefined
interface StreamSnap { head; headH; activeMs; pending; submitted; bodies: Body[]; rxAt(seq): number }
interface PurgeOrder { exam; shift; sthId; ts }; purgeArray(p): Canon[]
// core/ops.ts (types + constants)
type Severity = 'P0'|'P1'|'P2'|'P3'; RUNGS = ['invigilator','superintendent','control','regulator']; type Rung
interface Ops { demo; gapCapMs; slackMs; gapTolMs; silentMs; clearMs; releaseDelayMs; rebuildGraceMs; ladderMs: Record<Severity, number>; pinTries; criticalIntegrity: string[] }
OPS, OPS_DEMO, opsOf(x?: Partial<Ops>): Ops
type IncidentKind = 'CELL_DOWN'|'CENTRE_OUTAGE'|'SEAT_SILENT'|'RELAY_WAN_DOWN'|'SYNC_LAG'|'INTEGRITY_CRITICAL'|'TAMPER'|'BAD_SUBMISSION'|'KEY_RELEASE_DELAY'|'HANDOVER'|'GAP'|'ORPHANED'|'LATE'
interface Blast { cells: string[]; centres: string[]; candidates: number; answersLost: number | null }
interface Incident { id; kind; severity; key; title; detail; blast; openedAt; updatedAt; resolvedAt?; rung: number; ladder: { rung: Rung; at: number }[]; ack?: { by; rung: Rung; at }; certIn?: string; cand?: string; data: Record<string, string | number> }
type EventCode = 'BAD_SUBMISSION'|'FORK'|'ORPHANED'|'LATE'|'HANDOVER'|'GAP'|'INTEGRITY'
interface CellEvent { id; at; cell; code: EventCode; cand; centre; seq; reason; data?: Record<string, string | number> }
interface RoundSample { at; ms; ok: boolean; backlog: number; replaying: boolean }
interface LinkView { centre; up; cut; degraded; rttMs; errRate; backlog; lastContactAt; risk: 'ok'|'warn'|'down'; reason; etaMs?; cell: NodeState | 'unreachable' }
interface CentreStatus { link: 'up'|'degraded'|'down'; cell: NodeState | 'unreachable'; etaMs?: number; at: number }
interface Approval { cand; seq; by; at }
interface GapLine { seq; kind: 'gap'|'handover'; cause; pausedMs; measuredMs; approved; approvedBy }
type TimeFlag = 'REVIEW_GAPS'|'RETEST_ELIGIBLE'|'PENDING_APPROVAL'|'UNEXPLAINED_TIME'
interface TimeRow { cand; wallMs; activeMs; unaccountedMs; gaps: GapLine[]; creditedMs; flags: TimeFlag[]; changedAfterMove: { item; q }[] }
interface Notice { id; incident; kind: IncidentKind; centres: string[]; audience: number; en; hi; channels: ('sms'|'email'|'digilocker')[]; draftedAt; approvedBy?; approvedAt? }
interface PublicStatus { exam; shift; at; summary: { en; hi }; centres: { centre; tone: TileTone; en; hi }[]; incidents: { kind; severity; since; centres: string[]; answersLost: number | null; en; hi }[]; notices: { at; en; hi }[] }
interface StoreReport { store; path; sha256; ok; detail }; interface ArchiveReport { exam; shift; size; root; stores: StoreReport[]; ok; writtenMs?; verifyMs }
// core/wire.ts additions
WireEntry.rx?: number; RejectCode = 'BAD_SUBMISSION'|'FORK'|'ORPHANED'|'LATE'; StreamView.submitted?: true; parseHandoverReq(x): HandoverReq
// core/sheet.ts additions
SheetEntry.rx?: [number, number]; ResponseSheet.binds?: WireBind[]; Proof.cells?: CellCert[]
// core/directory.ts additions
Directory.ops?: Ops; CentreStats.lastSeen?: number; CellStats.rebuild?: { done: number; expected: number }; FleetView.cells[i].rebuild?: { done; expected }
// core/journal.ts
verifyChainKeyed(c, lines, keyFor, start = { seq: 0, head: genesisPrev(c) })
// core/verify.ts
verifySheet(sheet, forms, trust, mkVerify?, cells?: CellCert[]); certifiedCells(exam, cells, trust, mk?): Map<string, Uint8Array>
// apps/seat/src/shared/ipc.ts additions
Phase += 'moving' | 'moved'; BindState += 'moving'; SyncView.moved?: boolean
interface Credit { ms: number; via: 'pin' | 'key'; approvedBy: string; fromSeq: number }
ExamBoot.moveable?: boolean; ExamBoot.moveKey?: string; ExamBoot.credited?: Credit; ExamBoot.status?: CentreStatus; ExamBoot.paused?: boolean
SeatApi.handover(pin: string): Promise<EnrolResult>
```

**HTTP routes (new)**

| Mode | Route | Request | Response |
|---|---|---|---|
| cell | `POST /v1/handover` | `{req: HandoverReq, approval?: {by}, fromSeq?, fromHead?}` | `200 HandoverGrant`; `409 {error, code, left?}` (`NOT_BOUND`, `BEHIND`, `AHEAD`, `SUBMITTED`, `PIN_WRONG`); `423 {code: 'PIN_LOCKED'}`; `400 {code: 'BAD'}`; `503` REBUILDING |
| cell | `GET /v1/events?after=&limit=` | — | `{events: CellEvent[], last: number}` (≤ 500) |
| cell | `GET /v1/stats` | — | `CellStats` + `rebuild`, per-centre `lastSeen` |
| relay | `POST /v1/handover` | `HandoverReq` | `200 {state:'granted', grant}`; `202 {state:'pending', error?}`; `409 {state:'refused', error, code}`; `400` |
| relay | `GET /v1/handover/pending` | — | `{pending: [{cand, seatId, key, at, error}]}` (`key` = pub hex chars 2–17) |
| relay | `POST /v1/handover/approve` | `{cand, key, invigilator}` | `200 {state:'granted', keyEpoch, fromSeq, creditedMs}`; `202 {state:'pending', error}`; `409 {error, code}`; `404` |
| relay | `POST /v1/handover/refuse` | `{cand, key}` | `{state:'refused'}` |
| relay | `GET /v1/link` | — | `LinkView` |
| relay | `GET /v1/status` | — | `CentreStatus` (the seats' banner) |
| relay (DEV) | `POST /v1/dev/degrade` | `{on: boolean}` | `{degraded}` |
| relay | `POST /v1/purge` | `{order: PurgeOrder, sig}` | `{purged: number}`; `400`/`403` |
| control | `GET /v1/incidents` | — | `{at, demo, ladderMs, incidents: Incident[]}` (open first, then the last 20 resolved) |
| control | `POST /v1/incidents/ack` | `{id, by}` | `Incident` |
| control | `POST /v1/incidents/resolve` | `{id}` | `Incident` |
| control | `GET /v1/incidents/certin?id=` | — | HTML (the draft) |
| control | `POST /v1/gaps/approve` | `{cand, seq, by}` | `Approval` |
| control | `GET /v1/time` | — | `{rows: TimeRow[]}` (the demo centre) |
| control | `GET /v1/link` | — | the demo relay's `LinkView` |
| control | `POST /v1/chaos/plug` | `{cell, wipe}` | `{node, killed, wiped}`; `409` without `STACK_URL` |
| control | `POST /v1/chaos/restart` | `{cell}` | `{node, pid}` |
| control | `POST /v1/chaos/spare` | `{}` | `{node: 'relay', killed, wiped, pid}` |
| control | `POST /v1/chaos/degrade` | `{on}` | the relay's `{degraded}` |
| control | `POST /v1/archive` | — | `ArchiveReport` |
| control | `GET /v1/archive/verify` | — | `ArchiveReport` |
| control | `POST /v1/archive/purge` | — | `{purged, report}`; `409` unless both stores verify |
| control | `GET /v1/status/public`, `GET /status` | — | `PublicStatus`; the public page |
| control | `GET /v1/notices`; `POST /v1/notices/approve` | `{id, by}` | `{drafts, sent}`; `Notice` |
| supervisor | `GET /nodes`; `POST /kill {node, wipe?}`; `POST /start {node}` | — | `tools/stack.ts` on 127.0.0.1:7099 |

- Control errors stay `{error}` with Stage 2's status rules.

**Environment**
- All modes: `EXAM`, `DEV=1` as before. Ops come from `Directory.ops` (default `OPS`).
- Cell: `REBUILD_RELAYS` (default: the number of centres the directory puts on this cell; `1` without `EXAM`).
- Control: `STACK_URL` (unset → chaos plug/restart/spare answer 409 with "start the demo with `bun tools/stack.ts`"), `ARCHIVE_A`, `ARCHIVE_B` (default `<DIR>/worm-a`, `<DIR>/worm-b`).
- `tools/provision.ts --demo` writes `OPS_DEMO` into the directory.

**Rules**
- Check order at relay and cell (Task 2), per entry: parse → signature under its epoch key → **C.4 epoch range** (BAD_SUBMISSION / ORPHANED) → after-submit → gap (NEED) → prev (FORK) → duplicate/fork → **C.8 hard stop** (LATE) → B.8 active time → body (cell) → commit.
- ORPHANED and LATE are **rejections with evidence**, never FORK, never TAMPER.
- The seat never auto-submits and is never locked out. A moved seat stops sending and says so.
- **Honest claims** (use these words): "answers lost 0 in every chaos run we logged (N seats × M entries, this Mac)"; "RTO measured from the kill to every acknowledged entry back at the cell"; "SYNC_LAG is a threshold on smoothed latency, errors and backlog; it warned before the cut in our drills; it is not validated on real WAN data"; "WORM simulated with write-once, read-only files"; "the CERT-In report is a draft template, not filed". Banned words: "tamper-proof", "time-lock", "blockchain", "lockdown" on its own, "zero downtime".

**Camera and test mode in automated checks** (the user's requirement: the webcam must not stay on)
- The seat honours `--no-camera` / `SAAKSHI_NO_CAMERA=1`; `--test-mode` / `SAAKSHI_TEST_MODE=1` also turns the camera off and uses the DEV test keystore (no keychain prompt).
- **Every** step in this plan that launches the packaged app passes `--test-mode --no-camera`, and **every** such step ends with `pkill -f 'Saakshi.app/Contents/MacOS/Saakshi'`.
- Automated checks prefer **in-process seats** (the `Seat` class, as `tools/act2.ts` does, and `tools/seat-cli.ts` from Task 16). No automated check launches the packaged app.

**UI pages** (`/control`, `/console`, `/status`, the seat)
- Type scale `0.8 / 1 / 1.25 / 1.563 / 1.953 / 2.441 rem` (ratio 1.25 between neighbours). A test reads each page's CSS and pins it (`typeScaleOk` in `control-view.test.ts`; copy it for `/status`).
- AA contrast (text ≥ 4.5:1), native controls with labels, keyboard order = reading order, `:focus-visible { outline: 3px solid #1565c0; outline-offset: 2px }`, minimum target 2.75rem for buttons.
- Severity and tone always carry a **word** as well as a colour: P0 `#8c1d18` on `#fce8e6` "P0 critical"; P1 `#7a4100` on `#fef7e0` "P1 major"; P2 `#0b3d91` on `#e8f0fe` "P2 minor"; P3 `#3c4043` on `#f1f3f4` "P3 notice"; tiles as Stage 3.
- Untrusted strings are rendered with `textContent` only. `/status` contains **no PII**: no roll numbers, seat ids, pseudonyms, names or staff ids (a test pins it).

**Environment gotchas** (carried over from Stages 2–3, plus Stage 4's)
- **Sandbox:**
  - It blocks `.git` writes, `open`, some network, **local port binding** and launching packaged apps.
  - Port binding covers every `apps/server` test that calls `Bun.serve` or spawns the server (`main.test.ts`, `control.test.ts`, `control-stage3.test.ts`, `serve.test.ts`, `sse.test.ts`), plus `tools/chaos-kill.ts`, `tools/act4.ts`, `tools/act2.ts`, `tools/chaos.ts`, `tools/act3.ts`, `tools/stack.ts`. Re-run those with `dangerouslyDisableSandbox: true`.
  - Every other new test calls route handlers directly (`routes[path].POST(new Request(…), {timeout() {}})`) or injects `fetch`, so it runs inside the sandbox.
- **Tests:**
  - Write `assert.throws(fn, /re/, msg)` or `assert.throws(fn, msg)`. Never `assert.throws(fn, undefined, msg)`, which does not type-check.
  - Bun's per-test timeout defaults to 5 s. Server tests run with `bun test --timeout 60000`, which the package script already passes.
  - noble scrypt costs ~150 ms. Tests that need many enrolments share one PIN record through `simPinRecord()` (`tools/sim-custody.ts`, PIN `123456`).
  - Windows CI runs `pnpm -r test`, so new server and seat tests run on Windows too. Close every DB handle before removing a temp dir (EBUSY), build paths with `join`, and never `chmod` files a test must delete (archive chmod is skipped on `win32`).
  - Anything random in a module under test is injected (`Wan`'s `rand`, clocks as `now`/`clock`/`wall`).
- **Module format:**
  - The root `package.json` is `"type":"module"`.
  - `apps/seat` has **no** type field, and electron-vite bundles main and preload as CommonJS. So seat main code has no top-level `await`, and seat test and lib files use neither `__dirname` nor `require`. `powerMonitor` is used only after `app.whenReady()`.
- **Killing by port:** `kill -9 $(lsof -ti tcp:7080 -sTCP:LISTEN)`. A plain `lsof -ti tcp:7080` also matches the relay's client socket.
- **G1:** `uv run --directory analytics python -m saakshi_analytics.generate <abs-out> [--n 300 --centres 6 --seed 7]`. The full cohort is ~350 MB; `data/` is gitignored.
- **Commits:** agents share one working tree, touch only the files their task lists, and **do not commit**. The controller reviews and commits each task.

## Review Focus

These are the five likeliest real-world failures. Each is pinned by a named test in the task that owns the code.

1. **A rebuilt cell hears its relays at different times** (33 relays; one is slow, one is dead, one was offline during the replay).
   - Expected: the cell stays REBUILDING until every relay it serves has replayed, or the grace period after the last replay passes; a relay that missed the replay still gets its bindings through, so none of its entries are rejected for "no seat key"; `sent = stored`.
   - Pinned in Task 2: "Review Focus #1: a cell serving 3 relays stays REBUILDING until all 3 replay; a dead relay ends it by grace; a late relay's binds travel with its first entries".
2. **The old seat comes back after a move** (power returns, the old laptop boots and syncs its unsent tail).
   - Expected: its entries after `fromSeq` are ORPHANED evidence with their envelopes — never FORK, never TAMPER, never committed; the old seat stops and says "moved"; the new seat's chain is untouched.
   - Pinned in Task 2: "Review Focus #2: an old-epoch entry after the new fromSeq is ORPHANED (evidence with envelope), before or after the new seat's entries, never FORK"; in Task 13: "the seat, moved: … Review Focus #2: ORPHANED → moved" and the sync test's probe (a restarted old seat that the relay disagrees with sends its last entry, gets ORPHANED, and says "moved").
3. **A move is retried or mistyped** (double approval, the seat resends, a lost response, the relay behind the cell, wrong PINs).
   - Expected: exactly one keyEpoch-2 binding; the same grant every time; BEHIND is retried, not refused; 3 wrong PINs lock the candidate (423) even after a restart; the right PIN after the lock is still refused.
   - Pinned in Task 3: "Review Focus #3: the same move twice gets the same grant; three wrong PINs lock, across a restart"; in Task 4: "Review Focus #3: two approvals at once share one forward; a wrong PIN refuses the move and the seat can ask again" and "a PIN move waits for the invigilator; … BEHIND is retried; …".
4. **The laptop sleeps or the app crashes mid-exam** (lid closed, screen locked, battery died, crash-restart).
   - Expected: the timer does not run while suspended; a `gap` entry is journaled on resume and after a restart; credit is measured by the relay's clock and needs approval; two gaps → review; more than 30 min approved → re-test eligible, credit capped.
   - Pinned in Task 12: "Review Focus #4: suspend freezes activeMs; resume journals a gap with the wall pause; restart journals a restart gap" and Task 7: "Review Focus #4: credit is measured by rxWall, capped at 30 min; two gaps flag review; unapproved gaps are pending".
5. **The WAN flaps** (drops for 5 s, returns, drops again).
   - Expected: one RELAY_WAN_DOWN incident per episode, not a storm; it closes only after the link has been clear for `clearMs`; a drop within that window reopens nothing new; the ladder keeps its place.
   - Pinned in Task 6: "Review Focus #5: a flapping link keeps one incident until it has been clear for clearMs".

## Parallelism map

```
T1 Addendum C + /verify fix ─┬─► T2 ingest/forwarder ─────────────────────┐
                             ├─► T3 cell handover + events ───────────────┤
                             ├─► T4 relay handover + console ─────────────┤
                             ├─► T5 relay link + status ──────────────────┤
                             ├─► T6 incidents + CERT-In ──┐               ├─► T15 wiring ─┐
                             ├─► T7 time audit ───────────┼─► T10 ops ────┘               │
                             ├─► T8 status + outbox ──────┤   monitor+routes              ├─► T17 act3 + CI ─► T18 exit + demo
                             ├─► T9 archive + purge ──────┘                               │
                             ├─► T11 control room UI ─────────────────────────────────────┤
                             ├─► T12 seat journal/exam ─► T13 seat move + Electron ───────┤
                             ├─► T14 seat renderer ───────────────────────────────────────┤
                             └──────────────────────────► T16 tools (procs, stack, reset, chaos, seat-cli) ┘
```

| Wave | Tasks | Notes |
|---|---|---|
| 1 | T1 | Addendum C, the /verify fix, every shared type. Everything depends on it. |
| 2 | T2, T3, T4, T5, T6, T7, T8, T9, T11, T12, T14 | Eleven agents on disjoint files (see each task's **Files**). T3 fakes `StreamSnap`; T4 injects `head`; T11 and T14 code against the Task 1 types. |
| 3 | T10 (T6–T9), T13 (T12), T16 (T2 behaviour) | Disjoint: control ops server files, seat main, tools. |
| 4 | T15 (T2–T5, T9, T10) | `main.ts`, `control.ts` hook, `provision.ts`. |
| 5 | T17 (T13, T15, T16) | `tools/act3.ts`, CI. Needs ports (unsandboxed). |
| 6 | T18 | Exit check, ledger, threat model, demo. Packaged app only in test mode with the camera off. |

## Task table

| # | Task | Files (create / modify; tests) |
|---|---|---|
| 1 | Addendum C and the /verify fix; every shared type | core `handover.ts`, `ops.ts` (new); core `wire.ts`, `sheet.ts`, `journal.ts`, `verify.ts`, `selftest.ts`, `directory.ts`; server `sheet-export.ts`, `seal.ts`, `control.ts`, `main.ts`, `bindings.ts`, `verify-page.ts`, `verify-view.ts`, `verify.html`; seat `shared/ipc.ts`, `preload/index.ts`; `tools/sim-seat.ts`, `tools/gen-vectors-addendum-c.ts`, `fixtures/vectors/protocol-v1-addendum-c.json`; `docs/protocol-v1.md`; tests `core/test/addendum-c.test.ts`, `server/test/verify-certs.test.ts` |
| 2 | Ingest: rxWall, key epochs, the hard stop, the rebuild gate, events; the forwarder | `ingest.ts`, `store.ts`, `forward.ts`, `sheet-export.ts`; one line in `tools/swarm.ts`, `main.ts`, `test/forward.test.ts`; test `ingest-stage4.test.ts` |
| 3 | The cell's side of a move; events and stats routes | `handover.ts` (new), `bindings.ts`, `cell-routes.ts`, `stats.ts`, `fleet.ts`; tests `handover.test.ts`, `cell-routes.test.ts` (one expectation) |
| 4 | The relay's side of a move; the console | `relay-handover.ts` (new), `console.html`, `console.ts`, `console-view.ts`; tests `relay-handover.test.ts`, `console-view.test.ts` |
| 5 | The relay's link (SYNC_LAG), degrade chaos, the seats' status | `link.ts`, `relay-ops.ts` (new), `relay-routes.ts` (`Wan`); test `link.test.ts` |
| 6 | Incident rules, ladder, debounce; CERT-In draft | `incidents.ts`, `certin.ts` (new); test `incidents.test.ts` |
| 7 | The time audit | `time-audit.ts` (new); test `time-audit.test.ts` |
| 8 | Public status (no PII), notices, outbox | `status-view.ts`, `status.html`, `status-page.ts`, `comms.ts` (new); test `status-view.test.ts` |
| 9 | Archive to 2 stores, verify, signed purge | `archive.ts` (new); test `archive.test.ts` |
| 10 | Control's detection loop and routes | `ops-monitor.ts`, `ops-routes.ts` (new); test `ops-routes.test.ts` |
| 11 | The control room UI | `control.html`, `control-page.ts`, `control-view.ts`; test `control-view.test.ts` |
| 12 | Seat journal from a base; handover entry; pause/resume/restart gaps | seat `journal-store.ts`, `exam.ts`; test `exam-stage4.test.ts` |
| 13 | Seat move flow, status, moved; Electron wiring | seat `identity.ts`, `seat.ts`, `sync.ts`, `index.ts`; test `move.test.ts` |
| 14 | Seat screens: move, moving, moved, banner, credit | renderer `Gate.tsx`, `App.tsx`, `exam-state.ts`, `i18n.ts`, `styles.css`; test `exam-state.test.ts` |
| 15 | Wiring | `main.ts`, `control.ts` (`onFindings`), `tools/provision.ts`; tests `main.test.ts`, `provision.test.ts` |
| 16 | Tools | `tools/procs.ts`, `stack.ts`, `reset.ts`, `chaos.ts`, `seat-cli.ts` (new); test `tools-stage4.test.ts` |
| 17 | Act 3 end to end; CI | `tools/act3.ts` (new); `.github/workflows/server.yml` |
| 18 | Exit check, ledger, threat model, demo | `docs/claims-ledger.md`, `docs/threat-model.md`, `docs/evidence/stage4-*`; memory |

(Server paths are under `apps/server/src` and `apps/server/test`; seat paths under `apps/seat/src/main`, `apps/seat/src/renderer/src` and `apps/seat/test`; core under `packages/core/src` and `packages/core/test`.)

Files touched by more than one task (never in the same wave): `apps/server/src/main.ts` (T1 → T2 → T15), `apps/server/src/sheet-export.ts` (T1 → T2), `apps/server/src/bindings.ts` (T1 → T3), `apps/server/src/control.ts` (T1 → T15), `tools/sim-seat.ts` (T1 only), `tools/swarm.ts` (T2 only).

---
### Task 1: Addendum C and the /verify fix — certificates in the proof, every Stage 4 contract, vectors

This is the Stage 3 plan's flagged fix, done first: the proof carries the candidate's bind certificates and the cell's key certificate, so `/verify` pins only the exam authority key. It also lands every type the other tasks share.

**Files:**
- Create: `packages/core/src/handover.ts`, `packages/core/src/ops.ts`
- Modify: `packages/core/src/wire.ts` (`rx`, reject codes, `submitted`, `parseHandoverReq`), `packages/core/src/sheet.ts` (`rx`, `binds`, `cells`), `packages/core/src/journal.ts` (`start`), `packages/core/src/verify.ts` (C.1), `packages/core/src/selftest.ts` (C vectors), `packages/core/src/directory.ts` (`ops`, `lastSeen`, `rebuild`)
- Modify: `apps/server/src/sheet-export.ts` (`binds`), `apps/server/src/seal.ts` (`proofFor(…, cells)`), `apps/server/src/control.ts` (`cells`), `apps/server/src/main.ts` (pass both), `apps/server/src/bindings.ts` (`forCand`), `apps/server/src/verify-page.ts`, `apps/server/src/verify-view.ts`, `apps/server/src/verify.html`
- Modify: `apps/seat/src/shared/ipc.ts`, `apps/seat/src/preload/index.ts`
- Modify: `tools/sim-seat.ts` (`rekey`)
- Create: `tools/gen-vectors-addendum-c.ts` and the generated `fixtures/vectors/protocol-v1-addendum-c.json`
- Modify: `docs/protocol-v1.md` (append §16)
- Test: `packages/core/test/addendum-c.test.ts`, `apps/server/test/verify-certs.test.ts`

**Interfaces:**
- Consumes: `canon`, `bytes`, `box` (`sealBox`, `openBox`, `nobleBox`), `enrol` (`msg`, `bindArray`, `checkWireBind`, `cellKeyArray`, `cellKeyId`, `isP256Pub`), `protocol`, `sig`, `journal`, `log`, `merkle`; `Bindings`, `createIngest`, `shiftExport`, `seal`, `proofFor`; `SimSeat`, `simBindReq`.
- Produces: everything in Global Constraints → "Shared types", plus `Bindings.forCand(cand): WireBind[]` (every epoch, oldest first), `SimSeat.rekey(keyEpoch, seat)`, `ExportOpts.binds`, `ControlOpts.cells`, `goldenSelfTest(V, A, C?)`.

- [ ] **Step 1: Write the failing core test**

`packages/core/test/addendum-c.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { hexToBytes, toHex } from '../src/bytes.ts';
import { canon } from '../src/canon.ts';
import type { KeysFile } from '../src/dev.ts';
import { bindArray, msg, type Bind } from '../src/enrol.ts';
import {
  checkCellCert, checkGrant, epochAt, grantArray, handoverArray, openHandoverPin, openRestore, purgeArray, respHash, sealRestore,
  type CellCert, type HandoverGrant,
} from '../src/handover.ts';
import { nativeBox, signer, verifier } from '../src/node.ts';
import type { Proof } from '../src/sheet.ts';
import { goldenSelfTest } from '../src/selftest.ts';
import { nobleVerifier } from '../src/sig.ts';
import { parseProof, verifyProof } from '../src/verify.ts';
import { parseHandoverReq, parseSyncReq } from '../src/wire.ts';

const json = (f: string) => JSON.parse(readFileSync(new URL(`../../../fixtures/${f}`, import.meta.url), 'utf8'));
const keys = json('keys.json') as KeysFile;
const V = json('vectors/protocol-v1.json'), A = json('vectors/protocol-v1-addendum-a.json'), C = json('vectors/protocol-v1-addendum-c.json');
const authPub = hexToBytes(keys.authority.pub), cellPub = hexToBytes(keys.cells[0].pub), cellPriv = hexToBytes(keys.cells[0].priv);
const onlyAuthority = { authority: keys.authority.pub, cells: {}, seats: {} };
const both = (pub: Uint8Array) => [verifier(pub), nobleVerifier(pub)];
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const ctx = { exam: 'DEMO-2026', shift: 'S1', attempt: 1, cand: 'C0001' };
const signC = signer({ priv: cellPriv, pub: cellPub });

test('C.2 claim, C.4 keyEpoch-2 bind and C.5 grant: canonical text recomputes; signatures verify natively and with noble', () => {
  assert.equal(canon(handoverArray(C.claim.in)), C.claim.text);
  for (const v of both(hexToBytes(keys.seats[0].pub))) assert.equal(v(msg(handoverArray(C.claim.in)), hexToBytes(C.claim.sig)), true);
  assert.equal(canon(grantArray(C.grant.in)), C.grant.text);
  for (const v of both(cellPub)) assert.equal(v(msg(grantArray(C.grant.in)), hexToBytes(C.grant.sig)), true);
  assert.equal(canon(bindArray(C.bind2.in as Bind)), C.bind2.text);
  for (const v of both(cellPub)) assert.equal(v(msg(bindArray(C.bind2.in as Bind)), hexToBytes(C.bind2.sig)), true);
  assert.equal(canon(purgeArray(C.purge.in)), C.purge.text);
  for (const v of both(authPub)) assert.equal(v(msg(purgeArray(C.purge.in)), hexToBytes(C.purge.sig)), true);
});

test('C.3 and C.5 boxes: the PIN opens only at the cell for that seat and key; the restore opens only with the new seat key', () => {
  assert.equal(openHandoverPin(cellPriv, ctx, C.pin.seatId, keys.seats[1].pub, C.pin.box, nativeBox), C.pin.pin);
  assert.throws(() => openHandoverPin(cellPriv, ctx, 'CEN042-S09', keys.seats[1].pub, C.pin.box), 'another seat id is another box');
  assert.throws(() => openHandoverPin(cellPriv, ctx, C.pin.seatId, keys.seats[2].pub, C.pin.box), 'another new key is another box');
  assert.equal(respHash(C.responses.rows), C.responses.hash);
  assert.deepEqual(openRestore(hexToBytes(keys.seats[1].priv), ctx, C.restore.keyEpoch, C.restore.fromSeq, C.restore.box), C.responses.rows);
  assert.throws(() => openRestore(hexToBytes(keys.seats[2].priv), ctx, C.restore.keyEpoch, C.restore.fromSeq, C.restore.box), 'another seat cannot open it');
});

test('checkGrant: the new seat accepts the grant; swapped answers, another key, another cell or an edited grant are refused', () => {
  const g: HandoverGrant = { bind: { cert: C.bind2.text, sig: C.bind2.sig, cell: 'cell-1', pinBox: '' }, grant: C.grant.in, sig: C.grant.sig, restore: C.restore.box, via: 'pin', approvedBy: 'INV-42-A' };
  const want = { ...ctx, seatId: C.bind2.in.seatId as string, pub: keys.seats[1].pub };
  const priv = hexToBytes(keys.seats[1].priv);
  assert.deepEqual(checkGrant(g, want, cellPub, priv).responses, C.responses.rows);
  const other = sealRestore(hexToBytes(keys.seats[1].pub), ctx, 2, C.restore.fromSeq, [['I01', 'A', 'D']], nativeBox);
  assert.throws(() => checkGrant({ ...g, restore: other }, want, cellPub, priv), /do not match the signed hash/);
  assert.throws(() => checkGrant(g, { ...want, pub: keys.seats[2].pub }, cellPub, priv), /pub/);
  assert.throws(() => checkGrant(g, want, hexToBytes(keys.cells[1].pub), priv), /cell signature/);
  assert.throws(() => checkGrant({ ...g, grant: { ...g.grant, creditedMs: 1 } }, want, cellPub, priv), /cell signature/);
});

test('C.1 cell certificates and C.4 epochAt', () => {
  const auth = verifier(authPub);
  for (const c of C.cells as CellCert[]) assert.equal(toHex(checkCellCert(c, 'DEMO-2026', auth)), c.pub);
  assert.throws(() => checkCellCert({ ...C.cells[0], keyId: C.cells[1].keyId }, 'DEMO-2026', auth), /keyId/);
  assert.throws(() => checkCellCert(C.cells[0], 'OTHER-2026', auth), /not certified/);
  const e = [{ keyEpoch: 1, fromSeq: 0 }, { keyEpoch: 2, fromSeq: 5 }];
  assert.deepEqual([1, 5, 6, 99].map((s) => epochAt(e, s)), [1, 1, 2, 2]);
  assert.equal(epochAt([], 1), undefined);
});

test('C.1 the Stage 3 fix: an enrolled, moved candidate\'s proof verifies with only the authority key pinned', () => {
  const p = parseProof(C.proof);
  for (const mk of [verifier, nobleVerifier]) {
    const r = verifyProof(p, C.forms, onlyAuthority, undefined, mk);
    assert.equal(r.ok, true, JSON.stringify(r.checks.filter((c) => !c.ok)));
    assert.match(r.checks.find((c) => c.name === 'keys')!.detail, /2 key epoch\(s\).*certified by cell-1/);
  }
});

test('C.1 negatives: no cell certificate, a self-made certificate, another candidate, and an old key signing after the move', () => {
  const row = (p: Proof, name: string) => verifyProof(p, C.forms, onlyAuthority, undefined, verifier).checks.find((c) => c.name === name)!;
  const noCells = clone(C.proof) as Proof; delete noCells.cells;
  assert.equal(row(noCells, 'keys').ok, false);
  assert.equal(row(noCells, 'receipt').ok, false, 'the countersigning cell is not certified either');
  const forged = clone(C.proof) as Proof;                                     // the cell certifies itself: not the authority
  forged.cells![0].cert = toHex(signC(msg(['cellkey', 'DEMO-2026', 'cell-1', forged.cells![0].keyId, forged.cells![0].pub])));
  assert.equal(row(forged, 'keys').ok, false);
  const other = clone(C.proof) as Proof; other.sheet.ctx.cand = 'C0002';
  assert.match(row(other, 'keys').detail, /C0001/);
  const late = clone(C.proof) as Proof;                                       // keyEpoch 2 certified from seq 6, not 5
  const b2 = { ...C.bind2.in, fromSeq: 6 } as Bind;
  late.sheet.binds![1] = { cert: canon(bindArray(b2)), sig: toHex(signC(msg(bindArray(b2)))), cell: 'cell-1', pinBox: '' };
  assert.equal(row(late, 'keys').ok, true);
  assert.match(row(late, 'chain').detail, /entry 6: sig — signed at keyEpoch 2, but seq 6 belongs to keyEpoch 1/);
});

test('/verify self-test: every golden vector, now with Addendum C, passes with noble alone', () => {
  const st = goldenSelfTest(V, A, C);
  assert.deepEqual(st.fail, []);
  assert.ok(st.pass >= 35, `only ${st.pass} checks`);
});

test('wire: WireEntry.rx is optional and must be a count; parseHandoverReq takes a PIN or an old-key proof and nothing else', () => {
  const e = { line: 'x', env: 'AAAA' };
  assert.deepEqual(parseSyncReq({ entries: [{ ...e, rx: 5 }] }).entries, [{ ...e, rx: 5 }]);
  assert.deepEqual(parseSyncReq({ entries: [e] }).entries, [e]);
  assert.throws(() => parseSyncReq({ entries: [{ ...e, rx: -1 }] }), /rx/);
  const base = { ...ctx, seatId: 'CEN042-S02', pub: keys.seats[1].pub, attestHash: 'a'.repeat(64), pinBox: 'ab' };
  assert.deepEqual(parseHandoverReq({ ...base, proof: { via: 'pin', pin: 'cd', extra: 1 } }).proof, { via: 'pin', pin: 'cd' });
  const key = { via: 'key', keyEpoch: 1, fromSeq: 5, fromHead: 'b'.repeat(64), sig: 'c'.repeat(128) };
  assert.deepEqual(parseHandoverReq({ ...base, proof: key }).proof, key);
  assert.throws(() => parseHandoverReq({ ...base, proof: { via: 'key', keyEpoch: 0, fromSeq: 5, fromHead: 'b'.repeat(64), sig: 'c'.repeat(128) } }), /proof/);
  assert.throws(() => parseHandoverReq({ ...base, pub: 'nope', proof: { via: 'pin', pin: 'cd' } }), /pub/);
});
```

- [ ] **Step 2: Write the failing server test (the fix through the real cell code)**

`apps/server/test/verify-certs.test.ts`:
```ts
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { hexToBytes, toHex } from '@saakshi/core/bytes';
import { cellKey, devForm, devPseud, type KeysFile } from '@saakshi/core/dev';
import { cellKeyArray, cellKeyId, msg } from '@saakshi/core/enrol';
import { newKeyPair, signer } from '@saakshi/core/node';
import { formsOf } from '@saakshi/core/sheet';
import { verifyProof } from '@saakshi/core/verify';
import { Bindings } from '../src/bindings.ts';
import { createIngest } from '../src/ingest.ts';
import { proofFor, seal } from '../src/seal.ts';
import { shiftExport } from '../src/sheet-export.ts';
import { openDb } from '../src/store.ts';
import { viewOf } from '../src/verify-view.ts';
import { FORMS, SimSeat } from '../../../tools/sim-seat.ts';
import { simBindReq } from '../../../tools/sim-custody.ts';

const keys = JSON.parse(readFileSync(new URL('../../../fixtures/keys.json', import.meta.url), 'utf8')) as KeysFile;
const cell = cellKey(keys, 'cell-1'), forms = formsOf(FORMS);
const authority = { priv: hexToBytes(keys.authority.priv), pub: hexToBytes(keys.authority.pub) };
const onlyAuthority = { authority: keys.authority.pub, cells: {}, seats: {} };
const cert = (id: string) => {
  const c = keys.cells.find((x) => x.id === id)!, keyId = cellKeyId(hexToBytes(c.pub));
  return { id, keyId, pub: c.pub, cert: toHex(signer(authority)(msg(cellKeyArray({ exam: 'DEMO-2026', cellId: id, keyId, pub: c.pub })))) };
};

test('the Stage 3 fix through the real cell: an enrolled candidate\'s proof verifies with only the authority key pinned', async () => {
  const { db } = openDb(':memory:');
  const b = new Bindings(db, { exam: 'DEMO-2026', shift: 'S1', cell });
  const n = createIngest({ mode: 'cell', db, fresh: false, seatKey: b.seatKey, acceptBinds: (x) => b.acceptAll(x), cell, forms, formOf: devForm, pseud: devPseud });
  const key = newKeyPair();
  const e = b.enrol(simBindReq('C0001', key, cell.pub, 'CEN042-S01'), true);
  if (!e.ok) throw new Error(e.error);
  const seat = new SimSeat(keys, 'C0001', cell.pub, 1, key);
  seat.add(21); seat.submit();
  const r = await n.sync({ entries: seat.entries, streams: [{ ...seat.ctx, head: seat.head }] });
  expect(r !== 'REBUILDING' && r.rejected).toEqual([]);
  const exp = shiftExport(db, { exam: 'DEMO-2026', shift: 'S1', cell: 'cell-1', formOf: devForm, pseud: devPseud, seatKey: b.seatKey, binds: (c) => b.forCand(c) });
  expect(exp.sheets[0].binds?.length).toBe(1);
  expect(exp.sheets[0].binds![0].pinBox).toBe('');                               // the proof never carries the sealed PIN record
  const { rec } = seal(undefined, exp, { authority, trust: { ...onlyAuthority, seats: { 'C0001/1': toHex(key.pub) } }, pseud: devPseud });
  const proof = proofFor(rec, exp.sheets[0], [cert('cell-1')])!;
  const v = verifyProof(proof, forms, onlyAuthority);
  expect(v.checks.filter((c) => !c.ok)).toEqual([]);
  expect(viewOf(v).rows[0].detail).toMatch(/certified by cell-1/);
  const before = verifyProof({ ...proof, cells: undefined }, forms, onlyAuthority);   // exactly the Stage 3 symptom
  expect(before.checks.find((c) => c.name === 'keys')!.ok).toBe(false);
  n.close();
});
```

- [ ] **Step 3: Run both to verify they fail**

Run: `node --test packages/core/test/addendum-c.test.ts; bun test --timeout 60000 apps/server/test/verify-certs.test.ts`
Expected: FAIL — `Cannot find module '../src/handover.ts'` and the missing vector file; `binds` is not an `ExportOpts` field.

- [ ] **Step 4: `packages/core/src/handover.ts`**

```ts
// Addendum C (Stage 4): moving a candidate to another seat. The old key's signed claim, or the candidate's PIN sealed to the cell
// plus the invigilator's approval; the cell's keyEpoch E+1 bind certificate and its signed grant; the answers restored sealed to the
// new seat's key. Also the cell key certificate check /verify uses, epochAt, and the purge order. Browser-safe: seat and server pass
// nativeBox / verifier from node.ts.
import { sha256 } from '@noble/hashes/sha2.js';
import { hexToBytes, toHex, utf8 } from './bytes.ts';
import { nobleBox, openBox, sealBox, type BoxKeys } from './box.ts';
import { canon, parseCanon, type Canon } from './canon.ts';
import { cellKeyArray, cellKeyId, checkWireBind, isP256Pub, msg, type Bind, type WireBind } from './enrol.ts';
import { STATES, type Body, type Ctx, type Response, type State } from './protocol.ts';
import { nobleVerifier, type Verify } from './sig.ts';

const HEX64 = /^[0-9a-f]{64}$/, SIG = /^[0-9a-f]{128}$/, PIN = /^[0-9]{6}$/;
const text = (b: Uint8Array): string => new TextDecoder('utf-8', { fatal: true }).decode(b);

/** C.2 — signed by the key of `keyEpoch`, the OLD epoch. */
export interface HandoverClaim extends Ctx { keyEpoch: number; fromSeq: number; fromHead: string; newPub: string }
export const handoverArray = (h: HandoverClaim): Canon[] => ['handover', h.exam, h.shift, h.attempt, h.cand, h.keyEpoch, h.fromSeq, h.fromHead, h.newPub];

/** C.5 — signed by the cell. `keyEpoch` is the NEW epoch. */
export interface Grant extends Ctx { keyEpoch: number; fromSeq: number; fromHead: string; activeMs: number; creditedMs: number; respHash: string }
export const grantArray = (g: Grant): Canon[] =>
  ['grant', g.exam, g.shift, g.attempt, g.cand, g.keyEpoch, g.fromSeq, g.fromHead, g.activeMs, g.creditedMs, g.respHash];

const respText = (rs: Response[]): string => canon(['responses', rs.map((r) => [r[0], r[1], r[2]])]);
export const respHash = (rs: Response[]): string => toHex(sha256(utf8(respText(rs))));
export const restoreInfo = (c: Ctx, keyEpoch: number, fromSeq: number): Canon[] => ['saakshi-restore', 1, c.exam, c.shift, c.attempt, c.cand, keyEpoch, fromSeq];
export const handoverPinInfo = (c: Ctx, seatId: string, newPub: string): Canon[] => ['saakshi-handover-pin', 1, c.exam, c.shift, c.attempt, c.cand, seatId, newPub];

export function sealRestore(newPub: Uint8Array, c: Ctx, keyEpoch: number, fromSeq: number, rs: Response[], k: BoxKeys = nobleBox): string {
  return toHex(sealBox(newPub, restoreInfo(c, keyEpoch, fromSeq), utf8(respText(rs)), k));
}
export function openRestore(priv: Uint8Array, c: Ctx, keyEpoch: number, fromSeq: number, box: string, k: BoxKeys = nobleBox): Response[] {
  const a = parseCanon(text(openBox(priv, restoreInfo(c, keyEpoch, fromSeq), hexToBytes(box), k)));
  if (a.length !== 2 || a[0] !== 'responses' || !Array.isArray(a[1])) throw new Error('restore: not a responses list');
  return (a[1] as Canon[]).map((r): Response => {
    if (!Array.isArray(r) || r.length !== 3 || typeof r[0] !== 'string' || typeof r[2] !== 'string' || !(STATES as readonly string[]).includes(r[1] as string))
      throw new Error('restore: bad row');
    return [r[0], r[1] as State, r[2]];
  });
}

export function sealHandoverPin(cellPub: Uint8Array, c: Ctx, seatId: string, newPub: string, pin: string, k: BoxKeys = nobleBox): string {
  if (!PIN.test(pin)) throw new Error('the PIN must be exactly 6 digits');
  return toHex(sealBox(cellPub, handoverPinInfo(c, seatId, newPub), utf8(pin), k));
}
export function openHandoverPin(cellPriv: Uint8Array, c: Ctx, seatId: string, newPub: string, box: string, k: BoxKeys = nobleBox): string {
  const pin = text(openBox(cellPriv, handoverPinInfo(c, seatId, newPub), hexToBytes(box), k));
  if (!PIN.test(pin)) throw new Error('handover: the box does not hold a PIN');
  return pin;
}

export type HandoverProof = { via: 'pin'; pin: string } | { via: 'key'; keyEpoch: number; fromSeq: number; fromHead: string; sig: string };
/** Seat → relay → cell. pinBox: the new seat's B.5 record sealed to the cell (it carries the PIN to the next move). */
export interface HandoverReq extends Ctx { seatId: string; pub: string; attestHash: string; pinBox: string; proof: HandoverProof }
export interface HandoverApproval { by: string; at: number }
export interface HandoverGrant { bind: WireBind; grant: Grant; sig: string; restore: string; via: 'pin' | 'key'; approvedBy: string }

/** The new seat's check (C.5). Throws on any fault; returns the restored answers. */
export function checkGrant(g: HandoverGrant, want: Ctx & { seatId: string; pub: string }, cellPub: Uint8Array, seatPriv: Uint8Array,
  mk: (pub: Uint8Array) => Verify = nobleVerifier, k: BoxKeys = nobleBox): { bind: Bind; grant: Grant; responses: Response[] } {
  const bind = checkWireBind(g.bind, cellPub, mk);
  for (const f of ['exam', 'shift', 'attempt', 'cand', 'seatId', 'pub'] as const) if (bind[f] !== want[f]) throw new Error(`grant: the certificate's ${f} is not this seat's`);
  const gr = g.grant;
  if (!gr || gr.exam !== bind.exam || gr.shift !== bind.shift || gr.attempt !== bind.attempt || gr.cand !== bind.cand || gr.keyEpoch !== bind.keyEpoch || gr.fromSeq !== bind.fromSeq)
    throw new Error('grant: it does not match the certificate');
  if (!HEX64.test(gr.fromHead ?? '') || !HEX64.test(gr.respHash ?? '') || !SIG.test(g.sig ?? '') || !mk(cellPub)(msg(grantArray(gr)), hexToBytes(g.sig)))
    throw new Error('grant: the cell signature does not verify');
  const responses = openRestore(seatPriv, want, gr.keyEpoch, gr.fromSeq, g.restore, k);
  if (respHash(responses) !== gr.respHash) throw new Error('grant: the restored answers do not match the signed hash');
  return { bind, grant: gr, responses };
}

/** C.1 — a B.2 cell key certificate, as a proof carries it. Returns the cell's public key; throws unless the authority signed it. */
export interface CellCert { id: string; keyId: string; pub: string; cert: string }
export function checkCellCert(c: CellCert, exam: string, authority: Verify): Uint8Array {
  if (typeof c?.id !== 'string' || typeof c.pub !== 'string' || !isP256Pub(c.pub) || typeof c.cert !== 'string' || !SIG.test(c.cert)) throw new Error('cell certificate: bad shape');
  const pub = hexToBytes(c.pub);
  if (cellKeyId(pub) !== c.keyId) throw new Error(`cell certificate: keyId does not match ${c.id}'s key`);
  if (!authority(msg(cellKeyArray({ exam, cellId: c.id, keyId: c.keyId, pub: c.pub })), hexToBytes(c.cert))) throw new Error(`cell certificate: ${c.id} is not certified by the exam authority`);
  return pub;
}

/** C.4 — the epoch that signs `seq`: the highest keyEpoch whose fromSeq < seq. */
export interface Epoch { keyEpoch: number; fromSeq: number }
export function epochAt(epochs: Epoch[], seq: number): number | undefined {
  let e: number | undefined;
  for (const x of epochs) if (x.fromSeq < seq && (e === undefined || x.keyEpoch > e)) e = x.keyEpoch;
  return e;
}

/** What a cell knows about one stream when it grants a move (Stage 4 contract; ingest implements it). */
export interface StreamSnap { head: number; headH: string; activeMs: number; pending: number; submitted: boolean; bodies: Body[]; rxAt(seq: number): number }

/** C.10 — authority-signed; a relay deletes a shift's entries only on one. */
export interface PurgeOrder { exam: string; shift: string; sthId: string; ts: number }
export const purgeArray = (p: PurgeOrder): Canon[] => ['purge', p.exam, p.shift, p.sthId, p.ts];
```

- [ ] **Step 5: `packages/core/src/ops.ts`**

```ts
// Stage 4 (plan §3.6, §3.7, §3.10): operating parameters and the shapes that cross between cells, relays, control, the control page,
// the public status page and the seat. Types and constants only; browser-safe.
import type { TileTone } from './directory.ts';
import type { NodeState } from './wire.ts';

export type Severity = 'P0' | 'P1' | 'P2' | 'P3';
export const RUNGS = ['invigilator', 'superintendent', 'control', 'regulator'] as const;
export type Rung = (typeof RUNGS)[number];

export interface Ops {
  demo: boolean;
  /** Credited gaps at most this (plan §3.6: 30 min); beyond it, re-test eligible. */
  gapCapMs: number;
  /** Hard stop slack after D_i + gap cap. */
  slackMs: number;
  /** Unexplained wall time the time audit tolerates (idle cadence + LAN latency). */
  gapTolMs: number;
  /** SEAT_SILENT after this (plan §3.10: 30 s). */
  silentMs: number;
  /** A state incident closes only after its condition has been clear this long (debounce). */
  clearMs: number;
  /** KEY_RELEASE_DELAY: centres still locked this long after the release. */
  releaseDelayMs: number;
  /** A rebuilding cell goes LIVE this long after the last replay, even if a relay never replays. */
  rebuildGraceMs: number;
  /** Ack timer per rung; 0 = never escalates. */
  ladderMs: Record<Severity, number>;
  /** Wrong handover PINs before the candidate is locked. */
  pinTries: number;
  /** Integrity codes (meta[0] of an `integrity` entry) that are INTEGRITY_CRITICAL. Stage 5 emits them. */
  criticalIntegrity: string[];
}
export const OPS: Ops = {
  demo: false, gapCapMs: 30 * 60_000, slackMs: 10 * 60_000, gapTolMs: 120_000, silentMs: 30_000, clearMs: 30_000,
  releaseDelayMs: 5 * 60_000, rebuildGraceMs: 60_000, ladderMs: { P0: 120_000, P1: 300_000, P2: 900_000, P3: 0 }, pinTries: 3,
  criticalIntegrity: ['remote-session', 'capture-excluded', 'blocklisted', 'vm'],
};
/** The signed DEMO policy of plan §3.10: 10 s ack timers, short debounce and delays. */
export const OPS_DEMO: Ops = { ...OPS, demo: true, clearMs: 5_000, releaseDelayMs: 10_000, rebuildGraceMs: 15_000, ladderMs: { P0: 10_000, P1: 10_000, P2: 10_000, P3: 0 } };
export const opsOf = (x?: Partial<Ops>): Ops => ({ ...OPS, ...x, ladderMs: { ...OPS.ladderMs, ...x?.ladderMs } });

export type IncidentKind = 'CELL_DOWN' | 'CENTRE_OUTAGE' | 'SEAT_SILENT' | 'RELAY_WAN_DOWN' | 'SYNC_LAG' | 'INTEGRITY_CRITICAL' | 'TAMPER'
  | 'BAD_SUBMISSION' | 'KEY_RELEASE_DELAY' | 'HANDOVER' | 'GAP' | 'ORPHANED' | 'LATE';
/** answersLost: null while it cannot be known yet (a cell still down or rebuilding). */
export interface Blast { cells: string[]; centres: string[]; candidates: number; answersLost: number | null }
export interface Incident {
  id: string; kind: IncidentKind; severity: Severity; key: string; title: string; detail: string; blast: Blast;
  openedAt: number; updatedAt: number; resolvedAt?: number;
  rung: number; ladder: { rung: Rung; at: number }[]; ack?: { by: string; rung: Rung; at: number };
  /** Path of the CERT-In draft, relative to control's DIR. */
  certIn?: string; cand?: string; data: Record<string, string | number>;
}
export type EventCode = 'BAD_SUBMISSION' | 'FORK' | 'ORPHANED' | 'LATE' | 'HANDOVER' | 'GAP' | 'INTEGRITY';
/** One row of a cell's evidence table, as GET /v1/events serves it. data: the parsed JSON reason, when it is one. */
export interface CellEvent { id: number; at: number; cell: string; code: EventCode; cand: string; centre: string; seq: number; reason: string; data?: Record<string, string | number> }

/** One relay → cell round, as the forwarder reports it. */
export interface RoundSample { at: number; ms: number; ok: boolean; backlog: number; replaying: boolean }
export interface LinkView {
  centre: string; up: boolean; cut: boolean; degraded: boolean; rttMs: number; errRate: number; backlog: number; lastContactAt: number;
  risk: 'ok' | 'warn' | 'down'; reason: string; etaMs?: number; cell: NodeState | 'unreachable';
}
/** What a relay tells its seats (the in-exam banner). */
export interface CentreStatus { link: 'up' | 'degraded' | 'down'; cell: NodeState | 'unreachable'; etaMs?: number; at: number }

export interface Approval { cand: string; seq: number; by: string; at: number }
export interface GapLine { seq: number; kind: 'gap' | 'handover'; cause: string; pausedMs: number; measuredMs: number; approved: boolean; approvedBy: string }
export type TimeFlag = 'REVIEW_GAPS' | 'RETEST_ELIGIBLE' | 'PENDING_APPROVAL' | 'UNEXPLAINED_TIME';
export interface TimeRow {
  cand: string; wallMs: number; activeMs: number; unaccountedMs: number; gaps: GapLine[]; creditedMs: number; flags: TimeFlag[];
  changedAfterMove: { item: string; q: number }[];
}

export interface Notice {
  id: string; incident: string; kind: IncidentKind; centres: string[]; audience: number; en: string; hi: string;
  channels: ('sms' | 'email' | 'digilocker')[]; draftedAt: number; approvedBy?: string; approvedAt?: number;
}
export interface PublicStatus {
  exam: string; shift: string; at: number; summary: { en: string; hi: string };
  centres: { centre: string; tone: TileTone; en: string; hi: string }[];
  incidents: { kind: IncidentKind; severity: Severity; since: number; centres: string[]; answersLost: number | null; en: string; hi: string }[];
  notices: { at: number; en: string; hi: string }[];
}

export interface StoreReport { store: string; path: string; sha256: string; ok: boolean; detail: string }
export interface ArchiveReport { exam: string; shift: string; size: number; root: string; stores: StoreReport[]; ok: boolean; writtenMs?: number; verifyMs: number }
```

- [ ] **Step 6: The small core edits**

`packages/core/src/directory.ts`:
```ts
import type { Ops } from './ops.ts';
// Directory: add
  /** Stage 4: operating parameters (tools/provision.ts --demo writes OPS_DEMO). */
  ops?: Ops;
// CentreStats: add
  /** Stage 4: the last time this centre's relay reached the cell (ms), 0 if never. */
  lastSeen?: number;
// CellStats: add
  /** Stage 4: while REBUILDING, how many relays have replayed of how many it waits for. */
  rebuild?: { done: number; expected: number };
// FleetView.cells element type becomes:
  cells: { id: string; state: NodeState | 'DOWN'; entries: number; rebuild?: { done: number; expected: number } }[];
```

`packages/core/src/wire.ts`:
```ts
import type { HandoverProof, HandoverReq } from './handover.ts';
/** One journal entry on the wire: the §11 signed line, the §8 envelope (padded base64), and — relay → cell only — the relay's rxWall (C.7). */
export interface WireEntry { line: string; env: string; rx?: number }
export type RejectCode = 'BAD_SUBMISSION' | 'FORK' | 'ORPHANED' | 'LATE';
// StreamView: add
  /** Stage 4: the chain ends in a submit. */
  submitted?: true;

// parseSyncReq — the entries map becomes:
    entries: entries.map((e, i) => {
      if (!isObj(e) || typeof e.line !== 'string' || e.line.length > LIMITS.line || typeof e.env !== 'string'
        || e.env.length > LIMITS.env || e.env.length % 4 !== 0 || !B64.test(e.env)) throw new Error(`sync: entries[${i}] must be {line, env: base64}`);
      if (e.rx !== undefined && !nat(e.rx)) throw new Error(`sync: entries[${i}].rx must be a count of ms`);
      return e.rx === undefined ? { line: e.line, env: e.env } : { line: e.line, env: e.env, rx: e.rx };
    }),

/** Validate an untrusted handover request (seat → relay → cell, Addendum C.2/C.3); returns a clean copy. */
export function parseHandoverReq(x: unknown): HandoverReq {
  if (!isObj(x)) throw new Error('handover: body must be an object');
  const { exam, shift, attempt, cand, seatId, pub, attestHash, pinBox, proof } = x;
  if (!field(exam) || !field(shift) || !nat(attempt) || !field(cand) || !field(seatId)) throw new Error('handover: need exam, shift, attempt, cand, seatId');
  if (typeof pub !== 'string' || !/^04[0-9a-f]{128}$/.test(pub)) throw new Error('handover: pub must be a 65-byte uncompressed P-256 key in hex');
  if (typeof attestHash !== 'string' || !/^[0-9a-f]{64}$/.test(attestHash)) throw new Error('handover: attestHash must be 64 hex');
  if (typeof pinBox !== 'string' || pinBox.length > LIMITS.pinBox || !/^[0-9a-f]+$/.test(pinBox)) throw new Error('handover: pinBox must be hex');
  let p: HandoverProof;
  if (isObj(proof) && proof.via === 'pin' && typeof proof.pin === 'string' && proof.pin.length <= LIMITS.pinBox && /^[0-9a-f]+$/.test(proof.pin)) p = { via: 'pin', pin: proof.pin };
  else if (isObj(proof) && proof.via === 'key' && nat(proof.keyEpoch) && proof.keyEpoch >= 1 && nat(proof.fromSeq)
    && typeof proof.fromHead === 'string' && /^[0-9a-f]{64}$/.test(proof.fromHead) && typeof proof.sig === 'string' && /^[0-9a-f]{128}$/.test(proof.sig))
    p = { via: 'key', keyEpoch: proof.keyEpoch, fromSeq: proof.fromSeq, fromHead: proof.fromHead, sig: proof.sig };
  else throw new Error('handover: proof must be {via:"pin", pin} or {via:"key", keyEpoch, fromSeq, fromHead, sig}');
  return { exam, shift, attempt, cand, seatId, pub, attestHash, pinBox, proof: p };
}
```

`packages/core/src/sheet.ts`:
```ts
import type { WireBind } from './enrol.ts';
import type { CellCert } from './handover.ts';
export interface SheetEntry { line: string; salt: string; body: Canon[]; /** Addendum C.7: [relay rxWall, cell rxWall]. */ rx?: [number, number] }
// ResponseSheet: add  /** Addendum C.1: the candidate's bind certificates, every epoch (pinBox ''). */ binds?: WireBind[];
// Proof: add          /** Addendum C.1: the certificates of the cells that signed binds or the receipt. */ cells?: CellCert[];
```

`packages/core/src/journal.ts` — `verifyChainKeyed` gets a start (a chain may continue from a head, Addendum C.6):
```ts
export function verifyChainKeyed(c: Ctx, lines: string[], keyFor: (keyEpoch: number) => Verify | undefined,
  start: { seq: number; head: string } = { seq: 0, head: genesisPrev(c) }): ChainResult {
  let prev = start.head;
  for (let i = 0; i < lines.length; i++) {
    // … unchanged down to the seq check, which becomes:
    if (h.seq !== start.seq + i + 1) return fail('seq', `expected seq ${start.seq + i + 1}, found ${h.seq}`);
    // … rest unchanged
  }
  return { ok: true, head: prev, count: lines.length };
}
```

- [ ] **Step 7: `packages/core/src/verify.ts` — Addendum C.1**

Add imports and `certifiedCells`, and replace step 1 (keys), the tail of step 2 (chain) and the receipt key lookup in `verifySheet`; pass `p.cells` in `verifyProof`; accept the new optional fields in `parseProof`:
```ts
import { checkWireBind, type Bind } from './enrol.ts';
import { checkCellCert, epochAt, type CellCert, type Epoch } from './handover.ts';

/** Addendum C.1: the pinned DEV cells, plus every cell whose key certificate the pinned authority signed. */
export function certifiedCells(exam: string, cells: CellCert[] | undefined, trust: Trust, mkVerify: MkVerify = nobleVerifier): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>(Object.entries(trust.cells).map(([id, pub]) => [id, hexToBytes(pub)]));
  const authority = mkVerify(hexToBytes(trust.authority));
  for (const c of cells ?? []) { try { out.set(c.id, checkCellCert(c, exam, authority)); } catch { /* not certified: not trusted */ } }
  return out;
}

export function verifySheet(sheet: ResponseSheet, forms: Forms, trust: Trust, mkVerify: MkVerify = nobleVerifier, cells?: CellCert[]): SheetReport {
  // … ctx, checks, mismatches, check, form unchanged
  // 1. Keys: a bind certificate from a certified cell (C.1), or — DEV records only — a pinned key.
  const cellPubs = certifiedCells(ctx.exam, cells, trust, mkVerify);
  const certified = new Map<number, Bind>();
  const problems: string[] = [];
  for (const wb of sheet.binds ?? []) {
    const pub = cellPubs.get(wb.cell);
    if (!pub) { problems.push(`a bind certificate names ${wb.cell}, whose key the exam authority has not certified`); continue; }
    try {
      const b = checkWireBind(wb, pub, mkVerify);
      if (b.exam !== ctx.exam || b.shift !== ctx.shift || b.attempt !== ctx.attempt || b.cand !== ctx.cand) problems.push(`a bind certificate is for ${b.cand} (${b.exam} ${b.shift}), not ${ctx.cand}`);
      else certified.set(b.keyEpoch, b);
    } catch (e) { problems.push(`a bind certificate: ${(e as Error).message}`); }
  }
  const keyed = new Map<number, Verify>();
  const epochs: Epoch[] = [];
  let pinned = 0;
  for (const k of sheet.keys) {
    const b = certified.get(k.keyEpoch);
    if (b && b.pub === k.pub) { keyed.set(k.keyEpoch, mkVerify(hexToBytes(k.pub))); epochs.push({ keyEpoch: b.keyEpoch, fromSeq: b.fromSeq }); }
    else if (trust.seats[`${ctx.cand}/${k.keyEpoch}`] === k.pub) { keyed.set(k.keyEpoch, mkVerify(hexToBytes(k.pub))); pinned++; }
    else problems.push(`keyEpoch ${k.keyEpoch}: not a key certified for ${ctx.cand}`);
  }
  epochs.sort((a, b) => a.keyEpoch - b.keyEpoch);
  if (epochs.length && !epochs.every((e, i) => e.keyEpoch === i + 1 && (i === 0 ? e.fromSeq === 0 : e.fromSeq > epochs[i - 1].fromSeq)))
    problems.push('the certified key epochs are not 1, 2, … with increasing fromSeq');
  const by = [...new Set((sheet.binds ?? []).map((b) => b.cell))].join(', ');
  check('keys', problems.length === 0 && keyed.size > 0, problems.length ? problems.join('; ') : !keyed.size ? 'no seat keys in the record'
    : `${keyed.size} key epoch(s) for ${ctx.cand}: ${[epochs.length ? `certified by ${by}, whose key the exam authority certified` : '', pinned ? 'pinned DEV keys' : ''].filter(Boolean).join('; ')}`);

  // 2. Chain, one verifier per key epoch; with certified epochs, each seq must be signed by its own epoch (C.4).
  const chain = verifyChainKeyed(ctx, sheet.entries.map((e) => e.line), (e) => keyed.get(e));
  let fault = chain.ok ? undefined : { seq: chain.index + 1, fault: chain.fault, detail: chain.detail };
  if (!fault && epochs.length) {
    for (const e of sheet.entries) {
      const p = parseSignedLine(e.line);
      const want = p.ok ? epochAt(epochs, p.header.seq) : undefined;
      if (p.ok && want !== p.header.keyEpoch) {
        fault = { seq: p.header.seq, fault: 'sig', detail: `signed at keyEpoch ${p.header.keyEpoch}, but seq ${p.header.seq} belongs to keyEpoch ${want ?? 'none'} (Addendum C.4)` };
        break;
      }
    }
  }
  check('chain', !fault, fault ? `entry ${fault.seq}: ${fault.fault} — ${fault.detail}` : `${sheet.entries.length} entries: signatures, sequence and links verify`);
  // … steps 3–4 unchanged
  // 5. in the receipt check, replace `const pub = trust.cells[r.cell];` with:
      const pub = cellPubs.get(r.cell);
      const ok = !!pub && r.seq === B.seq && r.h === B.h && r.code === receipt.code && mkVerify(pub)(receiptMessage(B), hexToBytes(r.sig));
  // … rest unchanged
}

// verifyProof: the first line becomes
  const r = verifySheet(p.sheet, forms, trust, mkVerify, p.cells);

// parseProof: destructure cells too, and add after the receipt check:
  const { sheet, sth, index, inclusion, cells } = x as O;
  const wb = (b: unknown) => obj(b) && str(b.cert, 4096) && is(SIG)(b.sig) && str(b.cell) && typeof b.pinBox === 'string' && b.pinBox.length <= 2048 && /^[0-9a-f]*$/.test(b.pinBox);
  need(sheet.binds === undefined || (Array.isArray(sheet.binds) && sheet.binds.length <= 16 && sheet.binds.every(wb)), 'sheet.binds must be [{cert, sig, cell, pinBox}]');
  need(cells === undefined || (Array.isArray(cells) && cells.length <= 16
    && cells.every((c) => obj(c) && str(c.id) && is(/^[0-9a-f]{16}$/)(c.keyId) && is(PUB)(c.pub) && is(SIG)(c.cert))), 'cells must be [{id, keyId, pub, cert}]');
// and in the entries check allow `rx`:
    && sheet.entries.every((e) => obj(e) && str(e.line, 4096) && is(SALT)(e.salt) && Array.isArray(e.body) && tagged(e.body)
      && (e.rx === undefined || (Array.isArray(e.rx) && e.rx.length === 2 && e.rx.every(nat)))), 'sheet.entries must be [{line, salt, body, rx?}]');
```
The old `const fault = …` line is replaced by the `let fault` above; nothing else in steps 3–5 changes. `badKeys` is gone (its role is `problems`).

- [ ] **Step 8: `packages/core/src/selftest.ts` — Addendum C in the browser self-test**

```ts
import { bindArray, msg } from './enrol.ts';
import { grantArray, handoverArray, respHash } from './handover.ts';
import { verifyProof } from './verify.ts';

export function goldenSelfTest(V: J, A: J, C?: J): { pass: number; fail: string[] } {
  // … every existing check unchanged, then before `return`:
  if (C) {
    const cellV = nobleVerifier(hexToBytes(C.keys.cell));
    t('C.2 handover claim (noble)', () => canon(handoverArray(C.claim.in)) === C.claim.text && nobleVerifier(hexToBytes(C.keys.oldSeat))(msg(handoverArray(C.claim.in)), hexToBytes(C.claim.sig)));
    t('C.4 keyEpoch 2 bind (noble)', () => canon(bindArray(C.bind2.in)) === C.bind2.text && cellV(msg(bindArray(C.bind2.in)), hexToBytes(C.bind2.sig)));
    t('C.5 grant (noble)', () => canon(grantArray(C.grant.in)) === C.grant.text && cellV(msg(grantArray(C.grant.in)), hexToBytes(C.grant.sig)));
    t('C.5 respHash', () => respHash(C.responses.rows) === C.responses.hash);
    t('C.1 a moved candidate\'s proof verifies with only the authority key', () => verifyProof(C.proof, C.forms, { authority: C.keys.authority, cells: {}, seats: {} }).ok);
  }
  return { pass, fail };
}
```

- [ ] **Step 9: `tools/sim-seat.ts` — `rekey`**

```ts
  #keys = new Map<number, string>();                  // keyEpoch → pub hex, for sheet()
  // constructor: after `this.#keyEpoch = keyEpoch;` add
    this.#keys.set(keyEpoch, toHex(k.pub));

  /** Addendum C: the candidate moved — later entries are signed by `seat` at `keyEpoch`; the chain continues. */
  rekey(keyEpoch: number, seat: KeyPair): void {
    this.#sign = signer(seat); this.#pub = seat.pub; this.#keyEpoch = keyEpoch; this.#keys.set(keyEpoch, toHex(seat.pub));
  }

  // sheet(): keys become every epoch used
      keys: [...this.#keys].map(([keyEpoch, pub]) => ({ keyEpoch, pub })),
```
(`#pub` stays for the existing callers.)

- [ ] **Step 10: The vector generator, then generate once**

`tools/gen-vectors-addendum-c.ts`:
```ts
// Writes fixtures/vectors/protocol-v1-addendum-c.json (protocol Addendum C). Run once; refuses to overwrite.
//   node tools/gen-vectors-addendum-c.ts
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { hexToBytes, toHex } from '../packages/core/src/bytes.ts';
import { canon } from '../packages/core/src/canon.ts';
import type { KeysFile } from '../packages/core/src/dev.ts';
import { attestHash, bindArray, cellKeyArray, cellKeyId, msg, type Bind } from '../packages/core/src/enrol.ts';
import { grantArray, handoverArray, purgeArray, respHash, sealHandoverPin, sealRestore, type CellCert, type Grant, type HandoverClaim, type PurgeOrder } from '../packages/core/src/handover.ts';
import { leafHashHex, NO_PREV_STH, receiptMessage, responsesOf, sthId, sthMessage, type Sth } from '../packages/core/src/log.ts';
import { nativeBox, signer, type KeyPair } from '../packages/core/src/node.ts';
import { counts, receiptCode, type Response } from '../packages/core/src/protocol.ts';
import type { Proof, ResponseSheet } from '../packages/core/src/sheet.ts';
import { FORMS, SimSeat } from './sim-seat.ts';

const OUT = 'fixtures/vectors/protocol-v1-addendum-c.json';
if (existsSync(OUT)) { console.log(`keep ${OUT} (frozen)`); process.exit(0); }
const keys = JSON.parse(readFileSync('fixtures/keys.json', 'utf8')) as KeysFile;
const pair = (x: { priv: string; pub: string }): KeyPair => ({ priv: hexToBytes(x.priv), pub: hexToBytes(x.pub) });
const auth = pair(keys.authority), cell = pair(keys.cells[0]), oldSeat = pair(keys.seats[0]), newSeat = pair(keys.seats[1]);
const signA = signer(auth), signC = signer(cell);
const X = { exam: 'DEMO-2026', shift: 'S1', attempt: 1, cand: 'C0001' };

// Seat A (keyEpoch 1, seats[0]) journals unlock + 4 answers; the candidate moves at seq 5; seat B (keyEpoch 2, seats[1]) continues.
const s = new SimSeat(keys, 'C0001', cell.pub);
s.add(5);
const fromSeq = 5, fromHead = s.hs[4], activeMs = s.headers[4].activeMs, creditedMs = 108_000;
const R = responsesOf(FORMS.F1, s.bodies).filter((r) => r[1] !== 'NV') as Response[];
s.rekey(2, newSeat);
s.append('handover', { item: '', state: '', answer: '', meta: ['pin', fromSeq, creditedMs] });
s.add(3);
s.submit('F1');

const attest = attestHash({ exam: X.exam, shift: X.shift, operatorId: 'GATE-42-OP7', time: 1790000000000, method: 'aadhaar-face', cand: X.cand });
const bind1: Bind = { ...X, seatId: 'CEN042-S01', pub: keys.seats[0].pub, keyEpoch: 1, fromSeq: 0, attestHash: attest };
const bind2: Bind = { ...X, seatId: 'CEN042-S02', pub: keys.seats[1].pub, keyEpoch: 2, fromSeq, attestHash: attest };
const wb = (b: Bind) => ({ cert: canon(bindArray(b)), sig: toHex(signC(msg(bindArray(b)))), cell: 'cell-1', pinBox: '' });
const claim: HandoverClaim = { ...X, keyEpoch: 1, fromSeq, fromHead, newPub: keys.seats[1].pub };
const grant: Grant = { ...X, keyEpoch: 2, fromSeq, fromHead, activeMs, creditedMs, respHash: respHash(R) };
const cells: CellCert[] = keys.cells.map((c) => {
  const keyId = cellKeyId(hexToBytes(c.pub));
  return { id: c.id, keyId, pub: c.pub, cert: toHex(signA(msg(cellKeyArray({ exam: X.exam, cellId: c.id, keyId, pub: c.pub })))) };
});

// The proof: both bind certificates, the cell's countersigned receipt, a one-leaf register signed by the authority.
const n = s.head, [form, fh] = s.bodies[n - 1].meta as [string, string];
if (form !== 'F1') throw new Error('the submit names the wrong form');
const sheet: ResponseSheet = { ...s.sheet('F1'), binds: [wb(bind1), wb(bind2)] };
const B = { exam: X.exam, shift: X.shift, attempt: 1, pseud: sheet.pseud, seq: n, h: s.hs[n - 1], finalHash: fh, ...counts(responsesOf(FORMS.F1, s.bodies.slice(0, n - 1))) };
sheet.receipt = { cell: 'cell-1', seq: n, h: B.h, code: receiptCode(B), sig: toHex(signC(receiptMessage(B))) };
const leaf = { exam: X.exam, shift: X.shift, attempt: 1, pseud: sheet.pseud, h: B.h, finalHash: fh };
const sth: Sth = { exam: X.exam, shift: X.shift, size: 1, root: leafHashHex(leaf), prevSTH: NO_PREV_STH, ts: 1790000900000 };
const proof: Proof = { v: 1, sheet, sth: { sth, sig: toHex(signA(sthMessage(sth))) }, index: 0, inclusion: [], cells: [cells[0]] };
const purge: PurgeOrder = { exam: X.exam, shift: X.shift, sthId: sthId(sth), ts: 1790001000000 };

writeFileSync(OUT, JSON.stringify({
  _note: 'Protocol v1 Addendum C. Signatures, box nonces and ephemeral keys are random: verify or open them, never compare bytes.',
  keys: { authority: keys.authority.pub, cell: keys.cells[0].pub, oldSeat: keys.seats[0].pub, newSeat: keys.seats[1].pub },
  claim: { in: claim, text: canon(handoverArray(claim)), sig: toHex(signer(oldSeat)(msg(handoverArray(claim)))) },
  pin: { pin: '482913', seatId: bind2.seatId, box: sealHandoverPin(cell.pub, X, bind2.seatId, bind2.pub, '482913', nativeBox) },
  responses: { rows: R, text: canon(['responses', R]), hash: respHash(R) },
  restore: { keyEpoch: 2, fromSeq, box: sealRestore(newSeat.pub, X, 2, fromSeq, R, nativeBox) },
  grant: { in: grant, text: canon(grantArray(grant)), sig: toHex(signC(msg(grantArray(grant)))) },
  bind2: { in: bind2, text: canon(bindArray(bind2)), sig: wb(bind2).sig },
  purge: { in: purge, text: canon(purgeArray(purge)), sig: toHex(signA(msg(purgeArray(purge)))) },
  cells, forms: { F1: FORMS.F1 }, proof,
}, null, 2) + '\n');
console.log(`wrote ${OUT}`);
```
Run: `node tools/gen-vectors-addendum-c.ts`
Expected: `wrote fixtures/vectors/protocol-v1-addendum-c.json`; a second run prints `keep … (frozen)`.

- [ ] **Step 11: Server side of the fix**

`apps/server/src/bindings.ts` — add:
```ts
  /** Every binding of a candidate, oldest epoch first (Addendum C: the proof and a relay's replay carry them all). */
  forCand(cand: string): WireBind[] {
    const out: WireBind[] = [];
    for (let e = 1; this.#rows.has(`${cand}/${e}`); e++) out.push(wire(this.#rows.get(`${cand}/${e}`)!));
    return out;
  }
```

`apps/server/src/sheet-export.ts`:
```ts
import type { WireBind } from '@saakshi/core/enrol';
// ExportOpts: add
  /** Addendum C.1 (EXAM mode): the candidate's bind certificates. Exported without the sealed PIN record. */
  binds?: (cand: string) => WireBind[];
// in the final loop, after sheet.keys = …:
    const bs = o.binds?.(sheet.ctx.cand) ?? [];
    if (bs.length) sheet.binds = bs.map((b) => ({ ...b, pinBox: '' }));
```

`apps/server/src/seal.ts`:
```ts
import type { CellCert } from '@saakshi/core/handover';
/** The proof /verify needs for one sheet, under the latest STH, with the cell certificates (Addendum C.1); undefined if the sheet is not in it. */
export function proofFor(rec: SthRecord, sheet: ResponseSheet, cells?: CellCert[]): Proof | undefined {
  // … unchanged until the return:
  return { v: 1, sheet, sth: signed, index, inclusion: inclusionProof(hs, index).map(toHex), ...(cells?.length ? { cells } : {}) };
}
```

`apps/server/src/control.ts`: `ControlOpts` gets `/** Addendum C.1: every cell's key certificate, for proofs. */ cells?: CellCert[];` and `proof()` calls `proofFor(rec, sheet, o.cells)`.

`apps/server/src/main.ts`:
- control: add `cells: X?.dir.cells.map(({ id, keyId, pub, cert }) => ({ id, keyId, pub, cert })),` to the `controlRoutes` options.
- cell `/v1/shift`: add `binds: bindings ? (c: string) => bindings.forCand(c) : undefined` to the `shiftExport` options.

`apps/server/src/verify-page.ts`:
```ts
import C from '../../../fixtures/vectors/protocol-v1-addendum-c.json' with { type: 'json' };
const st = goldenSelfTest(V, A, C);
// the success text becomes:
  : `Golden vectors: all ${st.pass} checks pass in this browser (protocol v1 + addenda A and C).`;
```
`apps/server/src/verify-view.ts`: `keys: 'Seat keys (certified by the exam server, or pinned DEV keys)',`.
`apps/server/src/verify.html` lede: `Works offline. Nothing you load here leaves this computer. It pins only the exam authority's key: certificates inside the record vouch for the exam server's and the seat's keys.`

- [ ] **Step 12: Seat IPC contract**

`apps/seat/src/shared/ipc.ts`:
```ts
import type { CentreStatus } from '@saakshi/core/ops';
/** … moving: a move to this seat awaits approval · moved: this seat was replaced by another (its entries are ORPHANED). */
export type Phase = 'connecting' | 'enrol' | 'moving' | 'locked' | 'ready' | 'exam' | 'submitted' | 'moved';
export type BindState = 'none' | 'provisional' | 'bound' | 'refused' | 'moving';
// SyncView: add  moved?: boolean;
/** Time credited for a move (Addendum C.5), and who approved it ('' = pending control's approval). */
export interface Credit { ms: number; via: 'pin' | 'key'; approvedBy: string; fromSeq: number }
// ExamBoot: add (all optional)
  /** Check-in was refused because the candidate is bound elsewhere: offer "move here". */
  moveable?: boolean;
  credited?: Credit;
  /** The relay's view of the link and the exam server (the banner). */
  status?: CentreStatus;
  /** The OS suspended or locked the screen; the timer is paused. */
  paused?: boolean;
  /** 16 hex of this seat's key, shown while a move waits so the invigilator can compare it with the console. */
  moveKey?: string;
// SeatApi: add
  handover(pin: string): Promise<EnrolResult>;
```
`apps/seat/src/preload/index.ts`: add `handover: (pin: string) => ipcRenderer.invoke('exam:handover', pin),` to `api`.

- [ ] **Step 13: Append §16 to `docs/protocol-v1.md`**

Append (exact text):
````markdown
## 16. Addendum C (Stage 4, 2026-09-27)

This addendum is additive only. No byte defined in §1–§15 changes, so `V` stays 1.

- Vectors: `fixtures/vectors/protocol-v1-addendum-c.json`, produced by `tools/gen-vectors-addendum-c.ts`, checked by `packages/core/test/addendum-c.test.ts`, and in the browser by `/verify` on every load.
- Code: `handover.ts`, `verify.ts` (C.1), `wire.ts` (`rx`, `parseHandoverReq`).

**C.1 Certified keys in a proof.** A response sheet may carry `binds` (its B.1 bind certificates, every key epoch; `pinBox` may be `''`), and a proof may carry `cells: [{id, keyId, pub, cert}]` (B.2 cell key certificates). A verifier that pins only the exam authority's key accepts a seat key for `(cand, keyEpoch)` iff:
- a bind in `binds` verifies under the key of a cell whose certificate verifies under the authority (and `cellKeyId(pub) = keyId`);
- the bind names the sheet's `exam, shift, attempt, cand`, and its `pub` is the sheet's key for that epoch.

Certified epochs must be `1, 2, …`, epoch 1 with `fromSeq 0`, each later one with a larger `fromSeq`. Entry `seq` must then be signed at `epochAt(seq)`, the highest epoch whose `fromSeq < seq`. A receipt countersignature is checked under the named certified cell. Records without certificates (DEV mode) may still be checked against pinned keys.

**C.2 Handover claim** (the old-key path): `["handover",exam,shift,attempt,cand,keyEpoch,fromSeq,fromHead,newPub]`, signed as in A.1 by the key of `keyEpoch` (the old epoch). `fromHead` is 64 hex (`genesisPrev` when `fromSeq = 0`); `newPub` is 130 hex. This fixes the §5 reserved layout.

**C.3 Handover PIN** (the PIN path): the UTF-8 of the 6-digit PIN in a B.4 box to the cell with `info = ["saakshi-handover-pin",1,exam,shift,attempt,cand,seatId,newPub]`. The new seat also sends a fresh B.5 record (B.4 box, `info = pinInfo(seatId)`) holding the same PIN. The cell checks the PIN against the current epoch's record and the new record against the PIN, and limits wrong PINs per candidate.

**C.4 The new binding.** The cell signs a B.1 bind with `keyEpoch = E+1` and `fromSeq = F` only if `F` is its committed head for the stream, `h(F) = fromHead`, nothing is pending and the stream has no submit. At relay and cell, after the signature check:
- `seq ≤ fromSeq(keyEpoch)` → `BAD_SUBMISSION`;
- `seq > fromSeq(keyEpoch + 1)` → `ORPHANED`: kept as evidence with its envelope, never `FORK`, never committed.

**C.5 Grant and restore.** Grant `["grant",exam,shift,attempt,cand,keyEpoch,fromSeq,fromHead,activeMs,creditedMs,respHash]`, signed by the cell (A.1), `keyEpoch` the new epoch.

| Field | Value |
|---|---|
| `activeMs` | entry F's `activeMs` (0 when F = 0) |
| `creditedMs` | the cell's clock at the grant − `rxWall(F)`, at least 0 (0 when F = 0) |
| `respHash` | `hex(SHA-256(UTF-8(canon(["responses", R]))))`, R = the A.5 responses at F, in form order, without `NV` rows |

The restore box is a B.4 box to `newPub` with `info = ["saakshi-restore",1,exam,shift,attempt,cand,keyEpoch,fromSeq]` and `pt = UTF-8(canon(["responses", R]))`. The new seat accepts only if the bind and the grant verify under its policy-pinned cell key, match each other and its own key, and `respHash` matches the opened box.

**C.6 Conventions (not checked).** The first entry of epoch E+1 is kind `handover` at seq F+1, with `prev = fromHead`, the grant's `activeMs`, and body `["body","","","",[via,F,creditedMs]]`, `via ∈ {pin, key}`.

**C.7 rxWall.** The relay stamps its wall clock (ms since the Unix epoch) on each entry it commits and forwards it as `WireEntry.rx` (non-normative JSON); the cell stores the relay's value and its own. Neither is signed. They are used only for C.8 and C.9. The §12 export field `rxWall` is the relay's value; `SheetEntry.rx = [relayRx, cellRx]`.

**C.8 Hard stop.** Relay and cell reject a new entry whose `rxWall` (the relay: its own clock; the cell: the relay's `rx`, else its own) is later than `rxWall(seq 1) + D_i + gapCapMs + slackMs` as `LATE`, kept as evidence with its envelope.

**C.9 Gaps (convention, not checked).** A `gap` body is `["body","","","",[cause,pausedMs]]`, `cause ∈ {suspend, lock-screen, restart}`, `pausedMs` the seat's own measure (0 if unknown). Credit for a `gap` or `handover` entry g after entry p is measured as `max(0, (rx_g − rx_p) − Δactive)`, with `Δactive = 0` across epochs.

**C.10 Purge order.** `["purge",exam,shift,sthId,ts]`, signed as in A.1 by the exam authority. A relay deletes a shift's entries only on a valid order.
````

- [ ] **Step 14: Run everything and typecheck**

Run: `pnpm --filter @saakshi/core test && bun test --timeout 60000 apps/server/test/verify-certs.test.ts apps/server/test/verify-page.test.ts apps/server/test/seal.test.ts apps/server/test/audit.test.ts apps/server/test/evidence.test.ts apps/server/test/tamper.test.ts && pnpm -r typecheck`
Expected: all PASS under node and bun (the Stage 0–3 vectors and every existing verify, seal, audit and evidence test unchanged); typecheck exits 0.

---
### Task 2: Relay and cell ingest — rxWall, key epochs (ORPHANED), the hard stop (LATE), a rebuild that waits for every relay, events; the forwarder

**Files:**
- Modify: `apps/server/src/ingest.ts`, `apps/server/src/store.ts`, `apps/server/src/forward.ts`, `apps/server/src/sheet-export.ts` (`rx`)
- Modify (one line each, for the `bindFor` signature): `tools/swarm.ts`, `apps/server/src/main.ts`, `apps/server/test/forward.test.ts`
- Test: `apps/server/test/ingest-stage4.test.ts`

**Interfaces:**
- Consumes: Task 1 (`StreamSnap`, `CellEvent`, `EventCode`, `RoundSample`, `WireEntry.rx`, `RejectCode`, `StreamView.submitted`, `Bindings.forCand`); `SimSeat.rekey`.
- Produces:
  - `IngestOpts.fromSeq?: (cand, keyEpoch) => number | undefined`, `IngestOpts.deadlineMs?: (cand) => number | undefined` (D_i + cap + slack), `IngestOpts.rebuildGraceMs?: number`.
  - `Ingest.events(after: number, limit?: number): CellEvent[]` (`cell` = the cell id, `centre` = `''` — the route fills it), `Ingest.note(code: EventCode, c: Ctx, seq: number, data: Record<string, string | number>): void`, `Ingest.snapshot(c: Ctx): StreamSnap | undefined`, `Ingest.rebuild(): { done: number; expected: number }`, `Ingest.forgetCell(): void` (relay: every cell head back to unknown, acks kept).
  - `Row.rx`, `Row.cellRx`; `entries.rx_wall`, `entries.cell_rx`, `evidence.env` columns (migrated in place).
  - `ForwardOpts.bindFor?: (c: Ctx) => WireBind[]`, `ForwardOpts.onRound?: (r: RoundSample) => void`.
  - The cell notes `GAP` (`{cause, pausedMs}`) and `INTEGRITY` (`{code}`) events when it commits such entries.

- [ ] **Step 1: Write the failing tests**

`apps/server/test/ingest-stage4.test.ts`:
```ts
import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hexToBytes } from '@saakshi/core/bytes';
import { cellKey, devForm, devPseud, type KeysFile } from '@saakshi/core/dev';
import { newKeyPair } from '@saakshi/core/node';
import type { RoundSample } from '@saakshi/core/ops';
import { formsOf } from '@saakshi/core/sheet';
import type { SyncRes } from '@saakshi/core/wire';
import { Bindings } from '../src/bindings.ts';
import { Forwarder } from '../src/forward.ts';
import { createIngest, type IngestOpts } from '../src/ingest.ts';
import { shiftExport } from '../src/sheet-export.ts';
import { openDb } from '../src/store.ts';
import { FORMS, SimSeat } from '../../../tools/sim-seat.ts';
import { simBindReq } from '../../../tools/sim-custody.ts';

const keys = JSON.parse(readFileSync(new URL('../../../fixtures/keys.json', import.meta.url), 'utf8')) as KeysFile;
const cell = cellKey(keys, 'cell-1'), forms = formsOf(FORMS);
const A = newKeyPair(), B = newKeyPair();
const seatKey = (c: string, e: number) => (c === 'C0001' ? (e === 1 ? A.pub : e === 2 ? B.pub : undefined) : undefined);
function node(mode: 'cell' | 'relay', o: Partial<IngestOpts> = {}) {
  const { db } = openDb(':memory:');
  const n = createIngest({ mode, db, fresh: false, seatKey, cell: mode === 'cell' ? cell : { pub: cell.pub }, forms, formOf: devForm, pseud: devPseud, ...o });
  return { n, db };
}
const rej = (r: SyncRes | 'REBUILDING') => { if (r === 'REBUILDING') throw new Error('REBUILDING'); return r.rejected; };
const X = { exam: 'DEMO-2026', shift: 'S1', cell: 'cell-1', formOf: devForm, pseud: devPseud, seatKey };

test('C.7 rxWall: the relay stamps its clock and forwards it; the cell keeps the relay\'s stamp and its own; the export carries both', async () => {
  let t = 1_000;
  const relay = node('relay', { now: () => t });
  const c = node('cell', { now: () => t + 50 });
  const s = new SimSeat(keys, 'C0001', cell.pub, 1, A);
  s.add(3);
  expect(rej(await relay.n.sync({ entries: s.entries, streams: [] }))).toEqual([]);
  const fwd = relay.n.entriesAfter(s.ctx, 0, 10);
  expect(fwd.map((e) => e.rx)).toEqual([1_000, 1_000, 1_000]);
  t = 9_000;
  expect(rej(await c.n.sync({ entries: [...fwd.slice(0, 2), { ...fwd[2], rx: 9_999_999_999 }], streams: [] }))).toEqual([]);
  expect(shiftExport(c.db, X).sheets[0].entries.map((e) => e.rx)).toEqual([[1_000, 9_050], [1_000, 9_050], [9_050, 9_050]]);   // a stamp from the future is not believed
  relay.n.close(); c.n.close();
});

test('Review Focus #2: an old-epoch entry after the new fromSeq is ORPHANED (evidence with envelope), before or after the new seat\'s entries, never FORK', async () => {
  for (const mode of ['relay', 'cell'] as const) {
    const from = new Map<number, number>([[1, 0]]);
    const { n, db } = node(mode, { fromSeq: (c, e) => (c === 'C0001' ? from.get(e) : undefined) });
    const s = new SimSeat(keys, 'C0001', cell.pub, 1, A);
    s.add(5);
    expect(rej(await n.sync({ entries: s.entries, streams: [] }))).toEqual([]);
    const tailBefore = s.make(6, s.hs[4], 'C').entry;                         // seat A's unsent tail, still keyEpoch 1
    from.set(2, 5);                                                            // the cell granted keyEpoch 2 from seq 5
    expect(rej(await n.sync({ entries: [tailBefore], streams: [] }))).toEqual([{ index: 0, code: 'ORPHANED', reason: expect.stringContaining('replaced at seq 5') }]);
    const early = new SimSeat(keys, 'C0001', cell.pub, 2, B).make(5, s.hs[3], 'A').entry;   // keyEpoch 2 may not sign seq 5
    expect(rej(await n.sync({ entries: [early], streams: [] }))[0]).toMatchObject({ code: 'BAD_SUBMISSION', reason: expect.stringContaining("fromSeq 5") });
    s.rekey(2, B);
    s.append('handover', { item: '', state: '', answer: '', meta: ['pin', 5, 0] });
    s.add(2);
    expect(rej(await n.sync({ entries: s.entries.slice(5), streams: [] }))).toEqual([]);
    const tailAfter = new SimSeat(keys, 'C0001', cell.pub, 1, A).make(7, '0'.repeat(64), 'D').entry;
    expect(rej(await n.sync({ entries: [tailAfter], streams: [] }))[0].code).toBe('ORPHANED');
    const ev = db.query("SELECT code, seq, env IS NOT NULL AS hasEnv FROM evidence WHERE code IN ('ORPHANED', 'FORK') ORDER BY id").all();
    expect(ev).toEqual([{ code: 'ORPHANED', seq: 6, hasEnv: 1 }, { code: 'ORPHANED', seq: 7, hasEnv: 1 }]);
    expect(n.snapshot(s.ctx)).toMatchObject({ head: 8, headH: s.hs[7], pending: 0, submitted: false });
    expect(n.events(0).filter((e) => e.code === 'ORPHANED').map((e) => [e.cand, e.seq])).toEqual([['C0001', 6], ['C0001', 7]]);
    n.close();
  }
});

test('C.8 the hard stop: entries after unlock + D_i + cap + slack are LATE (kept with envelope); the cell measures by the relay\'s stamp', async () => {
  let t = 1_000;
  const relay = node('relay', { deadlineMs: () => 10_000, now: () => t });
  const s = new SimSeat(keys, 'C0001', cell.pub, 1, A);
  s.add(3);
  expect(rej(await relay.n.sync({ entries: s.entries.slice(0, 2), streams: [] }))).toEqual([]);   // unlock received at 1 000
  t = 11_001;
  expect(rej(await relay.n.sync({ entries: [s.entries[2]], streams: [] }))[0]).toMatchObject({ code: 'LATE' });
  expect(relay.db.query("SELECT count(*) AS n FROM evidence WHERE code = 'LATE' AND env IS NOT NULL").get()).toEqual({ n: 1 });
  const c = node('cell', { deadlineMs: () => 10_000, now: () => 99_000 });                    // buffered through a WAN outage
  expect(rej(await c.n.sync({ entries: s.entries.map((e, i) => ({ ...e, rx: 1_000 + i })), streams: [] }))).toEqual([]);
  relay.n.close(); c.n.close();
});

test('Review Focus #1: a cell serving 3 relays stays REBUILDING until all 3 replay; a dead relay ends it by grace; a late relay\'s binds travel with its first entries', async () => {
  let t = 0;
  const rebuilding = () => { const { db } = openDb(':memory:'); return createIngest({ mode: 'cell', db, fresh: true, seatKey, cell, rebuildRelays: 3, rebuildGraceMs: 60_000, now: () => t }); };
  const c = rebuilding();
  expect(await c.sync({ entries: [], streams: [] })).toBe('REBUILDING');
  for (let i = 1; i <= 3; i++) {
    await c.sync({ entries: [], streams: [], replay: true, done: true });
    expect([c.state(), c.rebuild()]).toEqual([i < 3 ? 'REBUILDING' : 'LIVE', { done: i, expected: 3 }]);
  }
  const d = rebuilding();
  t = 1_000;
  await d.sync({ entries: [], streams: [], replay: true, done: true });
  t = 61_000; expect(d.state()).toBe('REBUILDING');
  t = 61_001; expect(d.state()).toBe('LIVE');
  c.close(); d.close();

  // A relay that was offline during the rebuild: its cell heads are stale; the first failed round makes them unknown, and the
  // entries it then sends carry the bindings, so a LIVE, wiped cell accepts them instead of refusing "no seat key".
  const rdb = openDb(':memory:').db, cdb = openDb(':memory:').db;
  const X3 = { exam: 'DEMO-2026', shift: 'S1' };
  const rb = new Bindings(rdb, { ...X3, cell: { id: 'cell-1', pub: cell.pub } }), cb = new Bindings(cdb, { ...X3, cell });
  const key = newKeyPair();
  const origin = new Bindings(openDb(':memory:').db, { ...X3, cell });
  const e = origin.enrol(simBindReq('C0001', key, cell.pub), true);
  if (!e.ok) throw new Error(e.error);
  expect(rb.accept(e.bind)).toBeUndefined();
  const relay = createIngest({ mode: 'relay', db: rdb, fresh: false, seatKey: rb.seatKey, acceptBinds: (x) => rb.acceptAll(x), cell: { pub: cell.pub } });
  const wiped = createIngest({ mode: 'cell', db: cdb, fresh: false, seatKey: cb.seatKey, acceptBinds: (x) => cb.acceptAll(x), cell, forms, formOf: devForm, pseud: devPseud });
  const s = new SimSeat(keys, 'C0001', cell.pub, 1, key);
  s.add(5);
  await relay.sync({ entries: s.entries, streams: [] });
  relay.setCellStatus({ ...s.ctx, head: 3, headH: s.hs[2], need: false });           // what the old cell knew before it was wiped
  let down = true;
  const sent: { binds: number; entries: number }[] = [];
  const fwd = new Forwarder(relay, async (req) => { if (down) throw new Error('WAN down'); sent.push({ binds: req.binds?.length ?? 0, entries: req.entries.length }); return wiped.sync(req); },
    { bindFor: (x) => rb.forCand(x.cand) });
  expect(await fwd.round()).toBe('error');
  expect(relay.views()[0].cellHead).toBe(-1);
  down = false;
  for (let i = 0; i < 5 && wiped.views()[0]?.head !== 5; i++) await fwd.round();
  expect(wiped.views()[0].head).toBe(5);
  expect(sent).toContainEqual({ binds: 1, entries: 5 });
  expect(cdb.query('SELECT count(*) AS n FROM evidence').get()).toEqual({ n: 0 });                 // no "no seat key" noise
  relay.close(); wiped.close();
});

test('events: the cell notes gap and integrity entries; note() adds one; ids only grow; snapshot() is what a grant needs', async () => {
  const { n } = node('cell', { now: () => 5_000 });
  const s = new SimSeat(keys, 'C0001', cell.pub, 1, A);
  s.add(2);
  s.append('gap', { item: '', state: '', answer: '', meta: ['suspend', 125_000] });
  s.append('integrity', { item: '', state: '', answer: '', meta: ['test-mode', 'journal key not in the OS keychain'] });
  expect(rej(await n.sync({ entries: s.entries, streams: [] }))).toEqual([]);
  n.note('HANDOVER', s.ctx, 4, { keyEpoch: 2, fromSeq: 4, via: 'pin', approvedBy: 'INV-42-A', creditedMs: 108_000 });
  const ev = n.events(0);
  expect(ev.map((e) => [e.code, e.cand, e.seq, e.data])).toEqual([
    ['GAP', 'C0001', 3, { cause: 'suspend', pausedMs: 125_000 }],
    ['INTEGRITY', 'C0001', 4, { code: 'test-mode' }],
    ['HANDOVER', 'C0001', 4, { keyEpoch: 2, fromSeq: 4, via: 'pin', approvedBy: 'INV-42-A', creditedMs: 108_000 }],
  ]);
  expect(n.events(ev[1].id).length).toBe(1);
  expect(ev.every((e) => e.cell === 'cell-1' && e.centre === '')).toBe(true);
  const snap = n.snapshot(s.ctx)!;
  expect([snap.head, snap.activeMs, snap.bodies.length, snap.rxAt(1), snap.submitted]).toEqual([4, 4_000, 4, 5_000, false]);
  expect(n.snapshot({ ...s.ctx, cand: 'C0404' })).toBeUndefined();
  n.close();
});

test('store: a Stage 3 database gains rx_wall, cell_rx and evidence.env in place', () => {
  const dir = mkdtempSync(join(tmpdir(), 'saakshi-mig-'));
  const path = join(dir, 'old.db');
  const old = new Database(path, { create: true });
  old.run(`CREATE TABLE entries (exam TEXT NOT NULL, shift TEXT NOT NULL, attempt INTEGER NOT NULL, cand TEXT NOT NULL, seq INTEGER NOT NULL,
    key_epoch INTEGER NOT NULL, h TEXT NOT NULL, line TEXT NOT NULL, env BLOB NOT NULL, PRIMARY KEY (exam, shift, attempt, cand, seq)) WITHOUT ROWID`);
  old.run('CREATE TABLE evidence (id INTEGER PRIMARY KEY, at INTEGER NOT NULL, code TEXT NOT NULL, stream TEXT NOT NULL, seq INTEGER NOT NULL, reason TEXT NOT NULL, line TEXT NOT NULL)');
  old.close();
  const { db } = openDb(path);
  const cols = (t: string) => (db.query(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name);
  expect(cols('entries')).toEqual(expect.arrayContaining(['rx_wall', 'cell_rx']));
  expect(cols('evidence')).toContain('env');
  db.close();
  openDb(path).db.close();                                                     // idempotent
  rmSync(dir, { recursive: true, force: true });
});

test('forwarder: one RoundSample per send, with its time, outcome, backlog and replay state', async () => {
  const relay = node('relay');
  const s = new SimSeat(keys, 'C0001', cell.pub, 1, A);
  s.add(4);
  await relay.n.sync({ entries: s.entries, streams: [] });
  const samples: RoundSample[] = [];
  let fail = true;
  const c = node('cell');
  const fwd = new Forwarder(relay.n, async (req) => { if (fail) throw new Error('down'); return c.n.sync(req); }, { onRound: (r) => samples.push(r) });
  await fwd.round();
  fail = false;
  await fwd.round(); await fwd.round();
  expect(samples.map((x) => [x.ok, x.backlog, x.replaying])).toEqual([[false, 4, false], [true, 4, false], [true, 4, false]]);
  expect(samples.every((x) => x.ms >= 0 && x.at > 0)).toBe(true);
  relay.n.close(); c.n.close();
});
```

In `forward.test.ts`, change both `bindFor: (x) => relay.b.get(x.cand, 1)` to `bindFor: (x) => relay.b.forCand(x.cand)`.

- [ ] **Step 2: Run to verify they fail**

Run: `bun test --timeout 60000 apps/server/test/ingest-stage4.test.ts`
Expected: FAIL — `rx` is undefined on forwarded entries, `n.snapshot is not a function`, no `rx_wall` column.

- [ ] **Step 3: `store.ts` — columns and the in-place migration**

In `Row` add `rx: number; cellRx: number;`. At the end of `openDb`, before `return`:
```ts
  // Stage 4 (Addendum C.7, C.4/C.8): rxWall stamps on entries; the envelope of ORPHANED/LATE evidence. Added in place to older DBs.
  const cols = (t: string) => (db.query(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name);
  if (!cols('entries').includes('rx_wall')) db.run('ALTER TABLE entries ADD COLUMN rx_wall INTEGER NOT NULL DEFAULT 0');
  if (!cols('entries').includes('cell_rx')) db.run('ALTER TABLE entries ADD COLUMN cell_rx INTEGER NOT NULL DEFAULT 0');
  if (!cols('evidence').includes('env')) db.run('ALTER TABLE evidence ADD COLUMN env BLOB');
```
In `GroupCommit`:
```ts
    const ins = db.query('INSERT INTO entries (exam, shift, attempt, cand, seq, key_epoch, h, line, env, rx_wall, cell_rx) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    // … and in #insert:
        ins.run(r.exam, r.shift, r.attempt, r.cand, r.seq, r.keyEpoch, r.h, r.line, r.env, r.rx, r.cellRx);
```

- [ ] **Step 4: `ingest.ts`**

Imports: add `import type { CellEvent, EventCode } from '@saakshi/core/ops';` and `import type { StreamSnap } from '@saakshi/core/handover';`.

`IngestOpts` — add:
```ts
  /** Addendum C.4: the fromSeq of a certified keyEpoch (undefined: no such epoch). EXAM: bindings.fromSeqOf. */
  fromSeq?: (cand: string, keyEpoch: number) => number | undefined;
  /** Addendum C.8: D_i + gap cap + slack for a candidate (undefined: no hard stop, e.g. DEV). */
  deadlineMs?: (cand: string) => number | undefined;
  /** cell: REBUILDING also ends this long after the last replay request, when some relay never replays (default 60 s). */
  rebuildGraceMs?: number;
```
`Ingest` — add:
```ts
  /** Evidence rows after `after` (≤ 500): rejections, ORPHANED, LATE, and the GAP / INTEGRITY / HANDOVER notes. */
  events(after: number, limit?: number): CellEvent[];
  /** Record an event that is not an entry (the cell's HANDOVER grant). */
  note(code: EventCode, c: Ctx, seq: number, data: Record<string, string | number>): void;
  /** What a cell knows about one stream (committed only). */
  snapshot(c: Ctx): StreamSnap | undefined;
  rebuild(): { done: number; expected: number };
  /** relay: after a failed round, every cell head is unknown again (acks are kept). */
  forgetCell(): void;
```
`Stream` gets `unlockRx: number` (0 = unknown); `get()` initialises it to 0. Evidence rows become 6-tuples:
```ts
type Evidence = [code: string, stream: string, seq: number, reason: string, line: string, env: Uint8Array | null];
const addEvidence = db.query('INSERT INTO evidence (at, code, stream, seq, reason, line, env) VALUES (?, ?, ?, ?, ?, ?, ?)');
```
The startup load reads `rx_wall` too and sets `unlockRx` from seq 1:
```ts
  for (const r of db.query('SELECT exam, shift, attempt, cand, seq, h, key_epoch, rx_wall FROM entries ORDER BY exam, shift, attempt, cand, seq').all() as (Ctx & { seq: number; h: string; key_epoch: number; rx_wall: number })[]) {
    const s = get(r);
    s.hs.push(r.h);
    s.durable = r.seq;
    s.epoch = r.key_epoch;
    if (r.seq === 1) s.unlockRx = r.rx_wall;
  }
```
`view()` adds the submit flag: `({ ...s.ctx, head: …, cellHead: …, senderHead: s.senderHead, seenAt: s.seenAt, ...(s.submitSeq ? { submitted: true as const } : {}) })`.

The rebuild gate replaces `let dones = 0;`:
```ts
  let dones = 0, lastReplayAt = 0;
  const expected = Math.max(1, o.rebuildRelays ?? 1), grace = o.rebuildGraceMs ?? 60_000;
  /** REBUILDING ends when every relay this cell serves has replayed, or `grace` after the last replay request (a relay that is down). */
  function settle(t: number): void {
    if (state !== 'REBUILDING' || dones < 1 || (dones < expected && t - lastReplayAt <= grace)) return;
    state = 'LIVE';
    setMeta.run('state', 'LIVE');
    o.onState?.(state);
  }
```
`sync()` — the new top, entry loop and tail (everything not shown is unchanged):
```ts
  async function sync(req: SyncReq): Promise<SyncRes | 'REBUILDING'> {
    const t = now();
    if (req.replay) lastReplayAt = t;
    settle(t);
    if (state === 'REBUILDING' && !req.replay) return 'REBUILDING';
    const touched = new Map<Stream, boolean>();
    const rejected: Rejection[] = [];
    const evidence: Evidence[] = [];
    const rows: Row[] = [];
    // … hellos unchanged …
    if (req.binds?.length && o.acceptBinds) {
      o.acceptBinds(req.binds).forEach((err, i) => { if (err) evidence.push(['BAD_SUBMISSION', '', 0, `bind: ${err}`, req.binds![i].cert, null]); });
    }

    req.entries.forEach((e, index) => {
      // C.7: the relay stamps its own clock; the cell keeps the relay's stamp unless it is from the future.
      const rx = mode === 'relay' || e.rx === undefined || e.rx > t + 300_000 ? t : e.rx;
      const envOf = (): Uint8Array | null => { try { return fromB64(e.env); } catch { return null; } };
      const reject = (code: RejectCode, reason: string, key = '', seq = 0, env: Uint8Array | null = null) => {
        rejected.push({ index, code, reason }); evidence.push([code, key, seq, reason, e.line, env]);
      };
      const p = parseSignedLine(e.line);
      if (!p.ok) return reject('BAD_SUBMISSION', `${p.fault}: ${p.detail}`);
      const hd = p.header, key = streamKey(hd), s = get(hd);
      touched.set(s, touched.get(s) ?? false);
      const bad = (reason: string) => reject('BAD_SUBMISSION', reason, key, hd.seq);
      // 1. signature under the key for this keyEpoch — an invalid entry is never a FORK
      const v = verifierFor(hd.cand, hd.keyEpoch);
      if (!v) return bad(`no seat key for ${hd.cand} at keyEpoch ${hd.keyEpoch}`);
      if (!v(p.m, p.sig)) return bad('signature does not verify');
      if (hd.seq < 1) return bad('seq must start at 1');
      // Addendum C.4: a key epoch signs only its own range. The old seat's tail after a move is evidence, not tampering.
      const from = o.fromSeq?.(hd.cand, hd.keyEpoch) ?? 0;
      if (hd.seq <= from) return bad(`seq ${hd.seq} is not after keyEpoch ${hd.keyEpoch}'s fromSeq ${from}`);
      const next = o.fromSeq?.(hd.cand, hd.keyEpoch + 1);
      if (next !== undefined && hd.seq > next) return reject('ORPHANED', `keyEpoch ${hd.keyEpoch} was replaced at seq ${next}: the candidate moved to another seat`, key, hd.seq, envOf());
      if (s.submitSeq && hd.seq > s.submitSeq) return bad(`entry after submit (the chain closed at seq ${s.submitSeq})`);
      const head = s.hs.length;
      if (hd.seq > head + 1) { touched.set(s, true); return; }            // gap → NEED{cand, head}
      // 2. prev against the stored chain
      const h = toHex(entryHash(hd));
      if (hd.prev !== (hd.seq === 1 ? genesisPrev(hd) : s.hs[hd.seq - 2])) return reject('FORK', `seq ${hd.seq}: prev does not match the stored chain`, key, hd.seq);
      // 3. fork or duplicate
      if (hd.seq <= head) return s.hs[hd.seq - 1] === h ? undefined : reject('FORK', `seq ${hd.seq} already holds a different signed entry`, key, hd.seq);
      // Addendum C.8: the hard stop, from the unlock's rxWall. Kept as evidence: a human can admit it.
      const dl = o.deadlineMs?.(hd.cand);
      if (dl !== undefined && hd.seq > 1 && s.unlockRx > 0 && rx > s.unlockRx + dl)
        return reject('LATE', `received ${Math.round((rx - s.unlockRx - dl) / 1000)} s after the hard stop`, key, hd.seq, envOf());
      // Addendum B.8 … (unchanged, through the cell's body block)
      // … inside `if (mode === 'cell') { … }`, after `rec = { … }` add:
      //   if (hd.kind === 'gap') evidence.push(['GAP', key, hd.seq, JSON.stringify({ cause: String(body.meta[0] ?? ''), pausedMs: typeof body.meta[1] === 'number' ? body.meta[1] : 0 }), e.line, null]);
      //   if (hd.kind === 'integrity') evidence.push(['INTEGRITY', key, hd.seq, JSON.stringify({ code: String(body.meta[0] ?? '') }), e.line, null]);
      s.hs.push(h);
      if (hd.seq === 1) s.unlockRx = rx;
      s.active = hd.activeMs; s.activeEpoch = hd.keyEpoch;
      if (body) s.bodies[hd.seq - 1] = body;
      if (hd.kind === 'submit') s.submitSeq = hd.seq;
      rows.push({ ...ctxOf(hd), seq: hd.seq, keyEpoch: hd.keyEpoch, h, line: e.line, env, body: rec, receipt, rx, cellRx: mode === 'cell' ? t : 0 });
    });

    if (evidence.length) db.transaction(() => { for (const ev of evidence) addEvidence.run(t, ...ev); })();
    if (rows.length) await commit.add(rows);
    if (req.replay && req.done && state === 'REBUILDING') dones++;
    settle(t);
    // … the response is unchanged
  }
```
The rest of the returned object — replace `state: () => state,` and add the new methods:
```ts
  const rxOf = db.query('SELECT rx_wall FROM entries WHERE exam = ? AND shift = ? AND attempt = ? AND cand = ? AND seq = ?');
  const readEvents = db.query('SELECT id, at, code, stream, seq, reason FROM evidence WHERE id > ? ORDER BY id LIMIT ?');
  // … in the returned object:
    state: () => { settle(now()); return state; },
    rebuild: () => ({ done: dones, expected }),
    events(after, limit = 500) {
      return (readEvents.all(after, Math.min(limit, 500)) as { id: number; at: number; code: string; stream: string; seq: number; reason: string }[]).map((r) => {
        let cand = '';
        try { cand = r.stream ? String((JSON.parse(r.stream) as unknown[])[3]) : ''; } catch { /* unkeyed evidence */ }
        let data: Record<string, string | number> | undefined;
        if (r.reason.startsWith('{')) { try { data = JSON.parse(r.reason) as Record<string, string | number>; } catch { /* plain text */ } }
        return { id: r.id, at: r.at, cell: cellId, code: r.code as EventCode, cand, centre: '', seq: r.seq, reason: r.reason, ...(data ? { data } : {}) };
      });
    },
    note(code, c, seq, data) { addEvidence.run(now(), code, streamKey(c), seq, JSON.stringify(data), '', null); },
    snapshot(c) {
      const s = streams.get(streamKey(c));
      if (!s) return undefined;
      const row = s.durable ? (lineAt.get(c.exam, c.shift, c.attempt, c.cand, s.durable) as { line: string } | null) : null;
      const p = row ? parseSignedLine(row.line) : undefined;
      return {
        head: s.durable, headH: s.durable ? s.hs[s.durable - 1] : genesisPrev(c), activeMs: p?.ok ? p.header.activeMs : 0,
        pending: s.hs.length - s.durable, submitted: s.submitSeq > 0, bodies: s.bodies.slice(0, s.durable),
        rxAt: (seq: number) => (rxOf.get(c.exam, c.shift, c.attempt, c.cand, seq) as { rx_wall: number } | null)?.rx_wall ?? 0,
      };
    },
    forgetCell() { if (mode === 'relay') for (const s of streams.values()) if (s.cellHead !== -1) { s.cellHead = -1; emit(s); } },
```
`entriesAfter` carries the stamp:
```ts
  const readAfter = db.query('SELECT line, env, rx_wall FROM entries WHERE exam = ? AND shift = ? AND attempt = ? AND cand = ? AND seq > ? ORDER BY seq LIMIT ?');
  // …
    entriesAfter: (c, after, limit) =>
      (readAfter.all(c.exam, c.shift, c.attempt, c.cand, after, limit) as { line: string; env: Uint8Array; rx_wall: number }[])
        .map((r) => (r.rx_wall ? { line: r.line, env: toB64(r.env), rx: r.rx_wall } : { line: r.line, env: toB64(r.env) })),
```
(`lineAt` is already defined above the returned object; `cellId` too.)

- [ ] **Step 5: `forward.ts` — bindings when the cell does not know a stream, forget heads after a failure, one sample per send**

```ts
import type { RoundSample } from '@saakshi/core/ops';
import { LIMITS, streamKey, type Hello, type StreamView, type SyncReq, type SyncRes } from '@saakshi/core/wire';

export interface ForwardOpts {
  batch?: number; heartbeatMs?: number;
  releases?: { count(): number; accept(r: ReleaseMsg): unknown };
  /** Every binding of the stream, oldest epoch first (Stage 4: a moved candidate has several). */
  bindFor?: (c: Ctx) => WireBind[];
  /** Stage 4: one sample per send, for the relay's link monitor (SYNC_LAG). */
  onRound?: (r: RoundSample) => void;
}
// constructor: this.#onRound = opts.onRound;  (new private field #onRound?: ForwardOpts['onRound'])

  async round(): Promise<Round> {
    try {
      const req: SyncReq = { entries: [], streams: [] };
      if (this.#replaying) req.replay = true;
      const before = new Map<string, number>();
      const binds: WireBind[] = [];
      let backlog = 0;
      // ponytail: first streams first, no fairness; add round-robin if one centre's backlog starves the rest.
      for (const v of this.#relay.views()) {
        backlog += Math.max(0, v.head - Math.max(0, v.cellHead));
        if (req.entries.length >= this.#batch || req.streams.length >= 5000) continue;      // keep counting the backlog
        if (v.cellHead >= 0 && v.head <= v.cellHead) continue;
        // A stream's bindings travel with its entries while the cell rebuilds, or when the cell does not know the stream
        // (cellHead 0) — so a relay that missed a rebuild heals instead of being refused "no seat key".
        const bs = this.#bindFor && v.cellHead >= 0 && (this.#replaying || v.cellHead === 0) ? this.#bindFor(v) : [];
        if (binds.length + bs.length > LIMITS.entries) continue;
        binds.push(...bs);
        req.streams.push(hello(v));
        before.set(streamKey(v), v.cellHead);
        if (v.cellHead >= 0) req.entries.push(...this.#relay.entriesAfter(v, v.cellHead, this.#batch - req.entries.length));
      }
      if (binds.length) req.binds = binds;
      let heartbeat = false;
      if (!req.streams.length) {
        if (this.#replaying) {
          if ((await this.#send({ entries: [], streams: [], replay: true, done: true })) === 'REBUILDING') return 'error';
          this.#replaying = false;
          return 'busy';
        }
        if (Date.now() - this.#lastContact < this.#heartbeatMs) return 'idle';
        req.streams = this.#relay.views().slice(0, 5000).map(hello);
        if (!req.streams.length && !this.#releases) return 'idle';
        heartbeat = true;
      }
      if (this.#releases) req.have = this.#releases.count();
      const t0 = Date.now();
      let res: SyncRes | 'REBUILDING';
      try { res = await this.#send(req); }
      catch (e) {
        this.#onRound?.({ at: Date.now(), ms: Date.now() - t0, ok: false, backlog, replaying: this.#replaying });
        this.#relay.forgetCell();                   // learn the cell's heads again (a hello round) before sending entries
        throw e;
      }
      this.#lastContact = Date.now();
      this.#onRound?.({ at: this.#lastContact, ms: this.#lastContact - t0, ok: true, backlog, replaying: this.#replaying || res === 'REBUILDING' });
      // … from `if (res === 'REBUILDING')` on: unchanged
    } catch {
      return 'error';
    }
  }
```
`tools/swarm.ts` and `apps/server/src/main.ts` (relay): `bindFor: (c) => bindings.forCand(c.cand)`.

- [ ] **Step 6: `sheet-export.ts` — the stamps in the record**

```ts
interface J { attempt: number; cand: string; seq: number; key_epoch: number; line: string; rx_wall: number; cell_rx: number; item: string | null; state: string | null; answer: string | null; meta: string | null; salt: Uint8Array | null }
// the SELECT adds e.rx_wall, e.cell_rx; the push becomes:
    x.sheet.entries.push({ line: r.line, ...recorded(r), rx: [r.rx_wall, r.cell_rx] });
```

- [ ] **Step 7: Run the new and the existing server tests**

Run: `bun test --timeout 60000 apps/server/test/ingest-stage4.test.ts apps/server/test/ingest.test.ts apps/server/test/forward.test.ts apps/server/test/store.test.ts apps/server/test/submit.test.ts apps/server/test/swarm.test.ts apps/server/test/verify-certs.test.ts && pnpm --filter @saakshi/server typecheck`
Expected: PASS. Then (unsandboxed) `bun tools/chaos-kill.ts` and `bun tools/act2.ts` still print `PASS`.

---
### Task 3: The cell's side of a move — PIN or old key, keyEpoch E+1, the signed grant, the sealed restore; events and stats routes

**Files:**
- Create: `apps/server/src/handover.ts`
- Modify: `apps/server/src/bindings.ts` (epochs, `issue`, PIN tries, grants), `apps/server/src/cell-routes.ts` (`/v1/handover`, `/v1/events`, stats), `apps/server/src/stats.ts` (`lastSeen`, `rebuild`), `apps/server/src/fleet.ts` (pass `rebuild` through)
- Test: `apps/server/test/handover.test.ts`; update the `/v1/stats` expectation in `apps/server/test/cell-routes.test.ts` (each centre gains `lastSeen: 1`)

**Interfaces:**
- Consumes: Task 1 (`HandoverReq`, `HandoverGrant`, `HandoverApproval`, `StreamSnap`, `CellEvent`, `grantArray`, `handoverArray`, `respHash`, `sealRestore`, `openHandoverPin`, `parseHandoverReq`, `Bindings.forCand`); `checkPin`, `openPinBox`, `isP256Pub`, `responsesOf`, `genesisPrev`.
- Produces:
  - `Bindings.fromSeqOf(cand, keyEpoch): number | undefined`, `Bindings.latest(cand): { bind: Bind; wire: WireBind } | undefined`, `Bindings.issue(b: Bind, pinBox: string): WireBind` (cell only), `Bindings.pinFailures(cand): number`, `Bindings.failPin(cand): number`, `Bindings.grantFor(cand, pub): HandoverGrant | undefined`, `Bindings.saveGrant(g): void`.
  - `cellHandover(o: CellHandoverOpts): (req: HandoverReq, from: { fromSeq: number; fromHead: string } | undefined, approval: HandoverApproval | undefined) => HandoverResult`, with `HandoverResult = { ok: true; grant: HandoverGrant } | { ok: false; code: HandoverCode; error: string; left?: number }` and `HandoverCode = 'NOT_BOUND' | 'BEHIND' | 'AHEAD' | 'SUBMITTED' | 'PIN_WRONG' | 'PIN_LOCKED' | 'BAD'`.
  - `CellRoutesOpts.handover?`, `CellRoutesOpts.events?: (after: number, limit: number) => CellEvent[]`, `CellRoutesOpts.rebuild?: () => { done: number; expected: number }`.
  - `cellStats({… , rebuild?})` → centres carry `lastSeen` (max `seenAt` of their streams, when > 0); `rebuild` while REBUILDING.

- [ ] **Step 1: Write the failing tests**

`apps/server/test/handover.test.ts`:
```ts
import { afterEach, beforeEach, expect, test } from 'bun:test';
import type { Database } from 'bun:sqlite';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hexToBytes, toHex } from '@saakshi/core/bytes';
import { cellKey, devForm, type KeysFile } from '@saakshi/core/dev';
import type { Directory } from '@saakshi/core/directory';
import { makeBindReq, msg, pinRecord } from '@saakshi/core/enrol';
import { checkGrant, handoverArray, sealHandoverPin, type HandoverReq, type StreamSnap } from '@saakshi/core/handover';
import { responsesOf } from '@saakshi/core/log';
import { nativeBox, newKeyPair, signer, verifier, type KeyPair } from '@saakshi/core/node';
import type { CellEvent } from '@saakshi/core/ops';
import { formsOf } from '@saakshi/core/sheet';
import { Bindings } from '../src/bindings.ts';
import { cellRoutes } from '../src/cell-routes.ts';
import { cellHandover } from '../src/handover.ts';
import { ReleaseStore } from '../src/release-store.ts';
import { openDb } from '../src/store.ts';
import { FORMS, SimSeat } from '../../../tools/sim-seat.ts';
import { simCustody } from '../../../tools/sim-custody.ts';

const keys = JSON.parse(readFileSync(new URL('../../../fixtures/keys.json', import.meta.url), 'utf8')) as KeysFile;
const cell = cellKey(keys, 'cell-1'), forms = formsOf(FORMS);
const X = { exam: 'DEMO-2026', shift: 'S1' }, ctx = { ...X, attempt: 1, cand: 'C0001' };
const PIN = '482913', appr = { by: 'INV-42-A', at: 1 };
const recs = new Map<string, string>();
const recFor = (pin: string) => { if (!recs.has(pin)) recs.set(pin, pinRecord(pin)); return recs.get(pin)!; };    // scrypt ~150 ms each
let tmp: string, db: Database, b: Bindings, seatA: KeyPair, seatB: KeyPair, s: SimSeat, events: { cand: string; seq: number; data: unknown }[];

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'saakshi-move-'));
  ({ db } = openDb(join(tmp, 'cell.db')));
  b = new Bindings(db, { ...X, cell });
  seatA = newKeyPair(); seatB = newKeyPair(); events = [];
  const e = b.enrol(makeBindReq({ ...ctx, seatId: 'CEN042-S01', pub: toHex(seatA.pub), keyEpoch: 1, fromSeq: 0, attestHash: 'a'.repeat(64) }, cell.pub, recFor(PIN), nativeBox), true);
  if (!e.ok) throw new Error(e.error);
  s = new SimSeat(keys, 'C0001', cell.pub, 1, seatA);
  s.add(6);                                                                          // unlock + 5 answers, all at the cell
});
afterEach(() => { db.close(); rmSync(tmp, { recursive: true, force: true }); });

const snap = (o: Partial<StreamSnap> = {}): StreamSnap =>
  ({ head: s.head, headH: s.hs[s.head - 1], activeMs: s.headers[s.head - 1].activeMs, pending: 0, submitted: false, bodies: s.bodies, rxAt: () => 1_000, ...o });
const grantor = (stream: () => StreamSnap | undefined = () => snap()) => cellHandover({
  ...X, cell, bindings: b, forms, formOf: devForm, stream: () => stream(), pinTries: 3, now: () => 109_000,
  record: (c, seq, data) => events.push({ cand: c.cand, seq, data }),
});
function req(pin = PIN, seat = seatB, seatId = 'CEN042-S02', recordPin = pin): HandoverReq {
  const pub = toHex(seat.pub);
  return {
    ...ctx, seatId, pub, attestHash: 'b'.repeat(64),
    pinBox: makeBindReq({ ...ctx, seatId, pub, keyEpoch: 1, fromSeq: 0, attestHash: 'b'.repeat(64) }, cell.pub, recFor(recordPin), nativeBox).pinBox,
    proof: { via: 'pin', pin: sealHandoverPin(cell.pub, ctx, seatId, pub, pin, nativeBox) },
  };
}
const from = () => ({ fromSeq: 6, fromHead: s.hs[5] });

test('PIN + invigilator: keyEpoch 2 from the cell\'s head; the new seat can check everything; its answers come back sealed to it', () => {
  const g = grantor()(req(), from(), appr);
  if (!g.ok) throw new Error(g.error);
  const c = checkGrant(g.grant, { ...ctx, seatId: 'CEN042-S02', pub: toHex(seatB.pub) }, cell.pub, seatB.priv, verifier, nativeBox);
  expect(c.bind).toMatchObject({ keyEpoch: 2, fromSeq: 6, seatId: 'CEN042-S02', attestHash: 'b'.repeat(64) });
  expect(c.grant).toMatchObject({ keyEpoch: 2, fromSeq: 6, fromHead: s.hs[5], activeMs: 6_000, creditedMs: 108_000 });
  expect(c.responses).toEqual(responsesOf(FORMS.F1, s.bodies).filter((r) => r[1] !== 'NV'));
  expect([g.grant.via, g.grant.approvedBy]).toEqual(['pin', 'INV-42-A']);
  expect(b.seatKey('C0001', 2)).toEqual(seatB.pub);
  expect([b.fromSeqOf('C0001', 1), b.fromSeqOf('C0001', 2), b.forCand('C0001').length]).toEqual([0, 6, 2]);
  expect(events).toEqual([{ cand: 'C0001', seq: 6, data: { keyEpoch: 2, fromSeq: 6, via: 'pin', approvedBy: 'INV-42-A', creditedMs: 108_000, seatId: 'CEN042-S02' } }]);
  const again = new Bindings(db, { ...X, cell });                                   // the new binding survives a restart
  expect([again.fromSeqOf('C0001', 2), again.latest('C0001')?.bind.keyEpoch]).toEqual([6, 2]);
});

test('Review Focus #3: the same move twice gets the same grant; three wrong PINs lock, across a restart', () => {
  const h = grantor();
  const first = h(req(), from(), appr), second = h(req(), from(), { by: 'INV-42-B', at: 2 });
  expect(second).toEqual(first);
  expect(events.length).toBe(1);

  b = new Bindings(db, { ...X, cell });                                              // fresh candidate state: another test, same cell
  const cand2 = { ...ctx, cand: 'C0003' };
  const seat3 = newKeyPair();
  const e = b.enrol(makeBindReq({ ...cand2, seatId: 'CEN042-S03', pub: toHex(seat3.pub), keyEpoch: 1, fromSeq: 0, attestHash: 'a'.repeat(64) }, cell.pub, recFor(PIN), nativeBox), true);
  if (!e.ok) throw new Error(e.error);
  const t = new SimSeat(keys, 'C0003', cell.pub, 1, seat3);
  t.add(2);
  const snap3 = (): StreamSnap => ({ head: 2, headH: t.hs[1], activeMs: 2_000, pending: 0, submitted: false, bodies: t.bodies, rxAt: () => 1_000 });
  const h3 = grantor(snap3);
  const r3 = (pin: string) => ({ ...req(pin), cand: 'C0003', proof: { via: 'pin' as const, pin: sealHandoverPin(cell.pub, cand2, 'CEN042-S02', toHex(seatB.pub), pin, nativeBox) },
    pinBox: makeBindReq({ ...cand2, seatId: 'CEN042-S02', pub: toHex(seatB.pub), keyEpoch: 1, fromSeq: 0, attestHash: 'b'.repeat(64) }, cell.pub, recFor(pin), nativeBox).pinBox });
  const f3 = { fromSeq: 2, fromHead: t.hs[1] };
  expect(h3(r3('111111'), f3, appr)).toMatchObject({ ok: false, code: 'PIN_WRONG', left: 2 });
  expect(h3(r3('222222'), f3, appr)).toMatchObject({ ok: false, code: 'PIN_WRONG', left: 1 });
  expect(h3(r3('333333'), f3, appr)).toMatchObject({ ok: false, code: 'PIN_LOCKED' });
  b = new Bindings(db, { ...X, cell });                                              // a cell restart forgets nothing
  expect(grantor(snap3)(r3(PIN), f3, appr)).toMatchObject({ ok: false, code: 'PIN_LOCKED' });
  expect(b.seatKey('C0003', 2)).toBeUndefined();
});

test('refusals: behind, pending, ahead, submitted, not bound, no approval, a wrong head, a new PIN record with another PIN, the current key', () => {
  const r = (x: ReturnType<ReturnType<typeof grantor>>) => (x.ok ? 'ok' : x.code);
  expect(r(grantor()(req(), { fromSeq: 7, fromHead: s.hs[5] }, appr))).toBe('BEHIND');
  expect(r(grantor(() => snap({ pending: 1 }))(req(), from(), appr))).toBe('BEHIND');
  expect(r(grantor()(req(), { fromSeq: 5, fromHead: s.hs[4] }, appr))).toBe('AHEAD');
  expect(r(grantor(() => snap({ submitted: true }))(req(), from(), appr))).toBe('SUBMITTED');
  expect(r(grantor()({ ...req(), cand: 'C0404' }, from(), appr))).toBe('NOT_BOUND');
  expect(r(grantor()(req(), from(), undefined))).toBe('BAD');
  expect(r(grantor()(req(), { fromSeq: 6, fromHead: s.hs[4] }, appr))).toBe('BAD');
  expect(r(grantor()(req(PIN, seatB, 'CEN042-S02', '999999'), from(), appr))).toBe('BAD');
  expect(r(grantor()(req(PIN, seatA, 'CEN042-S01'), from(), appr))).toBe('BAD');
  expect(b.seatKey('C0001', 2)).toBeUndefined();
  expect(b.pinFailures('C0001')).toBe(0);                                            // none of these was a wrong PIN
});

test('the old-key path: seat A\'s signed claim moves the candidate with no approval (credit pending); a bad claim is refused', () => {
  const pub = toHex(seatB.pub);
  const claim = { ...ctx, keyEpoch: 1, fromSeq: 6, fromHead: s.hs[5], newPub: pub };
  const sig = toHex(signer(seatA)(msg(handoverArray(claim))));
  const base = { ...req(), proof: { via: 'key' as const, keyEpoch: 1, fromSeq: 6, fromHead: s.hs[5], sig } };
  const g = grantor()(base, undefined, undefined);
  if (!g.ok) throw new Error(g.error);
  expect([g.grant.via, g.grant.approvedBy, g.grant.grant.keyEpoch]).toEqual(['key', '', 2]);
  const bad = grantor()({ ...base, pub: toHex(newKeyPair().pub) }, undefined, undefined);   // the claim names another key
  expect(bad).toMatchObject({ ok: false, code: 'BAD' });
});

test('routes: /v1/handover status codes; /v1/events fills the centre; /v1/stats carries lastSeen and rebuild progress', async () => {
  const dir = { v: 1, exam: 'DEMO-2026', shift: 'S1', durationMs: 1_800_000, demoCentre: 'CEN042', issuedAt: 0, cells: [],
    centres: { CEN042: { cell: 'cell-1' } }, cands: { C0001: { centre: 'CEN042', form: 'F1', extraMs: 0, pseud: '7'.repeat(64) } } } as unknown as Directory;
  let state: 'LIVE' | 'REBUILDING' = 'LIVE';
  const ev: CellEvent[] = [{ id: 7, at: 1, cell: 'cell-1', code: 'GAP', cand: 'C0001', centre: '', seq: 3, reason: '{}', data: {} }];
  const cust = simCustody(keys);
  const routes = cellRoutes({
    cellId: 'cell-1', dir, bindings: b, state: () => state, submitted: () => [],
    releases: new ReleaseStore(db, { ...X, manifest: cust.manifest.manifest, authority: verifier(hexToBytes(keys.authority.pub)), requireSig: true }),
    views: () => [{ ...ctx, head: 6, cellHead: 6, senderHead: 6, seenAt: 4_242 }],
    handover: grantor(), events: (after) => ev.filter((e) => e.id > after), rebuild: () => ({ done: 1, expected: 3 }),
  });
  const call = async (path: string, method: 'GET' | 'POST', body?: unknown) => {
    const r = await routes[path.split('?')[0]][method]!(new Request(`http://cell${path}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }), { timeout() {} });
    return { status: r.status, body: (await r.json()) as Record<string, unknown> };
  };
  expect((await call('/v1/handover', 'POST', { req: req(), approval: { by: 'INV-42-A' }, ...from() })).status).toBe(200);
  expect(await call('/v1/handover', 'POST', { req: req(), ...from() })).toMatchObject({ status: 200 });   // idempotent: no approval needed to fetch it again
  expect((await call('/v1/handover', 'POST', { req: { nope: 1 } })).status).toBe(400);
  expect((await call('/v1/handover', 'POST', { req: req(PIN, newKeyPair(), 'CEN042-S04'), approval: { by: 'INV' }, fromSeq: 9, fromHead: s.hs[5] })).body).toMatchObject({ code: 'BEHIND' });
  state = 'REBUILDING';
  expect((await call('/v1/handover', 'POST', { req: req() })).status).toBe(503);
  expect((await call('/v1/events?after=0', 'GET')).body).toEqual({ events: [{ ...ev[0], centre: 'CEN042' }], last: 7 });
  expect((await call('/v1/events?after=7', 'GET')).body).toEqual({ events: [], last: 7 });
  const st = (await call('/v1/stats', 'GET')).body as { rebuild: unknown; centres: Record<string, { lastSeen?: number }> };
  expect([st.rebuild, st.centres.CEN042.lastSeen]).toEqual([{ done: 1, expected: 3 }, 4_242]);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `bun test --timeout 60000 apps/server/test/handover.test.ts`
Expected: FAIL — `Cannot find module '../src/handover.ts'`.

- [ ] **Step 3: `bindings.ts` — epochs, issuing, PIN tries, grants**

```ts
import { bindArray, bindFromArray, checkWireBind, isP256Pub, openPinBox, type Bind, type BindReq, type WireBind } from '@saakshi/core/enrol';
import type { HandoverGrant } from '@saakshi/core/handover';
import { parseCanon } from '@saakshi/core/canon';

// fields
  #from = new Map<string, number>();                          // `${cand}/${keyEpoch}` → fromSeq
// constructor, after the bindings table:
    db.run(`CREATE TABLE IF NOT EXISTS pin_tries (exam TEXT NOT NULL, shift TEXT NOT NULL, cand TEXT NOT NULL, n INTEGER NOT NULL,
      PRIMARY KEY (exam, shift, cand)) WITHOUT ROWID`);
    db.run(`CREATE TABLE IF NOT EXISTS grants (exam TEXT NOT NULL, shift TEXT NOT NULL, cand TEXT NOT NULL, pub TEXT NOT NULL, body TEXT NOT NULL,
      PRIMARY KEY (exam, shift, cand, pub)) WITHOUT ROWID`);

  /** Addendum C.4: the fromSeq of a certified epoch (the ingest's orphan rule). */
  fromSeqOf = (cand: string, keyEpoch: number): number | undefined => this.#from.get(`${cand}/${keyEpoch}`);
  /** The candidate's current binding (the highest epoch). */
  latest(cand: string): { bind: Bind; wire: WireBind } | undefined {
    let e = 0;
    while (this.#rows.has(`${cand}/${e + 1}`)) e++;
    const r = e ? this.#rows.get(`${cand}/${e}`)! : undefined;
    return r && { bind: bindFromArray(parseCanon(r.cert)), wire: wire(r) };
  }
  /** Cell only: sign and store a binding (Addendum C.4). The caller has checked everything. */
  issue(b: Bind, pinBox: string): WireBind {
    if (!this.#sign) throw new Error('issue runs on the cell');
    const cert = canon(bindArray(b));
    const row: Row = { cand: b.cand, key_epoch: b.keyEpoch, pub: b.pub, cert, sig: toHex(this.#sign(utf8(cert))), cell: this.#o.cell.id, pin_box: pinBox };
    this.#store(row);
    return wire(row);
  }
  pinFailures(cand: string): number {
    return (this.#db.query('SELECT n FROM pin_tries WHERE exam = ? AND shift = ? AND cand = ?').get(this.#o.exam, this.#o.shift, cand) as { n: number } | null)?.n ?? 0;
  }
  failPin(cand: string): number {
    this.#db.query('INSERT INTO pin_tries (exam, shift, cand, n) VALUES (?, ?, ?, 1) ON CONFLICT (exam, shift, cand) DO UPDATE SET n = n + 1').run(this.#o.exam, this.#o.shift, cand);
    return this.pinFailures(cand);
  }
  grantFor(cand: string, pub: string): HandoverGrant | undefined {
    const r = this.#db.query('SELECT body FROM grants WHERE exam = ? AND shift = ? AND cand = ? AND pub = ?').get(this.#o.exam, this.#o.shift, cand, pub) as { body: string } | null;
    return r ? (JSON.parse(r.body) as HandoverGrant) : undefined;
  }
  saveGrant(g: HandoverGrant): void {
    const b = bindFromArray(parseCanon(g.bind.cert));
    this.#db.query('INSERT OR IGNORE INTO grants (exam, shift, cand, pub, body) VALUES (?, ?, ?, ?, ?)').run(this.#o.exam, this.#o.shift, b.cand, b.pub, JSON.stringify(g));
  }

// #put also records the epoch's fromSeq:
  #put(r: Row): void {
    const k = `${r.cand}/${r.key_epoch}`;
    this.#rows.set(k, r); this.#keys.set(k, hexToBytes(r.pub)); this.#from.set(k, bindFromArray(parseCanon(r.cert)).fromSeq);
  }
```

- [ ] **Step 4: `apps/server/src/handover.ts` — `cellHandover`**

```ts
// The cell's side of a move (plan §3.2, protocol Addendum C.2–C.5). Pure over its inputs: the bindings, one stream's snapshot and a
// clock. Synchronous from the snapshot to issue(), so no sync request interleaves between the head check and the new binding.
import { hexToBytes, toHex } from '@saakshi/core/bytes';
import { checkPin, isP256Pub, msg, openPinBox, type Bind } from '@saakshi/core/enrol';
import { grantArray, handoverArray, openHandoverPin, respHash, sealRestore, type Grant, type HandoverApproval, type HandoverGrant, type HandoverReq, type StreamSnap } from '@saakshi/core/handover';
import { responsesOf } from '@saakshi/core/log';
import { nativeBox, signer, verifier } from '@saakshi/core/node';
import { genesisPrev, type Ctx } from '@saakshi/core/protocol';
import type { Forms } from '@saakshi/core/sheet';
import type { Bindings } from './bindings.ts';

export type HandoverCode = 'NOT_BOUND' | 'BEHIND' | 'AHEAD' | 'SUBMITTED' | 'PIN_WRONG' | 'PIN_LOCKED' | 'BAD';
export type HandoverResult = { ok: true; grant: HandoverGrant } | { ok: false; code: HandoverCode; error: string; left?: number };
export interface CellHandoverOpts {
  exam: string; shift: string; cell: { id: string; pub: Uint8Array; priv: Uint8Array };
  bindings: Bindings; forms: Forms; formOf: (cand: string) => string | undefined;
  stream: (c: Ctx) => StreamSnap | undefined;
  /** One HANDOVER event per new binding (the ingest's note). */
  record: (c: Ctx, seq: number, data: Record<string, string | number>) => void;
  pinTries: number; now?: () => number;
}

export function cellHandover(o: CellHandoverOpts) {
  const now = o.now ?? Date.now, sign = signer(o.cell);
  return (req: HandoverReq, from: { fromSeq: number; fromHead: string } | undefined, approval: HandoverApproval | undefined): HandoverResult => {
    const no = (code: HandoverCode, error: string, left?: number): HandoverResult => ({ ok: false, code, error, ...(left !== undefined ? { left } : {}) });
    if (req.exam !== o.exam || req.shift !== o.shift || req.attempt !== 1) return no('BAD', `this cell moves ${o.exam} ${o.shift} attempt 1 only`);
    if (!isP256Pub(req.pub)) return no('BAD', 'pub is not a P-256 public key');
    const cur = o.bindings.latest(req.cand);
    if (!cur) return no('NOT_BOUND', `${req.cand} has no seat binding at this cell`);
    const prior = o.bindings.grantFor(req.cand, req.pub);
    if (prior) return { ok: true, grant: prior };                                   // the same move again: the same grant
    if (cur.bind.pub === req.pub) return no('BAD', 'this key is already the candidate\'s current seat key');
    let record: string;
    try { record = openPinBox(o.cell.priv, req, nativeBox); } catch { return no('BAD', 'the new seat\'s PIN record does not open with this cell key'); }
    const E = cur.bind.keyEpoch;
    let at: { fromSeq: number; fromHead: string }, via: 'pin' | 'key', approvedBy = '';
    if (req.proof.via === 'key') {
      const p = req.proof;
      if (p.keyEpoch !== E) return no('BAD', `the old-key claim is for keyEpoch ${p.keyEpoch}; the current one is ${E}`);
      const claim = { exam: req.exam, shift: req.shift, attempt: req.attempt, cand: req.cand, keyEpoch: E, fromSeq: p.fromSeq, fromHead: p.fromHead, newPub: req.pub };
      if (!verifier(hexToBytes(cur.bind.pub))(msg(handoverArray(claim)), hexToBytes(p.sig))) return no('BAD', 'the old seat key did not sign this move');
      at = { fromSeq: p.fromSeq, fromHead: p.fromHead }; via = 'key';                  // no human approval: the credited time waits for control
    } else {
      if (!approval?.by) return no('BAD', 'a PIN move needs the invigilator\'s approval');
      if (!from) return no('BAD', 'a PIN move needs the relay\'s fromSeq and fromHead');
      if (o.bindings.pinFailures(req.cand) >= o.pinTries) return no('PIN_LOCKED', 'too many wrong PINs — control must verify the candidate');
      let pin: string;
      try { pin = openHandoverPin(o.cell.priv, req, req.seatId, req.pub, req.proof.pin, nativeBox); } catch { return no('BAD', 'the PIN box does not open with this cell key'); }
      if (!checkPin(openPinBox(o.cell.priv, { ...cur.bind, pinBox: cur.wire.pinBox }, nativeBox), pin)) {
        const n = o.bindings.failPin(req.cand), left = o.pinTries - n;
        return left > 0 ? no('PIN_WRONG', `wrong PIN — ${left} ${left === 1 ? 'try' : 'tries'} left`, left) : no('PIN_LOCKED', 'too many wrong PINs — control must verify the candidate');
      }
      if (!checkPin(record, pin)) return no('BAD', 'the new seat\'s PIN record does not hold the same PIN');
      at = from; via = 'pin'; approvedBy = approval.by;
    }
    const s = o.stream(req);
    const head = s?.head ?? 0, headH = s && head ? s.headH : genesisPrev(req);
    if (s?.submitted) return no('SUBMITTED', `${req.cand} has already submitted`);
    if (at.fromSeq > head || (s?.pending ?? 0) > 0) return no('BEHIND', `the exam server has ${head} of ${at.fromSeq} entries — retry when it catches up`);
    if (at.fromSeq < head) return no('AHEAD', `the exam server already holds ${head} entries; the move must start there`);
    if (at.fromHead !== headH) return no('BAD', 'fromHead is not the exam server\'s head for this candidate');
    const items = o.forms[o.formOf(req.cand) ?? ''];
    if (!items) return no('BAD', `no form for ${req.cand}`);
    let rs;
    try { rs = responsesOf(items, s?.bodies ?? []).filter((r) => r[1] !== 'NV'); } catch (e) { return no('BAD', `cannot replay: ${(e as Error).message}`); }
    const c: Ctx = { exam: req.exam, shift: req.shift, attempt: req.attempt, cand: req.cand };
    const bind: Bind = { ...c, seatId: req.seatId, pub: req.pub, keyEpoch: E + 1, fromSeq: head, attestHash: req.attestHash };
    const grant: Grant = { ...c, keyEpoch: E + 1, fromSeq: head, fromHead: headH, activeMs: s?.activeMs ?? 0,
      creditedMs: head ? Math.max(0, now() - s!.rxAt(head)) : 0, respHash: respHash(rs) };
    const g: HandoverGrant = {
      bind: o.bindings.issue(bind, req.pinBox), grant, sig: toHex(sign(msg(grantArray(grant)))),
      restore: sealRestore(hexToBytes(req.pub), c, E + 1, head, rs, nativeBox), via, approvedBy,
    };
    o.bindings.saveGrant(g);
    o.record(c, head, { keyEpoch: E + 1, fromSeq: head, via, approvedBy, creditedMs: grant.creditedMs, seatId: req.seatId });
    return { ok: true, grant: g };
  };
}
```

- [ ] **Step 5: `cell-routes.ts` and `stats.ts`**

```ts
import { parseHandoverReq, parseBindReq, type NodeState, type StreamView } from '@saakshi/core/wire';
import type { CellEvent } from '@saakshi/core/ops';
import type { HandoverResult } from './handover.ts';
import type { HandoverApproval, HandoverReq } from '@saakshi/core/handover';

export interface CellRoutesOpts {
  cellId: string; dir: Directory; bindings: Bindings; releases: ReleaseStore;
  state: () => NodeState; views: () => StreamView[]; submitted: () => string[];
  /** Stage 4 */
  handover?: (req: HandoverReq, from: { fromSeq: number; fromHead: string } | undefined, approval: HandoverApproval | undefined) => HandoverResult;
  events?: (after: number, limit: number) => CellEvent[];
  rebuild?: () => { done: number; expected: number };
}

// new routes
    '/v1/handover': { POST: async (req) => {
      if (o.state() === 'REBUILDING') return json({ state: 'REBUILDING' }, 503);
      if (!o.handover) return json({ error: 'moves need EXAM mode' }, 404);
      const b = (await req.json().catch(() => null)) as { req?: unknown; approval?: { by?: unknown }; fromSeq?: unknown; fromHead?: unknown } | null;
      let hr: HandoverReq;
      try { hr = parseHandoverReq(b?.req); } catch (e) { return json({ error: (e as Error).message, code: 'BAD' }, 400); }
      const from = Number.isSafeInteger(b?.fromSeq) && (b!.fromSeq as number) >= 0 && typeof b?.fromHead === 'string' && /^[0-9a-f]{64}$/.test(b.fromHead)
        ? { fromSeq: b.fromSeq as number, fromHead: b.fromHead } : undefined;
      const by = typeof b?.approval?.by === 'string' ? b.approval.by.trim() : '';
      const r = o.handover(hr, from, by && by.length <= 64 ? { by, at: Date.now() } : undefined);
      if (r.ok) return json(r.grant);
      return json({ error: r.error, code: r.code, ...(r.left !== undefined ? { left: r.left } : {}) }, r.code === 'PIN_LOCKED' ? 423 : r.code === 'BAD' ? 400 : 409);
    } },
    '/v1/events': { GET: (req) => {
      const u = new URL(req.url), after = Math.max(0, Number(u.searchParams.get('after') ?? 0) || 0), limit = Math.min(500, Number(u.searchParams.get('limit') ?? 500) || 500);
      const events = (o.events?.(after, limit) ?? []).map((e) => ({ ...e, centre: o.dir.cands[e.cand]?.centre ?? '' }));
      return json({ events, last: events.at(-1)?.id ?? after });
    } },
// /v1/stats passes the rebuild progress while REBUILDING:
    '/v1/stats': { GET: () => json(cellStats({ cellId: o.cellId, state: o.state(), dir: o.dir, views: o.views(), bound: o.bindings.cands(), submitted: o.submitted(),
      rebuild: o.state() === 'REBUILDING' ? o.rebuild?.() : undefined })) },
```
The existing `/v1/handover` idempotent re-fetch (seat or relay asking again) works without approval because `grantFor` is checked before the approval.

`stats.ts`:
```ts
export function cellStats(i: { cellId: string; state: NodeState; dir: Directory; views: StreamView[]; bound: string[]; submitted: string[]; rebuild?: { done: number; expected: number } }): CellStats {
  // … unchanged, and inside the views loop after `if (!s) continue;`:
    if (v.seenAt > (s.lastSeen ?? 0)) s.lastSeen = v.seenAt;                       // when this centre's relay last reached the cell
  // …
  return { cell: i.cellId, state: i.state, entries, centres, ...(i.rebuild ? { rebuild: i.rebuild } : {}) };
}
```
`fleet.ts` (the `cells` map): `return { id: c.id, state: …, entries: lastEntries[c.id], ...(g.status === 'fulfilled' && g.value.rebuild ? { rebuild: g.value.rebuild } : {}) };`

In `cell-routes.test.ts`, the `/v1/stats` expectation gains `lastSeen: 1` in both centres.

- [ ] **Step 6: Run the new and existing tests**

Run: `bun test --timeout 60000 apps/server/test/handover.test.ts apps/server/test/cell-routes.test.ts apps/server/test/bindings.test.ts apps/server/test/fleet.test.ts && pnpm --filter @saakshi/server typecheck`
Expected: PASS.

---
### Task 4: The relay's side of a move — hold PIN moves for the invigilator, add the relay's head, forward, keep the new binding; the console

**Files:**
- Create: `apps/server/src/relay-handover.ts`
- Modify: `apps/server/src/console.html`, `apps/server/src/console.ts`, `apps/server/src/console-view.ts`
- Test: `apps/server/test/relay-handover.test.ts`; add to `apps/server/test/console-view.test.ts`

**Interfaces:**
- Consumes: Task 1 (`HandoverReq`, `HandoverGrant`, `HandoverApproval`, `parseHandoverReq`, `CentreStatus`); `Bindings.accept`, `Routes`.
- Produces: `relayHandover(o: RelayHandoverOpts): Routes` with `RelayHandoverOpts = { exam; shift; cellUrl; bindings: Bindings; head: (c: Ctx) => { seq: number; h: string }; fetch?; now?; log?; retryMs?; tries?; timeoutMs? }`; `moveKey(pub): string` (hex chars 2–17 of the key); log lines `HANDOVER-REQUEST {…}` and `HANDOVER-GRANTED {…}`. `console-view.ts`: `PendingMove`, `moveRow(m, now)`, `approveText(status, body)`, `linkText(s: CentreStatus)`, `fmtMs(ms)`.

- [ ] **Step 1: Write the failing tests**

`apps/server/test/relay-handover.test.ts`:
```ts
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { toHex, utf8 } from '@saakshi/core/bytes';
import { canon } from '@saakshi/core/canon';
import { cellKey, type KeysFile } from '@saakshi/core/dev';
import { bindArray, type Bind } from '@saakshi/core/enrol';
import type { HandoverGrant, HandoverReq } from '@saakshi/core/handover';
import { newKeyPair, signer } from '@saakshi/core/node';
import { Bindings } from '../src/bindings.ts';
import { moveKey, relayHandover } from '../src/relay-handover.ts';
import { openDb } from '../src/store.ts';
import { simBindReq } from '../../../tools/sim-custody.ts';

const keys = JSON.parse(readFileSync(new URL('../../../fixtures/keys.json', import.meta.url), 'utf8')) as KeysFile;
const cell = cellKey(keys, 'cell-1'), X = { exam: 'DEMO-2026', shift: 'S1' }, ctx = { ...X, attempt: 1, cand: 'C0001' };
const signC = signer(cell);

function setup(script: { status: number; body: Record<string, unknown> }[] = []) {
  const { db } = openDb(':memory:');
  const bindings = new Bindings(db, { ...X, cell: { id: 'cell-1', pub: cell.pub } });
  const origin = new Bindings(openDb(':memory:').db, { ...X, cell });
  const e = origin.enrol(simBindReq('C0001', newKeyPair(), cell.pub, 'CEN042-S01'), true);
  if (!e.ok) throw new Error(e.error);
  bindings.accept(e.bind);
  const seatB = newKeyPair(), pub = toHex(seatB.pub);
  const b2: Bind = { ...ctx, seatId: 'CEN042-S02', pub, keyEpoch: 2, fromSeq: 6, attestHash: 'b'.repeat(64) };
  const cert = canon(bindArray(b2));
  const grant = { bind: { cert, sig: toHex(signC(utf8(cert))), cell: 'cell-1', pinBox: 'ab' }, grant: { ...ctx, keyEpoch: 2, fromSeq: 6, fromHead: 'e'.repeat(64), activeMs: 6_000, creditedMs: 108_000, respHash: 'f'.repeat(64) },
    sig: 'c'.repeat(128), restore: 'dd', via: 'pin', approvedBy: 'INV-42-A' } as HandoverGrant;
  const calls: Record<string, unknown>[] = [], logs: string[] = [];
  const answers = [...script];
  const fetch = (async (_url: string, init: RequestInit) => {
    calls.push(JSON.parse(String(init.body)));
    const a = answers.shift() ?? { status: 200, body: grant as unknown as Record<string, unknown> };
    return Response.json(a.body, { status: a.status });
  }) as unknown as typeof globalThis.fetch;
  const routes = relayHandover({ ...X, cellUrl: 'http://cell', bindings, head: () => ({ seq: 6, h: 'e'.repeat(64) }), fetch, log: (l) => logs.push(l), retryMs: 1, now: () => 5_000 });
  const req: HandoverReq = { ...ctx, seatId: 'CEN042-S02', pub, attestHash: 'b'.repeat(64), pinBox: 'ab', proof: { via: 'pin', pin: 'cd' } };
  const call = async (path: string, method: 'GET' | 'POST', body?: unknown) => {
    const r = await routes[path][method]!(new Request(`http://relay${path}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }), { timeout() {} });
    return { status: r.status, body: (await r.json()) as Record<string, any> };
  };
  return { bindings, pub, key: moveKey(pub), req, calls, logs, call, grant };
}

test('a PIN move waits for the invigilator; approval adds the relay\'s head; BEHIND is retried; the relay keeps the new binding', async () => {
  const t = setup([{ status: 409, body: { code: 'BEHIND', error: 'the exam server has 5 of 6 entries' } }]);
  expect(await t.call('/v1/handover', 'POST', t.req)).toEqual({ status: 202, body: { state: 'pending' } });
  expect(t.calls).toEqual([]);                                                        // nothing reaches the cell before approval
  const pending = (await t.call('/v1/handover/pending', 'GET')).body.pending;
  expect(pending).toEqual([{ cand: 'C0001', seatId: 'CEN042-S02', key: t.key, at: 5_000, error: '' }]);
  expect(JSON.stringify(pending)).not.toContain('"cd"');                              // the sealed PIN box is never listed
  const ok = await t.call('/v1/handover/approve', 'POST', { cand: 'C0001', key: t.key, invigilator: ' INV-42-A ' });
  expect(ok).toEqual({ status: 200, body: { state: 'granted', keyEpoch: 2, fromSeq: 6, creditedMs: 108_000 } });
  expect(t.calls.length).toBe(2);
  expect(t.calls[1]).toMatchObject({ approval: { by: 'INV-42-A' }, fromSeq: 6, fromHead: 'e'.repeat(64), req: { cand: 'C0001', pub: t.pub } });
  expect(t.bindings.seatKey('C0001', 2)).toBeDefined();
  expect((await t.call('/v1/handover', 'POST', t.req))).toMatchObject({ status: 200, body: { state: 'granted', grant: t.grant } });
  expect(t.logs.map((l) => l.split(' ')[0])).toEqual(['HANDOVER-REQUEST', 'HANDOVER-GRANTED']);
});

test('Review Focus #3: two approvals at once share one forward; a wrong PIN refuses the move and the seat can ask again', async () => {
  const t = setup();
  await t.call('/v1/handover', 'POST', t.req);
  const both = await Promise.all([1, 2].map(() => t.call('/v1/handover/approve', 'POST', { cand: 'C0001', key: t.key, invigilator: 'INV-42-A' })));
  expect(both.map((r) => r.status)).toEqual([200, 200]);
  expect(t.calls.length).toBe(1);

  const w = setup([{ status: 409, body: { code: 'PIN_WRONG', error: 'wrong PIN — 2 tries left', left: 2 } }]);
  await w.call('/v1/handover', 'POST', w.req);
  expect(await w.call('/v1/handover/approve', 'POST', { cand: 'C0001', key: w.key, invigilator: 'INV' })).toMatchObject({ status: 409, body: { code: 'PIN_WRONG' } });
  expect(await w.call('/v1/handover', 'POST', w.req)).toEqual({ status: 202, body: { state: 'pending' } });   // a fresh request replaces the refused one
});

test('refuse, the old-key path, a cell that cannot be reached, and bad input', async () => {
  const t = setup();
  await t.call('/v1/handover', 'POST', t.req);
  expect((await t.call('/v1/handover/refuse', 'POST', { cand: 'C0001', key: t.key })).body).toEqual({ state: 'refused' });
  expect(await t.call('/v1/handover', 'POST', t.req)).toEqual({ status: 202, body: { state: 'pending' } });

  const k = setup();
  const byKey = { ...k.req, proof: { via: 'key' as const, keyEpoch: 1, fromSeq: 6, fromHead: 'e'.repeat(64), sig: 'a'.repeat(128) } };
  expect((await k.call('/v1/handover', 'POST', byKey)).status).toBe(200);             // forwarded at once, no approval
  expect(k.calls[0]).not.toHaveProperty('approval');
  expect(k.calls[0]).not.toHaveProperty('fromSeq');                                   // the signed claim carries it

  const d = setup();
  const routes = relayHandover({ ...X, cellUrl: 'http://cell', bindings: d.bindings, head: () => ({ seq: 6, h: 'e'.repeat(64) }), fetch: (async () => { throw new Error('ECONNREFUSED'); }) as unknown as typeof fetch });
  const post = (path: string, body: unknown) => routes[path].POST!(new Request(`http://relay${path}`, { method: 'POST', body: JSON.stringify(body) }), { timeout() {} });
  await post('/v1/handover', d.req);
  const r = await post('/v1/handover/approve', { cand: 'C0001', key: d.key, invigilator: 'INV' });
  expect([r.status, ((await r.json()) as { error: string }).error]).toEqual([202, expect.stringContaining('unreachable')]);

  expect((await t.call('/v1/handover', 'POST', { nope: 1 })).status).toBe(400);
  expect((await t.call('/v1/handover', 'POST', { ...t.req, exam: 'OTHER' })).status).toBe(400);
  expect((await t.call('/v1/handover/approve', 'POST', { cand: 'C0001', key: t.key })).status).toBe(400);
  expect((await t.call('/v1/handover/approve', 'POST', { cand: 'C0001', key: 'ffff', invigilator: 'INV' })).status).toBe(404);
});
```

Add to `apps/server/test/console-view.test.ts`:
```ts
import { approveText, fmtMs, linkText, moveRow } from '../src/console-view.ts';

test('moves: a row says who moves where, with the key to compare and the wait; approval outcomes read plainly', () => {
  const m = { cand: 'C0001', seatId: 'CEN042-S02', key: '1a2b3c4d5e6f7a8b', at: 1_000, error: '' };
  expect(moveRow(m, 43_000)).toEqual({ text: 'C0001 → CEN042-S02 · key 1a2b 3c4d 5e6f 7a8b · waiting 42 s', aria: 'Move C0001 to seat CEN042-S02, waiting 42 seconds' });
  expect(moveRow({ ...m, error: 'the exam server is catching up' }, 1_000).text).toContain('· the exam server is catching up');
  expect(fmtMs(108_000)).toBe('1:48');
  expect(approveText(200, { keyEpoch: 2, fromSeq: 6, creditedMs: 108_000 })).toEqual({ text: 'Moved: the new seat continues from entry 6 (key epoch 2). +1:48 credited, approved by you.', tone: 'good' });
  expect(approveText(202, { error: 'the exam server is unreachable' })).toEqual({ text: 'Waiting for the exam server: the exam server is unreachable. Approve again in a moment.', tone: 'bad' });
  expect(approveText(409, { error: 'wrong PIN — 2 tries left' })).toEqual({ text: 'wrong PIN — 2 tries left', tone: 'bad' });
  expect(linkText({ link: 'up', cell: 'LIVE', at: 0 }).tone).toBe('good');
  expect(linkText({ link: 'down', cell: 'unreachable', at: 0 })).toEqual({ text: 'Link to the exam server: down. Seats keep working; answers wait here (✓✓).', tone: 'bad' });
  expect(linkText({ link: 'up', cell: 'REBUILDING', etaMs: 90_000, at: 0 }).text).toBe('Link to the exam server: up. The exam server is rebuilding from the relays (about 1:30 left).');
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `bun test --timeout 60000 apps/server/test/relay-handover.test.ts apps/server/test/console-view.test.ts`
Expected: FAIL — module not found; `moveRow` is not exported.

- [ ] **Step 3: `apps/server/src/relay-handover.ts`**

```ts
// Relay routes for moving a candidate to another seat (plan §3.2, Addendum C). The relay is untrusted: it cannot read the PIN (sealed
// to the cell) or the restored answers (sealed to the new seat), and cannot forge the cell's certificate or grant. It holds PIN moves
// until an invigilator approves, adds its own head (fromSeq, fromHead: what the old seat delivered, ✓✓), forwards to the cell, and keeps
// the new binding so it can verify the new seat's entries. ponytail: pending moves live in memory; after a relay restart the seat asks again.
import type { HandoverApproval, HandoverGrant, HandoverReq } from '@saakshi/core/handover';
import type { Ctx } from '@saakshi/core/protocol';
import { parseHandoverReq } from '@saakshi/core/wire';
import type { Bindings } from './bindings.ts';
import type { Routes } from './serve.ts';

export interface RelayHandoverOpts {
  exam: string; shift: string; cellUrl: string; bindings: Bindings;
  /** The relay's committed head for the stream. */
  head: (c: Ctx) => { seq: number; h: string };
  fetch?: typeof fetch; now?: () => number; log?: (line: string) => void; retryMs?: number; tries?: number; timeoutMs?: number;
}
interface Move { req: HandoverReq; at: number; state: 'pending' | 'granted' | 'refused'; grant?: HandoverGrant; error?: string; code?: string; busy?: Promise<void> }
/** What the console shows and the invigilator approves: 16 hex of the new seat's key (the seat shows the same). */
export const moveKey = (pub: string): string => pub.slice(2, 18);
const json = (body: unknown, status = 200) => Response.json(body, { status });

export function relayHandover(o: RelayHandoverOpts): Routes {
  const f = o.fetch ?? fetch, now = o.now ?? Date.now, log = o.log ?? ((l: string) => console.log(l));
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const moves = new Map<string, Move>();                                              // `${cand}/${pub}`
  const find = (cand: string, key: string) => [...moves.values()].find((m) => m.req.cand === cand && moveKey(m.req.pub) === key);
  const seatReply = (m: Move) => m.state === 'granted' ? json({ state: 'granted', grant: m.grant })
    : m.state === 'refused' ? json({ state: 'refused', error: m.error, code: m.code }, 409) : json({ state: 'pending', ...(m.error ? { error: m.error } : {}) }, 202);

  async function forward(m: Move, approval?: HandoverApproval): Promise<void> {
    const h = o.head(m.req);
    const body = JSON.stringify({ req: m.req, ...(approval ? { approval } : {}), ...(m.req.proof.via === 'pin' ? { fromSeq: h.seq, fromHead: h.h } : {}) });
    for (let i = 0; i < (o.tries ?? 20); i++) {
      let r: Response;
      try { r = await f(`${o.cellUrl}/v1/handover`, { method: 'POST', headers: { 'content-type': 'application/json' }, body, signal: AbortSignal.timeout(o.timeoutMs ?? 5000) }); }
      catch (e) { m.error = `the exam server is unreachable (${(e as Error).message})`; return; }
      const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
      if (r.status === 200) {
        const g = j as unknown as HandoverGrant;
        const err = o.bindings.accept(g.bind);
        if (err) { Object.assign(m, { state: 'refused', error: `the exam server's certificate does not verify here: ${err}`, code: 'BAD' }); return; }
        Object.assign(m, { state: 'granted', grant: g, error: undefined });
        log(`HANDOVER-GRANTED ${JSON.stringify({ cand: m.req.cand, seat: m.req.seatId, keyEpoch: g.grant.keyEpoch, fromSeq: g.grant.fromSeq, via: g.via, approvedBy: g.approvedBy, creditedMs: g.grant.creditedMs })}`);
        return;
      }
      if (r.status === 503 || j.code === 'BEHIND') { m.error = String(j.error ?? 'the exam server is catching up'); await sleep(o.retryMs ?? 500); continue; }
      Object.assign(m, { state: 'refused', error: String(j.error ?? `the exam server answered ${r.status}`), code: String(j.code ?? r.status) });
      return;
    }
  }
  // Two approvals (or a double click) share one forward.
  const once = (m: Move, approval?: HandoverApproval): Promise<void> => (m.busy ??= forward(m, approval).finally(() => { m.busy = undefined; }));

  return {
    '/v1/handover': { POST: async (req) => {
      let r: HandoverReq;
      try { r = parseHandoverReq(await req.json()); } catch (e) { return json({ error: (e as Error).message }, 400); }
      if (r.exam !== o.exam || r.shift !== o.shift) return json({ error: `this relay serves ${o.exam} ${o.shift}` }, 400);
      const k = `${r.cand}/${r.pub}`;
      let m = moves.get(k);
      if (m && m.state !== 'refused') return seatReply(m);
      m = { req: r, at: now(), state: 'pending' };
      moves.set(k, m);
      if (r.proof.via === 'key') await once(m);
      else log(`HANDOVER-REQUEST ${JSON.stringify({ cand: r.cand, seat: r.seatId, key: moveKey(r.pub) })}`);
      return seatReply(m);
    } },
    '/v1/handover/pending': { GET: () => json({ pending: [...moves.values()].filter((m) => m.state === 'pending').sort((a, b) => a.at - b.at)
      .map((m) => ({ cand: m.req.cand, seatId: m.req.seatId, key: moveKey(m.req.pub), at: m.at, error: m.error ?? '' })) }) },
    '/v1/handover/approve': { POST: async (req) => {
      const b = (await req.json().catch(() => null)) as { cand?: unknown; key?: unknown; invigilator?: unknown } | null;
      const by = typeof b?.invigilator === 'string' ? b.invigilator.trim() : '';
      if (typeof b?.cand !== 'string' || typeof b.key !== 'string' || !by || by.length > 64) return json({ error: 'need {cand, key, invigilator}' }, 400);
      const m = find(b.cand, b.key);
      if (!m) return json({ error: `no move for ${b.cand} with key ${b.key}` }, 404);
      if (m.state === 'pending') await once(m, { by, at: now() });
      if (m.state === 'granted') return json({ state: 'granted', keyEpoch: m.grant!.grant.keyEpoch, fromSeq: m.grant!.grant.fromSeq, creditedMs: m.grant!.grant.creditedMs });
      return m.state === 'refused' ? json({ state: 'refused', error: m.error, code: m.code }, 409) : json({ state: 'pending', error: m.error ?? '' }, 202);
    } },
    '/v1/handover/refuse': { POST: async (req) => {
      const b = (await req.json().catch(() => null)) as { cand?: unknown; key?: unknown } | null;
      const m = typeof b?.cand === 'string' && typeof b.key === 'string' ? find(b.cand, b.key) : undefined;
      if (!m || m.state !== 'pending') return json({ error: 'no such pending move' }, 404);
      Object.assign(m, { state: 'refused', error: 'the invigilator refused this move', code: 'REFUSED' });
      log(`HANDOVER-REFUSED ${JSON.stringify({ cand: m.req.cand, seat: m.req.seatId })}`);
      return json({ state: 'refused' });
    } },
  };
}
```

- [ ] **Step 4: `console-view.ts` additions**

```ts
import type { CentreStatus } from '@saakshi/core/ops';

export interface PendingMove { cand: string; seatId: string; key: string; at: number; error: string }
export const fmtMs = (ms: number): string => `${Math.floor(ms / 60_000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
export function moveRow(m: PendingMove, now: number): { text: string; aria: string } {
  const age = Math.max(0, Math.round((now - m.at) / 1000));
  return { text: `${m.cand} → ${m.seatId} · key ${m.key.replace(/(.{4})(?=.)/g, '$1 ')} · waiting ${age} s${m.error ? ` · ${m.error}` : ''}`,
    aria: `Move ${m.cand} to seat ${m.seatId}, waiting ${age} seconds` };
}
export function approveText(status: number, b: { keyEpoch?: number; fromSeq?: number; creditedMs?: number; error?: string }): { text: string; tone: 'good' | 'bad' } {
  if (status === 200) return { text: `Moved: the new seat continues from entry ${b.fromSeq} (key epoch ${b.keyEpoch}). +${fmtMs(b.creditedMs ?? 0)} credited, approved by you.`, tone: 'good' };
  if (status === 202) return { text: `Waiting for the exam server: ${b.error || 'no answer yet'}. Approve again in a moment.`, tone: 'bad' };
  return { text: b.error ?? `HTTP ${status}`, tone: 'bad' };
}
export function linkText(s: CentreStatus): { text: string; tone: 'good' | 'bad' } {
  const head = `Link to the exam server: ${s.link}.`;
  if (s.link === 'down') return { text: `${head} Seats keep working; answers wait here (✓✓).`, tone: 'bad' };
  if (s.cell === 'REBUILDING') return { text: `${head} The exam server is rebuilding from the relays${s.etaMs !== undefined ? ` (about ${fmtMs(s.etaMs)} left)` : ''}.`, tone: 'bad' };
  return { text: s.link === 'degraded' ? `${head} Slow: a failure is likely; the offline code can be pre-staged.` : head, tone: s.link === 'up' ? 'good' : 'bad' };
}
```

- [ ] **Step 5: The console page**

`console.html` — after the Paper section, before DEV chaos:
```html
    <h2>Moves between seats</h2>
    <p id="link" role="status">…</p>
    <form id="inv-form"><label>Your invigilator ID <input id="inv" autocomplete="off" required size="12" /></label></form>
    <ul id="moves" aria-label="Moves waiting for approval"></ul>
    <p class="note">Check the candidate's admit card before approving. The PIN they typed goes sealed to the exam server; this console never sees it. Compare the key with the one on the new seat's screen.</p>
    <p id="moves-out" class="out" role="status"></p>
```
CSS additions (the scale is unchanged): `#moves { list-style: none; padding: 0; display: grid; gap: .5rem; } #moves li { display: flex; flex-wrap: wrap; gap: .5rem; align-items: center; border: 1px solid #dadce0; border-radius: .5rem; padding: .5rem .75rem; }` and `#link.good { color: #1e6b25; } #link.bad { color: #b3261e; font-weight: 700; }`.

`console.ts` — append:
```ts
import { approveText, linkText, moveRow, type PendingMove } from './console-view.ts';
import type { CentreStatus } from '@saakshi/core/ops';

const inv = document.getElementById('inv') as HTMLInputElement;
async function decide(m: PendingMove, action: 'approve' | 'refuse'): Promise<void> {
  if (action === 'approve' && !inv.value.trim()) { say('moves-out', 'Enter your invigilator ID first.', 'bad'); inv.focus(); return; }
  const r = await fetch(`/v1/handover/${action}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cand: m.cand, key: m.key, invigilator: inv.value }) });
  const j = (await r.json().catch(() => ({}))) as { keyEpoch?: number; fromSeq?: number; creditedMs?: number; error?: string };
  const out = action === 'refuse' ? { text: r.ok ? `Refused the move of ${m.cand}.` : (j.error ?? `HTTP ${r.status}`), tone: r.ok ? 'good' as const : 'bad' as const } : approveText(r.status, j);
  say('moves-out', out.text, out.tone);
  void movesTick();
}
async function movesTick(): Promise<void> {
  try {
    const r = await fetch('/v1/handover/pending');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const { pending } = (await r.json()) as { pending: PendingMove[] };
    const now = Date.now();
    (document.getElementById('moves') as HTMLUListElement).replaceChildren(...pending.map((m) => {
      const row = moveRow(m, now), li = document.createElement('li'), span = document.createElement('span');
      li.setAttribute('aria-label', row.aria);
      span.textContent = row.text;
      const ok = document.createElement('button'), no = document.createElement('button');
      ok.className = 'primary'; ok.textContent = `Approve the move of ${m.cand}`; ok.addEventListener('click', () => void decide(m, 'approve'));
      no.textContent = 'Refuse'; no.addEventListener('click', () => void decide(m, 'refuse'));
      li.append(span, ok, no);
      return li;
    }));
  } catch { /* a relay without EXAM has no moves */ }
}
async function linkTick(): Promise<void> {
  const el = document.getElementById('link') as HTMLParagraphElement;
  try {
    const r = await fetch('/v1/status');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const s = linkText((await r.json()) as CentreStatus);
    el.textContent = s.text; el.className = s.tone;
  } catch { el.textContent = 'Link status unavailable.'; el.className = 'bad'; }
}
void movesTick(); void linkTick();
setInterval(movesTick, 2000); setInterval(linkTick, 2000);
```
(`say` already exists in `console.ts`; it sets `className = out <tone>`.)

- [ ] **Step 6: Run the tests**

Run: `bun test --timeout 60000 apps/server/test/relay-handover.test.ts apps/server/test/console-view.test.ts && pnpm --filter @saakshi/server typecheck`
Expected: PASS, including the existing UI-rules test (`console.html` keeps the 1.25 scale; `console.ts` uses no `innerHTML`).

---

### Task 5: The relay's link — SYNC_LAG prediction, "Degrade Centre 42's link", the seats' banner status

**Files:**
- Create: `apps/server/src/link.ts`, `apps/server/src/relay-ops.ts`
- Modify: `apps/server/src/relay-routes.ts` (`Wan`: degrade, injectable `rand`/`sleep`)
- Test: `apps/server/test/link.test.ts`

**Interfaces:**
- Consumes: Task 1 (`RoundSample`, `LinkView`, `CentreStatus`); `Routes`.
- Produces: `class LinkMonitor { constructor(o: { centre: string; alpha?; warnRttMs?; warnErr?; downMs?; growRounds?; now? }); record(r: RoundSample): void; view(now: number, x: { cut: boolean; degraded: boolean }): LinkView }`; `statusOf(v: LinkView, now: number): CentreStatus`; `relayOps(o: { centre; link: LinkMonitor; wan: Wan; dev: boolean; now?; log? }): Routes` (`/v1/link`, `/v1/status`, DEV `/v1/dev/degrade`); `new Wan({ rand?, sleep? })` with `degraded: boolean`.

- [ ] **Step 1: Write the failing tests**

`apps/server/test/link.test.ts`:
```ts
import { expect, test } from 'bun:test';
import type { SyncReq } from '@saakshi/core/wire';
import { LinkMonitor, statusOf } from '../src/link.ts';
import { relayOps } from '../src/relay-ops.ts';
import { Wan } from '../src/relay-routes.ts';

const req: SyncReq = { entries: [], streams: [] };

test('SYNC_LAG: a degrading link warns before it goes down; a cut is down at once; no traffic is not an alarm', () => {
  let t = 0;
  const m = new LinkMonitor({ centre: 'CEN042' });
  const view = () => m.view(t, { cut: false, degraded: true });
  expect(view()).toMatchObject({ risk: 'ok', reason: 'no traffic yet', cell: 'LIVE' });
  for (let i = 0; i < 5; i++) { t += 2_000; m.record({ at: t, ms: 40, ok: true, backlog: 0, replaying: false }); }
  expect(view()).toMatchObject({ risk: 'ok', reason: 'healthy' });
  let warnAt = 0;
  for (let i = 1; i <= 20 && !warnAt; i++) { t += 2_000 + 250 * i; m.record({ at: t, ms: 250 * i, ok: true, backlog: 3 * i, replaying: false }); if (view().risk === 'warn') warnAt = t; }
  expect(warnAt).toBeGreaterThan(0);
  expect(view().reason).toMatch(/^WAN failure likely: /);
  for (let i = 0; i < 3; i++) { t += 5_000; m.record({ at: t, ms: 5_000, ok: false, backlog: 80, replaying: false }); }
  expect(view()).toMatchObject({ risk: 'down', cell: 'unreachable', reason: expect.stringContaining('no answer from the exam server for 15 s') });
  expect(m.view(t, { cut: true, degraded: false })).toMatchObject({ risk: 'down', up: false, cut: true, reason: 'the link is cut' });
});

test('a rebuilding cell: the view says REBUILDING, with an ETA from the drain rate', () => {
  const m = new LinkMonitor({ centre: 'CEN042' });
  [1_000, 800, 600].forEach((backlog, i) => m.record({ at: 10_000 + 2_000 * i, ms: 30, ok: true, backlog, replaying: true }));
  expect(m.view(14_000, { cut: false, degraded: false })).toMatchObject({ cell: 'REBUILDING', etaMs: 6_000, backlog: 600 });
  expect(statusOf(m.view(14_000, { cut: false, degraded: false }), 14_000)).toEqual({ link: 'up', cell: 'REBUILDING', etaMs: 6_000, at: 14_000 });
});

test('Wan: cut rejects at once; degrade adds a growing delay and loses some requests; clearing it removes the delay', async () => {
  const sleeps: number[] = [];
  let r = 0.5;
  const w = new Wan({ rand: () => r, sleep: async (ms) => { sleeps.push(ms); } });
  const send = w.wrap(async () => ({ streams: [], rejected: [] }));
  w.degraded = true;
  await send(req); await send(req);
  expect(sleeps).toEqual([250, 500]);
  r = 0.1;
  await expect(send(req)).rejects.toThrow(/degraded/);
  w.degraded = false; r = 0.5;
  await send(req);
  expect(sleeps.length).toBe(3);
  w.up = false;
  await expect(send(req)).rejects.toThrow(/WAN down/);
});

test('relay ops routes: /v1/link, /v1/status for the seats, and the DEV degrade switch (logged)', async () => {
  const logs: string[] = [];
  const w = new Wan(), link = new LinkMonitor({ centre: 'CEN042' });
  const routes = relayOps({ centre: 'CEN042', link, wan: w, dev: true, now: () => 7, log: (l) => logs.push(l) });
  const get = async (p: string) => (await routes[p].GET!(new Request(`http://r${p}`), { timeout() {} })).json();
  const post = async (p: string, b: unknown) => routes[p].POST!(new Request(`http://r${p}`, { method: 'POST', body: JSON.stringify(b) }), { timeout() {} });
  expect(await get('/v1/status')).toEqual({ link: 'up', cell: 'LIVE', at: 7 });
  expect((await post('/v1/dev/degrade', { on: 'yes' })).status).toBe(400);
  expect(await (await post('/v1/dev/degrade', { on: true })).json()).toEqual({ degraded: true });
  expect([w.degraded, logs]).toEqual([true, ['WAN DEGRADED (DEV chaos)']]);
  expect(await get('/v1/status')).toEqual({ link: 'degraded', cell: 'LIVE', at: 7 });
  expect(await get('/v1/link')).toMatchObject({ centre: 'CEN042', degraded: true, risk: 'ok' });
  expect(relayOps({ centre: 'CEN042', link, wan: w, dev: false })['/v1/dev/degrade']).toBeUndefined();
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `bun test --timeout 60000 apps/server/test/link.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: `apps/server/src/link.ts`**

```ts
// SYNC_LAG (plan §3.10): the relay's view of its WAN link, from one sample per forwarder round. A threshold on EWMA-smoothed round
// time and failure rate, plus a growing backlog, warns that the link is likely to fail; no answer for `downMs` after a failure is
// down. Honest claim: it warned before the cut in our chaos drills; it is not validated on real WAN data.
import type { CentreStatus, LinkView, RoundSample } from '@saakshi/core/ops';

export interface LinkOpts { centre: string; alpha?: number; warnRttMs?: number; warnErr?: number; downMs?: number; growRounds?: number }

export class LinkMonitor {
  #o: LinkOpts;
  #rtt = 0; #err = 0; #n = 0; #lastOk = 0; #first = 0; #grow = 0;
  #last?: RoundSample;
  #recent: { at: number; backlog: number }[] = [];

  constructor(o: LinkOpts) { this.#o = o; }

  record(r: RoundSample): void {
    const a = this.#o.alpha ?? 0.3;
    if (!this.#n) this.#first = r.at;
    this.#rtt = this.#n ? a * r.ms + (1 - a) * this.#rtt : r.ms;
    this.#err = this.#n ? a * (r.ok ? 0 : 1) + (1 - a) * this.#err : r.ok ? 0 : 1;
    this.#n++;
    if (r.ok) this.#lastOk = r.at;
    const prev = this.#last?.backlog ?? 0;
    this.#grow = r.backlog > prev ? this.#grow + 1 : r.backlog > 0 && r.backlog === prev ? this.#grow : 0;
    this.#last = r;
    this.#recent.push({ at: r.at, backlog: r.backlog });
    if (this.#recent.length > 10) this.#recent.shift();
  }

  view(now: number, x: { cut: boolean; degraded: boolean }): LinkView {
    const l = this.#last, why: string[] = [], okAt = this.#lastOk || this.#first;     // never reached yet: count from the first try
    let risk: LinkView['risk'] = 'ok';
    if (x.cut) { risk = 'down'; why.push('the link is cut'); }
    else if (l && !l.ok && now - okAt > (this.#o.downMs ?? 10_000)) { risk = 'down'; why.push(`no answer from the exam server for ${Math.round((now - okAt) / 1000)} s`); }
    else {
      if (this.#n >= 3 && this.#rtt > (this.#o.warnRttMs ?? 1_500)) why.push(`round trips ${(this.#rtt / 1000).toFixed(1)} s (smoothed)`);
      if (this.#n >= 3 && this.#err > (this.#o.warnErr ?? 0.3)) why.push(`${Math.round(this.#err * 100)}% of rounds failing (smoothed)`);
      if (this.#grow >= (this.#o.growRounds ?? 5)) why.push(`backlog growing for ${this.#grow} rounds (${l?.backlog ?? 0} entries)`);
      if (why.length) risk = 'warn';
    }
    const reason = risk === 'warn' ? `WAN failure likely: ${why.join('; ')}` : why.join('; ') || (this.#n ? 'healthy' : 'no traffic yet');
    const eta = l?.replaying ? this.#eta() : undefined;
    return {
      centre: this.#o.centre, up: !x.cut, cut: x.cut, degraded: x.degraded, rttMs: Math.round(this.#rtt), errRate: Math.round(this.#err * 100) / 100,
      backlog: l?.backlog ?? 0, lastContactAt: this.#lastOk, risk, reason, ...(eta !== undefined ? { etaMs: eta } : {}),
      cell: !l ? 'LIVE' : l.replaying ? 'REBUILDING' : risk === 'down' ? 'unreachable' : 'LIVE',
    };
  }

  /** Remaining backlog over the recent drain rate; undefined while it is not draining. */
  #eta(): number | undefined {
    const a = this.#recent[0], b = this.#recent.at(-1)!;
    if (!a || b.at <= a.at || a.backlog <= b.backlog) return undefined;
    return Math.round(b.backlog / ((a.backlog - b.backlog) / (b.at - a.at)));
  }
}

/** What the relay tells its seats (the in-exam banner). */
export const statusOf = (v: LinkView, now: number): CentreStatus => ({
  link: v.risk === 'down' ? 'down' : v.risk === 'warn' || v.degraded ? 'degraded' : 'up', cell: v.cell, ...(v.etaMs !== undefined ? { etaMs: v.etaMs } : {}), at: now,
});
```

- [ ] **Step 4: `Wan` in `relay-routes.ts` and `apps/server/src/relay-ops.ts`**

```ts
/** DEV chaos: "Cut Centre 42's link" (up = false) and "Degrade Centre 42's link" (a growing delay, some requests lost). */
export class Wan {
  up = true;
  degraded = false;
  #delay = 0;
  #rand: () => number;
  #sleep: (ms: number) => Promise<unknown>;
  constructor(o: { rand?: () => number; sleep?: (ms: number) => Promise<unknown> } = {}) { this.#rand = o.rand ?? Math.random; this.#sleep = o.sleep ?? ((ms) => Bun.sleep(ms)); }
  wrap(send: CellSend): CellSend {
    return async (req) => {
      if (!this.up) throw new Error('WAN down (DEV chaos)');
      if (!this.degraded) { this.#delay = 0; return send(req); }
      this.#delay = Math.min(4_000, this.#delay + 250);                               // under httpCellSend's 5 s timeout
      await this.#sleep(this.#delay);
      if (this.#rand() < 0.3) throw new Error('WAN degraded (DEV chaos): request lost');
      return send(req);
    };
  }
}
```
`apps/server/src/relay-ops.ts`:
```ts
// Relay routes added in Stage 4: its link view for control (SYNC_LAG), the status its seats show in the banner, and DEV chaos
// ("Degrade Centre 42's link").
import { statusOf, type LinkMonitor } from './link.ts';
import type { Wan } from './relay-routes.ts';
import type { Routes } from './serve.ts';

const json = (body: unknown, status = 200) => Response.json(body, { status });
export function relayOps(o: { centre: string; link: LinkMonitor; wan: Wan; dev: boolean; now?: () => number; log?: (line: string) => void }): Routes {
  const now = o.now ?? Date.now, log = o.log ?? ((l: string) => console.log(l));
  const view = () => o.link.view(now(), { cut: !o.wan.up, degraded: o.wan.degraded });
  const routes: Routes = {
    '/v1/link': { GET: () => json(view()) },
    '/v1/status': { GET: () => json(statusOf(view(), now())) },
  };
  if (o.dev) routes['/v1/dev/degrade'] = { POST: async (req) => {
    const b = (await req.json().catch(() => null)) as { on?: unknown } | null;
    if (typeof b?.on !== 'boolean') return json({ error: 'need {on: boolean}' }, 400);
    o.wan.degraded = b.on;
    log(b.on ? 'WAN DEGRADED (DEV chaos)' : 'WAN RESTORED from degraded (DEV chaos)');
    return json({ degraded: o.wan.degraded });
  } };
  return routes;
}
```

- [ ] **Step 5: Run the tests**

Run: `bun test --timeout 60000 apps/server/test/link.test.ts apps/server/test/relay-routes.test.ts && pnpm --filter @saakshi/server typecheck`
Expected: PASS (`new Wan()` keeps working for the Stage 3 routes and tests).

---
### Task 6: Incident rules — P0–P3, blast radius, the escalation ladder, debounce; the CERT-In draft

**Files:**
- Create: `apps/server/src/incidents.ts`, `apps/server/src/certin.ts`
- Test: `apps/server/test/incidents.test.ts`

**Interfaces:**
- Consumes: Task 1 (`Ops`, `OPS_DEMO`, `RUNGS`, `Incident`, `IncidentKind`, `Blast`, `CellEvent`, `LinkView`, `Directory`, `FleetView`, `ReleaseStatus`, `Finding`, `HeadsRes`).
- Produces:
  - `interface Snapshot { now; fleet?: FleetView; events?: CellEvent[]; link?: LinkView; relay?: HeadsRes; release?: ReleaseStatus; findings?: Finding[] }`.
  - `class Incidents { constructor(dir: Directory, ops: Ops, hooks?: { regulator?: (i: Incident) => string | undefined }); evaluate(s: Snapshot): Incident[] /* changed */; all(); open(); get(id); ack(id, by, now): Incident; resolve(id, now): Incident }` (throws `Error` with a message on bad input).
  - `SEVERITY`, `dcName(cell)`, `blastText(b)`, `mmss(ms)`.
  - `certInHtml(i: Incident, o: { exam: string; shift: string; now: number }): string`.
- Both files are browser-safe (the control page imports `blastText`, `dcName`, `mmss`).

- [ ] **Step 1: Write the failing tests**

`apps/server/test/incidents.test.ts`:
```ts
import { expect, test } from 'bun:test';
import type { Directory, FleetView } from '@saakshi/core/directory';
import { OPS_DEMO, type CellEvent, type LinkView } from '@saakshi/core/ops';
import type { HeadsRes } from '@saakshi/core/wire';
import { certInHtml } from '../src/certin.ts';
import { blastText, Incidents } from '../src/incidents.ts';

const e = (centre: string) => ({ centre, form: 'F1' as const, extraMs: 0, pseud: '7'.repeat(64) });
const dir = { v: 1, exam: 'DEMO-2026', shift: 'S1', durationMs: 1_800_000, demoCentre: 'CEN042', issuedAt: 0, cells: [],
  centres: { CEN042: { cell: 'cell-1' }, CEN001: { cell: 'cell-2' }, CEN002: { cell: 'cell-2' } },
  cands: { C0001: e('CEN042'), C0002: e('CEN042'), C0003: e('CEN042'), C0004: e('CEN042'), A1: e('CEN001'), A2: e('CEN001'), A3: e('CEN001'), B1: e('CEN002'), B2: e('CEN002') } } as unknown as Directory;
const fleet = (cell2: FleetView['cells'][number], tones: Record<string, 'green' | 'locked' | 'partial' | 'down'> = {}): FleetView => ({
  at: 0, registered: 9, bound: 9, unlocked: 9, submitted: 0, entries: 0, entriesPerSec: 0,
  cells: [{ id: 'cell-1', state: 'LIVE', entries: 100 }, cell2],
  centres: ['CEN001', 'CEN002', 'CEN042'].map((centre) => ({ centre, cell: dir.centres[centre].cell, registered: centre === 'CEN042' ? 4 : centre === 'CEN001' ? 3 : 2, bound: 0, unlocked: 0, submitted: 0, entries: 0, tone: tones[centre] ?? 'green' })),
});
const link = (risk: LinkView['risk'], o: Partial<LinkView> = {}): LinkView => ({ centre: 'CEN042', up: risk !== 'down', cut: false, degraded: false, rttMs: 40, errRate: 0, backlog: 0, lastContactAt: 0, risk, reason: risk === 'warn' ? 'WAN failure likely: round trips 2.1 s (smoothed)' : 'healthy', cell: 'LIVE', ...o });
let evId = 0;
const ev = (code: CellEvent['code'], cand: string, seq: number, data?: CellEvent['data'], reason = ''): CellEvent => ({ id: ++evId, at: 0, cell: 'cell-1', code, cand, centre: 'CEN042', seq, reason, ...(data ? { data } : {}) });

test('CELL_DOWN: a P1 at the control rung with its blast radius; it closes after rebuilding with the answers lost measured', () => {
  const x = new Incidents(dir, OPS_DEMO);
  x.evaluate({ now: 0, fleet: fleet({ id: 'cell-2', state: 'LIVE', entries: 500 }) });
  const [i] = x.evaluate({ now: 1_000, fleet: fleet({ id: 'cell-2', state: 'DOWN', entries: 500 }) });
  expect(i).toMatchObject({ kind: 'CELL_DOWN', severity: 'P1', rung: 2, title: 'Data Centre 2 is down', blast: { cells: ['cell-2'], centres: ['CEN001', 'CEN002'], candidates: 5, answersLost: null } });
  expect(blastText(i.blast)).toBe('1 cell · 2 centres · 5 candidates · answers lost: not known yet');
  expect(x.evaluate({ now: 2_000, fleet: fleet({ id: 'cell-2', state: 'REBUILDING', entries: 120, rebuild: { done: 1, expected: 2 } }) })[0].detail).toBe('1 of 2 relays have replayed');
  x.evaluate({ now: 3_000, fleet: fleet({ id: 'cell-2', state: 'LIVE', entries: 530 }) });
  expect(x.get(i.id)!.resolvedAt).toBeUndefined();                                 // debounce: clear for clearMs first
  x.evaluate({ now: 8_000, fleet: fleet({ id: 'cell-2', state: 'LIVE', entries: 530 }) });
  expect(x.get(i.id)).toMatchObject({ resolvedAt: 8_000, blast: { answersLost: 0 }, data: { before: 500, after: 530 } });

  const y = new Incidents(dir, OPS_DEMO);                                             // a rebuild that came back short
  y.evaluate({ now: 0, fleet: fleet({ id: 'cell-2', state: 'LIVE', entries: 500 }) });
  y.evaluate({ now: 1, fleet: fleet({ id: 'cell-2', state: 'DOWN', entries: 500 }) });
  y.evaluate({ now: 2, fleet: fleet({ id: 'cell-2', state: 'LIVE', entries: 480 }) });
  expect(y.evaluate({ now: 6_000, fleet: fleet({ id: 'cell-2', state: 'LIVE', entries: 480 }) })[0].blast.answersLost).toBe(20);
});

test('the ladder: unacknowledged incidents climb every ladderMs to their top rung; TAMPER at the regulator drafts CERT-In once; an ack stops it', () => {
  const drafted: string[] = [];
  const x = new Incidents(dir, OPS_DEMO, { regulator: (i) => { drafted.push(i.id); return `certin/${i.id}.html`; } });
  const [t] = x.evaluate({ now: 0, events: [ev('FORK', 'C0001', 7, undefined, 'seq 7 already holds a different signed entry')] });
  expect(t).toMatchObject({ kind: 'TAMPER', severity: 'P0', rung: 2 });
  const [b] = x.evaluate({ now: 0, events: [ev('BAD_SUBMISSION', 'C0002', 3, undefined, 'signature does not verify')] });
  const [h] = x.evaluate({ now: 0, events: [ev('HANDOVER', 'C0003', 6, { keyEpoch: 2, fromSeq: 6, via: 'pin', approvedBy: 'INV-42-A', creditedMs: 108_000, seatId: 'CEN042-S02' })] });
  x.evaluate({ now: 9_999 });
  expect([x.get(t.id)!.rung, x.get(b.id)!.rung]).toEqual([2, 0]);
  x.evaluate({ now: 10_000 });
  expect([x.get(t.id)!.rung, x.get(t.id)!.certIn, x.get(b.id)!.rung]).toEqual([3, `certin/${t.id}.html`, 1]);
  x.evaluate({ now: 20_000 }); x.evaluate({ now: 40_000 });
  expect([x.get(t.id)!.ladder.map((l) => l.rung), x.get(b.id)!.rung, x.get(h.id)!.rung]).toEqual([['control', 'regulator'], 2, 0]);   // P2 tops at control; P3 never climbs
  expect(drafted).toEqual([t.id]);
  const [t2] = x.evaluate({ now: 50_000, events: [ev('FORK', 'C0004', 2, undefined, 'x')] });
  x.ack(t2.id, ' SUP-42 ', 55_000);
  x.evaluate({ now: 70_000 });
  expect(x.get(t2.id)).toMatchObject({ rung: 2, ack: { by: 'SUP-42', rung: 'control', at: 55_000 } });
  expect(() => x.ack('NOPE-1', 'x', 1)).toThrow(/no incident/);
  expect(() => x.ack(t2.id, '  ', 1)).toThrow(/who/);
  expect(() => x.resolve(x.open().find((i) => i.kind === 'TAMPER')!.id, 1)).not.toThrow();
});

test('SYNC_LAG predicts; the cut opens RELAY_WAN_DOWN, which records how much earlier the warning came', () => {
  const x = new Incidents(dir, OPS_DEMO);
  const [w] = x.evaluate({ now: 0, link: link('warn') });
  expect(w).toMatchObject({ kind: 'SYNC_LAG', severity: 'P2', rung: 0, title: 'WAN failure likely at CEN042 (predicted)', blast: { centres: ['CEN042'], candidates: 4 } });
  const [d] = x.evaluate({ now: 12_000, link: link('down', { cut: true, reason: 'the link is cut' }) }).filter((i) => i.kind === 'RELAY_WAN_DOWN');
  expect(d.data.warnedMs).toBe(12_000);
  x.evaluate({ now: 17_000, link: link('down', { cut: true }) });
  expect(x.get(w.id)!.resolvedAt).toBe(17_000);
});

test('Review Focus #5: a flapping link keeps one incident until it has been clear for clearMs', () => {
  const x = new Incidents(dir, OPS_DEMO);                                             // clearMs = 5 s
  x.evaluate({ now: 0, link: link('down') });
  x.evaluate({ now: 1_000, link: link('ok') });
  x.evaluate({ now: 3_000, link: link('down') });
  x.evaluate({ now: 4_000, link: link('ok') });
  x.evaluate({ now: 8_999, link: link('ok') });
  expect(x.all().filter((i) => i.kind === 'RELAY_WAN_DOWN').map((i) => i.resolvedAt)).toEqual([undefined]);
  x.evaluate({ now: 9_000, link: link('ok') });
  x.evaluate({ now: 20_000, link: link('down') });
  expect(x.all().filter((i) => i.kind === 'RELAY_WAN_DOWN').map((i) => i.resolvedAt)).toEqual([9_000, undefined]);
});

test('silence: seats going quiet together are one CENTRE_OUTAGE; a lone quiet seat is SEAT_SILENT; submitted seats are ignored', () => {
  const heads = (seen: [string, number, boolean?][]): HeadsRes => ({ mode: 'relay', state: 'LIVE', streams: seen.map(([cand, seenAt, done]) =>
    ({ exam: 'DEMO-2026', shift: 'S1', attempt: 1, cand, head: 5, cellHead: 5, senderHead: 5, seenAt, ...(done ? { submitted: true as const } : {}) })) });
  const x = new Incidents(dir, OPS_DEMO);
  const out = x.evaluate({ now: 60_000, relay: heads([['C0001', 20_000], ['C0002', 21_000], ['C0003', 22_000], ['C0004', 59_000]]) });
  expect(out.map((i) => [i.kind, i.severity, i.blast.candidates])).toEqual([['CENTRE_OUTAGE', 'P1', 3]]);
  const y = new Incidents(dir, OPS_DEMO);
  expect(y.evaluate({ now: 60_000, relay: heads([['C0001', 20_000], ['C0002', 59_000], ['C0003', 59_000], ['C0004', 10_000, true]]) }).map((i) => [i.kind, i.cand])).toEqual([['SEAT_SILENT', 'C0001']]);
});

test('KEY_RELEASE_DELAY groups the centres still locked after the release; events map to incidents once, however often they arrive', () => {
  const x = new Incidents(dir, OPS_DEMO);
  const release = { released: { at: 0, custodians: ['NTA', 'NIC'], forms: [] } } as never;
  expect(x.evaluate({ now: 9_000, release, fleet: fleet({ id: 'cell-2', state: 'LIVE', entries: 1 }, { CEN042: 'locked' }) })).toEqual([]);
  const [k] = x.evaluate({ now: 11_000, release, fleet: fleet({ id: 'cell-2', state: 'LIVE', entries: 1 }, { CEN042: 'locked', CEN001: 'partial' }) });
  expect(k).toMatchObject({ kind: 'KEY_RELEASE_DELAY', severity: 'P1', title: '1 centre still locked after the release', blast: { centres: ['CEN042'], candidates: 4 } });

  const gap = ev('GAP', 'C0002', 9, { cause: 'suspend', pausedMs: 125_000 });
  const again = { ...gap, id: 999 };                                                   // the same entry, re-noted after a cell rebuild
  const crit = ev('INTEGRITY', 'C0003', 4, { code: 'remote-session' });
  const test = ev('INTEGRITY', 'C0004', 2, { code: 'test-mode' });
  const got = x.evaluate({ now: 12_000, events: [gap, again, crit, test, ev('ORPHANED', 'C0001', 7, undefined, 'moved'), ev('LATE', 'C0001', 30, undefined, 'late')] });
  expect(got.map((i) => [i.kind, i.severity, i.cand])).toEqual([['GAP', 'P3', 'C0002'], ['INTEGRITY_CRITICAL', 'P1', 'C0003'], ['ORPHANED', 'P3', 'C0001'], ['LATE', 'P2', 'C0001']]);
  expect(got[0]).toMatchObject({ title: 'C0002 paused (suspend)', data: { seq: 9, cause: 'suspend', pausedMs: 125_000 } });
  const f = x.evaluate({ now: 13_000, findings: [{ cand: 'C0002', seq: 17, kind: 'body', detail: 'Q17: record says C — the seat committed B', recovered: { from: 'option-search', value: 'B' } }] });
  expect(f[0]).toMatchObject({ kind: 'TAMPER', title: 'The record for C0002 was altered', detail: 'entry 17: Q17: record says C — the seat committed B', blast: { answersLost: 0 } });
});

test('CERT-In: a draft template with the facts, the 6-hour deadline, blanks for the officer, and every value escaped', () => {
  const x = new Incidents(dir, OPS_DEMO);
  const [t] = x.evaluate({ now: Date.UTC(2026, 8, 27, 4, 0), events: [ev('FORK', 'C0001', 7, undefined, '<script>alert(1)</script>')] });
  const html = certInHtml(t, { exam: 'DEMO-2026', shift: 'S1', now: Date.UTC(2026, 8, 27, 4, 1) });
  expect(html).toContain('DRAFT TEMPLATE');
  expect(html).toContain('not been filed');
  expect(html).toContain('2026-09-27T10:00:00.000Z');                                // noticed 04:00 UTC + 6 h
  expect(html).toContain(t.id);
  expect(html).toContain('Unauthorised modification of exam records');
  expect(html).not.toContain('<script>alert');
  expect(html).toContain('&#60;script&#62;');
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `bun test --timeout 60000 apps/server/test/incidents.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: `apps/server/src/incidents.ts`**

```ts
// Incident rules (plan §3.10): P0–P3, blast radius, the escalation ladder with acknowledgement timers, debounce, and the CERT-In hook at
// the regulator rung. Pure and browser-safe: control's monitor feeds snapshots; the control page and /status render the results.
// Nothing here is persisted: state rules re-derive from live state, event rules from the cells' evidence (Decision 6).
import type { Directory, FleetView, ReleaseStatus } from '@saakshi/core/directory';
import { RUNGS, type Blast, type CellEvent, type Incident, type IncidentKind, type LinkView, type Ops, type Severity } from '@saakshi/core/ops';
import type { Finding } from '@saakshi/core/sheet';
import type { HeadsRes } from '@saakshi/core/wire';

export interface Snapshot { now: number; fleet?: FleetView; events?: CellEvent[]; link?: LinkView; relay?: HeadsRes; release?: ReleaseStatus; findings?: Finding[] }

export const SEVERITY: Record<IncidentKind, Severity> = {
  TAMPER: 'P0', CELL_DOWN: 'P1', CENTRE_OUTAGE: 'P1', KEY_RELEASE_DELAY: 'P1', INTEGRITY_CRITICAL: 'P1',
  RELAY_WAN_DOWN: 'P2', SYNC_LAG: 'P2', BAD_SUBMISSION: 'P2', LATE: 'P2', SEAT_SILENT: 'P3', HANDOVER: 'P3', GAP: 'P3', ORPHANED: 'P3',
};
const TOP: Record<Severity, number> = { P0: 3, P1: 3, P2: 2, P3: 0 };                 // the highest rung each severity climbs to
const AT_CONTROL = new Set<IncidentKind>(['CELL_DOWN', 'TAMPER', 'KEY_RELEASE_DELAY']);  // national scope starts at control
const CERT_IN = new Set<IncidentKind>(['TAMPER', 'INTEGRITY_CRITICAL']);
const STATEFUL = new Set<IncidentKind>(['CELL_DOWN', 'CENTRE_OUTAGE', 'SEAT_SILENT', 'RELAY_WAN_DOWN', 'SYNC_LAG', 'KEY_RELEASE_DELAY']);

export const dcName = (cell: string): string => cell.replace(/^cell-(\d+)$/, 'Data Centre $1');
const fmt = (n: number): string => n.toLocaleString('en-IN');
const plural = (n: number, w: string): string => `${fmt(n)} ${w}${n === 1 ? '' : 's'}`;
export const mmss = (ms: number): string => `${Math.floor(ms / 60_000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
export function blastText(b: Blast): string {
  return [b.cells.length ? plural(b.cells.length, 'cell') : '', plural(b.centres.length, 'centre'), plural(b.candidates, 'candidate'),
    b.answersLost === null ? 'answers lost: not known yet' : `answers lost ${fmt(b.answersLost)}`].filter(Boolean).join(' · ');
}

interface Want { kind: IncidentKind; key: string; title: string; detail: string; blast: Blast; cand?: string; data?: Record<string, string | number> }

export class Incidents {
  #dir: Directory;
  #ops: Ops;
  #regulator?: (i: Incident) => string | undefined;
  #list: Incident[] = [];
  #n = 0;
  #reg = new Map<string, number>();                 // centre → registered candidates
  #peak = new Map<string, number>();                // cell → entries when last seen LIVE
  #clear = new Map<string, number>();               // incident key → since when its condition has been clear
  #seen = new Set<string>();                        // cell events and audit findings already applied
  #warned = new Map<string, number>();              // centre → when SYNC_LAG last opened

  constructor(dir: Directory, ops: Ops, hooks: { regulator?: (i: Incident) => string | undefined } = {}) {
    this.#dir = dir; this.#ops = ops; this.#regulator = hooks.regulator;
    for (const c of Object.values(dir.cands)) this.#reg.set(c.centre, (this.#reg.get(c.centre) ?? 0) + 1);
  }

  all(): Incident[] { return [...this.#list]; }
  open(): Incident[] { return this.#list.filter((i) => !i.resolvedAt); }
  get(id: string): Incident | undefined { return this.#list.find((i) => i.id === id); }

  /** Apply one snapshot; returns the incidents that opened, changed, climbed or closed. */
  evaluate(s: Snapshot): Incident[] {
    const changed = new Set<Incident>();
    const wants = this.#stateWants(s), live = new Set(wants.map((w) => w.key));
    for (const w of wants) {
      this.#clear.delete(w.key);
      const cur = this.#openFor(w.key);
      if (!cur) changed.add(this.#open(w, s.now));
      else if (cur.title !== w.title || cur.detail !== w.detail || JSON.stringify(cur.blast) !== JSON.stringify(w.blast)) {
        Object.assign(cur, { title: w.title, detail: w.detail, blast: w.blast, updatedAt: s.now });
        changed.add(cur);
      }
    }
    for (const i of this.open()) {
      if (!STATEFUL.has(i.kind) || live.has(i.key)) continue;
      const since = this.#clear.get(i.key) ?? s.now;
      this.#clear.set(i.key, since);
      if (s.now - since >= this.#ops.clearMs) { this.#close(i, s); changed.add(i); }
    }
    for (const w of this.#eventWants(s)) {
      const cur = this.#openFor(w.key);
      if (cur) { cur.data.count = Number(cur.data.count ?? 1) + 1; cur.updatedAt = s.now; changed.add(cur); }
      else changed.add(this.#open(w, s.now));
    }
    for (const i of this.#list) if (this.#climb(i, s.now)) changed.add(i);
    for (const c of s.fleet?.cells ?? []) if (c.state === 'LIVE') this.#peak.set(c.id, c.entries);
    return [...changed];
  }

  ack(id: string, by: string, now: number): Incident {
    const i = this.get(id);
    if (!i) throw new Error(`no incident ${id}`);
    const who = by.trim();
    if (!who || who.length > 64) throw new Error('say who acknowledges (1–64 characters)');
    i.ack ??= { by: who, rung: RUNGS[i.rung], at: now };
    i.updatedAt = now;
    return i;
  }

  resolve(id: string, now: number): Incident {
    const i = this.get(id);
    if (!i) throw new Error(`no incident ${id}`);
    if (STATEFUL.has(i.kind) && !i.resolvedAt) throw new Error('this incident closes by itself when its condition clears');
    i.resolvedAt ??= now;
    i.updatedAt = now;
    return i;
  }

  #openFor(key: string): Incident | undefined { return this.#list.find((i) => i.key === key && !i.resolvedAt); }

  #open(w: Want, now: number): Incident {
    const rung = AT_CONTROL.has(w.kind) ? 2 : 0;
    const i: Incident = { id: `${w.kind}-${++this.#n}`, kind: w.kind, severity: SEVERITY[w.kind], key: w.key, title: w.title, detail: w.detail, blast: w.blast,
      openedAt: now, updatedAt: now, rung, ladder: [{ rung: RUNGS[rung], at: now }], ...(w.cand ? { cand: w.cand } : {}), data: { ...w.data } };
    const centre = w.blast.centres[0] ?? '';
    if (w.kind === 'CELL_DOWN') i.data.before = this.#peak.get(w.blast.cells[0]) ?? 0;
    if (w.kind === 'SYNC_LAG') this.#warned.set(centre, now);
    if (w.kind === 'RELAY_WAN_DOWN') { const at = this.#warned.get(centre); if (at !== undefined && now - at < 10 * 60_000) i.data.warnedMs = now - at; }
    this.#list.push(i);
    return i;
  }

  #close(i: Incident, s: Snapshot): void {
    i.resolvedAt = s.now;
    i.updatedAt = s.now;
    if (i.kind === 'CELL_DOWN') {
      const after = s.fleet?.cells.find((c) => c.id === i.blast.cells[0])?.entries ?? 0;
      i.blast = { ...i.blast, answersLost: Math.max(0, Number(i.data.before ?? 0) - after) };
      i.data.after = after;
    }
  }

  #climb(i: Incident, now: number): boolean {
    const every = this.#ops.ladderMs[i.severity];
    if (i.resolvedAt || i.ack || !every || i.rung >= TOP[i.severity] || now - i.ladder[i.ladder.length - 1].at < every) return false;
    i.rung++;
    i.ladder.push({ rung: RUNGS[i.rung], at: now });
    i.updatedAt = now;
    if (i.rung === 3 && CERT_IN.has(i.kind)) i.certIn = this.#regulator?.(i);
    return true;
  }

  #cands(centres: string[]): number { return centres.reduce((n, c) => n + (this.#reg.get(c) ?? 0), 0); }

  #stateWants(s: Snapshot): Want[] {
    const out: Want[] = [];
    for (const c of s.fleet?.cells ?? []) {
      if (c.state === 'LIVE') continue;
      const centres = Object.entries(this.#dir.centres).filter(([, x]) => x.cell === c.id).map(([id]) => id).sort();
      out.push({ kind: 'CELL_DOWN', key: `CELL_DOWN:${c.id}`, title: c.state === 'DOWN' ? `${dcName(c.id)} is down` : `${dcName(c.id)} is rebuilding from the relays`,
        detail: c.state === 'DOWN' ? 'no answer from it; every relay keeps each answer (✓✓) and replays it when it returns'
          : c.rebuild ? `${c.rebuild.done} of ${c.rebuild.expected} relays have replayed` : 'the relays are replaying',
        blast: { cells: [c.id], centres, candidates: this.#cands(centres), answersLost: null } });
    }
    const L = s.link;
    if (L && L.risk !== 'ok') {
      const blast: Blast = { cells: [], centres: [L.centre], candidates: this.#cands([L.centre]), answersLost: 0 };
      if (L.risk === 'down') out.push({ kind: 'RELAY_WAN_DOWN', key: `RELAY_WAN_DOWN:${L.centre}`, title: `${L.centre} has lost its link to the exam server`,
        detail: `${L.cut ? 'the link is cut' : 'no answer from the exam server'}. The centre continues offline; answers wait at its relay (✓✓); its offline code is ready to reveal.`, blast });
      else out.push({ kind: 'SYNC_LAG', key: `SYNC_LAG:${L.centre}`, title: `WAN failure likely at ${L.centre} (predicted)`, detail: `${L.reason}. Pre-stage ${L.centre}'s offline code.`, blast });
    }
    if (s.relay) out.push(...this.#silence(s, s.relay));
    const r = s.release?.released;
    if (r && s.fleet && s.now - r.at > this.#ops.releaseDelayMs) {
      const late = s.fleet.centres.filter((t) => t.registered > 0 && t.tone === 'locked').map((t) => t.centre);
      if (late.length) out.push({ kind: 'KEY_RELEASE_DELAY', key: 'KEY_RELEASE_DELAY', title: `${plural(late.length, 'centre')} still locked after the release`,
        detail: `${late.slice(0, 10).join(', ')}${late.length > 10 ? ', …' : ''}: phone the superintendent; reveal the centre's offline code if its link is down.`,
        blast: { cells: [], centres: late, candidates: this.#cands(late), answersLost: 0 } });
    }
    return out;
  }

  #silence(s: Snapshot, relay: HeadsRes): Want[] {
    const centre = s.link?.centre ?? this.#dir.demoCentre;
    const seen = relay.streams.filter((v) => v.seenAt > 0 && !v.submitted);
    const silent = seen.filter((v) => s.now - v.seenAt > this.#ops.silentMs);
    if (!silent.length) return [];
    const at = silent.map((v) => v.seenAt);
    if (silent.length >= 2 && silent.length * 2 >= seen.length && Math.max(...at) - Math.min(...at) <= this.#ops.silentMs)
      return [{ kind: 'CENTRE_OUTAGE', key: `CENTRE_OUTAGE:${centre}`, title: `${centre}: ${silent.length} of ${seen.length} seats went silent together`,
        detail: 'likely power or the network inside the centre; each seat keeps its answers and is not charged the lost time', blast: { cells: [], centres: [centre], candidates: silent.length, answersLost: null } }];
    return silent.map((v): Want => ({ kind: 'SEAT_SILENT', key: `SEAT_SILENT:${v.cand}`, cand: v.cand, title: `${v.cand}'s seat is silent`,
      detail: `no heartbeat for over ${Math.round(this.#ops.silentMs / 1000)} s — check the seat`, blast: { cells: [], centres: [centre], candidates: 1, answersLost: null } }));
  }

  #eventWants(s: Snapshot): Want[] {
    const out: Want[] = [];
    const one = (centre: string, lost: number | null = 0): Blast => ({ cells: [], centres: centre ? [centre] : [], candidates: 1, answersLost: lost });
    for (const e of s.events ?? []) {
      const k = `${e.cell}/${e.code}/${e.cand}/${e.seq}/${e.reason}`;
      if (this.#seen.has(k)) continue;
      this.#seen.add(k);
      const d = e.data ?? {}, c = e.cand;
      if (e.code === 'FORK') out.push({ kind: 'TAMPER', key: `TAMPER:${c}`, cand: c, title: `Two different signed entries for ${c}`, detail: `${dcName(e.cell)}, seq ${e.seq}: ${e.reason}`, blast: one(e.centre, null) });
      else if (e.code === 'BAD_SUBMISSION') out.push({ kind: 'BAD_SUBMISSION', key: `BAD_SUBMISSION:${c || e.cell}`, cand: c || undefined, title: `Refused entries${c ? ` for ${c}` : ''}`, detail: e.reason, blast: one(e.centre), data: { count: 1 } });
      else if (e.code === 'ORPHANED') out.push({ kind: 'ORPHANED', key: `ORPHANED:${c}`, cand: c, title: `${c}'s old seat is still sending`, detail: 'its entries after the move are kept as evidence (ORPHANED), not counted', blast: one(e.centre), data: { count: 1 } });
      else if (e.code === 'LATE') out.push({ kind: 'LATE', key: `LATE:${c}`, cand: c, title: `Entries after the hard stop for ${c}`, detail: `${e.reason}; kept as evidence for a human decision`, blast: one(e.centre), data: { count: 1 } });
      else if (e.code === 'HANDOVER') out.push({ kind: 'HANDOVER', key: `HANDOVER:${c}:${d.keyEpoch}`, cand: c,
        title: `${c} moved to ${d.seatId} (${d.via === 'pin' ? `PIN + invigilator ${d.approvedBy}` : 'old seat key'})`,
        detail: `+${mmss(Number(d.creditedMs ?? 0))} credited${d.approvedBy ? `, approved by ${d.approvedBy}` : ' — needs approval'}; continues from entry ${d.fromSeq}`, blast: one(e.centre), data: { ...d } });
      else if (e.code === 'GAP') out.push({ kind: 'GAP', key: `GAP:${c}:${e.seq}`, cand: c, title: `${c} paused (${d.cause})`,
        detail: `the seat reports ${mmss(Number(d.pausedMs ?? 0))}; the credit is measured by the relay's clock and needs approval`, blast: one(e.centre), data: { ...d, seq: e.seq } });
      else if (e.code === 'INTEGRITY' && this.#ops.criticalIntegrity.includes(String(d.code)))
        out.push({ kind: 'INTEGRITY_CRITICAL', key: `INTEGRITY_CRITICAL:${c}`, cand: c, title: `${d.code} at ${c}'s seat`, detail: 'never auto-submitted: move the candidate or clear the finding', blast: one(e.centre), data: { ...d } });
    }
    for (const f of s.findings ?? []) {
      const k = `audit/${f.cand}/${f.seq}/${f.kind}/${f.detail}`;
      if (this.#seen.has(k)) continue;
      this.#seen.add(k);
      out.push({ kind: 'TAMPER', key: `TAMPER:${f.cand}`, cand: f.cand, title: `The record for ${f.cand} was altered`, detail: `entry ${f.seq}: ${f.detail}`,
        blast: one(this.#dir.cands[f.cand]?.centre ?? '', f.recovered ? 0 : null) });
    }
    return out;
  }
}
```

- [ ] **Step 4: `apps/server/src/certin.ts`**

```ts
// A CERT-In incident report DRAFT (plan §3.10), made when a TAMPER or INTEGRITY_CRITICAL incident reaches the regulator rung. CERT-In's
// Directions of 28 April 2022 (section 70B(6), IT Act 2000) ask for cyber incidents to be reported within 6 hours of being noticed.
// This fills in what Saakshi knows and leaves the rest blank for a responsible officer. Saakshi files nothing. Browser-safe.
import type { Incident, IncidentKind } from '@saakshi/core/ops';
import { blastText, dcName } from './incidents.ts';

const esc = (s: unknown): string => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const iso = (ms: number): string => new Date(ms).toISOString();
const TYPE: Partial<Record<IncidentKind, string>> = {
  TAMPER: 'Unauthorised modification of exam records (data integrity)',
  INTEGRITY_CRITICAL: 'Unauthorised access or remote-control software at an exam seat',
};

export function certInHtml(i: Incident, o: { exam: string; shift: string; now: number }): string {
  const blank = '<span class="blank">&nbsp;</span>';
  const facts: [string, string][] = [
    ['Incident id (Saakshi)', i.id], ['Examination and shift', `${o.exam} · ${o.shift}`], ['Type', TYPE[i.kind] ?? i.kind], ['Severity', i.severity],
    ['Noticed at (UTC)', iso(i.openedAt)], ['Report due by (6 hours after noticing, UTC)', iso(i.openedAt + 6 * 3_600_000)],
    ['Affected systems', [...i.blast.cells.map(dcName), `${i.blast.centres.length} centre(s): ${i.blast.centres.join(', ') || '—'}`].join('; ')],
    ['Scope', blastText(i.blast)], ['What was observed', `${i.title}. ${i.detail}`],
    ['Escalation so far', i.ladder.map((l) => `${l.rung} at ${iso(l.at)}`).join('; ') + (i.ack ? `; acknowledged by ${i.ack.by} (${i.ack.rung}) at ${iso(i.ack.at)}` : '; not acknowledged')],
    ['Evidence held', i.cand ? 'the evidence pack for the affected candidate (control → Evidence) and the cells\' evidence tables' : 'the cells\' evidence tables and control\'s custody log'],
  ];
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>CERT-In report draft — ${esc(i.id)}</title>
<style>body{font:1rem/1.5 system-ui,sans-serif;color:#202124;max-width:56rem;margin:1.5rem auto;padding:0 1rem}h1{font-size:1.563rem}h2{font-size:1.25rem}
table{border-collapse:collapse;width:100%}th,td{border:1px solid #9aa0a6;padding:.25rem .5rem;text-align:left;vertical-align:top}
.note{border:2px solid #b06000;background:#fef7e0;padding:.5rem .75rem}.blank{display:inline-block;min-width:16rem;border-bottom:1px solid #202124}</style></head><body>
<h1>Cyber security incident report — DRAFT TEMPLATE</h1>
<p class="note">Generated by Saakshi at ${esc(iso(o.now))} when incident ${esc(i.id)} reached the regulator rung. It has not been filed. CERT-In's Directions of 28 April 2022 ask for a report within 6 hours of noticing an incident (here by ${esc(iso(i.openedAt + 6 * 3_600_000))}). Check CERT-In's current form and channel, complete the blanks, and have a responsible officer file it.</p>
<h2>What Saakshi recorded</h2>
<table>${facts.map(([k, v]) => `<tr><th scope="row">${esc(k)}</th><td>${esc(v)}</td></tr>`).join('\n')}</table>
<h2>To be completed by the reporting officer</h2>
<p>Reporting organisation: ${blank}</p><p>Name and designation: ${blank}</p><p>Phone and e-mail: ${blank}</p>
<p>IP addresses, hosts and logs attached: ${blank}</p><p>Containment actions taken: ${blank}</p><p>Signature and date: ${blank}</p>
</body></html>
`;
}
```

- [ ] **Step 5: Run the tests**

Run: `bun test --timeout 60000 apps/server/test/incidents.test.ts && pnpm --filter @saakshi/server typecheck`
Expected: PASS.

---
### Task 7: The time audit — wall time by the relay's clock, active time by the seat's; gaps, moves, approvals, the cap, the flags

**Files:**
- Create: `apps/server/src/time-audit.ts`
- Test: `apps/server/test/time-audit.test.ts`

**Interfaces:**
- Consumes: Task 1 (`Ops`, `OPS`, `Approval`, `GapLine`, `TimeRow`, `TimeFlag`, `SheetEntry.rx`); `parseSignedLine`, `bodyFromArray`.
- Produces: `timeAudit(sheet: ResponseSheet, form: readonly string[], approvals: Approval[], ops: Ops): TimeRow` (browser-safe). A move's approval is keyed by the seq of its `handover` entry (`fromSeq + 1`).

- [ ] **Step 1: Write the failing tests**

`apps/server/test/time-audit.test.ts`:
```ts
import { expect, test } from 'bun:test';
import { randomBytes, toHex } from '@saakshi/core/bytes';
import { signedLine } from '@saakshi/core/journal';
import { newKeyPair, signer } from '@saakshi/core/node';
import { OPS } from '@saakshi/core/ops';
import { bodyArray, bodyCommit, entryHash, genesisPrev, type Body, type Header, type Kind } from '@saakshi/core/protocol';
import type { ResponseSheet } from '@saakshi/core/sheet';
import { timeAudit } from '../src/time-audit.ts';

const ctx = { exam: 'DEMO-2026', shift: 'S1', attempt: 1, cand: 'C0001' };
const form = ['I01', 'I02', 'I03', 'I04'];
const E: Body = { item: '', state: '', answer: '', meta: [] };
const ans = (item: string, answer: string): Body => ({ item, state: 'A', answer, meta: [1000, []] });
type Step = { kind: Kind; active: number; rx: number; body?: Body; epoch?: number };
/** A chain with chosen activeMs and relay rxWall per entry (the signatures are real; the audit does not need them). */
function sheet(steps: Step[]): ResponseSheet {
  const sign = signer(newKeyPair());
  let prev = genesisPrev(ctx);
  const entries = steps.map((s, i) => {
    const salt = randomBytes(16), body = s.body ?? E;
    const h: Header = { ...ctx, keyEpoch: s.epoch ?? 1, seq: i + 1, prev, kind: s.kind, tMonoMs: s.active, activeMs: s.active, bodyCommit: bodyCommit(salt, body) };
    prev = toHex(entryHash(h));
    return { line: signedLine(h, sign), salt: toHex(salt), body: bodyArray(body), rx: [s.rx, s.rx + 5] as [number, number] };
  });
  return { ctx, form: 'F1', pseud: '7'.repeat(64), keys: [], entries };
}
const T0 = 1_790_000_000_000;

test('an honest exam: wall time equals active time, no gaps, no flags', () => {
  const r = timeAudit(sheet([{ kind: 'unlock', active: 0, rx: T0 }, { kind: 'answer', active: 30_000, rx: T0 + 30_000, body: ans('I01', 'B') }, { kind: 'answer', active: 60_000, rx: T0 + 60_400, body: ans('I02', 'C') }]), form, [], OPS);
  expect(r).toEqual({ cand: 'C0001', wallMs: 60_400, activeMs: 60_000, unaccountedMs: 400, gaps: [], creditedMs: 0, flags: [], changedAfterMove: [] });
});

test('Review Focus #4: credit is measured by rxWall, capped at 30 min; two gaps flag review; unapproved gaps are pending', () => {
  const steps: Step[] = [
    { kind: 'unlock', active: 0, rx: T0 },
    { kind: 'answer', active: 60_000, rx: T0 + 60_000, body: ans('I01', 'B') },
    { kind: 'gap', active: 60_000, rx: T0 + 185_000, body: { ...E, meta: ['suspend', 999_999] } },          // the seat claims more; the relay saw 125 s
    { kind: 'answer', active: 90_000, rx: T0 + 215_000, body: ans('I02', 'C') },
    { kind: 'gap', active: 90_000, rx: T0 + 215_000 + 40 * 60_000, body: { ...E, meta: ['restart', 0] } },   // 40 min: over the cap
  ];
  const pending = timeAudit(sheet(steps), form, [], OPS);
  expect(pending.gaps.map((g) => [g.seq, g.cause, g.pausedMs, g.measuredMs, g.approved])).toEqual([[3, 'suspend', 999_999, 125_000, false], [5, 'restart', 0, 2_400_000, false]]);
  expect(pending.flags).toEqual(['REVIEW_GAPS', 'PENDING_APPROVAL']);
  expect(pending.creditedMs).toBe(0);
  const approved = timeAudit(sheet(steps), form, [{ cand: 'C0001', seq: 3, by: 'CONTROL-1', at: 1 }, { cand: 'C0001', seq: 5, by: 'CONTROL-1', at: 2 }], OPS);
  expect(approved.creditedMs).toBe(30 * 60_000);
  expect(approved.flags).toEqual(['REVIEW_GAPS', 'RETEST_ELIGIBLE']);
  expect(approved.gaps.every((g) => g.approvedBy === 'CONTROL-1')).toBe(true);
});

test('time nobody explains is flagged; entries without stamps or bodies do not break the audit', () => {
  const r = timeAudit(sheet([{ kind: 'unlock', active: 0, rx: T0 }, { kind: 'answer', active: 30_000, rx: T0 + 30_000 + 5 * 60_000, body: ans('I01', 'B') }]), form, [], OPS);
  expect(r.flags).toEqual(['UNEXPLAINED_TIME']);
  const s = sheet([{ kind: 'unlock', active: 0, rx: 0 }, { kind: 'answer', active: 30_000, rx: 0, body: ans('I01', 'B') }]);
  s.entries[1].body = ['missing'];
  expect(timeAudit(s, form, [], OPS)).toMatchObject({ wallMs: 30_000, activeMs: 30_000, flags: [] });
});

test('a move: its credit is the wall gap across the epochs; approved by the invigilator; answers changed after it are listed for review', () => {
  const r = timeAudit(sheet([
    { kind: 'unlock', active: 0, rx: T0 },
    { kind: 'answer', active: 50_000, rx: T0 + 50_000, body: ans('I02', 'B') },
    { kind: 'answer', active: 100_000, rx: T0 + 100_000, body: ans('I03', 'A') },
    { kind: 'handover', active: 100_000, rx: T0 + 208_000, epoch: 2, body: { ...E, meta: ['pin', 3, 108_000] } },
    { kind: 'answer', active: 120_000, rx: T0 + 228_000, epoch: 2, body: ans('I02', 'C') },             // changed after the move
    { kind: 'answer', active: 130_000, rx: T0 + 238_000, epoch: 2, body: ans('I04', 'D') },             // first answered after it
  ]), form, [{ cand: 'C0001', seq: 4, by: 'INV-42-A', at: 1 }], OPS);
  expect(r.gaps).toEqual([{ seq: 4, kind: 'handover', cause: 'moved (pin)', pausedMs: 0, measuredMs: 108_000, approved: true, approvedBy: 'INV-42-A' }]);
  expect([r.activeMs, r.creditedMs, r.flags]).toEqual([130_000, 108_000, []]);
  expect(r.changedAfterMove).toEqual([{ item: 'I02', q: 2 }]);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test --timeout 60000 apps/server/test/time-audit.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: `apps/server/src/time-audit.ts`**

```ts
// The time audit (plan §3.6, Addendum C.9). Wall time comes from the relay's rxWall and active time from the seat's signed activeMs,
// never compared across key epochs. Each gap or move is credited by what the relay's clock saw (not what the seat claims), only once
// approved, and at most gapCapMs in total. Two or more gaps → review; over the cap → re-test eligible; time nobody explains → flagged.
// Pure and browser-safe; control runs it on the cell's export. It also lists answers changed after a move (plan §3.2, the review queue).
import { parseSignedLine } from '@saakshi/core/journal';
import type { Approval, GapLine, Ops, TimeFlag, TimeRow } from '@saakshi/core/ops';
import { bodyFromArray, type Body } from '@saakshi/core/protocol';
import type { ResponseSheet } from '@saakshi/core/sheet';

interface E { seq: number; kind: string; keyEpoch: number; activeMs: number; rx: number; body?: Body }

export function timeAudit(sheet: ResponseSheet, form: readonly string[], approvals: Approval[], ops: Ops): TimeRow {
  const es: E[] = [];
  for (const e of sheet.entries) {
    const p = parseSignedLine(e.line);
    if (!p.ok) continue;
    let body: Body | undefined;
    try { body = bodyFromArray(e.body); } catch { /* a missing or unreadable row */ }
    es.push({ seq: p.header.seq, kind: p.header.kind, keyEpoch: p.header.keyEpoch, activeMs: p.header.activeMs, rx: e.rx?.[0] ?? 0, body });
  }
  const cand = sheet.ctx.cand, gaps: GapLine[] = [];
  let activeMs = 0;
  for (let i = 1; i < es.length; i++) {
    const p = es[i - 1], n = es[i];
    const dA = n.keyEpoch === p.keyEpoch ? Math.max(0, n.activeMs - p.activeMs) : 0;
    activeMs += dA;
    if (n.kind !== 'gap' && n.kind !== 'handover') continue;
    const meta = n.body?.meta ?? [];
    const a = approvals.find((x) => x.cand === cand && x.seq === n.seq);
    gaps.push({
      seq: n.seq, kind: n.kind, cause: n.kind === 'gap' ? String(meta[0] ?? '') : `moved (${String(meta[0] ?? '')})`,
      pausedMs: n.kind === 'gap' && typeof meta[1] === 'number' ? meta[1] : 0,
      measuredMs: p.rx && n.rx ? Math.max(0, n.rx - p.rx - dA) : 0, approved: !!a, approvedBy: a?.by ?? '',
    });
  }
  const first = es[0], last = es[es.length - 1];
  const wallMs = first?.rx && last?.rx ? last.rx - first.rx : activeMs;
  const unaccountedMs = Math.max(0, wallMs - activeMs);
  const explained = gaps.reduce((n, g) => n + g.measuredMs, 0);
  const approvedMs = gaps.filter((g) => g.approved).reduce((n, g) => n + g.measuredMs, 0);
  const flags: TimeFlag[] = [];
  if (gaps.length >= 2) flags.push('REVIEW_GAPS');
  if (approvedMs > ops.gapCapMs) flags.push('RETEST_ELIGIBLE');
  if (gaps.some((g) => !g.approved)) flags.push('PENDING_APPROVAL');
  if (unaccountedMs - explained > ops.gapTolMs) flags.push('UNEXPLAINED_TIME');
  return { cand, wallMs, activeMs, unaccountedMs, gaps, creditedMs: Math.min(approvedMs, ops.gapCapMs), flags, changedAfterMove: changedAfterMove(es, form) };
}

/** Items answered (A/AMR) before a move whose state or answer changed after it. */
function changedAfterMove(es: E[], form: readonly string[]): { item: string; q: number }[] {
  const out = new Map<string, number>();
  for (const at of es.filter((e) => e.kind === 'handover').map((e) => e.seq)) {
    const before = new Map<string, Body>();
    for (const e of es) if (e.seq < at && e.body?.item) before.set(e.body.item, e.body);
    for (const e of es) {
      const b = e.body, was = b?.item ? before.get(b.item) : undefined;
      if (e.seq > at && b && was && (was.state === 'A' || was.state === 'AMR') && (b.answer !== was.answer || b.state !== was.state)) out.set(b.item, form.indexOf(b.item) + 1);
    }
  }
  return [...out].map(([item, q]) => ({ item, q })).sort((a, b) => a.q - b.q);
}
```

- [ ] **Step 4: Run the tests**

Run: `bun test --timeout 60000 apps/server/test/time-audit.test.ts && pnpm --filter @saakshi/server typecheck`
Expected: PASS.

---

### Task 8: Candidate comms — the public status page (no PII), notice drafts, the outbox

**Files:**
- Create: `apps/server/src/status-view.ts`, `apps/server/src/status.html`, `apps/server/src/status-page.ts`, `apps/server/src/comms.ts`
- Test: `apps/server/test/status-view.test.ts`

**Interfaces:**
- Consumes: Task 1 (`PublicStatus`, `Notice`, `Incident`, `IncidentKind`, `FleetView`, `TileTone`).
- Produces:
  - `publicStatus(i: { exam; shift; now; fleet: FleetView; incidents: Incident[]; notices: Notice[] }): PublicStatus` (browser-safe).
  - `NOTICE_KINDS`; `draftNotice(i: Incident, exam, shift, now): Notice`.
  - `class Outbox { constructor(path); draft(n): boolean; drafts(): Notice[]; sent(): Notice[]; approve(id, by, now): Notice }`, which appends to `outbox.jsonl`.
  - The page `/status` (served by control in Task 15), which fetches `GET /v1/status/public` every 5 s.

- [ ] **Step 1: Write the failing tests**

`apps/server/test/status-view.test.ts`:
```ts
import { expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FleetView } from '@saakshi/core/directory';
import type { Incident } from '@saakshi/core/ops';
import { draftNotice, Outbox } from '../src/comms.ts';
import { publicStatus } from '../src/status-view.ts';

const fleet: FleetView = { at: 0, registered: 30, bound: 30, unlocked: 22, submitted: 0, entries: 0, entriesPerSec: 0, cells: [],
  centres: [
    { centre: 'CEN001', cell: 'cell-2', registered: 10, bound: 10, unlocked: 10, submitted: 0, entries: 0, tone: 'down' },
    { centre: 'CEN042', cell: 'cell-1', registered: 8, bound: 8, unlocked: 0, submitted: 0, entries: 0, tone: 'locked' },
    { centre: 'CEN007', cell: 'cell-1', registered: 12, bound: 12, unlocked: 12, submitted: 0, entries: 0, tone: 'green' },
  ] };
const inc = (o: Partial<Incident>): Incident => ({ id: 'X-1', kind: 'CELL_DOWN', severity: 'P1', key: 'k', title: 'Data Centre 2 is down', detail: 'd',
  blast: { cells: ['cell-2'], centres: ['CEN001', 'CEN002'], candidates: 6_600, answersLost: null }, openedAt: 5, updatedAt: 5, rung: 2, ladder: [], data: {}, ...o });
const incidents: Incident[] = [
  inc({}),
  inc({ id: 'H-2', kind: 'HANDOVER', severity: 'P3', cand: 'C0001', title: 'C0001 moved to CEN042-S02 (PIN + invigilator INV-42-A)', blast: { cells: [], centres: ['CEN042'], candidates: 1, answersLost: 0 }, data: { seatId: 'CEN042-S02', approvedBy: 'INV-42-A' } }),
  inc({ id: 'W-3', kind: 'RELAY_WAN_DOWN', severity: 'P2', title: 'CEN042 has lost its link', blast: { cells: [], centres: ['CEN042'], candidates: 8, answersLost: 0 } }),
  inc({ id: 'T-4', kind: 'TAMPER', severity: 'P0', cand: 'C0002', title: 'The record for C0002 was altered' }),
  inc({ id: 'S-5', kind: 'SEAT_SILENT', severity: 'P3', cand: 'C0003', title: "C0003's seat is silent" }),
  inc({ id: 'R-6', kind: 'RELAY_WAN_DOWN', resolvedAt: 9 }),
];

test('the public status page: centres and public incidents in EN and HI — and no PII, whatever the incidents hold', () => {
  const dir = mkdtempSync(join(tmpdir(), 'saakshi-out-'));
  const ob = new Outbox(join(dir, 'outbox.jsonl'));
  ob.draft(draftNotice(incidents[0], 'DEMO-2026', 'S1', 6));
  ob.approve('N-X-1', 'CONTROL-OFFICER-ANITA', 7);
  const s = publicStatus({ exam: 'DEMO-2026', shift: 'S1', now: 10, fleet, incidents, notices: ob.sent() });
  expect(s.summary).toEqual({ en: '1 of 3 centres running normally', hi: '3 में से 1 केंद्र सामान्य रूप से चल रहे हैं' });
  expect(s.centres.map((c) => [c.centre, c.en])).toEqual([['CEN001', 'Exam server being restored'], ['CEN042', 'Not started yet'], ['CEN007', 'Running normally']]);
  expect(s.incidents.map((i) => i.kind)).toEqual(['CELL_DOWN', 'RELAY_WAN_DOWN']);                  // centre-level, open incidents only
  expect(s.incidents[0].en).toBe("An exam server is being restored from the centres' copies. 2 centres affected. Candidates' time and answers are preserved.");
  expect(s.incidents[0].hi).toContain('परीक्षा सर्वर');
  expect(s.notices).toEqual([{ at: 7, en: expect.stringContaining('Your answers and your exam time are preserved'), hi: expect.stringContaining('सुरक्षित') }]);
  const text = JSON.stringify(s);
  for (const pii of ['C0001', 'C0002', 'C0003', 'CEN042-S02', 'INV-42-A', 'CONTROL-OFFICER-ANITA', '7777777777']) expect(text).not.toContain(pii);
  expect(text).not.toMatch(/\bC\d{4,}\b/);
  rmSync(dir, { recursive: true, force: true });
});

test('notices: one draft per incident, a human approves, the outbox appends a line and survives a restart', () => {
  const dir = mkdtempSync(join(tmpdir(), 'saakshi-out-'));
  const path = join(dir, 'outbox.jsonl');
  const ob = new Outbox(path);
  const n = draftNotice(incidents[2], 'DEMO-2026', 'S1', 6);
  expect(n).toMatchObject({ id: 'N-W-3', incident: 'W-3', centres: ['CEN042'], audience: 8, channels: ['sms', 'email', 'digilocker'] });
  expect(n.en).toBe('Saakshi DEMO-2026 S1: a technical problem affected centre CEN042. Your answers and your exam time are preserved. You do not need to do anything; you will be told if anything changes.');
  expect([ob.draft(n), ob.draft(n)]).toEqual([true, false]);
  expect(() => ob.approve('N-W-3', '  ', 7)).toThrow(/who/);
  expect(ob.approve('N-W-3', 'CONTROL-1', 7)).toMatchObject({ approvedBy: 'CONTROL-1', approvedAt: 7 });
  expect(ob.draft(n)).toBe(false);                                                       // already sent
  expect(() => ob.approve('N-W-3', 'CONTROL-1', 8)).toThrow(/no draft/);
  expect(readFileSync(path, 'utf8').trim().split('\n').length).toBe(1);
  expect(new Outbox(path).sent().map((x) => x.id)).toEqual(['N-W-3']);
  rmSync(dir, { recursive: true, force: true });
});

test('UI rules: /status keeps the 1.25 type scale, a language toggle with aria-pressed, visible focus, and textContent only', () => {
  const html = readFileSync(join(import.meta.dir, '../src/status.html'), 'utf8'), ts = readFileSync(join(import.meta.dir, '../src/status-page.ts'), 'utf8');
  const steps = [...html.matchAll(/--s-?\d:\s*([\d.]+)rem/g)].map((m) => Number(m[1])).sort((a, b) => a - b);
  expect(steps.length).toBeGreaterThanOrEqual(3);
  expect(steps.slice(1).every((s, i) => s / steps[i] >= 1.249)).toBe(true);
  expect([...html.matchAll(/font(-size)?:\s*([^;}]+)/g)].every((m) => m[2].trim() === 'inherit' || m[2].includes('var(--s'))).toBe(true);
  expect(html).toContain(':focus-visible');
  expect(ts).toContain('aria-pressed');
  expect(ts).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
  expect([...ts.matchAll(/fetch\(/g)].length).toBe(1);
  expect(ts).toContain('/v1/status/public');
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `bun test --timeout 60000 apps/server/test/status-view.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: `apps/server/src/status-view.ts`**

```ts
// The public status page's data (plan §3.10). No PII by construction: only centre codes, counts, times and fixed sentences leave this
// function — never a roll number, seat id, pseudonym, name or staff id, whatever the incidents carry. EN and HI. Browser-safe.
import type { FleetView, TileTone } from '@saakshi/core/directory';
import type { Incident, IncidentKind, Notice, PublicStatus } from '@saakshi/core/ops';

const TONE: Record<TileTone, { en: string; hi: string }> = {
  green: { en: 'Running normally', hi: 'सामान्य रूप से चल रहा है' },
  partial: { en: 'Starting', hi: 'शुरू हो रहा है' },
  locked: { en: 'Not started yet', hi: 'अभी शुरू नहीं हुआ' },
  down: { en: 'Exam server being restored', hi: 'परीक्षा सर्वर बहाल किया जा रहा है' },
};
const lost = (n: number | null) => (n === 0 ? { en: ' No answers were lost.', hi: ' कोई उत्तर नहीं खोया।' } : { en: '', hi: '' });
/** Centre-level kinds only: candidate-level incidents never reach the public page. */
const PUBLIC: Partial<Record<IncidentKind, (i: Incident) => { en: string; hi: string }>> = {
  CELL_DOWN: (i) => ({
    en: `An exam server is being restored from the centres' copies. ${i.blast.centres.length} centres affected. Candidates' time and answers are preserved.${lost(i.blast.answersLost).en}`,
    hi: `एक परीक्षा सर्वर को केंद्रों की प्रतियों से बहाल किया जा रहा है। ${i.blast.centres.length} केंद्र प्रभावित। अभ्यर्थियों का समय और उत्तर सुरक्षित हैं।${lost(i.blast.answersLost).hi}`,
  }),
  RELAY_WAN_DOWN: (i) => ({
    en: `Centre ${i.blast.centres[0]} has lost its network link. The exam continues at the centre; answers are saved there and reach the exam server when the link returns.`,
    hi: `केंद्र ${i.blast.centres[0]} का नेटवर्क संपर्क टूट गया है। परीक्षा केंद्र पर जारी है; उत्तर वहीं सहेजे जा रहे हैं और संपर्क लौटने पर परीक्षा सर्वर तक पहुँचेंगे।`,
  }),
  CENTRE_OUTAGE: (i) => ({
    en: `Centre ${i.blast.centres[0]}: several computers stopped at once. Answers saved before the stop are kept, and the lost time is not counted against candidates.`,
    hi: `केंद्र ${i.blast.centres[0]}: कई कंप्यूटर एक साथ रुक गए। रुकने से पहले सहेजे गए उत्तर सुरक्षित हैं, और खोया समय अभ्यर्थियों के विरुद्ध नहीं गिना जाएगा।`,
  }),
  KEY_RELEASE_DELAY: (i) => ({
    en: `${i.blast.centres.length} centres have not started yet. Every candidate still gets the full exam time.`,
    hi: `${i.blast.centres.length} केंद्रों में परीक्षा अभी शुरू नहीं हुई है। हर अभ्यर्थी को पूरा परीक्षा समय मिलेगा।`,
  }),
};

export function publicStatus(i: { exam: string; shift: string; now: number; fleet: FleetView; incidents: Incident[]; notices: Notice[] }): PublicStatus {
  const green = i.fleet.centres.filter((c) => c.tone === 'green').length, total = i.fleet.centres.length;
  return {
    exam: i.exam, shift: i.shift, at: i.now,
    summary: { en: `${green} of ${total} centres running normally`, hi: `${total} में से ${green} केंद्र सामान्य रूप से चल रहे हैं` },
    centres: i.fleet.centres.map((c) => ({ centre: c.centre, tone: c.tone, ...TONE[c.tone] })),
    incidents: i.incidents.filter((x) => !x.resolvedAt && PUBLIC[x.kind]).map((x) => ({
      kind: x.kind, severity: x.severity, since: x.openedAt, centres: [...x.blast.centres], answersLost: x.blast.answersLost, ...PUBLIC[x.kind]!(x),
    })),
    notices: i.notices.filter((n) => n.approvedAt !== undefined).map((n) => ({ at: n.approvedAt!, en: n.en, hi: n.hi })),
  };
}
```

- [ ] **Step 4: `apps/server/src/comms.ts`**

```ts
// Candidate notices (plan §3.10): a template draft for each centre-level incident, a human approval, then the outbox — mock SMS, e-mail
// and DigiLocker, one JSON line each in outbox.jsonl. The audience is a count of candidates at the affected centres; no contact
// details live here. Stage 6 adds Claude-drafted notices and Tamil; a human still approves every one.
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import type { Incident, IncidentKind, Notice } from '@saakshi/core/ops';

export const NOTICE_KINDS = new Set<IncidentKind>(['CELL_DOWN', 'RELAY_WAN_DOWN', 'CENTRE_OUTAGE', 'KEY_RELEASE_DELAY']);

export function draftNotice(i: Incident, exam: string, shift: string, now: number): Notice {
  const c = i.blast.centres;
  const where = c.length === 1 ? `centre ${c[0]}` : `${c.length} centres`, whereHi = c.length === 1 ? `केंद्र ${c[0]}` : `${c.length} केंद्रों`;
  return {
    id: `N-${i.id}`, incident: i.id, kind: i.kind, centres: [...c], audience: i.blast.candidates, channels: ['sms', 'email', 'digilocker'], draftedAt: now,
    en: `Saakshi ${exam} ${shift}: a technical problem affected ${where}. Your answers and your exam time are preserved. You do not need to do anything; you will be told if anything changes.`,
    hi: `साक्षी ${exam} ${shift}: एक तकनीकी समस्या ने ${whereHi} को प्रभावित किया। आपके उत्तर और परीक्षा का समय सुरक्षित हैं। आपको कुछ करने की आवश्यकता नहीं है; कुछ बदला तो आपको बताया जाएगा।`,
  };
}

export class Outbox {
  #path: string;
  #drafts = new Map<string, Notice>();
  #sent: Notice[];
  constructor(path: string) {
    this.#path = path;
    this.#sent = existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Notice) : [];
  }
  /** false if this notice was already drafted or sent. */
  draft(n: Notice): boolean {
    if (this.#drafts.has(n.id) || this.#sent.some((x) => x.id === n.id)) return false;
    this.#drafts.set(n.id, n);
    return true;
  }
  drafts(): Notice[] { return [...this.#drafts.values()]; }
  sent(): Notice[] { return [...this.#sent]; }
  approve(id: string, by: string, now: number): Notice {
    const n = this.#drafts.get(id);
    if (!n) throw new Error(`no draft ${id}`);
    const who = by.trim();
    if (!who || who.length > 64) throw new Error('say who approves (1–64 characters)');
    const out: Notice = { ...n, approvedBy: who, approvedAt: now };
    appendFileSync(this.#path, JSON.stringify(out) + '\n');                          // the mock send: SMS, e-mail, DigiLocker
    this.#drafts.delete(id);
    this.#sent.push(out);
    return out;
  }
}
```

- [ ] **Step 5: The page — `status.html` and `status-page.ts`**

`apps/server/src/status.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Saakshi · Exam status</title>
    <style>
      :root { --s-1: .8rem; --s0: 1rem; --s1: 1.25rem; --s2: 1.563rem; --s3: 1.953rem; font-family: system-ui, 'Noto Sans Devanagari', sans-serif; color: #202124; background: #fff; }
      body { margin: 0 auto; padding: 1rem 1.5rem 3rem; max-width: 60rem; font-size: var(--s0); line-height: 1.5; }
      h1 { font-size: var(--s3); margin: 0 0 .25rem; } h2 { font-size: var(--s2); margin: 1.5rem 0 .5rem; }
      #summary { font-size: var(--s1); font-weight: 700; }
      .lang button { font: inherit; min-height: 2.75rem; padding: .25rem .75rem; border: 1px solid #5f6368; background: #fff; color: #202124; border-radius: .375rem; }
      .lang button[aria-pressed='true'] { background: #1565c0; color: #fff; border-color: #1565c0; }
      #incidents { padding: 0; } #incidents li { border-left: 4px solid #b06000; background: #fef7e0; color: #3c2a00; padding: .5rem .75rem; margin: .5rem 0; list-style: none; }
      #notices { padding-left: 1.25rem; }
      #centres { list-style: none; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(11rem, 1fr)); gap: .375rem; }
      .tile { border: 2px solid; border-radius: .375rem; padding: .25rem .5rem; font-size: var(--s-1); }
      .tile.green { color: #0d5222; background: #e6f4ea; border-color: #1e6b25; } .tile.partial { color: #7a4100; background: #fef7e0; border-color: #b06000; }
      .tile.locked { color: #3c4043; background: #f1f3f4; border-color: #9aa0a6; } .tile.down { color: #8c1d18; background: #fce8e6; border-color: #c62828; }
      .note { color: #5f6368; font-size: var(--s-1); }
      :focus-visible { outline: 3px solid #1565c0; outline-offset: 2px; }
      @media (forced-colors: active) { .tile, #incidents li { border-color: CanvasText; } }
    </style>
  </head>
  <body>
    <h1 id="title">Exam status</h1>
    <div class="lang" role="group" aria-label="Language"><button id="en" lang="en">English</button> <button id="hi" lang="hi">हिन्दी</button></div>
    <p id="summary" role="status">…</p>
    <h2 id="h-incidents">Current issues</h2>
    <ul id="incidents"></ul>
    <h2 id="h-notices">Notices</h2>
    <ul id="notices"></ul>
    <h2 id="h-centres">Centres</h2>
    <ul id="centres" aria-labelledby="h-centres"></ul>
    <p class="note" id="updated"></p>
    <script type="module" src="./status-page.ts"></script>
  </body>
</html>
```
`apps/server/src/status-page.ts`:
```ts
// /status: the public page. Everything it shows comes from /v1/status/public, which carries no PII. Text only, never HTML.
import type { PublicStatus } from '@saakshi/core/ops';

type Lang = 'en' | 'hi';
const L = {
  en: { title: 'Exam status', incidents: 'Current issues', none: 'No current issues.', notices: 'Notices', noNotices: 'No notices.', centres: 'Centres', updated: 'Updated' },
  hi: { title: 'परीक्षा की स्थिति', incidents: 'वर्तमान समस्याएँ', none: 'कोई वर्तमान समस्या नहीं।', notices: 'सूचनाएँ', noNotices: 'कोई सूचना नहीं।', centres: 'केंद्र', updated: 'अद्यतन' },
};
const $ = (id: string) => document.getElementById(id)!;
let lang: Lang = new URLSearchParams(location.search).get('lang') === 'hi' ? 'hi' : 'en';
let last: PublicStatus | undefined;
const li = (text: string, cls = '') => { const x = document.createElement('li'); x.textContent = text; if (cls) x.className = cls; return x; };

function render(): void {
  const t = L[lang];
  document.documentElement.lang = lang;
  for (const l of ['en', 'hi'] as const) $(l).setAttribute('aria-pressed', String(l === lang));
  $('title').textContent = t.title; $('h-incidents').textContent = t.incidents; $('h-notices').textContent = t.notices; $('h-centres').textContent = t.centres;
  if (!last) return;
  $('summary').textContent = last.summary[lang];
  $('incidents').replaceChildren(...(last.incidents.length ? last.incidents.map((i) => li(i[lang])) : [li(t.none)]));
  $('notices').replaceChildren(...(last.notices.length ? last.notices.map((n) => li(`${new Date(n.at).toLocaleTimeString()} — ${n[lang]}`)) : [li(t.noNotices)]));
  $('centres').replaceChildren(...last.centres.map((c) => li(`${c.centre}: ${c[lang]}`, `tile ${c.tone}`)));
  $('updated').textContent = `${t.updated} ${new Date(last.at).toLocaleTimeString()} · ${last.exam} ${last.shift}`;
}
async function tick(): Promise<void> {
  try { const r = await fetch('/v1/status/public'); if (r.ok) last = (await r.json()) as PublicStatus; } catch { /* keep the last view */ }
  render();
}
for (const l of ['en', 'hi'] as const) $(l).addEventListener('click', () => { lang = l; render(); });
void tick();
setInterval(tick, 5_000);
```

- [ ] **Step 6: Run the tests**

Run: `bun test --timeout 60000 apps/server/test/status-view.test.ts && pnpm --filter @saakshi/server typecheck`
Expected: PASS.

---

### Task 9: The archive — two write-once stores, verified against the STH; the signed purge order

**Files:**
- Create: `apps/server/src/archive.ts`
- Test: `apps/server/test/archive.test.ts`

**Interfaces:**
- Consumes: Task 1 (`PurgeOrder`, `purgeArray`, `ArchiveReport`, `StoreReport`); `SignedSth`, `sthMessage`, `sthId`, `leafHashHex`, `rootOf`, `LogLeaf`, `ShiftExport`, `parseSignedLine`, `entryHash`, `msg`.
- Produces:
  - `interface ArchiveBundle { v: 1; exam; shift; sth: SignedSth; leaves: LogLeaf[]; export: ShiftExport }` and `bundleName(exam, shift, size)`.
  - `writeArchive(stores: string[], b: ArchiveBundle): StoreReport[]`.
  - `verifyArchive(stores: string[], want: { exam; shift; sth: SignedSth }, authority: Verify): ArchiveReport`.
  - `signPurge(p: PurgeOrder, sign): { order: PurgeOrder; sig: string }` and `purgeRelay(db, exam, shift): number`.
  - `purgeRoute(o: { exam; shift; authority: Verify; db: Database; log? }): Routes`, which serves `POST /v1/purge`.

- [ ] **Step 1: Write the failing tests**

`apps/server/test/archive.test.ts`:
```ts
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hexToBytes } from '@saakshi/core/bytes';
import { cellKey, devPseud, trustFromKeys, type KeysFile } from '@saakshi/core/dev';
import { sthId } from '@saakshi/core/log';
import { signer, verifier } from '@saakshi/core/node';
import { bundleName, purgeRelay, purgeRoute, signPurge, verifyArchive, writeArchive, type ArchiveBundle } from '../src/archive.ts';
import { createIngest } from '../src/ingest.ts';
import { seal } from '../src/seal.ts';
import { openDb } from '../src/store.ts';
import { SimSeat } from '../../../tools/sim-seat.ts';

const keys = JSON.parse(readFileSync(new URL('../../../fixtures/keys.json', import.meta.url), 'utf8')) as KeysFile;
const cell = cellKey(keys, 'cell-1'), authority = { priv: hexToBytes(keys.authority.priv), pub: hexToBytes(keys.authority.pub) };
const seat1 = hexToBytes(keys.seats[0].pub);
let dir: string, stores: string[], bundle: ArchiveBundle;
const writable = (p: string) => { if (process.platform !== 'win32' && existsSync(p)) chmodSync(p, 0o644); };

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'saakshi-worm-'));
  stores = [join(dir, 'worm-a'), join(dir, 'worm-b')];
  const seats = ['C0001', 'C0002'].map((c) => { const s = new SimSeat(keys, c, cell.pub); s.add(21); s.submit(); return s; });
  const exp = { cell: 'cell-1', exam: 'DEMO-2026', shift: 'S1', sheets: seats.map((s) => s.sheet()) };
  const { rec } = seal(undefined, exp, { authority, trust: trustFromKeys(keys), pseud: devPseud, now: () => 1 });
  bundle = { v: 1, exam: 'DEMO-2026', shift: 'S1', sth: rec.sths[0], leaves: rec.leaves, export: exp };
});
afterEach(() => {
  const f = bundleName('DEMO-2026', 'S1', 2);
  for (const s of stores) for (const p of [join(s, f), join(s, `${f}.sha256`)]) writable(p);   // read-only files: make them removable first
  rmSync(dir, { recursive: true, force: true });
});

test('two write-once stores: written once, verified against the signed register head; a second write changes nothing', () => {
  const w = writeArchive(stores, bundle);
  expect(w.map((r) => [r.ok, r.detail])).toEqual([[true, 'written (write-once, read-only)'], [true, 'written (write-once, read-only)']]);
  expect(w[0].sha256).toBe(w[1].sha256);
  expect(writeArchive(stores, bundle).map((r) => r.detail)).toEqual(['already archived (write-once)', 'already archived (write-once)']);
  const v = verifyArchive(stores, bundle, verifier(authority.pub));
  expect(v).toMatchObject({ exam: 'DEMO-2026', shift: 'S1', size: 2, root: bundle.sth.sth.root, ok: true });
  expect(v.stores.every((s) => s.ok && /2 leaves rebuild the signed root/.test(s.detail))).toBe(true);
});

test('one damaged store fails verification, so there is no purge; a missing store or a single store fails too', () => {
  writeArchive(stores, bundle);
  const p = join(stores[1], bundleName('DEMO-2026', 'S1', 2));
  writable(p);
  writeFileSync(p, readFileSync(p, 'utf8').replace('"C0002"', '"C0009"'));
  const v = verifyArchive(stores, bundle, verifier(authority.pub));
  expect([v.ok, v.stores[0].ok, v.stores[1].detail]).toEqual([false, true, 'the bundle does not match its recorded SHA-256']);
  expect(verifyArchive([stores[0], join(dir, 'nowhere')], bundle, verifier(authority.pub)).ok).toBe(false);
  expect(verifyArchive(stores.slice(0, 1), bundle, verifier(authority.pub)).ok).toBe(false);             // always two stores
});

test('the relay purges a shift only on an authority-signed order for that shift', async () => {
  const { db } = openDb(':memory:');
  const relay = createIngest({ mode: 'relay', db, fresh: false, seatKey: (c) => (c === 'C0001' ? seat1 : undefined), cell: { pub: cell.pub } });
  const s = new SimSeat(keys, 'C0001', cell.pub); s.add(3);
  await relay.sync({ entries: s.entries, streams: [] });
  const logs: string[] = [];
  const routes = purgeRoute({ exam: 'DEMO-2026', shift: 'S1', authority: verifier(authority.pub), db, log: (l) => logs.push(l) });
  const post = async (b: unknown) => { const r = await routes['/v1/purge'].POST!(new Request('http://relay/v1/purge', { method: 'POST', body: JSON.stringify(b) }), { timeout() {} }); return { status: r.status, body: await r.json() }; };
  const order = { exam: 'DEMO-2026', shift: 'S1', sthId: sthId(bundle.sth.sth), ts: 5 };
  expect((await post(signPurge(order, signer(cell)))).status).toBe(403);                  // signed, but not by the authority
  expect((await post(signPurge({ ...order, shift: 'S2' }, signer(authority)))).status).toBe(400);
  expect(await post(signPurge(order, signer(authority)))).toEqual({ status: 200, body: { purged: 3 } });
  expect(purgeRelay(db, 'DEMO-2026', 'S1')).toBe(0);
  expect(logs[0]).toMatch(/^PURGED /);
  relay.close();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test --timeout 60000 apps/server/test/archive.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: `apps/server/src/archive.ts`**

```ts
// The per-shift archive (plan §3.7): the sealed register (signed STH and every leaf) and the records behind it, written to TWO
// independent write-once stores. Both are re-read and checked against the signed STH; only then does control sign a purge order
// (Addendum C.10) that lets a relay drop the shift. WORM is simulated: files opened with 'wx' and made read-only (not on Windows).
// Retention until results + the grievance window, then DPDP deletion, is not built.
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, join } from 'node:path';
import type { Database } from 'bun:sqlite';
import { hexToBytes, toHex } from '@saakshi/core/bytes';
import { msg } from '@saakshi/core/enrol';
import { purgeArray, type PurgeOrder } from '@saakshi/core/handover';
import { parseSignedLine } from '@saakshi/core/journal';
import { leafHashHex, sthId, sthMessage, type SignedSth } from '@saakshi/core/log';
import { rootOf } from '@saakshi/core/merkle';
import type { ArchiveReport, StoreReport } from '@saakshi/core/ops';
import { entryHash } from '@saakshi/core/protocol';
import type { LogLeaf, ShiftExport } from '@saakshi/core/sheet';
import type { Verify } from '@saakshi/core/sig';
import type { Routes } from './serve.ts';

export interface ArchiveBundle { v: 1; exam: string; shift: string; sth: SignedSth; leaves: LogLeaf[]; export: ShiftExport }
export const bundleName = (exam: string, shift: string, size: number): string => `${exam}-${shift}-${size}.bundle.json`;
const sha = (s: string): string => createHash('sha256').update(s).digest('hex');

export function writeArchive(stores: string[], b: ArchiveBundle): StoreReport[] {
  const text = JSON.stringify(b), digest = sha(text);
  return stores.map((store): StoreReport => {
    mkdirSync(store, { recursive: true });
    const path = join(store, bundleName(b.exam, b.shift, b.sth.sth.size));
    if (existsSync(path)) {
      const cur = sha(readFileSync(path, 'utf8'));
      return { store, path, sha256: cur, ok: cur === digest, detail: cur === digest ? 'already archived (write-once)' : 'a different bundle is already archived under this name' };
    }
    writeFileSync(path, text, { flag: 'wx' });
    writeFileSync(`${path}.sha256`, `${digest}  ${basename(path)}\n`, { flag: 'wx' });
    if (process.platform !== 'win32') { chmodSync(path, 0o444); chmodSync(`${path}.sha256`, 0o444); }
    return { store, path, sha256: digest, ok: true, detail: 'written (write-once, read-only)' };
  });
}

/** Both stores must hold the bundle, match its recorded SHA-256, carry this STH, rebuild its root, and hold a record for every leaf. */
export function verifyArchive(stores: string[], want: { exam: string; shift: string; sth: SignedSth }, authority: Verify): ArchiveReport {
  const t0 = performance.now(), size = want.sth.sth.size;
  const reports = stores.map((store): StoreReport => {
    const path = join(store, bundleName(want.exam, want.shift, size));
    const fail = (detail: string, sha256 = ''): StoreReport => ({ store, path, sha256, ok: false, detail });
    try {
      const text = readFileSync(path, 'utf8'), digest = sha(text);
      if (readFileSync(`${path}.sha256`, 'utf8').split(/\s+/)[0] !== digest) return fail('the bundle does not match its recorded SHA-256', digest);
      const b = JSON.parse(text) as ArchiveBundle;
      if (sthId(b.sth.sth) !== sthId(want.sth.sth) || b.sth.sig !== want.sth.sig) return fail('the bundle holds another register head', digest);
      if (!authority(sthMessage(b.sth.sth), hexToBytes(b.sth.sig))) return fail('the register head signature does not verify', digest);
      if (b.leaves.length !== size || toHex(rootOf(b.leaves.map((l) => hexToBytes(leafHashHex(l))))) !== b.sth.sth.root) return fail('its leaves do not rebuild the signed root', digest);
      const heads = new Map(b.export.sheets.map((s) => { const p = parseSignedLine(s.entries.at(-1)?.line ?? ''); return [s.ctx.cand, p.ok ? toHex(entryHash(p.header)) : ''] as const; }));
      const unmatched = b.leaves.filter((l) => heads.get(l.cand) !== l.h).length;
      if (unmatched) return fail(`${unmatched} leaves have no matching record in the bundle`, digest);
      return { store, path, sha256: digest, ok: true, detail: `${size} leaves rebuild the signed root; SHA-256 matches` };
    } catch (e) { return fail((e as Error).message); }
  });
  return { exam: want.exam, shift: want.shift, size, root: want.sth.sth.root, stores: reports, ok: reports.length >= 2 && reports.every((r) => r.ok), verifyMs: Math.round(performance.now() - t0) };
}

export const signPurge = (p: PurgeOrder, sign: (m: Uint8Array) => Uint8Array): { order: PurgeOrder; sig: string } => ({ order: p, sig: toHex(sign(msg(purgeArray(p)))) });

/** Drop a shift's journal entries from a relay DB. Bindings and evidence stay. */
export function purgeRelay(db: Database, exam: string, shift: string): number {
  return db.transaction(() => db.query('DELETE FROM entries WHERE exam = ? AND shift = ?').run(exam, shift).changes)();
}

export function purgeRoute(o: { exam: string; shift: string; authority: Verify; db: Database; log?: (line: string) => void }): Routes {
  const log = o.log ?? ((l: string) => console.log(l));
  return {
    '/v1/purge': { POST: async (req) => {
      const b = (await req.json().catch(() => null)) as { order?: PurgeOrder; sig?: unknown } | null;
      const p = b?.order;
      if (!p || typeof p.exam !== 'string' || typeof p.shift !== 'string' || typeof p.sthId !== 'string' || !/^[0-9a-f]{64}$/.test(p.sthId)
        || !Number.isSafeInteger(p.ts) || typeof b.sig !== 'string' || !/^[0-9a-f]{128}$/.test(b.sig)) return Response.json({ error: 'need {order: {exam, shift, sthId, ts}, sig}' }, { status: 400 });
      if (p.exam !== o.exam || p.shift !== o.shift) return Response.json({ error: `this relay holds ${o.exam} ${o.shift}` }, { status: 400 });
      if (!o.authority(msg(purgeArray(p)), hexToBytes(b.sig))) return Response.json({ error: 'the purge order is not signed by the exam authority' }, { status: 403 });
      const purged = purgeRelay(o.db, p.exam, p.shift);
      log(`PURGED ${JSON.stringify({ exam: p.exam, shift: p.shift, sthId: p.sthId, entries: purged })}`);
      return Response.json({ purged });
    } },
  };
}
```
(The relay keeps the shift's heads in memory until it restarts. Nothing is forwarded, because each stream's cell head already equals its head.)

- [ ] **Step 4: Run the tests**

Run: `bun test --timeout 60000 apps/server/test/archive.test.ts && pnpm --filter @saakshi/server typecheck`
Expected: PASS.

---
### Task 10: Control's ops — the detection loop and its routes (incidents, acks, CERT-In, approvals, time, chaos, archive, status, notices)

**Files:**
- Create: `apps/server/src/ops-monitor.ts`, `apps/server/src/ops-routes.ts`
- Test: `apps/server/test/ops-routes.test.ts`

**Interfaces:**
- Consumes: Task 6 (`Incidents`, `Snapshot`), Task 7 (`timeAudit`), Task 8 (`publicStatus`, `Outbox`, `draftNotice`, `NOTICE_KINDS`), Task 9 (`writeArchive`, `verifyArchive`, `signPurge`, `ArchiveBundle`), Task 1 types; `signer`, `verifier`, `sthId`.
- Produces:
  - `opsMonitor(o: MonitorOpts)` → `{ tick(): Promise<Incident[]>; start(): void; stop(): void; incidents: Incidents; outbox: Outbox; link(): LinkView | undefined; fleet(): FleetView; approvals(): Approval[]; approve(cand: string, seq: number, by: string): Approval; noteFindings(f: Finding[]): void }`, with `MonitorOpts = { dir: Directory; ops: Ops; controlDir: string; fleet: () => FleetView; relayUrl?: string; release?: () => ReleaseStatus | undefined; fetch?; now?; everyMs? }`.
  - `opsRoutes(o: OpsRoutesOpts): Routes` for every control route in the Global Constraints table except `/status` (the page itself, mounted in Task 15).
  - Files under control's `DIR`: `incidents.json` (every change), `certin/<id>.html`, `approvals.jsonl`, `outbox.jsonl`, and the two archive stores.

- [ ] **Step 1: Write the failing tests**

`apps/server/test/ops-routes.test.ts`:
```ts
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hexToBytes, randomBytes, toHex } from '@saakshi/core/bytes';
import { devPseud, trustFromKeys, type KeysFile } from '@saakshi/core/dev';
import type { Directory, FleetView } from '@saakshi/core/directory';
import { msg } from '@saakshi/core/enrol';
import { purgeArray, type PurgeOrder } from '@saakshi/core/handover';
import { signedLine } from '@saakshi/core/journal';
import { newKeyPair, signer, verifier } from '@saakshi/core/node';
import { OPS_DEMO, type CellEvent, type Incident, type PublicStatus, type TimeRow } from '@saakshi/core/ops';
import { bodyArray, bodyCommit, entryHash, genesisPrev, type Body, type Header, type Kind } from '@saakshi/core/protocol';
import { formsOf } from '@saakshi/core/sheet';
import { opsMonitor } from '../src/ops-monitor.ts';
import { opsRoutes } from '../src/ops-routes.ts';
import { seal } from '../src/seal.ts';
import { FORMS, SimSeat } from '../../../tools/sim-seat.ts';

const keys = JSON.parse(readFileSync(new URL('../../../fixtures/keys.json', import.meta.url), 'utf8')) as KeysFile;
const authority = { priv: hexToBytes(keys.authority.priv), pub: hexToBytes(keys.authority.pub) };
const forms = formsOf(FORMS);
const e = (centre: string) => ({ centre, form: 'F1' as const, extraMs: 0, pseud: '7'.repeat(64) });
const dir = { v: 1, exam: 'DEMO-2026', shift: 'S1', durationMs: 1_800_000, demoCentre: 'CEN042', issuedAt: 0,
  cells: [{ id: 'cell-1', url: 'http://c1', keyId: 'k', pub: keys.cells[0].pub, cert: '' }, { id: 'cell-2', url: 'http://c2', keyId: 'k', pub: keys.cells[1].pub, cert: '' }],
  centres: { CEN042: { cell: 'cell-1' }, CEN001: { cell: 'cell-2' } }, cands: { C0001: e('CEN042'), C0002: e('CEN042'), A1: e('CEN001') } } as unknown as Directory;
let tmp: string, t: number, cell2: FleetView['cells'][number], events: CellEvent[], calls: { url: string; body: unknown }[], sheets: unknown[];
const fleet = (): FleetView => ({ at: t, registered: 3, bound: 3, unlocked: 3, submitted: 0, entries: 0, entriesPerSec: 0, cells: [{ id: 'cell-1', state: 'LIVE', entries: 10 }, cell2],
  centres: [{ centre: 'CEN001', cell: 'cell-2', registered: 1, bound: 1, unlocked: 1, submitted: 0, entries: 1, tone: cell2.state === 'LIVE' ? 'green' : 'down' },
    { centre: 'CEN042', cell: 'cell-1', registered: 2, bound: 2, unlocked: 2, submitted: 0, entries: 9, tone: 'green' }] });
const fake = (handlers: Record<string, (body: unknown, url: URL) => unknown>) => (async (input: string | URL, init?: RequestInit) => {
  const url = new URL(String(input)), body = init?.body ? JSON.parse(String(init.body)) : undefined, key = url.origin + url.pathname;
  calls.push({ url: key, body });
  const h = handlers[key];
  if (!h) return Response.json({ error: 'not found' }, { status: 404 });
  const out = h(body, url);
  return out instanceof Response ? out : Response.json(out);
}) as unknown as typeof fetch;
const handlers: Record<string, (body: unknown, url: URL) => unknown> = {
  'http://c1/v1/events': (_b, u) => { const after = Number(u.searchParams.get('after')); const ev = events.filter((x) => x.id > after); return { events: ev, last: ev.at(-1)?.id ?? after }; },
  'http://relay/v1/link': () => ({ centre: 'CEN042', up: true, cut: false, degraded: true, rttMs: 2100, errRate: 0.3, backlog: 12, lastContactAt: t, risk: 'warn', reason: 'WAN failure likely: round trips 2.1 s (smoothed)', cell: 'LIVE' }),
  'http://relay/v1/heads': () => ({ mode: 'relay', state: 'LIVE', streams: [] }),
  'http://relay/v1/purge': (b) => { const x = b as { order: PurgeOrder; sig: string }; return verifier(authority.pub)(msg(purgeArray(x.order)), hexToBytes(x.sig)) ? { purged: 42 } : Response.json({ error: 'bad sig' }, { status: 403 }); },
  'http://relay/v1/dev/degrade': (b) => ({ degraded: (b as { on: boolean }).on }),
  'http://stack/kill': (b) => ({ ...(b as object), killed: true, wiped: ['cell-2.db'] }),
  'http://stack/start': (b) => ({ ...(b as object), pid: 4242 }),
  'http://c1/v1/shift': () => ({ cell: 'cell-1', exam: 'DEMO-2026', shift: 'S1', sheets }),
};
function build(o: { stack?: boolean } = {}) {
  const custody: string[] = [];
  const f = fake(handlers);
  const monitor = opsMonitor({ dir, ops: OPS_DEMO, controlDir: tmp, fleet, relayUrl: 'http://relay', fetch: f, now: () => t });
  const routes = opsRoutes({ monitor, dir, ops: OPS_DEMO, controlDir: tmp, authority, cellUrl: 'http://c1', relayUrl: 'http://relay', ...(o.stack ? { stackUrl: 'http://stack' } : {}),
    forms, roster: ['C0001', 'C0002'], recPath: join(tmp, 'sth-DEMO-2026-S1.json'), stores: [join(tmp, 'worm-a'), join(tmp, 'worm-b')],
    custody: (action) => custody.push(action), fetch: f, now: () => t });
  const call = async (path: string, method: 'GET' | 'POST', body?: unknown) => {
    const r = await routes[path.split('?')[0]][method]!(new Request(`http://control${path}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }), { timeout() {} });
    const text = await r.text();
    return { status: r.status, text, body: (() => { try { return JSON.parse(text); } catch { return undefined; } })() };
  };
  return { monitor, call, custody };
}
beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 'saakshi-ops-')); t = 1_000; cell2 = { id: 'cell-2', state: 'LIVE', entries: 50 }; events = []; calls = []; sheets = []; });
afterEach(() => {
  for (const s of ['worm-a', 'worm-b']) { const d = join(tmp, s); if (existsSync(d)) for (const f of readdirSync(d)) if (process.platform !== 'win32') chmodSync(join(d, f), 0o644); }
  rmSync(tmp, { recursive: true, force: true });
});

test('the loop: a down cell, a predicted WAN failure and a gap become incidents; ack works; a notice is drafted for the public ones', async () => {
  const { monitor, call } = build();
  await monitor.tick();
  cell2 = { id: 'cell-2', state: 'DOWN', entries: 50 };
  events = [{ id: 1, at: t, cell: 'cell-1', code: 'GAP', cand: 'C0001', centre: 'CEN042', seq: 9, reason: '{}', data: { cause: 'suspend', pausedMs: 125_000 } }];
  await monitor.tick();
  const r = (await call('/v1/incidents', 'GET')).body as { demo: boolean; incidents: Incident[] };
  expect(r.demo).toBe(true);
  expect(r.incidents.map((i) => i.kind)).toEqual(['CELL_DOWN', 'SYNC_LAG', 'GAP']);                    // by severity, then age
  expect(r.incidents[0].blast).toMatchObject({ cells: ['cell-2'], centres: ['CEN001'], candidates: 1 });
  expect((await call('/v1/incidents/ack', 'POST', { id: r.incidents[0].id, by: 'CONTROL-1' })).body).toMatchObject({ ack: { by: 'CONTROL-1', rung: 'control' } });
  expect((await call('/v1/incidents/ack', 'POST', { id: 'NOPE', by: 'x' })).status).toBe(404);
  expect((await call('/v1/notices', 'GET')).body.drafts.map((n: { incident: string }) => n.incident)).toEqual([r.incidents[0].id]);
  expect(JSON.parse(readFileSync(join(tmp, 'incidents.json'), 'utf8')).length).toBe(3);
});

test('TAMPER climbs to the regulator on DEMO timers and the CERT-In draft is served; unknown drafts are 404', async () => {
  const { monitor, call } = build();
  events = [{ id: 1, at: t, cell: 'cell-1', code: 'FORK', cand: 'C0002', centre: 'CEN042', seq: 5, reason: 'seq 5 already holds a different signed entry' }];
  await monitor.tick();
  t += 10_000;
  await monitor.tick();
  const i = monitor.incidents.open().find((x) => x.kind === 'TAMPER')!;
  expect(i.certIn).toBe(`certin/${i.id}.html`);
  const html = await call(`/v1/incidents/certin?id=${i.id}`, 'GET');
  expect([html.status, html.text.includes('DRAFT TEMPLATE')]).toEqual([200, true]);
  expect((await call('/v1/incidents/certin?id=GAP-9', 'GET')).status).toBe(404);
});

test('approved credit reaches the time audit; a move\'s invigilator approval counts too', async () => {
  const { monitor, call } = build();
  const sign = signer(newKeyPair()), ctx = { exam: 'DEMO-2026', shift: 'S1', attempt: 1, cand: 'C0001' };
  let prev = genesisPrev(ctx);
  const step = (seq: number, kind: Kind, active: number, rx: number, body: Body) => {
    const salt = randomBytes(16);
    const h: Header = { ...ctx, keyEpoch: 1, seq, prev, kind, tMonoMs: active, activeMs: active, bodyCommit: bodyCommit(salt, body) };
    prev = toHex(entryHash(h));
    return { line: signedLine(h, sign), salt: toHex(salt), body: bodyArray(body), rx: [rx, rx] };
  };
  const E: Body = { item: '', state: '', answer: '', meta: [] };
  sheets = [{ ctx, form: 'F1', pseud: '7'.repeat(64), keys: [], entries: [step(1, 'unlock', 0, 1_000, E), step(2, 'gap', 0, 126_000, { ...E, meta: ['suspend', 125_000] })] }];
  expect(((await call('/v1/time', 'GET')).body.rows as TimeRow[])[0].flags).toEqual(['PENDING_APPROVAL']);
  expect((await call('/v1/gaps/approve', 'POST', { cand: 'C0001', seq: 2, by: '' })).status).toBe(400);
  expect((await call('/v1/gaps/approve', 'POST', { cand: 'C0001', seq: 2, by: 'CONTROL-1' })).status).toBe(200);
  const row = ((await call('/v1/time', 'GET')).body.rows as TimeRow[])[0];
  expect([row.creditedMs, row.flags, row.gaps[0].approvedBy]).toEqual([125_000, [], 'CONTROL-1']);
  expect(readFileSync(join(tmp, 'approvals.jsonl'), 'utf8')).toContain('"CONTROL-1"');
  events = [{ id: 1, at: t, cell: 'cell-1', code: 'HANDOVER', cand: 'C0002', centre: 'CEN042', seq: 6, reason: '{}', data: { keyEpoch: 2, fromSeq: 6, via: 'pin', approvedBy: 'INV-42-A', creditedMs: 1, seatId: 'CEN042-S02' } }];
  await monitor.tick();
  expect(monitor.approvals()).toContainEqual({ cand: 'C0002', seq: 7, by: 'INV-42-A', at: t });
});

test('chaos goes through the supervisor: without it the buttons explain; with it the plug is pulled, restarted, the spare started; all logged', async () => {
  const none = build();
  const r = await none.call('/v1/chaos/plug', 'POST', { cell: 'cell-2', wipe: true });
  expect([r.status, r.body.error]).toEqual([409, expect.stringContaining('bun tools/stack.ts')]);
  const s = build({ stack: true });
  expect((await s.call('/v1/chaos/plug', 'POST', { cell: 'cell-9', wipe: true })).status).toBe(400);
  expect((await s.call('/v1/chaos/plug', 'POST', { cell: 'cell-2', wipe: true })).body).toEqual({ node: 'cell-2', wipe: true, killed: true, wiped: ['cell-2.db'] });
  expect((await s.call('/v1/chaos/restart', 'POST', { cell: 'cell-2' })).body).toEqual({ node: 'cell-2', pid: 4242 });
  expect((await s.call('/v1/chaos/spare', 'POST', {})).body).toMatchObject({ node: 'relay', killed: true, pid: 4242 });
  expect((await s.call('/v1/chaos/degrade', 'POST', { on: true })).body).toEqual({ degraded: true });
  expect(s.custody).toEqual(['chaos-plug', 'chaos-restart', 'chaos-spare-relay', 'chaos-degrade']);
});

test('archive: both stores written and verified; purge only then, with an authority-signed order; a damaged store blocks the purge', async () => {
  const { call, custody } = build();
  expect((await call('/v1/archive', 'POST')).status).toBe(409);                                   // nothing sealed yet
  const s = new SimSeat(keys, 'C0001', hexToBytes(keys.cells[0].pub)); s.add(21); s.submit();
  sheets = [s.sheet()];
  const { rec } = seal(undefined, { cell: 'cell-1', exam: 'DEMO-2026', shift: 'S1', sheets: [s.sheet()] }, { authority, trust: trustFromKeys(keys), pseud: devPseud, now: () => 1 });
  writeFileSync(join(tmp, 'sth-DEMO-2026-S1.json'), JSON.stringify(rec));
  const w = await call('/v1/archive', 'POST');
  expect([w.status, w.body.ok, w.body.stores.length]).toEqual([200, true, 2]);
  expect((await call('/v1/archive/purge', 'POST')).body).toMatchObject({ purged: 42, report: { ok: true } });
  const p = join(tmp, 'worm-b', 'DEMO-2026-S1-1.bundle.json');
  if (process.platform !== 'win32') chmodSync(p, 0o644);
  writeFileSync(p, '{}');
  const before = calls.filter((c) => c.url === 'http://relay/v1/purge').length;
  expect((await call('/v1/archive/purge', 'POST')).status).toBe(409);
  expect(calls.filter((c) => c.url === 'http://relay/v1/purge').length).toBe(before);
  expect(custody).toEqual(['archive-write', 'purge-ordered']);
});

test('the public status carries no roll numbers or staff ids; an approved notice appears on it', async () => {
  const { monitor, call } = build();
  cell2 = { id: 'cell-2', state: 'DOWN', entries: 50 };
  events = [{ id: 1, at: t, cell: 'cell-1', code: 'HANDOVER', cand: 'C0002', centre: 'CEN042', seq: 6, reason: '{}', data: { keyEpoch: 2, fromSeq: 6, via: 'pin', approvedBy: 'INV-42-A', creditedMs: 1, seatId: 'CEN042-S02' } }];
  await monitor.tick();
  const [d] = (await call('/v1/notices', 'GET')).body.drafts as { id: string }[];
  expect((await call('/v1/notices/approve', 'POST', { id: d.id, by: 'CONTROL-1' })).status).toBe(200);
  const s = (await call('/v1/status/public', 'GET')).body as PublicStatus;
  expect([s.incidents.length, s.notices.length]).toEqual([1, 1]);
  expect(JSON.stringify(s)).not.toMatch(/C000\d|INV-42-A|CEN042-S02|CONTROL-1/);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `bun test --timeout 60000 apps/server/test/ops-routes.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: `apps/server/src/ops-monitor.ts`**

```ts
// Control's detection loop (plan §3.10). Every second: the fleet view, each cell's new evidence events, the demo relay's link and seat
// heads, and the release status go into the rules engine. The regulator rung writes a CERT-In draft; centre-level incidents get a
// notice draft for a human to approve. Incidents are rebuilt from live state (Decision 6); incidents.json records every change.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Directory, FleetView, ReleaseStatus } from '@saakshi/core/directory';
import type { Approval, CellEvent, Incident, LinkView, Ops } from '@saakshi/core/ops';
import type { Finding } from '@saakshi/core/sheet';
import type { HeadsRes } from '@saakshi/core/wire';
import { certInHtml } from './certin.ts';
import { draftNotice, NOTICE_KINDS, Outbox } from './comms.ts';
import { Incidents } from './incidents.ts';

export interface MonitorOpts {
  dir: Directory; ops: Ops; controlDir: string; fleet: () => FleetView; relayUrl?: string;
  release?: () => ReleaseStatus | undefined; fetch?: typeof fetch; now?: () => number; everyMs?: number;
}

export function opsMonitor(o: MonitorOpts) {
  const f = o.fetch ?? fetch, now = o.now ?? Date.now;
  mkdirSync(join(o.controlDir, 'certin'), { recursive: true });
  const outbox = new Outbox(join(o.controlDir, 'outbox.jsonl'));
  const incidents = new Incidents(o.dir, o.ops, { regulator: (i) => {
    const rel = `certin/${i.id}.html`;
    writeFileSync(join(o.controlDir, rel), certInHtml(i, { exam: o.dir.exam, shift: o.dir.shift, now: now() }));
    return rel;
  } });
  const approvalsPath = join(o.controlDir, 'approvals.jsonl');
  const approved: Approval[] = existsSync(approvalsPath) ? readFileSync(approvalsPath, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Approval) : [];
  const moves = new Map<string, Approval>();                                           // invigilators' approvals, from HANDOVER events
  const cursor = new Map<string, number>(o.dir.cells.map((c) => [c.id, 0]));
  let link: LinkView | undefined, findings: Finding[] = [], timer: ReturnType<typeof setTimeout> | undefined;
  const get = async <T>(url: string): Promise<T | undefined> => {
    try { const r = await f(url, { signal: AbortSignal.timeout(2_000) }); return r.ok ? ((await r.json()) as T) : undefined; } catch { return undefined; }
  };

  async function tick(): Promise<Incident[]> {
    const fl = o.fleet(), fresh: CellEvent[] = [];
    for (const c of o.dir.cells) {
      const st = fl.cells.find((x) => x.id === c.id)?.state;
      if (st !== 'LIVE') { cursor.set(c.id, 0); continue; }                           // wiped or restarting: re-read from 0 (the rules dedupe)
      let after = cursor.get(c.id) ?? 0;
      for (let page = 0; page < 20; page++) {
        const r = await get<{ events: CellEvent[]; last: number }>(`${c.url}/v1/events?after=${after}`);
        if (!r) break;
        fresh.push(...r.events);
        after = r.last;
        if (r.events.length < 500) break;
      }
      cursor.set(c.id, after);
    }
    const [lk, heads] = o.relayUrl ? await Promise.all([get<LinkView>(`${o.relayUrl}/v1/link`), get<HeadsRes>(`${o.relayUrl}/v1/heads`)]) : [undefined, undefined];
    link = lk;
    for (const e of fresh) if (e.code === 'HANDOVER' && e.data?.approvedBy) {
      const a: Approval = { cand: e.cand, seq: Number(e.data.fromSeq) + 1, by: String(e.data.approvedBy), at: e.at };
      moves.set(`${a.cand}/${a.seq}`, a);
    }
    const changed = incidents.evaluate({ now: now(), fleet: fl, events: fresh, link, relay: heads, release: o.release?.(), findings });
    findings = [];
    for (const i of changed) if (!i.resolvedAt && NOTICE_KINDS.has(i.kind)) outbox.draft(draftNotice(i, o.dir.exam, o.dir.shift, now()));
    if (changed.length) writeFileSync(join(o.controlDir, 'incidents.json'), JSON.stringify(incidents.all(), null, 2));
    return changed;
  }

  return {
    tick, incidents, outbox,
    link: () => link,
    fleet: () => o.fleet(),
    approvals: (): Approval[] => [...approved, ...moves.values()],
    /** Control approves a gap's (or an old-key move's) credited time; the matching incident closes. */
    approve(cand: string, seq: number, by: string): Approval {
      const who = by.trim();
      if (!who || who.length > 64 || !o.dir.cands[cand] || !Number.isSafeInteger(seq) || seq < 1) throw new Error('need {cand, seq, by}');
      const a: Approval = { cand, seq, by: who, at: now() };
      appendFileSync(approvalsPath, JSON.stringify(a) + '\n');
      approved.push(a);
      for (const i of incidents.open()) if (i.cand === cand && ((i.kind === 'GAP' && i.data.seq === seq) || (i.kind === 'HANDOVER' && Number(i.data.fromSeq) + 1 === seq))) incidents.resolve(i.id, a.at);
      return a;
    },
    noteFindings(f2: Finding[]): void { findings = [...findings, ...f2]; },
    start(): void { const loop = async () => { await tick().catch(() => {}); timer = setTimeout(loop, o.everyMs ?? 1_000); }; void loop(); },
    stop(): void { clearTimeout(timer); },
  };
}
export type OpsMonitor = ReturnType<typeof opsMonitor>;
```

- [ ] **Step 4: `apps/server/src/ops-routes.ts`**

```ts
// Control routes added in Stage 4 (plan §3.7, §3.10–§3.11): incidents and the ladder, CERT-In drafts, credited-time approvals, the time
// audit, the labelled chaos buttons (through the demo supervisor, tools/stack.ts), the two-store archive and the signed purge, the
// public status and the notice outbox. Errors are {error} with Stage 2's status rules.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Directory } from '@saakshi/core/directory';
import { sthId } from '@saakshi/core/log';
import { signer, verifier, type KeyPair } from '@saakshi/core/node';
import type { Incident, Ops, Severity } from '@saakshi/core/ops';
import type { Forms, ShiftExport, SthRecord } from '@saakshi/core/sheet';
import { signPurge, verifyArchive, writeArchive, type ArchiveBundle } from './archive.ts';
import type { OpsMonitor } from './ops-monitor.ts';
import type { Routes } from './serve.ts';
import { publicStatus } from './status-view.ts';
import { timeAudit } from './time-audit.ts';

export interface OpsRoutesOpts {
  monitor: OpsMonitor; dir: Directory; ops: Ops; controlDir: string; authority: KeyPair;
  cellUrl: string; relayUrl: string; stackUrl?: string; forms: Forms; roster: string[]; recPath: string; stores: [string, string];
  custody: (action: string, detail: Record<string, unknown>) => void; fetch?: typeof fetch; now?: () => number;
}
class HttpError extends Error { status: number; constructor(status: number, m: string) { super(m); this.status = status; } }
const json = (body: unknown, status = 200) => Response.json(body, { status });
const RANK: Record<Severity, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };

export function opsRoutes(o: OpsRoutesOpts): Routes {
  const f = o.fetch ?? fetch, now = o.now ?? Date.now, m = o.monitor;
  const handle = (fn: (req: Request) => Promise<Response>) => async (req: Request) => {
    try { return await fn(req); } catch (e) { return json({ error: (e as Error).message }, e instanceof HttpError ? e.status : 500); }
  };
  const body = async (req: Request) => ((await req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
  async function upstream<T>(url: string, payload?: unknown): Promise<T> {
    let r: Response;
    try { r = await f(url, { method: payload === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json' }, body: payload === undefined ? undefined : JSON.stringify(payload), signal: AbortSignal.timeout(10_000) }); }
    catch (e) { throw new HttpError(502, `${new URL(url).origin} unreachable: ${(e as Error).message}`); }
    if (!r.ok) throw new HttpError(502, `${new URL(url).pathname} answered ${r.status}: ${await r.text()}`);
    return (await r.json()) as T;
  }
  const stack = (path: string, payload: unknown) => {
    if (!o.stackUrl) throw new HttpError(409, 'chaos needs the demo supervisor: start the demo with `bun tools/stack.ts` (it sets STACK_URL)');
    return upstream<Record<string, unknown>>(`${o.stackUrl}${path}`, payload);
  };
  const cellOf = (x: unknown): string => { if (typeof x !== 'string' || !o.dir.cells.some((c) => c.id === x)) throw new HttpError(400, 'need {cell: one of the directory\'s cells}'); return x; };
  const exportNow = () => upstream<ShiftExport>(`${o.cellUrl}/v1/shift?exam=${encodeURIComponent(o.dir.exam)}&shift=${encodeURIComponent(o.dir.shift)}`);
  const sealed = () => {
    const rec = existsSync(o.recPath) ? (JSON.parse(readFileSync(o.recPath, 'utf8')) as SthRecord) : undefined;
    const sth = rec?.sths.at(-1);
    if (!rec || !sth) throw new HttpError(409, 'seal the shift first');
    return { rec, sth };
  };
  const verify = () => { const { sth } = sealed(); return verifyArchive(o.stores, { exam: o.dir.exam, shift: o.dir.shift, sth }, verifier(o.authority.pub)); };

  return {
    '/v1/incidents': { GET: () => {
      const all = m.incidents.all();
      const open = all.filter((i) => !i.resolvedAt).sort((a, b) => RANK[a.severity] - RANK[b.severity] || a.openedAt - b.openedAt);
      const closed = all.filter((i) => i.resolvedAt).sort((a, b) => b.resolvedAt! - a.resolvedAt!).slice(0, 20);
      return json({ at: now(), demo: o.ops.demo, ladderMs: o.ops.ladderMs, incidents: [...open, ...closed] });
    } },
    '/v1/incidents/ack': { POST: handle(async (req) => {
      const b = await body(req);
      if (typeof b.id !== 'string' || !m.incidents.get(b.id)) throw new HttpError(404, `no incident ${String(b.id)}`);
      let i: Incident;
      try { i = m.incidents.ack(b.id, String(b.by ?? ''), now()); } catch (e) { throw new HttpError(400, (e as Error).message); }
      o.custody('incident-ack', { id: i.id, kind: i.kind, by: i.ack!.by, rung: i.ack!.rung });
      return json(i);
    }) },
    '/v1/incidents/resolve': { POST: handle(async (req) => {
      const b = await body(req);
      if (typeof b.id !== 'string' || !m.incidents.get(b.id)) throw new HttpError(404, `no incident ${String(b.id)}`);
      try { return json(m.incidents.resolve(b.id, now())); } catch (e) { throw new HttpError(409, (e as Error).message); }
    }) },
    '/v1/incidents/certin': { GET: handle(async (req) => {
      const i = m.incidents.get(new URL(req.url).searchParams.get('id') ?? '');
      if (!i?.certIn) throw new HttpError(404, 'no CERT-In draft for that incident');
      return new Response(readFileSync(join(o.controlDir, i.certIn), 'utf8'), { headers: { 'content-type': 'text/html; charset=utf-8' } });
    }) },
    '/v1/gaps/approve': { POST: handle(async (req) => {
      const b = await body(req);
      let a;
      try { a = m.approve(String(b.cand ?? ''), Number(b.seq), String(b.by ?? '')); } catch (e) { throw new HttpError(400, (e as Error).message); }
      o.custody('credit-approved', { ...a });
      return json(a);
    }) },
    '/v1/time': { GET: handle(async () => {
      const exp = await exportNow();
      const rows = exp.sheets.filter((s) => o.roster.includes(s.ctx.cand)).map((s) => timeAudit(s, o.forms[s.form] ?? [], m.approvals(), o.ops));
      return json({ rows });
    }) },
    '/v1/link': { GET: () => { const l = m.link(); return l ? json(l) : json({ error: 'the relay\'s link view is unavailable' }, 502); } },
    '/v1/chaos/plug': { POST: handle(async (req) => {
      const b = await body(req), cell = cellOf(b.cell), wipe = b.wipe === true;
      const out = await stack('/kill', { node: cell, wipe });
      o.custody('chaos-plug', { cell, wipe, note: `DEV chaos: "Pull the plug on ${cell}"${wipe ? ' and delete its database' : ''}` });
      return json(out);
    }) },
    '/v1/chaos/restart': { POST: handle(async (req) => {
      const cell = cellOf((await body(req)).cell);
      const out = await stack('/start', { node: cell });
      o.custody('chaos-restart', { cell });
      return json(out);
    }) },
    '/v1/chaos/spare': { POST: handle(async () => {
      const killed = await stack('/kill', { node: 'relay', wipe: true });
      const started = await stack('/start', { node: 'relay' });
      o.custody('chaos-spare-relay', { note: 'DEV chaos: the centre relay replaced by a spare with an empty database; seats resend from their journals' });
      return json({ ...killed, ...started });
    }) },
    '/v1/chaos/degrade': { POST: handle(async (req) => {
      const b = await body(req);
      if (typeof b.on !== 'boolean') throw new HttpError(400, 'need {on: boolean}');
      const out = await upstream<{ degraded: boolean }>(`${o.relayUrl}/v1/dev/degrade`, { on: b.on });
      o.custody('chaos-degrade', { centre: o.dir.demoCentre, on: b.on });
      return json(out);
    }) },
    '/v1/archive': { POST: handle(async () => {
      const { rec, sth } = sealed();
      const bundle: ArchiveBundle = { v: 1, exam: o.dir.exam, shift: o.dir.shift, sth, leaves: rec.leaves.slice(0, sth.sth.size), export: await exportNow() };
      const t0 = performance.now();
      const written = writeArchive(o.stores, bundle);
      const writtenMs = Math.round(performance.now() - t0);
      const report = { ...verify(), writtenMs };
      o.custody('archive-write', { sthId: sthId(sth.sth), size: sth.sth.size, stores: written.map((w) => ({ store: w.store, sha256: w.sha256, detail: w.detail })), ok: report.ok });
      return json(report);
    }) },
    '/v1/archive/verify': { GET: handle(async () => json(verify())) },
    '/v1/archive/purge': { POST: handle(async () => {
      const report = verify();
      if (!report.ok) return json({ error: 'both archive stores must verify against the signed register head before any purge', report }, 409);
      const { sth } = sealed();
      const order = signPurge({ exam: o.dir.exam, shift: o.dir.shift, sthId: sthId(sth.sth), ts: now() }, signer(o.authority));
      const out = await upstream<{ purged: number }>(`${o.relayUrl}/v1/purge`, order);
      o.custody('purge-ordered', { sthId: order.order.sthId, purged: out.purged });
      return json({ purged: out.purged, report });
    }) },
    '/v1/status/public': { GET: () => json(publicStatus({ exam: o.dir.exam, shift: o.dir.shift, now: now(), fleet: m.fleet(), incidents: m.incidents.all(), notices: m.outbox.sent() })) },
    '/v1/notices': { GET: () => json({ drafts: m.outbox.drafts(), sent: m.outbox.sent() }) },
    '/v1/notices/approve': { POST: handle(async (req) => {
      const b = await body(req);
      let n;
      try { n = m.outbox.approve(String(b.id ?? ''), String(b.by ?? ''), now()); } catch (e) { throw new HttpError(400, (e as Error).message); }
      o.custody('notice-sent', { id: n.id, channels: n.channels, audience: n.audience, centres: n.centres });
      return json(n);
    }) },
  };
}
```

- [ ] **Step 5: Run the tests**

Run: `bun test --timeout 60000 apps/server/test/ops-routes.test.ts && pnpm --filter @saakshi/server typecheck`
Expected: PASS.

---

### Task 11: The control room — incidents and the ladder, chaos buttons, the link, the time audit, notices, the archive

**Files:**
- Modify: `apps/server/src/control.html`, `apps/server/src/control-page.ts`, `apps/server/src/control-view.ts`
- Test: add to `apps/server/test/control-view.test.ts`

**Interfaces:**
- Consumes: the Task 10 route shapes (Global Constraints table), Task 1 types, Task 6's browser-safe `blastText`, `dcName` and `mmss` (imported from `./incidents.ts`).
- Produces: `control-view.ts`: `SEV_WORD`, `incidentCard(i: Incident, now: number, ladderMs: Record<Severity, number>)`, `linkLine(v: LinkView)`, `timeCells(r: TimeRow)`, `archiveLines(r: ArchiveReport)`, `noticeText(n: Notice)`.

- [ ] **Step 1: Write the failing tests** (append to `control-view.test.ts`)

```ts
import type { ArchiveReport, Incident, LinkView, Notice, TimeRow } from '@saakshi/core/ops';
import { OPS_DEMO } from '@saakshi/core/ops';
import { archiveLines, incidentCard, linkLine, noticeText, timeCells } from '../src/control-view.ts';

const incident = (o: Partial<Incident> = {}): Incident => ({ id: 'CELL_DOWN-3', kind: 'CELL_DOWN', severity: 'P1', key: 'k', title: 'Data Centre 2 is down', detail: 'no answer from it',
  blast: { cells: ['cell-2'], centres: Array.from({ length: 33 }, (_, i) => `CEN${i}`), candidates: 6_600, answersLost: null }, openedAt: 0, updatedAt: 0, rung: 2,
  ladder: [{ rung: 'control', at: 0 }], data: {}, ...o });

test('incident card: severity as a word, the blast radius, age, the ladder with the next step and its timer; acked and resolved read plainly', () => {
  const c = incidentCard(incident(), 7_000, OPS_DEMO.ladderMs);
  expect(c).toEqual({
    badge: 'P1 major', tone: 'p1', title: 'Data Centre 2 is down', blast: '1 cell · 33 centres · 6,600 candidates · answers lost: not known yet',
    age: 'open 0:07', ladder: 'invigilator · superintendent · [control] · regulator', next: 'escalates to regulator in 3 s unless acknowledged',
    detail: 'no answer from it', canAck: true, canResolve: false,
  });
  const acked = incidentCard(incident({ ack: { by: 'CONTROL-1', rung: 'control', at: 5_000 } }), 7_000, OPS_DEMO.ladderMs);
  expect([acked.next, acked.canAck]).toEqual(['acknowledged by CONTROL-1 (control)', false]);
  const done = incidentCard(incident({ resolvedAt: 60_000, blast: { cells: ['cell-2'], centres: ['CEN0'], candidates: 200, answersLost: 0 } }), 90_000, OPS_DEMO.ladderMs);
  expect([done.age, done.blast, done.next]).toEqual(['closed after 1:00', '1 cell · 1 centre · 200 candidates · answers lost 0', 'closed']);
  expect(incidentCard(incident({ kind: 'GAP', severity: 'P3', rung: 0, ladder: [{ rung: 'invigilator', at: 0 }] }), 1_000, OPS_DEMO.ladderMs)).toMatchObject({ badge: 'P3 notice', next: 'stays with the invigilator', canResolve: true });
});

test('link, time, notices and archive lines', () => {
  const v: LinkView = { centre: 'CEN042', up: true, cut: false, degraded: true, rttMs: 2_100, errRate: 0.3, backlog: 12, lastContactAt: 0, risk: 'warn', reason: 'WAN failure likely: round trips 2.1 s (smoothed)', cell: 'LIVE' };
  expect(linkLine(v)).toEqual({ text: 'CEN042 link: WAN failure likely: round trips 2.1 s (smoothed) · backlog 12 · round trip 2.1 s', tone: 'bad' });
  const r: TimeRow = { cand: 'C0001', wallMs: 400_000, activeMs: 292_000, unaccountedMs: 108_000, creditedMs: 108_000, flags: [], changedAfterMove: [{ item: 'I02', q: 2 }],
    gaps: [{ seq: 7, kind: 'handover', cause: 'moved (pin)', pausedMs: 0, measuredMs: 108_000, approved: true, approvedBy: 'INV-42-A' }] };
  expect(timeCells(r).map((c) => c.value)).toEqual(['C0001', '6:40', '4:52', 'entry 7 moved (pin) 1:48 ✓ INV-42-A', '+1:48', 'changed after the move: Q2', '—']);
  const n: Notice = { id: 'N-X', incident: 'X', kind: 'CELL_DOWN', centres: ['CEN001', 'CEN002'], audience: 6_600, en: 'Saakshi …', hi: 'साक्षी …', channels: ['sms', 'email', 'digilocker'], draftedAt: 0 };
  expect(noticeText(n)).toBe('To 6,600 candidates at 2 centres by SMS, e-mail and DigiLocker (mock): Saakshi …');
  const a: ArchiveReport = { exam: 'DEMO-2026', shift: 'S1', size: 12, root: 'ab'.repeat(32), ok: true, writtenMs: 14, verifyMs: 9,
    stores: [{ store: 'data/control/worm-a', path: 'p', sha256: 'cd'.repeat(32), ok: true, detail: '12 leaves rebuild the signed root; SHA-256 matches' }, { store: 'data/control/worm-b', path: 'p', sha256: 'cd'.repeat(32), ok: true, detail: 'x' }] };
  expect(archiveLines(a)).toEqual(['Both stores verify against the signed register head (12 leaves, root abab abab abab abab …).',
    'data/control/worm-a: ✓ 12 leaves rebuild the signed root; SHA-256 matches', 'data/control/worm-b: ✓ x', 'Written in 14 ms · verified in 9 ms.']);
});
```
The existing test `UI rules: the control page and the relay console use a 1.25 type scale and render server text with textContent only` keeps covering `control.html` and `control-page.ts`.

- [ ] **Step 2: Run to verify they fail**

Run: `bun test --timeout 60000 apps/server/test/control-view.test.ts`
Expected: FAIL — `incidentCard` is not exported.

- [ ] **Step 3: `control-view.ts` additions**

```ts
import { RUNGS, type ArchiveReport, type Incident, type LinkView, type Notice, type Severity, type TimeRow } from '@saakshi/core/ops';
import { blastText, mmss } from './incidents.ts';

export const SEV_WORD: Record<Severity, string> = { P0: 'P0 critical', P1: 'P1 major', P2: 'P2 minor', P3: 'P3 notice' };
const TOP: Record<Severity, number> = { P0: 3, P1: 3, P2: 2, P3: 0 };
export interface Card { badge: string; tone: string; title: string; blast: string; age: string; ladder: string; next: string; detail: string; canAck: boolean; canResolve: boolean }
const STATEFUL = new Set(['CELL_DOWN', 'CENTRE_OUTAGE', 'SEAT_SILENT', 'RELAY_WAN_DOWN', 'SYNC_LAG', 'KEY_RELEASE_DELAY']);

export function incidentCard(i: Incident, now: number, ladderMs: Record<Severity, number>): Card {
  const top = TOP[i.severity], every = ladderMs[i.severity], last = i.ladder[i.ladder.length - 1]?.at ?? i.openedAt;
  const next = i.resolvedAt ? 'closed' : i.ack ? `acknowledged by ${i.ack.by} (${i.ack.rung})` : !every || top === 0 ? 'stays with the invigilator'
    : i.rung >= top ? `at the top rung (${RUNGS[i.rung]})` : `escalates to ${RUNGS[i.rung + 1]} in ${Math.max(0, Math.ceil((last + every - now) / 1000))} s unless acknowledged`;
  return {
    badge: SEV_WORD[i.severity], tone: i.severity.toLowerCase(), title: i.title, blast: blastText(i.blast),
    age: i.resolvedAt ? `closed after ${mmss(i.resolvedAt - i.openedAt)}` : `open ${mmss(now - i.openedAt)}`,
    ladder: RUNGS.map((r, k) => (k === i.rung ? `[${r}]` : r)).join(' · '), next, detail: i.detail,
    canAck: !i.resolvedAt && !i.ack, canResolve: !i.resolvedAt && !STATEFUL.has(i.kind),
  };
}
export function linkLine(v: LinkView): { text: string; tone: 'good' | 'bad' } {
  return { text: `${v.centre} link: ${v.reason} · backlog ${fmt(v.backlog)} · round trip ${(v.rttMs / 1000).toFixed(1)} s`, tone: v.risk === 'ok' ? 'good' : 'bad' };
}
export function timeCells(r: TimeRow): ReconCell[] {
  const gaps = r.gaps.map((g) => `entry ${g.seq} ${g.cause} ${mmss(g.measuredMs)} ${g.approved ? `✓ ${g.approvedBy}` : '(needs approval)'}`).join('; ') || '—';
  return [
    { label: 'Candidate', value: r.cand, ok: true }, { label: 'Wall (relay clock)', value: mmss(r.wallMs), ok: true }, { label: 'Active (seat)', value: mmss(r.activeMs), ok: true },
    { label: 'Gaps and moves', value: gaps, ok: r.gaps.every((g) => g.approved) }, { label: 'Credited', value: `+${mmss(r.creditedMs)}`, ok: true },
    { label: 'Review', value: r.changedAfterMove.length ? `changed after the move: ${r.changedAfterMove.map((c) => `Q${c.q}`).join(', ')}` : '—', ok: true },
    { label: 'Flags', value: r.flags.join(', ') || '—', ok: r.flags.length === 0 },
  ];
}
const CHANNEL = { sms: 'SMS', email: 'e-mail', digilocker: 'DigiLocker' } as const;
export function noticeText(n: Notice): string {
  const ch = n.channels.map((c) => CHANNEL[c]);
  return `To ${fmt(n.audience)} candidates at ${n.centres.length === 1 ? n.centres[0] : `${n.centres.length} centres`} by ${ch.slice(0, -1).join(', ')}${ch.length > 1 ? ' and ' : ''}${ch.at(-1)} (mock): ${n.en}`;
}
export function archiveLines(a: ArchiveReport): string[] {
  return [
    a.ok ? `Both stores verify against the signed register head (${a.size} leaves, root ${group(a.root.slice(0, 16))} …).` : 'NOT verified — no purge until both stores verify.',
    ...a.stores.map((s) => `${s.store}: ${s.ok ? '✓' : '✗'} ${s.detail}`),
    `${a.writtenMs !== undefined ? `Written in ${a.writtenMs} ms · ` : ''}verified in ${a.verifyMs} ms.`.replace(/^v/, 'V'),
  ];
}
```
(`fmt`, `group` and `ReconCell` already exist in this file.)

- [ ] **Step 4: `control.html` — a "Contain every failure" section, above "Prove it"**

```html
    <h2>Contain every failure</h2>
    <p id="ops-mode" class="note"></p>
    <h3>Incidents</h3>
    <ol id="incidents" aria-label="Incidents, most severe first"></ol>
    <form id="ack-form"><label>Acknowledge as <input id="ack-by" autocomplete="off" required size="14" placeholder="e.g. CONTROL-1" /></label></form>
    <h3>Link to Centre 42</h3>
    <p id="link" role="status">…</p>
    <h3>Labelled chaos</h3>
    <div class="chaos-row">
      <button class="chaos" id="plug">Pull the plug on Data Centre 2 (and delete its database)</button>
      <button id="restart">Restart Data Centre 2</button>
      <button class="chaos" id="degrade-on">Degrade Centre 42's link</button>
      <button id="degrade-off">Stop degrading</button>
      <button class="chaos" id="spare">Replace Centre 42's relay with the spare</button>
    </div>
    <p class="note">DEV chaos through the demo supervisor (<code>bun tools/stack.ts</code>). Each action is written to the custody log.</p>
    <p id="chaos-out" class="out" role="status"></p>
    <h3>Time audit — Centre 42</h3>
    <table><thead><tr><th scope="col">Candidate</th><th scope="col">Wall (relay clock)</th><th scope="col">Active (seat)</th><th scope="col">Gaps and moves</th><th scope="col">Credited</th><th scope="col">Review</th><th scope="col">Flags</th></tr></thead>
      <tbody id="time"></tbody></table>
    <form id="approve"><label>Candidate <input name="cand" value="C0001" size="7" /></label><label>Entry <input name="seq" type="number" min="1" size="4" /></label>
      <button class="primary">Approve credited time</button></form>
    <p id="approve-out" class="out" role="status"></p>
    <h3>Notices to candidates</h3>
    <ul id="notices"></ul>
    <p><a href="/status">Open the public status page</a></p>
    <h3>Archive</h3>
    <button id="archive" class="primary">Archive the sealed shift to both stores</button>
    <button id="purge">Purge Centre 42's relay (only if both stores verify)</button>
    <ul id="archive-out" class="out"></ul>
```
CSS additions (no new font sizes):
```css
      #incidents { list-style: none; padding: 0; display: grid; gap: .5rem; }
      .card { border: 2px solid; border-radius: .5rem; padding: .5rem .75rem; display: grid; gap: .25rem; }
      .card.p0 { color: #8c1d18; background: #fce8e6; border-color: #c62828; } .card.p1 { color: #7a4100; background: #fef7e0; border-color: #b06000; }
      .card.p2 { color: #0b3d91; background: #e8f0fe; border-color: #1565c0; } .card.p3 { color: #3c4043; background: #f1f3f4; border-color: #9aa0a6; }
      .card.closed { opacity: .8; } .card strong { font-size: var(--s1); } .card .badge { font-weight: 700; }
      .chaos-row { display: flex; flex-wrap: wrap; gap: .5rem; }
```

- [ ] **Step 5: `control-page.ts` — wire it**

```ts
import type { ArchiveReport, Incident, LinkView, Notice, Severity, TimeRow } from '@saakshi/core/ops';
import { archiveLines, incidentCard, linkLine, noticeText, timeCells } from './control-view.ts';

const el = (tag: string, text = '', cls = '') => { const x = document.createElement(tag); x.textContent = text; if (cls) x.className = cls; return x; };
async function incidentsTick(): Promise<void> {
  try {
    const r = await call<{ at: number; demo: boolean; ladderMs: Record<Severity, number>; incidents: Incident[] }>('GET', '/v1/incidents');
    $('ops-mode').textContent = r.demo ? 'DEMO timers: each unacknowledged rung escalates after 10 s.' : 'Production timers.';
    $('incidents').replaceChildren(...r.incidents.map((i) => {
      const c = incidentCard(i, r.at, r.ladderMs), li = el('li', '', `card ${c.tone}${i.resolvedAt ? ' closed' : ''}`);
      li.append(el('span', c.badge, 'badge'), el('strong', c.title), el('span', c.blast), el('span', `${c.age} · ${c.ladder}`), el('span', c.next), el('span', c.detail));
      if (c.canAck) { const b = el('button', `Acknowledge ${i.id}`); b.addEventListener('click', () => void act('/v1/incidents/ack', { id: i.id, by: $<HTMLInputElement>('ack-by').value })); li.append(b); }
      if (c.canResolve) { const b = el('button', `Resolve ${i.id}`); b.addEventListener('click', () => void act('/v1/incidents/resolve', { id: i.id })); li.append(b); }
      if (i.certIn) { const a = el('a', 'CERT-In report draft (6-hour window)') as HTMLAnchorElement; a.href = `/v1/incidents/certin?id=${encodeURIComponent(i.id)}`; a.target = '_blank'; li.append(a); }
      if ((i.kind === 'GAP' || (i.kind === 'HANDOVER' && !i.data.approvedBy)) && !i.resolvedAt) {
        const seq = i.kind === 'GAP' ? Number(i.data.seq) : Number(i.data.fromSeq) + 1;
        const b = el('button', `Approve credited time for ${i.cand}`); b.addEventListener('click', () => void act('/v1/gaps/approve', { cand: i.cand, seq, by: $<HTMLInputElement>('ack-by').value })); li.append(b);
      }
      return li;
    }));
  } catch (e) { $('incidents').replaceChildren(el('li', `Incidents unavailable: ${(e as Error).message}`)); }
}
async function act(path: string, body: unknown): Promise<void> {
  try { await call('POST', path, body); } catch (e) { say('chaos-out', (e as Error).message, 'bad'); }
  void incidentsTick();
}
async function linkTick(): Promise<void> {
  try { const l = linkLine(await call<LinkView>('GET', '/v1/link')); $('link').textContent = l.text; $('link').className = l.tone === 'good' ? 'ok' : 'bad'; }
  catch { $('link').textContent = 'The relay\'s link view is unavailable.'; }
}
async function timeTick(): Promise<void> {
  try {
    const { rows } = await call<{ rows: TimeRow[] }>('GET', '/v1/time');
    $('time').replaceChildren(...rows.map((r) => { const tr = document.createElement('tr'); tr.append(...timeCells(r).map((c) => el('td', c.value, c.ok ? 'ok' : 'bad'))); return tr; }));
  } catch { /* the cell may be down: keep the last table */ }
}
async function noticesTick(): Promise<void> {
  try {
    const { drafts, sent } = await call<{ drafts: Notice[]; sent: Notice[] }>('GET', '/v1/notices');
    $('notices').replaceChildren(...drafts.map((n) => {
      const li = el('li', noticeText(n)), b = el('button', `Approve and send notice ${n.id}`);
      b.addEventListener('click', () => void call('POST', '/v1/notices/approve', { id: n.id, by: $<HTMLInputElement>('ack-by').value }).then(noticesTick, (e) => say('chaos-out', (e as Error).message, 'bad')));
      li.append(b);
      return li;
    }), ...sent.map((n) => el('li', `Sent at ${new Date(n.approvedAt!).toLocaleTimeString()}, approved by ${n.approvedBy}: ${noticeText(n)}`)));
  } catch { /* retry next tick */ }
}
const chaos = (id: string, path: string, body: unknown, done: string) => $(id).addEventListener('click', async () => {
  try { await call('POST', path, body); say('chaos-out', done, 'bad'); } catch (e) { say('chaos-out', (e as Error).message, 'bad'); }
});
chaos('plug', '/v1/chaos/plug', { cell: 'cell-2', wipe: true }, 'Data Centre 2: process killed, database deleted. Watch the P1 card.');
chaos('restart', '/v1/chaos/restart', { cell: 'cell-2' }, 'Data Centre 2 restarting: it rebuilds from the relays.');
chaos('degrade-on', '/v1/chaos/degrade', { on: true }, "Centre 42's link is degrading: watch for SYNC_LAG.");
chaos('degrade-off', '/v1/chaos/degrade', { on: false }, "Centre 42's link is no longer degraded.");
chaos('spare', '/v1/chaos/spare', {}, "Centre 42's relay replaced by the spare: seats resend from their journals.");
$('approve').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const f = new FormData(ev.target as HTMLFormElement);
  try { await call('POST', '/v1/gaps/approve', { cand: f.get('cand'), seq: Number(f.get('seq')), by: $<HTMLInputElement>('ack-by').value }); say('approve-out', 'Approved and logged.', 'ok'); void timeTick(); }
  catch (e) { say('approve-out', (e as Error).message, 'bad'); }
});
const showArchive = (r: ArchiveReport) => $('archive-out').replaceChildren(...archiveLines(r).map((l) => el('li', l)));
$('archive').addEventListener('click', async () => { try { showArchive(await call<ArchiveReport>('POST', '/v1/archive')); } catch (e) { $('archive-out').replaceChildren(el('li', (e as Error).message)); } });
$('purge').addEventListener('click', async () => {
  try { const r = await call<{ purged: number; report: ArchiveReport }>('POST', '/v1/archive/purge'); showArchive(r.report); $('archive-out').append(el('li', `Relay purged ${r.purged} entries on a signed order.`)); }
  catch (e) { $('archive-out').replaceChildren(el('li', (e as Error).message)); }
});
for (const [fn, ms] of [[incidentsTick, 1_000], [linkTick, 2_000], [timeTick, 3_000], [noticesTick, 3_000]] as const) { void fn(); setInterval(fn, ms); }
```
(`call`, `$` and `say` already exist in `control-page.ts`.)

- [ ] **Step 6: Run the tests**

Run: `bun test --timeout 60000 apps/server/test/control-view.test.ts && pnpm --filter @saakshi/server typecheck`
Expected: PASS. The UI-rules test still passes (no new font sizes; `textContent` only).

---
### Task 12: The seat's journal and exam — continue a chain from a grant, the handover entry, suspend/resume and restart gaps

**Files:**
- Modify: `apps/seat/src/main/journal-store.ts` (a base), `apps/seat/src/main/exam.ts` (restore, pause/resume, restart gap)
- Test: `apps/seat/test/exam-stage4.test.ts`

**Interfaces:**
- Consumes: Task 1 (`verifyChainKeyed(…, start)`); `Response`.
- Produces:
  - `SeatJournal.open(dir, ctx, wrap, verify, base = { seq: 0, head: genesisPrev(ctx) })`; `journal.base: number`; `journal.recAt(seq): Rec | undefined`. `head` and `hashAt(seq)` are absolute; `hashAt(base)` is the base head.
  - `interface Restore { seq; head; activeMs; responses: Response[]; via: 'pin' | 'key'; creditedMs }` and `type PauseCause = 'suspend' | 'lock-screen'`.
  - `SessionOpts.restore?: Restore` and `SessionOpts.wall?: () => number`.
  - `ExamSession.resumed: boolean`, `.paused: boolean`, `.pause(cause)`, `.resume(): number | undefined` (the gap's seq), `.restartGap(): number | undefined`.

- [ ] **Step 1: Write the failing tests**

`apps/seat/test/exam-stage4.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cellKey, DEV_EXAM, devPseud, devSeat, type KeysFile } from '@saakshi/core/dev';
import { responsesOf } from '@saakshi/core/log';
import { finalHash } from '@saakshi/core/protocol';
import { ExamSession, type Restore } from '../src/main/exam.ts';
import type { Wrapper } from '../src/main/journal-store.ts';

const keys = JSON.parse(readFileSync(new URL('../../../fixtures/keys.json', import.meta.url), 'utf8')) as KeysFile;
const cell = cellKey(keys, 'cell-1');
const wrap: Wrapper = { encryptString: (s) => Buffer.from('W' + s), decryptString: (b) => b.toString().slice(1) };
const items = ['I01', 'I02', 'I03'], ctx = { ...DEV_EXAM, cand: 'C0001' };
const answer = (item: string, a: string) => ({ kind: 'answer' as const, item, state: 'A' as const, answer: a, dwellMs: 1 });
function mk(dir: string, clock: () => number, o: { restore?: Restore; wall?: () => number } = {}): ExamSession {
  return new ExamSession({ dir, ctx, keyEpoch: o.restore ? 2 : 1, seat: devSeat(keys, o.restore ? 'C0002' : 'C0001')!, cellPub: cell.pub, wrap,
    durationMs: 30 * 60_000, items, form: 'F1', pseud: devPseud('C0001'), clock, wall: o.wall, restore: o.restore });
}

test('a moved seat continues the chain from the grant: a handover entry first, the restored answers in its palette, one receipt over both', () => {
  const dir = mkdtempSync(join(tmpdir(), 'saakshi-move-'));
  let t = 0;
  const head = 'e'.repeat(64);
  const restore: Restore = { seq: 5, head, activeMs: 50_000, responses: [['I01', 'A', 'B'], ['I02', 'NA', '']], via: 'pin', creditedMs: 108_000 };
  const s = mk(dir, () => t, { restore });
  assert.deepEqual([s.started, s.resumed, s.journal.head, s.journal.base], [true, false, 6, 5]);
  const h = s.journal.headers[0];
  assert.deepEqual([h.seq, h.keyEpoch, h.kind, h.prev, h.activeMs], [6, 2, 'handover', head, 50_000]);
  assert.deepEqual(s.journal.recs[0].body.meta, ['pin', 5, 108_000]);
  assert.deepEqual(s.items(), { I01: { state: 'A', answer: 'B', seq: 5 }, I02: { state: 'NA', answer: '', seq: 5 } });
  assert.equal(s.hashAt(5), head);
  t = 10_000;
  assert.deepEqual(s.act(answer('I03', 'C')), { ok: true, seq: 7, activeMs: 60_000 });
  assert.deepEqual([s.entriesAfter(5, 10).length, s.entriesAfter(6, 10).length, s.entriesAfter(0, 10).length], [2, 1, 2]);
  const r = s.submit();
  if (!r.ok) throw new Error(r.error);
  const rs = responsesOf(items, [{ item: 'I01', state: 'A', answer: 'B', meta: [] }, { item: 'I02', state: 'NA', answer: '', meta: [] }, { item: 'I03', state: 'A', answer: 'C', meta: [1, []] }]);
  assert.deepEqual([r.receipt.seq, r.receipt.finalHash, r.receipt.attempted, r.receipt.answered], [8, finalHash(ctx, 'F1', rs), 3, 2]);
  s.close();
  const again = mk(dir, () => t, { restore });                                        // a restart: no second handover entry, the same receipt
  assert.deepEqual([again.resumed, again.journal.head, again.journal.headers.filter((x) => x.kind === 'handover').length], [true, 8, 1]);
  assert.deepEqual(again.receipt(), r.receipt);
  again.close();
  assert.throws(() => mk(dir, () => t, { restore: { ...restore, head: 'f'.repeat(64) } }), /chain broken/);   // not the head it continued from
  rmSync(dir, { recursive: true, force: true });
});

test('Review Focus #4: suspend freezes activeMs; resume journals a gap with the wall pause; restart journals a restart gap', () => {
  const dir = mkdtempSync(join(tmpdir(), 'saakshi-gap-'));
  let t = 0, w = 1_790_000_000_000;
  const s = mk(dir, () => t, { wall: () => w });
  s.pause('suspend');                                                                 // before the unlock: nothing to pause
  assert.equal(s.paused, false);
  s.start();
  t = 10_000;
  s.pause('suspend');
  t += 125_000; w += 125_000;
  assert.deepEqual([s.paused, s.activeMs()], [true, 10_000]);
  assert.deepEqual(s.act(answer('I01', 'A')), { ok: false, error: 'the exam is paused' });
  assert.equal(s.resume(), 2);
  assert.deepEqual([s.journal.headers[1].kind, s.journal.headers[1].activeMs, s.journal.recs[1].body.meta], ['gap', 10_000, ['suspend', 125_000]]);
  t += 5_000;
  assert.equal(s.activeMs(), 15_000);
  assert.equal(s.resume(), undefined);
  s.close();
  const r = mk(dir, () => t, { wall: () => w });
  assert.equal(r.resumed, true);
  assert.equal(r.restartGap(), 3);
  assert.deepEqual(r.journal.recs[2].body.meta, ['restart', 0]);
  r.submit();
  assert.equal(r.restartGap(), undefined);                                            // never after the submit
  r.close();
  rmSync(dir, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd apps/seat && node --test test/exam-stage4.test.ts`
Expected: FAIL — `restore` is ignored, and `pause is not a function`.

- [ ] **Step 3: `journal-store.ts` — a journal can start after a base**

```ts
import { parseSignedLine, verifyChainKeyed } from '@saakshi/core/journal';

export class SeatJournal {
  // … fields as before, plus:
  #base: { seq: number; head: string };

  constructor(ctx: Ctx, key: Uint8Array, fd: number, size: number, base: { seq: number; head: string }) {
    this.#ctx = ctx; this.#key = key; this.#fd = fd; this.#size = size; this.#base = base;
  }

  /** base: where a moved candidate's chain continues (Addendum C.6); the default is the genesis. */
  static open(dir: string, ctx: Ctx, wrap: Wrapper, verify: Verify, base = { seq: 0, head: genesisPrev(ctx) }): SeatJournal {
    // … unchanged down to the constructor call:
    const j = new SeatJournal(ctx, key, fd, end, base);
    const lines = buf.subarray(0, end).toString('latin1').split('\n');
    lines.pop();
    lines.forEach((l, i) => j.#push(j.#decrypt(l, base.seq + i + 1)));
    const chain = verifyChainKeyed(ctx, j.recs.map((r) => r.line), () => verify, base);
    if (!chain.ok) { closeSync(fd); throw new Error(`journal: chain broken at seq ${base.seq + chain.index + 1} (${chain.fault})`); }
    return j;
  }

  get base(): number { return this.#base.seq; }
  get head(): number { return this.#base.seq + this.recs.length; }
  hashAt(seq: number): string { return seq === this.#base.seq ? this.#base.head : this.#hs[seq - this.#base.seq - 1]; }
  recAt(seq: number): Rec | undefined { return this.recs[seq - this.#base.seq - 1]; }

  append(rec: Rec): void {
    const seq = this.head + 1;
    const p = parseSignedLine(rec.line);
    if (!p.ok || p.header.seq !== seq || p.header.prev !== this.hashAt(seq - 1)) throw new Error(`journal: expected seq ${seq} extending the chain`);
    // … the rest unchanged (the AAD already uses the absolute seq)
  }
```
(`recs`, `headers` and `#hs` stay relative arrays; everything outside uses absolute seqs.)

- [ ] **Step 4: `exam.ts` — the whole file**

```ts
import { randomBytes } from '@saakshi/core/bytes';
import type { Canon } from '@saakshi/core/canon';
import { signedLine } from '@saakshi/core/journal';
import { responsesOf } from '@saakshi/core/log';
import { sealBody, signer, verifier, type KeyPair } from '@saakshi/core/node';
import { counts, finalHash, receiptCode, type Body, type Ctx, type Header, type Kind, type Response, type State } from '@saakshi/core/protocol';
import { toB64, type WireEntry } from '@saakshi/core/wire';
import type { Action, ActResult, ItemState, Receipt, SubmitResult } from '../shared/ipc.ts';
import { SeatJournal, type Wrapper } from './journal-store.ts';
import { TEST_MODE_NOTE } from './keystore.ts';
import type { SyncSource } from './sync.ts';

/** Addendum C.5–C.6: where a moved candidate's chain continues, what the exam server restored, and how the move happened. */
export interface Restore { seq: number; head: string; activeMs: number; responses: Response[]; via: 'pin' | 'key'; creditedMs: number }
export type PauseCause = 'suspend' | 'lock-screen';

export interface SessionOpts {
  dir: string; ctx: Ctx; keyEpoch: number; seat: KeyPair; cellPub: Uint8Array; wrap: Wrapper;
  durationMs: number; items: readonly string[];
  /** The candidate's form (F1/F2) — goes into the submit's meta. */
  form: string;
  /** The candidate's pseudonym (Addendum A.4) — goes into receipt B. */
  pseud: string;
  clock?: () => number;
  /** Wall clock, for how long a pause lasted (Addendum C.9). */
  wall?: () => number;
  /** DEV test keystore in use: journal it at unlock (never silent). */
  testMode?: boolean;
  /** Stage 4: continue a moved candidate's chain (keyEpoch is the new epoch). */
  restore?: Restore;
}

export const IDLE_MS = 60_000;
const OPTIONS = ['A', 'B', 'C', 'D'];
const EMPTY: Body = { item: '', state: '', answer: '', meta: [] };

/** One candidate's exam on this seat: builds, signs and seals entries, keeps the active-time clock, and computes the receipt. */
export class ExamSession implements SyncSource {
  readonly ctx: Ctx;
  readonly journal: SeatJournal;
  /** The journal already held entries when this session opened: the app restarted mid-exam. */
  readonly resumed: boolean;
  #o: SessionOpts;
  #sign: (m: Uint8Array) => Uint8Array;
  #clock: () => number;
  #wall: () => number;
  #activeBase = 0;
  #monoBase = 0;
  #runStart: number;
  #lastEntryAt: number;
  #lastActive = 0;
  #restored: Body[];
  #paused?: { at: number; wall: number; cause: PauseCause };

  constructor(o: SessionOpts) {
    this.#o = o;
    this.ctx = o.ctx;
    this.#clock = o.clock ?? (() => performance.now());
    this.#wall = o.wall ?? Date.now;
    this.#sign = signer(o.seat);
    const r = o.restore;
    this.journal = SeatJournal.open(o.dir, o.ctx, o.wrap, verifier(o.seat.pub), r && { seq: r.seq, head: r.head });
    this.#restored = (r?.responses ?? []).map(([item, state, answer]): Body => ({ item, state, answer, meta: [] }));
    this.resumed = this.journal.recs.length > 0;
    this.#runStart = this.#lastEntryAt = this.#clock();
    const last = this.journal.headers.at(-1);
    // Resume: time between the last entry and the crash is not charged (at most IDLE_MS, thanks to idle entries).
    if (last) { this.#activeBase = this.#lastActive = last.activeMs; this.#monoBase = last.tMonoMs; }
    else if (r) this.#activeBase = this.#lastActive = r.activeMs;
    // Addendum C.6: a new key epoch starts with a handover entry that says how the candidate got here.
    if (r && r.seq > 0 && !this.resumed) this.#append('handover', { ...EMPTY, meta: [r.via, r.seq, r.creditedMs] });
  }

  get started(): boolean { return this.journal.head > 0; }
  get submitted(): boolean { return this.journal.headers.at(-1)?.kind === 'submit'; }
  get paused(): boolean { return !!this.#paused; }
  /** Active time (plan §3.6): monotonic within this key epoch, frozen while the OS has the seat suspended or locked. */
  activeMs(): number {
    if (!this.started) return 0;
    const t = this.#paused ? this.#paused.at : this.#clock();
    return (this.#lastActive = Math.max(this.#lastActive, this.#activeBase + Math.round(t - this.#runStart)));
  }
  remainingMs(): number { return Math.max(0, this.#o.durationMs - this.activeMs()); }

  items(): Record<string, ItemState> {
    const out: Record<string, ItemState> = {}, base = this.journal.base;
    for (const b of this.#restored) out[b.item] = { state: b.state as State, answer: b.answer, seq: base };
    this.journal.recs.forEach((r, i) => { if (r.body.item) out[r.body.item] = { state: r.body.state as State, answer: r.body.answer, seq: base + i + 1 }; });
    return out;
  }

  /** Unlock: meta is [form, kc_f, via] (Addendum B.9). Idempotent. In test mode an integrity entry follows at once. */
  start(meta: Canon[] = []): ActResult {
    if (this.started) return { ok: true, seq: 1, activeMs: this.activeMs() };
    this.#runStart = this.#clock();
    this.#append('unlock', { ...EMPTY, meta });
    // ponytail: a crash between these two appends leaves no integrity entry; the banner and the chain's first entries still show it.
    if (this.#o.testMode) this.#append('integrity', { ...EMPTY, meta: ['test-mode', TEST_MODE_NOTE] });
    return { ok: true, seq: 1, activeMs: 0 };
  }

  act(a: Action): ActResult {
    const error = this.#check(a);
    if (error) return { ok: false, error };
    const seq = this.#append(a.kind, { item: a.item, state: a.state, answer: a.answer, meta: [Math.max(0, Math.round(a.dwellMs)), []] });
    return { ok: true, seq, activeMs: this.activeMs() };
  }

  /** Close the chain (Addendum A.5) over the restored answers and this seat's own. Works offline; idempotent; allowed after time is up. */
  submit(): SubmitResult {
    if (this.submitted) return { ok: true, receipt: this.receipt()! };
    if (!this.started) return { ok: false, error: 'exam not started' };
    const responses = responsesOf(this.#o.items, this.#bodies());
    this.#append('submit', { item: '', state: '', answer: '', meta: [this.#o.form, finalHash(this.ctx, this.#o.form, responses)] });
    return { ok: true, receipt: this.receipt()! };
  }

  /** The receipt, recomputed from the journal (so it survives a restart); undefined until submitted. */
  receipt(): Receipt | undefined {
    if (!this.submitted) return undefined;
    const n = this.journal.head;
    const [form, fh] = this.journal.recAt(n)!.body.meta as [string, string];
    const c = counts(responsesOf(this.#o.items, this.#bodies().slice(0, -1)));
    const h = this.journal.hashAt(n);
    const code = receiptCode({ exam: this.ctx.exam, shift: this.ctx.shift, attempt: this.ctx.attempt, pseud: this.#o.pseud, seq: n, h, finalHash: fh, ...c });
    return { exam: this.ctx.exam, shift: this.ctx.shift, cand: this.ctx.cand, form, code, seq: n, h, finalHash: fh, ...c, total: this.#o.items.length };
  }

  /** The OS suspended the seat or locked the screen: the active clock stops (plan §3.6). */
  pause(cause: PauseCause): void {
    if (!this.started || this.submitted || this.#paused) return;
    this.#paused = { at: this.#clock(), wall: this.#wall(), cause };
  }
  /** Back: the pause is journaled as a gap (Addendum C.9) with the wall time it lasted. Returns the gap's seq. */
  resume(): number | undefined {
    const p = this.#paused;
    if (!p) return undefined;
    this.activeMs();                                              // pin lastActive at the pause
    this.#paused = undefined;
    this.#runStart += this.#clock() - p.at;                       // the pause is not active time
    return this.#append('gap', { ...EMPTY, meta: [p.cause, Math.max(0, Math.round(this.#wall() - p.wall))] });
  }
  /** After an app restart mid-exam: journal the gap (its length is measured by the relay's clock, Addendum C.9). */
  restartGap(): number | undefined {
    if (!this.started || this.submitted || this.#paused) return undefined;
    return this.#append('gap', { ...EMPTY, meta: ['restart', 0] });
  }

  /** Called every few seconds: checkpoints activeMs with an idle entry after 60 s of silence. */
  tick(): void {
    if (this.started && !this.submitted && !this.#paused && this.remainingMs() > 0 && this.#clock() - this.#lastEntryAt >= IDLE_MS) this.#append('idle', EMPTY);
  }

  head(): number { return this.journal.head; }
  hashAt(seq: number): string { return this.journal.hashAt(seq); }
  entriesAfter(after: number, limit: number): WireEntry[] {
    const from = Math.max(0, after - this.journal.base);        // ponytail: a relay that knows less than the base (a spare after a move) cannot be refilled from here
    return this.journal.recs.slice(from, from + limit).map((r) => ({ line: r.line, env: toB64(r.env) }));
  }
  close(): void { this.journal.close(); }

  #bodies(): Body[] { return [...this.#restored, ...this.journal.recs.map((r) => r.body)]; }

  #check(a: Action): string {
    if (this.submitted) return 'exam submitted';
    if (!this.started) return 'exam not started';
    if (this.#paused) return 'the exam is paused';
    if (this.remainingMs() <= 0) return 'time is up';
    if (!this.#o.items.includes(a.item)) return 'unknown item';
    if (!Number.isFinite(a.dwellMs)) return 'bad dwell time';
    const ok = a.kind === 'answer' ? a.state === 'A' && OPTIONS.includes(a.answer)
      : a.kind === 'mark' ? (a.state === 'MR' && a.answer === '') || (a.state === 'AMR' && OPTIONS.includes(a.answer))
      : a.kind === 'clear' ? a.state === 'NA' && a.answer === ''
      : false;
    return ok ? '' : 'action does not match the NTA rules';
  }

  #append(kind: Kind, body: Body): number {
    const seq = this.journal.head + 1;
    const prev = this.journal.hashAt(seq - 1);                   // the genesis at seq 1; the grant's head after a move
    const salt = randomBytes(16);
    const { envelope, bodyCommit } = sealBody(this.#o.cellPub, { ...this.ctx, seq }, salt, body);
    const now = this.#clock();
    const header: Header = { ...this.ctx, keyEpoch: this.#o.keyEpoch, seq, prev, kind, tMonoMs: this.#monoBase + Math.round(now - this.#runStart), activeMs: this.activeMs(), bodyCommit };
    this.journal.append({ line: signedLine(header, this.#sign), env: envelope, salt, body });
    this.#lastEntryAt = now;
    return seq;
  }
}
```

- [ ] **Step 5: Run the new and existing seat tests**

Run: `cd apps/seat && node --test test/exam-stage4.test.ts test/exam.test.ts test/journal-store.test.ts && pnpm --filter @saakshi/seat typecheck`
Expected: PASS (the Stage 1–3 behaviour is unchanged when there is no `restore` and no pause).

---

### Task 13: The seat moves — PIN request, grant check, "moving"/"moved", the relay's status, gaps; Electron wiring

**Files:**
- Modify: `apps/seat/src/main/identity.ts` (the move), `apps/seat/src/main/seat.ts` (phases, restore, status, pause/resume, restart gap), `apps/seat/src/main/sync.ts` (binds for a spare relay, `moved`), `apps/seat/src/main/index.ts` (`powerMonitor`, `exam:handover`)
- Test: `apps/seat/test/move.test.ts`

**Interfaces:**
- Consumes: Task 1 (`HandoverReq`, `HandoverGrant`, `checkGrant`, `sealHandoverPin`, `CentreStatus`, ipc `Credit`, `Phase`, `BindState`), Task 12 (`Restore`, `PauseCause`, `ExamSession.resumed/pause/resume/restartGap`); `makeBindReq`, `pinRecord`, `isPin`.
- Produces:
  - `SeatIdentity`: `.handover(pin): Promise<EnrolResult>`, `.poll(): Promise<BindState>`, `.moveable`, `.moveKey`, `.keyEpoch`, `.restore: Restore | undefined`, `.credit: Credit | undefined`. The saved identity gains `refusedCode` and `move`.
  - `Seat.handover(pin)`, `Seat.pause(cause)`, `Seat.resume()`. `boot()` fills `moveable`, `moveKey`, `credited`, `status`, `paused`, and the phases `moving` and `moved`.
  - `SyncView.moved`.
  - IPC `exam:handover`. `powerMonitor` suspend/lock-screen → pause; resume/unlock-screen → resume.

- [ ] **Step 1: Write the failing tests**

`apps/seat/test/move.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hexToBytes, toHex, utf8 } from '@saakshi/core/bytes';
import { canon } from '@saakshi/core/canon';
import { combineBundle } from '@saakshi/core/custody';
import { cellKey, DEV_EXAM, type KeysFile } from '@saakshi/core/dev';
import type { Directory } from '@saakshi/core/directory';
import { bindArray, checkPin, msg, openPinBox, type Bind } from '@saakshi/core/enrol';
import { grantArray, openHandoverPin, respHash, sealRestore, type Grant, type HandoverGrant, type HandoverReq } from '@saakshi/core/handover';
import { parseSignedLine } from '@saakshi/core/journal';
import { nativeBox, signer } from '@saakshi/core/node';
import { openShareFile, releaseArray, type ReleaseMsg } from '@saakshi/core/paper';
import { signPolicy } from '@saakshi/core/policy';
import { entryHash, type Response } from '@saakshi/core/protocol';
import { toB64, type SyncReq, type SyncRes } from '@saakshi/core/wire';
import { SeatIdentity, type Post } from '../src/main/identity.ts';
import type { Wrapper } from '../src/main/journal-store.ts';
import type { PackageWire } from '../src/main/pkg.ts';
import { Seat } from '../src/main/seat.ts';
import { SeatSync } from '../src/main/sync.ts';
import { buildPackage } from '../../../tools/package.ts';

const keys = JSON.parse(readFileSync(new URL('../../../fixtures/keys.json', import.meta.url), 'utf8')) as KeysFile;
const fx = (f: string) => JSON.parse(readFileSync(new URL(`../../../fixtures/paper/${f}`, import.meta.url), 'utf8'));
const authority = { priv: hexToBytes(keys.authority.priv), pub: hexToBytes(keys.authority.pub) };
const cell = cellKey(keys, 'cell-1');
const wrap: Wrapper = { encryptString: (s) => Buffer.from(s).reverse(), decryptString: (b) => Buffer.from(b).reverse().toString() };
const ctx = { ...DEV_EXAM, cand: 'C0001' }, gate = { operatorId: 'GATE-42-OP7', method: 'aadhaar-face' as const };
const PIN = '482913', FROM = 6, HEAD = 'e'.repeat(64);
const R: Response[] = [['I01', 'A', 'B'], ['I02', 'NA', '']];
const until = async (ok: () => boolean) => { for (let i = 0; i < 500 && !ok(); i++) await new Promise((r) => setTimeout(r, 10)); assert.equal(ok(), true); };
const refusedEnrol = { status: 409, body: { error: 'C0001 is already bound to another seat — call the invigilator', code: 'ALREADY_BOUND' } };

/** The exam server's side, through the relay: check the PIN, then sign keyEpoch 2 and the grant, and seal the answers to the new key. */
function grantFor(req: HandoverReq, o: { swap?: boolean } = {}): HandoverGrant | { error: string; code: string } {
  if (openHandoverPin(cell.priv, req, req.seatId, req.pub, (req.proof as { pin: string }).pin, nativeBox) !== PIN) return { error: 'wrong PIN — 2 tries left', code: 'PIN_WRONG' };
  assert.equal(checkPin(openPinBox(cell.priv, req, nativeBox), PIN), true);                // the new record carries the same PIN
  const b: Bind = { ...ctx, seatId: req.seatId, pub: req.pub, keyEpoch: 2, fromSeq: FROM, attestHash: req.attestHash };
  const cert = canon(bindArray(b)), sign = signer(cell);
  const grant: Grant = { ...ctx, keyEpoch: 2, fromSeq: FROM, fromHead: HEAD, activeMs: 60_000, creditedMs: 108_000, respHash: respHash(R) };
  return { bind: { cert, sig: toHex(sign(utf8(cert))), cell: 'cell-1', pinBox: req.pinBox }, grant, sig: toHex(sign(msg(grantArray(grant)))),
    restore: sealRestore(hexToBytes(req.pub), ctx, 2, FROM, o.swap ? [['I01', 'A', 'D']] : R, nativeBox), via: 'pin', approvedBy: 'INV-42-A' };
}

test('identity: refused as bound elsewhere → move by PIN; pending; a wrong PIN can be retyped; then a grant the seat checks', async () => {
  let approved = false;
  const seen: HandoverReq[] = [];
  const post: Post = async (path, body) => {
    if (path === '/v1/enrol') return refusedEnrol;
    seen.push(body as HandoverReq);
    if (!approved) return { status: 202, body: { state: 'pending' } };
    const g = grantFor(body as HandoverReq);
    return 'error' in g ? { status: 409, body: { state: 'refused', ...g } } : { status: 200, body: { state: 'granted', grant: g } };
  };
  const path = join(mkdtempSync(join(tmpdir(), 'saakshi-id-')), 'id');
  const open = () => SeatIdentity.open({ path, ctx, seatId: 'CEN042-S02', wrap, cell: { id: 'cell-1', pub: cell.pub }, post });
  const id = open();
  await id.enrol(PIN, gate);
  assert.deepEqual([id.state, id.moveable], ['refused', true]);
  assert.deepEqual(await id.handover('12345'), { ok: false, error: 'The PIN must be exactly 6 digits.' });
  assert.deepEqual(await id.handover('999999'), { ok: true, bind: 'moving' });
  assert.equal(id.moveKey, seen[0].pub.slice(2, 18));
  approved = true;
  assert.equal(await id.poll(), 'refused');
  assert.match(id.error, /wrong PIN/);
  assert.equal(id.moveable, true);
  assert.deepEqual(await id.handover(PIN), { ok: true, bind: 'bound' });
  assert.equal(seen.at(-1)!.proof.via, 'pin');
  assert.equal(id.keyEpoch, 2);
  assert.deepEqual(id.restore, { seq: FROM, head: HEAD, activeMs: 60_000, responses: R, via: 'pin', creditedMs: 108_000 });
  assert.deepEqual(id.credit, { ms: 108_000, via: 'pin', approvedBy: 'INV-42-A', fromSeq: FROM });
  assert.deepEqual([open().state, open().keyEpoch], ['bound', 2]);                     // survives a restart
});

test('identity: a relay that swaps the restored answers is caught, and the seat keeps waiting', async () => {
  const post: Post = async (path, body) => path === '/v1/enrol' ? refusedEnrol : { status: 200, body: { state: 'granted', grant: grantFor(body as HandoverReq, { swap: true }) } };
  const id = SeatIdentity.open({ path: join(mkdtempSync(join(tmpdir(), 'saakshi-id-')), 'id'), ctx, seatId: 'CEN042-S02', wrap, cell: { id: 'cell-1', pub: cell.pub }, post });
  await id.enrol(PIN, gate);
  await id.handover(PIN);
  assert.equal(id.state, 'moving');
  assert.match(id.error, /do not match the signed hash/);
});

test('sync: a spare relay that reports head 0 gets the binding again; a relay that disagrees gets our last entry as a probe; ORPHANED marks this seat as moved', async () => {
  const src = { ctx, head: () => 3, hashAt: (s: number) => `h${s}`, entriesAfter: (a: number) => [{ line: `l${a + 1}`, env: 'AAAA' }] };
  const reqs: SyncReq[] = [];
  let rejected: SyncRes['rejected'] = [];
  const send = async (req: SyncReq): Promise<SyncRes> => { reqs.push(req); return { streams: [{ ...ctx, head: 0, headH: '', need: false }], rejected }; };
  const s = new SeatSync(src, send, () => false, () => {}, { bind: () => ({ cert: 'c', sig: 's'.repeat(128), cell: 'cell-1', pinBox: 'ab' }) });
  await s.round(); await s.round();
  assert.deepEqual(reqs.map((r) => r.binds?.length ?? 0), [1, 1]);
  assert.equal(s.view().moved, undefined);
  rejected = [{ index: 0, code: 'ORPHANED', reason: 'keyEpoch 1 was replaced at seq 2' }];
  await s.round();
  assert.equal(s.view().moved, true);
  // A seat that restarts after its candidate moved (cursor −1) meets a relay ahead on the new key's chain: it probes with its last entry.
  const reqs2: SyncReq[] = [];
  let rejected2: SyncRes['rejected'] = [];
  const s2 = new SeatSync(src, async (req) => { reqs2.push(req); return { streams: [{ ...ctx, head: 5, headH: 'x'.repeat(64), need: false }], rejected: rejected2 }; }, () => false);
  await s2.round();
  rejected2 = [{ index: 0, code: 'ORPHANED', reason: 'keyEpoch 1 was replaced at seq 2' }];
  await s2.round();
  assert.deepEqual(reqs2.map((r) => r.entries.map((e) => e.line)), [[], ['l3']]);
  assert.equal(s2.view().moved, true);
});

test('the seat, moved: refused → move → moving (with its key) → approved → the exam restored from the grant; banner status; pause; Review Focus #2: ORPHANED → moved', async () => {
  const dir = { v: 1, exam: 'DEMO-2026', shift: 'S1', durationMs: 1, demoCentre: 'CEN042', issuedAt: 0, cells: [], cands: {}, centres: { CEN042: { cell: 'cell-1' } } } as unknown as Directory;
  const p = await buildPackage(dir, { bank: fx('bank.json'), forms: fx('forms.json') }, authority);
  const K = await combineBundle([openShareFile(p.shares.NTA, p.passphrases.NTA), openShareFile(p.shares.OBS, p.passphrases.OBS)]);
  const policy = signPolicy({ v: 1, exam: 'DEMO-2026', shift: 'S1', centre: 'CEN042', cell: { id: 'cell-1', keyId: 'k', pub: keys.cells[0].pub }, durationMs: 1_800_000,
    roster: { C0001: { form: 'F1', extraMs: 0, pseud: '7'.repeat(64) } }, issuedAt: 0 }, signer(authority));
  const w: PackageWire = { policy, manifest: p.manifest, paper: { F1: toB64(p.papers.F1), F2: toB64(p.papers.F2) } };
  const r0 = { exam: 'DEMO-2026', shift: 'S1', form: 'F1', kcf: p.manifest.manifest.forms[0].kcf, ts: 5 };
  const release: ReleaseMsg = { ...r0, key: toHex(K.kF1), sig: toHex(signer(authority)(msg(releaseArray(r0)))), via: 'push' };
  let approved = false, orphan = false;
  const hs: string[] = [], syncs: SyncReq[] = [];
  const fetch = (async (url: URL, init?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    if (path === '/v1/package') return Response.json(w);
    if (path === '/v1/enrol') return Response.json(refusedEnrol.body, { status: 409 });
    if (path === '/v1/handover') return approved ? Response.json({ state: 'granted', grant: grantFor(JSON.parse(String(init!.body))) }) : Response.json({ state: 'pending' }, { status: 202 });
    if (path === '/release/current') return Response.json({ releases: [release] });
    if (path === '/v1/release/events') return new Response(new ReadableStream<Uint8Array>({ start(c) { c.enqueue(utf8(`id: b-1\nevent: snapshot\ndata: ${JSON.stringify({ releases: [release] })}\n\n`)); } }), { headers: { 'content-type': 'text/event-stream' } });
    if (path === '/v1/status') return Response.json({ link: 'down', cell: 'LIVE', at: 1 });
    if (path === '/v1/sync') {
      const req = JSON.parse(String(init!.body)) as SyncReq;
      syncs.push(req);
      for (const e of req.entries) { const q = parseSignedLine(e.line); if (!orphan && q.ok && q.header.seq === FROM + hs.length + 1) hs.push(toHex(entryHash(q.header))); }
      const rejected = orphan ? req.entries.map((_, index) => ({ index, code: 'ORPHANED', reason: 'the candidate moved' })) : [];
      return Response.json({ streams: [{ ...req.streams[0], head: FROM + hs.length, headH: hs.at(-1) ?? HEAD, need: false }], rejected });
    }
    return new Response('not found', { status: 404 });
  }) as unknown as typeof globalThis.fetch;
  const seat = new Seat({ dir: mkdtempSync(join(tmpdir(), 'saakshi-seatB-')), relayUrl: 'http://relay:7070', ctx, seatId: 'CEN042-S02', authorityPub: authority.pub, wrap, camera: false, testMode: false, fetch, retryMs: 20 });
  await seat.open();
  await until(() => seat.boot().phase === 'enrol');
  await seat.enrol({ pin: PIN, ...gate });
  await until(() => seat.paper() !== null);                                                // the paper is released, but no exam: this seat is not bound
  assert.deepEqual([seat.boot().phase, seat.boot().moveable, seat.exam], ['enrol', true, undefined]);
  assert.deepEqual(await seat.handover(PIN), { ok: true, bind: 'moving' });
  assert.deepEqual([seat.boot().phase, /^[0-9a-f]{16}$/.test(seat.boot().moveKey ?? '')], ['moving', true]);
  approved = true;
  await until(() => seat.boot().phase === 'exam');
  const b = seat.boot();
  assert.deepEqual(b.items.I01, { state: 'A', answer: 'B', seq: FROM });
  assert.deepEqual(b.credited, { ms: 108_000, via: 'pin', approvedBy: 'INV-42-A', fromSeq: FROM });
  assert.ok(b.activeMs >= 60_000);
  const first = seat.exam!.journal.headers[0];
  assert.deepEqual([first.seq, first.kind, first.keyEpoch, first.prev], [FROM + 1, 'handover', 2, HEAD]);
  await until(() => seat.boot().status?.link === 'down');
  await until(() => hs.length >= 1);                                                       // the relay took the handover entry from seq 7
  seat.pause('suspend');
  assert.equal(seat.boot().paused, true);
  seat.resume();
  assert.equal(seat.exam!.journal.headers.at(-1)!.kind, 'gap');
  orphan = true;
  seat.act({ kind: 'answer', item: 'I03', state: 'A', answer: 'C', dwellMs: 1 });
  await until(() => seat.boot().phase === 'moved');
  assert.deepEqual(seat.act({ kind: 'answer', item: 'I04', state: 'A', answer: 'D', dwellMs: 1 }), { ok: false, error: 'This candidate has moved to another seat. Please call the invigilator.' });
  seat.close();
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd apps/seat && node --test test/move.test.ts`
Expected: FAIL — `id.handover is not a function`.

- [ ] **Step 3: `identity.ts` — the move**

```ts
import { checkGrant, sealHandoverPin, type HandoverGrant, type HandoverReq } from '@saakshi/core/handover';
import type { Response } from '@saakshi/core/protocol';
import type { BindState, Credit, EnrolResult } from '../shared/ipc.ts';
import type { Restore } from './exam.ts';

interface Move { req: HandoverReq; grant?: HandoverGrant; responses?: Response[]; refused?: string }
interface Saved { priv: string; pub: string; req: BindReq; bind?: WireBind; refused?: string; refusedCode?: string; move?: Move }

  get state(): BindState {
    const s = this.#s;
    return !s ? 'none' : s.bind ? 'bound' : s.move && !s.move.refused ? 'moving' : s.refused || s.move?.refused ? 'refused' : 'provisional';
  }
  /** Refused because the candidate is bound to another seat: this seat may ask to take over (plan §3.2). */
  get moveable(): boolean { const s = this.#s; return !!s && !s.bind && (s.refusedCode === 'ALREADY_BOUND' || !!s.move); }
  /** 16 hex of this seat's key: the invigilator compares it with the console before approving. */
  get moveKey(): string { return this.#s?.pub.slice(2, 18) ?? ''; }
  get keyEpoch(): number { return this.#s?.move?.grant?.grant.keyEpoch ?? 1; }
  get restore(): Restore | undefined {
    const m = this.#s?.move, g = m?.grant;
    return g && m.responses && { seq: g.grant.fromSeq, head: g.grant.fromHead, activeMs: g.grant.activeMs, responses: m.responses, via: g.via, creditedMs: g.grant.creditedMs };
  }
  get credit(): Credit | undefined {
    const g = this.#s?.move?.grant;
    return g && { ms: g.grant.creditedMs, via: g.via, approvedBy: g.approvedBy, fromSeq: g.grant.fromSeq };
  }

  /** Ask to continue here (Addendum C.3): the PIN sealed to the cell, a fresh PIN record for this seat, this seat's key. */
  async handover(pin: string): Promise<EnrolResult> {
    const s = this.#s;
    if (!s || s.bind || !this.moveable) return { ok: false, error: 'Check in first; a move is only for a candidate bound to another seat.' };
    if (!isPin(pin)) return { ok: false, error: 'The PIN must be exactly 6 digits.' };
    const c = this.#o.ctx, seatId = this.#o.seatId, cellPub = this.#o.cell.pub;
    const b = { ...c, seatId, pub: s.pub, keyEpoch: 1, fromSeq: 0, attestHash: s.req.attestHash };
    const req: HandoverReq = { ...c, seatId, pub: s.pub, attestHash: s.req.attestHash, pinBox: makeBindReq(b, cellPub, pinRecord(pin), nativeBox).pinBox,
      proof: { via: 'pin', pin: sealHandoverPin(cellPub, c, seatId, s.pub, pin, nativeBox) } };
    this.#save({ ...s, move: { req } });
    return { ok: true, bind: await this.poll() };
  }

  /** Send (or resend) the move: 200 granted (checked here), 202 waiting for the invigilator, 409/400 refused. */
  async poll(): Promise<BindState> {
    const s = this.#s, m = s?.move;
    if (!s || !m || m.grant || m.refused) return this.state;
    let r;
    try { r = await this.#o.post('/v1/handover', m.req); }
    catch (e) { this.error = `the centre server did not answer: ${(e as Error).message}`; return this.state; }
    if (r.status === 200) {
      const g = r.body.grant as HandoverGrant;
      try {
        if (g?.bind?.cell !== this.#o.cell.id) throw new Error(`signed by ${g?.bind?.cell}, not ${this.#o.cell.id}`);
        const c = checkGrant(g, { ...this.#o.ctx, seatId: this.#o.seatId, pub: s.pub }, this.#o.cell.pub, hexToBytes(s.priv), verifier, nativeBox);
        this.error = '';
        this.#save({ ...s, bind: g.bind, refused: undefined, move: { ...m, grant: g, responses: c.responses } });
      } catch (e) { this.error = `the move was rejected: ${(e as Error).message}`; }
    } else if (r.status === 202) this.error = String(r.body.error ?? 'waiting for the invigilator to approve the move');
    else { this.error = String(r.body.error ?? `refused (${r.status})`); this.#save({ ...s, move: { ...m, refused: this.error } }); }
    return this.state;
  }

// retry(): in the 409/400 branch also keep the code:
      this.#save({ ...s, refused: this.error, refusedCode: String(r.body.code ?? '') });
```

- [ ] **Step 4: `sync.ts` — the binding for a spare relay; a probe when the relay disagrees; ORPHANED means "moved"**

```ts
  #moved = false;
  #probe = false;
  view(): SyncView {
    const v: SyncView = { local: this.#src.head(), relay: this.#relay, cell: this.#cell, online: this.#online, error: this.#error, ...(this.#moved ? { moved: true } : {}) };
    return this.#bind ? { ...v, provisional: !this.#bind() } : v;
  }
  // round(): with no agreed cursor yet, a seat whose chain the relay disagrees with sends its own last entry as a probe, so the relay
  // can say why (after a move: ORPHANED). The binding travels on first contact AND whenever the relay knows nothing of this seat (a spare):
    const entries = this.#cursor >= 0 ? s.entriesAfter(this.#cursor, BATCH) : this.#probe && s.head() > 0 ? s.entriesAfter(s.head() - 1, 1) : [];
    if (bind && this.#cursor <= 0) req.binds = [bind];
  // …after `this.#error = …`:
    if (res.rejected.some((r) => r.code === 'ORPHANED')) this.#moved = true;
  // …and where the stream status is read:
      if (st.headH === mine) { this.#cursor = st.head; this.#relay = Math.max(this.#relay, st.head); this.#probe = false; }
      else { this.#error ||= `relay disagrees with this seat at seq ${st.head}`; this.#probe = true; }
```

- [ ] **Step 5: `seat.ts` — phases, restore, status, gaps**

```ts
import type { CentreStatus } from '@saakshi/core/ops';
import type { PauseCause } from './exam.ts';

  #status?: CentreStatus;

  boot(): ExamBoot {
    // … as before, plus:
      moveable: this.#id?.moveable ?? false, moveKey: this.#id?.state === 'moving' ? this.#id.moveKey : undefined,
      credited: this.#id?.credit, status: this.#status, paused: this.#exam?.paused ?? false,
  }

  async handover(pin: string): Promise<EnrolResult> {
    if (!this.#id) return { ok: false, error: 'Waiting for the centre server.' };
    const r = await this.#id.handover(pin);
    this.#openExam();
    this.#emit();
    return r;
  }
  pause(cause: PauseCause): void { this.#exam?.pause(cause); this.#emit(); }
  resume(): void { if (this.#exam?.resume() !== undefined) this.#sync?.kick(); this.#emit(); }

  act(a: Action): ActResult {
    if (this.#sync?.view().moved) return { ok: false, error: 'This candidate has moved to another seat. Please call the invigilator.' };
    // … as before
  }

  #phase(): Phase {
    if (!this.#pkg) return 'connecting';
    if (this.#id?.state === 'moving') return 'moving';
    if (!this.#id?.key || (this.#id.state === 'refused' && this.#id.moveable)) return 'enrol';
    if (this.#sync?.view().moved) return 'moved';
    if (!this.#exam) return 'locked';
    if (this.#exam.submitted) return 'submitted';
    return this.#exam.started ? 'exam' : 'ready';
  }

  async #tick(): Promise<void> {
    if (this.#closed || this.#busy) return;
    this.#busy = true;
    try {
      if (!this.#pkg) await this.#tryPackage();
      else if (this.#id?.state === 'provisional') { await this.#id.retry(); if (this.#id.state !== 'provisional') this.#emit(); }
      else if (this.#id?.state === 'moving') { await this.#id.poll(); if (this.#id.state !== 'moving') { this.#openExam(); this.#emit(); } }
      if (this.#pkg) await this.#pollStatus();
      this.#exam?.tick();
    } finally { this.#busy = false; }
  }

  /** The relay's view of its link and the exam server: the in-exam banner (plan §3.10). */
  async #pollStatus(): Promise<void> {
    try {
      const r = await (this.#o.fetch ?? fetch)(new URL('/v1/status', this.#o.relayUrl), { signal: AbortSignal.timeout(2_000) });
      if (!r.ok) return;
      const s = (await r.json()) as CentreStatus;
      if (JSON.stringify(s.link + s.cell + (s.etaMs ?? '')) !== JSON.stringify((this.#status?.link ?? '') + (this.#status?.cell ?? '') + (this.#status?.etaMs ?? ''))) { this.#status = s; this.#emit(); }
      else this.#status = s;
    } catch { /* keep the last status */ }
  }

  #openExam(): void {
    const id = this.#id;
    if (this.#exam || !this.#pkg || !this.#paper || !id?.key) return;
    if (id.state !== 'bound' && id.state !== 'provisional') return;       // a refused or moving seat must not start a chain of its own
    const p = this.#pkg.policy, me = p.roster[this.#o.ctx.cand], cellPub = hexToBytes(p.cell.pub);
    try {
      this.#exam = new ExamSession({ dir: this.#o.dir, ctx: this.#o.ctx, keyEpoch: id.keyEpoch, seat: id.key!, cellPub, wrap: this.#o.wrap, restore: id.restore,
        durationMs: p.durationMs + me.extraMs, items: this.#paper.items.map((i) => i.id), form: me.form, pseud: me.pseud, clock: this.#o.clock, wall: this.#o.now, testMode: this.#o.testMode });
    } catch (e) { this.#notice = `Journal problem — please call the invigilator: ${(e as Error).message}`; return; }
    if (this.#exam.resumed) this.#exam.restartGap();                     // the app restarted mid-exam: journal the gap (plan §2)
    this.#sync = new SeatSync(this.#exam, httpSend(this.#o.relayUrl, 5000, this.#o.fetch), verifier(cellPub), (v) => this.#o.onSync?.(v), { bind: () => id.bind });
    this.#sync.start(1000);
  }
```
(`#unlock` still calls `#openExam()` when the key arrives; for a moving seat that returns early, and `#tick` opens the exam once the grant arrives. The paper is decrypted either way, which is harmless: it is already released.)

- [ ] **Step 6: `index.ts` — Electron**

```ts
import { app, BrowserWindow, dialog, ipcMain, powerMonitor, protocol, safeStorage, session, systemPreferences } from 'electron';
  ipcMain.handle('exam:handover', (_e, pin: string) => seat!.handover(String(pin)));
  // inside app.whenReady(), after `await seat.open();`:
    // plan §3.6: suspend and screen lock pause the timer and become gap entries on resume.
    powerMonitor.on('suspend', () => seat?.pause('suspend'));
    powerMonitor.on('lock-screen', () => seat?.pause('lock-screen'));
    powerMonitor.on('resume', () => seat?.resume());
    powerMonitor.on('unlock-screen', () => seat?.resume());
```

- [ ] **Step 7: Run the new and existing seat tests**

Run: `cd apps/seat && node --test test/move.test.ts test/seat.test.ts test/identity.test.ts test/sync.test.ts test/exam.test.ts && pnpm --filter @saakshi/seat typecheck`
Expected: PASS. If a Stage 3 seat test counts journal entries after a restart, add the expected `restart` gap entry to its expectation (that entry is the Stage 4 behaviour); do not remove the gap.

---

### Task 14: The seat's screens — move here, waiting for approval, moved; the in-exam banner; the credited time

**Files:**
- Modify: `apps/seat/src/renderer/src/Gate.tsx`, `apps/seat/src/renderer/src/App.tsx`, `apps/seat/src/renderer/src/exam-state.ts`, `apps/seat/src/renderer/src/i18n.ts`, `apps/seat/src/renderer/src/styles.css`
- Test: add to `apps/seat/test/exam-state.test.ts`

**Interfaces:**
- Consumes: Task 1 (`ExamBoot.moveable/moveKey/credited/status/paused`, `Phase` `moving`/`moved`, `SeatApi.handover`, `CentreStatus`, `SyncView`).
- Produces:
  - `exam-state.ts`: `type BannerKind = 'cell' | 'link' | 'slow' | 'paused'`, `bannerOf(status: CentreStatus | undefined, sync: SyncView, paused: boolean): { kind: BannerKind; etaMs?: number } | null`, `mmss(ms)`.
  - Components `Move` (inside `Enrol`), `Moving`, `Moved`, `Banner`, `Credit`.
  - i18n keys (EN and HI): `banner`, `eta`, `preserved`, `moveTitle`, `moveNote`, `moveButton`, `movingTitle`, `movingNote`, `yourKey`, `movedTitle`, `movedNote`, `credited`, `awaitingApproval`.

- [ ] **Step 1: Write the failing tests** (append to `exam-state.test.ts`)

```ts
import { bannerOf, mmss } from '../src/renderer/src/exam-state.ts';

test('the in-exam banner: paused beats everything; a rebuilding server carries its ETA; a down link or an offline seat; a slow link; else none', () => {
  const sync = { local: 46, relay: 46, cell: 31, online: true, error: '' };
  assert.deepEqual(bannerOf(undefined, sync, true), { kind: 'paused' });
  assert.deepEqual(bannerOf({ link: 'up', cell: 'REBUILDING', etaMs: 90_000, at: 0 }, sync, false), { kind: 'cell', etaMs: 90_000 });
  assert.deepEqual(bannerOf({ link: 'down', cell: 'unreachable', at: 0 }, sync, false), { kind: 'link' });
  assert.deepEqual(bannerOf({ link: 'up', cell: 'LIVE', at: 0 }, { ...sync, online: false }, false), { kind: 'link' });
  assert.deepEqual(bannerOf({ link: 'degraded', cell: 'LIVE', at: 0 }, sync, false), { kind: 'slow' });
  assert.equal(bannerOf({ link: 'up', cell: 'LIVE', at: 0 }, sync, false), null);
  assert.equal(mmss(108_000), '1:48');
});

test('the Stage 4 strings exist in EN and HI and read the tick counts', () => {
  for (const l of ['en', 'hi'] as const) {
    assert.match(T[l].preserved(46, 46, 31), /46.*46.*31/);
    assert.match(T[l].credited('1:48', 'INV-42-A'), /1:48.*INV-42-A/);
    assert.ok(T[l].banner.cell && T[l].banner.link && T[l].banner.slow && T[l].banner.paused && T[l].moveTitle && T[l].movedTitle);
  }
  assert.match(T.hi.movingTitle, /[ऀ-ॿ]/);
});
```
(`T` is already imported in this test file; the existing test that EN and HI have the same keys covers the new keys too.)

- [ ] **Step 2: Run to verify they fail**

Run: `cd apps/seat && node --test test/exam-state.test.ts`
Expected: FAIL — `bannerOf` is not exported.

- [ ] **Step 3: `exam-state.ts` additions**

```ts
import type { CentreStatus } from '@saakshi/core/ops';

export type BannerKind = 'cell' | 'link' | 'slow' | 'paused';
/** The in-exam banner (plan §3.10): the cause, an ETA when the relay can estimate one. The tick counts come from the sync view. */
export function bannerOf(status: CentreStatus | undefined, sync: SyncView, paused: boolean): { kind: BannerKind; etaMs?: number } | null {
  if (paused) return { kind: 'paused' };
  if (status?.cell === 'REBUILDING') return status.etaMs !== undefined ? { kind: 'cell', etaMs: status.etaMs } : { kind: 'cell' };
  if (status?.link === 'down' || !sync.online) return { kind: 'link' };
  if (status?.link === 'degraded') return { kind: 'slow' };
  return null;
}
export const mmss = (ms: number): string => `${Math.floor(ms / 60_000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
```

- [ ] **Step 4: `i18n.ts` — the new strings (add them to `Strings`, then EN and HI)**

```ts
  banner: Record<BannerKind, string>; eta: (t: string) => string; preserved: (local: number, relay: number, cell: number) => string;
  moveTitle: string; moveNote: string; moveButton: string; movingTitle: string; movingNote: string; yourKey: string;
  movedTitle: string; movedNote: string; credited: (t: string, by: string) => string; awaitingApproval: (t: string) => string;
```
EN:
```ts
    banner: {
      cell: 'The exam server is being restored from the centre\'s copy.',
      link: 'The centre\'s link to the exam server is down.',
      slow: 'The centre\'s link to the exam server is slow.',
      paused: 'This computer was asleep or locked, so your timer was paused.',
    },
    eta: (t) => `Expected back in about ${t}.`,
    preserved: (l, r, c) => `Your time and answers are preserved: ${l} saved on this computer · ${r} at the centre · ${c} at the exam server.`,
    moveTitle: 'Continue on this computer',
    moveNote: 'You are checked in on another computer. If it failed, type your PIN. The invigilator approves the move, and your answers and time come back here.',
    moveButton: 'Ask to continue here',
    movingTitle: 'Waiting for the invigilator',
    movingNote: 'The invigilator is checking your admit card and will approve the move at the centre console.',
    yourKey: 'This computer\'s key (the invigilator compares it)',
    movedTitle: 'You have moved to another computer',
    movedNote: 'Your exam continues on the other computer. Nothing typed here counts. Please call the invigilator.',
    credited: (t, by) => `+${t} credited · approved by ${by}`,
    awaitingApproval: (t) => `+${t} credited · awaiting approval`,
```
HI:
```ts
    banner: {
      cell: 'परीक्षा सर्वर को केंद्र की प्रति से बहाल किया जा रहा है।',
      link: 'केंद्र का परीक्षा सर्वर से संपर्क टूट गया है।',
      slow: 'केंद्र का परीक्षा सर्वर से संपर्क धीमा है।',
      paused: 'यह कंप्यूटर सो गया था या लॉक था, इसलिए आपका समय रुका रहा।',
    },
    eta: (t) => `लगभग ${t} में वापस आने की उम्मीद है।`,
    preserved: (l, r, c) => `आपका समय और उत्तर सुरक्षित हैं: इस कंप्यूटर पर ${l} · केंद्र पर ${r} · परीक्षा सर्वर पर ${c} सहेजे गए।`,
    moveTitle: 'इस कंप्यूटर पर जारी रखें',
    moveNote: 'आपका चेक-इन किसी दूसरे कंप्यूटर पर है। यदि वह खराब हो गया है, तो अपना PIN टाइप करें। निरीक्षक स्थानांतरण स्वीकृत करेंगे, और आपके उत्तर व समय यहाँ वापस आ जाएँगे।',
    moveButton: 'यहाँ जारी रखने का अनुरोध करें',
    movingTitle: 'निरीक्षक की प्रतीक्षा',
    movingNote: 'निरीक्षक आपका प्रवेश पत्र जाँच रहे हैं और केंद्र कंसोल पर स्थानांतरण स्वीकृत करेंगे।',
    yourKey: 'इस कंप्यूटर की कुंजी (निरीक्षक इसका मिलान करेंगे)',
    movedTitle: 'आप दूसरे कंप्यूटर पर चले गए हैं',
    movedNote: 'आपकी परीक्षा दूसरे कंप्यूटर पर जारी है। यहाँ टाइप किया गया कुछ भी नहीं गिना जाएगा। कृपया निरीक्षक को बुलाएँ।',
    credited: (t, by) => `+${t} जोड़ा गया · ${by} द्वारा स्वीकृत`,
    awaitingApproval: (t) => `+${t} जोड़ा गया · स्वीकृति की प्रतीक्षा`,
```

- [ ] **Step 5: The components**

`Gate.tsx` — the move panel inside `Enrol`, and the two new screens:
```tsx
function Move({ t }: { t: Strings }) {
  const [pin, setPin] = useState(''), [problem, setProblem] = useState(''), [busy, setBusy] = useState(false);
  async function submit(ev: FormEvent) {
    ev.preventDefault();
    if (!/^[0-9]{6}$/.test(pin)) { setProblem(t.problems.pinDigits); return; }
    setBusy(true);
    const r = await window.saakshi.handover(pin);
    setBusy(false); setPin('');
    setProblem(r.ok ? '' : r.error);
  }
  return (
    <section className="move" aria-labelledby="move-h">
      <h2 id="move-h">{t.moveTitle}</h2>
      <p>{t.moveNote}</p>
      <form className="gate" onSubmit={submit} noValidate>
        <label>{t.pin}<input type="password" inputMode="numeric" autoComplete="off" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value)} aria-describedby="move-problem" required /></label>
        <button className="primary" disabled={busy}>{t.moveButton}</button>
      </form>
      <p id="move-problem" role="alert" className="problem">{problem}</p>
    </section>
  );
}
// In Enrol, after the check-in form: {boot.moveable && <Move t={t} />}
// (When boot.moveable is true the check-in form is still shown above it, disabled: `<fieldset disabled={boot.moveable}>` around its fields.)

export function Moving({ boot, t, lang, setLang }: P) {
  return (
    <main className="start" aria-labelledby="moving-h">
      <h1 id="moving-h">{t.movingTitle}</h1>
      <p>{t.candidate}: {boot.cand} · {boot.seatId}</p>
      <LangToggle lang={lang} setLang={setLang} t={t} />
      <p>{t.movingNote}</p>
      <p className="commit"><span>{t.yourKey}: </span>{shortHex(boot.moveKey)}</p>
      <p role="status" className="notice">{boot.notice}</p>
    </main>
  );
}

export function Moved({ boot, t }: P) {
  return (
    <main className="start" aria-labelledby="moved-h">
      <h1 id="moved-h">{t.movedTitle}</h1>
      <p>{t.candidate}: {boot.cand} · {boot.seatId}</p>
      <p role="alert">{t.movedNote}</p>
    </main>
  );
}
```
`shortHex` (already in `enrol-state.ts`) groups the 16 hex as `1a2b 3c4d 5e6f 7a8b`, the same way the console shows it.

`App.tsx` — the routing, and inside `Exam` the banner and the credit:
```tsx
import { Connecting, Enrol, LangToggle, Locked, Moved, Moving, TestBanner } from './Gate.tsx';
import { bannerOf, mmss } from './exam-state.ts';
  // phase routing, before `locked`:
  else if (boot.phase === 'moving') body = <Moving boot={boot} {...g} />;
  else if (boot.phase === 'moved') body = <Moved boot={boot} {...g} />;

function Banner({ boot, sync, t }: { boot: ExamBoot; sync: SyncView; t: Strings }) {
  const b = bannerOf(boot.status, sync, boot.paused ?? false);
  if (!b) return null;
  return (
    <div className={`banner ${b.kind}`} role="status" aria-live="polite">
      <strong>{t.banner[b.kind]}</strong>{b.etaMs !== undefined && <> {t.eta(mmss(b.etaMs))}</>} {t.preserved(sync.local, sync.relay, sync.cell)}
    </div>
  );
}
function Credit({ c, t }: { c: Credit; t: Strings }) {
  return <span className="badge credit">{c.approvedBy ? t.credited(mmss(c.ms), c.approvedBy) : t.awaitingApproval(mmss(c.ms))}</span>;
}
// In Exam: render <Banner boot={boot} sync={sync} t={t} /> directly under the header bar,
// and {boot.credited && <Credit c={boot.credited} t={t} />} inside the header, after the timer.
```
`Exam` keeps its own `sync` state (from `onSync`), so the counts in the banner are live; `boot` updates through `onBoot` (App's state) when the relay's status changes.

`styles.css` (reuse the existing scale variables; no new sizes):
```css
.banner { padding: .5rem 1rem; border-bottom: 2px solid; }
.banner.cell, .banner.link { color: #7a4100; background: #fef7e0; border-color: #b06000; }
.banner.slow, .banner.paused { color: #0b3d91; background: #e8f0fe; border-color: #1565c0; }
.badge.credit { color: #0d5222; background: #e6f4ea; }
.move { margin-top: 1.5rem; border-top: 1px solid #dadce0; padding-top: 1rem; }
```

- [ ] **Step 6: Run the renderer tests and the typecheck**

Run: `cd apps/seat && node --test test/exam-state.test.ts test/enrol-state.test.ts && pnpm --filter @saakshi/seat typecheck && pnpm --filter @saakshi/seat build`
Expected: PASS, and the renderer builds.

---
### Task 15: Wiring — `main.ts` for cell, relay and control; control's audit hook; `provision --demo`

**Files:**
- Modify: `apps/server/src/main.ts`, `apps/server/src/control.ts` (`onFindings`), `tools/provision.ts` (`ops`, `--demo`)
- Test: add to `apps/server/test/main.test.ts` and `apps/server/test/provision.test.ts`

**Interfaces:**
- Consumes: Tasks 2–10.
- Produces:
  - `ControlOpts.onFindings?: (f: Finding[]) => void`, called after every `/v1/audit`.
  - `ProvisionOpts.ops?: Ops` and the CLI flag `--demo`, which writes `OPS_DEMO`.
  - `READY` lines that carry `ops: 'demo' | 'default'`, and `rebuildRelays` for a cell.

- [ ] **Step 1: Write the failing tests**

`provision.test.ts` — add:
```ts
import { OPS_DEMO } from '@saakshi/core/ops';
test('provision --demo writes the DEMO ops into the directory; without it there are none (the defaults apply)', () => {
  const a = provision({ out: join(tmp, 'a'), keys, cands: [], ops: OPS_DEMO });
  expect(a.ops).toEqual(OPS_DEMO);
  expect(provision({ out: join(tmp, 'b'), keys, cands: [] }).ops).toBeUndefined();
});
```
(`tmp` and `keys` are the file's existing temp dir and fixture keys.)

`main.test.ts` — add (these spawn processes: run unsandboxed):
```ts
test('EXAM, Stage 4: a cell waits for the relays of its centres; a relay serves its link, the seats\' status and the move routes', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'saakshi-main4-'));
  const exam = await examDir(dir);                                                   // CEN042 and CEN001 are both on cell-1
  const c = Bun.spawn(['bun', MAIN], { cwd: dir, stdout: 'pipe', stderr: 'pipe', env: { ...process.env, MODE: 'cell', DEV: '1', PORT: '0', DB: join(dir, 'c.db'), EXAM: exam, CELL_ID: 'cell-1' } });
  const r = Bun.spawn(['bun', MAIN], { cwd: dir, stdout: 'pipe', stderr: 'pipe', env: { ...process.env, MODE: 'relay', DEV: '1', PORT: '0', HOST: '127.0.0.1', DB: join(dir, 'r.db'), EXAM: exam, CENTRE: 'CEN042' } });
  try {
    const cr = (await ready(c.stdout)) as unknown as Record<string, unknown>;
    expect(cr).toMatchObject({ mode: 'cell', state: 'REBUILDING', rebuildRelays: 2, ops: 'default' });
    const rr = await ready(r.stdout);
    const base = `http://127.0.0.1:${rr.port}`;
    expect(await (await fetch(`${base}/v1/status`)).json()).toMatchObject({ link: 'up', cell: 'LIVE' });
    expect(await (await fetch(`${base}/v1/link`)).json()).toMatchObject({ centre: 'CEN042', cut: false });
    expect(await (await fetch(`${base}/v1/handover/pending`)).json()).toEqual({ pending: [] });
    expect((await fetch(`${base}/v1/purge`, { method: 'POST', body: '{}' })).status).toBe(400);
  } finally { c.kill(); r.kill(); await Promise.all([c.exited, r.exited]); rmSync(dir, { recursive: true, force: true }); }
});

test('EXAM, Stage 4: control serves /status, the incidents with their timers, and says how to start chaos without the supervisor', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'saakshi-main4c-'));
  const exam = await examDir(dir);
  const p = Bun.spawn(['bun', MAIN], { cwd: dir, stdout: 'pipe', stderr: 'pipe', env: { ...process.env, MODE: 'control', DEV: '1', PORT: '0', DIR: join(dir, 'control'), EXAM: exam, RELAY_URL: 'http://127.0.0.1:9' } });
  try {
    const base = `http://127.0.0.1:${(await ready(p.stdout)).port}`;
    expect((await fetch(`${base}/status`)).status).toBe(200);
    const inc = (await (await fetch(`${base}/v1/incidents`)).json()) as { demo: boolean; incidents: unknown[] };
    expect(inc.demo).toBe(false);
    const plug = await fetch(`${base}/v1/chaos/plug`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cell: 'cell-2', wipe: true }) });
    expect([plug.status, ((await plug.json()) as { error: string }).error]).toEqual([409, expect.stringContaining('bun tools/stack.ts')]);
    expect((await (await fetch(`${base}/v1/status/public`)).json()) as { summary: { en: string } }).toMatchObject({ summary: { en: expect.stringContaining('centres running normally') } });
  } finally { p.kill(); await p.exited; rmSync(dir, { recursive: true, force: true }); }
});
```
`ready` and `examDir` are the helpers already in `main.test.ts`.

- [ ] **Step 2: Run to verify they fail**

Run (unsandboxed): `bun test --timeout 60000 apps/server/test/main.test.ts apps/server/test/provision.test.ts`
Expected: FAIL — `rebuildRelays` is missing from READY, `/v1/status` is 404, `ops` is not a `ProvisionOpts` field.

- [ ] **Step 3: `tools/provision.ts`**

```ts
import { OPS_DEMO, type Ops } from '../packages/core/src/ops.ts';
export interface ProvisionOpts { /* … */ ops?: Ops }
// in provision(): the directory literal gains  ...(o.ops ? { ops: o.ops } : {})
// CLI: const d = provision({ …, ops: process.argv.includes('--demo') ? OPS_DEMO : undefined });
```

- [ ] **Step 4: `control.ts` — the audit feeds the incident engine**

```ts
import type { Finding } from '@saakshi/core/sheet';
// ControlOpts: add
  /** Stage 4: every audit's findings go to the incident engine (TAMPER). */
  onFindings?: (f: Finding[]) => void;
// in '/v1/audit', after `const f = await findings();`:
      o.onFindings?.(f);
```

- [ ] **Step 5: `main.ts`**

Imports:
```ts
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { opsOf } from '@saakshi/core/ops';
import { genesisPrev } from '@saakshi/core/protocol';
import { purgeRoute } from './archive.ts';
import { cellHandover } from './handover.ts';
import { LinkMonitor } from './link.ts';
import { opsMonitor } from './ops-monitor.ts';
import { opsRoutes } from './ops-routes.ts';
import { relayHandover } from './relay-handover.ts';
import { relayOps } from './relay-ops.ts';
import statusHtml from './status.html';
```
After `const X = …` and `exam`:
```ts
const ops = opsOf(X?.dir.ops);
/** Addendum C.8: D_i + gap cap + slack, from the provisioned directory. DEV (no EXAM): no hard stop. */
const deadlineMs = X ? (cand: string) => { const c = X.dir.cands[cand]; return c ? X.dir.durationMs + c.extraMs + ops.gapCapMs + ops.slackMs : undefined; } : undefined;
```
Control (inside `if (mode === 'control')`):
```ts
  const custody = (action: string, detail: Record<string, unknown>) =>
    appendFileSync(join(dir, 'custody.jsonl'), JSON.stringify({ at: new Date().toISOString(), actor: 'control (DEV)', action, ...exam, ...detail }) + '\n');
  const relayUrl = env.RELAY_URL ?? 'http://127.0.0.1:7070';
  const mon = X && fl ? opsMonitor({ dir: X.dir, ops, controlDir: dir, fleet: () => fl.view(), relayUrl, release: rc ? () => rc.status() : undefined }) : undefined;
  // controlRoutes options gain:   onFindings: mon ? (f) => mon.noteFindings(f) : undefined,
  // routes gain:
      ...(X && mon ? opsRoutes({ monitor: mon, dir: X.dir, ops, controlDir: dir, authority, cellUrl, relayUrl, stackUrl: env.STACK_URL, forms,
          roster: rosterOf(X.dir, demo), recPath: join(dir, `sth-${exam.exam}-${exam.shift}.json`),
          stores: [env.ARCHIVE_A ?? join(dir, 'worm-a'), env.ARCHIVE_B ?? join(dir, 'worm-b')], custody }) : {}),
      ...((X ? { '/status': statusHtml } : {}) as Record<string, typeof statusHtml>),
  mon?.start();
  // READY: add  ops: ops.demo ? 'demo' : 'default'
  // stop(): add  mon?.stop();
```
(`controlRoutes` creates `dir` before `opsMonitor` runs, so build `mon` after the `controlRoutes(…)` call or call `mkdirSync(dir, { recursive: true })` first.)

Cell and relay (the `else` branch):
```ts
  const served = X && mode === 'cell' ? Object.values(X.dir.centres).filter((c) => c.cell === cell.id).length : 1;
  const link = mode === 'relay' ? new LinkMonitor({ centre }) : undefined;
  const ingest = createIngest({
    mode, db, fresh, seatKey,
    acceptBinds: bindings && ((b) => bindings.acceptAll(b)),
    fromSeq: bindings ? bindings.fromSeqOf : undefined, deadlineMs,
    releases: mode === 'cell' && releases ? () => releases.list() : undefined,
    cell: mode === 'cell' ? cell : { pub: cell.pub },
    rebuildRelays: Number(env.REBUILD_RELAYS ?? Math.max(1, served)), rebuildGraceMs: ops.rebuildGraceMs,
    forms, formOf, pseud, cellId: cell.id,
    onView: (v) => hub?.publish('stream', v),
    onState: (s) => hub?.publish('state', { state: s }),
  });
  let fwd: Forwarder | undefined;
  // cell routes (EXAM):
    ...(X && bindings && releases ? cellRoutes({
      cellId: cell.id, dir: X.dir, bindings, releases, state: () => ingest.state(), views: () => ingest.views(),
      submitted: () => …unchanged…,
      handover: cellHandover({ ...exam, cell: cell as { id: string; pub: Uint8Array; priv: Uint8Array }, bindings, forms, formOf,
        stream: (c) => ingest.snapshot(c), record: (c, seq, data) => ingest.note('HANDOVER', c, seq, data), pinTries: ops.pinTries }),
      events: (after, limit) => ingest.events(after, limit),
      rebuild: () => ingest.rebuild(),
    }) : {}),
  // relay routes: the Stage 3 routes (EXAM), plus Stage 4's; the link routes also in DEV:
  : {
      ...(X && rf && bindings && releases ? {
        ...relayRoutes({ …unchanged… }),
        ...relayHandover({ ...exam, cellUrl, bindings, head: (c) => { const s = ingest.snapshot(c); return s ? { seq: s.head, h: s.headH } : { seq: 0, h: genesisPrev(c) }; } }),
        ...purgeRoute({ ...exam, authority: X.authority, db }),
      } : {}),
      ...relayOps({ centre, link: link!, wan, dev: true }),
    };
  // the forwarder:
  fwd = mode === 'relay'
    ? new Forwarder(ingest, wan.wrap(httpCellSend(cellUrl)), { ...(bindings && releases ? { releases, bindFor: (c) => bindings.forCand(c.cand) } : {}), onRound: (r) => link!.record(r) })
    : undefined;
  // READY: add  ops: ops.demo ? 'demo' : 'default', and for a cell  rebuildRelays: Math.max(1, served)
```

- [ ] **Step 6: Run the tests** (unsandboxed: they bind ports)

Run: `bun test --timeout 60000 apps/server && pnpm -r typecheck`
Expected: every server test passes. Then `bun tools/chaos-kill.ts`, `bun tools/act4.ts` and `bun tools/act2.ts` still print `PASS`.

---

### Task 16: Tools — process helpers, the demo supervisor, reset, `chaos.ts --runs N`, an in-process seat

**Files:**
- Create: `tools/procs.ts`, `tools/stack.ts`, `tools/reset.ts`, `tools/chaos.ts`, `tools/seat-cli.ts`
- Test: `apps/server/test/tools-stage4.test.ts`

**Interfaces:**
- Consumes: the server's env contract (Global Constraints), `SimSeat`, `SeatSync`/`httpSend`, `Seat`, `verifyChain`, `openBody`, `devSeat`, `cellKey`.
- Produces:
  - `procs.ts`: `ROOT`, `MAIN`, `freePort()`, `spawnNode(o): Promise<Proc>`, `call<T>(url, method?, body?)`, `until(ok, ms, what): Promise<number>`.
  - `stack.ts`: `class Stack { start(name); kill(name, wipe?); nodes(); serve(port?); stopAll() }`, `demoSpecs(o): NodeSpec[]`; the HTTP routes `/nodes`, `/kill`, `/start`.
  - `chaos.ts`: `Scenario`, `SCENARIOS`, `RunLog`, `summarise(runs)`; the CLI prints one `CHAOS {…}` line per run and a `CHAOS-SUMMARY {…}` line.
  - `reset.ts`: `seatDataDir(platform?, env?)`.
  - `seat-cli.ts`: a CLI only.

- [ ] **Step 1: Write the failing test (the pure parts)**

`apps/server/test/tools-stage4.test.ts`:
```ts
import { expect, test } from 'bun:test';
import { join, resolve } from 'node:path';
import { summarise, type RunLog } from '../../../tools/chaos.ts';
import { seatDataDir } from '../../../tools/reset.ts';
import { demoSpecs } from '../../../tools/stack.ts';

test('chaos summary: all runs ok only if every run lost nothing; RTO p50 and max per scenario', () => {
  const r = (run: number, scenario: RunLog['scenario'], rtoMs: number, lost = 0): RunLog => ({ run, scenario, seats: 8, sent: 800, relayAcked: 800, cellAcked: 800, stored: 800 - lost, lost, rpo: 0, rtoMs, ok: lost === 0 });
  const s = summarise([r(1, 'kill-cell', 900), r(2, 'wipe-cell', 2_000), r(3, 'spare-relay', 1_500), r(4, 'kill-cell', 1_100), r(5, 'kill-cell', 1_000)]);
  expect(s).toEqual({ runs: 5, ok: true, lost: 0, rtoMs: { 'kill-cell': { n: 3, p50: 1_000, max: 1_100 }, 'wipe-cell': { n: 1, p50: 2_000, max: 2_000 }, 'spare-relay': { n: 1, p50: 1_500, max: 1_500 } } });
  expect(summarise([r(1, 'wipe-cell', 10, 3)])).toMatchObject({ ok: false, lost: 3 });
});

test('the demo stack: three cells, the Centre 42 relay, control pointed at the supervisor, the swarm only with a cohort', () => {
  const s = demoSpecs({ exam: '/x/exam', data: '/x/data', stackUrl: 'http://127.0.0.1:7099' });
  expect(s.map((n) => n.name)).toEqual(['cell-1', 'cell-2', 'cell-3', 'relay', 'control']);
  expect(s[1]).toMatchObject({ db: join(resolve('/x/data'), 'cell-2.db'), env: { MODE: 'cell', CELL_ID: 'cell-2', PORT: '7081', EXAM: resolve('/x/exam') } });   // Windows CI too
  expect(s[4].env).toMatchObject({ MODE: 'control', STACK_URL: 'http://127.0.0.1:7099', RELAY_URL: 'http://127.0.0.1:7070' });
  expect(demoSpecs({ exam: '/x/exam', data: '/x/data', stackUrl: 'u', cohort: '/x/g1.jsonl' }).at(-1)).toMatchObject({ name: 'swarm', ready: 'SWARM ' });
  expect(seatDataDir('darwin')).toMatch(/Library[\\/]Application Support[\\/]Saakshi$/);
  expect(seatDataDir('win32', { APPDATA: 'C:\\Users\\a\\AppData\\Roaming' })).toMatch(/Saakshi$/);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test --timeout 60000 apps/server/test/tools-stage4.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: `tools/procs.ts`**

```ts
// Shared by the Stage 4 tools: start a Saakshi process and wait for its READY line, free ports, JSON calls, polling.
import { join, resolve } from 'node:path';

export const ROOT = resolve(import.meta.dir, '..');
export const MAIN = join(ROOT, 'apps/server/src/main.ts');
export const freePort = (): number => { const s = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Response() }); const p = s.port!; s.stop(true); return p; };
export interface Proc { proc: ReturnType<typeof Bun.spawn>; out: string[] }

/** Spawn (default: the server with DEV=1) and wait for a line starting with `ready` (default "READY "). */
export async function spawnNode(o: { env: Record<string, string>; cwd: string; cmd?: string[]; ready?: string; timeoutMs?: number; echo?: (line: string) => void }): Promise<Proc> {
  const proc = Bun.spawn(o.cmd ?? ['bun', MAIN], { cwd: o.cwd, env: { ...process.env, DEV: '1', ...o.env }, stdout: 'pipe', stderr: 'inherit' });
  const out: string[] = [];
  void (async () => {
    const dec = new TextDecoder();
    let buf = '';
    for await (const chunk of proc.stdout as ReadableStream<Uint8Array>) {
      buf += dec.decode(chunk);
      for (let i = buf.indexOf('\n'); i >= 0; i = buf.indexOf('\n')) { const l = buf.slice(0, i); out.push(l); o.echo?.(l); buf = buf.slice(i + 1); }
    }
  })();
  const ready = o.ready ?? 'READY ', deadline = Date.now() + (o.timeoutMs ?? 20_000), what = o.env.MODE ?? o.cmd?.join(' ') ?? 'process';
  while (!out.some((l) => l.startsWith(ready))) {
    if (proc.exitCode !== null) throw new Error(`${what} exited before ${ready.trim()}:\n${out.join('\n')}`);
    if (Date.now() > deadline) { proc.kill(); throw new Error(`${what} did not print ${ready.trim()}`); }
    await Bun.sleep(20);
  }
  return { proc, out };
}

export async function call<T>(url: string, method = 'GET', body?: unknown): Promise<T> {
  const r = await fetch(url, { method, headers: body === undefined ? {} : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!r.ok) throw new Error(`${method} ${url} → ${r.status} ${await r.text()}`);
  return (await r.json()) as T;
}

/** Poll until ok() holds; returns the time it took. */
export async function until(ok: () => boolean | Promise<boolean>, ms: number, what: string, everyMs = 100): Promise<number> {
  const t0 = Date.now();
  while (!(await ok())) { if (Date.now() - t0 > ms) throw new Error(`timed out after ${ms} ms: ${what}`); await Bun.sleep(everyMs); }
  return Date.now() - t0;
}
```

- [ ] **Step 4: `tools/stack.ts`**

```ts
// The demo supervisor (Stage 4). It runs every Saakshi process for the Act 3 demo and lets control's chaos buttons SIGKILL a node —
// optionally deleting its database ("pull the plug") — start it again, or swap the relay for a spare. DEV only; it binds 127.0.0.1.
//   bun tools/stack.ts --exam data/exam [--data data] [--cohort data/g1/cohort.jsonl] [--speed 20] [--port 7099]
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ROOT, spawnNode, type Proc } from './procs.ts';

export interface NodeSpec { name: string; env: Record<string, string>; db?: string; cmd?: string[]; ready?: string }

export class Stack {
  #specs: Map<string, NodeSpec>;
  #procs = new Map<string, Proc>();
  #restarts = new Map<string, number>();
  #cwd: string;
  #log: (name: string, line: string) => void;

  constructor(specs: NodeSpec[], o: { cwd: string; log?: (name: string, line: string) => void }) {
    this.#specs = new Map(specs.map((s) => [s.name, s]));
    this.#cwd = o.cwd;
    this.#log = o.log ?? (() => {});
  }

  async start(name: string): Promise<{ node: string; pid: number }> {
    const s = this.#specs.get(name);
    if (!s) throw new Error(`no node ${name}`);
    const cur = this.#procs.get(name);
    if (cur && cur.proc.exitCode === null) return { node: name, pid: cur.proc.pid };
    const p = await spawnNode({ env: s.env, cwd: this.#cwd, cmd: s.cmd, ready: s.ready, echo: (l) => this.#log(name, l) });
    this.#procs.set(name, p);
    this.#restarts.set(name, (this.#restarts.get(name) ?? -1) + 1);
    return { node: name, pid: p.proc.pid };
  }

  /** SIGKILL, like pulling the plug; with wipe, the node's database (and its WAL) is deleted too. */
  async kill(name: string, wipe = false): Promise<{ node: string; killed: boolean; wiped: string[] }> {
    const s = this.#specs.get(name);
    if (!s) throw new Error(`no node ${name}`);
    const p = this.#procs.get(name);
    let killed = false;
    if (p && p.proc.exitCode === null) { p.proc.kill('SIGKILL'); await p.proc.exited; killed = true; }
    const wiped: string[] = [];
    if (wipe && s.db) for (const f of [s.db, `${s.db}-wal`, `${s.db}-shm`]) if (existsSync(f)) { rmSync(f); wiped.push(f); }
    this.#log(name, `PLUG PULLED (SIGKILL)${wiped.length ? `; deleted ${wiped.join(', ')}` : ''}`);
    return { node: name, killed, wiped };
  }

  nodes(): { node: string; pid: number | null; up: boolean; restarts: number }[] {
    return [...this.#specs.keys()].map((node) => {
      const p = this.#procs.get(node);
      return { node, pid: p?.proc.pid ?? null, up: !!p && p.proc.exitCode === null, restarts: Math.max(0, this.#restarts.get(node) ?? 0) };
    });
  }

  serve(port = 7099) {
    const json = (b: unknown, status = 200) => Response.json(b, { status });
    const act = (fn: (b: { node?: unknown; wipe?: unknown }) => Promise<unknown>) => async (req: Request) => {
      const b = (await req.json().catch(() => ({}))) as { node?: unknown; wipe?: unknown };
      if (typeof b.node !== 'string' || !this.#specs.has(b.node)) return json({ error: `need {node}: one of ${[...this.#specs.keys()].join(', ')}` }, 400);
      try { return json(await fn(b)); } catch (e) { return json({ error: (e as Error).message }, 500); }
    };
    return Bun.serve({ hostname: '127.0.0.1', port, fetch: () => json({ error: 'not found' }, 404), routes: {
      '/nodes': { GET: () => json(this.nodes()) },
      '/kill': { POST: act((b) => this.kill(b.node as string, b.wipe === true)) },
      '/start': { POST: act((b) => this.start(b.node as string)) },
    } });
  }

  async stopAll(): Promise<void> {
    for (const p of this.#procs.values()) if (p.proc.exitCode === null) p.proc.kill();
    await Promise.all([...this.#procs.values()].map((p) => p.proc.exited));
  }
}

export function demoSpecs(o: { exam: string; data: string; stackUrl: string; cohort?: string; speed?: number; cellPorts?: number[]; relayPort?: number; controlPort?: number }): NodeSpec[] {
  const exam = resolve(o.exam), data = resolve(o.data), relayPort = o.relayPort ?? 7070;
  const specs: NodeSpec[] = (o.cellPorts ?? [7080, 7081, 7082]).map((port, i) => {
    const db = join(data, `cell-${i + 1}.db`);
    return { name: `cell-${i + 1}`, db, env: { MODE: 'cell', CELL_ID: `cell-${i + 1}`, PORT: String(port), EXAM: exam, DB: db } };
  });
  specs.push({ name: 'relay', db: join(data, 'relay.db'), env: { MODE: 'relay', PORT: String(relayPort), EXAM: exam, DB: join(data, 'relay.db') } });
  specs.push({ name: 'control', env: { MODE: 'control', PORT: String(o.controlPort ?? 7090), EXAM: exam, DIR: join(data, 'control'), STACK_URL: o.stackUrl, RELAY_URL: `http://127.0.0.1:${relayPort}` } });
  if (o.cohort) specs.push({ name: 'swarm', cmd: ['bun', join(ROOT, 'tools/swarm.ts'), '--exam', exam, '--cohort', resolve(o.cohort), '--speed', String(o.speed ?? 20)], ready: 'SWARM ', env: {} });
  return specs;
}

if (import.meta.main) {
  const arg = (f: string) => { const i = process.argv.indexOf(f); return i > 0 ? process.argv[i + 1] : undefined; };
  const port = Number(arg('--port') ?? 7099), data = resolve(arg('--data') ?? 'data');
  mkdirSync(data, { recursive: true });
  const specs = demoSpecs({ exam: arg('--exam') ?? 'data/exam', data, stackUrl: `http://127.0.0.1:${port}`, cohort: arg('--cohort'), speed: Number(arg('--speed') ?? 20) });
  const stack = new Stack(specs, { cwd: ROOT, log: (n, l) => console.log(`[${n}] ${l}`) });
  for (const s of specs) await stack.start(s.name);
  stack.serve(port);
  console.log(`STACK ${JSON.stringify(stack.nodes())}`);
  const stop = async () => { await stack.stopAll(); process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
```

- [ ] **Step 5: `tools/reset.ts`**

```ts
// Back to a clean slate for the demo (macOS or Linux). It stops every Saakshi process on the demo ports and quits the seat app (so the
// camera is never left on). It deletes the demo state under data/, keeping data/g1 (the cohort takes a while to regenerate). With
// --seat it also deletes the seat app's journal and its test-mode key.
//   bun tools/reset.ts [--data data] [--seat]
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const PORTS = [7070, 7080, 7081, 7082, 7090, 7099];
export function seatDataDir(platform: string = process.platform, env: Record<string, string | undefined> = process.env): string {
  if (platform === 'darwin') return join(homedir(), 'Library/Application Support/Saakshi');
  if (platform === 'win32') return join(env.APPDATA ?? join(homedir(), 'AppData/Roaming'), 'Saakshi');
  return join(homedir(), '.config/Saakshi');
}

if (import.meta.main) {
  const i = process.argv.indexOf('--data'), data = resolve(i > 0 ? process.argv[i + 1] : 'data');
  for (const port of PORTS) {
    const pids = new TextDecoder().decode(Bun.spawnSync(['lsof', '-ti', `tcp:${port}`, '-sTCP:LISTEN']).stdout).split(/\s+/).filter(Boolean);
    for (const pid of pids) { try { process.kill(Number(pid), 'SIGKILL'); console.log(`stopped pid ${pid} on :${port}`); } catch { /* already gone */ } }
  }
  Bun.spawnSync(['pkill', '-f', 'tools/swarm.ts']);
  Bun.spawnSync(['pkill', '-f', 'Saakshi.app/Contents/MacOS/Saakshi']);
  if (existsSync(data)) for (const f of readdirSync(data)) if (f !== 'g1') { rmSync(join(data, f), { recursive: true, force: true }); console.log(`deleted ${join(data, f)}`); }
  if (process.argv.includes('--seat')) for (const f of ['journal', 'test-mode.key']) { rmSync(join(seatDataDir(), f), { recursive: true, force: true }); console.log(`deleted ${join(seatDataDir(), f)}`); }
  console.log('RESET done');
}
```

- [ ] **Step 6: `tools/chaos.ts`**

```ts
// Stage 4 chaos (the plan's Stage 4 exit check: `bun tools/chaos.ts --runs 20`). Each run spawns a real cell and a real relay (DEV
// mode, its own temp dir), streams entries from simulated seats through the seat's own sync loop, injects one failure mid-stream,
// recovers, and counts what is on the cell's disk:
//   kill-cell    SIGKILL the cell; restart it on the same DB
//   wipe-cell    SIGKILL the cell and delete its DB; it restarts REBUILDING and the relay replays from genesis
//   spare-relay  SIGKILL the relay and delete its DB; a spare (the same binary, the same port, an empty DB) starts; seats resend from their journals
// Measured per run: sent / relay-acked / cell-acked / stored / lost; RPO = entries the cell had acknowledged before the failure that are
// missing afterwards; RTO = the failure → every sent entry acknowledged by the cell again. One `CHAOS {…}` line per run; exit 1 on any loss.
//   bun tools/chaos.ts [--runs 20] [--seats 8] [--entries 100] [--out docs/evidence/stage4-chaos.jsonl]
import { Database } from 'bun:sqlite';
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cellKey, devSeat, type KeysFile } from '../packages/core/src/dev.ts';
import { parseSignedLine, verifyChain } from '../packages/core/src/journal.ts';
import { openBody, verifier } from '../packages/core/src/node.ts';
import { httpSend, SeatSync } from '../apps/seat/src/main/sync.ts';
import { freePort, ROOT, spawnNode, type Proc } from './procs.ts';
import { SimSeat } from './sim-seat.ts';

export type Scenario = 'kill-cell' | 'wipe-cell' | 'spare-relay';
export const SCENARIOS: Scenario[] = ['kill-cell', 'wipe-cell', 'spare-relay'];
export interface RunLog { run: number; scenario: Scenario; seats: number; sent: number; relayAcked: number; cellAcked: number; stored: number; lost: number; rpo: number; rtoMs: number; ok: boolean }

export function summarise(runs: RunLog[]) {
  const rtoMs = {} as Record<Scenario, { n: number; p50: number; max: number }>;
  for (const sc of SCENARIOS) {
    const xs = runs.filter((r) => r.scenario === sc).map((r) => r.rtoMs).sort((a, b) => a - b);
    if (xs.length) rtoMs[sc] = { n: xs.length, p50: xs[Math.floor((xs.length - 1) / 2)], max: xs[xs.length - 1] };
  }
  const lost = runs.reduce((n, r) => n + r.lost, 0);
  return { runs: runs.length, ok: runs.every((r) => r.ok), lost, rtoMs };
}

const keys = JSON.parse(readFileSync(join(ROOT, 'fixtures/keys.json'), 'utf8')) as KeysFile;
const cell = cellKey(keys, 'cell-1');
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const rmDb = (p: string) => { for (const f of [p, `${p}-wal`, `${p}-shm`]) rmSync(f, { force: true }); };

async function run(n: number, scenario: Scenario, SEATS: number, TARGET: number): Promise<RunLog> {
  const dir = mkdtempSync(join(tmpdir(), 'saakshi-chaos-'));
  const cellDb = join(dir, 'cell.db'), relayDb = join(dir, 'relay.db'), cellPort = freePort(), relayPort = freePort();
  const cellEnv = { MODE: 'cell', PORT: String(cellPort), DB: cellDb };
  const relayEnv = { MODE: 'relay', PORT: String(relayPort), HOST: '127.0.0.1', DB: relayDb, CELL_URL: `http://127.0.0.1:${cellPort}` };
  let cellP: Proc = await spawnNode({ env: cellEnv, cwd: dir }), relayP: Proc = await spawnNode({ env: relayEnv, cwd: dir });
  const relayUrl = `http://127.0.0.1:${relayPort}`;
  const seats = Array.from({ length: SEATS }, (_, i) => {
    const sim = new SimSeat(keys, `C${String(i + 1).padStart(4, '0')}`, cell.pub);
    const src = { ctx: sim.ctx, head: () => sim.head, hashAt: (s: number) => sim.hs[s - 1], entriesAfter: (a: number, l: number) => sim.after(a, l) };
    return { sim, sync: new SeatSync(src, httpSend(relayUrl, 2_000), verifier(cell.pub)) };
  });
  const produce = (k: number) => { for (const s of seats) s.sim.add(Math.max(0, Math.min(k, TARGET - s.sim.head))); };
  const round = () => Promise.all(seats.map((s) => s.sync.round()));
  const views = () => seats.map((s) => s.sync.view());
  async function until(pred: () => boolean, what: string, ms = 90_000): Promise<void> {
    const t0 = Date.now();
    while (!pred()) { if (Date.now() - t0 > ms) throw new Error(`run ${n} (${scenario}): timed out waiting for ${what}`); await round(); await Bun.sleep(20); }
  }
  try {
    while (seats[0].sim.head < TARGET * 0.4) { produce(2); await round(); await Bun.sleep(10); }
    await until(() => views().every((v) => v.cell > 0), 'first cell acks');
    const ackedBefore = views().map((v) => v.cell);
    const t0 = Date.now();
    if (scenario === 'spare-relay') { relayP.proc.kill('SIGKILL'); await relayP.proc.exited; rmDb(relayDb); }
    else { cellP.proc.kill('SIGKILL'); await cellP.proc.exited; if (scenario === 'wipe-cell') rmDb(cellDb); }
    for (let i = 0; i < 20; i++) { produce(1); await round(); await Bun.sleep(20); }       // the exam goes on during the failure
    if (scenario === 'spare-relay') relayP = await spawnNode({ env: relayEnv, cwd: dir });
    else cellP = await spawnNode({ env: cellEnv, cwd: dir });
    while (seats.some((s) => s.sim.head < TARGET)) { produce(3); await round(); await Bun.sleep(10); }
    await until(() => views().every((v) => v.cell === TARGET && v.relay === TARGET), 'every entry acknowledged by the cell again');
    const rtoMs = Date.now() - t0;
    cellP.proc.kill('SIGKILL'); await cellP.proc.exited;
    const db = new Database(cellDb);                                                  // read-write open: a crashed WAL needs recovery
    let stored = 0, rpo = 0;
    seats.forEach((s, i) => {
      const rows = db.query('SELECT line, env FROM entries WHERE cand = ? ORDER BY seq').all(s.sim.ctx.cand) as { line: string; env: Uint8Array }[];
      const chain = verifyChain(s.sim.ctx, rows.map((r) => r.line), verifier(devSeat(keys, s.sim.ctx.cand)!.pub));
      if (!chain.ok || chain.head !== s.sim.hs[rows.length - 1]) throw new Error(`${s.sim.ctx.cand}: the stored chain is not what was sent`);
      rows.forEach((r, k) => { const p = parseSignedLine(r.line); if (!p.ok) throw new Error('unparseable stored line'); openBody(cell.priv, { ...s.sim.ctx, seq: k + 1 }, r.env, p.header.bodyCommit); });
      stored += rows.length;
      rpo += Math.max(0, ackedBefore[i] - rows.length);
    });
    db.close();
    const sent = SEATS * TARGET, relayAcked = sum(views().map((v) => v.relay)), cellAcked = sum(views().map((v) => v.cell));
    const lost = sent - stored;
    return { run: n, scenario, seats: SEATS, sent, relayAcked, cellAcked, stored, lost, rpo, rtoMs, ok: lost === 0 && rpo === 0 && relayAcked === sent && cellAcked === sent };
  } finally {
    for (const p of [cellP, relayP]) if (p.proc.exitCode === null) p.proc.kill();
    await Promise.all([cellP.proc.exited, relayP.proc.exited]);
    rmSync(dir, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const arg = (f: string, d: string) => { const i = process.argv.indexOf(f); return i > 0 ? process.argv[i + 1] : d; };
  const RUNS = Number(arg('--runs', '20')), SEATS = Number(arg('--seats', '8')), TARGET = Number(arg('--entries', '100')), out = arg('--out', '');
  const logs: RunLog[] = [];
  for (let i = 1; i <= RUNS; i++) {
    let r: RunLog;
    try { r = await run(i, SCENARIOS[(i - 1) % SCENARIOS.length], SEATS, TARGET); }
    catch (e) { console.error(`run ${i}: ${(e as Error).message}`); r = { run: i, scenario: SCENARIOS[(i - 1) % SCENARIOS.length], seats: SEATS, sent: SEATS * TARGET, relayAcked: 0, cellAcked: 0, stored: 0, lost: SEATS * TARGET, rpo: -1, rtoMs: -1, ok: false }; }
    logs.push(r);
    const line = JSON.stringify({ ...r, at: new Date().toISOString(), host: `${process.platform}-${process.arch}` });
    console.log(`CHAOS ${line}`);
    if (out) appendFileSync(out, line + '\n');
  }
  const s = summarise(logs);
  console.log(`CHAOS-SUMMARY ${JSON.stringify(s)}`);
  console.log(s.ok ? 'PASS' : 'FAIL');
  process.exitCode = s.ok ? 0 : 1;
}
```

- [ ] **Step 7: `tools/seat-cli.ts` — an in-process seat for the demo (no Electron, no camera, no keychain)**

```ts
// The seat's own code (Seat), in this process, against a relay: for the demo checklist and quick checks without the packaged app.
// Test mode: the journal key is a file (no keychain), no camera. It prints `SEAT {…}` every 2 s.
//   bun tools/seat-cli.ts --relay http://127.0.0.1:7070 --cand C0001 --seat CEN042-S01 [--dir data/seats/S01] [--pin 482913]
//        [--answers 5] [--move] [--quit-when-synced] [--suspend 20]
//   --move              after a refused check-in (the candidate is bound elsewhere), ask to continue here with the PIN; prints MOVE-KEY
//   --quit-when-synced  exit (like a force-quit) once every answer is acknowledged by the exam server (✓✓ blue, backlog 0)
//   --suspend S         after answering, pause as if the laptop slept for S seconds, then resume (a gap entry)
import { mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { hexToBytes } from '../packages/core/src/bytes.ts';
import { DEV_EXAM } from '../packages/core/src/dev.ts';
import { fileWrapper } from '../apps/seat/src/main/keystore.ts';
import { Seat } from '../apps/seat/src/main/seat.ts';
import { ROOT } from './procs.ts';

const arg = (f: string, d = '') => { const i = process.argv.indexOf(f); return i > 0 ? process.argv[i + 1] : d; };
const has = (f: string) => process.argv.includes(f);
const cand = arg('--cand', 'C0001'), seatId = arg('--seat', 'CEN042-S01'), pin = arg('--pin', '482913');
const dir = resolve(arg('--dir', join('data', 'seats', seatId)));
mkdirSync(dir, { recursive: true });
const authorityPub = hexToBytes((JSON.parse(readFileSync(join(ROOT, 'fixtures/trust-dev.json'), 'utf8')) as { authority: string }).authority);
const seat = new Seat({ dir: join(dir, 'journal'), relayUrl: arg('--relay', 'http://127.0.0.1:7070'), ctx: { ...DEV_EXAM, cand }, seatId, authorityPub,
  wrap: fileWrapper(dir), camera: false, testMode: true, retryMs: 500 });
const say = () => { const b = seat.boot(); console.log(`SEAT ${JSON.stringify({ cand, seatId, phase: b.phase, bind: b.bind, ...b.sync, credited: b.credited, status: b.status, notice: b.notice })}`); };
const wait = async (ok: () => boolean) => { while (!ok()) await Bun.sleep(200); };
const stop = () => { seat.close(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

await seat.open();
setInterval(say, 2_000);
await wait(() => seat.boot().phase !== 'connecting');
if (seat.boot().phase === 'enrol' && !seat.boot().moveable) await seat.enrol({ pin, operatorId: 'GATE-42-OP7', method: 'aadhaar-face' });
if (has('--move')) {
  await wait(() => !!seat.boot().moveable || seat.boot().phase === 'exam');
  if (seat.boot().moveable) { await seat.handover(pin); console.log(`MOVE-KEY ${seat.boot().moveKey}`); }
}
await wait(() => ['ready', 'exam', 'submitted'].includes(seat.boot().phase ?? ''));
if (seat.boot().phase === 'ready') seat.start();
const items = seat.paper()!.items.map((i) => i.id);
for (let i = 0; i < Number(arg('--answers', '0')); i++) {
  seat.act({ kind: 'answer', item: items[i % items.length], state: 'A', answer: 'A', dwellMs: 3_000 });
  await Bun.sleep(1_000);
}
const s = Number(arg('--suspend', '0'));
if (s > 0) { seat.pause('suspend'); console.log(`SUSPENDED ${s} s`); await Bun.sleep(s * 1_000); seat.resume(); console.log('RESUMED'); }
say();
if (has('--quit-when-synced')) {
  await wait(() => { const v = seat.boot().sync; return v.cell >= v.local && v.local > 0; });
  console.log('SYNCED (blue ✓✓, backlog 0): quitting as if force-quit');
  stop();
}
```
(`fileWrapper` is the Stage 3 DEV test keystore; `dir` is the seat's own data folder, e.g. `data/seats/S01`.)

- [ ] **Step 8: Run the test, then one chaos run of each scenario** (unsandboxed: ports)

Run: `bun test --timeout 60000 apps/server/test/tools-stage4.test.ts && bun tools/chaos.ts --runs 3`
Expected: the test passes; three `CHAOS {…}` lines (kill-cell, wipe-cell, spare-relay), each with `"lost":0,"rpo":0,"ok":true`, then `CHAOS-SUMMARY … "ok":true` and `PASS`.

---
### Task 17: Act 3 end to end — `tools/act3.ts` — and CI

**Files:**
- Create: `tools/act3.ts`
- Modify: `.github/workflows/server.yml`

**Interfaces:**
- Consumes: every task. `Stack`/`demoSpecs` (Task 16), `Swarm` (Stage 3), `Seat` (Task 13), `provision(…, ops: OPS_DEMO)`, `buildPackage`/`writePackage`/`zeroise`, `shareRequest` (Stage 3 custodian view), `verifyProof`/`verifySheet`/`certifiedCells` (Task 1).
- Produces: `bun tools/act3.ts [--cohort path]` prints one `✓` line per step, an `ACT3-NUMBERS {…}` line (the measured times), and `PASS`.

- [ ] **Step 1: `tools/act3.ts`**

```ts
// Stage 4 end to end (Act 3) on real processes, supervised by tools/stack.ts's Stack (so control's chaos buttons are real):
// provision (DEMO ops) → package → 3 cells + the Centre 42 relay + control; the swarm (a small G1) and a real seat at Centre 42 (the
// seat's own code) → release → degrade Centre 42's link → SYNC_LAG predicts → cut → RELAY_WAN_DOWN (and how early it was predicted),
// the seat's banner, the ladder climbs, ack → pull the plug on Data Centre 2 and delete its DB → P1 with its blast radius, candidates keep
// answering → restart → rebuild → the P1 closes with answers lost 0 → sent = verified = stored → seat A at blue ✓✓, backlog 0, force-quit
// → seat B: PIN → the invigilator approves → resumes with the same answers and time, credited → seat A comes back: ORPHANED, "moved" →
// submit → seal → /verify of the moved candidate with only the authority key → archive to 2 stores → purge → rogue insider → TAMPER →
// the regulator rung drafts CERT-In → the public status carries no PII; a notice is approved.
// Needs local ports (run it unsandboxed) and uv (it generates a small G1 unless --cohort is given).
//   bun tools/act3.ts [--cohort path/to/cohort.jsonl]
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hexToBytes } from '../packages/core/src/bytes.ts';
import { DEV_EXAM, type KeysFile } from '../packages/core/src/dev.ts';
import type { FleetView, ReleaseStatus } from '../packages/core/src/directory.ts';
import type { BindReq } from '../packages/core/src/enrol.ts';
import { verifier } from '../packages/core/src/node.ts';
import { OPS_DEMO, type Incident, type LinkView, type Notice, type PublicStatus, type TimeRow } from '../packages/core/src/ops.ts';
import { formsOf, type Proof, type ShiftExport } from '../packages/core/src/sheet.ts';
import { verifyProof, verifySheet } from '../packages/core/src/verify.ts';
import type { EnrolResult } from '../apps/server/src/bindings.ts';
import { shareRequest, type ReleaseKey } from '../apps/server/src/custodian-view.ts';
import { httpCellSend } from '../apps/server/src/forward.ts';
import { blastText, mmss } from '../apps/server/src/incidents.ts';
import type { Wrapper } from '../apps/seat/src/main/journal-store.ts';
import { Seat } from '../apps/seat/src/main/seat.ts';
import { readCohort, type CohortRow } from './cohort.ts';
import { buildPackage, writePackage, zeroise } from './package.ts';
import { call, freePort, ROOT, until } from './procs.ts';
import { cohortCands, provision } from './provision.ts';
import { demoSpecs, Stack } from './stack.ts';
import { Swarm } from './swarm.ts';

const arg = (f: string) => { const i = process.argv.indexOf(f); return i > 0 ? process.argv[i + 1] : undefined; };
const read = (f: string) => JSON.parse(readFileSync(join(ROOT, f), 'utf8'));
const keys = read('fixtures/keys.json') as KeysFile;
const forms = formsOf(read('fixtures/paper/forms.json'));
const authority = { priv: hexToBytes(keys.authority.priv), pub: hexToBytes(keys.authority.pub) };
const onlyAuthority = { authority: keys.authority.pub, cells: {}, seats: {} };
const dir = mkdtempSync(join(tmpdir(), 'saakshi-act3-'));
const fail = (m: string): never => { throw new Error(m); };
const step = (m: string) => console.log(`✓ ${m}`);
const PIN = '482913', ctx = { ...DEV_EXAM, cand: 'C0001' };
const wrap: Wrapper = { encryptString: (s) => Buffer.from(s), decryptString: (b) => b.toString() };
const numbers: Record<string, number> = {};

let cohort = arg('--cohort');
if (!cohort) {
  const out = join(dir, 'g1');
  const g = Bun.spawnSync(['uv', 'run', '--directory', join(ROOT, 'analytics'), 'python', '-m', 'saakshi_analytics.generate', out, '--n', '300', '--centres', '6', '--seed', '7'], { stdout: 'inherit', stderr: 'inherit' });
  if (g.exitCode !== 0) fail('uv could not generate the G1 cohort');
  cohort = join(out, 'cohort.jsonl');
}

const ports = { cells: [freePort(), freePort(), freePort()], relay: freePort(), control: freePort(), stack: freePort() };
const R = `http://127.0.0.1:${ports.relay}`, C = `http://127.0.0.1:${ports.control}`;
const exam = join(dir, 'exam');
let stack: Stack | undefined, swarm: Swarm | undefined;
const seats: Seat[] = [];
const newSeat = (sub: string, seatId: string) => { mkdirSync(join(dir, sub), { recursive: true }); const s = new Seat({ dir: join(dir, sub), relayUrl: R, ctx, seatId, authorityPub: authority.pub, wrap, camera: false, testMode: true, retryMs: 200 }); seats.push(s); return s; };
let next = 0;
const answer = (s: Seat, n: number) => {
  const items = s.paper()!.items;
  for (let i = 0; i < n; i++) { const r = s.act({ kind: 'answer', item: items[next++ % items.length].id, state: 'A', answer: 'A', dwellMs: 1_000 }); if (!r.ok) fail(`answer refused: ${r.error}`); }
};
const blue = (s: Seat) => s.boot().sync.cell >= s.exam!.head() && s.boot().sync.relay >= s.exam!.head();
const incidents = async () => (await call<{ incidents: Incident[] }>(`${C}/v1/incidents`)).incidents;
const openOf = async (kind: Incident['kind'], cand?: string) => (await incidents()).find((i) => i.kind === kind && !i.resolvedAt && (!cand || i.cand === cand));

try {
  // 1. Provision with the DEMO ops (10 s ladder), package, keep two custodians' files.
  const X = provision({ out: exam, keys, cands: await cohortCands(cohort), cellUrls: ports.cells.map((p) => `http://127.0.0.1:${p}`), ops: OPS_DEMO });
  const pkg = await buildPackage(X, { bank: read('fixtures/paper/bank.json'), forms: read('fixtures/paper/forms.json') }, authority);
  writePackage(exam, pkg);
  const custodians = { NTA: { file: pkg.shares.NTA, pass: pkg.passphrases.NTA }, NIC: { file: pkg.shares.NIC, pass: pkg.passphrases.NIC } };
  zeroise(pkg);
  const onCell2 = Object.entries(X.centres).filter(([, c]) => c.cell === 'cell-2').map(([id]) => id);
  if (!onCell2.length) fail('this cohort puts no centre on cell-2');

  // 2. The processes, under the supervisor control's chaos buttons talk to.
  const specs = demoSpecs({ exam, data: join(dir, 'data'), stackUrl: `http://127.0.0.1:${ports.stack}`, cellPorts: ports.cells, relayPort: ports.relay, controlPort: ports.control });
  specs.find((s) => s.name === 'relay')!.env.HOST = '127.0.0.1';
  mkdirSync(join(dir, 'data'), { recursive: true });
  stack = new Stack(specs, { cwd: dir, log: (n, l) => { if (/PLUG|HANDOVER|WAN|PURGED|ROGUE/.test(l)) console.log(`  [${n}] ${l}`); } });
  for (const s of specs) await stack.start(s.name);
  stack.serve(ports.stack);
  step(`stack up: 3 cells, ${X.demoCentre}'s relay, control (DEMO timers), supervisor on :${ports.stack}`);

  // 3. Seat A at Centre 42 (the seat's own code), the swarm, the release.
  const seatA = newSeat('seatA', 'CEN042-S01');
  await seatA.open();
  await until(() => seatA.boot().phase === 'enrol', 15_000, 'seat A loading its package');
  await seatA.enrol({ pin: PIN, operatorId: 'GATE-42-OP7', method: 'aadhaar-face' });
  await until(() => seatA.boot().bind === 'bound', 20_000, 'seat A enrolment');
  const rows: CohortRow[] = [];
  for await (const r of readCohort(cohort)) if (X.cands[r.cand] && forms[r.form]?.includes(r.item)) rows.push({ ...r, shift: X.shift });
  swarm = await Swarm.start({ dir: X, manifest: pkg.manifest, authorityPub: authority.pub, rows, forms, speed: 50, cell: (id) => {
    const url = X.cells.find((c) => c.id === id)!.url;
    return { send: httpCellSend(url, 10_000), enrol: async (reqs: BindReq[]) => ((await call<{ results: EnrolResult[] }>(`${url}/v1/enrol`, 'POST', { enrols: reqs })).results) };
  } });
  const key = await call<ReleaseKey>(`${C}/v1/release/key`);
  for (const c of ['NTA', 'NIC'] as const) await call(`${C}/v1/release/share`, 'POST', shareRequest(custodians[c].file, custodians[c].pass, key));
  await until(async () => (await call<ReleaseStatus>(`${C}/v1/release/status`)).zeroised, 30_000, 'the release reaching every cell');
  await until(() => seatA.boot().phase === 'ready', 30_000, 'seat A unlocking');
  seatA.start();
  answer(seatA, 5);
  await until(() => blue(seatA), 30_000, 'seat A at blue ✓✓');
  step(`released by NTA + NIC; seat A answering at ${X.demoCentre}; swarm: ${swarm.stats().cands} candidates`);

  // 4. Degrade Centre 42's link: SYNC_LAG predicts; then the cut; the banner; the ladder climbs; ack; restore.
  await call(`${C}/v1/chaos/degrade`, 'POST', { on: true });
  const tDegrade = Date.now();
  await until(async () => { answer(seatA, 1); return !!(await openOf('SYNC_LAG')); }, 120_000, 'SYNC_LAG predicting the failure', 1_000);
  numbers.syncLagAfterDegradeMs = Date.now() - tDegrade;
  const lk = await call<LinkView>(`${C}/v1/link`);
  if (lk.cut) fail('SYNC_LAG must come before the cut');
  step(`SYNC_LAG: "${lk.reason}" — ${Math.round(numbers.syncLagAfterDegradeMs / 1000)} s after the link began to degrade, before it was cut`);
  await call(`${C}/v1/chaos/wan`, 'POST', { up: false });
  await until(async () => !!(await openOf('RELAY_WAN_DOWN')), 30_000, 'RELAY_WAN_DOWN');
  const rwd = (await openOf('RELAY_WAN_DOWN'))!;
  if (!(Number(rwd.data.warnedMs) > 0)) fail('RELAY_WAN_DOWN did not record the earlier prediction');
  numbers.predictedBeforeDownMs = Number(rwd.data.warnedMs);
  await until(() => seatA.boot().status?.link === 'down', 15_000, 'the seat\'s banner status');
  if (!(await call<PublicStatus>(`${C}/v1/status/public`)).incidents.some((i) => i.kind === 'RELAY_WAN_DOWN')) fail('the public page does not show the outage');
  await until(async () => ((await openOf('RELAY_WAN_DOWN'))?.ladder.length ?? 0) >= 2, 25_000, 'the unacknowledged alert climbing the ladder');
  const climbed = (await openOf('RELAY_WAN_DOWN'))!;
  await call(`${C}/v1/incidents/ack`, 'POST', { id: climbed.id, by: 'SUP-42' });
  step(`cut: RELAY_WAN_DOWN predicted ${Math.round(numbers.predictedBeforeDownMs / 1000)} s earlier; banner at the seat; unacknowledged, it climbed to ${climbed.ladder.at(-1)!.rung}; acknowledged by SUP-42`);
  await call(`${C}/v1/chaos/wan`, 'POST', { up: true });
  await call(`${C}/v1/chaos/degrade`, 'POST', { on: false });
  await until(() => blue(seatA), 90_000, 'seat A at blue ✓✓ after the link returned');

  // 5. Pull the plug on Data Centre 2 and delete its database.
  const tPlug = Date.now();
  await call(`${C}/v1/chaos/plug`, 'POST', { cell: 'cell-2', wipe: true });
  await until(async () => !!(await openOf('CELL_DOWN')), 15_000, 'the P1 card');
  const p1 = (await openOf('CELL_DOWN'))!;
  if (p1.severity !== 'P1' || p1.blast.cells[0] !== 'cell-2' || p1.blast.centres.length !== onCell2.length || p1.blast.candidates < 1) fail(`the P1 card: ${JSON.stringify(p1)}`);
  step(`P1 "${p1.title}": ${blastText(p1.blast)}`);
  const sentBefore = swarm.stats().sent;
  answer(seatA, 2);
  await Bun.sleep(3_000);
  if (swarm.stats().sent <= sentBefore) fail('candidates stopped answering while cell-2 was down');
  step(`candidates keep answering: the swarm sent ${swarm.stats().sent - sentBefore} more entries while Data Centre 2 was down`);
  await call(`${C}/v1/chaos/restart`, 'POST', { cell: 'cell-2' });
  await until(async () => (await call<FleetView>(`${C}/v1/fleet`)).cells.find((c) => c.id === 'cell-2')?.state === 'LIVE', 180_000, 'cell-2 LIVE again');
  numbers.cell2LiveMs = Date.now() - tPlug;
  await until(async () => !!(await incidents()).find((i) => i.id === p1.id)?.resolvedAt, 60_000, 'the P1 closing');
  const closed = (await incidents()).find((i) => i.id === p1.id)!;
  if (closed.blast.answersLost !== 0) fail(`answers lost: ${closed.blast.answersLost}`);
  step(`Data Centre 2 rebuilt from the relays: LIVE ${Math.round((Date.now() - tPlug) / 1000)} s after the plug; the P1 closed with answers lost 0`);

  // 6. sent = verified = stored, once every simulated candidate has submitted.
  await until(() => swarm!.stats().done >= swarm!.stats().cands, 240_000, 'every simulated candidate submitting');
  const sentNow = async () => swarm!.centres.reduce((n, c) => n + c.ingest.views().reduce((m, v) => m + v.head, 0), 0)
    + (await call<{ streams: { head: number }[] }>(`${R}/v1/heads`)).streams.reduce((m, v) => m + v.head, 0);
  const storedNow = async () => (await call<FleetView>(`${C}/v1/fleet`)).cells.reduce((n, c) => n + c.entries, 0);
  await until(async () => (await storedNow()) === (await sentNow()), 180_000, 'sent = stored');
  numbers.caughtUpMs = Date.now() - tPlug;
  let verified = 0;
  for (const c of X.cells) {
    const exp = await call<ShiftExport>(`${c.url}/v1/shift?exam=${X.exam}&shift=${X.shift}`);
    for (const s of exp.sheets) {
      const v = verifySheet(s, forms, onlyAuthority, verifier, X.cells);
      if (['keys', 'chain', 'bodies'].every((n) => v.checks.find((x) => x.name === n)?.ok)) verified += s.entries.length;
    }
  }
  const sent = await sentNow(), stored = await storedNow();
  if (!(sent === verified && verified === stored)) fail(`sent ${sent} · verified ${verified} · stored ${stored}`);
  step(`sent = verified = stored = ${stored} entries (verified: every chain, key certificate and body checked with only the authority key pinned); lost 0`);

  // 7. Seat A at blue ✓✓, backlog 0 → force-quit → seat B, PIN, the invigilator approves → resumes; seat A returns → ORPHANED.
  await until(() => blue(seatA), 60_000, 'seat A at blue ✓✓, backlog 0');
  const itemsA = seatA.boot().items, activeA = seatA.exam!.activeMs();
  seatA.close();
  const seatB = newSeat('seatB', 'CEN042-S02');
  await seatB.open();
  await until(() => seatB.boot().phase === 'enrol', 15_000, 'seat B loading its package');
  await seatB.enrol({ pin: PIN, operatorId: 'GATE-42-OP7', method: 'aadhaar-face' });
  await until(() => !!seatB.boot().moveable, 15_000, 'seat B refused: bound elsewhere');
  await seatB.handover(PIN);
  const moveKey = seatB.boot().moveKey!;
  const pending = (await call<{ pending: { cand: string; key: string }[] }>(`${R}/v1/handover/pending`)).pending;
  if (!pending.some((p) => p.cand === 'C0001' && p.key === moveKey)) fail('the move is not waiting at the relay console');
  await call(`${R}/v1/handover/approve`, 'POST', { cand: 'C0001', key: moveKey, invigilator: 'INV-42-A' });
  await until(() => seatB.boot().phase === 'exam', 30_000, 'seat B resuming');
  const b = seatB.boot();
  for (const [item, st] of Object.entries(itemsA)) if (b.items[item]?.state !== st.state || b.items[item]?.answer !== st.answer) fail(`${item} did not come back`);
  if (b.activeMs < activeA || b.credited?.approvedBy !== 'INV-42-A') fail(`time or credit: ${JSON.stringify({ activeA, b: b.activeMs, credited: b.credited })}`);
  numbers.moveCreditedMs = b.credited.ms;
  step(`seat B resumed C0001: ${Object.keys(itemsA).length} answers restored, timer ${mmss(b.activeMs)}, +${mmss(b.credited.ms)} credited · approved by INV-42-A`);
  answer(seatB, 2);
  await until(() => blue(seatB), 60_000, 'seat B at blue ✓✓');
  await until(async () => !!(await openOf('HANDOVER', 'C0001')), 15_000, 'the HANDOVER incident');
  const seatA2 = newSeat('seatA', 'CEN042-S01');                                       // seat A's laptop comes back
  await seatA2.open();
  await until(() => seatA2.boot().phase === 'moved', 30_000, 'seat A told it has moved');
  await until(async () => !!(await openOf('ORPHANED', 'C0001')), 15_000, 'the ORPHANED incident');
  const row = (await call<{ rows: TimeRow[] }>(`${C}/v1/time`)).rows.find((r) => r.cand === 'C0001')!;
  if (!row.gaps.some((g) => g.kind === 'handover' && g.approvedBy === 'INV-42-A')) fail(`time audit: ${JSON.stringify(row)}`);
  step('seat A came back: its tail is ORPHANED evidence (not tampering) and it says "moved"; the time audit shows the move, approved');

  // 8. Submit, seal, and /verify the moved candidate with only the authority key (Addendum C.1).
  const rc = seatB.submit();
  if (!rc.ok) fail(rc.error);
  await until(() => blue(seatB), 60_000, 'the submit at the cell');
  await call(`${C}/v1/seal`, 'POST');
  const proof = await call<Proof>(`${C}/v1/proof?cand=C0001`);
  const v = verifyProof(proof, forms, onlyAuthority, rc.receipt.code);
  if (!v.ok) fail(`/verify: ${JSON.stringify(v.checks.filter((c) => !c.ok))}`);
  step(`/verify, pinning only the authority key: ${v.checks.find((c) => c.name === 'keys')!.detail}; receipt ${rc.receipt.code}`);

  // 9. Archive to two stores; purge only after both verify.
  const ar = await call<{ ok: boolean; writtenMs: number; verifyMs: number }>(`${C}/v1/archive`, 'POST');
  if (!ar.ok) fail('the archive did not verify');
  const pg = await call<{ purged: number }>(`${C}/v1/archive/purge`, 'POST');
  Object.assign(numbers, { archiveWriteMs: ar.writtenMs, archiveVerifyMs: ar.verifyMs, purged: pg.purged });
  step(`archived to 2 write-once stores (written ${ar.writtenMs} ms, verified ${ar.verifyMs} ms); relay purged ${pg.purged} entries on a signed order`);

  // 10. Rogue insider → audit → TAMPER → the regulator rung drafts CERT-In.
  await call(`${C}/v1/rogue`, 'POST', { cand: 'C0001', q: 1, answer: 'D' });
  await call(`${C}/v1/audit`, 'POST');
  await until(async () => !!(await openOf('TAMPER', 'C0001'))?.certIn, 40_000, 'TAMPER reaching the regulator rung');
  const t = (await openOf('TAMPER', 'C0001'))!;
  const draft = await fetch(`${C}/v1/incidents/certin?id=${t.id}`).then((r) => r.text());
  if (!draft.includes('DRAFT TEMPLATE')) fail('no CERT-In draft');
  step(`TAMPER (P0) for C0001 climbed to the regulator; the CERT-In 6-hour report draft is at ${t.certIn}`);

  // 11. Notices and the public page: approve one; no PII anywhere on it.
  const { drafts } = await call<{ drafts: Notice[] }>(`${C}/v1/notices`);
  if (!drafts.length) fail('no notice drafted');
  await call(`${C}/v1/notices/approve`, 'POST', { id: drafts[0].id, by: 'CONTROL-1' });
  const pub = await call<PublicStatus>(`${C}/v1/status/public`);
  if (!pub.notices.length || /C0\d{3}|INV-42-A|SUP-42|CEN042-S0|CONTROL-1/.test(JSON.stringify(pub))) fail('the public page: no notice, or PII');
  step(`notice ${drafts[0].id} approved and sent to the outbox (mock); the public page shows it, with no PII`);

  console.log(`ACT3-NUMBERS ${JSON.stringify({ ...numbers, host: `${process.platform}-${process.arch}`, candidates: swarm.stats().cands + 1 })}`);
  console.log('PASS');
} finally {
  for (const s of seats) { try { s.close(); } catch { /* closed already (the force-quit) */ } }
  await swarm?.stop();
  await stack?.stopAll();
  rmSync(dir, { recursive: true, force: true });
}
```
Everything the script asserts goes through a public route or the seat's own API. It never reaches into a process.

- [ ] **Step 2: Run it** (unsandboxed; it needs ports and uv)

Run: `bun tools/act3.ts`
Expected: eleven `✓` lines, then `ACT3-NUMBERS {…}` and `PASS`, in about 3–5 minutes on this Mac. If `SYNC_LAG` does not appear within 120 s, check that seat A keeps answering during the degrade (the backlog must grow) before touching any thresholds.

- [ ] **Step 3: CI — `.github/workflows/server.yml`**

Raise `timeout-minutes` to `40` and add after the Act 2 step:
```yaml
      - name: Chaos (three runs, one per scenario; the 20-run exit check is logged locally)
        run: bun tools/chaos.ts --runs 3
      - name: Act 3 end to end (degrade → SYNC_LAG → cut → pull the plug → rebuild → move by PIN → archive → CERT-In)
        run: bun tools/act3.ts
```
`windows.yml` needs no change. It runs `pnpm -r test`, which now includes the Stage 4 unit tests; they avoid read-only files on Windows and close every DB before deleting.

- [ ] **Step 4: Verify CI**

Push the branch (the controller does this) and watch both workflows: `gh run watch` for `server` and `windows`. Both must be green before Task 18.

---

### Task 18: Stage 4 exit check, the claims ledger, the threat model, and the Act 3 demo

**Files:**
- Create: `docs/evidence/stage4-chaos.jsonl`, `docs/evidence/stage4-act3.txt`, `docs/evidence/stage4-*.png`, `docs/evidence/stage4-certin.html`
- Modify: `docs/claims-ledger.md`, `docs/threat-model.md`
- Update: the memory file `saakshi-hackathon-plan.md`

**Interfaces:**
- Consumes: everything above.
- Produces: the evidence the user reviews before Stage 5.

- [ ] **Step 1: Exit check** (unsandboxed)

```bash
pnpm -r test && pnpm -r typecheck
bun test --timeout 60000 apps/server
bun tools/chaos-kill.ts && bun tools/act4.ts && bun tools/act2.ts
rm -f docs/evidence/stage4-chaos.jsonl
bun tools/chaos.ts --runs 20 --out docs/evidence/stage4-chaos.jsonl | tail -3
bun tools/act3.ts | tee docs/evidence/stage4-act3.txt
```
Expected: everything passes. `chaos.ts` prints 20 `CHAOS` lines, each with `"lost":0,"rpo":0,"ok":true`, then `CHAOS-SUMMARY {"runs":20,"ok":true,"lost":0,"rtoMs":{…}}` and `PASS`. `act3.ts` prints `PASS`.

These are the Stage 4 exit tests, by name:
- **lost = 0 on every run, with the RTO logged:** `docs/evidence/stage4-chaos.jsonl` (20 runs: kill-cell, wipe-cell and spare-relay, 7 or 6 each).
- **Handover tests pass:**
  - `addendum-c.test.ts` (C.1–C.5, and the Stage 3 fix);
  - `handover.test.ts` (PIN + invigilator, Review Focus #3, refusals, the old-key path);
  - `relay-handover.test.ts`;
  - `ingest-stage4.test.ts` "Review Focus #2";
  - `exam-stage4.test.ts`;
  - `move.test.ts`;
  - `act3.ts` step 7.

- [ ] **Step 2: Start the demo stack on a clean slate**

The controller or the user runs these commands outside the sandbox. Keep the stack's terminal visible: it prints `PLUG PULLED`, `WAN DEGRADED`, `HANDOVER-REQUEST`, `HANDOVER-GRANTED`, `PURGED` and `ROGUE` from each node.
```bash
bun tools/reset.ts --seat
[ -f data/g1/cohort.jsonl ] || uv run --directory analytics python -m saakshi_analytics.generate "$PWD/data/g1"
bun tools/provision.ts --out data/exam --cohort data/g1/cohort.jsonl --demo
bun tools/package.ts --exam data/exam | tee data/exam/PACKAGER-OUTPUT.dev.txt      # DEV only: a real packager prints the passphrases once, on paper
bun tools/stack.ts --exam data/exam --data data --cohort data/g1/cohort.jsonl --speed 20      # its own terminal
```
Browser tabs:
- `http://127.0.0.1:7090/control`
- `http://127.0.0.1:7090/custodian` (two tabs)
- `http://127.0.0.1:7090/status`
- `http://127.0.0.1:7070/console`

Release the paper as in Stage 3 (NTA and NIC in the two custodian tabs).

Seat A, in a separate terminal, is the in-process seat: no Electron, no camera, no keychain.
```bash
bun tools/seat-cli.ts --cand C0001 --seat CEN042-S01 --dir data/seats/S01 --answers 8
```
(Optional, for the on-screen seat: `(cd apps/seat && pnpm pack:mac)`, then `open apps/seat/release/mac-arm64/Saakshi.app --args --relay http://127.0.0.1:7070 --cand C0001 --seat CEN042-S01 --test-mode --no-camera`. It always runs in test mode with the camera off, and the step ends with `pkill -f 'Saakshi.app/Contents/MacOS/Saakshi'`.)

- [ ] **Step 3: Act 3, step by step** (browser + curl)

1. **Degrade.** On `/control`, press **"Degrade Centre 42's link"** (or `curl -s -X POST localhost:7090/v1/chaos/degrade -H 'content-type: application/json' -d '{"on":true}'`). Within about 30 s a **P2 "WAN failure likely at CEN042 (predicted)"** card appears, and the link line gives the reasons. Check it with `curl -s localhost:7090/v1/link | jq '{risk, reason, cut}'`, which shows `"risk":"warn","cut":false`. Take a screenshot and save it as `stage4-synclag.png`.
2. **Cut.** Press **"Cut Centre 42's link"**. A **RELAY_WAN_DOWN** card opens: "predicted N s earlier" is in `curl -s localhost:7090/v1/incidents | jq '.incidents[] | select(.kind=="RELAY_WAN_DOWN") | .data.warnedMs'`. The seat's banner status is `curl -s localhost:7070/v1/status`. `/status` shows "Centre CEN042 has lost its network link…" in EN, and in HI after the toggle.
3. **The ladder.** Do not acknowledge. After 10 s the card reads `invigilator · [superintendent] · control · regulator`. Type `SUP-42` in "Acknowledge as" and press **Acknowledge**; the timer line changes to "acknowledged by SUP-42". Take a screenshot: `stage4-ladder.png`. Then press **Restore Centre 42's link** and **Stop degrading**.
4. **Pull the plug.** Press **"Pull the plug on Data Centre 2 (and delete its database)"**. The stack terminal prints `[cell-2] PLUG PULLED (SIGKILL); deleted …/cell-2.db`. A **P1** card appears: "Data Centre 2 is down — 1 cell · 33 centres · ≈6,600 candidates · answers lost: not known yet". Entries/s keeps climbing, because the swarm's relays keep acking. Take a screenshot: `stage4-p1.png`.
5. **Restart.** Press **"Restart Data Centre 2"**. The card reads "rebuilding from the relays — k of 33 relays have replayed", then closes with **answers lost 0**. Check with `curl -s localhost:7090/v1/fleet | jq '[.cells[] | {id, state, entries}]'`. Take a screenshot: `stage4-rebuilt.png`.
6. **The move.** Wait until seat A's `SEAT` lines show `"cell"` equal to `"local"` (blue ✓✓, backlog 0), then press Ctrl-C in seat A's terminal (the force-quit). Start seat B: `bun tools/seat-cli.ts --cand C0001 --seat CEN042-S02 --dir data/seats/S02 --move --answers 2`. It prints `MOVE-KEY 1a2b…`. On `/console`, type `INV-42-A`, compare the key and press **"Approve the move of C0001"**. The console says "Moved: the new seat continues from entry N … +m:ss credited, approved by you". Seat B's `SEAT` lines show `"phase":"exam"` and `"credited":{…"approvedBy":"INV-42-A"}`. A **HANDOVER** P3 card appears on `/control`, and the time audit row for C0001 shows "moved (pin) … ✓ INV-42-A". Take screenshots: `stage4-console-move.png`, `stage4-time-audit.png`.
7. **Seat A comes back.** Run `bun tools/seat-cli.ts --cand C0001 --seat CEN042-S01 --dir data/seats/S01`. Its `SEAT` lines turn to `"phase":"moved"`, and an **ORPHANED** P3 card appears ("its entries after the move are kept as evidence"). Press Ctrl-C.
8. **Archive.** Press **Seal the shift**, then **Archive the sealed shift to both stores**: both lines are ✓. Then press **Purge Centre 42's relay**; the stack prints `[relay] PURGED …`. Run `ls -l data/control/worm-a data/control/worm-b` (read-only files).
9. **CERT-In.** Run the rogue insider on C0001 Q1 → D, then **Run the audit**. A **P0 TAMPER** card appears; 10 s later it is at the regulator rung with a "CERT-In report draft (6-hour window)" link. Save the draft as `docs/evidence/stage4-certin.html`.
10. **Comms.** Under "Notices to candidates", press **Approve and send** on the Data Centre 2 notice. `data/control/outbox.jsonl` gains a line, and `/status` lists the notice in EN and HI. Take a screenshot: `stage4-status.png`. `curl -s localhost:7090/v1/status/public | grep -cE 'C0[0-9]{3}|INV-|SUP-|-S0[0-9]'` prints `0`.
11. **/verify.** Once seat B has submitted, open `http://127.0.0.1:7090/verify?cand=C0001`. Every row is green, and the keys row reads "2 key epoch(s) for C0001: certified by cell-1, whose key the exam authority certified". Take a screenshot: `stage4-verify.png`.

- [ ] **Step 4: Clean up**

```bash
pkill -f 'Saakshi.app/Contents/MacOS/Saakshi'          # if the packaged seat was used (camera never on: test mode)
pkill -f 'tools/seat-cli.ts'; pkill -f 'tools/stack.ts'
bun tools/reset.ts
```

- [ ] **Step 5: The claims ledger** (`docs/claims-ledger.md`; update the commit reference at the top)

| # | New status and evidence |
|---|---|
| R1 | Unchanged, plus: **Proven at swarm scale** for a wiped cell serving several relays (`act3.ts` step 5–6; `ingest-stage4.test.ts` "Review Focus #1") |
| R6 | **Proven**: `chaos.ts` spare-relay runs (lost 0), the control button "Replace Centre 42's relay with the spare". Limit: after a *move*, a spare relay cannot refill the entries before the move from the new seat (see threat model) |
| R7 | **Proven**: the P1 card with its blast radius (`incidents.test.ts`, `act3.ts` step 5) |
| R8 | **Measured**: RTO per scenario (p50/max) and RPO = 0 on 20 logged runs, `docs/evidence/stage4-chaos.jsonl` (8 seats × 100 entries, DEV mode, this Mac); swarm-scale rebuild times in `stage4-act3.txt` (`ACT3-NUMBERS`). **Not measured:** RPO/RTO at 20k over a real WAN; power loss |
| R9 | **Proven**: `archive.test.ts`, `ops-routes.test.ts`, `act3.ts` step 9 — two stores, verified against the signed STH, purge only on an authority-signed order after both verify. WORM is **simulated** (write-once, read-only files) |
| R10 | **Proven**: `handover.test.ts`, `relay-handover.test.ts`, `move.test.ts`, `act3.ts` step 7 — PIN + invigilator (3 tries), or the old key's signed claim; answers restored sealed to the new seat; credit measured by the relay's clock |
| T9 | Add: for **enrolled** candidates `/verify` pins only the authority key; the record carries the bind and cell certificates (Addendum C.1; `addendum-c.test.ts`, `verify-certs.test.ts`, `act3.ts` step 8) |
| D15 | **Proven**: `incidents.test.ts` (P0–P3, blast radius, ladder, debounce, CERT-In at the regulator rung), `act3.ts` steps 4, 5, 10. The CERT-In file is a **draft template**, not filed |
| D16 | **Proven on our chaos drill only**: SYNC_LAG warned N s before the cut in `act3.ts` (`ACT3-NUMBERS.predictedBeforeDownMs`); `link.test.ts`. Not validated on real WAN data |
| C4 | **Proven**: the in-exam banner (`exam-state.test.ts`, `move.test.ts`), the public status page with no PII (`status-view.test.ts`, `ops-routes.test.ts`, `act3.ts` step 11), the notice outbox (mock channels). Claude-drafted notices and Tamil: **Planned (Stage 6)** |
| New R11 | Time is credited by the relay's clock, capped at 30 min, two gaps → review, over the cap → re-test eligible; nothing is auto-penalised (`time-audit.test.ts`, `exam-stage4.test.ts`) — **Proven** on synthetic chains |
| New R12 | The hard stop keeps late entries as evidence (LATE), never deletes them (`ingest-stage4.test.ts`) — **Proven** |

- [ ] **Step 6: The threat model** (`docs/threat-model.md` — add these honest limits)

- **Moves:**
  - A PIN move needs the exam server, so it waits for the WAN; the plan's "continue provisionally while restoring" is not built.
  - A PIN guess needs an invigilator's approval each time, and after 3 wrong PINs control must verify the candidate.
  - The relay cannot read the PIN or the restored answers, and cannot forge the grant.
- **Spare relay after a move:** the new seat holds only the entries after `fromSeq`. A spare relay with an empty DB therefore cannot be refilled with the entries before the move from that seat. The cell has them; a relay that pulls a prefix from its cell is later work.
- **rxWall is the relay's claim.** It is unsigned. A lying relay can move credited time and the hard stop within what the seat's signed `activeMs` allows. It cannot change an answer.
- **The hard stop** rejects late entries but keeps them. A seat cut off from its own centre for longer than the gap cap plus the slack will have its late entries held for a human decision.
- **Incidents and chaos:**
  - Incidents live in control's memory and are rebuilt from live state and the cells' evidence; `incidents.json` is a record, not a source.
  - The chaos routes are DEV-only, and the supervisor binds 127.0.0.1.
  - The relay's degrade and purge routes are on the centre LAN. Purge needs an authority signature; degrade is DEV-only.
- **The archive's WORM is simulated.** Production would use object lock or WORM media. Retention and DPDP deletion are not built.
- **SEAT_SILENT and CENTRE_OUTAGE** are evaluated for the relays control can reach (the demo relay). The simulated centres report through their cells only.

- [ ] **Step 7: Update memory and hand over**

- Record in `saakshi-hackathon-plan.md` that Stage 4 is done, with:
  - the `CHAOS-SUMMARY` line;
  - the `ACT3-NUMBERS` line;
  - the CI run links;
  - Addendum C (C.1–C.10);
  - the new tools (`stack.ts`, `chaos.ts`, `reset.ts`, `seat-cli.ts`, `act3.ts`);
  - any deviations.
- Send the user the screenshots, `stage4-chaos.jsonl`, `stage4-act3.txt` and `stage4-certin.html`.

---

## Conflicts, assumptions and deferred work

- **The Stage 3 `/verify` conflict is fixed in Task 1.**
  - For EXAM records, `/verify` now pins only the authority key.
  - It still accepts the DEV fixture keys for DEV-mode records (Act 4 has no certificates), and labels them "pinned DEV keys" (Decision 11).
- **Handover while the WAN is down** (plan §3.2, "the candidate continues and earlier answers show 'safe at exam server, restoring'") is not built.
  - The PIN is checked against the record sealed to the cell, so the move waits for the link (Decision 1).
  - The relay keeps the request and the console says so.
  - Stage 4's spec list does not require this path.
- **The old-key path is protocol, cell and relay only.**
  - The seat has no "move me" button; `handover.test.ts` and `relay-handover.test.ts` exercise the path.
  - A button on the old seat (it would sign the claim for the new seat's key) is left for Stage 5.
  - The credit on this path waits for control's approval, because no invigilator saw it.
- **The gap check runs at control, not at the cell.** Plan §3.6 says "the cell checks"; here control runs it on the cell's export, with the relay's rxWall (Decision 4).
  - The cell does enforce the hard stop.
  - Approvals are control's record: `approvals.jsonl` plus the invigilator's handover approval.
- **"Signed DEMO policy"** (plan §3.10): the ops parameters live in the provisioned directory (`--demo`), which is not itself signed.
  - The per-centre policies are signed but do not carry the ops.
  - Signing the directory, or moving `ops` into the signed policy, is a small later change.
- **Invigilator free-text reports** (Act 3: "lab 2 power gone, 14 seats" → classified and linked) are S3 and belong to Stage 6 (Claude). Stage 4 has no free-text box.
- **The review queue** (plan §3.2, "any change after the handover … highlighted") is the time audit's "changed after the move" column. The full review queue is Stage 5.
- **INTEGRITY_CRITICAL** fires on integrity codes that Stage 5 will emit. Stage 4 tests it with a synthetic event, and the test-mode integrity entry is deliberately not critical.
- **The seat journal wipe** after the relay and cell ack the submit and the shift is archived (plan §3.1) is not built. The relay purge is.
- **KEY_RELEASE_DELAY counts only centres with nothing unlocked** ("locked"), not "partial" ones. Absent candidates would otherwise keep it open forever.
- **Scale:** `act3.ts` runs a small G1 (300 candidates, 6 centres) so CI stays under 40 minutes. The demo stack runs the full G1. Stage 7 measures throughput and RTO at scale.
- **Assumed:** Stage 3 landed as its plan describes (commits `6d1bea4`…`cec0ebb`); `act2.ts`, `swarm.ts` and the EXAM mode in `main.ts` are as read on 2026-09-27.
