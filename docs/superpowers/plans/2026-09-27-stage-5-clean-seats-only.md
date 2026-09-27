# Stage 5 — "Clean seats only" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Act 1 works end to end. Every seat passes a signed integrity gate before it starts, and the same probes keep watching during the exam.
- The **readiness board** in `/control` shows each centre's seats as green / amber / review / blocked. Centre 42 shows **amber** because one seat is on battery.
- Seat A runs `AnyDesk` and `overlay-sim` (a capture-excluded window). The gate **BLOCKS and names both**: "AnyDesk (remote access) · overlay-sim (hidden from screen capture)". Once they are closed, the seat is re-checked and turns **green**.
- NVDA (Windows) or VoiceOver (macOS) is running on a seat whose signed accommodation lists it, and it is **allowed**. A scribe seat expects **2 faces**.
- During the exam a probe runs every 10 s. A new finding becomes an `integrity` journal entry and, for critical codes, an `INTEGRITY_CRITICAL` incident that names the tool. The candidate is **never auto-submitted and never locked out**.
- Face presence produces flags: no face for 10 s, or more faces than expected in 3 of 5 samples. Each flag carries **one** 160×120 thumbnail, sealed to control's review key. The flag appears in the **review queue**, where a human clears or confirms it. Thumbnails are deleted after 30 days.
- Each answer entry carries a **pointer-provenance** summary (S5). The seat's own egress is limited to an **allowlist**, and machine-wide egress outside it is flagged for review.
- In the **release build** (fused), `--inspect` is ignored, `--remote-debugging-port` makes the app exit, a second instance quits, and devtools cannot be opened. A separate **e2e build** (fuses off) exists for Playwright.
- Exit check: the Windows CI gate self-test **BLOCKs a renamed `AnyDesk.exe` (a copy of notepad) plus overlay-sim, naming both**; the fused-build smoke test passes; Playwright e2e passes; `bun tools/act1.ts` passes in CI with the camera off.

**Architecture:**
- **Addendum D (Task 1)** is the only protocol change. It covers the integrity section of the signed per-centre policy, per-candidate accommodations, the finding body convention, the signed readiness report, the signed face flag with its sealed thumbnail, and the provenance slot in the answer meta. It is additive only (`V` stays 1) and comes with vectors.
- **Seat:** `probe-host.ts` collects a `ProbeSnapshot` (processes with macOS bundle IDs, capture-excluded windows via koffi on both OSes, remote session, VM signals, displays, battery, disk, clock skew, egress). `integrity.ts` is a **pure** evaluator: snapshot + policy + accommodation → findings → verdict. `gate.ts` runs it before start (a block refuses `start()`) and every `probeMs` during the exam. It journals new findings, signs readiness reports to the relay, and turns `face.ts` (pure `FaceMonitor`) flags into sealed face flags.
- **Relay:** `relay-integrity.ts` checks each readiness report and face flag against the seat's bound key, keeps the latest readiness per candidate, and keeps face flags in an append-only `faces.jsonl`.
- **Control:** `integrity-routes.ts` polls the relay. `readiness-view.ts` (pure) builds the board. `review.ts` is the review queue: it opens thumbnails with the review key, records decisions, and purges after `retentionMs`. The cell already turns `integrity` entries into `INTEGRITY` events. Task 9 carries the level and names into the event, so the incident names the tool.
- **Electron:** `hardening.ts` (pure) decides launch refusals and window options. `index.ts` applies them: single-instance lock, argv refusal, devtools block, kiosk / fullscreen / `alwaysOnTop('screen-saver')` in exam mode, `setContentProtection` on Windows only, and a renderer egress block. It adds `--gate-selftest`, `--overlay-sim` and `--fuse-check`. The build-time flag `SAAKSHI_E2E=1` produces the unfused e2e build.

**Tech Stack:** TypeScript on Node 25 and Bun 1.3.14; Electron 44; koffi (already a dependency: `user32.dll`, and on macOS CoreGraphics / CoreFoundation); React 19; MediaPipe (already bundled); `@noble/*` via core. **One new dev dependency:** `playwright-core` in `apps/seat` (Electron driver only; no browser download). Only Task 1 runs `pnpm`.

**Spec:**
- `docs/plan.md` §3.4 (integrity policy), §3.5 (face presence), §3.10 (INTEGRITY_CRITICAL), §3.11 (review queue, readiness), §5 "Stage 5", §6 Act 1, §8 risks 1–2, §9 (CI on windows-latest, Playwright). MoSCoW: M4, S5, and M8 (review queue, readiness).
- `docs/protocol-v1.md` is **frozen**. Task 1 appends **Addendum D** (§17).
- Open limits taken from `docs/threat-model.md` and `docs/claims-ledger.md` P6, P8, P9 and C3 (all "Planned (Stage 5)"). The macOS `kCGWindowSharingState` probe also closes the threat-model row "Capture-excluded window — macOS: Stage 5".

## Decisions (open questions, settled)

1. **The gate runs after enrolment** (the `locked` and `ready` phases) because readiness reports are signed with the bound seat key. A seat that is not enrolled does not appear on the board. The invigilator's check-in is the earlier gate.
2. **Only `block` refuses `start()`.** `review` and `amber` let the candidate start. The board shows them, and review findings are journaled when the exam starts.
3. **During the exam nothing blocks.** New findings are journaled, never enforced (plan §3.4). The critical codes (`OPS.criticalIntegrity`: remote-session, capture-excluded, blocklisted, vm) become P1 INTEGRITY_CRITICAL incidents through the existing cell-events path.
4. **The integrity policy is part of the signed per-centre policy** (`Policy.integrity`), so the existing signature covers it. A policy without it is the Stage 3/4 format. The seat then uses `INTEGRITY_DEFAULT` and adds the review finding `policy-default`. It never fails open silently.
5. **Assistive technology is always allowed.** It becomes an `info` finding naming it. A capture-excluded window that belongs to an assistive tool is exempt **only** if the candidate's signed accommodation lists that tool (Windows Magnifier is the case). Otherwise it is `capture-excluded`, which blocks.
6. **Matching is by name**: basename without `.exe`, lowercase; on macOS also `CFBundleIdentifier` of the running `.app`. Honest limit: a renamed binary evades it, and the CI test proves exactly that name matching works (a renamed notepad *is* "AnyDesk").
7. **The VM score** counts signal classes: hypervisor flag, VM model, BIOS / ioreg strings, a VM MAC prefix (excluding `00:15:5d` Hyper-V), and a guest-tools process. A score of 2 or more blocks; 1 is review. CPUID is not used. GitHub's windows-latest runner is itself a VM, so the CI gate self-test asserts **names**, not the whole verdict.
8. **Face flags go to control, not the cell.** The thumbnail is sealed (B.4) to control's **review key** (`control/review.key.json`, whose public half is `Policy.integrity.reviewPub`). The journal gets an `integrity` entry carrying `thumbHash`, so the flag is bound to the chain while the image stays outside it.
9. **Overlay-sim is the seat binary itself** (`Saakshi --overlay-sim`): a small window with `setContentProtection(true)`. On Windows it is copied to `overlay-sim.exe` in the same folder, so its process name is `overlay-sim`. On macOS, `tools/overlay-sim.sh` launches a renamed copy of the app. No new native helper.
10. **Automated checks never turn on a camera.** `tools/act1.ts` drives in-process `Seat`s with an injected `collect()` and synthetic face samples. Playwright launches the e2e build with `--test-mode --no-camera --use-fake-device-for-media-stream`.

## Protocol Addendum D (Task 1 appends it to `docs/protocol-v1.md` as §17)

Additive only: no byte defined in §1–§16 changes, so `V` stays 1. Vectors: `fixtures/vectors/protocol-v1-addendum-d.json`.

| # | Addendum | Why |
|---|---|---|
| D.1 | `Policy.integrity` (optional, inside the signed text): `{v:1, blocklist: ToolRule[], assistive: ToolRule[], guestTools, vmMacPrefixes, vmStrings, egress: string[] ("host:port"), probeMs, blurMs, face: {noFaceMs, window, over}, amber: {minFreeBytes, maxSkewMs}, reviewPub (130 hex), retentionMs}`, `ToolRule = {name, procs: string[], bundleIds: string[]}`. `RosterEntry.acc` (optional): `{faces?: number, assistive?: string[]}` (names of `assistive` rules) | Plan §3.4 "signed; the client rejects unsigned policy"; accommodations |
| D.2 | Finding convention (not checked): an `integrity` body is `["body","","","",[code,level,detail,names]]`, `level ∈ {block, review, amber, info}`, `names` an array of strings. `test-mode` (B.9) keeps its two-element meta | The cell, audit and incidents can name the tool |
| D.3 | Readiness report `["readiness",exam,shift,attempt,cand,seatId,keyEpoch,at,verdict,findingsHash]`, signed (A.1 style) by the seat key of `keyEpoch`; `findingsHash = hex(SHA-256(UTF-8(canon(["findings",[meta…]]))))` over the D.2 metas in report order | The board cannot be forged by the LAN |
| D.4 | Face flag `["face",exam,shift,attempt,cand,seatId,at,code,faces,expected,thumbHash]`, signed by the seat key; `code ∈ {face-none, face-extra}`; thumb = a B.4 box to `reviewPub`, `info = ["saakshi-face",1,exam,shift,attempt,cand,at]`, `pt` a JPEG ≤ 160×120; `thumbHash = hex(SHA-256(box))`, or `""` with no box | Plan §3.5 "one thumbnail, encrypted to control" |
| D.5 | Provenance (not checked): the second meta slot of `answer` / `mark` / `clear` bodies (already `[]`) may be `["prov",moves,pathPx,clicks,keys,untrusted,lastMoveMs]` (non-negative integers) | S5 pointer-path provenance, inside the sealed body |

## Global Constraints

**Protocol and code reuse**
- Protocol v1 is frozen. All hashing, signing and sealing goes through `packages/core`. Task 1 is the only task that edits `packages/core/src/*` or `apps/seat/src/shared/ipc.ts` / `preload/index.ts`. A task that believes it must change them **stops and reports**.
- **Browser-safe core:** `integrity.ts` imports only `bytes.ts`, `canon.ts`, `box.ts`, `protocol.ts` types and `@noble/hashes`. `readiness-view.ts` and `control-view.ts` are browser-safe (bundled into `/control`).
- **Name clash:** core already has `Finding` (audit, `sheet.ts`). The Stage 5 type is **`IntegrityFinding`**, always.
- Reuse what exists: `sealBox`/`openBox`, `msg`, `signer`/`verifier`, `nobleVerifier`, `Bindings.get`, `probe`/`run`, `parsePs`, `parseTasklistCsv`, `ExamSession.#append` (through a new `note()`), `Seat`, `Stack`/`demoSpecs`, `provision`, `buildPackage`, `call`/`until`/`freePort`, `incidentCard`, `typeScaleOk`.
- **Imports:** core as `@saakshi/core/<module>` in apps; tools by relative path. Relative TS imports carry `.ts`. No barrel files.
- **TypeScript:** `erasableSyntaxOnly`: no enums, namespaces or parameter properties.
- **Dependencies:** only `playwright-core` (Task 1). pnpm only as `pnpm … --config.confirm-modules-purge=false </dev/null`.

**Shared types (Task 1; exact names)**

```ts
// core/integrity.ts (browser-safe)
type Level = 'block' | 'review' | 'amber' | 'info'
type FindingCode = 'blocklisted'|'capture-excluded'|'remote-session'|'vm'|'vm-signal'|'displays'|'no-camera'|'probe-unknown'|'egress'
  |'battery'|'disk'|'clock-skew'|'blur'|'face-none'|'face-extra'|'assistive'|'test-mode'|'policy-default'
interface IntegrityFinding { code: FindingCode; level: Level; detail: string; names: string[] }
type Verdict = 'green' | 'amber' | 'review' | 'block';  verdictOf(fs): Verdict
interface ToolRule { name; procs: string[]; bundleIds: string[] }
interface IntegrityPolicy { v: 1; blocklist: ToolRule[]; assistive: ToolRule[]; guestTools: string[]; vmMacPrefixes: string[]; vmStrings: string[];
  egress: string[]; probeMs; blurMs; face: { noFaceMs; window; over }; amber: { minFreeBytes; maxSkewMs }; reviewPub: string; retentionMs }
interface Accommodation { faces?: number; assistive?: string[] }
INTEGRITY_DEFAULT: Omit<IntegrityPolicy, 'reviewPub' | 'egress'>;  integrityOf(p?: IntegrityPolicy): { pol: IntegrityPolicy; defaulted: boolean }
findingMeta(f): Canon[]; findingFromMeta(meta: Canon[]): IntegrityFinding | undefined; findingsHash(fs): string; findingKey(f): string
interface Readiness extends Ctx { seatId; keyEpoch; at; verdict: Verdict; findings: IntegrityFinding[] }; readinessArray(r): Canon[]
interface SignedReadiness { r: Readiness; sig: string }
interface FaceFlag extends Ctx { seatId; at; code: 'face-none'|'face-extra'; faces; expected; thumb: string; thumbHash: string }
faceArray(f): Canon[]; faceInfo(c, at): Canon[]; sealThumb(reviewPub, c, at, jpeg, k?): string; openThumb(priv, c, at, box, k?): Uint8Array
interface SignedFace { f: FaceFlag; sig: string }
interface ProvSummary { moves; pathPx; clicks; keys; untrusted; lastMoveMs }; provArray(p?): Canon[]
// core/policy.ts:  Policy.integrity?: IntegrityPolicy;  RosterEntry.acc?: Accommodation
// core/wire.ts:    LIMITS.thumb = 40_000 (hex chars); parseSignedReadiness(x): SignedReadiness; parseSignedFace(x): SignedFace
// core/directory.ts: FILES.reviewKey = 'control/review.key.json'
// seat shared/ipc.ts
interface GateView { verdict: Verdict; findings: IntegrityFinding[]; checkedAt: number }
ExamBoot.gate?: GateView; ExamBoot.faces?: number   // expected faces
interface FaceSample { faces: number; at: number; thumb?: string /* base64 JPEG, only when faces !== expected */ }
Action.prov?: ProvSummary
SeatApi.recheck(): Promise<GateView>; SeatApi.faceSample(s: FaceSample): void; SeatApi.blur(ms: number): void
```

**HTTP routes (new)**

| Mode | Route | Request | Response |
|---|---|---|---|
| relay | `POST /v1/readiness` | `SignedReadiness` | `200 {ok:true}`; `400 {error}`; `403 {error:'unknown seat key'}` |
| relay | `GET /v1/readiness` | — | `{at, seats: SignedReadiness[]}` (latest per candidate) |
| relay | `POST /v1/faces` | `SignedFace` | `200 {id}` (idempotent on `cand`+`at`); `400`; `403` |
| relay | `GET /v1/faces?after=` | — | `{flags: (SignedFace & {id})[], last}` (≤ 200) |
| control | `GET /v1/readiness` | — | `ReadinessBoard` |
| control | `GET /v1/review` | — | `{items: ReviewItem[]}` (open first; thumbnails as `data:image/jpeg;base64,…`) |
| control | `POST /v1/review/decide` | `{id, decision: 'cleared'\|'confirmed', by}` | `ReviewItem`; `404`; `400` |

**Environment**
- Seat: `--gate-selftest [--expect a,b] [--out f]`, `--overlay-sim`, `--fuse-check --out f`, and the existing `--test-mode` / `--no-camera`. The build-time env `SAAKSHI_E2E=1` (electron-vite `define __SAAKSHI_E2E__`).
- Control: the review key from `<EXAM>/control/review.key.json`.

**Rules**
- The seat never auto-submits and never locks out a candidate who has started. `start()` is refused only by a `block` verdict before start.
- Every finding carries a **word** (its level) and the **names** involved. The UI never shows a colour alone.
- **Honest claims** (use these words): "deterrence and detection, not lockdown"; "matched by process name and macOS bundle ID; a renamed tool evades name matching"; "setContentProtection is claimed for Windows only; on macOS 15+ we claim nothing"; "the VM score is a heuristic; a determined attacker can defeat it"; "face *presence*, not recognition; no video; one thumbnail per flag, deleted after 30 days"; "provenance is recorded for analysis; injected input from remote tools is usually `isTrusted`". Banned words: "tamper-proof", "lockdown" on its own, "time-lock", "blockchain", "proctoring AI".

**Camera and test mode in automated checks** (the user's requirement: the webcam must not stay on)
- `--test-mode` / `SAAKSHI_TEST_MODE=1` and `--no-camera` keep getUserMedia and MediaPipe off (Stage 4 behaviour). No automated check launches the packaged app without `--test-mode --no-camera`.
- Every manual step that launches the app ends with `pkill -f 'Saakshi.app/Contents/MacOS/Saakshi'` (the face check holds the camera).
- `tools/act1.ts` uses in-process seats with an injected `collect()` and synthetic `FaceSample`s.

**UI pages:** type scale `0.8 / 1 / 1.25 / 1.563 / 1.953 / 2.441 rem`; AA contrast; native labelled controls; `:focus-visible { outline: 3px solid #1565c0; outline-offset: 2px }`; buttons at least 2.75rem. Levels: block `#8c1d18` on `#fce8e6` "Blocked"; review `#0b3d91` on `#e8f0fe` "Review"; amber `#7a4100` on `#fef7e0` "Amber"; green `#0d652d` on `#e6f4ea` "Ready". Untrusted strings are rendered with `textContent` only.

**Environment gotchas** (carried over from Stages 2–4)
- **Sandbox:** blocks `.git` writes, `open`, local port binding and launching packaged apps. Server tests in this plan call route handlers directly, so they run sandboxed. `tools/act1.ts`, `apps/seat/e2e/*` and `main.test.ts` need `dangerouslyDisableSandbox: true`.
- **Tests:** `assert.throws(fn, /re/)`; never `assert.throws(fn, undefined, msg)`. Server tests use `bun test --timeout 60000`. Windows CI runs `pnpm -r test`: build paths with `join`, close DB handles before removing temp dirs.
- **Module format:** `apps/seat` bundles main as CommonJS: no top-level `await`, no `__dirname` in test/lib files. koffi is loaded **only** through a dynamic `import()` behind a platform check (`probes-win.ts`, `probes-mac.ts`), so `node --test` on the other OS never loads it.
- **Injected clocks:** `now` everywhere; nothing random or time-based without injection.
- **Commits:** agents share one working tree, touch only the files their task lists, and **do not commit**. The controller reviews and commits each task.

## Review Focus

These are the five likeliest real-world failures. Each is pinned by a named test in the task that owns the code.

1. **A probe hangs or fails** (tasklist times out on a loaded PC, koffi cannot load, `netstat` is missing, `ioreg` is slow).
   - Expected: that probe is `unknown` → a `review` finding named `probe-unknown: <probe>`; the other probes still run; the gate **never** turns green on missing data and never blocks on missing data alone; the whole check returns within `probeMs`.
   - Pinned in Task 4: "Review Focus #1: an unknown probe is review, never green and never block"; in Task 13: "Review Focus #1: a hanging collect() times out; the gate reports probe-unknown and keeps monitoring".
2. **The same finding every 10 s** (AnyDesk stays open during the exam).
   - Expected: **one** `integrity` entry per distinct finding (code + sorted names) until it clears, then a new one if it comes back; the relay and board see the latest state; no journal storm; no second incident.
   - Pinned in Task 13: "Review Focus #2: a persistent finding is journaled once; cleared and back is journaled again".
3. **Assistive technology looks like an overlay** (Windows Magnifier is capture-excluded; NVDA runs alongside).
   - Expected: with the candidate's signed accommodation, the tool is `info: assistive` and the seat is green; **without** it, a capture-excluded Magnifier blocks, and NVDA alone is still allowed; a scribe seat does not flag 2 faces.
   - Pinned in Task 4: "Review Focus #3: accommodated Magnifier is allowed; unaccommodated capture-excluded Magnifier blocks; NVDA alone is info"; in Task 5: "a scribe seat (expected 2) flags only at 3 faces".
4. **Face flapping and flag floods** (the candidate looks down, leans out of frame for 9 s, a passer-by walks behind).
   - Expected: no flag under 10 s; one flag per episode, not one per sample; 3-of-5 for extra faces, so one stray sample does nothing; a flag without a frame still goes through (`thumb ''`); a flag made while the relay is down is retried, not lost.
   - Pinned in Task 5: "Review Focus #4: 9.5 s without a face is nothing; 10 s is one flag; a whole episode is one flag"; in Task 13: "Review Focus #4: a face flag is retried until the relay takes it".
5. **A forged or replayed report** (a LAN peer posts "green" for a blocked seat, or replays an old report).
   - Expected: the relay accepts a readiness report only under the seat's bound key for that epoch, keeps only a newer `at` per candidate, and rejects a face flag whose `thumbHash` does not match its box.
   - Pinned in Task 7: "Review Focus #5: a report signed by another key is 403; an older report does not replace a newer one; a bad thumbHash is 400".

## Parallelism map

```
T1 Addendum D + types + dep ─┬─► T2 probe parsers ─────────┐
                             ├─► T3 macOS capture probe ───┤
                             ├─► T4 evaluator ─────────────┼─► T13 seat gate/monitor ─┐
                             ├─► T5 face monitor ──────────┘                          ├─► T15 Electron wiring ─┐
                             ├─► T6 hardening + e2e build ────────────────────────────┘                       │
                             ├─► T7 relay integrity routes ───────────────────────┐                           │
                             ├─► T8 review queue + board ──► T14 control routes ──┼─► T16 server wiring ──────┼─► T17 act1 + CI ─┐
                             ├─► T9 ingest names + incident title ────────────────┘                           │                  ├─► T19 exit check
                             ├─► T10 seat renderer ───────────────────────────────────────────────────────────┤                  │
                             ├─► T11 control UI ──────────────────────────────────────────────────────────────┤                  │
                             └─► T12 provision ───────────────────────────────────────────────────────────────┴─► T18 Windows CI + Playwright ┘
```

| Wave | Tasks | Notes |
|---|---|---|
| 1 | T1 | Addendum D, shared types, `playwright-core`. Everything depends on it. |
| 2 | T2, T3, T4, T5, T6, T7, T8, T9, T10, T11, T12 | Eleven agents on disjoint files. T4 codes against the `ProbeSnapshot` type in its own file; T2/T3 produce values of it. |
| 3 | T13 (T2–T5), T14 (T8) | Seat main vs control server files: disjoint. |
| 4 | T15 (T6, T13), T16 (T7, T9, T14) | `apps/seat/src/main/index.ts` vs `apps/server/src/main.ts`. |
| 5 | T17 (T12, T15, T16), T18 (T6, T15) | `tools/act1.ts` + `server.yml` vs `windows.yml` + `apps/seat/e2e`. Need ports (unsandboxed). |
| 6 | T19 | Exit check, ledger, threat model, detection matrix, demo notes. |

## Task table

| # | Task | Model | Files (create / modify; tests) |
|---|---|---|---|
| 1 | Addendum D, shared types, playwright-core | opus | core `integrity.ts` (new), `policy.ts`, `wire.ts`, `directory.ts`; seat `shared/ipc.ts`, `preload/index.ts`, `package.json`; `pnpm-lock.yaml`; `tools/gen-vectors-addendum-d.ts`, `fixtures/vectors/protocol-v1-addendum-d.json`; `docs/protocol-v1.md`; test `core/test/addendum-d.test.ts` |
| 2 | Probe parsers (netstat, BIOS, ioreg, MACs, policy blocklist) | sonnet | seat `probe-parse.ts`; test `probe-parse.test.ts` |
| 3 | macOS capture-excluded windows (koffi CoreGraphics) | opus | seat `probes-mac.ts` (new); test `probes-mac.test.ts` |
| 4 | The pure evaluator and VM score | sonnet | seat `integrity.ts` (new); test `integrity.test.ts` |
| 5 | The pure face monitor | sonnet | seat `face.ts` (new); test `face.test.ts` |
| 6 | Hardening decisions and the e2e build | sonnet | seat `hardening.ts` (new), `electron-builder.e2e.yml` (new), `electron.vite.config.ts`, `package.json` (scripts); test `hardening.test.ts` |
| 7 | Relay: readiness and face flags | sonnet | server `relay-integrity.ts` (new); test `relay-integrity.test.ts` |
| 8 | Control: review queue and readiness board (pure + fs) | sonnet | server `review.ts`, `readiness-view.ts` (new); tests `review.test.ts`, `readiness-view.test.ts` |
| 9 | Integrity evidence carries level and names; incident names the tool | haiku | server `ingest.ts` (one line), `incidents.ts` (one line); test `ingest-stage5.test.ts` |
| 10 | Seat screens: gate panel, re-check, face samples, provenance, i18n | sonnet | renderer `Gate.tsx`, `App.tsx`, `FaceChip.tsx`, `provenance.ts` (new), `i18n.ts`, `styles.css`; test `provenance.test.ts` |
| 11 | Control UI: readiness board and review queue | sonnet | server `control.html`, `control-page.ts`, `control-view.ts`; test `control-view.test.ts` |
| 12 | Provision: integrity policy, review key, accommodations | sonnet | `tools/provision.ts`; test `apps/server/test/provision.test.ts` |
| 13 | Seat gate and monitor; probe host; selftest; exam provenance | opus | seat `probe-host.ts`, `gate.ts` (new), `probes.ts`, `seat.ts`, `exam.ts`; test `gate.test.ts` |
| 14 | Control integrity routes and polling | sonnet | server `integrity-routes.ts` (new); test `integrity-routes.test.ts` |
| 15 | Electron wiring: hardening, IPC, self-tests, overlay-sim | opus | seat `index.ts`; `tools/overlay-sim.sh` (new) |
| 16 | Server wiring | sonnet | server `main.ts`; test `main.test.ts` (one case) |
| 17 | Act 1 end to end; CI | opus | `tools/act1.ts` (new); `.github/workflows/server.yml` |
| 18 | Windows CI gate self-test, fused smoke, Playwright e2e | opus | `.github/workflows/windows.yml`; `apps/seat/e2e/seat.e2e.ts` (new), `apps/seat/e2e/stack.ts` (new) |
| 19 | Exit check, ledger, threat model, detection matrix | sonnet | `docs/claims-ledger.md`, `docs/threat-model.md`, `docs/evidence/stage5-*`; memory |

(Server paths are under `apps/server/src` and `apps/server/test`; seat paths under `apps/seat/src/main`, `apps/seat/src/renderer/src` and `apps/seat/test`; core under `packages/core/src` and `packages/core/test`.)

Files touched by more than one task (never in the same wave): `apps/seat/package.json` (T1 → T6), `apps/seat/src/main/seat.ts` and `exam.ts` (T13 only), `apps/server/src/main.ts` (T16 only), `tools/provision.ts` (T12 only).

---

### Task 1: Addendum D, shared types, playwright-core

**Model:** opus

**Files:**
- Create: `packages/core/src/integrity.ts`, `tools/gen-vectors-addendum-d.ts`, `fixtures/vectors/protocol-v1-addendum-d.json` (generated), `packages/core/test/addendum-d.test.ts`
- Modify: `packages/core/src/policy.ts` (types plus `openPolicy` validation), `packages/core/src/wire.ts` (`LIMITS.thumb`, two parsers), `packages/core/src/directory.ts` (`FILES.reviewKey`), `apps/seat/src/shared/ipc.ts`, `apps/seat/src/preload/index.ts`, `apps/seat/package.json` (devDependency), `pnpm-lock.yaml`, `docs/protocol-v1.md` (append §17)

**Interfaces:**
- Consumes: `sealBox`/`openBox`/`nobleBox` (`box.ts`), `canon`, `msg` (`enrol.ts`), `Ctx` (`protocol.ts`).
- Produces: everything in "Shared types" above, with those exact names.

- [ ] **Step 1: Write the failing test** `packages/core/test/addendum-d.test.ts`

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sha256 } from '@noble/hashes/sha2.js';
import { hexToBytes, toHex } from '../src/bytes.ts';
import { canon } from '../src/canon.ts';
import type { KeysFile } from '../src/dev.ts';
import { msg } from '../src/enrol.ts';
import {
  faceArray, findingFromMeta, findingMeta, findingsHash, integrityOf, openThumb, readinessArray, sealThumb, verdictOf, provArray,
  INTEGRITY_DEFAULT, type IntegrityFinding,
} from '../src/integrity.ts';
import { nativeBox, signer, verifier } from '../src/node.ts';
import { nobleVerifier } from '../src/sig.ts';
import { openPolicy, signPolicy, type Policy } from '../src/policy.ts';
import { parseSignedFace, parseSignedReadiness } from '../src/wire.ts';

const json = (f: string) => JSON.parse(readFileSync(new URL(`../../../fixtures/${f}`, import.meta.url), 'utf8'));
const keys = json('keys.json') as KeysFile;
const D = json('vectors/protocol-v1-addendum-d.json');
const seatPub = hexToBytes(keys.seats[0].pub), authPub = hexToBytes(keys.authority.pub);
const ctx = { exam: 'DEMO-2026', shift: 'S1', attempt: 1, cand: 'C0001' };

test('D.3 readiness and D.4 face flag: canonical text recomputes; signatures verify natively and with noble', () => {
  assert.equal(canon(readinessArray(D.readiness.in)), D.readiness.text);
  assert.equal(findingsHash(D.readiness.in.findings), D.readiness.findingsHash);
  assert.equal(canon(faceArray(D.face.in)), D.face.text);
  for (const v of [verifier(seatPub), nobleVerifier(seatPub)]) {
    assert.equal(v(msg(readinessArray(D.readiness.in)), hexToBytes(D.readiness.sig)), true);
    assert.equal(v(msg(faceArray(D.face.in)), hexToBytes(D.face.sig)), true);
  }
});

test('D.4 thumbnail box opens only with the review key and for its own (cand, at)', () => {
  const review = hexToBytes(D.reviewKey.priv);
  assert.deepEqual(toHex(openThumb(review, ctx, D.face.in.at, D.face.in.thumb)), D.face.jpeg);
  assert.equal(toHex(sha256(hexToBytes(D.face.in.thumb))), D.face.in.thumbHash);
  assert.throws(() => openThumb(review, ctx, D.face.in.at + 1, D.face.in.thumb));
  assert.throws(() => openThumb(review, { ...ctx, cand: 'C0002' }, D.face.in.at, D.face.in.thumb));
  const box = sealThumb(hexToBytes(D.reviewKey.pub), ctx, 5, new Uint8Array([1, 2, 3]), nativeBox);
  assert.deepEqual([...openThumb(review, ctx, 5, box)], [1, 2, 3]);
});

test('D.2 finding meta round-trips; test-mode meta is read leniently; verdict orders block > review > amber > green', () => {
  const f: IntegrityFinding = { code: 'blocklisted', level: 'block', detail: 'AnyDesk (pid 4242)', names: ['AnyDesk'] };
  assert.deepEqual(findingFromMeta(findingMeta(f)), f);
  assert.deepEqual(findingFromMeta(['test-mode', 'journal key not in the OS keychain']), { code: 'test-mode', level: 'info', detail: 'journal key not in the OS keychain', names: [] });
  assert.equal(findingFromMeta([]), undefined);
  const mk = (level: IntegrityFinding['level']): IntegrityFinding => ({ code: 'disk', level, detail: '', names: [] });
  assert.equal(verdictOf([]), 'green');
  assert.equal(verdictOf([mk('info')]), 'green');
  assert.equal(verdictOf([mk('amber'), mk('info')]), 'amber');
  assert.equal(verdictOf([mk('amber'), mk('review')]), 'review');
  assert.equal(verdictOf([mk('review'), mk('block'), mk('amber')]), 'block');
});

test('D.5 provenance array; D.1 policy with integrity signs and opens; a missing section is defaulted, not silent', () => {
  assert.deepEqual(provArray(), []);
  assert.deepEqual(provArray({ moves: 3, pathPx: 120, clicks: 1, keys: 0, untrusted: 0, lastMoveMs: 40 }), ['prov', 3, 120, 1, 0, 0, 40]);
  const p: Policy = { ...D.policy.in };
  const sp = signPolicy(p, signer({ priv: hexToBytes(keys.authority.priv), pub: authPub }));
  const opened = openPolicy(sp, verifier(authPub), { exam: p.exam, shift: p.shift });
  assert.deepEqual(opened.integrity, p.integrity);
  assert.equal(opened.roster.C0002.acc?.faces, 2);
  assert.equal(integrityOf(undefined).defaulted, true);
  assert.equal(integrityOf(undefined).pol.probeMs, INTEGRITY_DEFAULT.probeMs);
  const bad = signPolicy({ ...p, integrity: { ...p.integrity!, reviewPub: 'nope' } }, signer({ priv: hexToBytes(keys.authority.priv), pub: authPub }));
  assert.throws(() => openPolicy(bad, verifier(authPub), { exam: p.exam, shift: p.shift }), /integrity/);
});

test('wire parsers accept the vectors and refuse oversize or malformed input', () => {
  assert.equal(parseSignedReadiness({ r: D.readiness.in, sig: D.readiness.sig }).r.verdict, 'block');
  assert.equal(parseSignedFace({ f: D.face.in, sig: D.face.sig }).f.code, 'face-none');
  assert.throws(() => parseSignedReadiness({ r: { ...D.readiness.in, verdict: 'purple' }, sig: D.readiness.sig }));
  assert.throws(() => parseSignedFace({ f: { ...D.face.in, thumb: 'ab'.repeat(30_000) }, sig: D.face.sig }));
  assert.throws(() => parseSignedFace({ f: { ...D.face.in, code: 'face-who' }, sig: D.face.sig }));
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm --filter @saakshi/core exec node --test test/addendum-d.test.ts`
Expected: FAIL, `Cannot find module '../src/integrity.ts'`.

- [ ] **Step 3: Write `packages/core/src/integrity.ts`**

```ts
// Protocol Addendum D (Stage 5, plan §3.4–§3.5): the integrity section of the signed policy, findings, the signed readiness report,
// the signed face flag with its thumbnail sealed to control's review key, and the provenance slot. Browser-safe.
import { sha256 } from '@noble/hashes/sha2.js';
import { hexToBytes, toHex, utf8 } from './bytes.ts';
import { nobleBox, openBox, sealBox, type BoxKeys } from './box.ts';
import { canon, type Canon } from './canon.ts';
import type { Ctx } from './protocol.ts';

export type Level = 'block' | 'review' | 'amber' | 'info';
export const LEVELS: readonly Level[] = ['block', 'review', 'amber', 'info'];
export const FINDING_CODES = ['blocklisted', 'capture-excluded', 'remote-session', 'vm', 'vm-signal', 'displays', 'no-camera', 'probe-unknown',
  'egress', 'battery', 'disk', 'clock-skew', 'blur', 'face-none', 'face-extra', 'assistive', 'test-mode', 'policy-default'] as const;
export type FindingCode = (typeof FINDING_CODES)[number];
export interface IntegrityFinding { code: FindingCode; level: Level; detail: string; names: string[] }
export type Verdict = 'green' | 'amber' | 'review' | 'block';
export const VERDICTS: readonly Verdict[] = ['green', 'amber', 'review', 'block'];

export function verdictOf(fs: readonly IntegrityFinding[]): Verdict {
  if (fs.some((f) => f.level === 'block')) return 'block';
  if (fs.some((f) => f.level === 'review')) return 'review';
  return fs.some((f) => f.level === 'amber') ? 'amber' : 'green';
}

export interface ToolRule { name: string; procs: string[]; bundleIds: string[] }
export interface IntegrityPolicy {
  v: 1; blocklist: ToolRule[]; assistive: ToolRule[]; guestTools: string[]; vmMacPrefixes: string[]; vmStrings: string[];
  /** "host:port" the seat may talk to (its relay). Loopback is always allowed. */
  egress: string[];
  probeMs: number; blurMs: number; face: { noFaceMs: number; window: number; over: number };
  amber: { minFreeBytes: number; maxSkewMs: number };
  /** Control's review key (130 hex): face thumbnails are sealed to it. */
  reviewPub: string; retentionMs: number;
}
export interface Accommodation { faces?: number; assistive?: string[] }

const rule = (name: string, procs: string[], bundleIds: string[] = []): ToolRule => ({ name, procs, bundleIds });
export const INTEGRITY_DEFAULT: Omit<IntegrityPolicy, 'reviewPub' | 'egress'> = {
  v: 1,
  blocklist: [
    rule('AnyDesk', ['anydesk'], ['com.philandro.anydesk']), rule('TeamViewer', ['teamviewer', 'teamviewer_service'], ['com.teamviewer.TeamViewer']),
    rule('RustDesk', ['rustdesk'], ['com.carriez.rustdesk']), rule('Parsec', ['parsecd'], ['tv.parsec.www']),
    rule('Chrome Remote Desktop', ['remoting_host'], ['com.google.chrome.remote_desktop']), rule('VNC server', ['vncserver', 'tvnserver', 'winvnc']),
    rule('OBS Studio', ['obs', 'obs64', 'obs studio'], ['com.obsproject.obs-studio']), rule('Cluely', ['cluely'], ['com.cluely.app']),
  ],
  assistive: [
    rule('NVDA', ['nvda']), rule('JAWS', ['jfw']), rule('Narrator', ['narrator']), rule('Magnifier', ['magnify']),
    rule('VoiceOver', ['voiceover'], ['com.apple.VoiceOver']),
  ],
  guestTools: ['vmtoolsd', 'vboxservice', 'vboxtray', 'prl_tools_service', 'prl_client_app', 'qemu-ga', 'spice-vdagent', 'vmware-tools-daemon'],
  vmMacPrefixes: ['00:05:69', '00:0c:29', '00:1c:14', '00:50:56', '08:00:27', '00:1c:42', '52:54:00', '00:16:3e'],
  vmStrings: ['vmware', 'virtualbox', 'vbox', 'parallels', 'qemu', 'virtual machine', 'apple virtual', 'xen', 'kvm', 'bochs'],
  probeMs: 10_000, blurMs: 3_000, face: { noFaceMs: 10_000, window: 5, over: 3 },
  amber: { minFreeBytes: 1024 ** 3, maxSkewMs: 120_000 }, retentionMs: 30 * 24 * 3600_000,
};
/** Decision 4: a policy without the integrity section runs on the defaults and says so (the seat adds `policy-default`). */
export function integrityOf(p?: IntegrityPolicy): { pol: IntegrityPolicy; defaulted: boolean } {
  return p ? { pol: p, defaulted: false } : { pol: { ...INTEGRITY_DEFAULT, egress: [], reviewPub: '' }, defaulted: true };
}

// D.2
export const findingMeta = (f: IntegrityFinding): Canon[] => [f.code, f.level, f.detail, [...f.names]];
export function findingFromMeta(meta: Canon[]): IntegrityFinding | undefined {
  const [code, a, b, names] = meta;
  if (typeof code !== 'string' || !(FINDING_CODES as readonly string[]).includes(code)) return undefined;
  if (meta.length === 2 && typeof a === 'string') return { code: code as FindingCode, level: 'info', detail: a, names: [] };   // B.9 test-mode
  if (typeof a !== 'string' || !(LEVELS as readonly string[]).includes(a) || typeof b !== 'string' || !Array.isArray(names)) return undefined;
  return { code: code as FindingCode, level: a as Level, detail: b, names: names.filter((n): n is string => typeof n === 'string') };
}
export const findingKey = (f: IntegrityFinding): string => `${f.code}:${[...f.names].sort().join(',')}`;
export const findingsHash = (fs: readonly IntegrityFinding[]): string => toHex(sha256(utf8(canon(['findings', fs.map(findingMeta)]))));

// D.3
export interface Readiness extends Ctx { seatId: string; keyEpoch: number; at: number; verdict: Verdict; findings: IntegrityFinding[] }
export const readinessArray = (r: Readiness): Canon[] =>
  ['readiness', r.exam, r.shift, r.attempt, r.cand, r.seatId, r.keyEpoch, r.at, r.verdict, findingsHash(r.findings)];
export interface SignedReadiness { r: Readiness; sig: string }

// D.4
export interface FaceFlag extends Ctx {
  seatId: string; at: number; code: 'face-none' | 'face-extra'; faces: number; expected: number;
  /** hex B.4 box to reviewPub, '' when no frame was available */ thumb: string; thumbHash: string;
}
export const faceArray = (f: FaceFlag): Canon[] =>
  ['face', f.exam, f.shift, f.attempt, f.cand, f.seatId, f.at, f.code, f.faces, f.expected, f.thumbHash];
export interface SignedFace { f: FaceFlag; sig: string }
export const faceInfo = (c: Ctx, at: number): Canon[] => ['saakshi-face', 1, c.exam, c.shift, c.attempt, c.cand, at];
export const thumbHashOf = (thumbHex: string): string => (thumbHex ? toHex(sha256(hexToBytes(thumbHex))) : '');
export const sealThumb = (reviewPub: Uint8Array, c: Ctx, at: number, jpeg: Uint8Array, k: BoxKeys = nobleBox): string =>
  toHex(sealBox(reviewPub, faceInfo(c, at), jpeg, k));
export const openThumb = (priv: Uint8Array, c: Ctx, at: number, box: string, k: BoxKeys = nobleBox): Uint8Array =>
  openBox(priv, faceInfo(c, at), hexToBytes(box), k);

// D.5
export interface ProvSummary { moves: number; pathPx: number; clicks: number; keys: number; untrusted: number; lastMoveMs: number }
export const provArray = (p?: ProvSummary): Canon[] =>
  p ? ['prov', ...[p.moves, p.pathPx, p.clicks, p.keys, p.untrusted, p.lastMoveMs].map((n) => Math.max(0, Math.round(n)))] : [];
```

- [ ] **Step 4: Extend `policy.ts`, `wire.ts`, `directory.ts`**

`policy.ts`: add `import type { Accommodation, IntegrityPolicy } from './integrity.ts';`, `acc?: Accommodation` on `RosterEntry`, `integrity?: IntegrityPolicy` on `Policy`, and at the end of `openPolicy`, before `return p`:

```ts
  const ip = p.integrity;
  if (ip !== undefined && (ip?.v !== 1 || !/^04[0-9a-f]{128}$/.test(ip.reviewPub ?? '') || !Array.isArray(ip.blocklist) || !Array.isArray(ip.assistive)
    || !Array.isArray(ip.egress) || !Number.isSafeInteger(ip.probeMs) || ip.probeMs < 1000 || !Number.isSafeInteger(ip.retentionMs)))
    throw new Error('the policy\'s integrity section is malformed');
```

`wire.ts`: `LIMITS` gains `thumb: 40_000`. Add:

```ts
import { FINDING_CODES, LEVELS, VERDICTS, thumbHashOf, type SignedFace, type SignedReadiness } from './integrity.ts';
const str = (x: unknown, max: number = LIMITS.field): x is string => typeof x === 'string' && x.length <= max;
const nat = (x: unknown): x is number => Number.isSafeInteger(x) && (x as number) >= 0;
const ctxOk = (c: any) => str(c?.exam) && str(c?.shift) && Number.isSafeInteger(c?.attempt) && str(c?.cand);
export function parseSignedReadiness(x: unknown): SignedReadiness {
  const s = x as SignedReadiness, r = s?.r;
  if (!ctxOk(r) || !str(r.seatId) || !nat(r.keyEpoch) || !nat(r.at) || !(VERDICTS as readonly string[]).includes(r.verdict)
    || !Array.isArray(r.findings) || r.findings.length > 64 || !/^[0-9a-f]{128}$/.test(s.sig ?? '')) throw new Error('bad readiness report');
  for (const f of r.findings) if (!(FINDING_CODES as readonly string[]).includes(f?.code) || !(LEVELS as readonly string[]).includes(f?.level)
    || !str(f.detail, 512) || !Array.isArray(f.names) || f.names.length > 16 || !f.names.every((n) => str(n))) throw new Error('bad finding');
  return { r: { exam: r.exam, shift: r.shift, attempt: r.attempt, cand: r.cand, seatId: r.seatId, keyEpoch: r.keyEpoch, at: r.at, verdict: r.verdict,
    findings: r.findings.map((f) => ({ code: f.code, level: f.level, detail: f.detail, names: [...f.names] })) }, sig: s.sig };
}
export function parseSignedFace(x: unknown): SignedFace {
  const s = x as SignedFace, f = s?.f;
  if (!ctxOk(f) || !str(f.seatId) || !nat(f.at) || (f.code !== 'face-none' && f.code !== 'face-extra') || !nat(f.faces) || !nat(f.expected)
    || !str(f.thumb, LIMITS.thumb) || !/^([0-9a-f]{2})*$/.test(f.thumb) || !/^[0-9a-f]{128}$/.test(s.sig ?? '')) throw new Error('bad face flag');
  if (f.thumbHash !== thumbHashOf(f.thumb)) throw new Error('face flag: thumbHash does not match the thumbnail');
  return { f: { exam: f.exam, shift: f.shift, attempt: f.attempt, cand: f.cand, seatId: f.seatId, at: f.at, code: f.code, faces: f.faces,
    expected: f.expected, thumb: f.thumb, thumbHash: f.thumbHash }, sig: s.sig };
}
```

(If `wire.ts` already defines helpers named `str`/`nat`, reuse them rather than redeclaring.) `directory.ts`: `FILES.reviewKey: 'control/review.key.json'`.

- [ ] **Step 5: Shared seat types.** Append to `apps/seat/src/shared/ipc.ts`:

```ts
import type { IntegrityFinding, ProvSummary, Verdict } from '@saakshi/core/integrity';
/** Stage 5: the integrity gate's latest verdict on this seat (Addendum D). checkedAt 0 = not yet checked. */
export interface GateView { verdict: Verdict; findings: IntegrityFinding[]; checkedAt: number }
/** One face-count sample from the renderer (2 per second). thumb: base64 160×120 JPEG, sent only when faces !== expected. */
export interface FaceSample { faces: number; at: number; thumb?: string }
```

Add `gate?: GateView; faces?: number;` to `ExamBoot`, `prov?: ProvSummary` to `Action`, and to `SeatApi`: `recheck(): Promise<GateView>; faceSample(s: FaceSample): void; blur(ms: number): void;`. In `preload/index.ts`: `recheck: () => ipcRenderer.invoke('gate:recheck')`, `faceSample: (s) => ipcRenderer.send('face:sample', s)`, `blur: (ms) => ipcRenderer.send('gate:blur', ms)`.

- [ ] **Step 6: The vector generator** `tools/gen-vectors-addendum-d.ts`, which refuses to overwrite (same pattern as Addendum C):

```ts
// Writes fixtures/vectors/protocol-v1-addendum-d.json (protocol Addendum D). Run once; refuses to overwrite.
//   node tools/gen-vectors-addendum-d.ts
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { hexToBytes, toHex } from '../packages/core/src/bytes.ts';
import { canon } from '../packages/core/src/canon.ts';
import type { KeysFile } from '../packages/core/src/dev.ts';
import { msg } from '../packages/core/src/enrol.ts';
import { faceArray, findingsHash, INTEGRITY_DEFAULT, readinessArray, sealThumb, thumbHashOf, type FaceFlag, type Readiness } from '../packages/core/src/integrity.ts';
import { nativeBox, newKeyPair, signer } from '../packages/core/src/node.ts';
import type { Policy } from '../packages/core/src/policy.ts';

const OUT = 'fixtures/vectors/protocol-v1-addendum-d.json';
if (existsSync(OUT)) { console.log(`keep ${OUT} (frozen)`); process.exit(0); }
const keys = JSON.parse(readFileSync('fixtures/keys.json', 'utf8')) as KeysFile;
const seat = { priv: hexToBytes(keys.seats[0].priv), pub: hexToBytes(keys.seats[0].pub) }, sign = signer(seat);
const X = { exam: 'DEMO-2026', shift: 'S1', attempt: 1, cand: 'C0001' };
const review = newKeyPair();
const readiness: Readiness = { ...X, seatId: 'CEN042-S01', keyEpoch: 1, at: 1790000000000, verdict: 'block', findings: [
  { code: 'blocklisted', level: 'block', detail: 'AnyDesk (pid 4242)', names: ['AnyDesk'] },
  { code: 'capture-excluded', level: 'block', detail: 'a window of overlay-sim is hidden from screen capture', names: ['overlay-sim'] },
  { code: 'battery', level: 'amber', detail: 'running on battery', names: [] },
] };
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 0xff, 0xd9]);                     // a stand-in, not a real image
const thumb = sealThumb(review.pub, X, 1790000060000, jpeg, nativeBox);
const face: FaceFlag = { ...X, seatId: 'CEN042-S01', at: 1790000060000, code: 'face-none', faces: 0, expected: 1, thumb, thumbHash: thumbHashOf(thumb) };
const policy: Policy = { v: 1, exam: X.exam, shift: X.shift, centre: 'CEN042', cell: { id: 'cell-1', keyId: '0'.repeat(16), pub: keys.cells[0].pub },
  durationMs: 1_800_000, issuedAt: 1790000000000,
  roster: { C0001: { form: 'F1', extraMs: 0, pseud: '7'.repeat(64) }, C0002: { form: 'F2', extraMs: 600_000, pseud: '8'.repeat(64), acc: { faces: 2, assistive: ['NVDA', 'VoiceOver'] } } },
  integrity: { ...INTEGRITY_DEFAULT, egress: ['192.168.1.10:7070'], reviewPub: toHex(review.pub) } };
writeFileSync(OUT, JSON.stringify({
  reviewKey: { priv: toHex(review.priv), pub: toHex(review.pub) },
  readiness: { in: readiness, text: canon(readinessArray(readiness)), findingsHash: findingsHash(readiness.findings), sig: toHex(sign(msg(readinessArray(readiness)))) },
  face: { in: face, text: canon(faceArray(face)), jpeg: toHex(jpeg), sig: toHex(sign(msg(faceArray(face)))) },
  policy: { in: policy },
}, null, 2) + '\n');
console.log(`wrote ${OUT}`);
```

Run: `node tools/gen-vectors-addendum-d.ts`, then commit the JSON (frozen).

- [ ] **Step 7: Add the dependency.** Run: `pnpm --filter @saakshi/seat add -D playwright-core --config.confirm-modules-purge=false </dev/null` with `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`. It adds no browsers; `_electron` drives the installed Electron.

- [ ] **Step 8: Append §17 to `docs/protocol-v1.md`.** Write the five rows D.1–D.5 exactly as in this plan's Addendum table, in the style of §16: a vectors line, a code line (`integrity.ts`, `policy.ts`, `wire.ts`), and "additive only; V stays 1".

- [ ] **Step 9: Run the tests**

Run: `pnpm --filter @saakshi/core test && pnpm --filter @saakshi/core typecheck && pnpm --filter @saakshi/seat typecheck`
Expected: all PASS, including the existing A/B/C vector tests (nothing they cover changed).

- [ ] **Step 10: Hand off to the controller** for review and commit: `feat(core): protocol Addendum D — integrity policy, findings, readiness, face flags, provenance`.

---

### Task 2: Probe parsers

**Model:** sonnet

**Files:**
- Modify: `apps/seat/src/main/probe-parse.ts`
- Test: `apps/seat/test/probe-parse.test.ts` (extend)

**Interfaces:**
- Consumes: `ToolRule` (Task 1).
- Produces: `ProbeResult<T = unknown>` (now generic; `probe<T>(fn): Promise<ProbeResult<T>>`); `matchRules(procs: {name: string; bundleId?: string}[], rules: ToolRule[]): {rule: string; name: string}[]`; `baseName(n): string`; `parseNetstat(out: string, platform: 'darwin' | 'win32'): string[]` (remote `host:port` of ESTABLISHED TCP, IPv4 and IPv6, deduplicated); `parseRegBios(out: string): string` (the values of `SystemManufacturer`, `SystemProductName`, `BIOSVendor`, `BIOSVersion` joined by ` | `); `parseIoregPlatform(out: string): string` (`manufacturer`, `model` and `IOPlatformSerialNumber`-free fields joined); `vmMacs(macs: string[], prefixes: string[]): string[]` (lowercases, ignores `00:15:5d` and `00:00:00:00:00:00`). **Remove** `BLOCKLIST` and `blocklistHits`. Task 13 rewrites `probes.ts`, their only caller; until then `probes.ts` uses `matchRules(…, INTEGRITY_DEFAULT.blocklist)` (one-line change allowed here so the build stays green).

- [ ] **Step 1: Write the failing tests** (append to `probe-parse.test.ts`; replace the old blocklist test)

```ts
import { INTEGRITY_DEFAULT } from '@saakshi/core/integrity';
import { baseName, matchRules, parseIoregPlatform, parseNetstat, parseRegBios, vmMacs } from '../src/main/probe-parse.ts';

test('rules match by lowercase basename without .exe, and by macOS bundle ID', () => {
  const hits = matchRules([{ name: 'C:\\x\\AnyDesk.exe' }, { name: '/usr/bin/zsh' }, { name: '/Applications/Foo.app/Contents/MacOS/Foo', bundleId: 'com.teamviewer.TeamViewer' },
    { name: 'obs64.exe' }], INTEGRITY_DEFAULT.blocklist);
  assert.deepEqual(hits, [{ rule: 'AnyDesk', name: 'AnyDesk' }, { rule: 'TeamViewer', name: 'Foo' }, { rule: 'OBS Studio', name: 'obs64' }]);
  assert.equal(baseName('/Applications/OBS.app/Contents/MacOS/OBS Studio'), 'OBS Studio');
});

test('netstat: ESTABLISHED remotes only, both OSes, IPv6, deduplicated', () => {
  const mac = 'Proto Recv-Q Send-Q  Local Address          Foreign Address        (state)\n'
    + 'tcp4       0      0  192.168.1.5.52000      192.168.1.10.7070      ESTABLISHED\n'
    + 'tcp4       0      0  192.168.1.5.52001      142.250.1.1.443        ESTABLISHED\n'
    + 'tcp4       0      0  *.7070                 *.*                    LISTEN\n'
    + 'tcp6       0      0  fe80::1%lo0.52002      fe80::1%lo0.7070       ESTABLISHED\n'
    + 'tcp4       0      0  192.168.1.5.52003      192.168.1.10.7070      ESTABLISHED\n';
  assert.deepEqual(parseNetstat(mac, 'darwin'), ['192.168.1.10:7070', '142.250.1.1:443', 'fe80::1%lo0:7070']);
  const win = '  Proto  Local Address          Foreign Address        State           PID\r\n'
    + '  TCP    10.1.0.4:49712         10.1.0.9:7070          ESTABLISHED     4242\r\n'
    + '  TCP    [::1]:49713            [::1]:7070             ESTABLISHED     4242\r\n'
    + '  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       900\r\n';
  assert.deepEqual(parseNetstat(win, 'win32'), ['10.1.0.9:7070', '[::1]:7070']);
});

test('BIOS and ioreg strings; VM MAC prefixes skip Hyper-V', () => {
  const reg = '\r\nHKEY_LOCAL_MACHINE\\HARDWARE\\DESCRIPTION\\System\\BIOS\r\n    BIOSVendor    REG_SZ    VMware, Inc.\r\n    SystemManufacturer    REG_SZ    VMware, Inc.\r\n    SystemProductName    REG_SZ    VMware7,1\r\n';
  assert.equal(parseRegBios(reg), 'VMware, Inc. | VMware7,1 | VMware, Inc.');
  const io = '+-o J316sAP  <class IOPlatformExpertDevice>\n    {\n      "manufacturer" = <"Apple Inc.">\n      "model" = <"VirtualMac2,1">\n    }\n';
  assert.equal(parseIoregPlatform(io), 'Apple Inc. | VirtualMac2,1');
  assert.deepEqual(vmMacs(['00:15:5D:01:02:03', '08:00:27:aa:bb:cc', '00:00:00:00:00:00', 'a4:83:e7:00:00:01'], INTEGRITY_DEFAULT.vmMacPrefixes), ['08:00:27:aa:bb:cc']);
});
```

- [ ] **Step 2: Run to fail.** Run: `pnpm --filter @saakshi/seat exec node --test test/probe-parse.test.ts`. Expected: FAIL (missing exports).

- [ ] **Step 3: Implement** (keep `run`, `probe`, `parsePs`, `parseTasklistCsv`):

```ts
export type ProbeResult<T = unknown> = { status: 'ok'; value: T } | { status: 'unknown'; error: string };
export async function probe<T>(fn: () => T | Promise<T>): Promise<ProbeResult<T>> {
  try { return { status: 'ok', value: await fn() }; } catch (e) { return { status: 'unknown', error: String((e as Error).message ?? e) }; }
}
export const baseName = (n: string): string => n.split(/[\\/]/).pop()!.replace(/\.exe$/i, '');
export function matchRules(procs: { name: string; bundleId?: string }[], rules: ToolRule[]): { rule: string; name: string }[] {
  const out: { rule: string; name: string }[] = [], seen = new Set<string>();
  for (const p of procs) {
    const b = baseName(p.name), lb = b.toLowerCase();
    const r = rules.find((x) => x.procs.includes(lb) || (p.bundleId !== undefined && x.bundleIds.includes(p.bundleId)));
    if (r && !seen.has(`${r.name}/${b}`)) { seen.add(`${r.name}/${b}`); out.push({ rule: r.name, name: b }); }
  }
  return out;
}
export function parseNetstat(out: string, platform: 'darwin' | 'win32'): string[] {
  const set = new Set<string>();
  for (const line of out.split(/\r?\n/)) {
    const c = line.trim().split(/\s+/);
    if (platform === 'win32') { if (c[0] === 'TCP' && c[3] === 'ESTABLISHED') set.add(c[2]); continue; }
    if (!/^tcp[46]?$/.test(c[0]) || c[5] !== 'ESTABLISHED') continue;
    const i = c[4].lastIndexOf('.');                                      // macOS writes host.port
    set.add(`${c[4].slice(0, i)}:${c[4].slice(i + 1)}`);
  }
  return [...set];
}
const regValue = (out: string, key: string) => out.match(new RegExp(`^\\s*${key}\\s+REG_SZ\\s+(.+?)\\s*$`, 'm'))?.[1];
export const parseRegBios = (out: string): string =>
  ['SystemManufacturer', 'SystemProductName', 'BIOSVendor', 'BIOSVersion'].map((k) => regValue(out, k)).filter(Boolean).join(' | ');
export const parseIoregPlatform = (out: string): string =>
  ['manufacturer', 'model'].map((k) => out.match(new RegExp(`"${k}" = <"([^"]*)">`))?.[1]).filter(Boolean).join(' | ');
export const vmMacs = (macs: string[], prefixes: string[]): string[] =>
  macs.map((m) => m.toLowerCase()).filter((m) => m !== '00:00:00:00:00:00' && !m.startsWith('00:15:5d') && prefixes.some((p) => m.startsWith(p)));
```

- [ ] **Step 4: Run to pass.** Run: `pnpm --filter @saakshi/seat exec node --test test/probe-parse.test.ts && pnpm --filter @saakshi/seat typecheck`. Expected: PASS.

- [ ] **Step 5: Hand off** for commit: `feat(seat): probe parsers — rules by name and bundle ID, netstat, BIOS, ioreg, VM MACs`.

---

### Task 3: macOS capture-excluded windows

**Model:** opus

**Files:**
- Create: `apps/seat/src/main/probes-mac.ts`
- Test: `apps/seat/test/probes-mac.test.ts`

**Interfaces:**
- Produces: `captureExcludedWindowsMac(): { visibleWindows: number; excluded: { pid: number; owner: string; sharing: number }[] }`, the macOS twin of `probes-win.ts`'s `captureExcludedWindows()`. It excludes this process's own windows. Loaded only by dynamic `import()` on darwin (Task 13).

- [ ] **Step 1: Write the test** (skips off macOS; asserts shape, and that its own content-protected window never counts):

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('macOS: lists on-screen windows and returns excluded owners with pids (darwin only)', { skip: process.platform !== 'darwin' }, async () => {
  const { captureExcludedWindowsMac } = await import('../src/main/probes-mac.ts');
  const r = captureExcludedWindowsMac();
  assert.ok(Number.isInteger(r.visibleWindows) && r.visibleWindows >= 0);
  for (const w of r.excluded) { assert.ok(w.pid > 0 && w.pid !== process.pid); assert.equal(w.sharing, 0); assert.equal(typeof w.owner, 'string'); }
});
```

- [ ] **Step 2: Run to fail.** Run: `pnpm --filter @saakshi/seat exec node --test test/probes-mac.test.ts`. Expected: FAIL (module missing) on macOS.

- [ ] **Step 3: Implement with koffi** (CoreGraphics returns a `CFArrayRef` of `CFDictionaryRef`; read `kCGWindowSharingState`, `kCGWindowOwnerPID`, `kCGWindowOwnerName`, `kCGWindowLayer`; release the array):

```ts
// macOS twin of probes-win.ts (plan §3.4): other apps' on-screen windows whose sharing state is None (kCGWindowSharingState == 0) are
// excluded from screen capture. Honest limit: on macOS 15+ ScreenCaptureKit may ignore sharingType, so a window reported here is a
// strong signal, but its absence proves nothing (docs/threat-model.md).
import koffi from 'koffi';

const CF = koffi.load('/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation');
const CG = koffi.load('/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics');
const CGWindowListCopyWindowInfo = CG.func('void *CGWindowListCopyWindowInfo(uint32_t option, uint32_t relativeToWindow)');
const CFArrayGetCount = CF.func('long CFArrayGetCount(void *arr)');
const CFArrayGetValueAtIndex = CF.func('void *CFArrayGetValueAtIndex(void *arr, long i)');
const CFDictionaryGetValue = CF.func('void *CFDictionaryGetValue(void *dict, void *key)');
const CFNumberGetValue = CF.func('bool CFNumberGetValue(void *num, int type, _Out_ int64_t *out)');
const CFStringCreateWithCString = CF.func('void *CFStringCreateWithCString(void *alloc, const char *s, uint32_t enc)');
const CFStringGetCString = CF.func('bool CFStringGetCString(void *s, _Out_ uint8_t *buf, long size, uint32_t enc)');
const CFRelease = CF.func('void CFRelease(void *x)');
const UTF8 = 0x08000100, SInt64 = 4, OnScreenOnly = 1 << 0, ExcludeDesktop = 1 << 4;
const key = (s: string) => CFStringCreateWithCString(null, s, UTF8);
const K = { sharing: key('kCGWindowSharingState'), pid: key('kCGWindowOwnerPID'), owner: key('kCGWindowOwnerName'), layer: key('kCGWindowLayer') };   // ponytail: never released (4 strings, process lifetime)

function num(d: unknown, k: unknown): number | undefined {
  const v = CFDictionaryGetValue(d, k); if (!v) return undefined;
  const out = [0n]; return CFNumberGetValue(v, SInt64, out) ? Number(out[0]) : undefined;
}
function str(d: unknown, k: unknown): string {
  const v = CFDictionaryGetValue(d, k); if (!v) return '';
  const buf = Buffer.alloc(512); return CFStringGetCString(v, buf, buf.length, UTF8) ? buf.toString('utf8').replace(/\0.*$/s, '') : '';
}

export function captureExcludedWindowsMac(): { visibleWindows: number; excluded: { pid: number; owner: string; sharing: number }[] } {
  const arr = CGWindowListCopyWindowInfo(OnScreenOnly | ExcludeDesktop, 0);
  if (!arr) throw new Error('CGWindowListCopyWindowInfo returned NULL');
  try {
    const n = CFArrayGetCount(arr), excluded: { pid: number; owner: string; sharing: number }[] = [];
    let visibleWindows = 0;
    for (let i = 0; i < n; i++) {
      const d = CFArrayGetValueAtIndex(arr, i);
      if ((num(d, K.layer) ?? 0) !== 0) continue;                  // menu bar, dock, status items live on other layers
      visibleWindows++;
      const pid = num(d, K.pid) ?? 0, sharing = num(d, K.sharing);
      if (sharing === 0 && pid !== process.pid) excluded.push({ pid, owner: str(d, K.owner), sharing });
    }
    return { visibleWindows, excluded };
  } finally { CFRelease(arr); }
}
```

If koffi rejects `_Out_ int64_t *` on this version, declare the out-parameter as `_Out_ int64_t *` via `koffi.out(koffi.pointer('int64_t'))`. The test must pass either way; do not change the exported shape.

- [ ] **Step 4: Manual check on the Mac** (camera stays off): `pnpm --filter @saakshi/seat pack:mac`, then `open -n apps/seat/release/mac-arm64/Saakshi.app --args --overlay-sim` (after Task 15), then run the test and expect one excluded window whose owner is `Saakshi`/`overlay-sim`. Afterwards run `pkill -f 'Saakshi.app/Contents/MacOS/Saakshi'`. Record the macOS version in `docs/evidence/stage5-mac-capture.txt` (Task 19). If macOS reports sharing state 1 for it, record that and keep the probe as "signal when present".

- [ ] **Step 5: Run to pass.** Run: `pnpm --filter @saakshi/seat exec node --test test/probes-mac.test.ts`. Expected: PASS on macOS, SKIP elsewhere.

- [ ] **Step 6: Hand off** for commit: `feat(seat): macOS capture-excluded window probe (kCGWindowSharingState via koffi)`.

---

### Task 4: The pure evaluator and VM score

**Model:** sonnet

**Files:**
- Create: `apps/seat/src/main/integrity.ts`
- Test: `apps/seat/test/integrity.test.ts`

**Interfaces:**
- Consumes: Task 1 types; `matchRules`, `baseName`, `vmMacs` and `ProbeResult` from Task 2 (import them; if Task 2 has not landed in the tree yet, code against these exact signatures).
- Produces:

```ts
export interface Proc { pid: number; name: string; bundleId?: string }
export interface VmSignals { hv: boolean; model: string; bios: string; macs: string[] }
export interface ProbeSnapshot {
  platform: 'darwin' | 'win32' | 'linux'; at: number;
  procs: ProbeResult<Proc[]>; captureExcluded: ProbeResult<number[]>; remoteSession: ProbeResult<boolean>; vm: ProbeResult<VmSignals>;
  egress: ProbeResult<string[]>; displays: number; camera: 'on' | 'none' | 'off'; onBattery: boolean; freeBytes: number | null; skewMs: number | null;
}
export function vmScore(v: VmSignals, procs: Proc[], pol: IntegrityPolicy): { score: number; signals: string[] }
export function evaluate(s: ProbeSnapshot, pol: IntegrityPolicy, acc: Accommodation, o: { testMode: boolean; defaulted: boolean }): IntegrityFinding[]
```

- [ ] **Step 1: Write the failing tests**

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { INTEGRITY_DEFAULT, verdictOf, type IntegrityPolicy } from '@saakshi/core/integrity';
import { evaluate, vmScore, type ProbeSnapshot } from '../src/main/integrity.ts';

const pol: IntegrityPolicy = { ...INTEGRITY_DEFAULT, egress: ['192.168.1.10:7070'], reviewPub: '04' + 'a'.repeat(128) };
const ok = <T>(value: T) => ({ status: 'ok' as const, value });
const clean = (x: Partial<ProbeSnapshot> = {}): ProbeSnapshot => ({
  platform: 'win32', at: 1, procs: ok([{ pid: 1, name: 'explorer.exe' }]), captureExcluded: ok([]), remoteSession: ok(false),
  vm: ok({ hv: false, model: 'Latitude 5420', bios: 'Dell Inc.', macs: ['a4:83:e7:00:00:01'] }), egress: ok(['192.168.1.10:7070', '127.0.0.1:7070']),
  displays: 1, camera: 'on', onBattery: false, freeBytes: 50e9, skewMs: 200, ...x });
const run = (s: ProbeSnapshot, acc = {}, testMode = false) => evaluate(s, pol, acc, { testMode, defaulted: false });
const codes = (fs: { code: string; level: string }[]) => fs.map((f) => `${f.level}:${f.code}`).sort();

test('a clean seat is green with no findings', () => {
  assert.deepEqual(run(clean()), []);
});

test('Act 1: AnyDesk (renamed notepad) and overlay-sim BLOCK, naming both', () => {
  const fs = run(clean({ procs: ok([{ pid: 4242, name: 'C:\\t\\AnyDesk.exe' }, { pid: 77, name: 'C:\\s\\overlay-sim.exe' }]), captureExcluded: ok([77]) }));
  assert.equal(verdictOf(fs), 'block');
  assert.deepEqual(fs.flatMap((f) => f.names).sort(), ['AnyDesk', 'overlay-sim']);
  assert.match(fs.find((f) => f.code === 'blocklisted')!.detail, /AnyDesk \(pid 4242\)/);
});

test('remote session and screensharingd block', () => {
  assert.deepEqual(codes(run(clean({ remoteSession: ok(true) }))), ['block:remote-session']);
  assert.deepEqual(codes(run(clean({ platform: 'darwin', remoteSession: ok(false),
    procs: ok([{ pid: 9, name: '/System/Library/CoreServices/RemoteManagement/screensharingd.bundle/Contents/MacOS/screensharingd' }]) }))), ['block:remote-session']);
});

test('VM score: 2 signal classes block, 1 is review, Hyper-V MAC alone is nothing', () => {
  const v = (hv: boolean, model: string, macs: string[] = []) => ({ hv, model, bios: '', macs });
  assert.deepEqual(vmScore(v(true, 'VirtualMac2,1'), [], pol).signals, ['hypervisor', 'model']);
  assert.deepEqual(codes(run(clean({ vm: ok(v(true, 'VirtualMac2,1')) }))), ['block:vm']);
  assert.deepEqual(codes(run(clean({ vm: ok(v(true, 'MacBookPro18,3')) }))), ['review:vm-signal']);
  assert.deepEqual(codes(run(clean({ vm: ok(v(false, 'x', ['00:15:5d:00:00:01'])) }))), []);
  assert.equal(vmScore(v(false, 'x'), [{ pid: 3, name: 'VBoxService.exe' }], pol).score, 1);
});

test('review and amber signals', () => {
  assert.deepEqual(codes(run(clean({ displays: 2, camera: 'none', egress: ok(['192.168.1.10:7070', '142.250.1.1:443']) }))), ['review:displays', 'review:egress', 'review:no-camera']);
  assert.deepEqual(codes(run(clean({ onBattery: true, freeBytes: 5e8, skewMs: -180_000 }))), ['amber:battery', 'amber:clock-skew', 'amber:disk']);
  assert.deepEqual(codes(run(clean({ camera: 'off' }), {}, true)), ['info:test-mode']);
  assert.deepEqual(codes(evaluate(clean(), pol, {}, { testMode: false, defaulted: true })), ['review:policy-default']);
});

test('Review Focus #1: an unknown probe is review, never green and never block', () => {
  const u = { status: 'unknown' as const, error: 'timed out' };
  const fs = run(clean({ procs: u, captureExcluded: u }));
  assert.equal(verdictOf(fs), 'review');
  assert.deepEqual(fs.filter((f) => f.code === 'probe-unknown').flatMap((f) => f.names).sort(), ['captureExcluded', 'processes']);
});

test('Review Focus #3: accommodated Magnifier is allowed; unaccommodated capture-excluded Magnifier blocks; NVDA alone is info', () => {
  const s = clean({ procs: ok([{ pid: 5, name: 'C:\\Windows\\System32\\Magnify.exe' }, { pid: 6, name: 'nvda.exe' }]), captureExcluded: ok([5]) });
  assert.equal(verdictOf(run(s, { assistive: ['Magnifier', 'NVDA'] })), 'green');
  assert.deepEqual(run(s, { assistive: ['Magnifier', 'NVDA'] }).find((f) => f.code === 'assistive')!.names.sort(), ['Magnifier', 'NVDA']);
  assert.equal(verdictOf(run(s)), 'block');
  assert.equal(verdictOf(run(clean({ procs: ok([{ pid: 6, name: 'nvda.exe' }]) }))), 'green');
});
```

- [ ] **Step 2: Run to fail.** Run: `pnpm --filter @saakshi/seat exec node --test test/integrity.test.ts`. Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

```ts
// The integrity gate's judgement (plan §3.4), pure: a probe snapshot + the signed policy + the candidate's accommodation → findings.
// No I/O here; probe-host.ts collects, gate.ts schedules and reports.
import type { Accommodation, IntegrityFinding, IntegrityPolicy } from '@saakshi/core/integrity';
import { baseName, matchRules, vmMacs, type ProbeResult } from './probe-parse.ts';

export interface Proc { pid: number; name: string; bundleId?: string }
export interface VmSignals { hv: boolean; model: string; bios: string; macs: string[] }
export interface ProbeSnapshot {
  platform: 'darwin' | 'win32' | 'linux'; at: number;
  procs: ProbeResult<Proc[]>; captureExcluded: ProbeResult<number[]>; remoteSession: ProbeResult<boolean>; vm: ProbeResult<VmSignals>;
  egress: ProbeResult<string[]>; displays: number; camera: 'on' | 'none' | 'off'; onBattery: boolean; freeBytes: number | null; skewMs: number | null;
}
const F = (code: IntegrityFinding['code'], level: IntegrityFinding['level'], detail: string, names: string[] = []): IntegrityFinding => ({ code, level, detail, names });
const LOOPBACK = /^(127\.|\[?::1\]?:|localhost:|fe80::1%lo0:)/;

export function vmScore(v: VmSignals, procs: Proc[], pol: IntegrityPolicy): { score: number; signals: string[] } {
  const has = (s: string) => pol.vmStrings.some((x) => s.toLowerCase().includes(x));
  const signals = [
    v.hv && 'hypervisor',
    (/^VirtualMac/i.test(v.model) || has(v.model)) && 'model',
    has(v.bios) && 'bios',
    vmMacs(v.macs, pol.vmMacPrefixes).length > 0 && 'mac',
    procs.some((p) => pol.guestTools.includes(baseName(p.name).toLowerCase())) && 'guest-tools',
  ].filter((s): s is string => typeof s === 'string');
  return { score: signals.length, signals };
}

export function evaluate(s: ProbeSnapshot, pol: IntegrityPolicy, acc: Accommodation, o: { testMode: boolean; defaulted: boolean }): IntegrityFinding[] {
  const out: IntegrityFinding[] = [], unknown: string[] = [];
  const procs = s.procs.status === 'ok' ? s.procs.value : (unknown.push('processes'), []);
  // Apple's own daemons live under /System and share names with tools (CoreParsec's parsecd): not blocklist material.
  const thirdParty = s.platform === 'darwin' ? procs.filter((p) => !p.name.startsWith('/System/')) : procs;
  const hits = matchRules(thirdParty, pol.blocklist);
  if (hits.length) out.push(F('blocklisted', 'block', hits.map((h) => `${h.rule} (pid ${procs.find((p) => baseName(p.name) === h.name)?.pid})`).join(' · '), hits.map((h) => h.name)));

  const allowed = new Set(acc.assistive ?? []), at = matchRules(procs, pol.assistive), atNames = new Set<string>();
  for (const h of at) atNames.add(h.rule);
  if (s.captureExcluded.status === 'ok') {
    const hidden: string[] = [];
    for (const pid of s.captureExcluded.value) {
      const p = procs.find((x) => x.pid === pid), name = p ? baseName(p.name) : `pid ${pid}`;
      const rule = p && matchRules([p], pol.assistive)[0];
      if (rule && allowed.has(rule.rule)) continue;              // Decision 5: exempt only with the signed accommodation
      hidden.push(name);
    }
    if (hidden.length) out.push(F('capture-excluded', 'block', `hidden from screen capture: ${hidden.join(', ')}`, hidden));
  } else unknown.push('captureExcluded');
  if (atNames.size) out.push(F('assistive', 'info', `assistive technology allowed: ${[...atNames].join(', ')}`, [...atNames]));

  const ssd = s.platform === 'darwin' && procs.some((p) => p.name.endsWith('/screensharingd'));
  if (s.remoteSession.status === 'ok' ? s.remoteSession.value || ssd : (unknown.push('remoteSession'), ssd))
    out.push(F('remote-session', 'block', s.platform === 'darwin' ? 'macOS Screen Sharing is active' : 'this is a remote desktop session'));

  if (s.vm.status === 'ok') {
    const v = vmScore(s.vm.value, procs, pol);
    if (v.score >= 2) out.push(F('vm', 'block', `virtual machine (score ${v.score}: ${v.signals.join(', ')})`, v.signals));
    else if (v.score === 1) out.push(F('vm-signal', 'review', `one virtual-machine signal: ${v.signals[0]}`, v.signals));
  } else unknown.push('vm');

  if (s.displays > 1) out.push(F('displays', 'review', `${s.displays} displays connected`));
  if (s.camera === 'none') out.push(F('no-camera', 'review', 'no camera available: invigilator attestation instead'));
  if (s.egress.status === 'ok') {
    const extra = s.egress.value.filter((h) => !LOOPBACK.test(h) && !pol.egress.includes(h));
    if (extra.length) out.push(F('egress', 'review', `connections outside the allowlist: ${extra.slice(0, 5).join(', ')}${extra.length > 5 ? ' …' : ''}`, extra.slice(0, 5)));
  } else unknown.push('egress');
  if (unknown.length) out.push(F('probe-unknown', 'review', `could not check: ${unknown.join(', ')}`, unknown));

  if (s.onBattery) out.push(F('battery', 'amber', 'running on battery'));
  if (s.freeBytes !== null && s.freeBytes < pol.amber.minFreeBytes) out.push(F('disk', 'amber', `${(s.freeBytes / 1024 ** 3).toFixed(1)} GB free`));
  if (s.skewMs !== null && Math.abs(s.skewMs) > pol.amber.maxSkewMs) out.push(F('clock-skew', 'amber', `clock differs from the centre server by ${Math.round(s.skewMs / 1000)} s`));
  if (o.testMode) out.push(F('test-mode', 'info', 'DEV test mode — not for real exams'));
  if (o.defaulted) out.push(F('policy-default', 'review', 'the signed policy has no integrity section; built-in defaults used'));
  return out;
}
```

- [ ] **Step 4: Run to pass.** Run: `pnpm --filter @saakshi/seat exec node --test test/integrity.test.ts && pnpm --filter @saakshi/seat typecheck`. Expected: PASS.

- [ ] **Step 5: Hand off** for commit: `feat(seat): pure integrity evaluator — blocklist, capture exclusion, remote session, VM score, accommodations`.

---

### Task 5: The pure face monitor

**Model:** sonnet

**Files:**
- Create: `apps/seat/src/main/face.ts`
- Test: `apps/seat/test/face.test.ts`

**Interfaces:**
- Consumes: `FaceSample` (Task 1).
- Produces: `interface FaceDraft { code: 'face-none' | 'face-extra'; at: number; faces: number; expected: number; thumb?: string }`; `class FaceMonitor { constructor(o: { expected: number; noFaceMs: number; window: number; over: number }); sample(s: FaceSample): FaceDraft | undefined }`.

- [ ] **Step 1: Write the failing tests**

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FaceMonitor } from '../src/main/face.ts';

const mk = (expected = 1) => new FaceMonitor({ expected, noFaceMs: 10_000, window: 5, over: 3 });
const feed = (m: FaceMonitor, counts: number[], t0 = 0, every = 500) => counts.map((faces, i) => m.sample({ faces, at: t0 + i * every, thumb: faces === 1 ? undefined : `T${i}` })).filter(Boolean);

test('Review Focus #4: 9.5 s without a face is nothing; 10 s is one flag; a whole episode is one flag', () => {
  assert.equal(feed(mk(), Array(20).fill(0)).length, 0);                       // 0 … 9.5 s
  const flags = feed(mk(), Array(60).fill(0));                                   // 30 s away
  assert.equal(flags.length, 1);
  assert.deepEqual({ ...flags[0], thumb: undefined }, { code: 'face-none', at: 10_000, faces: 0, expected: 1, thumb: undefined });
  assert.equal(flags[0]!.thumb, 'T20');                                        // the latest frame of the episode
  const m = mk();
  assert.equal(feed(m, [...Array(21).fill(0), 1, ...Array(21).fill(0)]).length, 2);   // back, then gone again: a new episode
});

test('extra faces: 3 of the last 5 samples, once per episode; one stray sample does nothing', () => {
  assert.equal(feed(mk(), [1, 2, 1, 1, 1, 1, 2, 1]).length, 0);
  const f = feed(mk(), [1, 2, 2, 1, 2, 2, 2, 2]);
  assert.equal(f.length, 1);
  assert.equal(f[0]!.code, 'face-extra');
  assert.equal(f[0]!.faces, 2);
});

test('a scribe seat (expected 2) flags only at 3 faces', () => {
  assert.equal(feed(mk(2), Array(10).fill(2)).length, 0);
  assert.equal(feed(mk(2), Array(10).fill(3))[0]!.expected, 2);
});

test('a flag without any frame still goes out with no thumb', () => {
  const m = mk();
  let flag;
  for (let i = 0; i <= 20; i++) flag = m.sample({ faces: 0, at: i * 500 }) ?? flag;
  assert.equal(flag!.thumb, undefined);
});
```

- [ ] **Step 2: Run to fail.** Run: `pnpm --filter @saakshi/seat exec node --test test/face.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// Face presence flags (plan §3.5), pure: no face for noFaceMs or more; more faces than expected in `over` of the last `window` samples.
// One flag per episode, carrying the latest off-expected frame of that episode. No recognition, no video.
import type { FaceSample } from '../shared/ipc.ts';

export interface FaceDraft { code: 'face-none' | 'face-extra'; at: number; faces: number; expected: number; thumb?: string }

export class FaceMonitor {
  #o: { expected: number; noFaceMs: number; window: number; over: number };
  #noneSince?: number; #noneFlagged = false; #noneThumb?: string;
  #recent: number[] = []; #extraFlagged = false; #extraThumb?: string;
  constructor(o: { expected: number; noFaceMs: number; window: number; over: number }) { this.#o = o; }

  sample(s: FaceSample): FaceDraft | undefined {
    const { expected, noFaceMs, window, over } = this.#o;
    if (s.faces === 0) {
      this.#noneSince ??= s.at;
      if (s.thumb) this.#noneThumb = s.thumb;
    } else { this.#noneSince = undefined; this.#noneFlagged = false; this.#noneThumb = undefined; }
    this.#recent.push(s.faces);
    if (this.#recent.length > window) this.#recent.shift();
    const extra = this.#recent.filter((n) => n > expected).length;
    if (s.faces > expected && s.thumb) this.#extraThumb = s.thumb;
    if (extra < over) { this.#extraFlagged = false; if (extra === 0) this.#extraThumb = undefined; }

    if (this.#noneSince !== undefined && !this.#noneFlagged && s.at - this.#noneSince >= noFaceMs) {
      this.#noneFlagged = true;
      return { code: 'face-none', at: s.at, faces: 0, expected, thumb: this.#noneThumb };
    }
    if (extra >= over && !this.#extraFlagged) {
      this.#extraFlagged = true;
      return { code: 'face-extra', at: s.at, faces: Math.max(...this.#recent), expected, thumb: this.#extraThumb };
    }
    return undefined;
  }
}
```

Note: the test expects the flag's thumb to be the latest frame **at the moment the flag is raised** (`T20` at 10 s). That is exactly `#noneThumb` as written.

- [ ] **Step 4: Run to pass.** Run the test again. Expected: PASS.

- [ ] **Step 5: Hand off** for commit: `feat(seat): pure face monitor — no-face 10 s, extra faces 3 of 5, one flag per episode`.

---

### Task 6: Hardening decisions and the e2e build

**Model:** sonnet

**Files:**
- Create: `apps/seat/src/main/hardening.ts`, `apps/seat/electron-builder.e2e.yml`
- Modify: `apps/seat/electron.vite.config.ts`, `apps/seat/package.json` (scripts only)
- Test: `apps/seat/test/hardening.test.ts`

**Interfaces:**
- Produces: `launchRefusal(argv: readonly string[], e2e: boolean): string | undefined`, `windowMode(o: { test: boolean; e2e: boolean; platform: string }): { kiosk: boolean; fullscreen: boolean; alwaysOnTop: boolean; contentProtection: boolean; devtools: boolean }`, `E2E: boolean` (reads `__SAAKSHI_E2E__`, declared by `define`; `false` when undefined, which is the case under `node --test`).

- [ ] **Step 1: Write the failing tests**

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { E2E, launchRefusal, windowMode } from '../src/main/hardening.ts';

test('the release build refuses debugging switches; the e2e build allows them', () => {
  for (const a of ['--remote-debugging-port=9222', '--remote-debugging-port', '--inspect', '--inspect=9229', '--inspect-brk=0', '--remote-debugging-pipe'])
    assert.match(launchRefusal(['Saakshi', a], false) ?? '', /refused/, a);
  assert.equal(launchRefusal(['Saakshi', '--remote-debugging-port=0', '--inspect=0'], true), undefined);
  assert.equal(launchRefusal(['Saakshi', '--test-mode', '--no-camera'], false), undefined);
});

test('window mode: exam seats are kiosk + fullscreen + on top; content protection only on Windows; devtools only in e2e', () => {
  assert.deepEqual(windowMode({ test: false, e2e: false, platform: 'win32' }), { kiosk: true, fullscreen: true, alwaysOnTop: true, contentProtection: true, devtools: false });
  assert.equal(windowMode({ test: false, e2e: false, platform: 'darwin' }).contentProtection, false);
  assert.deepEqual(windowMode({ test: true, e2e: true, platform: 'darwin' }), { kiosk: false, fullscreen: false, alwaysOnTop: false, contentProtection: false, devtools: true });
  assert.equal(E2E, false);
});
```

- [ ] **Step 2: Run to fail.** Run: `pnpm --filter @saakshi/seat exec node --test test/hardening.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement `hardening.ts`**

```ts
// Electron hardening decisions (plan §3.4), pure. The fuses (electron-builder.yml) stop RunAsNode, NODE_OPTIONS and --inspect in the
// release build; this refuses the switches Chromium itself honours. The e2e build (SAAKSHI_E2E=1, fuses off) exists for Playwright,
// which needs them. Claim: deterrence and detection, not lockdown.
declare const __SAAKSHI_E2E__: boolean | undefined;
export const E2E: boolean = typeof __SAAKSHI_E2E__ !== 'undefined' && __SAAKSHI_E2E__ === true;
const DEBUG = /^--(remote-debugging-(port|pipe|address)|inspect(-brk|-port)?)(=|$)/;

export function launchRefusal(argv: readonly string[], e2e: boolean): string | undefined {
  if (e2e) return undefined;
  const hit = argv.find((a) => DEBUG.test(a));
  return hit ? `Saakshi refused to start: ${hit.split('=')[0]} is not allowed in an exam build` : undefined;
}

export function windowMode(o: { test: boolean; e2e: boolean; platform: string }) {
  const exam = !o.test && !o.e2e;
  // setContentProtection: WDA_EXCLUDEFROMCAPTURE on Windows; on macOS 15+ capture tools may ignore it, so we claim nothing there.
  return { kiosk: exam, fullscreen: exam, alwaysOnTop: exam, contentProtection: exam && o.platform === 'win32', devtools: o.e2e };
}
```

- [ ] **Step 4: The e2e build.** `electron.vite.config.ts`:

```ts
const e2e = JSON.stringify(process.env.SAAKSHI_E2E === '1');
export default defineConfig({
  main: { define: { __SAAKSHI_E2E__: e2e } },
  preload: {},
  renderer: { plugins: [react()] },
});
```

`electron-builder.e2e.yml` (same app, fuses **off**, a separate output folder so a release build is never confused with it):

```yaml
extends: ./electron-builder.yml
productName: Saakshi-E2E
directories:
  output: release-e2e
electronFuses:
  runAsNode: false
  enableNodeOptionsEnvironmentVariable: false
  enableNodeCliInspectArguments: true
  enableEmbeddedAsarIntegrityValidation: false
  onlyLoadAppFromAsar: false
```

`package.json` scripts: `"pack:e2e": "SAAKSHI_E2E=1 pnpm build && electron-builder --dir -c electron-builder.e2e.yml"` and `"pack:e2e:win": "set SAAKSHI_E2E=1&& pnpm build && electron-builder --win --dir -c electron-builder.e2e.yml"`. Add `release-e2e/` to `apps/seat/.gitignore` if one exists; otherwise to the root `.gitignore` next to `release/`.

- [ ] **Step 5: Run to pass.** Run: `pnpm --filter @saakshi/seat exec node --test test/hardening.test.ts && pnpm --filter @saakshi/seat typecheck`. Expected: PASS.

- [ ] **Step 6: Hand off** for commit: `feat(seat): hardening decisions and a separate unfused e2e build`.

---

### Task 7: Relay — readiness reports and face flags

**Model:** sonnet

**Files:**
- Create: `apps/server/src/relay-integrity.ts`
- Test: `apps/server/test/relay-integrity.test.ts`

**Interfaces:**
- Consumes: `parseSignedReadiness`, `parseSignedFace`, `readinessArray`, `faceArray` (Task 1); `Bindings.get(cand, keyEpoch): WireBind | undefined`, `checkWireBind`, `msg`, `verifier`.
- Produces: `relayIntegrity(o: { exam: string; shift: string; dir: string; bindings: Bindings; cellPub: Uint8Array; now?: () => number }): Routes`. Face flags do not carry `keyEpoch`; the relay tries the candidate's latest binding (`bindings.latest(cand)`).

- [ ] **Step 1: Write the failing tests**

```ts
import { expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { toHex } from '@saakshi/core/bytes';
import { cellKey, type KeysFile } from '@saakshi/core/dev';
import { msg } from '@saakshi/core/enrol';
import { faceArray, readinessArray, sealThumb, thumbHashOf, type FaceFlag, type Readiness } from '@saakshi/core/integrity';
import { newKeyPair, signer } from '@saakshi/core/node';
import { Bindings } from '../src/bindings.ts';
import { relayIntegrity } from '../src/relay-integrity.ts';
import { openDb } from '../src/store.ts';
import { simBindReq } from '../../../tools/sim-custody.ts';

const keys = JSON.parse(readFileSync(new URL('../../../fixtures/keys.json', import.meta.url), 'utf8')) as KeysFile;
const cell = cellKey(keys, 'cell-1'), X = { exam: 'DEMO-2026', shift: 'S1' }, ctx = { ...X, attempt: 1, cand: 'C0001' };

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'relay-int-'));
  const { db } = openDb(':memory:');
  const bindings = new Bindings(db, { ...X, cell: { id: 'cell-1', pub: cell.pub } });
  const origin = new Bindings(openDb(':memory:').db, { ...X, cell });
  const seat = newKeyPair();
  const e = origin.enrol(simBindReq('C0001', seat, cell.pub, 'CEN042-S01'), true);
  if (!e.ok) throw new Error(e.error);
  bindings.accept(e.bind);
  const routes = relayIntegrity({ ...X, dir, bindings, cellPub: cell.pub, now: () => 1_000 });
  const post = (p: string, body: unknown) => (routes[p] as any).POST(new Request(`http://r${p}`, { method: 'POST', body: JSON.stringify(body) }));
  const get = (p: string) => (routes[p.split('?')[0]] as any).GET(new Request(`http://r${p}`));
  return { dir, seat, post, get, done: () => { db.close(); rmSync(dir, { recursive: true, force: true }); } };
}
const report = (at: number, verdict: Readiness['verdict'] = 'green'): Readiness => ({ ...ctx, seatId: 'CEN042-S01', keyEpoch: 1, at, verdict, findings: [] });

test('a signed report is kept, served, and replaced only by a newer one', async () => {
  const s = setup();
  const sign = signer(s.seat);
  expect((await s.post('/v1/readiness', { r: report(10, 'block'), sig: toHex(sign(msg(readinessArray(report(10, 'block'))))) })).status).toBe(200);
  expect((await s.post('/v1/readiness', { r: report(5), sig: toHex(sign(msg(readinessArray(report(5))))) })).status).toBe(200);
  const body = await (await s.get('/v1/readiness')).json();
  expect(body.seats).toHaveLength(1);
  expect(body.seats[0].r.verdict).toBe('block');
  s.done();
});

test('Review Focus #5: a report signed by another key is 403; an older report does not replace a newer one; a bad thumbHash is 400', async () => {
  const s = setup();
  const other = signer(newKeyPair());
  expect((await s.post('/v1/readiness', { r: report(10), sig: toHex(other(msg(readinessArray(report(10))))) })).status).toBe(403);
  expect((await s.post('/v1/readiness', { r: { ...report(10), keyEpoch: 2 }, sig: toHex(signer(s.seat)(msg(readinessArray({ ...report(10), keyEpoch: 2 })))) })).status).toBe(403);
  const review = newKeyPair(), thumb = sealThumb(review.pub, ctx, 50, new Uint8Array([1, 2]));
  const f: FaceFlag = { ...ctx, seatId: 'CEN042-S01', at: 50, code: 'face-none', faces: 0, expected: 1, thumb, thumbHash: 'a'.repeat(64) };
  expect((await s.post('/v1/faces', { f, sig: toHex(signer(s.seat)(msg(faceArray(f)))) })).status).toBe(400);
  s.done();
});

test('face flags: stored once per (cand, at), survive a restart, paged by id', async () => {
  const s = setup();
  const review = newKeyPair(), thumb = sealThumb(review.pub, ctx, 50, new Uint8Array([1, 2]));
  const f: FaceFlag = { ...ctx, seatId: 'CEN042-S01', at: 50, code: 'face-none', faces: 0, expected: 1, thumb, thumbHash: thumbHashOf(thumb) };
  const sig = toHex(signer(s.seat)(msg(faceArray(f))));
  const a = await (await s.post('/v1/faces', { f, sig })).json(), b = await (await s.post('/v1/faces', { f, sig })).json();
  expect(a.id).toBe(1); expect(b.id).toBe(1);
  const again = relayIntegrity({ ...X, dir: s.dir, bindings: new Bindings(openDb(':memory:').db, { ...X, cell: { id: 'cell-1', pub: cell.pub } }), cellPub: cell.pub });
  const page = await (await (again['/v1/faces'] as any).GET(new Request('http://r/v1/faces?after=0'))).json();
  expect(page.flags.map((x: { id: number }) => x.id)).toEqual([1]);
  expect(page.last).toBe(1);
  s.done();
});
```

- [ ] **Step 2: Run to fail.** Run: `bun test --timeout 60000 apps/server/test/relay-integrity.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// Relay routes added in Stage 5 (plan §3.4–§3.5): seats' signed readiness reports (latest per candidate, for control's readiness board)
// and signed face flags (append-only faces.jsonl, for control's review queue). The relay cannot read a thumbnail: it is sealed to
// control's review key. It checks every signature against the seat's cell-certified binding.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { hexToBytes } from '@saakshi/core/bytes';
import { checkWireBind, msg } from '@saakshi/core/enrol';
import { faceArray, readinessArray, type SignedFace, type SignedReadiness } from '@saakshi/core/integrity';
import { verifier } from '@saakshi/core/node';
import { parseSignedFace, parseSignedReadiness } from '@saakshi/core/wire';
import type { Bindings } from './bindings.ts';
import type { Routes } from './serve.ts';

const json = (body: unknown, status = 200) => Response.json(body, { status });

export function relayIntegrity(o: { exam: string; shift: string; dir: string; bindings: Bindings; cellPub: Uint8Array; now?: () => number }): Routes {
  const now = o.now ?? Date.now;
  mkdirSync(o.dir, { recursive: true });
  const path = join(o.dir, 'faces.jsonl');
  const faces: (SignedFace & { id: number })[] = existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  const latest = new Map<string, SignedReadiness>();
  const pubFor = (cand: string, keyEpoch?: number): Uint8Array | undefined => {
    const wb = keyEpoch === undefined ? o.bindings.latest(cand)?.wire : o.bindings.get(cand, keyEpoch);
    if (!wb) return undefined;
    try { return hexToBytes(checkWireBind(wb, o.cellPub, verifier).pub); } catch { return undefined; }
  };
  const read = async (req: Request) => req.json().catch(() => null);

  return {
    '/v1/readiness': {
      POST: async (req) => {
        let s: SignedReadiness;
        try { s = parseSignedReadiness(await read(req)); } catch (e) { return json({ error: (e as Error).message }, 400); }
        if (s.r.exam !== o.exam || s.r.shift !== o.shift) return json({ error: 'another exam or shift' }, 400);
        const pub = pubFor(s.r.cand, s.r.keyEpoch);
        if (!pub || !verifier(pub)(msg(readinessArray(s.r)), hexToBytes(s.sig))) return json({ error: 'unknown seat key' }, 403);
        const old = latest.get(s.r.cand);
        if (!old || old.r.at < s.r.at) latest.set(s.r.cand, s);
        return json({ ok: true });
      },
      GET: () => json({ at: now(), seats: [...latest.values()].sort((a, b) => a.r.cand.localeCompare(b.r.cand)) }),
    },
    '/v1/faces': {
      POST: async (req) => {
        let s: SignedFace;
        try { s = parseSignedFace(await read(req)); } catch (e) { return json({ error: (e as Error).message }, 400); }
        if (s.f.exam !== o.exam || s.f.shift !== o.shift) return json({ error: 'another exam or shift' }, 400);
        const pub = pubFor(s.f.cand);
        if (!pub || !verifier(pub)(msg(faceArray(s.f)), hexToBytes(s.sig))) return json({ error: 'unknown seat key' }, 403);
        const dup = faces.find((x) => x.f.cand === s.f.cand && x.f.at === s.f.at);
        if (dup) return json({ id: dup.id });
        const row = { ...s, id: faces.length + 1 };
        appendFileSync(path, JSON.stringify(row) + '\n');                  // ponytail: appendFileSync without fsync; the journal entry is the durable record
        faces.push(row);
        return json({ id: row.id });
      },
      GET: (req) => {
        const after = Number(new URL(req.url).searchParams.get('after') ?? 0) || 0;
        const page = faces.filter((x) => x.id > after).slice(0, 200);
        return json({ flags: page, last: page.at(-1)?.id ?? after });
      },
    },
  };
}
```

- [ ] **Step 4: Run to pass.** Run: `bun test --timeout 60000 apps/server/test/relay-integrity.test.ts && pnpm --filter @saakshi/server typecheck`. Expected: PASS.

- [ ] **Step 5: Hand off** for commit: `feat(server): relay readiness reports and face flags, checked against seat bindings`.

---

### Task 8: Control — review queue and readiness board

**Model:** sonnet

**Files:**
- Create: `apps/server/src/review.ts`, `apps/server/src/readiness-view.ts`
- Test: `apps/server/test/review.test.ts`, `apps/server/test/readiness-view.test.ts`

**Interfaces:**
- Consumes: `SignedReadiness`, `SignedFace`, `openThumb`, `Verdict`, `IntegrityFinding` (Task 1).
- Produces:

```ts
// readiness-view.ts (browser-safe)
export interface SeatRow { cand: string; seatId: string; verdict: Verdict; at: number; findings: IntegrityFinding[]; stale: boolean }
export interface CentreReadiness { centre: string; verdict: Verdict; counts: Record<Verdict, number>; missing: number; seats: SeatRow[] }
export interface ReadinessBoard { at: number; centres: CentreReadiness[] }
export function readinessBoard(o: { at: number; centre: string; roster: string[]; seats: SignedReadiness[]; staleMs: number }): CentreReadiness
export const VERDICT_WORD: Record<Verdict, string>   // green 'Ready', amber 'Amber', review 'Review', block 'Blocked'
export function seatLine(r: SeatRow): string          // "C0001 · CEN042-S01 · Blocked — AnyDesk, overlay-sim"
// review.ts
export interface ReviewItem { id: string; cand: string; seatId: string; code: 'face-none'|'face-extra'; at: number; faces: number; expected: number;
  thumb: string /* data URL or '' */; decision?: 'cleared' | 'confirmed'; by?: string; decidedAt?: number }
export class ReviewQueue {
  constructor(o: { dir: string; reviewPriv: Uint8Array; retentionMs: number; now?: () => number });
  add(s: SignedFace & { id: number }): void;          // idempotent on relay id
  items(): ReviewItem[];                               // purges expired first; open items first, then newest
  decide(id: string, decision: 'cleared' | 'confirmed', by: string): ReviewItem;   // throws 'no such item' / 'already decided'
}
```

The review store is `review.jsonl` in control's dir (flag rows and decision rows). Thumbnails are opened on `add` and written as `thumbs/<id>.jpg`. `items()` deletes files whose `at` is older than `now − retentionMs`, and blanks their `thumb` (`thumb: ''`, detail kept). That is the "deleted after 30 days" rule.

- [ ] **Step 1: Write the failing tests**

`readiness-view.test.ts`:

```ts
import { expect, test } from 'bun:test';
import type { SignedReadiness } from '@saakshi/core/integrity';
import { readinessBoard, seatLine } from '../src/readiness-view.ts';

const sr = (cand: string, verdict: SignedReadiness['r']['verdict'], at = 900, names: string[] = []): SignedReadiness => ({ sig: '0'.repeat(128),
  r: { exam: 'E', shift: 'S1', attempt: 1, cand, seatId: `CEN042-S${cand.slice(-2)}`, keyEpoch: 1, at, verdict,
    findings: names.length ? [{ code: 'blocklisted', level: 'block', detail: '', names }] : [] } });

test('a centre is as bad as its worst fresh seat; missing and stale seats are counted, not hidden', () => {
  const c = readinessBoard({ at: 1_000, centre: 'CEN042', roster: ['C0001', 'C0002', 'C0003', 'C0004'], staleMs: 60_000,
    seats: [sr('C0001', 'block', 900, ['AnyDesk', 'overlay-sim']), sr('C0002', 'amber'), sr('C0003', 'green', -100_000)] });
  expect(c.verdict).toBe('block');
  expect(c.counts).toEqual({ green: 0, amber: 1, review: 1, block: 1 });   // the stale green counts as review
  expect(c.missing).toBe(1);
  expect(seatLine(c.seats[0])).toBe('C0001 · CEN042-S01 · Blocked — AnyDesk, overlay-sim');
});

test('amber only: Centre 42 is amber', () => {
  expect(readinessBoard({ at: 1_000, centre: 'CEN042', roster: ['C0001', 'C0002'], staleMs: 60_000, seats: [sr('C0001', 'green'), sr('C0002', 'amber')] }).verdict).toBe('amber');
});
```

`review.test.ts`:

```ts
import { expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sealThumb, thumbHashOf, type SignedFace } from '@saakshi/core/integrity';
import { newKeyPair } from '@saakshi/core/node';
import { ReviewQueue } from '../src/review.ts';

const ctx = { exam: 'E', shift: 'S1', attempt: 1, cand: 'C0001' }, DAY = 24 * 3600_000;
function flag(review: { pub: Uint8Array }, id: number, at: number): SignedFace & { id: number } {
  const thumb = sealThumb(review.pub, ctx, at, new Uint8Array([0xff, 0xd8, 0xff, 0xd9]));
  return { id, sig: '0'.repeat(128), f: { ...ctx, seatId: 'CEN042-S01', at, code: 'face-none', faces: 0, expected: 1, thumb, thumbHash: thumbHashOf(thumb) } };
}

test('flags open with the review key; a human decides; decisions persist across a restart', () => {
  const dir = mkdtempSync(join(tmpdir(), 'review-')), review = newKeyPair();
  let t = 40 * DAY;
  const q = new ReviewQueue({ dir, reviewPriv: review.priv, retentionMs: 30 * DAY, now: () => t });
  q.add(flag(review, 1, 39 * DAY)); q.add(flag(review, 1, 39 * DAY));
  expect(q.items()).toHaveLength(1);
  expect(q.items()[0].thumb.startsWith('data:image/jpeg;base64,')).toBe(true);
  expect(q.decide('1', 'cleared', 'REVIEWER-1').decision).toBe('cleared');
  expect(() => q.decide('1', 'confirmed', 'X')).toThrow(/already decided/);
  expect(() => q.decide('9', 'cleared', 'X')).toThrow(/no such item/);
  const again = new ReviewQueue({ dir, reviewPriv: review.priv, retentionMs: 30 * DAY, now: () => t });
  expect(again.items()[0].by).toBe('REVIEWER-1');
  rmSync(dir, { recursive: true, force: true });
});

test('thumbnails are deleted after the retention period; the record stays', () => {
  const dir = mkdtempSync(join(tmpdir(), 'review-')), review = newKeyPair();
  let t = 1 * DAY;
  const q = new ReviewQueue({ dir, reviewPriv: review.priv, retentionMs: 30 * DAY, now: () => t });
  q.add(flag(review, 1, 1 * DAY));
  expect(existsSync(join(dir, 'thumbs', '1.jpg'))).toBe(true);
  t = 32 * DAY;
  expect(q.items()[0].thumb).toBe('');
  expect(existsSync(join(dir, 'thumbs', '1.jpg'))).toBe(false);
  rmSync(dir, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run to fail.** Run: `bun test --timeout 60000 apps/server/test/review.test.ts apps/server/test/readiness-view.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement `readiness-view.ts`**

```ts
// The readiness board (plan §3.11, Act 1), pure and browser-safe: each centre is as bad as its worst seat. A seat that has not
// reported is "missing"; a report older than staleMs counts as review (we do not know it is still clean).
import type { IntegrityFinding, SignedReadiness, Verdict } from '@saakshi/core/integrity';

export interface SeatRow { cand: string; seatId: string; verdict: Verdict; at: number; findings: IntegrityFinding[]; stale: boolean }
export interface CentreReadiness { centre: string; verdict: Verdict; counts: Record<Verdict, number>; missing: number; seats: SeatRow[] }
export interface ReadinessBoard { at: number; centres: CentreReadiness[] }
export const VERDICT_WORD: Record<Verdict, string> = { green: 'Ready', amber: 'Amber', review: 'Review', block: 'Blocked' };
const RANK: Record<Verdict, number> = { green: 0, amber: 1, review: 2, block: 3 };

export function readinessBoard(o: { at: number; centre: string; roster: string[]; seats: SignedReadiness[]; staleMs: number }): CentreReadiness {
  const rows: SeatRow[] = o.seats.filter((s) => o.roster.includes(s.r.cand)).map(({ r }) => {
    const stale = o.at - r.at > o.staleMs;
    return { cand: r.cand, seatId: r.seatId, at: r.at, findings: r.findings, stale, verdict: stale && r.verdict !== 'block' ? 'review' : r.verdict };
  }).sort((a, b) => RANK[b.verdict] - RANK[a.verdict] || a.cand.localeCompare(b.cand));
  const counts: Record<Verdict, number> = { green: 0, amber: 0, review: 0, block: 0 };
  for (const r of rows) counts[r.verdict]++;
  const verdict = rows.reduce<Verdict>((w, r) => (RANK[r.verdict] > RANK[w] ? r.verdict : w), 'green');
  return { centre: o.centre, verdict, counts, missing: o.roster.length - rows.length, seats: rows };
}

export function seatLine(r: SeatRow): string {
  const names = [...new Set(r.findings.filter((f) => f.level !== 'info').flatMap((f) => f.names.length ? f.names : [f.code]))];
  return `${r.cand} · ${r.seatId} · ${VERDICT_WORD[r.verdict]}${r.stale ? ' (no recent report)' : ''}${names.length ? ` — ${names.join(', ')}` : ''}`;
}
```

In the first test, the stale row has verdict `green`, so it turns into `review`; the blocked row stays `block`. The expected counts in the test follow from that.

- [ ] **Step 4: Implement `review.ts`**

```ts
// The review queue (plan §3.5, §3.11): face flags from the relay, opened with control's review key; a human clears or confirms each.
// One thumbnail per flag, deleted after retentionMs (30 days); the record of the flag and the decision stays. No recognition, no video.
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openThumb, type SignedFace } from '@saakshi/core/integrity';

export interface ReviewItem {
  id: string; cand: string; seatId: string; code: 'face-none' | 'face-extra'; at: number; faces: number; expected: number;
  thumb: string; decision?: 'cleared' | 'confirmed'; by?: string; decidedAt?: number;
}
type Row = { t: 'flag'; item: Omit<ReviewItem, 'thumb' | 'decision' | 'by' | 'decidedAt'> } | { t: 'decide'; id: string; decision: 'cleared' | 'confirmed'; by: string; at: number };

export class ReviewQueue {
  #o: { dir: string; reviewPriv: Uint8Array; retentionMs: number; now: () => number };
  #items = new Map<string, ReviewItem>();
  #log: string;
  constructor(o: { dir: string; reviewPriv: Uint8Array; retentionMs: number; now?: () => number }) {
    this.#o = { ...o, now: o.now ?? Date.now };
    mkdirSync(join(o.dir, 'thumbs'), { recursive: true });
    this.#log = join(o.dir, 'review.jsonl');
    if (existsSync(this.#log)) for (const l of readFileSync(this.#log, 'utf8').split('\n').filter(Boolean)) this.#apply(JSON.parse(l) as Row);
  }
  #thumbPath = (id: string) => join(this.#o.dir, 'thumbs', `${id}.jpg`);
  #apply(r: Row): void {
    if (r.t === 'flag') this.#items.set(r.item.id, { ...r.item, thumb: '' });
    else { const i = this.#items.get(r.id); if (i) Object.assign(i, { decision: r.decision, by: r.by, decidedAt: r.at }); }
  }
  #write(r: Row): void { appendFileSync(this.#log, JSON.stringify(r) + '\n'); this.#apply(r); }

  add(s: SignedFace & { id: number }): void {
    const id = String(s.id);
    if (this.#items.has(id)) return;
    const f = s.f;
    if (f.thumb && this.#o.now() - f.at < this.#o.retentionMs) {
      try { writeFileSync(this.#thumbPath(id), openThumb(this.#o.reviewPriv, f, f.at, f.thumb)); } catch { /* not sealed to this key: keep the record, no image */ }
    }
    this.#write({ t: 'flag', item: { id, cand: f.cand, seatId: f.seatId, code: f.code, at: f.at, faces: f.faces, expected: f.expected } });
  }

  items(): ReviewItem[] {
    const now = this.#o.now();
    return [...this.#items.values()].map((i) => {
      const p = this.#thumbPath(i.id);
      if (now - i.at >= this.#o.retentionMs) { rmSync(p, { force: true }); return { ...i, thumb: '' }; }
      return { ...i, thumb: existsSync(p) ? `data:image/jpeg;base64,${readFileSync(p).toString('base64')}` : '' };
    }).sort((a, b) => Number(!!a.decision) - Number(!!b.decision) || b.at - a.at);
  }

  decide(id: string, decision: 'cleared' | 'confirmed', by: string): ReviewItem {
    const i = this.#items.get(id);
    if (!i) throw new Error('no such item');
    if (i.decision) throw new Error('already decided');
    this.#write({ t: 'decide', id, decision, by, at: this.#o.now() });
    return this.items().find((x) => x.id === id)!;
  }
}
```

- [ ] **Step 5: Run to pass.** Run the two tests and `pnpm --filter @saakshi/server typecheck`. Expected: PASS.

- [ ] **Step 6: Hand off** for commit: `feat(server): readiness board and face review queue with 30-day thumbnail retention`.

---

### Task 9: Integrity evidence names the tool

**Model:** haiku

**Files:**
- Modify: `apps/server/src/ingest.ts:265`, `apps/server/src/incidents.ts:195`
- Test: `apps/server/test/ingest-stage5.test.ts`

**Interfaces:**
- Consumes: `findingFromMeta` (Task 1).
- Produces: the `INTEGRITY` event `data` is now `{code, level, names}`, with `names` joined by `, ` (event data values are strings or numbers). The INTEGRITY_CRITICAL title reads `blocklisted at C0001's seat: AnyDesk, overlay-sim`.

- [ ] **Step 1: Write the failing test.** Copy the setup of the existing Stage 4 ingest test (`apps/server/test/ingest-stage4.test.ts`: `SimSeat` → `createIngest` on `:memory:`). Journal an `integrity` entry with meta `['blocklisted', 'block', 'AnyDesk (pid 4242)', ['AnyDesk', 'overlay-sim']]`, then:

```ts
test('an integrity entry becomes an INTEGRITY event carrying code, level and names', () => {
  // … SimSeat s appends unlock, then s.append('integrity', { item: '', state: '', answer: '', meta: ['blocklisted', 'block', 'AnyDesk (pid 4242)', ['AnyDesk', 'overlay-sim']] })
  const ev = ingest.events(0, 50).find((e) => e.code === 'INTEGRITY')!;
  expect(ev.data).toEqual({ code: 'blocklisted', level: 'block', names: 'AnyDesk, overlay-sim' });
});
test('the B.9 test-mode entry still reads as code test-mode, level info', () => { /* meta ['test-mode', 'journal key …'] → { code: 'test-mode', level: 'info', names: '' } */ });
```

Add one expectation to `incidents.test.ts` only if it already builds INTEGRITY events there. Otherwise assert the title in this file by feeding the event to `new Incidents(dir, OPS, {})` the way `incidents.test.ts` does.

- [ ] **Step 2: Run to fail.** Run: `bun test --timeout 60000 apps/server/test/ingest-stage5.test.ts`. Expected: FAIL (`data` is `{code}` only).

- [ ] **Step 3: Implement.** In `ingest.ts` replace the line:

```ts
if (hd.kind === 'integrity') { const f = findingFromMeta(body.meta); evidence.push(['INTEGRITY', key, hd.seq, JSON.stringify({ code: f?.code ?? String(body.meta[0] ?? ''), level: f?.level ?? '', names: (f?.names ?? []).join(', ') }), e.line, null]); }
```

In `incidents.ts`: ``title: `${d.code} at ${c}'s seat${d.names ? `: ${d.names}` : ''}` ``.

- [ ] **Step 4: Run to pass**, together with the Stage 4 tests: `bun test --timeout 60000 apps/server/test/ingest-stage5.test.ts apps/server/test/ingest-stage4.test.ts apps/server/test/incidents.test.ts`. Expected: PASS.

- [ ] **Step 5: Hand off** for commit: `feat(server): integrity events carry level and names; the incident names the tool`.

---

### Task 10: Seat screens — gate panel, re-check, face samples, provenance

**Model:** sonnet

**Files:**
- Create: `apps/seat/src/renderer/src/provenance.ts`
- Modify: `apps/seat/src/renderer/src/Gate.tsx`, `App.tsx`, `FaceChip.tsx`, `i18n.ts`, `styles.css`
- Test: `apps/seat/test/provenance.test.ts`

**Interfaces:**
- Consumes: `GateView`, `FaceSample`, `SeatApi.recheck/faceSample/blur`, `Action.prov`, `ExamBoot.gate/faces` (Task 1); `VERDICT_WORD` words are duplicated in `i18n.ts` (the renderer does not import server code).
- Produces: `class Provenance { move(x: number, y: number, trusted: boolean, t: number): void; click(trusted: boolean): void; key(trusted: boolean): void; take(t: number): ProvSummary }`. `take` returns the counts since the last `take` and resets them; `lastMoveMs` = `t −` the last move time, or `-1` → clamp to 0 when there was no move. Also `GatePanel({ gate, t, onRecheck })`, used in `Locked` and before Start.

- [ ] **Step 1: Write the failing test** `provenance.test.ts`

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Provenance } from '../src/renderer/src/provenance.ts';

test('path length, clicks, keys and untrusted events per answer; take() resets', () => {
  const p = new Provenance();
  p.move(0, 0, true, 0); p.move(3, 4, true, 10); p.move(6, 8, true, 20); p.click(true); p.key(true); p.key(false);
  assert.deepEqual(p.take(120), { moves: 3, pathPx: 10, clicks: 1, keys: 2, untrusted: 1, lastMoveMs: 100 });
  assert.deepEqual(p.take(200), { moves: 0, pathPx: 0, clicks: 0, keys: 0, untrusted: 0, lastMoveMs: 0 });
});

test('a teleporting click (no movement at all) is visible as moves 0, clicks 1', () => {
  const p = new Provenance();
  p.click(true);
  assert.deepEqual(p.take(5), { moves: 0, pathPx: 0, clicks: 1, keys: 0, untrusted: 0, lastMoveMs: 0 });
});
```

- [ ] **Step 2: Run to fail.** Run: `pnpm --filter @saakshi/seat exec node --test test/provenance.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement `provenance.ts`**

```ts
// Pointer-path provenance per answer (S5, Addendum D.5): how the pointer got to the answer. Recorded inside the sealed body for the
// radar (Stage 6); nothing is decided on the seat. Honest limit: remote-control tools usually inject trusted events.
import type { ProvSummary } from '@saakshi/core/integrity';

export class Provenance {
  #s: ProvSummary = { moves: 0, pathPx: 0, clicks: 0, keys: 0, untrusted: 0, lastMoveMs: 0 };
  #last?: { x: number; y: number; t: number };
  move(x: number, y: number, trusted: boolean, t: number): void {
    if (this.#last) this.#s.pathPx += Math.hypot(x - this.#last.x, y - this.#last.y);
    this.#last = { x, y, t };
    this.#s.moves++;
    if (!trusted) this.#s.untrusted++;
  }
  click(trusted: boolean): void { this.#s.clicks++; if (!trusted) this.#s.untrusted++; }
  key(trusted: boolean): void { this.#s.keys++; if (!trusted) this.#s.untrusted++; }
  take(t: number): ProvSummary {
    const out = { ...this.#s, pathPx: Math.round(this.#s.pathPx), lastMoveMs: this.#s.moves && this.#last ? Math.max(0, Math.round(t - this.#last.t)) : 0 };
    this.#s = { moves: 0, pathPx: 0, clicks: 0, keys: 0, untrusted: 0, lastMoveMs: 0 };
    return out;
  }
}
```

- [ ] **Step 4: The screens.**
  - **`App.tsx` (Exam).** Create one `Provenance` per question shown, in a `useRef`. Attach `pointermove` / `pointerdown` / `keydown` listeners on `document` in a `useEffect` (`e.isTrusted`, `performance.now()`); throttle `pointermove` to one per animation frame. Pass `prov: prov.current.take(performance.now())` in every `Action` built by `saveAndNext` / `markAndNext` / `clearResponse` (the objects are built in `App.tsx`: add the field there, not in `exam-state.ts`). Do **not** measure blur here: main measures it from the window's `blur`/`focus` events (Task 15), so a starved renderer cannot hide it.
  - **`Gate.tsx`.** New `GatePanel`:

```tsx
export function GatePanel({ gate, t }: { gate?: GateView; t: Strings }) {
  const [busy, setBusy] = useState(false), [g, setG] = useState(gate);
  useEffect(() => setG(gate), [gate]);
  async function recheck() { setBusy(true); setG(await window.saakshi.recheck()); setBusy(false); }
  const v = g?.verdict ?? 'review', shown = (g?.findings ?? []).filter((f) => f.level !== 'info' || f.code === 'assistive');
  return (
    <section className={`gate-panel ${v}`} aria-labelledby="gate-h">
      <h2 id="gate-h">{t.gateTitle}: <span className="word">{g?.checkedAt ? t.verdict[v] : t.gateChecking}</span></h2>
      {v === 'block' && <p role="alert">{t.gateBlocked}</p>}
      <ul>{shown.map((f) => <li key={`${f.code}:${f.names.join(',')}`} className={f.level}><span className="word">{t.level[f.level]}</span> {f.names.length ? f.names.join(', ') : ''} — {f.detail}</li>)}</ul>
      <button onClick={recheck} disabled={busy}>{t.gateRecheck}</button>
    </section>
  );
}
```

  Render `<GatePanel gate={boot.gate} t={t} />` in `Locked`, and in the `ready` start screen above the Start button. Disable Start with `aria-describedby` pointing at the alert when `boot.gate?.verdict === 'block'`. Findings are rendered as text children (React escapes them); never `dangerouslySetInnerHTML`.
  - **`FaceChip.tsx`.** Take `expected` (from `boot.faces ?? 1`). Every 500 ms, after `detectForVideo`, draw the video to a hidden 160×120 `<canvas>` **only when** `faces !== expected`, and call `window.saakshi.faceSample({ faces, at: Date.now(), thumb })`, where `thumb = canvas.toDataURL('image/jpeg', 0.7).split(',')[1]`. Samples with `faces === expected` go out without `thumb`. The chip is `warn` when `faces !== expected`. `off` mode stays untouched (no getUserMedia).
  - **`i18n.ts`** (EN and HI; keys `gateTitle`, `gateChecking`, `gateBlocked`, `gateRecheck`, `verdict: {green, amber, review, block}`, `level: {block, review, amber, info}`). EN: "Seat check", "Checking…", "This seat cannot start: close the programs named below, then press Re-check. Ask the invigilator if you need help.", "Re-check", "Ready / Amber / Review / Blocked", "Blocked / Review / Note / Allowed". HI: "सीट जाँच", "जाँच हो रही है…", "यह सीट शुरू नहीं हो सकती: नीचे लिखे प्रोग्राम बंद करें, फिर दोबारा जाँचें दबाएँ। मदद के लिए निरीक्षक से पूछें।", "दोबारा जाँचें", "तैयार / पीला / समीक्षा / रोका गया", "रोका गया / समीक्षा / सूचना / अनुमति".
  - **`styles.css`.** The level colours from Global Constraints, `.gate-panel .word { font-weight: 700 }`, and buttons at least `2.75rem`.

- [ ] **Step 5: Run.** `pnpm --filter @saakshi/seat test && pnpm --filter @saakshi/seat typecheck`. Expected: PASS. Then **manually** with the camera off: `pnpm --filter @saakshi/seat dev -- --test-mode --no-camera`. The seat check panel appears on the locked screen. Afterwards run `pkill -f 'Electron.*apps/seat'`.

- [ ] **Step 6: Hand off** for commit: `feat(seat): gate panel with re-check, face samples with thumbnails, pointer provenance (EN/HI)`.

---

### Task 11: Control UI — readiness board and review queue

**Model:** sonnet

**Files:**
- Modify: `apps/server/src/control.html`, `apps/server/src/control-page.ts`, `apps/server/src/control-view.ts`
- Test: `apps/server/test/control-view.test.ts` (extend)

**Interfaces:**
- Consumes: `ReadinessBoard`, `seatLine`, `VERDICT_WORD` (Task 8); `ReviewItem` (Task 8, `import type`); routes `GET /v1/readiness`, `GET /v1/review`, `POST /v1/review/decide` (Task 14).
- Produces: in `control-view.ts`: `readinessTile(c: CentreReadiness): { title: string; word: string; line: string; tone: Verdict; aria: string }` and `reviewCard(i: ReviewItem, now: number): { title: string; line: string; alt: string; canDecide: boolean }`.

- [ ] **Step 1: Write the failing tests** (append):

```ts
import { readinessTile, reviewCard } from '../src/control-view.ts';

test('readiness tile carries a word, counts and the missing seats', () => {
  const t = readinessTile({ centre: 'CEN042', verdict: 'amber', counts: { green: 46, amber: 1, review: 0, block: 0 }, missing: 1, seats: [] });
  expect(t).toEqual({ title: 'CEN042', word: 'Amber', tone: 'amber', line: '46 ready · 1 amber · 0 review · 0 blocked · 1 not reported',
    aria: 'CEN042: Amber. 46 ready, 1 amber, 0 review, 0 blocked, 1 not reported' });
});

test('review card: a face flag reads plainly and says what the image is', () => {
  const c = reviewCard({ id: '1', cand: 'C0002', seatId: 'CEN042-S02', code: 'face-extra', at: 0, faces: 3, expected: 2, thumb: '' }, 90_000);
  expect(c).toEqual({ title: 'C0002 · CEN042-S02', line: '3 faces seen, 2 expected (scribe) · 1:30 ago · awaiting review',
    alt: 'no image kept', canDecide: true });
});

test('the control page keeps the type scale', () => { expect(typeScaleOk(readFileSync(new URL('../src/control.html', import.meta.url), 'utf8'))).toBe(true); });
```

(Reuse the file's existing `typeScaleOk` import and `readFileSync`, if already imported.)

- [ ] **Step 2: Run to fail.** Run: `bun test --timeout 60000 apps/server/test/control-view.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** in `control-view.ts`:

```ts
export function readinessTile(c: CentreReadiness) {
  const k = c.counts, line = `${k.green} ready · ${k.amber} amber · ${k.review} review · ${k.block} blocked · ${c.missing} not reported`;
  return { title: c.centre, word: VERDICT_WORD[c.verdict], tone: c.verdict, line, aria: `${c.centre}: ${VERDICT_WORD[c.verdict]}. ${line.replaceAll(' ·', ',')}` };
}
export function reviewCard(i: ReviewItem, now: number) {
  const what = i.code === 'face-none' ? 'no face for 10 s or more' : `${i.faces} faces seen, ${i.expected} expected${i.expected > 1 ? ' (scribe)' : ''}`;
  const state = i.decision ? `${i.decision} by ${i.by}` : 'awaiting review';
  return { title: `${i.cand} · ${i.seatId}`, line: `${what} · ${mmss(now - i.at)} ago · ${state}`, alt: i.thumb ? `face check frame, ${what}` : 'no image kept', canDecide: !i.decision };
}
```

(`mmss` exists in `incidents.ts`; import it with `import { mmss } from './incidents.ts'` only if that module is browser-safe. Otherwise copy the three-line helper into `control-view.ts`.)

`control.html`: a new `<section aria-labelledby="clean-h"><h2 id="clean-h">Clean seats only</h2>` with `<ul id="readiness" aria-label="Seat readiness by centre"></ul>`, `<ol id="readiness-seats" aria-label="Seats needing attention"></ol>`, `<h3>Review queue</h3><form id="review-form"><label>Decide as <input id="review-by" required size="14" placeholder="e.g. REVIEWER-1" /></label></form><ol id="review"></ol>`. Put it **before** "Start on time", because Act 1 comes first.

`control-page.ts`: poll `/v1/readiness` and `/v1/review` every 2 s. Render tiles with `textContent` and `data-tone`. The seat list shows `seatLine` for every non-green seat. Each review item shows an `<img alt>` (only when `thumb` starts with `data:image/jpeg;base64,`; set `src` from that string alone) and two buttons, "Clear (no concern)" and "Confirm (refer to superintendent)", which POST `/v1/review/decide` with the `review-by` value. The level colours come from Global Constraints (green uses `#0d652d` on `#e6f4ea`).

- [ ] **Step 4: Run to pass.** Run the test file and `pnpm --filter @saakshi/server typecheck`. Expected: PASS.

- [ ] **Step 5: Hand off** for commit: `feat(control): readiness board and face review queue`.

---

### Task 12: Provision — integrity policy, review key, accommodations

**Model:** sonnet

**Files:**
- Modify: `tools/provision.ts`
- Test: `apps/server/test/provision.test.ts` (extend)

**Interfaces:**
- Consumes: `INTEGRITY_DEFAULT`, `IntegrityPolicy`, `Accommodation`, `FILES.reviewKey` (Task 1); `newKeyPair` (core `node.ts`).
- Produces: `ProvisionOpts.relayHosts?: Record<string, string>` (centre → `host:port` the seats use; default `127.0.0.1:7070` for every centre), `ProvisionOpts.acc?: Record<string, Accommodation>`. `ProvisionOpts.integrity?: Partial<IntegrityPolicy>` is merged over `INTEGRITY_DEFAULT`; the computed `egress` and `reviewPub` win. Task 17 uses `{ probeMs: 2000 }`. Add a test line: the opened policy's `integrity.probeMs === 2000`. Every policy carries `integrity` with `egress: [relayHost]` and `reviewPub`. `control/review.key.json` (`{priv, pub}` hex) is written once and reused if present. **Demo default:** the demo centre's second candidate (sorted) gets `{ faces: 2, assistive: ['NVDA', 'VoiceOver'] }` unless `acc` is given.

- [ ] **Step 1: Write the failing test** (append):

```ts
test('Stage 5: each policy carries a signed integrity section; the review key is written once; the demo scribe seat has 2 faces', async () => {
  const out = mkdtempSync(join(tmpdir(), 'prov5-'));
  const d = provision({ out, keys, cands: cands(), relayHosts: { CEN042: '192.168.1.10:7070' } });
  const rk = JSON.parse(readFileSync(join(out, FILES.reviewKey), 'utf8'));
  const p = openPolicy(JSON.parse(readFileSync(join(out, FILES.policy('CEN042')), 'utf8')), verifier(hexToBytes(keys.authority.pub)), { exam: d.exam, shift: d.shift });
  expect(p.integrity!.reviewPub).toBe(rk.pub);
  expect(p.integrity!.egress).toEqual(['192.168.1.10:7070']);
  const second = Object.keys(p.roster).sort()[1];
  expect(p.roster[second].acc).toEqual({ faces: 2, assistive: ['NVDA', 'VoiceOver'] });
  provision({ out, keys, cands: cands() });
  expect(JSON.parse(readFileSync(join(out, FILES.reviewKey), 'utf8')).pub).toBe(rk.pub);
  rmSync(out, { recursive: true, force: true });
});
```

(`cands()` is whatever small cohort helper the existing `provision.test.ts` uses; reuse it.)

- [ ] **Step 2: Run to fail.** Run: `bun test --timeout 60000 apps/server/test/provision.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement.** In `provision()`, before the per-centre policy loop:

```ts
const rkPath = join(o.out, FILES.reviewKey);
if (!existsSync(rkPath)) { const k = newKeyPair(); write(FILES.reviewKey, JSON.stringify({ priv: toHex(k.priv), pub: toHex(k.pub) })); }
const reviewPub = (JSON.parse(readFileSync(rkPath, 'utf8')) as { pub: string }).pub;
const demoRoster = [...(byCentre.get(demo) ?? [])].map(([c]) => c).sort();
const acc: Record<string, Accommodation> = o.acc ?? (demoRoster[1] ? { [demoRoster[1]]: { faces: 2, assistive: ['NVDA', 'VoiceOver'] } } : {});
```

In the loop, set `roster` entries to `{ ...entry, ...(acc[cand] ? { acc: acc[cand] } : {}) }` and add `integrity: { ...INTEGRITY_DEFAULT, egress: [o.relayHosts?.[centre] ?? '127.0.0.1:7070'], reviewPub }` to the `Policy`. `write` must create `control/` (it already creates parent directories for `pseudKey`; check it and reuse). Keep the file `node:*`-and-core only.

- [ ] **Step 4: Run to pass**, plus the whole server suite (policies are read everywhere): `bun test --timeout 60000 apps/server`. Expected: PASS, except the port-binding tests inside the sandbox; re-run those unsandboxed.

- [ ] **Step 5: Hand off** for commit: `feat(tools): provision signs the integrity policy, writes control's review key, marks the demo scribe seat`.

---

### Task 13: Seat gate and monitor; probe host; self-test; exam provenance

**Model:** opus

**Files:**
- Create: `apps/seat/src/main/probe-host.ts`, `apps/seat/src/main/gate.ts`
- Modify: `apps/seat/src/main/probes.ts`, `apps/seat/src/main/seat.ts`, `apps/seat/src/main/exam.ts`
- Test: `apps/seat/test/gate.test.ts`

**Interfaces:**
- Consumes: Tasks 1–5.
- Produces:

```ts
// probe-host.ts: the real collector (I/O). Host inputs come from Electron (index.ts) or from tests.
export interface HostInputs { displays: () => number; onBattery: () => boolean; camera: () => 'on' | 'none' | 'off'; skewMs: () => number | null; dataDir: string }
export async function collect(h: HostInputs, timeoutMs?: number): Promise<ProbeSnapshot>
// gate.ts
export interface GateOpts {
  pol: IntegrityPolicy; acc: Accommodation; defaulted: boolean; testMode: boolean; ctx: Ctx; seatId: string;
  collect: () => Promise<ProbeSnapshot>; now?: () => number;
  /** the exam is running: journal this finding (returns the seq), else undefined */ journal: (f: IntegrityFinding) => number | undefined;
  /** signed readiness to the relay; false = not delivered */ report: (r: Readiness) => Promise<boolean>;
  /** signed face flag to the relay; false = not delivered (kept for retry) */ face: (f: FaceFlag) => Promise<boolean>;
  key: () => { keyEpoch: number } | undefined;
}
export class Gate {
  constructor(o: GateOpts);
  view(): GateView; blocked(): boolean;
  check(): Promise<GateView>;          // collect (timed out at pol.probeMs) → evaluate → journal new findings → report
  blur(ms: number): void;              // ≥ pol.blurMs → a 'blur' review finding, journaled
  faceSample(s: FaceSample): void;     // FaceMonitor → sealed FaceFlag → journal + send (retry queue)
  retry(): Promise<void>;              // resend undelivered face flags and the last report
}
// exam.ts: ExamSession.note(f: IntegrityFinding): number | undefined  (journals an `integrity` entry; undefined before start / after submit)
//          act(a) puts provArray(a.prov) in the second meta slot (Addendum D.5)
// seat.ts: SeatOpts.integrity?: { collect: () => Promise<ProbeSnapshot> }; Seat.recheck(): Promise<GateView>; Seat.faceSample(s); Seat.blur(ms)
//          boot().gate, boot().faces; start() refuses with the names while blocked; the gate runs every pol.probeMs from the locked phase on.
```

- [ ] **Step 1: Write the failing tests** `apps/seat/test/gate.test.ts`

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { INTEGRITY_DEFAULT, openThumb, type FaceFlag, type IntegrityFinding, type IntegrityPolicy, type Readiness } from '@saakshi/core/integrity';
import { newKeyPair } from '@saakshi/core/node';
import { Gate } from '../src/main/gate.ts';
import type { ProbeSnapshot } from '../src/main/integrity.ts';

const review = newKeyPair();
const pol: IntegrityPolicy = { ...INTEGRITY_DEFAULT, egress: ['127.0.0.1:7070'], reviewPub: Buffer.from(review.pub).toString('hex') };
const ctx = { exam: 'E', shift: 'S1', attempt: 1, cand: 'C0001' };
const ok = <T>(value: T) => ({ status: 'ok' as const, value });
const snap = (procs: string[] = [], excluded: number[] = []): ProbeSnapshot => ({ platform: 'win32', at: 0,
  procs: ok(procs.map((name, i) => ({ pid: 100 + i, name }))), captureExcluded: ok(excluded), remoteSession: ok(false),
  vm: ok({ hv: false, model: 'x', bios: '', macs: [] }), egress: ok([]), displays: 1, camera: 'on', onBattery: false, freeBytes: 50e9, skewMs: 0 });

function harness(first: ProbeSnapshot, o: Partial<{ started: boolean; faceUp: boolean }> = {}) {
  let s = first, t = 1_000, started = o.started ?? false, faceUp = o.faceUp ?? true;
  const journaled: IntegrityFinding[] = [], reports: Readiness[] = [], faces: FaceFlag[] = [];
  const g = new Gate({ pol, acc: {}, defaulted: false, testMode: false, ctx, seatId: 'CEN042-S01', now: () => t, key: () => ({ keyEpoch: 1 }),
    collect: async () => s, journal: (f) => (started ? (journaled.push(f), journaled.length) : undefined),
    report: async (r) => { reports.push(r); return true; }, face: async (f) => { if (!faceUp) return false; faces.push(f); return true; } });
  return { g, journaled, reports, faces, set: (x: ProbeSnapshot) => { s = x; }, tick: (ms: number) => { t += ms; }, start: () => { started = true; }, relay: (up: boolean) => { faceUp = up; } };
}

test('Act 1: blocked by name before start; closing the tools turns the seat green; every check is reported', async () => {
  const h = harness(snap(['C:\\t\\AnyDesk.exe', 'C:\\s\\overlay-sim.exe'], [101]));
  const v = await h.g.check();
  assert.equal(v.verdict, 'block');
  assert.equal(h.g.blocked(), true);
  assert.deepEqual(v.findings.flatMap((f) => f.names).sort(), ['AnyDesk', 'overlay-sim']);
  h.set(snap()); h.tick(10_000);
  assert.equal((await h.g.check()).verdict, 'green');
  assert.deepEqual(h.reports.map((r) => r.verdict), ['block', 'green']);
  assert.equal(h.journaled.length, 0);                                   // nothing is journaled before the exam starts
});

test('Review Focus #2: a persistent finding is journaled once; cleared and back is journaled again', async () => {
  const h = harness(snap(), { started: true });
  await h.g.check();
  h.set(snap(['AnyDesk.exe']));
  for (let i = 0; i < 5; i++) { h.tick(10_000); await h.g.check(); }
  assert.equal(h.journaled.filter((f) => f.code === 'blocklisted').length, 1);
  h.set(snap()); h.tick(10_000); await h.g.check();
  h.set(snap(['AnyDesk.exe'])); h.tick(10_000); await h.g.check();
  assert.equal(h.journaled.filter((f) => f.code === 'blocklisted').length, 2);
  assert.equal(h.g.blocked(), false, 'during the exam nothing blocks');
});

test('Review Focus #1: a hanging collect() times out; the gate reports probe-unknown and keeps monitoring', async () => {
  const g = new Gate({ pol: { ...pol, probeMs: 1_000 }, acc: {}, defaulted: false, testMode: false, ctx, seatId: 'S', key: () => ({ keyEpoch: 1 }),
    collect: () => new Promise(() => {}), journal: () => undefined, report: async () => true, face: async () => true });
  const t0 = Date.now(), v = await g.check();
  assert.ok(Date.now() - t0 < 2_500);
  assert.equal(v.verdict, 'review');
  assert.deepEqual(v.findings.map((f) => f.code), ['probe-unknown']);
});

test('Review Focus #4: a face flag is retried until the relay takes it; the thumb opens only with the review key', async () => {
  const h = harness(snap(), { started: true, faceUp: false });
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64');
  for (let i = 0; i <= 20; i++) h.g.faceSample({ faces: 0, at: 1_000 + i * 500, thumb: jpeg });
  await h.g.retry();
  assert.equal(h.faces.length, 0);
  assert.deepEqual(h.journaled.map((f) => f.code), ['face-none']);
  h.relay(true); await h.g.retry(); await h.g.retry();
  assert.equal(h.faces.length, 1);
  assert.deepEqual([...openThumb(review.priv, ctx, h.faces[0].at, h.faces[0].thumb)], [0xff, 0xd8, 0xff, 0xd9]);
  assert.equal(h.journaled[0].names[0], h.faces[0].thumbHash);
});

test('window blur over 3 s is a review finding; shorter blurs are ignored', async () => {
  const h = harness(snap(), { started: true });
  h.g.blur(2_000); h.g.blur(4_500);
  assert.deepEqual(h.journaled.map((f) => [f.code, f.level]), [['blur', 'review']]);
});
```

Also extend `apps/seat/test/exam.test.ts` with one case: `act({… prov: {moves: 3, pathPx: 10, clicks: 1, keys: 0, untrusted: 0, lastMoveMs: 40}})` journals meta `[dwell, ['prov', 3, 10, 1, 0, 0, 40]]`, and `note(finding)` before `start()` returns `undefined`.

- [ ] **Step 2: Run to fail.** Run: `pnpm --filter @saakshi/seat exec node --test test/gate.test.ts test/exam.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement `gate.ts`**

```ts
// The integrity gate and in-exam monitor (plan §3.4–§3.5). Before start a `block` verdict refuses start(); during the exam findings are
// only journaled (never auto-submit, never lock out). Each distinct finding (code + names) is journaled once until it clears. Face flags
// carry one thumbnail sealed to control's review key; undelivered flags are retried.
import { hexToBytes, randomBytes } from '@saakshi/core/bytes';
import { findingKey, sealThumb, thumbHashOf, verdictOf, type Accommodation, type FaceFlag, type IntegrityFinding, type IntegrityPolicy, type Readiness } from '@saakshi/core/integrity';
import type { Ctx } from '@saakshi/core/protocol';
import type { FaceSample, GateView } from '../shared/ipc.ts';
import { FaceMonitor } from './face.ts';
import { evaluate, type ProbeSnapshot } from './integrity.ts';

export interface GateOpts { /* as in Interfaces above */
  pol: IntegrityPolicy; acc: Accommodation; defaulted: boolean; testMode: boolean; ctx: Ctx; seatId: string;
  collect: () => Promise<ProbeSnapshot>; now?: () => number;
  journal: (f: IntegrityFinding) => number | undefined; report: (r: Readiness) => Promise<boolean>; face: (f: FaceFlag) => Promise<boolean>;
  key: () => { keyEpoch: number } | undefined;
}
const unknownAll = (): IntegrityFinding[] => [{ code: 'probe-unknown', level: 'review', detail: 'the seat check did not finish in time', names: ['all'] }];

export class Gate {
  #o: GateOpts; #now: () => number; #view: GateView = { verdict: 'review', findings: [], checkedAt: 0 };
  #journaled = new Set<string>(); #faces: FaceMonitor; #outbox: FaceFlag[] = []; #lastReport?: Readiness; #reported = true; #busy?: Promise<GateView>;
  constructor(o: GateOpts) {
    this.#o = o; this.#now = o.now ?? Date.now;
    this.#faces = new FaceMonitor({ expected: o.acc.faces ?? 1, ...o.pol.face });
  }
  view(): GateView { return this.#view; }
  /** Only before the exam: a started exam is never blocked (the journal decides: note() returns undefined before start). */
  blocked(): boolean { return this.#view.verdict === 'block'; }

  check(): Promise<GateView> { return (this.#busy ??= this.#check().finally(() => { this.#busy = undefined; })); }
  async #check(): Promise<GateView> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<undefined>((r) => { timer = setTimeout(() => r(undefined), this.#o.pol.probeMs); });
    const snap = await Promise.race([this.#o.collect().catch(() => undefined), timeout]);
    clearTimeout(timer);
    const findings = snap ? evaluate(snap, this.#o.pol, this.#o.acc, { testMode: this.#o.testMode, defaulted: this.#o.defaulted }) : unknownAll();
    const now = new Set(findings.map(findingKey));
    for (const f of findings) {
      const k = findingKey(f);
      if (f.level !== 'info' && !this.#journaled.has(k) && this.#o.journal(f) !== undefined) this.#journaled.add(k);
    }
    for (const k of [...this.#journaled]) if (!now.has(k) && !k.startsWith('face-') && !k.startsWith('blur')) this.#journaled.delete(k);   // cleared: may be journaled again
    this.#view = { verdict: verdictOf(findings), findings, checkedAt: this.#now() };
    const key = this.#o.key();
    if (key) { this.#lastReport = { ...this.#o.ctx, seatId: this.#o.seatId, keyEpoch: key.keyEpoch, at: this.#view.checkedAt, verdict: this.#view.verdict, findings }; this.#reported = await this.#o.report(this.#lastReport).catch(() => false); }
    return this.#view;
  }

  blur(ms: number): void {
    if (ms < this.#o.pol.blurMs) return;
    this.#o.journal({ code: 'blur', level: 'review', detail: `the exam window lost focus for ${Math.round(ms / 1000)} s`, names: [] });
  }

  faceSample(s: FaceSample): void {
    const d = this.#faces.sample(s);
    if (!d) return;
    const thumb = d.thumb && this.#o.pol.reviewPub ? sealThumb(hexToBytes(this.#o.pol.reviewPub), this.#o.ctx, d.at, Buffer.from(d.thumb, 'base64')) : '';
    const flag: FaceFlag = { ...this.#o.ctx, seatId: this.#o.seatId, at: d.at, code: d.code, faces: d.faces, expected: d.expected, thumb, thumbHash: thumbHashOf(thumb) };
    this.#o.journal({ code: d.code, level: 'review', detail: d.code === 'face-none' ? 'no face for 10 s or more' : `${d.faces} faces, ${d.expected} expected`, names: flag.thumbHash ? [flag.thumbHash] : [] });
    this.#outbox.push(flag);
    void this.retry();
  }

  async retry(): Promise<void> {
    const pending = this.#outbox.splice(0);
    for (const f of pending) if (!(await this.#o.face(f).catch(() => false))) this.#outbox.push(f);
    if (!this.#reported && this.#lastReport) this.#reported = await this.#o.report(this.#lastReport).catch(() => false);
  }
}
```

`randomBytes` is unused; drop the import. The `#busy` promise is the concurrency guard: two callers during one check (timer and Re-check button) share one result.

- [ ] **Step 4: Implement `probe-host.ts`.** It moves the `winProbes`/`macProbes` bodies here and returns a `ProbeSnapshot`:
  - **processes.** Windows: `tasklist /FO CSV /NH` → `{pid, name}`. macOS: `/bin/ps -axo pid=,comm=`. For each unique `/Applications/…/X.app/` prefix, read `CFBundleIdentifier` with `/usr/libexec/PlistBuddy -c 'Print CFBundleIdentifier' <app>/Contents/Info.plist`, cached in a module `Map`, 1 s timeout, failures ignored.
  - **captureExcluded.** Windows: `(await import('./probes-win.ts')).captureExcludedWindows().excluded.map((w) => w.pid)`. macOS: `(await import('./probes-mac.ts')).captureExcludedWindowsMac().excluded.map((w) => w.pid)`.
  - **remoteSession.** Windows: `remoteSession()`. macOS: `false` (screensharingd is judged from procs in `evaluate`).
  - **vm.** macOS: `sysctl -n kern.hv_vmm_present` → hv, `sysctl -n hw.model` → model, `ioreg -rd1 -c IOPlatformExpertDevice` → `parseIoregPlatform` → bios. Windows: hv `false` (no cheap reliable signal without CPUID; honest), model from `reg query "HKLM\HARDWARE\DESCRIPTION\System\BIOS" /v SystemProductName`, bios from `reg query "HKLM\HARDWARE\DESCRIPTION\System\BIOS"` → `parseRegBios`. Both: macs from `os.networkInterfaces()` (non-internal `mac`s).
  - **egress.** macOS: `netstat -anp tcp` → `parseNetstat(…, 'darwin')`. Windows: `netstat -ano -p TCP` → `parseNetstat(…, 'win32')`.
  - **freeBytes:** `(await statfs(h.dataDir)).bavail * bsize` (`node:fs/promises`).
  - **displays, onBattery, camera, skewMs:** from `HostInputs`.
  - Every probe goes through `probe()` with `run(…, 5000)`, and all probes run in parallel with `Promise.all`.

  `probes.ts` becomes the self-test wrapper: `runSelftest()` calls `collect()` with neutral host inputs (`displays: () => 1, onBattery: () => false, camera: () => 'off', skewMs: () => null, dataDir: tmpdir()`) and returns the old `Selftest` shape with `probes` = the snapshot's `ProbeResult` fields, `ok` = every `ProbeResult` is `ok`. It also exports `runGateSelftest(expect: string[]): Promise<{ ok: boolean; verdict; findings; missing: string[] }>`: `evaluate(snapshot, {...INTEGRITY_DEFAULT, egress: [], reviewPub: ''}, {}, {testMode: false, defaulted: false})`, with `ok` = every expected name (case-insensitive) appears in the names of a `block` finding. The CI gate test uses it (Task 18).

- [ ] **Step 5: Wire into `exam.ts` and `seat.ts`.**
  - `exam.ts`: in `act()`, use `meta: [Math.max(0, Math.round(a.dwellMs)), provArray(a.prov)]`. Add `note(f: IntegrityFinding): number | undefined { if (!this.started || this.submitted) return undefined; return this.#append('integrity', { ...EMPTY, meta: findingMeta(f) }); }`.
  - `seat.ts`: when `#tryPackage` loads the policy and `this.#o.integrity` is set, build the gate:
    ```ts
    const { pol, defaulted } = integrityOf(p.integrity), acc = p.roster[this.#o.ctx.cand]?.acc ?? {};
    this.#gate = new Gate({ pol, acc, defaulted, testMode: this.#o.testMode, ctx: this.#o.ctx, seatId: this.#o.seatId, now: this.#o.now,
      collect: this.#o.integrity.collect, key: () => (this.#id?.key ? { keyEpoch: this.#id.keyEpoch } : undefined),
      journal: (f) => { const s = this.#exam?.note(f); if (s !== undefined) this.#sync?.kick(); return s; },
      report: (r) => this.#signedPost('/v1/readiness', { r, sig: this.#sign(readinessArray(r)) }),
      face: (f) => this.#signedPost('/v1/faces', { f, sig: this.#sign(faceArray(f)) }) });
    ```
    `#sign(a)` = `toHex(signer(this.#id!.key!)(msg(a)))`. `#signedPost` = `httpPost(this.#o.relayUrl, 5000, this.#o.fetch)` → `status === 200`. In `#tick`, run `await this.#gate.check()` when `this.#id?.key` exists and `now − view().checkedAt ≥ pol.probeMs` (and also right after enrolment), then `await this.#gate.retry()`, and emit on a verdict change.
  - `start()`: `if (this.#gate?.blocked()) return { ok: false, error: `This seat cannot start: ${names}. Close them and press Re-check.` }`, with the block findings' names joined. The gate's `blocked()` is only consulted **before** `start()` succeeds. Once started, the seat never refuses `act`/`submit` for integrity reasons.
  - `boot()` adds `gate: this.#gate?.view()` and `faces: acc.faces ?? 1`. Add `recheck()`, `faceSample(s)` and `blur(ms)`, which delegate to the gate (and are no-ops without one).
  - Seats built **without** `integrity` (act2/act3 and older tests) behave exactly as before.

- [ ] **Step 6: Run to pass.** Run: `pnpm --filter @saakshi/seat test && pnpm --filter @saakshi/seat typecheck`. Expected: PASS, including the Stage 4 `move.test.ts`, `seat.test.ts` and `sync.test.ts` unchanged.

- [ ] **Step 7: Hand off** for commit: `feat(seat): integrity gate and in-exam monitor — probe host, blocks before start, journals once, signed readiness, sealed face flags`.

---

### Task 14: Control integrity routes and polling

**Model:** sonnet

**Files:**
- Create: `apps/server/src/integrity-routes.ts`
- Test: `apps/server/test/integrity-routes.test.ts`

**Interfaces:**
- Consumes: `ReviewQueue`, `readinessBoard` (Task 8); the relay routes of Task 7 (over HTTP, `fetch` injected).
- Produces: `integrityRoutes(o: { relayUrl: string; dir: Directory; centre: string; controlDir: string; reviewPriv: Uint8Array; retentionMs: number; fetch?: typeof fetch; now?: () => number; staleMs?: number }): { routes: Routes; poll(): Promise<void>; start(everyMs?: number): void; stop(): void }`. `poll()` fetches `GET {relay}/v1/readiness` (kept as the latest) and `GET {relay}/v1/faces?after=<cursor>` (added to the queue). An unreachable relay keeps the last board, and the board says `relayReachable: false`. `GET /v1/readiness` returns `{ at, relayReachable, centres: [readinessBoard(… centre …)] }`. The demo relay serves one centre; the 99 simulated centres report nothing and are not listed (honest).

- [ ] **Step 1: Write the failing test** with a fake `fetch` that serves the two relay routes from arrays:

```ts
test('polls the relay, builds the board, queues face flags once, and decides', async () => {
  // fake relay: readiness [C0001 block (AnyDesk)], faces page [{id:1, …}] then []
  const x = integrityRoutes({ relayUrl: 'http://relay', dir, centre: 'CEN042', controlDir, reviewPriv: review.priv, retentionMs: 30 * DAY, fetch: fake, now: () => 1_000 });
  await x.poll(); await x.poll();
  const board = await (await (x.routes['/v1/readiness'] as any).GET(new Request('http://c/v1/readiness'))).json();
  expect(board.centres[0].verdict).toBe('block');
  expect(board.relayReachable).toBe(true);
  const items = (await (await (x.routes['/v1/review'] as any).GET(new Request('http://c/v1/review'))).json()).items;
  expect(items).toHaveLength(1);
  const r = await (x.routes['/v1/review/decide'] as any).POST(new Request('http://c/v1/review/decide', { method: 'POST', body: JSON.stringify({ id: '1', decision: 'cleared', by: 'REVIEWER-1' }) }));
  expect((await r.json()).decision).toBe('cleared');
  expect((await (x.routes['/v1/review/decide'] as any).POST(new Request('http://c/', { method: 'POST', body: JSON.stringify({ id: '1', decision: 'maybe', by: 'X' }) }))).status).toBe(400);
});
test('an unreachable relay keeps the last board and says so', async () => { /* fake throws after the first poll → relayReachable false, verdict unchanged */ });
```

Write the fake with the same `dir` (a minimal `Directory` whose `cands` put C0001–C0003 at CEN042) and `review = newKeyPair()`.

- [ ] **Step 2: Run to fail.** Run: `bun test --timeout 60000 apps/server/test/integrity-routes.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// Control routes added in Stage 5 (plan §3.11): the readiness board and the face review queue, fed by polling the demo relay.
import { join } from 'node:path';
import { rosterOf, type Directory } from '@saakshi/core/directory';
import type { SignedFace, SignedReadiness } from '@saakshi/core/integrity';
import { readinessBoard } from './readiness-view.ts';
import { ReviewQueue } from './review.ts';
import type { Routes } from './serve.ts';

const json = (body: unknown, status = 200) => Response.json(body, { status });

export function integrityRoutes(o: { relayUrl: string; dir: Directory; centre: string; controlDir: string; reviewPriv: Uint8Array; retentionMs: number;
  fetch?: typeof fetch; now?: () => number; staleMs?: number }) {
  const f = o.fetch ?? fetch, now = o.now ?? Date.now;
  const queue = new ReviewQueue({ dir: join(o.controlDir, 'review'), reviewPriv: o.reviewPriv, retentionMs: o.retentionMs, now });
  let seats: SignedReadiness[] = [], reachable = false, cursor = 0, timer: ReturnType<typeof setInterval> | undefined;
  const get = async <T>(path: string): Promise<T> => {
    const r = await f(`${o.relayUrl}${path}`, { signal: AbortSignal.timeout(2_000) });
    if (!r.ok) throw new Error(`${path} answered ${r.status}`);
    return (await r.json()) as T;
  };
  async function poll(): Promise<void> {
    try {
      seats = (await get<{ seats: SignedReadiness[] }>('/v1/readiness')).seats;
      for (;;) {
        const page = await get<{ flags: (SignedFace & { id: number })[]; last: number }>(`/v1/faces?after=${cursor}`);
        for (const x of page.flags) queue.add(x);
        if (!page.flags.length || page.last <= cursor) break;
        cursor = page.last;
      }
      reachable = true;
    } catch { reachable = false; }
  }
  const routes: Routes = {
    '/v1/readiness': { GET: () => json({ at: now(), relayReachable: reachable,
      centres: [readinessBoard({ at: now(), centre: o.centre, roster: rosterOf(o.dir, o.centre), seats, staleMs: o.staleMs ?? 60_000 })] }) },
    '/v1/review': { GET: () => json({ items: queue.items() }) },
    '/v1/review/decide': { POST: async (req) => {
      const b = (await req.json().catch(() => ({}))) as { id?: unknown; decision?: unknown; by?: unknown };
      if (typeof b.id !== 'string' || (b.decision !== 'cleared' && b.decision !== 'confirmed') || typeof b.by !== 'string' || !b.by.trim() || b.by.length > 64)
        return json({ error: 'need {id, decision: cleared|confirmed, by}' }, 400);
      try { return json(queue.decide(b.id, b.decision, b.by.trim())); } catch (e) { return json({ error: (e as Error).message }, (e as Error).message === 'no such item' ? 404 : 409); }
    } },
  };
  return { routes, poll, start: (everyMs = 1_000) => { timer = setInterval(() => void poll(), everyMs); }, stop: () => clearInterval(timer) };
}
```

- [ ] **Step 4: Run to pass.** Run the test and `pnpm --filter @saakshi/server typecheck`. Expected: PASS.

- [ ] **Step 5: Hand off** for commit: `feat(control): readiness and review routes, polling the relay`.

---

### Task 15: Electron wiring — hardening, IPC, self-tests, overlay-sim

**Model:** opus

**Files:**
- Modify: `apps/seat/src/main/index.ts`
- Create: `tools/overlay-sim.sh`

**Interfaces:**
- Consumes: `launchRefusal`, `windowMode`, `E2E` (Task 6); `collect` (Task 13); `runSelftest`, `runGateSelftest` (Task 13); `SeatOpts.integrity`, `Seat.recheck/faceSample/blur` (Task 13).
- Produces: the command-line contract that CI (Task 18) and the demo rely on:
  - `--probe-selftest [--out f]`: unchanged (exit 0 iff every probe is `ok`).
  - `--gate-selftest --expect anydesk,overlay-sim [--out f]`: prints JSON; exit 0 iff every expected name is named by a `block` finding, 1 otherwise.
  - `--fuse-check --out f`: writes `{ execArgv, inspectorUrl, runAsNode, e2e }`, then exits 0.
  - `--overlay-sim`: opens a 360×120 frameless window saying "overlay-sim (hidden from screen capture)", calls `setContentProtection(true)`, and never starts a seat. It skips the single-instance lock.
  - Any `launchRefusal` → stderr message and `app.exit(3)` **before** `ready`.

- [ ] **Step 1: The top level of `index.ts`** (no top-level `await`; CommonJS bundle; `import { url as inspectorUrl } from 'node:inspector'` at the top):

```ts
const refusal = launchRefusal(process.argv, E2E);
if (refusal) { process.stderr.write(refusal + '\n'); app.exit(3); }
else if (process.argv.includes('--probe-selftest')) { /* existing block, unchanged */ }
else if (process.argv.includes('--gate-selftest')) {
  const expect = (argValue('--expect') ?? '').split(',').filter(Boolean);
  runGateSelftest(expect).then(async (r) => {
    const j = JSON.stringify(r, null, 2);
    process.stdout.write(j + '\n');
    const out = argValue('--out');
    if (out) await writeFile(out, j);
    app.exit(r.ok ? 0 : 1);
  }, (e) => { process.stderr.write(String(e) + '\n'); app.exit(2); });
}
else if (process.argv.includes('--fuse-check')) {
  writeFile(argValue('--out') ?? 'fuse-check.json', JSON.stringify({ execArgv: process.execArgv, inspectorUrl: inspectorUrl() ?? null, runAsNode: !!process.env.ELECTRON_RUN_AS_NODE, e2e: E2E }))
    .then(() => app.exit(0), () => app.exit(2));
}
else if (process.argv.includes('--overlay-sim')) overlaySim();
else if (!app.requestSingleInstanceLock()) app.exit(0);
else start();
```

- [ ] **Step 2: Inside `start()`:**
  - `app.on('second-instance', () => { win?.focus(); })`.
  - Build the host inputs:

```ts
let skew: number | null = null, cameraSeen = false, blurAt = 0;
const host: HostInputs = { displays: () => screen.getAllDisplays().length, onBattery: () => powerMonitor.isOnBatteryPower(),
  camera: () => (camera ? (cameraSeen ? 'on' : 'none') : 'off'), skewMs: () => skew, dataDir: app.getPath('userData') };
```

    `cameraSeen` becomes true on the first `face:sample`. `skew` is updated by a 30 s `fetch(new URL('/v1/status', relayUrl), { method: 'HEAD' })` loop: `skew = Date.now() − Date.parse(res.headers.get('date'))`, ignored when the header is missing or the fetch fails.
  - `new Seat({ …existing, integrity: { collect: () => collect(host) } })`.
  - IPC: `ipcMain.handle('gate:recheck', () => seat!.recheck())`; `ipcMain.on('face:sample', (_e, s) => { if (Number.isInteger(s?.faces) && s.faces >= 0 && s.faces <= 20 && typeof s.at === 'number' && (s.thumb === undefined || (typeof s.thumb === 'string' && s.thumb.length <= 20_000))) { cameraSeen = true; seat?.faceSample(s); } })`; `ipcMain.on('gate:blur', () => {})` (the preload keeps the method for API stability; **main** measures blur, below, so a starved renderer cannot hide it).
  - Blur: `win.on('blur', () => { blurAt = Date.now(); })`, `win.on('focus', () => { if (blurAt) seat?.blur(Date.now() - blurAt); blurAt = 0; })`.
  - Window: `const m = windowMode({ test, e2e: E2E, platform: process.platform })`; `new BrowserWindow({ …, kiosk: m.kiosk, fullscreen: m.fullscreen, webPreferences: { …existing, devTools: m.devtools } })`; `if (m.alwaysOnTop) win.setAlwaysOnTop(true, 'screen-saver')`; `if (m.contentProtection) win.setContentProtection(true)`; `if (!m.devtools) win.webContents.on('devtools-opened', () => win!.webContents.closeDevTools())`; `if (!E2E) Menu.setApplicationMenu(null)`.
  - Renderer egress: `session.defaultSession.webRequest.onBeforeRequest((d, cb) => cb({ cancel: !/^(app|devtools|data|blob):/.test(d.url) && !(dev && d.url.startsWith(dev)) }))`, where `dev` = `ELECTRON_RENDERER_URL` in unpackaged dev only. Main-process `fetch` goes only to `relayUrl`, which is the policy's `egress` host.

- [ ] **Step 3: `overlaySim()`**

```ts
function overlaySim(): void {
  app.whenReady().then(() => {
    const w = new BrowserWindow({ width: 360, height: 120, frame: false, alwaysOnTop: true, webPreferences: { sandbox: true, contextIsolation: true } });
    w.setContentProtection(true);             // Windows: WDA_EXCLUDEFROMCAPTURE; macOS: NSWindowSharingNone
    void w.loadURL('data:text/html,' + encodeURIComponent('<body style="font:16px system-ui;margin:1rem">overlay-sim (hidden from screen capture)</body>'));
  });
}
```

`tools/overlay-sim.sh` (macOS demo helper; copies so the processes are **named** `overlay-sim` and `AnyDesk`):

```sh
#!/bin/sh
# Starts a capture-excluded window named overlay-sim, and a fake "AnyDesk" (a renamed sleep), for Act 1 on the Mac.
#   sh tools/overlay-sim.sh start | stop
set -e
APP=apps/seat/release/mac-arm64/Saakshi.app; T="${TMPDIR:-/tmp}/saakshi-act1"
case "$1" in
  start) mkdir -p "$T"; rm -rf "$T/overlay-sim.app"; cp -R "$APP" "$T/overlay-sim.app"
         mv "$T/overlay-sim.app/Contents/MacOS/Saakshi" "$T/overlay-sim.app/Contents/MacOS/overlay-sim"
         /usr/libexec/PlistBuddy -c 'Set :CFBundleExecutable overlay-sim' "$T/overlay-sim.app/Contents/Info.plist"; xattr -cr "$T/overlay-sim.app"
         "$T/overlay-sim.app/Contents/MacOS/overlay-sim" --overlay-sim >/dev/null 2>&1 &
         cp /bin/sleep "$T/AnyDesk"; "$T/AnyDesk" 3600 & echo "started overlay-sim and AnyDesk" ;;
  stop)  pkill -f "$T/overlay-sim.app" || true; pkill -f "$T/AnyDesk" || true; echo stopped ;;
  *) echo "usage: $0 start|stop"; exit 2 ;;
esac
```

- [ ] **Step 4: Verify on the Mac** (camera off; the sandbox blocks launching apps, so run these unsandboxed):
  - `pnpm --filter @saakshi/seat pack:mac`
  - `sh tools/overlay-sim.sh start`
  - `apps/seat/release/mac-arm64/Saakshi.app/Contents/MacOS/Saakshi --gate-selftest --expect anydesk,overlay-sim` → exit 0. Both names are under `block`. If overlay-sim is not seen on this macOS version (Task 3), expect exit 1 with `missing: ['overlay-sim']`, and record it.
  - `sh tools/overlay-sim.sh stop`, then the same command → exit 1.
  - `…/Saakshi --inspect=9229 --fuse-check --out $TMPDIR/f.json` → exit **3**.
  - `…/Saakshi --remote-debugging-port=9222` → exit 3.
  - `ELECTRON_RUN_AS_NODE=1 …/Saakshi -e 'process.exit(42)' --probe-selftest` → exit code **not** 42.
  - Launch twice with `--test-mode --no-camera`: the second exits 0 at once.
  - Finish with `pkill -f 'Saakshi.app/Contents/MacOS/Saakshi'`.

- [ ] **Step 5: Run the unit suites, typecheck and build.** `pnpm --filter @saakshi/seat test && pnpm --filter @saakshi/seat typecheck && pnpm --filter @saakshi/seat build`. Expected: PASS.

- [ ] **Step 6: Hand off** for commit: `feat(seat): Electron hardening (argv refusal, single instance, kiosk, devtools off), gate/fuse self-tests, overlay-sim`.

---

### Task 16: Server wiring

**Model:** sonnet

**Files:**
- Modify: `apps/server/src/main.ts`
- Test: `apps/server/test/main.test.ts` (one case; needs ports → unsandboxed)

**Interfaces:**
- Consumes: `relayIntegrity` (Task 7), `integrityRoutes` (Task 14), `FILES.reviewKey`, `INTEGRITY_DEFAULT`.

- [ ] **Step 1: Write the failing test.** In `main.test.ts`, extend the existing EXAM-mode relay and control boot case: after both print `READY`, `GET relay/v1/readiness` → `200 {seats: []}`; `GET control/v1/readiness` → `200` with `centres[0].centre` equal to the demo centre; `GET control/v1/review` → `{items: []}`.

- [ ] **Step 2: Run to fail.** `bun test --timeout 60000 apps/server/test/main.test.ts` (unsandboxed). Expected: FAIL with 404.

- [ ] **Step 3: Wire.**
  - Relay, inside the `X && rf && bindings && releases` spread: `...relayIntegrity({ ...exam, dir: join(dirname(dbPath), 'integrity'), bindings, cellPub: hexToBytes((JSON.parse(rf.policy.text) as Policy).cell.pub) })`. The policy text was already verified when `rf` was loaded.
  - Control, when `X`: `const rkPath = join(X.root, FILES.reviewKey)`. If it is missing, log `review key missing: re-run tools/provision.ts` and skip the routes. Otherwise `const integ = integrityRoutes({ relayUrl, dir: X.dir, centre: demo, controlDir: dir, reviewPriv: hexToBytes(JSON.parse(readFileSync(rkPath, 'utf8')).priv), retentionMs: INTEGRITY_DEFAULT.retentionMs })`. Spread `...integ.routes` into `routes`, call `integ.start()` after `mon?.start()`, and `integ.stop()` in `stop`.

- [ ] **Step 4: Run to pass**: `bun test --timeout 60000 apps/server` (unsandboxed). Expected: PASS.

- [ ] **Step 5: Hand off** for commit: `feat(server): Stage 5 wiring — relay readiness/faces, control readiness board and review queue`.

---

### Task 17: Act 1 end to end; CI

**Model:** opus

**Files:**
- Create: `tools/act1.ts`
- Modify: `.github/workflows/server.yml` (one step)

**Interfaces:**
- Consumes: everything above; `Stack`/`demoSpecs`, `provision` (with `integrity: { probeMs: 2000 }`; see Task 12's addition below), `buildPackage`/`writePackage`, `call`/`until`/`freePort`, `Seat`, `ProbeSnapshot`. Follow `tools/act3.ts`'s scaffolding: temp dir, G1 via uv or `--cohort`, `step()`, `fail()`, and a `finally` that stops the stack and closes the seats.

- [ ] **Step 1: Write the script.** It is the test: every `✓` line is an assertion, and any failure throws (non-zero exit). The camera is never touched. Seats are in-process with an injected `collect`:

```ts
// Stage 5 end to end (Act 1) on real processes, seats in-process with injected probe snapshots (CI has no AnyDesk and no camera):
// provision (DEMO ops, integrity probeMs 2 s, the scribe seat) → 3 cells + the Centre 42 relay + control → seats A, B (scribe, NVDA), C enrol
// → the readiness board: Centre 42 AMBER (seat C on battery) → seat A runs AnyDesk + overlay-sim → BLOCKED naming both; start() refused
// with the names → closed → re-check → green → release → all start → during the exam AnyDesk returns: one integrity entry (not one per
// probe), INTEGRITY_CRITICAL names AnyDesk, seat A keeps answering → seat B: NVDA allowed, 2 faces nothing, 3 faces one face-extra flag →
// the review queue shows it with its thumbnail → a reviewer clears it → answers carry provenance → submit → seal → /verify green.
//   bun tools/act1.ts [--cohort path/to/cohort.jsonl]
const seat = (cand: string, seatId: string) => new Seat({ dir: join(dir, 'seats', cand), relayUrl: R, ctx: { ...DEV_EXAM, cand }, seatId, authorityPub: authority.pub,
  wrap, camera: false, testMode: false, retryMs: 500, integrity: { collect: async () => snaps[cand] } });
```

`snaps` is a mutable `Record<string, ProbeSnapshot>` that the script edits between steps (start from a `clean()` snapshot like Task 4's test). The seat-side view is `Seat.boot().gate`.

Assertions, in order:
1. After all three seats enrol and report, `GET control/v1/readiness` → `centres[0].verdict === 'amber'` (seat C has `onBattery: true`).
2. Seat A's snapshot gains `{pid: 4242, name: 'C:\\t\\AnyDesk.exe'}` and `{pid: 77, name: 'C:\\s\\overlay-sim.exe'}` with `captureExcluded: [77]`. After `seatA.recheck()`: `verdict === 'block'` and the names are exactly `AnyDesk`, `overlay-sim`. The board's centre is `block`, and a `seatLine` contains `AnyDesk, overlay-sim`. After the release, `seatA.start()` returns `ok: false` with an error that contains both names.
3. Clean snapshot → `recheck()` → `green`; `start()` → `ok: true`.
4. Seat B (accommodation `{faces: 2, assistive: ['NVDA','VoiceOver']}` from provision's demo default) has `nvda.exe` running: an `assistive` info finding naming `NVDA`, and the verdict is not `block`. Feed 20 samples of `faces: 2` → no flag. Feed 5 samples of `faces: 3` with a tiny inline JPEG (base64 of a 1×1 JPEG kept as a constant in the script) → exactly one flag at `GET relay/v1/faces`; `GET control/v1/review` shows one item with `code 'face-extra'`, `expected 2`, and a `data:image/jpeg;base64,` thumb.
5. `POST control/v1/review/decide {id, decision: 'cleared', by: 'REVIEWER-1'}` → `decision 'cleared'`.
6. During the exam, seat A's snapshot has AnyDesk again. Wait for at least 3 probe cycles (2 s each). The cell's `/v1/events` has exactly **one** `INTEGRITY` event for seat A's candidate with `names 'AnyDesk'`. `GET control/v1/incidents` has an open `INTEGRITY_CRITICAL` whose title contains `AnyDesk`. `seatA.act(...)` still returns `ok: true` (never auto-submitted).
7. Seat A answers 5 items with `prov` set, submits; the shift is sealed; `/verify` of that candidate is green with only the authority key (the act3 path).
8. Print the summary: `Act 1: blocked by name (AnyDesk, overlay-sim) → green; Centre 42 amber; 1 integrity entry for N probes; INTEGRITY_CRITICAL; face-extra → review → cleared; lost 0`.

- [ ] **Step 2: Run it locally** (unsandboxed; needs ports and uv): `bun tools/act1.ts`. Expected: every step `✓`, exit 0, under 3 minutes. Save the output to `docs/evidence/stage5-act1.txt` (Task 19 commits it).

- [ ] **Step 3: CI.** Append to `server.yml`'s macOS job, after Act 3:

```yaml
      - name: Act 1 end to end (readiness amber → gate blocks AnyDesk + overlay-sim by name → green → in-exam finding once → INTEGRITY_CRITICAL → face flag → review)
        run: bun tools/act1.ts
```

- [ ] **Step 4: Hand off** for commit: `feat(tools): Act 1 end to end — readiness board, gate blocks by name, in-exam findings, face review; CI runs act1`.

**Addition owned by Task 12 (needed here):** `ProvisionOpts.integrity?: Partial<IntegrityPolicy>`, merged over `INTEGRITY_DEFAULT` (the `egress` and `reviewPub` that provision computes win). Test line in Task 12: `provision({ …, integrity: { probeMs: 2000 } })` → the opened policy's `integrity.probeMs === 2000`.

---

### Task 18: Windows CI — gate self-test, fused-build smoke, Playwright e2e

**Model:** opus

**Files:**
- Modify: `.github/workflows/windows.yml`
- Create: `apps/seat/e2e/seat.e2e.ts`, `apps/seat/e2e/stack.ts`

**Interfaces:**
- Consumes: the command-line contract of Task 15; `pack:e2e` / `pack:e2e:win` (Task 6); `playwright-core`'s `_electron` (Task 1); `tools/stack.ts`, `tools/provision.ts`, `tools/package.ts`.

- [ ] **Step 1: Gate self-test and fused smoke** (after the existing probe self-test, on the **fused** `win-unpacked` build):

```yaml
      - name: Gate self-test — a renamed notepad (AnyDesk.exe) and overlay-sim must BLOCK, named
        shell: pwsh
        run: |
          $d = "apps\seat\release\win-unpacked"
          New-Item -ItemType Directory -Force -Path "$env:RUNNER_TEMP\t" | Out-Null
          Copy-Item "$env:SystemRoot\System32\notepad.exe" "$env:RUNNER_TEMP\t\AnyDesk.exe"
          Copy-Item "$d\Saakshi.exe" "$d\overlay-sim.exe"
          $a = Start-Process "$env:RUNNER_TEMP\t\AnyDesk.exe" -PassThru
          $o = Start-Process "$d\overlay-sim.exe" -ArgumentList '--overlay-sim' -PassThru
          Start-Sleep -Seconds 5
          if (-not (Get-Process -Id $a.Id -ErrorAction SilentlyContinue)) { throw "AnyDesk.exe (renamed notepad) is not running" }
          $p = Start-Process "$d\Saakshi.exe" -ArgumentList '--gate-selftest','--expect','anydesk,overlay-sim','--out',"$PWD\gate.json" -Wait -PassThru
          Get-Content gate.json
          Stop-Process -Id $a.Id,$o.Id -Force -ErrorAction SilentlyContinue
          if ($p.ExitCode -ne 0) { throw "gate self-test did not block both by name (exit $($p.ExitCode))" }
          $n = Start-Process "$d\Saakshi.exe" -ArgumentList '--gate-selftest','--expect','anydesk,overlay-sim','--out',"$PWD\gate-clean.json" -Wait -PassThru
          if ($n.ExitCode -eq 0) { throw "gate self-test named tools that were closed" }
      - name: Fused build — --inspect and --remote-debugging-port are refused; RunAsNode is off
        shell: pwsh
        run: |
          $d = "apps\seat\release\win-unpacked\Saakshi.exe"
          $i = Start-Process $d -ArgumentList '--inspect=9229','--fuse-check','--out',"$PWD\fuse.json" -Wait -PassThru
          if ($i.ExitCode -ne 3) { throw "--inspect was not refused (exit $($i.ExitCode))" }
          $r = Start-Process $d -ArgumentList '--remote-debugging-port=9222' -Wait -PassThru
          if ($r.ExitCode -ne 3) { throw "--remote-debugging-port was not refused (exit $($r.ExitCode))" }
          $f = Start-Process $d -ArgumentList '--fuse-check','--out',"$PWD\fuse.json" -Wait -PassThru
          $j = Get-Content fuse.json | ConvertFrom-Json
          if ($j.inspectorUrl -or $j.e2e) { throw "fused build has an inspector or is the e2e build" }
          $env:ELECTRON_RUN_AS_NODE = '1'
          $n = Start-Process $d -ArgumentList '-e','process.exit(42)','--probe-selftest' -Wait -PassThru
          Remove-Item Env:ELECTRON_RUN_AS_NODE
          if ($n.ExitCode -eq 42) { throw "RunAsNode fuse is on" }
      - uses: actions/upload-artifact@v4
        if: always()
        with: { name: gate-selftest, path: "*.json" }
```

The runner is itself a VM, so `gate-clean.json` may still be `block` for `vm`. That is why the clean run asserts only that the expected **names** are missing (exit ≠ 0 because `missing` is non-empty), and never asserts green.

- [ ] **Step 2: The e2e stack helper** `apps/seat/e2e/stack.ts` (Bun). It provisions a temp exam (`provision` + `buildPackage` + `writePackage`, as `tools/act3.ts` does) and starts cell, relay and control through `Stack` / `demoSpecs` on free ports. It exports `startStack(): Promise<{ relayUrl; controlUrl; release(): Promise<void>; cutLink(down: boolean): Promise<void>; seal(): Promise<void>; verified(cand: string): Promise<boolean>; stop(): Promise<void> }>`. `release` does what `tools/act2.ts` does (custodian shares through control's routes). `cutLink` posts the relay's DEV `/v1/dev/wan`, as act3 does. `seal` and `verified` use control's seal route and `verifyProof` with only the authority key, as act3 does.

- [ ] **Step 3: The Playwright test** `apps/seat/e2e/seat.e2e.ts` (run with `bun test --timeout 180000 apps/seat/e2e`), the plan §9 path: enrol → unlock → answer offline → sync → submit → `/verify` green.

```ts
import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { _electron as electron } from 'playwright-core';
import { startStack } from './stack.ts';

const EXE = process.platform === 'win32' ? join(import.meta.dir, '../release-e2e/win-unpacked/Saakshi-E2E.exe')
  : join(import.meta.dir, '../release-e2e/mac-arm64/Saakshi-E2E.app/Contents/MacOS/Saakshi-E2E');

test('enrol → unlock → answer offline → sync → submit → /verify green (e2e build, camera off)', async () => {
  const s = await startStack();
  const app = await electron.launch({ executablePath: EXE, args: ['--test-mode', '--no-camera', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
    '--relay', s.relayUrl, '--cand', 'C0001', '--seat', 'CEN042-S01'] });
  try {
    const w = await app.firstWindow();
    await w.getByLabel('PIN', { exact: true }).fill('482913');
    await w.getByLabel('Confirm PIN').fill('482913');
    await w.getByLabel('Gate operator').fill('GATE-42-OP7');
    await w.getByRole('button', { name: 'Enrol' }).click();
    await w.getByRole('heading', { name: /Seat check/ }).waitFor();                    // the gate panel on the locked screen
    await s.release();
    await w.getByRole('button', { name: /Start/ }).click();
    await s.cutLink(true);                                                             // answer offline
    for (const opt of ['B', 'C', 'A']) { await w.getByRole('radio', { name: new RegExp(`^${opt}\\b`) }).check(); await w.getByRole('button', { name: /Save & Next/ }).click(); }
    await s.cutLink(false);
    await w.getByRole('button', { name: /Submit/ }).click();
    await w.getByRole('button', { name: /Confirm/ }).click();
    await w.getByText(/receipt/i).first().waitFor({ timeout: 30_000 });
    await s.seal();
    expect(await s.verified('C0001')).toBe(true);
  } finally { await app.close(); await s.stop(); }
});
```

Read the actual EN strings in `i18n.ts` first and use them for the labels and buttons. Do not change the UI to fit the test.

- [ ] **Step 4: CI steps** (windows.yml, after the fused smoke):

```yaml
      - run: pnpm --filter @saakshi/seat pack:e2e:win
      - name: Playwright e2e on the e2e build (camera off)
        env: { PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1' }
        run: bun test --timeout 180000 apps/seat/e2e
```

- [ ] **Step 5: Run locally on the Mac** (unsandboxed): `pnpm --filter @saakshi/seat pack:e2e && bun test --timeout 180000 apps/seat/e2e`, then `pkill -f Saakshi-E2E`. Expected: PASS. Then trigger the `windows` workflow (`workflow_dispatch`) and wait for green.

- [ ] **Step 6: Hand off** for commit: `ci(windows): gate self-test blocks renamed AnyDesk + overlay-sim by name; fused-build smoke; Playwright e2e`.

---

### Task 19: Exit check, ledger, threat model, detection matrix

**Model:** sonnet

**Files:**
- Modify: `docs/claims-ledger.md`, `docs/threat-model.md`
- Create: `docs/evidence/stage5-act1.txt`, `docs/evidence/stage5-gate-selftest.json` (the CI artifact), `docs/evidence/stage5-fuse.txt`, `docs/evidence/stage5-mac-capture.txt`
- Memory: update `saakshi-hackathon-plan.md` (Stage 5 done)

- [ ] **Step 1: The exit check.** Run everything and record each command's output (sandbox-disabled where ports or app launches are needed; camera off; `pkill` afterwards):
  - `pnpm -r test`
  - `pnpm -r typecheck`
  - `bun test --timeout 60000 apps/server`
  - `bun tools/act1.ts`
  - `bun tools/act3.ts`, `bun tools/act4.ts`, `bun tools/act2.ts` (no regression)
  - The latest `windows` workflow run: the gate self-test, fused smoke and Playwright steps are all green. Download the `gate-selftest` artifact into `docs/evidence/stage5-gate-selftest.json`.
  - The Mac fused checks from Task 15 Step 4 go into `docs/evidence/stage5-fuse.txt`.

  **All must pass before any doc says "Proven".**
- [ ] **Step 2: Claims ledger.**
  - P6 → "Proven (name matching): the Windows CI gate blocks a renamed notepad `AnyDesk.exe` and overlay-sim by name; act1 blocks by name in CI". Limits: renamed tools evade names; the VM score is a heuristic; GitHub's runner itself scores as a VM.
  - P8 → "Built; flags and review scripted in act1 with synthetic samples; live on the Mac with the camera by hand".
  - P9 → "Proven: the fused build refuses `--inspect` / `--remote-debugging-port`, RunAsNode is off (Windows CI and Mac)".
  - C3 → Playwright e2e passing; the WCAG audit is still not done.
  - New rows: S5 provenance ("recorded in the sealed body; analysed in Stage 6") and the review queue ("Built; 30-day thumbnail deletion tested").
  - Banned-word check: `grep -niE 'tamper-proof|time-lock|blockchain|lockdown' docs/*.md`; every hit must be in a "banned" / "never say" / "not lockdown" context.
- [ ] **Step 3: Threat model.**
  - Replace each "Stage 5" in the detection matrix with what now exists: macOS capture exclusion (with the observed macOS version and whether overlay-sim was seen), VM score on both OSes, egress (review only), accommodations, face flags, blur.
  - Keep the honest limits: KVM/HDMI capture; renamed binaries; macOS 15+ capture APIs; `isTrusted` injected input; face presence ≠ identity; thumbnails are personal data, retained 30 days and sealed to the review key.
  - Add the new limit: the relay keeps face flags without fsync; the chain's `integrity` entry (with `thumbHash`) is the durable record.
  - The detection matrix filled in on both laptops stays **Stage 7**.
- [ ] **Step 4: Demo notes** in the ledger's Act 1 row: `sh tools/overlay-sim.sh start` → the seat shows "Blocked — AnyDesk, overlay-sim" → `stop` → Re-check → green. Held back for Q&A: `--inspect` refused.
- [ ] **Step 5: Hand off** for commit: `docs(stage5): exit-check evidence, claims ledger and threat model for Task 19`.

---

## Self-review (done while writing)

- **Spec coverage (§5 Stage 5):**
  - Gate and monitor on macOS: T3, T4, T13, T15.
  - Windows CI renamed AnyDesk + overlay-sim BLOCK by name: T18.
  - VM score: T2, T4.
  - Egress allowlist: T4, T15.
  - Accommodation allowlist, NVDA/VoiceOver, scribe 2 faces: T1, T4, T5, T12.
  - Pointer provenance: T1 D.5, T10, T13.
  - Face flags and review queue: T5, T8, T11, T13, T14.
  - Readiness board: T7, T8, T11, T14.
  - Release fuses and a separate e2e build: T6, T15, T18.
  - Playwright e2e: T18.
  - Act 1 MVP (amber, blocked by name, screen reader allowed, face flag in the queue, `--inspect` refused): T17, T15, T18.
  - Exit check: T19.
  - §3.4 blur over 3 s: T13, T15.
  - Battery, disk and skew amber: T4, T15.
  - Single-instance lock, devtools off, `alwaysOnTop('screen-saver')`, `setContentProtection` on Windows only: T6, T15.
  - Thumbnails deleted after 30 days: T8.
- **Cross-task addition:** `ProvisionOpts.integrity?: Partial<IntegrityPolicy>` is owned by Task 12 and used by Task 17. It is noted in both.
- **Type names:** `IntegrityFinding` (never `Finding`), `GateView`, `FaceSample`, `SignedReadiness`, `SignedFace`, `ProbeSnapshot`, `Gate.check/view/blocked/blur/faceSample/retry`, `ExamSession.note`. Used consistently in T1, T4, T8, T13, T14, T17.
- **Not built (deliberately):**
  - A Windows hypervisor bit: no CPUID, by policy.
  - Hash-based assistive allowlisting on Windows: name only; hashes on the roadmap.
  - Provenance-based flags on the seat: the radar decides in Stage 6.
  - Tamil strings: Stage 6.
  - Readiness for the 99 simulated centres: they have no real seats.
