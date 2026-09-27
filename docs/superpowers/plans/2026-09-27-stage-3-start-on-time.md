# Stage 3 — "Start on time, anywhere" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Act 2 works end to end.
- The live dashboard shows the G1 cohort (≈20k candidates) across 100 centres and 3 cells, with tiles and an entries/s counter.
- Two of the three custodians release the paper from `/custodian`. The 99 simulated centres go green. Centre 42, whose link was cut, stays locked.
- The superintendent phones in; control reveals only Centre 42's code for this shift and logs it; the relay console unwraps the keys and pushes them to the seats.
- Before T0 the paper cannot be read: a hexdump shows ciphertext, a wrong code fails, and a key that does not match `kc_f` is rejected.

**Architecture:**
- **Provisioning** (`tools/provision.ts`, control's step): writes an *exam directory* (`EXAM=data/exam`): the directory (cells, centres, candidates), each cell's key file **outside the cell DB** with an authority certificate and `cellKeyId`, a fresh pseudonym key, and one **authority-signed policy per centre** that pins that centre's cell key.
- **Packager** (`tools/package.ts`, offline, T−3 days): per shift makes `K_F1`, `K_F2`, a per-centre offline code, the wraps `W_c`, the code list under `L`, the paper ciphertext per form and the **signed manifest** `{ciphertextHash, kc_f}` (the public commitment). It splits `{K_F1, K_F2, L}` Shamir 2-of-3 into passphrase-sealed share files for NTA, NIC and the observer, prints the passphrases once, and zeroises everything.
- **Enrolment:** the seat makes its own P-256 key, computes `attestHash` from the gate check, and seals a salted scrypt PIN record to the cell. Seat → relay → cell. The cell signs the bind certificate; relay and seat both verify it against the cell key. With no WAN the binding is **provisional** (✓ only, nothing sent) and retried.
- **Trust:** with `EXAM` set, relays and cells trust a seat key **only** through a cell-signed bind certificate. Bindings are self-proving, so a relay replays them to a rebuilding cell. The fixture seat keys stay trusted only in the Stage 1–2 DEV mode (no `EXAM`), which the existing tests and tools use.
- **Release:** custodians decrypt their shares in the browser and seal them to control's in-memory release key. Control rebuilds the keys once two **distinct** custodians have sent shares, checks them against `kc_f`, signs a release per form and pushes it to every cell, retrying until each has it. It then zeroises the keys.
  - Cells hand releases to relays in the sync response (`have`/`releases`).
  - Relays push them to seats over SSE (`/v1/release/events`), with a pull fallback at `GET /release/current`. Seats never talk to the cells.
- **Offline fallback:** control reveals one centre's code (logged); the relay console unwraps `W_c` and pushes an unsigned `via:'code'` release.
- **The seat check (both paths):** the seat unlocks only if `kc_f(K)` equals the authority-signed manifest's `kc_f` for its form; a signed release must also verify.
- **Timer:** `remaining = D_i − activeMs`, with `D_i = D + compensatory time` from the signed policy. `activeMs` never runs backwards within a key epoch, at the seat or at relay and cell.
- **Swarm v1** (`tools/swarm.ts`): one process, in memory. Each simulated centre is the **real relay code** (ingest on `:memory:`, Bindings, ReleaseStore, Forwarder) talking to the real cells over HTTP; only the seats are simulated, replaying G1 rows.
- **Control room:** `/v1/fleet` sums each cell's `/v1/stats` per centre; the control page gets KPIs, 100 centre tiles, entries/s, a custody panel, the phoned-code form and the "cut the link" chaos button.

**Tech Stack:**
- TypeScript on Node 25 and Bun 1.3.14; `bun:sqlite`; `Bun.serve` routes with HTML imports.
- `@noble/*` (P-256 ECDH in the browser, scrypt, XChaCha20-Poly1305, HKDF), `shamir-secret-sharing`, native `node:crypto` ECDSA/ECDH on seat main, server and swarm.
- Electron 44, React 19. `node:test` in core and seat; `bun:test` in server.
- Python via `uv` only to generate the G1 cohort.
- **No new dependencies.**

**Spec:**
- `docs/plan.md`: §2 (failure handling), §3.1 (acks, cell keys), §3.2 (binding and enrolment only; handover is Stage 4), §3.3, §3.4 (signed policy only; probes are Stage 5), §3.6 (timer), §3.10–§3.11 (control tiles, UIs), §5 "Stage 3" and Act 2 in §6.
- `docs/protocol-v1.md` is **frozen**. Task 1 appends **Addendum B** (§15), additive only, with new vectors.

## Decisions (open questions, settled)

1. **One exam-shift per deployment.** Stage 3 runs `DEMO-2026 / S1 / attempt 1`. The swarm replays **every** G1 row into S1 (G1's three sittings merged) so the dashboard shows ≈20k live candidates. ponytail: Stage 6's radar reads the export, where same-room now means same centre; revisit there if the merged rooms matter.
2. **Centre 42 is the real centre.** The directory's demo centre `CEN042` has the 8 fixture candidates (C0001–C0008) on `cell-1`. G1's own `CEN042` rows are not replayed; the swarm simulates the other 99 G1 centres. The dashboard therefore shows ≈19.8k simulated candidates plus 8.
3. **`EXAM` switches Stage 3 on.** With `EXAM=<dir>`, keys, roster, policy and paper come from the exam directory, and no fixture seat key is trusted. Without it, every mode behaves exactly as in Stage 2, so `chaos-kill.ts`, `act4.ts` and all Stage 1–2 tests stay green unchanged.
4. **Cell keys.** DEV provisioning reuses the fixture cell keys (so `fixtures/trust-dev.json` and `/verify`'s receipt check still hold). Control certifies each with `["cellkey",exam,cellId,cellKeyId,pub]` and writes the key file under `EXAM/cells/` — outside the DB.
5. **Bindings are self-proving.** A relay stores the cell-signed certificate and the sealed PIN box and replays both to a rebuilding cell before the entries. The PIN record is only ever at rest **sealed to the cell key**; no table holds a readable PIN hash.
6. **Release transport.** control → cells is `POST /v1/release`; cells → relays rides the existing sync (`SyncReq.have`, `SyncRes.releases`; a relay with no seats still asks on its heartbeat); relays → seats is SSE plus the pull fallback. A relay upgrades an offline-code release to control's signed one when it arrives (same key).
7. **No T0 clock gate.** The custodians are the release control; control does not refuse shares before a time.
8. **`K_pseud` moves to control.** Provisioning makes a random pseudonym key (`EXAM/control/pseud.key`); each candidate's pseudonym travels in the directory and in the signed policy, so seats still compute receipts offline.
9. **scrypt:** noble everywhere (the custodian page runs in a browser), `N=16384, r=8, p=1`, cross-checked against `node:crypto.scryptSync` in the vectors. **Sealed-box ECDH:** noble in the browser, native (`nativeBox`) everywhere else — the same bytes.
10. **SSE client on the seat:** a 30-line fetch-stream reader in seat main (no `EventSource` dependency).
11. **DEV test keystore** (coordinator requirement, Task 2). `--test-mode` / `SAAKSHI_TEST_MODE=1` wraps the journal key with a file key instead of `safeStorage`, implies `--no-camera`, shows a permanent banner and journals an `integrity` entry at unlock. Every automated app launch in this plan uses it.
12. **`/verify` is not changed** (it has just landed). See Conflicts: it pins fixture seat keys, so an **enrolled** candidate's proof fails its "keys" row there. Control's own seal, audit, reconciliation and evidence use the enrolled keys.

## Protocol Addendum B (Task 1 appends it to `docs/protocol-v1.md` as §15)

Additive only: no byte defined in §1–§14 changes, so `V` stays 1. Vectors: `fixtures/vectors/protocol-v1-addendum-b.json`.

| # | Addendum | Why |
|---|---|---|
| B.1 | `cellkey`, `bind`, `policy`, `manifest` and `release` are signed as `m = UTF-8(canon(array))`, no domain byte (as A.1) | §5 reserved `bind` and `release` without a signing rule |
| B.2 | Layouts and field rules: `["cellkey",exam,cellId,cellKeyId,pub]` (authority); `cellKeyId` = first 16 hex of `hex(SHA-256(pub))`; `bind` keeps its §5 layout (cell-signed) with `pubkey` 130 hex, `keyEpoch ≥ 1`, `fromSeq ≥ 0`, and the new key signs `seq > fromSeq`; `["policy",exam,shift,centre,text]` (authority; `text` is the policy JSON); `["manifest",exam,shift,[[form,ciphertextHash,kc_f]…],ts]` (authority; forms sorted); `release` keeps its §5 layout (control) | Fix the reserved fields |
| B.3 | `attestHash = hex(SHA-256(UTF-8(canon(["attest",exam,shift,operatorId,time,method,cand]))))`; `time` in ms; `method ∈ {aadhaar-face, aadhaar-fingerprint, id-document}` | §3.2 names the inputs, not the encoding |
| B.4 | Sealed box to a P-256 key: `ephPub(65) ‖ nonce(24) ‖ XChaCha20-Poly1305(HKDF-SHA256(ECDH x, salt none, info = UTF-8(canon(info)), 32), nonce)(pt)`, no AAD. Infos: `["saakshi-pin",1,exam,shift,attempt,cand,seatId]`, `["saakshi-share",1,exam,shift,custodian,releaseKeyId]` | PIN to the cell; shares to control |
| B.5 | PIN record `canon(["pin",salt(16)hex,16384,8,1,scrypt(UTF-8(pin),salt,N=16384,r=8,p=1,32)hex])`; a PIN is exactly 6 ASCII digits | "salted hash" needs a definition |
| B.6 | Symmetric boxes `nonce(24) ‖ XChaCha20-Poly1305(key, nonce, AAD = UTF-8(canon(aad)))`: paper `aad ["saakshi-paper",exam,shift,form]` (key `K_f`; `ciphertextHash = hex(SHA-256(box))`); code list `["saakshi-codes",exam,shift]` (key `L`; plaintext `JSON {centre: code}`); custodian share file `["saakshi-custodian",exam,shift,custodian]` (key `scrypt(pass', salt)`, `pass'` = passphrase with spaces and dashes removed, upper-cased). In the bundle, `kF1` opens form `F1` and `kF2` opens `F2` | The packager's outputs |
| B.7 | **The seat check (normative):** a key `K` for form `f` is accepted only if `kc_f(K)` equals the signed manifest's `kc_f` for `f` — on **every** path. A release carrying a signature must also verify under the authority key with `release.kc_f` equal to it. An offline-code release carries no signature | The Stage 3 exit check |
| B.8 | Relay and cell reject (BAD_SUBMISSION, never FORK) a new entry whose `activeMs` is less than the previous entry's when both have the same `keyEpoch` | §3.6 "monotonic within a key epoch" |
| B.9 | Conventions (not checked): the unlock body is `["body","","","",[form,kc_f,via]]` with `via ∈ {push, code}`; a test-mode seat journals `integrity` with meta `["test-mode","journal key not in the OS keychain"]` right after unlock | Evidence of how, and on what kind of seat, the paper was unlocked |

Non-normative JSON (types in core, Task 1): `BindReq`, `WireBind`, `ReleaseMsg`, `ShareFile`, `Policy`, `PackageWire`.

## Global Constraints

**Protocol and code reuse**
- Protocol v1 is frozen. All hashing, signing, sealing and wrapping goes through `packages/core`.
  - No task may change a byte that §1–§14 define. If a task believes it must, it **stops and reports**.
  - Task 1 is the only task that adds core modules (`box.ts`, `enrol.ts`, `paper.ts`, `policy.ts`, `directory.ts`) or edits `node.ts` and `wire.ts`.
- **Browser-safe core.** `box.ts`, `enrol.ts`, `paper.ts`, `policy.ts` and `directory.ts` import nothing from `node.ts`, `wire.ts` or `node:*` (type-only imports are fine). `/custodian` imports only these plus `bytes`, `canon`, `protocol`, `sig`, `custody`.
- Reuse what exists: `wrapForCentre`/`unwrapForCentre`/`splitBundle`/`combineBundle`/`newOfflineCode` (`custody.ts`), `kcf` (`protocol.ts`), `Hub` (`sse.ts`), `Forwarder`/`httpCellSend` (`forward.ts`), `openDb`, `ExamSession`, `SeatSync`, `SeatJournal`'s `writeDurable`, `pseudOf`, `responsesOf`.
- **Imports:** core as `@saakshi/core/<module>` in apps; `tools/*.ts` import core and server code by relative path. Relative TS imports carry `.ts`. JSON in `apps/server/src` uses `with { type: 'json' }`. No barrel files.
- **TypeScript:** `erasableSyntaxOnly` — no enums, namespaces or constructor parameter properties.
- **Dependencies:** none. If a task needs a package, it stops and reports. Only Task 1 may run `pnpm`, and then only as `pnpm … --config.confirm-modules-purge=false </dev/null`.
- `tools/provision.ts`, `tools/package.ts`, `tools/cohort.ts` and `tools/sim-custody.ts` use only `node:*` and core (no `Bun.*`), because the seat's `node --test` suite imports `tools/package.ts`. CLIs run under Bun behind `if (import.meta.main)`.

**Shared types (Task 1; exact names)**

```ts
// core/box.ts
interface BoxKeys { newKey(): { priv: Uint8Array; pub: Uint8Array }; ecdh(priv: Uint8Array, pub: Uint8Array): Uint8Array }
sealBox(pub, info: Canon[], pt, k = nobleBox): Uint8Array; openBox(priv, info, env, k = nobleBox): Uint8Array   // node.ts exports nativeBox
// core/enrol.ts
msg(a: Canon[]): Uint8Array                                    // UTF-8(canon(a)) — Addendum A.1/B.1
type GateMethod = 'aadhaar-face' | 'aadhaar-fingerprint' | 'id-document'
interface Bind extends Ctx { seatId: string; pub: string; keyEpoch: number; fromSeq: number; attestHash: string }
interface BindReq extends Bind { pinBox: string /* hex */ }
interface WireBind { cert: string /* canon(bindArray) */; sig: string; cell: string; pinBox: string }
attestHash(a), cellKeyId(pub), cellKeyArray(c), bindArray(b), bindFromArray(a), checkWireBind(wb, cellPub, mk?): Bind, isP256Pub(hex),
isPin, pinRecord(pin, salt?), isPinRecord, checkPin, pinInfo, makeBindReq(b, cellPub, pinRec, k?), openPinBox(cellPriv, b, k?)
// core/paper.ts
interface ManifestForm { form: string; ciphertextHash: string; kcf: string }
interface Manifest { exam: string; shift: string; forms: ManifestForm[]; ts: number }; interface SignedManifest { manifest: Manifest; sig: string }
interface Release { exam: string; shift: string; form: string; kcf: string; ts: number }
interface ReleaseMsg extends Release { key: string; sig: string /* '' on the code path */; via: 'push' | 'code' }
interface ShareFile { v: 1; exam: string; shift: string; custodian: string; salt: string; N: number; r: number; p: number; box: string }
manifestArray, checkManifest(sm, authority): Manifest, releaseArray, parseReleaseMsg(x), checkRelease(r, m, form, authority): ReleaseCheck,
sealPaper/openPaper(K, {exam, shift, form}, …), ciphertextHash(ct), sealCodes/openCodes(L, exam, shift, …), sealShareFile/openShareFile, shareInfo
// core/policy.ts
interface RosterEntry { form: 'F1' | 'F2'; extraMs: number; pseud: string }
interface Policy { v: 1; exam; shift; centre; cell: { id; keyId; pub }; durationMs: number; roster: Record<string, RosterEntry>; issuedAt: number }
interface SignedPolicy { text: string; sig: string }; signPolicy(p, sign); openPolicy(sp, authority, {exam, shift}): Policy
// core/directory.ts
CUSTODIANS = ['NTA', 'NIC', 'OBS']; FILES (exam-directory layout, below); rosterOf(dir, centre)
interface CellEntry { id; url; keyId; pub; cert }; interface CellKeyFile { id; keyId; priv; pub }
interface Directory { v: 1; exam; shift; durationMs; demoCentre; issuedAt; cells: CellEntry[]; centres: Record<string, { cell: string }>; cands: Record<string, RosterEntry & { centre: string }> }
interface CentreStats { registered; bound; unlocked; submitted; entries }; interface CellStats { cell; state: NodeState; entries; centres: Record<string, CentreStats> }
type TileTone = 'green' | 'partial' | 'locked' | 'down'; interface CentreTile extends CentreStats { centre; cell; tone: TileTone }
interface FleetView { at; registered; bound; unlocked; submitted; entries; entriesPerSec; cells: { id; state: NodeState | 'DOWN'; entries }[]; centres: CentreTile[] }
interface ReleaseStatus { exam; shift; keyId; custodians: string[]; received: string[]; needed: number; released?: { at; custodians: string[]; forms: { form; kcf }[] }; pushed: Record<string, boolean>; zeroised: boolean; reveals: { at; centre; superintendent }[]; manifest: Manifest }
// core/wire.ts additions
SyncReq.binds?: WireBind[]; SyncReq.have?: number; SyncRes.releases?: ReleaseMsg[]; parseBindReq(x): BindReq
// apps/server/src/serve.ts
type Handler = (req: Request, server: Timeouts) => Response | Promise<Response>; type Routes = Record<string, Partial<Record<'GET' | 'POST', Handler>>>
```

**Exam directory** (`EXAM`, default `data/exam`; `data/` is gitignored)

| Path | Written by | Read by |
|---|---|---|
| `directory.json` | provision | every mode, swarm |
| `cells/<id>.key.json` (`CellKeyFile`: the private key, **outside the DB**) | provision | that cell |
| `policies/<centre>.json` (`SignedPolicy`) | provision | that centre's relay → its seats |
| `control/pseud.key` | provision | control only (not used at runtime in Stage 3: pseudonyms are in the directory) |
| `package/manifest.json` (`SignedManifest`, the public commitment) | packager | all |
| `package/paper-F1.bin`, `package/paper-F2.bin` (ciphertext) | packager | relays → seats |
| `package/wraps.json` (`{centre: hex W_c}`) | packager | relays (each uses its own) |
| `package/codes.bin` (code list under `L`) | packager | control |
| `custodians/<NTA|NIC|OBS>.share.json` (`ShareFile`) | packager | each custodian, in `/custodian` |

**HTTP routes (new)**

| Mode | Route | Request | Response |
|---|---|---|---|
| cell | `POST /v1/enrol` | `{enrols: BindReq[]}` (≤ 500) | `200 {results: EnrolResult[]}`; `503` while REBUILDING; `400` bad shape |
| cell | `POST /v1/release` | `{releases: ReleaseMsg[]}` (≤ 10) | `200 {accepted, errors}`; `400` if none accepted |
| cell | `GET /v1/binds` | — | `{binds: WireBind[]}` |
| cell | `GET /v1/stats` | — | `CellStats` |
| cell, relay | `POST /v1/sync` | `+ binds?, have?` | `+ releases?` |
| relay | `GET /v1/package` | — | `PackageWire {policy, manifest, paper: {F1: b64, F2: b64}}` |
| relay | `POST /v1/enrol` | `BindReq` | `200 {bind}`; `202 {provisional: true, reason}`; `409 {error, code}`; `400 {error}`; `502 {error}` |
| relay | `GET /release/current` | — | `{releases: ReleaseMsg[]}` |
| relay | `GET /v1/release/events` | `Last-Event-ID` | SSE: `snapshot {releases}`, `release ReleaseMsg` |
| relay | `POST /v1/release/offline` | `{code}` | `200 {released: ['F1','F2']}`; `400 {error}` |
| relay (DEV) | `POST /v1/dev/wan` | `{up: boolean}` | `{up}` |
| relay (DEV) | `POST /v1/dev/forge` | — | `{published: true}` (a random key over SSE, not stored) |
| control | `GET /custodian` | — | the custodian page |
| control | `GET /v1/manifest` | — | `SignedManifest` |
| control | `GET /v1/release/key` | — | `{exam, shift, keyId, pub}` |
| control | `POST /v1/release/share` | `{custodian, keyId, box}` | `200 ReleaseStatus`; `400`; `409` (old key, or shares that do not rebuild `kc_f`) |
| control | `GET /v1/release/status` | — | `ReleaseStatus` |
| control | `POST /v1/release/code` | `{centre, superintendent, callback: true}` | `200 {centre, shift, code, at}`; `409` before the release; `400` |
| control | `GET /v1/fleet` | — | `FleetView` |
| control | `POST /v1/chaos/wan` | `{up}` | the relay's `{up}` |

- `EnrolResult = {ok: true, bind: WireBind} | {ok: false, code: 'NOT_REGISTERED'|'ALREADY_BOUND'|'UNSUPPORTED'|'BAD', error}`.
- Control errors stay `{error}` with Stage 2's status rules.

**Environment**
- All modes: `EXAM` (Stage 3 on), `DEV=1` still required.
- Cell: `CELL_ID` (default `cell-1`), `PORT` (defaults: `cell-1` 7080; start `cell-2` on 7081 and `cell-3` on 7082, which are the provisioned URLs).
- Relay: `CENTRE` (default the directory's `demoCentre`), `CELL_URL` (default the directory's URL for that centre's cell), `PORT` 7070.
- Control: `DIR` (default `data/control`), `CELL_URL` (default: the demo centre's cell), `RELAY_URL` (default `http://127.0.0.1:7070`), `PORT` 7090.
- Seat: `--relay`, `--cand`, `--seat` (default `CEN042-S01`), `--no-camera`, `--test-mode` (or `SAAKSHI_TEST_MODE=1`).

**Rules**
- **Check order additions at relay and cell.**
  - A request's `binds` are processed **before** its entries. A bad bind is recorded as evidence (`BAD_SUBMISSION`), never an error for the request.
  - After the fork/duplicate check, for a **new** entry: `activeMs` below the previous entry's in the same `keyEpoch` is `BAD_SUBMISSION` (B.8).
- **Enrolment:** keyEpoch 1, `fromSeq` 0 only (handover is Stage 4 → `UNSUPPORTED`). The same `(cand, keyEpoch, pub)` again returns the stored certificate; another `pub` is `ALREADY_BOUND` (this also exposes a relay that pre-binds candidates).
- **Release:** the seat unlocks only through `checkRelease` (B.7). Start is idempotent, so no delivery path can journal a second unlock.
- **Honest claims** (use these words): "custody split across institutions, a public commitment, and an audited per-centre fallback"; "control sees `K_f` at T0"; "zeroised, best effort in a garbage-collected runtime". Banned words: "tamper-proof", "time-lock", "blockchain", "lockdown" on its own.

**Camera and test mode in automated checks** (the user's requirement: the webcam must not stay on)
- The seat honours `--no-camera` / `SAAKSHI_NO_CAMERA=1`, and `--test-mode` / `SAAKSHI_TEST_MODE=1` also turns the camera off.
- With the camera off, main denies every `media` permission and skips `askForMediaAccess`, the renderer never calls `getUserMedia` or loads MediaPipe, and the chip reads **"Camera off (test mode)"**.
- **Every** step in this plan that launches the packaged app passes `--test-mode --no-camera`, and **every** such step ends with `pkill -f 'Saakshi.app/Contents/MacOS/Saakshi'`.
- Test mode never happens silently: the banner **"TEST MODE — not for real exams (journal key not in the OS keychain)"** is on every screen, and the journal gets an `integrity` entry at unlock.

**UI pages** (`/control`, `/custodian`, the relay `/console`)
- Type scale `0.8 / 1 / 1.25 / 1.563 / 1.953 / 2.441 rem` (a ratio of 1.25 between neighbours). A test reads each page's CSS and pins this.
- AA contrast (text ≥ 4.5:1; tones below), native controls with labels, keyboard order = reading order, `:focus-visible { outline: 3px solid #1565c0; outline-offset: 2px }`.
- Tile tones always carry a word as well as a colour: green `#0d5222` on `#e6f4ea`; partial `#7a4100` on `#fef7e0`; locked `#3c4043` on `#f1f3f4`; down `#8c1d18` on `#fce8e6`.
- Untrusted strings are rendered with `textContent` only.

**Environment gotchas** (carried over from Stage 2, plus Stage 3's)
- **Sandbox:**
  - It blocks `.git` writes, `open`, some network, **local port binding** and launching packaged apps.
  - Port binding covers every `apps/server` test that calls `Bun.serve` (`main.test.ts`, `control.test.ts`, `control-stage3.test.ts`, `serve.test.ts`, `sse.test.ts`), plus `tools/chaos-kill.ts`, `tools/act4.ts` and `tools/act2.ts`. Re-run those with `dangerouslyDisableSandbox: true`.
  - Every other new test calls route handlers directly (`routes[path].POST(new Request(…), {timeout() {}})`) or injects `fetch`, so it runs inside the sandbox.
- **Tests:**
  - Write `assert.throws(fn, /re/, msg)` or `assert.throws(fn, msg)`. Never `assert.throws(fn, undefined, msg)`, which does not type-check.
  - Bun's per-test timeout defaults to 5 s. Server tests run with `bun test --timeout 60000`, which the package script already passes.
  - noble scrypt costs ~150 ms. Tests that need many enrolments share one PIN record through `simPinRecord()` (`tools/sim-custody.ts`).
  - Windows CI runs `pnpm -r test`, so new server and seat tests run on Windows too. Close every DB handle before removing a temp dir (EBUSY), and build paths with `join`.
- **Module format:**
  - The root `package.json` is `"type":"module"`.
  - `apps/seat` has **no** type field, and electron-vite bundles main and preload as CommonJS. So seat main code has no top-level `await`, and seat test and lib files use neither `__dirname` nor `require`.
- **Killing by port:** `kill -9 $(lsof -ti tcp:7080 -sTCP:LISTEN)`. A plain `lsof -ti tcp:7080` also matches the relay's client socket.
- **G1:** `uv run --directory analytics python -m saakshi_analytics.generate <abs-out> [--n 300 --centres 6]`. The full cohort is ~350 MB; `data/` is gitignored.
- **Commits:** agents share one working tree, touch only the files their task lists, and **do not commit**. The controller reviews and commits each task.

## Review Focus

These are the five likeliest real-world failures. Each is pinned by a named test in the task that owns the code.

1. **A custodian makes a mistake.**
   - Triggers: the same custodian sends twice (double click, two tabs), a share file is damaged, or it is from another exam.
   - Expected: no release with wrong keys, ever. One custodian twice still counts once. A damaged share blocks nothing: a third custodian can still release. The error says what happened.
   - Pinned in Task 8: "Review Focus #1: the same custodian twice counts once; a damaged share cannot release, and a third custodian still can".
2. **Enrolment is retried.**
   - Triggers: the response is lost after the cell signed; the candidate presses Check in twice; the relay retries.
   - Expected: the same certificate comes back; a seat never makes a second key; the cell never binds a second key silently.
   - Pinned in Task 5: "enrol: a registered seat gets a cell-signed certificate; the same request again returns the same certificate; a second key is ALREADY_BOUND", and in Task 12: "Review Focus #2: a lost response — the retry gets the same certificate; enrolling again never makes a second key".
3. **The phoned code is typed by hand.**
   - Triggers: spaces or dashes between groups, lowercase, `O` for `0`, `I`/`L` for `1`, one wrong symbol.
   - Expected: a valid transcription unlocks. A one-symbol typo says "re-type it", never "wrong centre". Another centre's or another shift's code says it does not open this centre's paper.
   - Pinned in Task 7: "Review Focus #3: a phoned code typed with spaces, dashes, lowercase and O-for-0 unlocks; a typo asks to re-type; another centre's or shift's code does not open".
4. **The release arrives more than once.**
   - Triggers: an SSE reconnect with `Last-Event-ID`, a relay restart (new boot → snapshot), the pull fallback, control's signed release after the phoned code, a forged key.
   - Expected: exactly one unlock entry; the same key; a forged key is rejected with a notice and changes nothing.
   - Pinned in Task 7: "exit check: the release to seats is idempotent across SSE reconnects — same keys by snapshot, by Last-Event-ID and by pull", Task 14: "Review Focus #4: the same release by SSE, by snapshot after a reconnect, by pull, and then the phoned code — one unlock entry", and `tools/act2.ts` step 12 (a real relay restart).
5. **A cell loses its DB after enrolment.**
   - Triggers: disk failure, the Stage 4 "pull the plug" chaos.
   - Expected: the rebuild does not reject every entry with "no seat key": the relay's replay carries the bindings first, and `sent = stored`.
   - Pinned in Task 5: "Review Focus #5: after the cell loses its DB, the replay carries the binds before the entries and the rebuilt cell accepts every entry".

## Parallelism map

```
T1 contracts ─┬─► T2 seat test mode ─────────────────────────────────────┐
              ├─► T12 seat identity ─────────────────────────────────────┤
              ├─► T15 seat renderer (+ banner)                           ├─► T14 seat orchestrator ─┐
              ├─► T4 packager ─┬─► T13 seat pkg+release ─────────────────┘                          │
              │                ├─► T8 control release ────┐                                         │
              │                └─► T7 relay routes ───────┤                                         ├─► T18 act2 + CI ─► T19 exit + demo
              ├─► T5 stores+sync ─┬► T7                   ├─► T16 wiring (main, control, exam-env) ─┤
              │                   └► T6 cell routes ──────┤                                         │
              ├─► T3 provision ───────────────────────────┤                                         │
              ├─► T9 fleet ───────────────────────────────┤                                         │
              ├─► T10 control + console UI ───────────────┤                                         │
              └─► T11 custodian page ─────────────────────┘      T17 swarm (T3, T4, T5, T6) ────────┘
```

| Wave | Tasks | Notes |
|---|---|---|
| 1 | T1 | Core Addendum B, contracts, vectors, shared test helpers. Everything depends on it. |
| 2 | T2, T3, T4, T5, T9, T10, T11, T12, T15 | Nine agents on disjoint paths. T2 edits `exam.ts`, `camera.ts`, `index.ts`; T15 owns the renderer (including the test banner). |
| 3 | T6 (T5), T7 (T4, T5), T8 (T4), T13 (T4) | Disjoint files. T7's test fakes the cell with T5's `Bindings`; T13's tests use T4's `buildPackage`. |
| 4 | T14 (T2, T12, T13), T16 (T3–T11), T17 (T3, T4, T5, T6) | Disjoint: seat main, server wiring, `tools/swarm.ts`. |
| 5 | T18 (T14, T16, T17) | |
| 6 | T19 | The packaged app is proven here, always in test mode with the camera off. |

---

### Task 1: Contracts — Addendum B in core, wire and IPC types, vectors, shared test helpers

**Files:**
- Create: `packages/core/src/box.ts`, `packages/core/src/enrol.ts`, `packages/core/src/paper.ts`, `packages/core/src/policy.ts`, `packages/core/src/directory.ts`
- Modify: `packages/core/src/node.ts` (append `nativeBox`), `packages/core/src/wire.ts` (`binds`, `have`, `releases`, `parseBindReq`)
- Create: `tools/gen-vectors-addendum-b.ts` and the generated `fixtures/vectors/protocol-v1-addendum-b.json`
- Create: `tools/sim-custody.ts` (shared test helper: DEV manifest and releases, enrolment requests with one cached PIN record)
- Modify: `tools/sim-seat.ts` (optional explicit seat key)
- Modify: `apps/seat/src/shared/ipc.ts`, `apps/seat/src/preload/index.ts`, `apps/seat/src/main/journal-store.ts` (export `writeDurable`)
- Modify: `apps/server/src/serve.ts` (export `Handler`, `Routes`)
- Modify: `docs/protocol-v1.md` (append §15 Addendum B)
- Test: `packages/core/test/addendum-b.test.ts`, `packages/core/test/stage3-core.test.ts`

**Interfaces:**
- Consumes: `canon`, `bytes`, `protocol` (`kcf`, `Ctx`), `sig` (`Verify`, `nobleVerifier`), `node` (`newKeyPair`, `ecdh`, `signer`, `verifier`), `wire` (`NodeState`), `@noble/*`.
- Produces: every type and function in Global Constraints → "Shared types", plus:
  - `tools/sim-custody.ts`: `SIM_PIN`, `simPinRecord(): string`, `simBindReq(cand, seat: KeyPair, cellPub, seatId?, exam?): BindReq`, `simCustody(keys, exam?): { manifest: SignedManifest; K: {F1, F2}; release(form, ts?): ReleaseMsg }`.
  - `new SimSeat(keys, cand, cellPub, keyEpoch = 1, seat?: KeyPair)`.
  - `ipc.ts`: `Phase`, `BindState`, `Paper`, `PaperItem`, `EnrolInput`, `EnrolResult`, new optional `ExamBoot` fields, `SyncView.provisional?`, and `SeatApi.enrol/paper/onBoot` (preload implements them; main handles them in Task 14).

- [ ] **Step 1: Write `packages/core/src/box.ts`**

```ts
// Sealed box to a P-256 public key (protocol Addendum B.4). Browser-safe: noble by default; node.ts exports nativeBox, which
// produces the same bytes with native ECDH (≈30× faster), for seat main, the server and the swarm.
import { p256 } from '@noble/curves/nist.js';
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { concat, randomBytes, utf8 } from './bytes.ts';
import { canon, type Canon } from './canon.ts';

export interface BoxKeys { newKey(): { priv: Uint8Array; pub: Uint8Array }; ecdh(priv: Uint8Array, pub: Uint8Array): Uint8Array }
export const nobleBox: BoxKeys = {
  newKey: () => { const priv = p256.utils.randomSecretKey(); return { priv, pub: p256.getPublicKey(priv, false) }; },
  ecdh: (priv, pub) => p256.getSharedSecret(priv, pub).slice(1),          // the x-coordinate, as node's ECDH returns it
};
export const BOX_MIN = 65 + 24 + 16;
const boxKey = (shared: Uint8Array, info: Canon[]): Uint8Array => hkdf(sha256, shared, undefined, utf8(canon(info)), 32);

/** ephPub(65) ‖ nonce(24) ‖ XChaCha20-Poly1305(HKDF(ECDH x, info), nonce)(pt). */
export function sealBox(pub: Uint8Array, info: Canon[], pt: Uint8Array, k: BoxKeys = nobleBox): Uint8Array {
  if (pub.length !== 65 || pub[0] !== 4) throw new Error('box: the recipient must be a 65-byte uncompressed P-256 key');
  const eph = k.newKey(), nonce = randomBytes(24);
  return concat(eph.pub, nonce, xchacha20poly1305(boxKey(k.ecdh(eph.priv, pub), info), nonce).encrypt(pt));
}

export function openBox(priv: Uint8Array, info: Canon[], env: Uint8Array, k: BoxKeys = nobleBox): Uint8Array {
  if (env.length < BOX_MIN) throw new Error('box: too short');
  return xchacha20poly1305(boxKey(k.ecdh(priv, env.subarray(0, 65)), info), env.subarray(65, 89)).decrypt(env.subarray(89));
}
```

In `packages/core/src/node.ts`, add `import type { BoxKeys } from './box.ts';` to the imports and append:
```ts
/** Native ECDH for sealed boxes (Addendum B.4): the same bytes as box.ts's nobleBox. */
export const nativeBox: BoxKeys = { newKey: newKeyPair, ecdh };
```

- [ ] **Step 2: Write `packages/core/src/enrol.ts`**

```ts
// Enrolment (protocol Addendum B.1–B.5): the gate attestation, the cell key certificate, the cell-signed bind certificate
// and the PIN record sealed to the cell. Browser-safe; server and seat pass nativeBox / verifier from node.ts for speed.
import { p256 } from '@noble/curves/nist.js';
import { scrypt } from '@noble/hashes/scrypt.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { hexToBytes, randomBytes, toHex, utf8 } from './bytes.ts';
import { nobleBox, openBox, sealBox, type BoxKeys } from './box.ts';
import { canon, parseCanon, type Canon } from './canon.ts';
import type { Ctx } from './protocol.ts';
import { nobleVerifier, type Verify } from './sig.ts';

/** Addendum A.1 / B.1: structures that are not entries are signed as UTF-8(canon(array)), with no domain byte. */
export const msg = (a: Canon[]): Uint8Array => utf8(canon(a));

const HEX64 = /^[0-9a-f]{64}$/, PUB = /^04[0-9a-f]{128}$/, SIG = /^[0-9a-f]{128}$/;
const nat = (x: unknown): x is number => typeof x === 'number' && Number.isSafeInteger(x) && x >= 0;
const str = (x: unknown): x is string => typeof x === 'string' && x.length > 0 && x.length <= 64;
/** A 65-byte uncompressed P-256 key, in hex, that is really on the curve. */
export const isP256Pub = (hex: string): boolean => { if (!PUB.test(hex)) return false; try { p256.Point.fromHex(hex); return true; } catch { return false; } };

export const GATE_METHODS = ['aadhaar-face', 'aadhaar-fingerprint', 'id-document'] as const;
export type GateMethod = (typeof GATE_METHODS)[number];
export interface Attest { exam: string; shift: string; operatorId: string; time: number; method: GateMethod; cand: string }
/** B.3: the gate's existing check, as one hash the bind certificate carries. */
export const attestHash = (a: Attest): string => toHex(sha256(msg(['attest', a.exam, a.shift, a.operatorId, a.time, a.method, a.cand])));

/** B.2: cellKeyId = the first 16 hex of hex(SHA-256(pub)); the certificate is signed by the exam authority. */
export const cellKeyId = (pub: Uint8Array): string => toHex(sha256(pub)).slice(0, 16);
export const cellKeyArray = (c: { exam: string; cellId: string; keyId: string; pub: string }): Canon[] => ['cellkey', c.exam, c.cellId, c.keyId, c.pub];

export interface Bind extends Ctx { seatId: string; pub: string; keyEpoch: number; fromSeq: number; attestHash: string }
/** protocol-v1 §5 reserved layout, signed by the cell (B.1). The new key signs entries with seq > fromSeq. */
export const bindArray = (b: Bind): Canon[] => ['bind', b.exam, b.shift, b.attempt, b.cand, b.seatId, b.pub, b.keyEpoch, b.fromSeq, b.attestHash];
export function bindFromArray(a: Canon[]): Bind {
  const [tag, exam, shift, attempt, cand, seatId, pub, keyEpoch, fromSeq, ah] = a;
  if (a.length !== 10 || tag !== 'bind' || !str(exam) || !str(shift) || !nat(attempt) || !str(cand) || !str(seatId)
    || typeof pub !== 'string' || !PUB.test(pub) || !nat(keyEpoch) || keyEpoch < 1 || !nat(fromSeq) || typeof ah !== 'string' || !HEX64.test(ah))
    throw new Error('bind: bad shape');
  return { exam, shift, attempt, cand, seatId, pub, keyEpoch, fromSeq, attestHash: ah };
}

/** What a seat sends to enrol (non-normative JSON): the bind fields and its PIN record sealed to the cell, as hex. */
export interface BindReq extends Bind { pinBox: string }
/** A binding on the wire: the cell's certificate (its exact canonical text), the signing cell and the sealed PIN record. */
export interface WireBind { cert: string; sig: string; cell: string; pinBox: string }

/** Verify a binding against the cell's public key and return it. Throws on any fault. */
export function checkWireBind(wb: WireBind, cellPub: Uint8Array, mk: (pub: Uint8Array) => Verify = nobleVerifier): Bind {
  if (typeof wb?.cert !== 'string' || typeof wb.sig !== 'string' || !SIG.test(wb.sig)) throw new Error('bind: bad shape');
  const b = bindFromArray(parseCanon(wb.cert));
  if (!mk(cellPub)(utf8(wb.cert), hexToBytes(wb.sig))) throw new Error('bind: the cell signature does not verify');
  return b;
}

export const SCRYPT = { N: 16384, r: 8, p: 1, dkLen: 32 } as const;
export const isPin = (s: string): boolean => /^[0-9]{6}$/.test(s);
const PIN_RECORD = /^\["pin","[0-9a-f]{32}",16384,8,1,"[0-9a-f]{64}"\]$/;
export const isPinRecord = (text: string): boolean => PIN_RECORD.test(text);
/** B.5: canon(["pin", salt hex, N, r, p, scrypt(UTF-8(pin), salt) hex]). */
export function pinRecord(pin: string, salt: Uint8Array = randomBytes(16)): string {
  if (!isPin(pin)) throw new Error('the PIN must be exactly 6 digits');
  if (salt.length !== 16) throw new Error('the PIN salt is 16 bytes');
  return canon(['pin', toHex(salt), SCRYPT.N, SCRYPT.r, SCRYPT.p, toHex(scrypt(utf8(pin), salt, SCRYPT))]);
}
/** Stage 4 (handover by PIN) uses this; Stage 3 tests prove the record matches the PIN. */
export function checkPin(record: string, pin: string): boolean {
  if (!isPinRecord(record)) throw new Error('not a PIN record');
  const [, salt, , , , hash] = parseCanon(record) as [string, string, number, number, number, string];
  return isPin(pin) && toHex(scrypt(utf8(pin), hexToBytes(salt), SCRYPT)) === hash;
}

export const pinInfo = (b: Ctx & { seatId: string }): Canon[] => ['saakshi-pin', 1, b.exam, b.shift, b.attempt, b.cand, b.seatId];
export function makeBindReq(b: Bind, cellPub: Uint8Array, pinRec: string, k: BoxKeys = nobleBox): BindReq {
  return { ...b, pinBox: toHex(sealBox(cellPub, pinInfo(b), utf8(pinRec), k)) };
}
/** Cell: open a seat's PIN box. Throws unless it holds a well-formed PIN record. */
export function openPinBox(cellPriv: Uint8Array, b: Ctx & { seatId: string; pinBox: string }, k: BoxKeys = nobleBox): string {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(openBox(cellPriv, pinInfo(b), hexToBytes(b.pinBox), k));
  if (!isPinRecord(text)) throw new Error('pin box: not a PIN record');
  return text;
}
```

- [ ] **Step 3: Write `packages/core/src/paper.ts`**

```ts
// Split-custody paper release (plan §3.3, protocol Addendum B.2, B.6, B.7): the manifest (the public commitment), control's
// release, the paper and code-list ciphertexts, custodian share files, and the check every seat runs before it unlocks.
// Browser-safe.
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { scrypt } from '@noble/hashes/scrypt.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { concat, hexToBytes, randomBytes, toHex, utf8 } from './bytes.ts';
import { canon, type Canon } from './canon.ts';
import { msg, SCRYPT } from './enrol.ts';
import { kcf } from './protocol.ts';
import type { Verify } from './sig.ts';

const HEX64 = /^[0-9a-f]{64}$/, SIG = /^[0-9a-f]{128}$/;

export interface ManifestForm { form: string; ciphertextHash: string; kcf: string }
export interface Manifest { exam: string; shift: string; forms: ManifestForm[]; ts: number }
export interface SignedManifest { manifest: Manifest; sig: string }
export const manifestArray = (m: Manifest): Canon[] =>
  ['manifest', m.exam, m.shift, [...m.forms].sort((a, b) => (a.form < b.form ? -1 : a.form > b.form ? 1 : 0)).map((f) => [f.form, f.ciphertextHash, f.kcf]), m.ts];

/** Shape and authority signature; returns the manifest. */
export function checkManifest(sm: SignedManifest, authority: Verify): Manifest {
  const m = sm?.manifest;
  if (!m || typeof m.exam !== 'string' || typeof m.shift !== 'string' || !Number.isSafeInteger(m.ts) || !Array.isArray(m.forms) || !m.forms.length
    || !m.forms.every((f) => typeof f?.form === 'string' && HEX64.test(f.ciphertextHash) && HEX64.test(f.kcf))
    || typeof sm.sig !== 'string' || !SIG.test(sm.sig)) throw new Error('the manifest is malformed');
  if (!authority(msg(manifestArray(m)), hexToBytes(sm.sig))) throw new Error('the manifest signature does not verify');
  return m;
}

export interface Release { exam: string; shift: string; form: string; kcf: string; ts: number }
export const releaseArray = (r: Release): Canon[] => ['release', r.exam, r.shift, r.form, r.kcf, r.ts];
/** A release on the wire: control's signed release plus the key. On the offline-code path sig is '' and via is 'code'. */
export interface ReleaseMsg extends Release { key: string; sig: string; via: 'push' | 'code' }

/** Shape only (untrusted input); checkRelease decides whether the key is any good. */
export function parseReleaseMsg(x: unknown): ReleaseMsg {
  const r = x as Record<string, unknown>;
  if (typeof r !== 'object' || r === null) throw new Error('release: not an object');
  const s = (k: string): string => { const v = r[k]; if (typeof v !== 'string' || v.length > 256) throw new Error(`release: bad ${k}`); return v; };
  if (!Number.isSafeInteger(r.ts) || (r.ts as number) < 0) throw new Error('release: bad ts');
  if (r.via !== 'push' && r.via !== 'code') throw new Error('release: bad via');
  return { exam: s('exam'), shift: s('shift'), form: s('form'), kcf: s('kcf'), ts: r.ts as number, key: s('key'), sig: s('sig'), via: r.via };
}

export type ReleaseCheck = { ok: true; key: Uint8Array } | { ok: false; error: string };
/**
 * B.7, the seat's check, on every path: kc_f(key) must equal the signed manifest's kc_f for this form. A release that carries a
 * signature must also verify under the authority key. The offline-code release carries none — the manifest binds its key anyway.
 */
export function checkRelease(r: ReleaseMsg, m: Manifest, form: string, authority: Verify): ReleaseCheck {
  const no = (error: string): ReleaseCheck => ({ ok: false, error });
  if (r.exam !== m.exam || r.shift !== m.shift || r.form !== form) return no(`the key is for ${r.exam} ${r.shift} ${r.form}, not ${m.exam} ${m.shift} ${form}`);
  const f = m.forms.find((x) => x.form === form);
  if (!f) return no(`the manifest has no form ${form}`);
  if (!HEX64.test(r.key)) return no('the key is not 32 bytes');
  const key = hexToBytes(r.key);
  if (kcf(key) !== f.kcf) return no('the key does not match the published commitment kc_f');
  if (r.sig && (r.kcf !== f.kcf || !SIG.test(r.sig) || !authority(msg(releaseArray(r)), hexToBytes(r.sig)))) return no('the release signature does not verify');
  return { ok: true, key };
}

// B.6 symmetric boxes: nonce(24) ‖ XChaCha20-Poly1305(key, nonce, AAD = UTF-8(canon(aad))).
function seal(key: Uint8Array, aad: Canon[], pt: Uint8Array): Uint8Array {
  const nonce = randomBytes(24);
  return concat(nonce, xchacha20poly1305(key, nonce, utf8(canon(aad))).encrypt(pt));
}
function open(key: Uint8Array, aad: Canon[], ct: Uint8Array): Uint8Array {
  if (ct.length < 24 + 16) throw new Error('ciphertext too short');
  return xchacha20poly1305(key, ct.subarray(0, 24), utf8(canon(aad))).decrypt(ct.subarray(24));
}

export interface FormCtx { exam: string; shift: string; form: string }
export const sealPaper = (K: Uint8Array, c: FormCtx, pt: Uint8Array): Uint8Array => seal(K, ['saakshi-paper', c.exam, c.shift, c.form], pt);
export const openPaper = (K: Uint8Array, c: FormCtx, ct: Uint8Array): Uint8Array => open(K, ['saakshi-paper', c.exam, c.shift, c.form], ct);
export const ciphertextHash = (ct: Uint8Array): string => toHex(sha256(ct));

export const sealCodes = (L: Uint8Array, exam: string, shift: string, codes: Record<string, string>): Uint8Array =>
  seal(L, ['saakshi-codes', exam, shift], utf8(JSON.stringify(codes)));
export const openCodes = (L: Uint8Array, exam: string, shift: string, ct: Uint8Array): Record<string, string> =>
  JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(open(L, ['saakshi-codes', exam, shift], ct))) as Record<string, string>;

/** A custodian's share, sealed under their passphrase (B.6). Held by the custodian as a file or printed QR — never by control. */
export interface ShareFile { v: 1; exam: string; shift: string; custodian: string; salt: string; N: number; r: number; p: number; box: string }
const normPass = (p: string): Uint8Array => utf8(p.replace(/[\s-]/g, '').toUpperCase());
export function sealShareFile(share: Uint8Array, pass: string, c: { exam: string; shift: string; custodian: string }): ShareFile {
  const salt = randomBytes(16);
  const box = seal(scrypt(normPass(pass), salt, SCRYPT), ['saakshi-custodian', c.exam, c.shift, c.custodian], share);
  return { v: 1, exam: c.exam, shift: c.shift, custodian: c.custodian, salt: toHex(salt), N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, box: toHex(box) };
}
export function openShareFile(f: ShareFile, pass: string): Uint8Array {
  if (f?.v !== 1 || f.N !== SCRYPT.N || f.r !== SCRYPT.r || f.p !== SCRYPT.p || typeof f.salt !== 'string' || typeof f.box !== 'string') throw new Error('not a Saakshi share file');
  try { return open(scrypt(normPass(pass), hexToBytes(f.salt), SCRYPT), ['saakshi-custodian', f.exam, f.shift, f.custodian], hexToBytes(f.box)); }
  catch { throw new Error('wrong passphrase, or the share file was altered'); }
}
/** B.4 info for a share sealed to control's in-memory release key. */
export const shareInfo = (exam: string, shift: string, custodian: string, keyId: string): Canon[] => ['saakshi-share', 1, exam, shift, custodian, keyId];
```

- [ ] **Step 4: Write `packages/core/src/policy.ts` and `packages/core/src/directory.ts`**

`packages/core/src/policy.ts`:
```ts
// The signed per-centre policy (plan §3.4; Stage 3 fields only — Stage 5 adds the integrity rules). A seat never runs on an
// unsigned or altered policy. It pins the centre's cell key, D and each candidate's form, compensatory time and pseudonym.
import { hexToBytes, toHex } from './bytes.ts';
import { msg } from './enrol.ts';
import type { Verify } from './sig.ts';

export interface RosterEntry { form: 'F1' | 'F2'; extraMs: number; pseud: string }
export interface Policy {
  v: 1; exam: string; shift: string; centre: string;
  cell: { id: string; keyId: string; pub: string };
  durationMs: number; roster: Record<string, RosterEntry>; issuedAt: number;
}
export interface SignedPolicy { text: string; sig: string }
const pm = (exam: string, shift: string, centre: string, text: string) => msg(['policy', exam, shift, centre, text]);

export function signPolicy(p: Policy, sign: (m: Uint8Array) => Uint8Array): SignedPolicy {
  const text = JSON.stringify(p);
  return { text, sig: toHex(sign(pm(p.exam, p.shift, p.centre, text))) };
}

export function openPolicy(sp: SignedPolicy, authority: Verify, want: { exam: string; shift: string }): Policy {
  if (typeof sp?.text !== 'string' || typeof sp.sig !== 'string' || !/^[0-9a-f]{128}$/.test(sp.sig)) throw new Error('the policy is not signed');
  let p: Policy;
  try { p = JSON.parse(sp.text) as Policy; } catch { throw new Error('the policy is not JSON'); }
  if (typeof p?.exam !== 'string' || typeof p.shift !== 'string' || typeof p.centre !== 'string' || !authority(pm(p.exam, p.shift, p.centre, sp.text), hexToBytes(sp.sig)))
    throw new Error('the policy signature does not verify');
  if (p.v !== 1 || p.exam !== want.exam || p.shift !== want.shift) throw new Error(`the policy is for ${p.exam} ${p.shift}, not ${want.exam} ${want.shift}`);
  if (typeof p.cell?.id !== 'string' || !/^04[0-9a-f]{128}$/.test(p.cell.pub ?? '') || !Number.isSafeInteger(p.durationMs) || p.durationMs <= 0
    || typeof p.roster !== 'object' || p.roster === null) throw new Error('the policy is malformed');
  return p;
}
```

`packages/core/src/directory.ts`:
```ts
// The exam directory written by tools/provision.ts and tools/package.ts, and the control room's view types. Types and paths only.
import type { Manifest } from './paper.ts';
import type { RosterEntry } from './policy.ts';
import type { NodeState } from './wire.ts';

/** NTA, NIC and the independent observer each hold one Shamir share. */
export const CUSTODIANS = ['NTA', 'NIC', 'OBS'] as const;
export interface CellEntry { id: string; url: string; keyId: string; pub: string; /** authority signature over cellKeyArray */ cert: string }
export interface CellKeyFile { id: string; keyId: string; priv: string; pub: string }
export interface Directory {
  v: 1; exam: string; shift: string; durationMs: number; demoCentre: string; issuedAt: number;
  cells: CellEntry[]; centres: Record<string, { cell: string }>; cands: Record<string, RosterEntry & { centre: string }>;
}
export const FILES = {
  directory: 'directory.json',
  cellKey: (id: string) => `cells/${id}.key.json`,
  policy: (centre: string) => `policies/${centre}.json`,
  pseudKey: 'control/pseud.key',
  manifest: 'package/manifest.json',
  paper: (form: string) => `package/paper-${form}.bin`,
  wraps: 'package/wraps.json',
  codes: 'package/codes.bin',
  share: (custodian: string) => `custodians/${custodian}.share.json`,
} as const;
export const rosterOf = (d: Directory, centre: string): string[] => Object.keys(d.cands).filter((c) => d.cands[c].centre === centre).sort();

export interface CentreStats { registered: number; bound: number; unlocked: number; submitted: number; entries: number }
export interface CellStats { cell: string; state: NodeState; entries: number; centres: Record<string, CentreStats> }
export type TileTone = 'green' | 'partial' | 'locked' | 'down';
export interface CentreTile extends CentreStats { centre: string; cell: string; tone: TileTone }
export interface FleetView {
  at: number; registered: number; bound: number; unlocked: number; submitted: number; entries: number; entriesPerSec: number;
  cells: { id: string; state: NodeState | 'DOWN'; entries: number }[]; centres: CentreTile[];
}
export interface ReleaseStatus {
  exam: string; shift: string; keyId: string; custodians: string[]; received: string[]; needed: number;
  released?: { at: number; custodians: string[]; forms: { form: string; kcf: string }[] };
  pushed: Record<string, boolean>; zeroised: boolean; reveals: { at: number; centre: string; superintendent: string }[]; manifest: Manifest;
}
```

- [ ] **Step 5: Extend `packages/core/src/wire.ts`**

Add at the top: `import type { BindReq, WireBind } from './enrol.ts';` and `import type { ReleaseMsg } from './paper.ts';`.

Replace `SyncReq` and `SyncRes`:
```ts
/** POST /v1/sync. `replay`/`done` are sent only relay → cell while the cell is REBUILDING. */
export interface SyncReq {
  entries: WireEntry[]; streams: Hello[]; replay?: true; done?: true;
  /** Stage 3: cell-signed bindings — seat → relay on first contact, relay → cell on a REBUILDING replay. Processed before entries. */
  binds?: WireBind[];
  /** Stage 3, relay → cell: how many signed releases the relay already holds for this shift. */
  have?: number;
}
export interface SyncRes { streams: StreamStatus[]; rejected: Rejection[]; /** Stage 3, cell → relay: every release, when the relay has fewer. */ releases?: ReleaseMsg[] }
```
Change `LIMITS` to `{ entries: 500, streams: 5000, line: 4096, env: 16384, field: 64, pinBox: 2048 } as const`.

In `parseSyncReq`, destructure `binds` and `have` too, and before `if (replay) out.replay = true;` add:
```ts
  if (binds !== undefined) {
    if (!Array.isArray(binds) || binds.length > LIMITS.entries) throw new Error(`sync: binds must be an array of at most ${LIMITS.entries}`);
    out.binds = binds.map((b, i) => {
      if (!isObj(b) || typeof b.cert !== 'string' || b.cert.length > LIMITS.line || typeof b.sig !== 'string' || !/^[0-9a-f]{128}$/.test(b.sig)
        || !field(b.cell) || typeof b.pinBox !== 'string' || b.pinBox.length > LIMITS.pinBox || !/^[0-9a-f]*$/.test(b.pinBox)) throw new Error(`sync: binds[${i}] must be {cert, sig, cell, pinBox}`);
      return { cert: b.cert, sig: b.sig, cell: b.cell, pinBox: b.pinBox };
    });
  }
  if (have !== undefined) { if (!nat(have)) throw new Error('sync: have must be a count'); out.have = have; }
```
Append:
```ts
/** Validate an untrusted enrolment request (seat → relay → cell); returns a clean copy. */
export function parseBindReq(x: unknown): BindReq {
  if (!isObj(x)) throw new Error('enrol: body must be an object');
  const { exam, shift, attempt, cand, seatId, pub, keyEpoch, fromSeq, attestHash, pinBox } = x;
  if (!field(exam) || !field(shift) || !nat(attempt) || !field(cand) || !field(seatId)) throw new Error('enrol: need exam, shift, attempt, cand, seatId');
  if (typeof pub !== 'string' || !/^04[0-9a-f]{128}$/.test(pub)) throw new Error('enrol: pub must be a 65-byte uncompressed P-256 key in hex');
  if (!nat(keyEpoch) || keyEpoch < 1 || !nat(fromSeq)) throw new Error('enrol: bad keyEpoch or fromSeq');
  if (typeof attestHash !== 'string' || !/^[0-9a-f]{64}$/.test(attestHash)) throw new Error('enrol: attestHash must be 64 hex');
  if (typeof pinBox !== 'string' || pinBox.length > LIMITS.pinBox || !/^[0-9a-f]+$/.test(pinBox)) throw new Error('enrol: pinBox must be hex');
  return { exam, shift, attempt, cand, seatId, pub, keyEpoch, fromSeq, attestHash, pinBox };
}
```

- [ ] **Step 6: Shared helpers and small contract edits**

`tools/sim-custody.ts`:
```ts
// Stage 3 test helpers: a DEV manifest with known keys and control-signed releases, and enrolment requests that share one PIN
// record (scrypt costs ~150 ms; a simulation shortcut — real seats salt their own).
import { hexToBytes, randomBytes, toHex } from '../packages/core/src/bytes.ts';
import { DEV_EXAM, type KeysFile } from '../packages/core/src/dev.ts';
import { attestHash, makeBindReq, msg, pinRecord, type BindReq } from '../packages/core/src/enrol.ts';
import { nativeBox, signer, type KeyPair } from '../packages/core/src/node.ts';
import { manifestArray, releaseArray, type Manifest, type ReleaseMsg, type SignedManifest } from '../packages/core/src/paper.ts';
import { kcf } from '../packages/core/src/protocol.ts';

type Exam = { exam: string; shift: string };
export const SIM_PIN = '123456';
let rec: string | undefined;
export const simPinRecord = (): string => (rec ??= pinRecord(SIM_PIN));

export function simBindReq(cand: string, seat: KeyPair, cellPub: Uint8Array, seatId = `SIM-${cand}`, x: Exam = DEV_EXAM): BindReq {
  const b = {
    exam: x.exam, shift: x.shift, attempt: 1, cand, seatId, pub: toHex(seat.pub), keyEpoch: 1, fromSeq: 0,
    attestHash: attestHash({ exam: x.exam, shift: x.shift, operatorId: 'SIM-GATE', time: 0, method: 'aadhaar-face', cand }),
  };
  return makeBindReq(b, cellPub, simPinRecord(), nativeBox);
}

export interface SimCustody { manifest: SignedManifest; K: Record<'F1' | 'F2', Uint8Array>; release(form: 'F1' | 'F2', ts?: number): ReleaseMsg }
export function simCustody(keys: KeysFile, x: Exam = DEV_EXAM): SimCustody {
  const K = { F1: randomBytes(32), F2: randomBytes(32) };
  const sign = signer({ priv: hexToBytes(keys.authority.priv), pub: hexToBytes(keys.authority.pub) });
  const m: Manifest = { exam: x.exam, shift: x.shift, ts: 1, forms: (['F1', 'F2'] as const).map((form) => ({ form, ciphertextHash: '0'.repeat(64), kcf: kcf(K[form]) })) };
  return {
    manifest: { manifest: m, sig: toHex(sign(msg(manifestArray(m)))) }, K,
    release(form, ts = 2) {
      const r = { exam: m.exam, shift: m.shift, form, kcf: kcf(K[form]), ts };
      return { ...r, key: toHex(K[form]), sig: toHex(sign(msg(releaseArray(r)))), via: 'push' };
    },
  };
}
```

`tools/sim-seat.ts`: change the constructor to
```ts
  constructor(keys: KeysFile, cand: string, cellPub: Uint8Array, keyEpoch = 1, seat?: KeyPair) {
    const k = seat ?? devSeat(keys, cand);
```
and add `import type { KeyPair } from '../packages/core/src/node.ts';` (merge into the existing `node.ts` import). Nothing else changes.

`apps/seat/src/main/journal-store.ts`: `function writeDurable` → `export function writeDurable`.

`apps/server/src/serve.ts`: change the imports and the handler type, keeping everything else:
```ts
import type { Hub, Timeouts } from './sse.ts';
/** A route handler. Bun passes the server as the second argument; SSE routes need server.timeout. */
export type Handler = (req: Request, server: Timeouts) => Response | Promise<Response>;
export type Routes = Record<string, Partial<Record<'GET' | 'POST', Handler>>>;
```
and `routes?: Routes;` in `ServeOpts`.

`apps/seat/src/shared/ipc.ts` — replace the file:
```ts
// Contract between Electron main and the renderer. Types only.
import type { State } from '@saakshi/core/protocol';
export type { GateMethod } from '@saakshi/core/enrol';
import type { GateMethod } from '@saakshi/core/enrol';

export type Lang = 'en' | 'hi';
/** The latest journaled state of one item; seq is the entry that set it (drives the tick). */
export interface ItemState { state: State; answer: string; seq: number }
/** local ✓ / relay ✓✓ / cell blue ✓✓. provisional: the cell has not ratified this seat's binding, so nothing leaves the seat. */
export interface SyncView { local: number; relay: number; cell: number; online: boolean; error: string; provisional?: boolean }
/** Computed on the seat at submit from its own journal (protocol Addendum A.5). */
export interface Receipt {
  exam: string; shift: string; cand: string; form: string; code: string;
  seq: number; h: string; finalHash: string; attempted: number; answered: number; marked: number; total: number;
}
/** connecting: no verified package yet · enrol: no seat key · locked: waiting for T0 · ready: unlocked, not started. */
export type Phase = 'connecting' | 'enrol' | 'locked' | 'ready' | 'exam' | 'submitted';
export type BindState = 'none' | 'provisional' | 'bound' | 'refused';
export interface PaperItem { id: string; subject: string; en: { q: string; o: string[] }; hi: { q: string; o: string[] } }
/** The decrypted paper for this seat's form, in form order. It exists only after a key that matches kc_f. */
export interface Paper { exam: string; form: string; items: PaperItem[] }
export interface ExamBoot {
  cand: string; seatId: string; form: 'F1' | 'F2'; durationMs: number;
  activeMs: number; started: boolean; items: Record<string, ItemState>; sync: SyncView;
  receipt?: Receipt;
  /** false with --no-camera, SAAKSHI_NO_CAMERA=1 or test mode. */
  camera: boolean;
  // Stage 3 (optional so the Stage 2 main keeps compiling until Task 14)
  phase?: Phase; centre?: string; bind?: BindState;
  /** The last problem to show (package, enrolment, a rejected key); '' if none. */
  notice?: string;
  /** kc_f of this seat's form, from the signed manifest (shown while locked). */
  commitment?: string;
  release?: { via: 'push' | 'code' };
  /** DEV test keystore: the renderer shows a permanent banner. */
  testMode?: boolean;
}
export interface EnrolInput { pin: string; operatorId: string; method: GateMethod }
export type EnrolResult = { ok: true; bind: BindState } | { ok: false; error: string };
/** answer → A + option; mark → MR with '' or AMR + option; clear → NA with '' (also a first visit, Addendum A.6). */
export interface Action { kind: 'answer' | 'mark' | 'clear'; item: string; state: State; answer: string; dwellMs: number }
export type ActResult = { ok: true; seq: number; activeMs: number } | { ok: false; error: string };
export type SubmitResult = { ok: true; receipt: Receipt } | { ok: false; error: string };
export interface SeatApi {
  load(): Promise<ExamBoot>;
  enrol(e: EnrolInput): Promise<EnrolResult>;
  paper(): Promise<Paper | null>;
  start(): Promise<ActResult>;
  act(a: Action): Promise<ActResult>;
  submit(): Promise<SubmitResult>;
  onSync(cb: (v: SyncView) => void): () => void;
  onBoot(cb: (b: ExamBoot) => void): () => void;
}
```

`apps/seat/src/preload/index.ts` — replace the file:
```ts
import { contextBridge, ipcRenderer } from 'electron';
import type { Action, EnrolInput, ExamBoot, SeatApi, SyncView } from '../shared/ipc.ts';

const on = <T>(channel: string, cb: (v: T) => void) => {
  const h = (_e: unknown, v: T) => cb(v);
  ipcRenderer.on(channel, h);
  return () => { ipcRenderer.removeListener(channel, h); };
};
const api: SeatApi = {
  load: () => ipcRenderer.invoke('exam:load'),
  enrol: (e: EnrolInput) => ipcRenderer.invoke('exam:enrol', e),
  paper: () => ipcRenderer.invoke('exam:paper'),
  start: () => ipcRenderer.invoke('exam:start'),
  act: (a: Action) => ipcRenderer.invoke('exam:act', a),
  submit: () => ipcRenderer.invoke('exam:submit'),
  onSync: (cb) => on<SyncView>('sync', cb),
  onBoot: (cb) => on<ExamBoot>('boot', cb),
};
contextBridge.exposeInMainWorld('saakshi', api);
```

- [ ] **Step 7: Write the failing tests**

`packages/core/test/stage3-core.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { hexToBytes, randomBytes, toHex, utf8 } from '../src/bytes.ts';
import { nobleBox, openBox, sealBox } from '../src/box.ts';
import type { KeysFile } from '../src/dev.ts';
import { bindArray, checkPin, checkWireBind, isP256Pub, isPin, makeBindReq, openPinBox, pinRecord, type Bind } from '../src/enrol.ts';
import { canon } from '../src/canon.ts';
import { nativeBox, newKeyPair, signer, verifier } from '../src/node.ts';
import { checkRelease, openShareFile, parseReleaseMsg, sealShareFile } from '../src/paper.ts';
import { openPolicy, signPolicy, type Policy } from '../src/policy.ts';
import { nobleVerifier } from '../src/sig.ts';
import { parseBindReq, parseSyncReq } from '../src/wire.ts';
import { simCustody } from '../../../tools/sim-custody.ts';

const keys = JSON.parse(readFileSync(new URL('../../../fixtures/keys.json', import.meta.url), 'utf8')) as KeysFile;
const cell = { priv: hexToBytes(keys.cells[0].priv), pub: hexToBytes(keys.cells[0].pub) };
const auth = { priv: hexToBytes(keys.authority.priv), pub: hexToBytes(keys.authority.pub) };
const bind: Bind = { exam: 'DEMO-2026', shift: 'S1', attempt: 1, cand: 'C0001', seatId: 'CEN042-S01', pub: keys.seats[0].pub, keyEpoch: 1, fromSeq: 0, attestHash: 'ab'.repeat(32) };

test('sealed box: noble and native interoperate both ways; another info, key or a flipped byte fails', () => {
  const pt = utf8('share');
  for (const [a, b] of [[nobleBox, nativeBox], [nativeBox, nobleBox]] as const) {
    const env = sealBox(cell.pub, ['i', 1], pt, a);
    assert.deepEqual(openBox(cell.priv, ['i', 1], env, b), pt);
    assert.throws(() => openBox(cell.priv, ['i', 2], env, b));
    assert.throws(() => openBox(newKeyPair().priv, ['i', 1], env, b));
    const bad = env.slice(); bad[bad.length - 1] ^= 1;
    assert.throws(() => openBox(cell.priv, ['i', 1], bad, b));
  }
});

test('PIN record: 6 digits only; the record checks the PIN; the box opens only at the cell and only as a PIN record', () => {
  assert.equal(isPin('012345'), true);
  for (const p of ['12345', '1234567', '12a456', ' 12345']) assert.throws(() => pinRecord(p), /6 digits/);
  const rec = pinRecord('482913');
  assert.equal(checkPin(rec, '482913'), true);
  assert.equal(checkPin(rec, '482914'), false);
  const req = makeBindReq(bind, cell.pub, rec, nativeBox);
  assert.equal(openPinBox(cell.priv, req, nativeBox), rec);
  assert.throws(() => openPinBox(hexToBytes(keys.cells[1].priv), req, nativeBox));
  assert.throws(() => openPinBox(cell.priv, { ...req, seatId: 'OTHER' }, nativeBox));   // the info binds the seat
});

test('bind certificate: verifies with the cell key (native and noble); another cell, an edited cert or a bad sig fails', () => {
  const cert = canon(bindArray(bind));
  const wb = { cert, sig: toHex(signer(cell)(utf8(cert))), cell: 'cell-1', pinBox: '' };
  assert.deepEqual(checkWireBind(wb, cell.pub, verifier), bind);
  assert.deepEqual(checkWireBind(wb, cell.pub, nobleVerifier), bind);
  assert.throws(() => checkWireBind(wb, hexToBytes(keys.cells[1].pub)), /does not verify/);
  assert.throws(() => checkWireBind({ ...wb, cert: cert.replace('C0001', 'C0002') }, cell.pub), /does not verify/);
  assert.throws(() => checkWireBind({ ...wb, sig: 'zz' }, cell.pub), /bad shape/);
  assert.equal(isP256Pub(keys.seats[0].pub), true);
  assert.equal(isP256Pub('04' + '00'.repeat(64)), false);                       // the right length, but not on the curve
});

test('policy: a signed policy opens; unsigned, altered, re-signed by a stranger or for another shift is refused', () => {
  const p: Policy = { v: 1, exam: 'DEMO-2026', shift: 'S1', centre: 'CEN042', cell: { id: 'cell-1', keyId: 'k', pub: keys.cells[0].pub }, durationMs: 1_800_000, roster: {}, issuedAt: 0 };
  const sp = signPolicy(p, signer(auth));
  const V = verifier(auth.pub), want = { exam: 'DEMO-2026', shift: 'S1' };
  assert.deepEqual(openPolicy(sp, V, want), p);
  assert.throws(() => openPolicy({ text: sp.text, sig: '' }, V, want), /not signed/);
  assert.throws(() => openPolicy({ ...sp, text: sp.text.replace('1800000', '9900000') }, V, want), /does not verify/);
  assert.throws(() => openPolicy(signPolicy(p, signer(newKeyPair())), V, want), /does not verify/);
  assert.throws(() => openPolicy(sp, V, { exam: 'DEMO-2026', shift: 'S2' }), /is for/);
});

test('checkRelease (B.7): a signed release and an unsigned code-path key pass only when kc_f matches', () => {
  const c = simCustody(keys), m = c.manifest.manifest, V = verifier(auth.pub);
  const r = c.release('F1');
  assert.equal(checkRelease(r, m, 'F1', V).ok, true);
  assert.equal(checkRelease({ ...r, sig: '', via: 'code' }, m, 'F1', V).ok, true);
  const wrong = toHex(randomBytes(32));
  assert.match((checkRelease({ ...r, key: wrong }, m, 'F1', V) as { error: string }).error, /kc_f/);
  assert.match((checkRelease({ ...r, key: wrong, sig: '', via: 'code' }, m, 'F1', V) as { error: string }).error, /kc_f/);
  assert.match((checkRelease({ ...r, ts: 99 }, m, 'F1', V) as { error: string }).error, /signature/);
  assert.equal(checkRelease(r, m, 'F2', V).ok, false);
  assert.throws(() => parseReleaseMsg({ ...r, via: 'magic' }), /via/);
});

test('custodian share file: the passphrase tolerates dashes, spaces and case; a wrong one fails with a clear message', () => {
  const share = randomBytes(97), pass = 'N5JY1E59BR0FGNVQW';
  const f = sealShareFile(share, pass, { exam: 'DEMO-2026', shift: 'S1', custodian: 'NTA' });
  assert.deepEqual(openShareFile(f, 'n5jy-1e59 br0f-gnvq-w'), share);
  assert.throws(() => openShareFile(f, 'N5JY1E59BR0FGNVQX'), /wrong passphrase/);
});

test('wire: binds and have are validated; a bind request needs every field', () => {
  const wb = { cert: '["bind"]', sig: 'a'.repeat(128), cell: 'cell-1', pinBox: 'ab' };
  assert.deepEqual(parseSyncReq({ entries: [], binds: [wb], have: 2 }), { entries: [], streams: [], binds: [wb], have: 2 });
  assert.throws(() => parseSyncReq({ entries: [], binds: [{ ...wb, sig: 'x' }] }), /binds\[0\]/);
  assert.throws(() => parseSyncReq({ entries: [], have: -1 }), /have/);
  const req = makeBindReq(bind, cell.pub, pinRecord('111111'), nativeBox);
  assert.deepEqual(parseBindReq(req), req);
  assert.throws(() => parseBindReq({ ...req, pub: 'zz' }), /pub/);
  assert.throws(() => parseBindReq({ ...req, keyEpoch: 0 }), /keyEpoch/);
});
```

`packages/core/test/addendum-b.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { hexToBytes } from '../src/bytes.ts';
import { canon } from '../src/canon.ts';
import { nobleBox, openBox } from '../src/box.ts';
import type { KeysFile } from '../src/dev.ts';
import { attestHash, bindArray, cellKeyArray, checkPin, checkWireBind, msg, openPinBox, pinRecord, type Attest, type Bind } from '../src/enrol.ts';
import { nativeBox, verifier } from '../src/node.ts';
import { checkManifest, checkRelease, ciphertextHash, manifestArray, openCodes, openPaper, openShareFile, releaseArray, shareInfo, type Manifest, type ShareFile } from '../src/paper.ts';
import { openPolicy, type SignedPolicy } from '../src/policy.ts';
import { nobleVerifier } from '../src/sig.ts';

const keys = JSON.parse(readFileSync(new URL('../../../fixtures/keys.json', import.meta.url), 'utf8')) as KeysFile;
const B = JSON.parse(readFileSync(new URL('../../../fixtures/vectors/protocol-v1-addendum-b.json', import.meta.url), 'utf8'));
const authPub = hexToBytes(keys.authority.pub), cellPub = hexToBytes(keys.cells[0].pub), cellPriv = hexToBytes(keys.cells[0].priv);
const both = (pub: Uint8Array) => [verifier(pub), nobleVerifier(pub)];

test('B.3 attestHash recomputes', () => assert.equal(attestHash(B.attest.in as Attest), B.attest.attestHash));

test('B.2 cell key and bind certificates: canonical text recomputes; signatures verify natively and with noble', () => {
  assert.equal(canon(cellKeyArray(B.cellkey.in)), B.cellkey.text);
  for (const v of both(authPub)) assert.equal(v(msg(cellKeyArray(B.cellkey.in)), hexToBytes(B.cellkey.sig)), true);
  assert.equal(canon(bindArray(B.bind.in as Bind)), B.bind.text);
  for (const mk of [verifier, nobleVerifier]) assert.deepEqual(checkWireBind({ cert: B.bind.text, sig: B.bind.sig, cell: 'cell-1', pinBox: '' }, cellPub, mk), B.bind.in);
});

test('B.5 PIN record: noble scrypt = node:crypto scryptSync; the box opens at cells[0] with noble and native ECDH', () => {
  assert.equal(pinRecord(B.pin.pin, hexToBytes(B.pin.salt)), B.pin.record);
  const node = crypto.scryptSync(B.pin.pin, hexToBytes(B.pin.salt), 32, { N: 16384, r: 8, p: 1 });
  assert.equal(B.pin.record.includes(node.toString('hex')), true);
  assert.equal(checkPin(B.pin.record, B.pin.pin), true);
  const b = { ...B.bind.in, pinBox: B.pin.box };
  for (const k of [nobleBox, nativeBox]) assert.equal(openPinBox(cellPriv, b, k), B.pin.record);
});

test('B.4 policy, B.2 manifest and release verify; the paper opens with K and hashes to the manifest', () => {
  const p = openPolicy(B.policy.signed as SignedPolicy, verifier(authPub), { exam: 'DEMO-2026', shift: 'S1' });
  assert.equal(p.cell.pub, keys.cells[0].pub);
  const m = B.manifest.in as Manifest;
  assert.equal(canon(manifestArray(m)), B.manifest.text);
  for (const v of both(authPub)) assert.deepEqual(checkManifest({ manifest: m, sig: B.manifest.sig }, v), m);
  assert.equal(canon(releaseArray(B.release.in)), B.release.text);
  const ct = hexToBytes(B.paper.ct);
  assert.equal(ciphertextHash(ct), m.forms[0].ciphertextHash);
  assert.equal(new TextDecoder().decode(openPaper(hexToBytes(B.paper.K), { exam: 'DEMO-2026', shift: 'S1', form: 'F1' }, ct)), B.paper.text);
  assert.throws(() => openPaper(hexToBytes(B.paper.K), { exam: 'DEMO-2026', shift: 'S1', form: 'F2' }, ct));
});

test('B.7 the seat check on the vector: the signed release passes; the same key unsigned passes; any other key fails', () => {
  const m = B.manifest.in as Manifest, r = { ...B.release.in, key: B.release.key, sig: B.release.sig, via: 'push' as const };
  for (const v of both(authPub)) {
    assert.equal(checkRelease(r, m, 'F1', v).ok, true);
    assert.equal(checkRelease({ ...r, sig: '', via: 'code' }, m, 'F1', v).ok, true);
    assert.equal(checkRelease({ ...r, key: '22'.repeat(32) }, m, 'F1', v).ok, false);
  }
});

test('B.6 code list and custodian share file open; B.4 the share box opens with the recipient key', () => {
  assert.deepEqual(openCodes(hexToBytes(B.codes.L), 'DEMO-2026', 'S1', hexToBytes(B.codes.ct)), B.codes.codes);
  assert.deepEqual(openShareFile(B.shareFile.file as ShareFile, B.shareFile.pass), hexToBytes(B.shareFile.share));
  const priv = hexToBytes(keys.seats[B.shareBox.recipientSeat].priv);
  const info = shareInfo('DEMO-2026', 'S1', B.shareBox.custodian, B.shareBox.keyId);
  for (const k of [nobleBox, nativeBox]) assert.deepEqual(openBox(priv, info, hexToBytes(B.shareBox.box), k), hexToBytes(B.shareFile.share));
});
```

- [ ] **Step 8: Run the unit tests to verify they fail**

Run: `node --test packages/core/test/stage3-core.test.ts`
Expected: FAIL — `../src/box.ts` cannot be found (then, once Steps 1–6 exist, every test passes; write the code before Step 9).

- [ ] **Step 9: Write `tools/gen-vectors-addendum-b.ts` and generate the vectors**

```ts
// Writes fixtures/vectors/protocol-v1-addendum-b.json (protocol Addendum B). Run once; refuses to overwrite.
//   node tools/gen-vectors-addendum-b.ts
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { hexToBytes, toHex, utf8 } from '../packages/core/src/bytes.ts';
import { sealBox } from '../packages/core/src/box.ts';
import { canon } from '../packages/core/src/canon.ts';
import type { KeysFile } from '../packages/core/src/dev.ts';
import { attestHash, bindArray, cellKeyArray, cellKeyId, makeBindReq, msg, pinRecord } from '../packages/core/src/enrol.ts';
import { nativeBox, signer } from '../packages/core/src/node.ts';
import { ciphertextHash, manifestArray, releaseArray, sealCodes, sealPaper, sealShareFile, shareInfo } from '../packages/core/src/paper.ts';
import { signPolicy, type Policy } from '../packages/core/src/policy.ts';
import { kcf } from '../packages/core/src/protocol.ts';

const OUT = 'fixtures/vectors/protocol-v1-addendum-b.json';
if (existsSync(OUT)) { console.log(`keep ${OUT} (frozen)`); process.exit(0); }
const keys = JSON.parse(readFileSync('fixtures/keys.json', 'utf8')) as KeysFile;
const auth = { priv: hexToBytes(keys.authority.priv), pub: hexToBytes(keys.authority.pub) };
const cell = { priv: hexToBytes(keys.cells[0].priv), pub: hexToBytes(keys.cells[0].pub) };
const signA = signer(auth), signC = signer(cell);
const X = { exam: 'DEMO-2026', shift: 'S1' };

const attest = { ...X, operatorId: 'GATE-42-OP7', time: 1790000000000, method: 'aadhaar-face' as const, cand: 'C0001' };
const bind = { ...X, attempt: 1, cand: 'C0001', seatId: 'CEN042-S01', pub: keys.seats[0].pub, keyEpoch: 1, fromSeq: 0, attestHash: attestHash(attest) };
const bindText = canon(bindArray(bind));
const cellkey = { exam: X.exam, cellId: 'cell-1', keyId: cellKeyId(cell.pub), pub: keys.cells[0].pub };
const pin = { pin: '123456', salt: '01'.repeat(16) };
const record = pinRecord(pin.pin, hexToBytes(pin.salt));
const K1 = new Uint8Array(32).fill(0x11), K2 = new Uint8Array(32).fill(0x22), L = new Uint8Array(32).fill(0x33);
const paperText = JSON.stringify({ exam: X.exam, form: 'F1', items: [{ id: 'I01', subject: 'physics', en: { q: 'What is the SI unit of force?', o: ['Joule', 'Watt', 'Pascal', 'Newton'] }, hi: { q: 'बल का SI मात्रक क्या है?', o: ['जूल', 'वाट', 'पास्कल', 'न्यूटन'] } }] });
const ct1 = sealPaper(K1, { ...X, form: 'F1' }, utf8(paperText));
const manifest = { ...X, forms: [{ form: 'F1', ciphertextHash: ciphertextHash(ct1), kcf: kcf(K1) }, { form: 'F2', ciphertextHash: '0'.repeat(64), kcf: kcf(K2) }], ts: 1790000000000 };
const release = { ...X, form: 'F1', kcf: kcf(K1), ts: 1790000100000 };
const policy: Policy = { v: 1, ...X, centre: 'CEN042', cell: { id: 'cell-1', keyId: cellkey.keyId, pub: cellkey.pub }, durationMs: 1_800_000, roster: { C0001: { form: 'F1', extraMs: 0, pseud: '7'.repeat(64) } }, issuedAt: 1790000000000 };
const codes = { CEN042: 'N5JY1E59BR0FGNVQW' };
const share = Uint8Array.from({ length: 97 }, (_, i) => i);
const releaseKeyId = 'feedfacecafebeef', recipientSeat = 7;

writeFileSync(OUT, JSON.stringify({
  _note: 'Protocol v1 Addendum B. Signatures, nonces, salts of boxes and ephemeral keys are random: verify or open them, never compare bytes.',
  attest: { in: attest, attestHash: attestHash(attest) },
  cellkey: { in: cellkey, text: canon(cellKeyArray(cellkey)), sig: toHex(signA(msg(cellKeyArray(cellkey)))) },
  bind: { in: bind, text: bindText, sig: toHex(signC(utf8(bindText))) },
  pin: { ...pin, record, box: makeBindReq(bind, cell.pub, record, nativeBox).pinBox },
  policy: { signed: signPolicy(policy, signA) },
  paper: { K: toHex(K1), text: paperText, ct: toHex(ct1) },
  manifest: { in: manifest, text: canon(manifestArray(manifest)), sig: toHex(signA(msg(manifestArray(manifest)))) },
  release: { in: release, text: canon(releaseArray(release)), sig: toHex(signA(msg(releaseArray(release)))), key: toHex(K1) },
  codes: { L: toHex(L), codes, ct: toHex(sealCodes(L, X.exam, X.shift, codes)) },
  shareFile: { pass: 'TESTPASSPHRASE01', share: toHex(share), file: sealShareFile(share, 'TESTPASSPHRASE01', { ...X, custodian: 'NTA' }) },
  shareBox: { keyId: releaseKeyId, custodian: 'NTA', recipientSeat, box: toHex(sealBox(hexToBytes(keys.seats[recipientSeat].pub), shareInfo(X.exam, X.shift, 'NTA', releaseKeyId), share, nativeBox)) },
}, null, 2) + '\n');
console.log(`wrote ${OUT}`);
```
Run: `node tools/gen-vectors-addendum-b.ts`
Expected: `wrote fixtures/vectors/protocol-v1-addendum-b.json`. A second run prints `keep … (frozen)`.

- [ ] **Step 10: Append §15 to `docs/protocol-v1.md`**

Append (exact text):
````markdown
## 15. Addendum B (Stage 3, 2026-09-27)

This addendum is additive only. No byte defined in §1–§14 changes, so `V` stays 1.

- Vectors: `fixtures/vectors/protocol-v1-addendum-b.json`, produced by `tools/gen-vectors-addendum-b.ts`, checked by `packages/core/test/addendum-b.test.ts`.
- Code: `box.ts`, `enrol.ts`, `paper.ts`, `policy.ts`.

**B.1 Signatures.** These are signed as `m = UTF-8(canon(array))` with no domain byte (as A.1):

| Structure | Array | Signed by |
|---|---|---|
| cell key certificate | `["cellkey",exam,cellId,cellKeyId,pub]` | the exam authority |
| bind certificate | `["bind",exam,shift,attempt,cand,seatId,pubkey,keyEpoch,fromSeq,attestHash]` (§5) | the cell |
| policy | `["policy",exam,shift,centre,text]` | the exam authority |
| manifest | `["manifest",exam,shift,[[form,ciphertextHash,kc_f]…],ts]` | the exam authority |
| release | `["release",exam,shift,form,kc_f,ts]` (§5) | control (the authority key in DEV) |

**B.2 Fields.**
- `cellKeyId` = the first 16 hex characters of `hex(SHA-256(pub))`. `pub`/`pubkey` are 130 lowercase hex (65-byte uncompressed P-256).
- `keyEpoch ≥ 1`, `fromSeq ≥ 0`. The key in a bind certificate signs the candidate's entries with `seq > fromSeq`. First enrolment: `keyEpoch 1`, `fromSeq 0`.
- `attestHash`, `ciphertextHash` and `kc_f` are 64 hex. In the manifest, forms are sorted by name (JS `<`). `ts` is ms since the Unix epoch.
- `text` in a policy is the policy's JSON (non-normative fields: `v, exam, shift, centre, cell {id, keyId, pub}, durationMs, roster {cand: {form, extraMs, pseud}}, issuedAt`). A seat refuses a policy whose signature does not verify.

**B.3 Gate attestation.** `attestHash = hex(SHA-256(UTF-8(canon(["attest",exam,shift,operatorId,time,method,cand]))))`, `time` in ms, `method` one of `aadhaar-face`, `aadhaar-fingerprint`, `id-document`.

**B.4 Sealed box.**
```
box = ephPub(65) ‖ nonce(24) ‖ XChaCha20-Poly1305(key, nonce).encrypt(pt)      -- no AAD
key = HKDF-SHA256(ikm = ECDH(ephPriv, recipientPub) x-coordinate, salt = none, info = UTF-8(canon(info)), L = 32)
```
- PIN to the cell: `info = ["saakshi-pin",1,exam,shift,attempt,cand,seatId]`, `pt` = the B.5 record.
- Custodian share to control's release key: `info = ["saakshi-share",1,exam,shift,custodian,releaseKeyId]`, `pt` = the 97-byte share (§9); `releaseKeyId` follows the `cellKeyId` rule.

**B.5 PIN record.** A PIN is exactly 6 ASCII digits. `record = canon(["pin", hex(salt16), 16384, 8, 1, hex(scrypt(UTF-8(pin), salt, N=16384, r=8, p=1, dkLen=32))])`. It is stored and transmitted only inside a B.4 box to the cell.

**B.6 Symmetric boxes.** `box = nonce(24) ‖ XChaCha20-Poly1305(key, nonce, AAD = UTF-8(canon(aad))).encrypt(pt)`.

| Box | key | aad | pt |
|---|---|---|---|
| paper of form `f` | `K_f` (`kF1` for `F1`, `kF2` for `F2`) | `["saakshi-paper",exam,shift,f]` | the paper JSON |
| code list | `L` | `["saakshi-codes",exam,shift]` | JSON `{centre: code}` |
| custodian share file | `scrypt(pass', salt16, 16384, 8, 1, 32)`; `pass'` = the passphrase without spaces or dashes, upper-cased | `["saakshi-custodian",exam,shift,custodian]` | the 97-byte share |

`ciphertextHash = hex(SHA-256(paper box))`.

**B.7 The seat check (normative).** A key `K` for form `f` is accepted only if `kc_f(K)` (§5) equals the signed manifest's `kc_f` for `f`. This holds on every path. A release that carries a signature must also verify under the authority key, with its `kc_f` equal to the manifest's. The offline-code release (the relay's unwrap of `W_c`, §9) carries no signature.

**B.8 Active time.** Relay and cell reject a new entry, as BAD_SUBMISSION and never FORK, when its `activeMs` is less than the previous entry's and both have the same `keyEpoch`.

**B.9 Conventions (not checked).** The unlock body is `["body","","","",[form,kc_f,via]]`, `via` ∈ {`push`, `code`}. A seat running the DEV test keystore journals `integrity` with meta `["test-mode","journal key not in the OS keychain"]` right after its unlock.
````

- [ ] **Step 11: Run everything and typecheck**

Run: `pnpm --filter @saakshi/core test && pnpm -r typecheck && bun test --timeout 60000 apps/server/test/ingest.test.ts apps/server/test/sim-seat.test.ts`
Expected: all PASS under node and bun, including every existing vector test; typecheck exits 0 (the new `ExamBoot` fields are optional and the preload implements the widened `SeatApi`).

---

### Task 2: Seat test mode — a DEV keystore that is never silent

Every `pack:mac` re-signs the app ad hoc, so macOS asks "Saakshi wants to use Saakshi Safe Storage" at launch and `safeStorage` blocks until a human clicks (sometimes with the login password). Automated checks of the packaged app hang. Test mode wraps the journal session key with a local file key instead, and says so loudly.

**Files:**
- Create: `apps/seat/src/main/keystore.ts`
- Modify: `apps/seat/src/main/camera.ts` (test mode turns the camera off), `apps/seat/src/main/exam.ts` (`testMode` option, `start(meta)`), `apps/seat/src/main/index.ts` (use `pickWrapper`, pass `testMode`)
- Test: `apps/seat/test/keystore.test.ts`; append to `apps/seat/test/camera.test.ts` and `apps/seat/test/exam.test.ts`

**Interfaces:**
- Consumes: `Wrapper`, `writeDurable` (Task 1 export) from `journal-store.ts`; `ExamBoot.testMode` (Task 1).
- Produces:
  - `testMode(argv, env): boolean` — `--test-mode` or `SAAKSHI_TEST_MODE=1`.
  - `fileWrapper(dir): Wrapper`, `pickWrapper({testMode, safeStorage, dir}): Wrapper`, `TEST_MODE_NOTE = 'journal key not in the OS keychain'`.
  - `SessionOpts.testMode?: boolean`; `ExamSession.start(meta: Canon[] = [])` puts `meta` in the unlock body and, in test mode, appends `integrity` with meta `['test-mode', TEST_MODE_NOTE]` right after it.
  - The banner itself is rendered by Task 15 from `ExamBoot.testMode`.

- [ ] **Step 1: Write the failing tests**

`apps/seat/test/keystore.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileWrapper, pickWrapper, testMode, type SafeStorage } from '../src/main/keystore.ts';

const safe = (available: boolean): SafeStorage => ({
  isEncryptionAvailable: () => available,
  encryptString: (s) => Buffer.from('OS' + s), decryptString: (b) => b.toString().slice(2),
});

test('test mode is --test-mode or SAAKSHI_TEST_MODE=1, and nothing else', () => {
  assert.equal(testMode(['electron', '.'], {}), false);
  assert.equal(testMode(['electron', '.', '--test-mode'], {}), true);
  assert.equal(testMode(['electron', '.'], { SAAKSHI_TEST_MODE: '1' }), true);
  assert.equal(testMode(['electron', '.'], { SAAKSHI_TEST_MODE: 'true' }), false);
});

test('without the flag the behaviour is unchanged: safeStorage is used and required, and no key file appears', () => {
  const dir = mkdtempSync(join(tmpdir(), 'saakshi-ks-'));
  try {
    const s = safe(true);
    assert.equal(pickWrapper({ testMode: false, safeStorage: s, dir }), s);
    assert.throws(() => pickWrapper({ testMode: false, safeStorage: safe(false), dir }), /safeStorage/);
    assert.equal(existsSync(join(dir, 'test-mode.key')), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('test mode: a file key, created once, that survives a restart; safeStorage is never touched', () => {
  const dir = mkdtempSync(join(tmpdir(), 'saakshi-ks-'));
  try {
    const untouchable = { ...safe(true), isEncryptionAvailable: (): boolean => { throw new Error('safeStorage must not be touched in test mode'); } };
    const w = pickWrapper({ testMode: true, safeStorage: untouchable, dir });
    const box = w.encryptString('session-key-hex');
    assert.equal(box.toString('latin1').includes('session-key-hex'), false);
    const key = readFileSync(join(dir, 'test-mode.key'));
    assert.equal(key.length, 32);
    assert.equal(fileWrapper(dir).decryptString(box), 'session-key-hex');       // a restart reads the same key
    assert.deepEqual(readFileSync(join(dir, 'test-mode.key')), key);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
```

Append to `apps/seat/test/camera.test.ts`:
```ts
test('test mode also turns the camera off', () => {
  assert.equal(cameraEnabled(['electron', '.', '--test-mode'], {}), false);
  assert.equal(cameraEnabled(['electron', '.'], { SAAKSHI_TEST_MODE: '1' }), false);
});
```

Append to `apps/seat/test/exam.test.ts` (it already has `keys`, `cell`, `wrap`, `D` and imports `rmSync`, `mkdtempSync`, `tmpdir`, `join`):
```ts
test('test mode is never silent: an integrity entry follows the unlock; normal mode journals none; start(meta) fills the unlock body', () => {
  for (const testMode of [true, false]) {
    const dir = mkdtempSync(join(tmpdir(), 'saakshi-exam-'));
    const s = new ExamSession({ dir, ctx: { ...DEV_EXAM, cand: 'C0001' }, keyEpoch: 1, seat: devSeat(keys, 'C0001')!, cellPub: cell.pub, wrap, durationMs: D, items: ['I01'], form: 'F1', pseud: devPseud('C0001'), clock: () => 0, testMode });
    assert.deepEqual(s.start(['F1', 'ab'.repeat(32), 'push']), { ok: true, seq: 1, activeMs: 0 });
    assert.deepEqual(s.journal.recs[0].body.meta, ['F1', 'ab'.repeat(32), 'push']);
    assert.deepEqual(s.journal.headers.map((h) => h.kind), testMode ? ['unlock', 'integrity'] : ['unlock']);
    if (testMode) assert.deepEqual(s.journal.recs[1].body, { item: '', state: '', answer: '', meta: ['test-mode', 'journal key not in the OS keychain'] });
    s.start();                                                                        // idempotent: nothing more
    assert.equal(s.head(), testMode ? 2 : 1);
    s.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test apps/seat/test/keystore.test.ts apps/seat/test/camera.test.ts apps/seat/test/exam.test.ts`
Expected: FAIL — `../src/main/keystore.ts` cannot be found; the camera and exam tests fail on test mode.

- [ ] **Step 3: Write `apps/seat/src/main/keystore.ts`**

```ts
// DEV test keystore. Every pack:mac re-signs the app ad hoc, so macOS asks "Saakshi wants to use Saakshi Safe Storage" at launch
// and safeStorage blocks until a human clicks. In test mode (--test-mode or SAAKSHI_TEST_MODE=1) the journal session key is
// wrapped with a local file key instead. It is never silent: the seat shows a permanent banner, and ExamSession journals an
// integrity entry at unlock so the cell and the audit see a test-mode seat.
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { randomBytes } from '@saakshi/core/bytes';
import { writeDurable, type Wrapper } from './journal-store.ts';

export const TEST_MODE_NOTE = 'journal key not in the OS keychain';
export const testMode = (argv: readonly string[], env: Record<string, string | undefined>): boolean =>
  argv.includes('--test-mode') || env.SAAKSHI_TEST_MODE === '1';

/** A Wrapper backed by a random 32-byte key in <dir>/test-mode.key. DEV only: whoever can read that file can read the journal key. */
export function fileWrapper(dir: string): Wrapper {
  const path = join(dir, 'test-mode.key');
  if (!existsSync(path)) { mkdirSync(dir, { recursive: true }); writeDurable(path, randomBytes(32)); }
  const key = new Uint8Array(readFileSync(path));
  if (key.length !== 32) throw new Error(`${path} must hold exactly 32 bytes`);
  return {
    encryptString: (s) => { const n = randomBytes(24); return Buffer.concat([n, xchacha20poly1305(key, n).encrypt(Buffer.from(s, 'utf8'))]); },
    decryptString: (b) => Buffer.from(xchacha20poly1305(key, b.subarray(0, 24)).decrypt(b.subarray(24))).toString('utf8'),
  };
}

export interface SafeStorage extends Wrapper { isEncryptionAvailable(): boolean }
/** Test mode → the file key. Otherwise safeStorage, which must be available (unchanged Stage 1 behaviour). */
export function pickWrapper(o: { testMode: boolean; safeStorage: SafeStorage; dir: string }): Wrapper {
  if (o.testMode) return fileWrapper(o.dir);
  if (!o.safeStorage.isEncryptionAvailable()) throw new Error('OS key storage (safeStorage) is unavailable, so the journal cannot be encrypted.');
  return o.safeStorage;
}
```

- [ ] **Step 4: `camera.ts`, `exam.ts` and `index.ts`**

`apps/seat/src/main/camera.ts` — replace:
```ts
import { testMode } from './keystore.ts';
/** Test mode for automated checks: --no-camera, SAAKSHI_NO_CAMERA=1 or test mode keep the webcam off (no getUserMedia, no MediaPipe). */
export const cameraEnabled = (argv: readonly string[], env: Record<string, string | undefined>): boolean =>
  !argv.includes('--no-camera') && env.SAAKSHI_NO_CAMERA !== '1' && !testMode(argv, env);
```

`apps/seat/src/main/exam.ts`:
- Add `import type { Canon } from '@saakshi/core/canon';` and `import { TEST_MODE_NOTE } from './keystore.ts';`.
- In `SessionOpts`, add `/** DEV test keystore in use: journal it at unlock (never silent). */ testMode?: boolean;`.
- Replace `start()`:
```ts
  /** Unlock: meta is [form, kc_f, via] (Addendum B.9). Idempotent. In test mode an integrity entry follows at once. */
  start(meta: Canon[] = []): ActResult {
    if (this.started) return { ok: true, seq: 1, activeMs: this.activeMs() };
    this.#runStart = this.#clock();
    this.#append('unlock', { ...EMPTY, meta });
    // ponytail: a crash between these two appends leaves no integrity entry; the banner and the chain's first entries still show it.
    if (this.#o.testMode) this.#append('integrity', { ...EMPTY, meta: ['test-mode', TEST_MODE_NOTE] });
    return { ok: true, seq: 1, activeMs: 0 };
  }
```

`apps/seat/src/main/index.ts` (the Stage 2 file; Task 14 later replaces it and keeps this wiring):
- Add `import { pickWrapper, testMode } from './keystore.ts';` and, next to `const camera = …`, `const test = testMode(process.argv, process.env);`.
- Replace the `safeStorage.isEncryptionAvailable()` check and the `wrap: safeStorage` argument:
```ts
    let wrap: Wrapper;
    try { wrap = pickWrapper({ testMode: test, safeStorage, dir: app.getPath('userData') }); }
    catch (e) { dialog.showErrorBox('Saakshi', (e as Error).message); app.exit(1); return; }
    if (test) console.warn('SAAKSHI TEST MODE — not for real exams (journal key not in the OS keychain)');
```
  (add `import type { Wrapper } from './journal-store.ts';`) and pass `wrap, testMode: test` to `new ExamSession({ … })`.
- In the `exam:load` handler, add `testMode: test` to the returned object.

- [ ] **Step 5: Run the seat suite and typecheck**

Run: `pnpm --filter @saakshi/seat test && pnpm --filter @saakshi/seat typecheck`
Expected: PASS, including every Stage 1–2 seat test.

---

### Task 3: Provisioning — the directory, cell key files and certificates, pseudonyms, signed policies

**Files:**
- Create: `tools/cohort.ts`, `tools/provision.ts`
- Test: `apps/server/test/provision.test.ts`

**Interfaces:**
- Consumes (Task 1): `Directory`, `FILES`, `CellKeyFile`, `CellEntry`, `cellKeyArray`, `cellKeyId`, `msg`, `signPolicy`, `Policy`, `RosterEntry`; `pseudOf`, `devRoster`, `devForm`, `DEV_EXAM`, `signer`.
- Produces:
  - `tools/cohort.ts`: `interface CohortRow` (the frozen schema v1 fields), `readCohort(path): AsyncGenerator<CohortRow>`.
  - `tools/provision.ts`: `interface CohortCand { cand; centre; form: 'F1'|'F2'; pwd: 0|1 }`, `cohortCands(path): Promise<CohortCand[]>`, `extraFor(pwd, durationMs)`, `provision(o: ProvisionOpts): Directory` with `ProvisionOpts { out; keys: KeysFile; cands: CohortCand[]; demoCentre?; cellUrls?; durationMs?; now? }`.
  - The exam directory files `directory.json`, `cells/*.key.json`, `policies/*.json`, `control/pseud.key` (Global Constraints).
  - CLI: `bun tools/provision.ts --out data/exam [--cohort <jsonl>] [--demo-centre CEN042] [--cell-urls u1,u2,u3]`.

- [ ] **Step 1: Write the failing test**

`apps/server/test/provision.test.ts`:
```ts
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hexToBytes } from '@saakshi/core/bytes';
import { devPseud, type KeysFile } from '@saakshi/core/dev';
import { FILES, rosterOf, type CellKeyFile, type Directory } from '@saakshi/core/directory';
import { cellKeyArray, cellKeyId, msg } from '@saakshi/core/enrol';
import { verifier } from '@saakshi/core/node';
import { openPolicy, type SignedPolicy } from '@saakshi/core/policy';
import { provision, type CohortCand } from '../../../tools/provision.ts';

const keys = JSON.parse(readFileSync(new URL('../../../fixtures/keys.json', import.meta.url), 'utf8')) as KeysFile;
const A = verifier(hexToBytes(keys.authority.pub));
let tmp: string, out: string;
beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 'saakshi-prov-')); out = join(tmp, 'exam'); });
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

const cands: CohortCand[] = [
  { cand: 'C00001', centre: 'CEN001', form: 'F1', pwd: 0 }, { cand: 'C00002', centre: 'CEN002', form: 'F2', pwd: 1 },
  { cand: 'C00003', centre: 'CEN003', form: 'F1', pwd: 0 }, { cand: 'C00004', centre: 'CEN004', form: 'F2', pwd: 0 },
  { cand: 'C00005', centre: 'CEN042', form: 'F1', pwd: 0 },                         // G1's own CEN042 row: the real centre replaces it
];
const read = <T>(rel: string) => JSON.parse(readFileSync(join(out, rel), 'utf8')) as T;

test('directory: CEN042 is the real centre on cell-1 with the 8 fixture candidates; cohort centres go round-robin over the cells', () => {
  const d = provision({ out, keys, cands, now: 1 });
  expect(read<Directory>(FILES.directory)).toEqual(d);
  expect(d).toMatchObject({ exam: 'DEMO-2026', shift: 'S1', durationMs: 1_800_000, demoCentre: 'CEN042' });
  expect(rosterOf(d, 'CEN042')).toEqual(['C0001', 'C0002', 'C0003', 'C0004', 'C0005', 'C0006', 'C0007', 'C0008']);
  expect(d.cands.C00005).toBeUndefined();
  expect(Object.fromEntries(Object.entries(d.centres).map(([c, v]) => [c, v.cell]))).toEqual({ CEN042: 'cell-1', CEN001: 'cell-1', CEN002: 'cell-2', CEN003: 'cell-3', CEN004: 'cell-1' });
  expect(d.cells.map((c) => c.url)).toEqual(['http://127.0.0.1:7080', 'http://127.0.0.1:7081', 'http://127.0.0.1:7082']);
  expect(d.cands.C00002.extraMs).toBe(600_000);                                    // PwD: 20 min per hour → D/3
  expect(d.cands.C0002.form).toBe('F2');
});

test('every cell certificate and every policy verifies under the authority; each policy pins its own cell', () => {
  const d = provision({ out, keys, cands, cellUrls: ['http://a:1', 'http://b:2', 'http://c:3'] });
  expect(d.cells.map((c) => c.url)).toEqual(['http://a:1', 'http://b:2', 'http://c:3']);
  for (const c of d.cells) {
    expect(c.keyId).toBe(cellKeyId(hexToBytes(c.pub)));
    expect(A(msg(cellKeyArray({ exam: d.exam, cellId: c.id, keyId: c.keyId, pub: c.pub })), hexToBytes(c.cert))).toBe(true);
    const f = read<CellKeyFile>(FILES.cellKey(c.id));
    expect([f.id, f.keyId, f.pub]).toEqual([c.id, c.keyId, c.pub]);
  }
  for (const centre of Object.keys(d.centres)) {
    const p = openPolicy(read<SignedPolicy>(FILES.policy(centre)), A, d);
    const cell = d.cells.find((c) => c.id === d.centres[centre].cell)!;
    expect(p.cell).toEqual({ id: cell.id, keyId: cell.keyId, pub: cell.pub });
    expect(Object.keys(p.roster).sort()).toEqual(rosterOf(d, centre));
    for (const [cand, e] of Object.entries(p.roster)) expect(e).toEqual({ form: d.cands[cand].form, extraMs: d.cands[cand].extraMs, pseud: d.cands[cand].pseud });
  }
});

test('pseudonyms come from a fresh control key, not the published DEV key', () => {
  const d = provision({ out, keys, cands });
  expect(readFileSync(join(out, FILES.pseudKey), 'utf8')).toMatch(/^[0-9a-f]{64}$/);
  expect(d.cands.C0001.pseud).toMatch(/^[0-9a-f]{64}$/);
  expect(d.cands.C0001.pseud).not.toBe(devPseud('C0001'));
});

test('refuses to provision over an existing exam directory', () => {
  provision({ out, keys, cands });
  expect(() => provision({ out, keys, cands })).toThrow(/already provisioned/);
  expect(existsSync(join(out, FILES.directory))).toBe(true);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test --timeout 60000 apps/server/test/provision.test.ts`
Expected: FAIL — `../../../tools/provision.ts` cannot be found.

- [ ] **Step 3: Write `tools/cohort.ts` and `tools/provision.ts`**

`tools/cohort.ts`:
```ts
// Streaming reader for cohort JSONL (fixtures/schemas/v1.json rows): memory stays flat even for G1's 2M-row file.
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

export interface CohortRow {
  cand: string; centre: string; shift: string; form: 'F1' | 'F2'; lang: string; pwd: 0 | 1; item: string;
  state: 'NV' | 'NA' | 'A' | 'MR' | 'AMR'; answer: string; dwellMs: number; visits: number; changes: number; tFirstMs: number;
}

export async function* readCohort(path: string): AsyncGenerator<CohortRow> {
  for await (const line of createInterface({ input: createReadStream(path), crlfDelay: Infinity })) if (line.trim()) yield JSON.parse(line) as CohortRow;
}
```

`tools/provision.ts`:
```ts
// Control's provisioning for one exam-shift (DEV): the directory, each cell's key file (outside any DB) with an authority
// certificate and cellKeyId, a fresh pseudonym key, and one signed policy per centre that pins that centre's cell key.
//   bun tools/provision.ts --out data/exam [--cohort data/g1/cohort.jsonl] [--demo-centre CEN042] [--cell-urls u1,u2,u3]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { hexToBytes, randomBytes, toHex } from '../packages/core/src/bytes.ts';
import { DEV_EXAM, devForm, devRoster, type KeysFile } from '../packages/core/src/dev.ts';
import { FILES, type CellEntry, type CellKeyFile, type Directory } from '../packages/core/src/directory.ts';
import { cellKeyArray, cellKeyId, msg } from '../packages/core/src/enrol.ts';
import { pseudOf } from '../packages/core/src/log.ts';
import { signer } from '../packages/core/src/node.ts';
import { signPolicy, type Policy, type RosterEntry } from '../packages/core/src/policy.ts';
import { readCohort } from './cohort.ts';

export interface CohortCand { cand: string; centre: string; form: 'F1' | 'F2'; pwd: 0 | 1 }
export interface ProvisionOpts { out: string; keys: KeysFile; cands: CohortCand[]; demoCentre?: string; cellUrls?: string[]; durationMs?: number; now?: number }

/** Compensatory time: PwD candidates get 20 minutes per hour, so D_i = D + D/3. */
export const extraFor = (pwd: 0 | 1, durationMs: number): number => (pwd ? Math.round(durationMs / 3) : 0);

/** One row per candidate (their first row in the cohort). */
export async function cohortCands(path: string): Promise<CohortCand[]> {
  const seen = new Map<string, CohortCand>();
  for await (const r of readCohort(path)) if (!seen.has(r.cand)) seen.set(r.cand, { cand: r.cand, centre: r.centre, form: r.form, pwd: r.pwd });
  return [...seen.values()];
}

export function provision(o: ProvisionOpts): Directory {
  const out = resolve(o.out);
  if (existsSync(join(out, FILES.directory))) throw new Error(`${out} is already provisioned; delete that directory first so old keys and packages are never mixed`);
  const demo = o.demoCentre ?? 'CEN042', durationMs = o.durationMs ?? 30 * 60_000, now = o.now ?? Date.now();
  const signA = signer({ priv: hexToBytes(o.keys.authority.priv), pub: hexToBytes(o.keys.authority.pub) });
  const pseudKey = randomBytes(32);
  const write = (rel: string, data: string) => { const p = join(out, rel); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, data); };

  // DEV reuses the fixture cell keys (so trust-dev.json and /verify still pin them); control certifies each with a keyId.
  const cells: CellEntry[] = o.keys.cells.map((c, i) => {
    const keyId = cellKeyId(hexToBytes(c.pub));
    write(FILES.cellKey(c.id), JSON.stringify({ id: c.id, keyId, priv: c.priv, pub: c.pub } satisfies CellKeyFile, null, 2));
    const cert = toHex(signA(msg(cellKeyArray({ exam: DEV_EXAM.exam, cellId: c.id, keyId, pub: c.pub }))));
    return { id: c.id, url: o.cellUrls?.[i] ?? `http://127.0.0.1:${7080 + i}`, keyId, pub: c.pub, cert };
  });

  const cands: Directory['cands'] = {};
  for (const cand of devRoster(o.keys)) cands[cand] = { centre: demo, form: devForm(cand), extraMs: 0, pseud: pseudOf(pseudKey, cand) };
  let skipped = 0;
  for (const c of o.cands) {
    if (c.centre === demo) { skipped++; continue; }                   // the demo centre is real; G1's rows there are not replayed
    cands[c.cand] ??= { centre: c.centre, form: c.form, extraMs: extraFor(c.pwd, durationMs), pseud: pseudOf(pseudKey, c.cand) };
  }
  const byCentre = new Map<string, [string, RosterEntry][]>();
  for (const [cand, c] of Object.entries(cands)) {
    let a = byCentre.get(c.centre);
    if (!a) byCentre.set(c.centre, (a = []));
    a.push([cand, { form: c.form, extraMs: c.extraMs, pseud: c.pseud }]);
  }
  const centres: Directory['centres'] = { [demo]: { cell: cells[0].id } };
  [...byCentre.keys()].filter((c) => c !== demo).sort().forEach((c, i) => { centres[c] = { cell: cells[i % cells.length].id }; });

  const dir: Directory = { v: 1, exam: DEV_EXAM.exam, shift: DEV_EXAM.shift, durationMs, demoCentre: demo, issuedAt: now, cells, centres, cands };
  for (const [centre, { cell: cellId }] of Object.entries(centres)) {
    const cell = cells.find((c) => c.id === cellId)!;
    const policy: Policy = { v: 1, exam: dir.exam, shift: dir.shift, centre, cell: { id: cell.id, keyId: cell.keyId, pub: cell.pub }, durationMs, roster: Object.fromEntries(byCentre.get(centre) ?? []), issuedAt: now };
    write(FILES.policy(centre), JSON.stringify(signPolicy(policy, signA)));
  }
  write(FILES.pseudKey, toHex(pseudKey));
  write(FILES.directory, JSON.stringify(dir));
  pseudKey.fill(0);
  if (skipped) console.log(`provision: ${skipped} cohort candidates at ${demo} not replayed (${demo} is the real centre)`);
  return dir;
}

if (import.meta.main) {
  const arg = (f: string) => { const i = process.argv.indexOf(f); return i > 0 ? process.argv[i + 1] : undefined; };
  const keys = JSON.parse(readFileSync(resolve(import.meta.dirname, '../fixtures/keys.json'), 'utf8')) as KeysFile;
  const cohort = arg('--cohort'), out = arg('--out') ?? 'data/exam';
  const d = provision({ out, keys, cands: cohort ? await cohortCands(cohort) : [], demoCentre: arg('--demo-centre'), cellUrls: arg('--cell-urls')?.split(',') });
  console.log(`provisioned ${Object.keys(d.cands).length} candidates at ${Object.keys(d.centres).length} centres on ${d.cells.length} cells → ${out}`);
}
```

- [ ] **Step 4: Run the test**

Run: `bun test --timeout 60000 apps/server/test/provision.test.ts && pnpm --filter @saakshi/server typecheck`
Expected: PASS (4 tests); typecheck exits 0.

---

### Task 4: The packager — keys, codes, wraps, paper ciphertext, signed manifest, custodian shares, then zeroise

**Files:**
- Create: `tools/package.ts`
- Test: `apps/server/test/package.test.ts`

**Interfaces:**
- Consumes (Task 1): `sealPaper`, `ciphertextHash`, `manifestArray`, `sealCodes`, `sealShareFile`, `msg`, `CUSTODIANS`, `FILES`, `Directory`; `newOfflineCode`, `wrapForCentre`, `splitBundle` (custody.ts); `kcf`; `signer`.
- Produces:
  - `interface PaperIn { bank: { items: { id: string }[] }; forms: Record<string, unknown> }` (bank.json and forms.json as they are).
  - `interface Package { manifest: SignedManifest; papers: Record<string, Uint8Array>; wraps: Record<string, string>; codes: Uint8Array; shares: Record<string, ShareFile>; passphrases: Record<string, string>; secrets: Uint8Array[] }`.
  - `buildPackage(dir: Directory, paper: PaperIn, authority: KeyPair, now?): Promise<Package>`, `writePackage(root, p)`, `zeroise(p)`.
  - CLI: `bun tools/package.ts --exam data/exam` writes `package/*` and `custodians/*`, prints the commitment and the three passphrases **once**, then zeroises.
  - Node-compatible (no `Bun.*`): the seat's `node --test` suite imports `buildPackage`.

- [ ] **Step 1: Write the failing test**

`apps/server/test/package.test.ts`:
```ts
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hexToBytes } from '@saakshi/core/bytes';
import { combineBundle, unwrapForCentre } from '@saakshi/core/custody';
import type { KeysFile } from '@saakshi/core/dev';
import { CUSTODIANS, FILES, type Directory } from '@saakshi/core/directory';
import { verifier } from '@saakshi/core/node';
import { checkManifest, ciphertextHash, openCodes, openPaper, openShareFile, type Manifest } from '@saakshi/core/paper';
import { kcf } from '@saakshi/core/protocol';
import { buildPackage, writePackage, zeroise, type Package } from '../../../tools/package.ts';

const keys = JSON.parse(readFileSync(new URL('../../../fixtures/keys.json', import.meta.url), 'utf8')) as KeysFile;
const fx = (f: string) => JSON.parse(readFileSync(new URL(`../../../fixtures/paper/${f}`, import.meta.url), 'utf8'));
const paper = () => ({ bank: fx('bank.json'), forms: fx('forms.json') });
const authority = { priv: hexToBytes(keys.authority.priv), pub: hexToBytes(keys.authority.pub) };
const dir = { v: 1, exam: 'DEMO-2026', shift: 'S1', durationMs: 1_800_000, demoCentre: 'CEN042', issuedAt: 0, cells: [], cands: {},
  centres: { CEN042: { cell: 'cell-1' }, CEN001: { cell: 'cell-2' }, CEN002: { cell: 'cell-3' } } } as unknown as Directory;
let p: Package, m: Manifest, root: string;
beforeAll(async () => {
  p = await buildPackage(dir, paper(), authority, 1_790_000_000_000);
  m = checkManifest(p.manifest, verifier(authority.pub));
  root = mkdtempSync(join(tmpdir(), 'saakshi-pkg-'));
  writePackage(root, p);
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

test('ciphertext only: no question text in either form on disk; the files are exactly what the manifest commits to', () => {
  const bank = fx('bank.json') as { items: { en: { q: string }; hi: { q: string } }[] };
  for (const f of ['F1', 'F2']) {
    const ct = readFileSync(join(root, FILES.paper(f)));
    for (const it of bank.items) { expect(ct.includes(Buffer.from(it.en.q))).toBe(false); expect(ct.includes(Buffer.from(it.hi.q))).toBe(false); }
    expect(ciphertextHash(new Uint8Array(ct))).toBe(m.forms.find((x) => x.form === f)!.ciphertextHash);
  }
  expect(JSON.parse(readFileSync(join(root, FILES.manifest), 'utf8'))).toEqual(p.manifest);
  expect(m.ts).toBe(1_790_000_000_000);
  expect(readdirSync(root).sort()).toEqual(['custodians', 'package']);           // no passphrase or plaintext file anywhere
});

test('any two custodians rebuild keys that match kc_f and open the paper in form order; one share or a wrong passphrase cannot', async () => {
  const raw = Object.fromEntries(CUSTODIANS.map((c) => [c, openShareFile(JSON.parse(readFileSync(join(root, FILES.share(c)), 'utf8')), p.passphrases[c])]));
  for (const [a, b] of [['NTA', 'NIC'], ['NTA', 'OBS'], ['NIC', 'OBS']]) {
    const k = await combineBundle([raw[a], raw[b]]);
    expect([kcf(k.kF1), kcf(k.kF2)]).toEqual(m.forms.map((f) => f.kcf));
    const doc = JSON.parse(new TextDecoder().decode(openPaper(k.kF2, { exam: 'DEMO-2026', shift: 'S1', form: 'F2' }, p.papers.F2)));
    expect(doc.items.map((i: { id: string }) => i.id)).toEqual(fx('forms.json').F2);
  }
  await expect(combineBundle([raw.NTA])).rejects.toThrow(/2 of 3/);
  expect(() => openShareFile(p.shares.NTA, p.passphrases.NIC)).toThrow(/wrong passphrase/);
});

test('the code list opens with L; each centre\'s code unwraps only its own wrap, not another centre\'s, not another shift\'s', async () => {
  const k = await combineBundle([openShareFile(p.shares.NTA, p.passphrases.NTA), openShareFile(p.shares.OBS, p.passphrases.OBS)]);
  const codes = openCodes(k.L, 'DEMO-2026', 'S1', new Uint8Array(readFileSync(join(root, FILES.codes))));
  expect(Object.keys(codes).sort()).toEqual(['CEN001', 'CEN002', 'CEN042']);
  const wraps = JSON.parse(readFileSync(join(root, FILES.wraps), 'utf8')) as Record<string, string>;
  const c42 = { exam: 'DEMO-2026', shift: 'S1', centre: 'CEN042' };
  expect(kcf(unwrapForCentre(codes.CEN042, c42, hexToBytes(wraps.CEN042)).kF1)).toBe(m.forms[0].kcf);
  expect(() => unwrapForCentre(codes.CEN001, c42, hexToBytes(wraps.CEN042))).toThrow();
  const s2 = await buildPackage({ ...dir, shift: 'S2' }, paper(), authority);
  const s2k = await combineBundle([openShareFile(s2.shares.NTA, s2.passphrases.NTA), openShareFile(s2.shares.NIC, s2.passphrases.NIC)]);
  expect(() => unwrapForCentre(openCodes(s2k.L, 'DEMO-2026', 'S2', s2.codes).CEN042, c42, hexToBytes(wraps.CEN042))).toThrow();
});

test('zeroise wipes every secret the packager generated and forgets the passphrases', async () => {
  const q = await buildPackage(dir, paper(), authority);
  expect(q.secrets.length).toBe(6);                                                // K_F1, K_F2, L and the three raw shares
  zeroise(q);
  for (const s of q.secrets) expect(s.every((b) => b === 0)).toBe(true);
  expect(q.passphrases).toEqual({});
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test --timeout 60000 apps/server/test/package.test.ts`
Expected: FAIL — `../../../tools/package.ts` cannot be found.

- [ ] **Step 3: Write `tools/package.ts`**

```ts
// The packager (plan §3.3), run offline at T−3 days for one exam-shift. It makes K_F1, K_F2 and L, a per-centre offline code,
// the wraps W_c, the code list under L, the paper ciphertext per form, and the signed manifest {ciphertextHash, kc_f} — the
// public commitment. It splits {K_F1, K_F2, L} Shamir 2-of-3 into passphrase-sealed share files for NTA, NIC and the observer,
// prints the passphrases once, and then zeroises everything it generated.
//   bun tools/package.ts --exam data/exam
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { hexToBytes, randomBytes, toHex, utf8 } from '../packages/core/src/bytes.ts';
import { newOfflineCode, splitBundle, wrapForCentre } from '../packages/core/src/custody.ts';
import type { KeysFile } from '../packages/core/src/dev.ts';
import { CUSTODIANS, FILES, type Directory } from '../packages/core/src/directory.ts';
import { msg } from '../packages/core/src/enrol.ts';
import { signer, type KeyPair } from '../packages/core/src/node.ts';
import { ciphertextHash, manifestArray, sealCodes, sealPaper, sealShareFile, type Manifest, type ManifestForm, type ShareFile, type SignedManifest } from '../packages/core/src/paper.ts';
import { kcf } from '../packages/core/src/protocol.ts';

export interface PaperIn { bank: { items: { id: string }[] }; forms: Record<string, unknown> }
export interface Package {
  manifest: SignedManifest; papers: Record<string, Uint8Array>; wraps: Record<string, string>; codes: Uint8Array;
  shares: Record<string, ShareFile>; passphrases: Record<string, string>;
  /** Every secret byte array this packager generated; zeroise() wipes them. */
  secrets: Uint8Array[];
}

export async function buildPackage(dir: Directory, paper: PaperIn, authority: KeyPair, now = Date.now()): Promise<Package> {
  const X = { exam: dir.exam, shift: dir.shift };
  const kF1 = randomBytes(32), kF2 = randomBytes(32), L = randomBytes(32);
  const K: Record<'F1' | 'F2', Uint8Array> = { F1: kF1, F2: kF2 };
  const bank = new Map(paper.bank.items.map((i) => [i.id, i]));
  const papers: Record<string, Uint8Array> = {}, forms: ManifestForm[] = [];
  for (const form of ['F1', 'F2'] as const) {
    const order = paper.forms[form];
    if (!Array.isArray(order)) throw new Error(`forms.json has no ${form}`);
    const items = order.map((id: string) => { const it = bank.get(id); if (!it) throw new Error(`${form} names ${id}, which is not in the bank`); return it; });
    papers[form] = sealPaper(K[form], { ...X, form }, utf8(JSON.stringify({ exam: dir.exam, form, items })));
    forms.push({ form, ciphertextHash: ciphertextHash(papers[form]), kcf: kcf(K[form]) });
  }
  const codeList: Record<string, string> = {}, wraps: Record<string, string> = {};
  for (const centre of Object.keys(dir.centres).sort()) {
    codeList[centre] = newOfflineCode();                                          // 80 bits; only this centre, only this shift
    wraps[centre] = toHex(wrapForCentre(codeList[centre], { ...X, centre }, kF1, kF2));
  }
  const raw = await splitBundle({ kF1, kF2, L });
  const shares: Record<string, ShareFile> = {}, passphrases: Record<string, string> = {};
  CUSTODIANS.forEach((c, i) => { passphrases[c] = newOfflineCode(); shares[c] = sealShareFile(raw[i], passphrases[c], { ...X, custodian: c }); });
  const manifest: Manifest = { ...X, forms, ts: now };
  return {
    manifest: { manifest, sig: toHex(signer(authority)(msg(manifestArray(manifest)))) },
    papers, wraps, codes: sealCodes(L, X.exam, X.shift, codeList), shares, passphrases, secrets: [kF1, kF2, L, ...raw],
  };
}

export function writePackage(root: string, p: Package): void {
  const write = (rel: string, data: string | Uint8Array) => { const f = join(root, rel); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, data); };
  write(FILES.manifest, JSON.stringify(p.manifest, null, 2));
  for (const [form, ct] of Object.entries(p.papers)) write(FILES.paper(form), ct);
  write(FILES.wraps, JSON.stringify(p.wraps));
  write(FILES.codes, p.codes);
  for (const [c, f] of Object.entries(p.shares)) write(FILES.share(c), JSON.stringify(f, null, 2));
}

/** Best effort in a garbage-collected runtime: the key bytes are overwritten; the code strings go with the package object. */
export function zeroise(p: Package): void {
  for (const s of p.secrets) s.fill(0);
  for (const k of Object.keys(p.passphrases)) delete p.passphrases[k];
}

if (import.meta.main) {
  const arg = (f: string) => { const i = process.argv.indexOf(f); return i > 0 ? process.argv[i + 1] : undefined; };
  const root = resolve(arg('--exam') ?? 'data/exam');
  if (existsSync(join(root, FILES.manifest))) throw new Error(`${root} is already packaged`);
  const fx = resolve(import.meta.dirname, '../fixtures');
  const read = (f: string) => JSON.parse(readFileSync(f, 'utf8'));
  const keys = read(join(fx, 'keys.json')) as KeysFile;
  const p = await buildPackage(read(join(root, FILES.directory)) as Directory, { bank: read(join(fx, 'paper/bank.json')), forms: read(join(fx, 'paper/forms.json')) },
    { priv: hexToBytes(keys.authority.priv), pub: hexToBytes(keys.authority.pub) });
  writePackage(root, p);
  console.log('Manifest (the public commitment):');
  for (const f of p.manifest.manifest.forms) console.log(`  ${f.form}  kc_f ${f.kcf}  ciphertext ${f.ciphertextHash}`);
  console.log('Custodian passphrases — shown ONCE. Hand each one to its custodian with their share file:');
  for (const c of CUSTODIANS) console.log(`  ${c}: ${p.passphrases[c]}   (${FILES.share(c)})`);
  zeroise(p);
  console.log('packager: K_F1, K_F2, L, the offline codes and the shares are zeroised in this process (best effort in a garbage-collected runtime).');
}
```

- [ ] **Step 4: Run the test**

Run: `bun test --timeout 60000 apps/server/test/package.test.ts && pnpm --filter @saakshi/server typecheck`
Expected: PASS (4 tests; scrypt makes it take a few seconds); typecheck exits 0.

---

### Task 5: Server stores and sync — bindings, releases, the check-order additions, the forwarder

**Files:**
- Create: `apps/server/src/bindings.ts`, `apps/server/src/release-store.ts`
- Modify: `apps/server/src/ingest.ts` (`acceptBinds`, `releases`, the B.8 activeMs check), `apps/server/src/forward.ts` (`ForwardOpts`: `releases`, `bindFor`)
- Test: `apps/server/test/bindings.test.ts`, `apps/server/test/release-store.test.ts`; append to `apps/server/test/ingest.test.ts` and `apps/server/test/forward.test.ts`

**Interfaces:**
- Consumes (Task 1): `bindArray`, `checkWireBind`, `openPinBox`, `Bind`, `BindReq`, `WireBind`, `checkRelease`, `Manifest`, `ReleaseMsg`, `nativeBox`, `signer`, `verifier`; `simBindReq`, `simPinRecord`, `simCustody` (tools/sim-custody.ts); `SimSeat(keys, cand, cellPub, 1, seat)`.
- Produces:
  - `class Bindings(db, { exam, shift, cell: { id, pub, priv? } })` with `seatKey(cand, keyEpoch)`, `get(cand, keyEpoch): WireBind | undefined`, `all(): WireBind[]`, `cands(): string[]` (bound at keyEpoch 1), `accept(wb): string | undefined`, `acceptAll(wbs): (string | undefined)[]` (one transaction), `enrol(req, registered): EnrolResult` (cell only), `tx<T>(fn: () => T): T`.
  - `type EnrolCode`, `type EnrolResult` (Global Constraints).
  - `class ReleaseStore(db, { exam, shift, manifest, authority: Verify, requireSig?, onNew? })` with `accept(r): string | undefined`, `list(): ReleaseMsg[]`, `count(): number` (**signed** releases only — what `SyncReq.have` reports).
  - `IngestOpts.acceptBinds?`, `IngestOpts.releases?`; `ForwardOpts { batch?; heartbeatMs?; releases?: { count(): number; accept(r: ReleaseMsg): unknown }; bindFor?: (c: Ctx) => WireBind | undefined }`.

- [ ] **Step 1: Write the failing tests**

`apps/server/test/bindings.test.ts`:
```ts
import { afterEach, beforeEach, expect, test } from 'bun:test';
import type { Database } from 'bun:sqlite';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { toHex } from '@saakshi/core/bytes';
import { cellKey, type KeysFile } from '@saakshi/core/dev';
import { checkWireBind } from '@saakshi/core/enrol';
import { newKeyPair } from '@saakshi/core/node';
import { Bindings } from '../src/bindings.ts';
import { openDb } from '../src/store.ts';
import { simBindReq, simPinRecord } from '../../../tools/sim-custody.ts';

const keys = JSON.parse(readFileSync(new URL('../../../fixtures/keys.json', import.meta.url), 'utf8')) as KeysFile;
const cell = cellKey(keys, 'cell-1'), cell2 = cellKey(keys, 'cell-2');
const X = { exam: 'DEMO-2026', shift: 'S1' };
let dir: string;
const dbs: Database[] = [];
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'saakshi-bind-')); });
afterEach(() => { for (const d of dbs.splice(0)) d.close(); rmSync(dir, { recursive: true, force: true }); });
const open = (name: string, c: { id: string; pub: Uint8Array; priv?: Uint8Array } = cell) => {
  const { db } = openDb(join(dir, `${name}.db`));
  dbs.push(db);
  return new Bindings(db, { ...X, cell: c });
};

test('enrol: a registered seat gets a cell-signed certificate; the same request again returns the same certificate; a second key is ALREADY_BOUND', () => {
  const b = open('cell');
  const seat = newKeyPair(), req = simBindReq('C0001', seat, cell.pub, 'CEN042-S01');
  const r1 = b.enrol(req, true);
  if (!r1.ok) throw new Error(r1.error);
  expect(checkWireBind(r1.bind, cell.pub)).toMatchObject({ cand: 'C0001', seatId: 'CEN042-S01', pub: toHex(seat.pub), keyEpoch: 1, fromSeq: 0 });
  expect(b.enrol(req, true)).toEqual(r1);                                          // a lost response, retried
  expect(b.seatKey('C0001', 1)).toEqual(seat.pub);
  expect(b.enrol(simBindReq('C0001', newKeyPair(), cell.pub), true)).toMatchObject({ ok: false, code: 'ALREADY_BOUND' });
  expect(b.seatKey('C0001', 1)).toEqual(seat.pub);                                 // never silently rebound
  expect(b.cands()).toEqual(['C0001']);
});

test('enrol refuses a stranger, a handover (Stage 4), a PIN box sealed to another cell, and a key that is not a P-256 point', () => {
  const b = open('cell'), seat = newKeyPair();
  expect(b.enrol(simBindReq('C0001', seat, cell.pub), false)).toMatchObject({ ok: false, code: 'NOT_REGISTERED' });
  expect(b.enrol({ ...simBindReq('C0001', seat, cell.pub), keyEpoch: 2, fromSeq: 9 }, true)).toMatchObject({ ok: false, code: 'UNSUPPORTED' });
  expect(b.enrol(simBindReq('C0001', seat, cell2.pub), true)).toMatchObject({ ok: false, code: 'BAD', error: expect.stringContaining('PIN box') });
  expect(b.enrol({ ...simBindReq('C0001', seat, cell.pub), pub: '04' + '00'.repeat(64) }, true)).toMatchObject({ ok: false, code: 'BAD' });
  expect(b.all()).toEqual([]);
});

test('relay side: accept verifies the cell signature; a forged or foreign certificate is refused; bindings survive a restart', () => {
  const c = open('cell'), relay = open('relay', { id: 'cell-1', pub: cell.pub });
  const r = c.enrol(simBindReq('C0002', newKeyPair(), cell.pub), true);
  if (!r.ok) throw new Error(r.error);
  expect(relay.accept(r.bind)).toBeUndefined();
  expect(relay.accept(r.bind)).toBeUndefined();                                    // idempotent
  expect(relay.accept({ ...r.bind, sig: (r.bind.sig[0] === '0' ? '1' : '0') + r.bind.sig.slice(1) })).toMatch(/does not verify/);
  expect(relay.accept({ ...r.bind, cell: 'cell-2' })).toMatch(/cell-2/);
  const foreign = open('cell2', cell2).enrol(simBindReq('C0003', newKeyPair(), cell2.pub), true);
  if (!foreign.ok) throw new Error(foreign.error);
  expect(relay.accept(foreign.bind)).toBeDefined();
  expect(open('relay', { id: 'cell-1', pub: cell.pub }).get('C0002', 1)).toEqual(r.bind);   // reopened from disk
});

test('the PIN is never readable at rest: the cell DB holds only the sealed box', () => {
  const c = open('cell');
  c.enrol(simBindReq('C0004', newKeyPair(), cell.pub), true);
  const rec = simPinRecord(), hash = rec.slice(-66, -2);
  const wal = join(dir, 'cell.db-wal');
  const bytes = Buffer.concat([readFileSync(join(dir, 'cell.db')), existsSync(wal) ? readFileSync(wal) : Buffer.alloc(0)]);
  expect(bytes.includes(Buffer.from(hash))).toBe(false);
  expect(bytes.includes(Buffer.from(rec))).toBe(false);
});
```

`apps/server/test/release-store.test.ts`:
```ts
import { afterEach, beforeEach, expect, test } from 'bun:test';
import type { Database } from 'bun:sqlite';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hexToBytes, randomBytes, toHex } from '@saakshi/core/bytes';
import type { KeysFile } from '@saakshi/core/dev';
import { verifier } from '@saakshi/core/node';
import type { ReleaseMsg } from '@saakshi/core/paper';
import { ReleaseStore, type ReleaseStoreOpts } from '../src/release-store.ts';
import { openDb } from '../src/store.ts';
import { simCustody } from '../../../tools/sim-custody.ts';

const keys = JSON.parse(readFileSync(new URL('../../../fixtures/keys.json', import.meta.url), 'utf8')) as KeysFile;
const cust = simCustody(keys), A = verifier(hexToBytes(keys.authority.pub));
let dir: string;
const dbs: Database[] = [];
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'saakshi-rel-')); });
afterEach(() => { for (const d of dbs.splice(0)) d.close(); rmSync(dir, { recursive: true, force: true }); });
const open = (name: string, o: Partial<ReleaseStoreOpts> = {}) => {
  const { db } = openDb(join(dir, `${name}.db`));
  dbs.push(db);
  return new ReleaseStore(db, { exam: 'DEMO-2026', shift: 'S1', manifest: cust.manifest.manifest, authority: A, ...o });
};
const code = (f: 'F1' | 'F2'): ReleaseMsg => ({ ...cust.release(f), sig: '', via: 'code' });

test('keeps control\'s signed release; the same again is a no-op; a key off kc_f or a forged signature is refused', () => {
  const seen: ReleaseMsg[] = [];
  const s = open('r', { onNew: (r) => seen.push(r) });
  const r = cust.release('F1');
  expect(s.accept(r)).toBeUndefined();
  expect(s.accept(r)).toBeUndefined();
  expect(seen).toEqual([r]);
  expect(s.accept({ ...cust.release('F2'), key: toHex(randomBytes(32)) })).toMatch(/kc_f/);
  expect(s.accept({ ...cust.release('F2'), ts: 5 })).toMatch(/signature/);
  expect([s.list(), s.count()]).toEqual([[r], 1]);
});

test('a cell takes only control\'s signed release; a relay keeps the phoned-code release, and control\'s signed one replaces it', () => {
  expect(open('cell', { requireSig: true }).accept(code('F1'))).toMatch(/signed by control/);
  const seen: string[] = [];
  const relay = open('relay', { onNew: (r) => seen.push(r.via) });
  expect(relay.accept(code('F1'))).toBeUndefined();
  expect(relay.count()).toBe(0);                                                   // `have` counts signed releases only
  expect(relay.accept(cust.release('F1'))).toBeUndefined();
  expect(relay.accept(code('F1'))).toBeUndefined();                               // the signed one stays
  expect([seen, relay.count(), relay.list()[0].via]).toEqual([['code', 'push'], 1, 'push']);
});

test('releases survive a restart', () => {
  const r2 = cust.release('F2');                                                  // signatures are random: keep the one we stored
  open('r').accept(r2);
  expect(open('r').list()).toEqual([r2]);
});
```

Append to `apps/server/test/ingest.test.ts` (add `randomBytes` to its `@saakshi/core/bytes` import, and these imports):
```ts
import { newKeyPair } from '@saakshi/core/node';
import { Bindings } from '../src/bindings.ts';
import { simBindReq, simCustody } from '../../../tools/sim-custody.ts';

test('Stage 3: a seat key is trusted only through a cell-signed bind carried with the entries; a bad bind is evidence, not a crash', async () => {
  const { db } = openDb(join(dir, 'relay3.db'));
  const relayB = new Bindings(db, { exam: 'DEMO-2026', shift: 'S1', cell: { id: 'cell-1', pub: cell.pub } });
  const n = createIngest({ mode: 'relay', db, fresh: false, seatKey: relayB.seatKey, acceptBinds: (b) => relayB.acceptAll(b), cell: { pub: cell.pub } });
  opened.push(n);
  const seat = newKeyPair(), s = new SimSeat(keys, 'C0001', cell.pub, 1, seat);
  s.add(3);
  const r0 = (await n.sync({ entries: s.entries, streams: [{ ...s.ctx, head: s.head }] })) as SyncRes;
  expect(r0.rejected.map((x) => x.reason)).toEqual(Array(3).fill('no seat key for C0001 at keyEpoch 1'));
  const cellDb = openDb(join(dir, 'cell3.db')).db;
  const e = new Bindings(cellDb, { exam: 'DEMO-2026', shift: 'S1', cell: { id: 'cell-1', ...cell } }).enrol(simBindReq('C0001', seat, cell.pub), true);
  cellDb.close();
  if (!e.ok) throw new Error(e.error);
  const r1 = (await n.sync({ entries: s.entries, streams: [{ ...s.ctx, head: s.head }], binds: [{ ...e.bind, sig: '0'.repeat(128) }, e.bind] })) as SyncRes;
  expect(r1.rejected).toEqual([]);
  expect(r1.streams[0].head).toBe(3);
  expect(db.query("SELECT count(*) AS n FROM evidence WHERE reason LIKE 'bind:%'").get()).toEqual({ n: 1 });
});

test('Stage 3 (B.8): activeMs that runs backwards within a key epoch is BAD_SUBMISSION, never FORK', async () => {
  const n = node('cell');
  const s = new SimSeat(keys, 'C0001', cell.pub);
  s.add(2);                                                                        // activeMs 1000, 2000
  const body = { item: 'I02', state: 'A' as const, answer: 'B', meta: [1, []] };
  const { envelope, bodyCommit } = sealBody(cell.pub, { ...s.ctx, seq: 3 }, randomBytes(16), body);
  const h: Header = { ...s.ctx, keyEpoch: 1, seq: 3, prev: s.hs[1], kind: 'answer', tMonoMs: 3000, activeMs: 1500, bodyCommit };
  const r = (await n.sync({ entries: [...s.entries, { line: signedLine(h, signer(devSeat(keys, 'C0001')!)), env: toB64(envelope) }], streams: [] })) as SyncRes;
  expect(r.rejected).toEqual([{ index: 2, code: 'BAD_SUBMISSION', reason: 'activeMs went backwards (2000 → 1500) within keyEpoch 1' }]);
});

test('Stage 3: the cell hands its releases to a relay that has fewer, and not otherwise', async () => {
  const cust = simCustody(keys), rel = [cust.release('F1'), cust.release('F2')];
  const n = node('cell', { releases: () => rel });
  const ask = async (have?: number) => ((await n.sync({ entries: [], streams: [], ...(have === undefined ? {} : { have }) })) as SyncRes).releases;
  expect(await ask()).toEqual(rel);
  expect(await ask(1)).toEqual(rel);
  expect(await ask(2)).toBeUndefined();
});
```

Append to `apps/server/test/forward.test.ts` (and add these imports):
```ts
import { newKeyPair } from '@saakshi/core/node';
import type { ReleaseMsg } from '@saakshi/core/paper';
import type { SyncReq } from '@saakshi/core/wire';
import { Bindings } from '../src/bindings.ts';
import { simBindReq, simCustody } from '../../../tools/sim-custody.ts';

function bound(name: string, mode: Mode, fresh = false) {
  const { db } = openDb(join(dir, `${name}.db`));
  const b = new Bindings(db, { exam: 'DEMO-2026', shift: 'S1', cell: mode === 'cell' ? { id: 'cell-1', ...cell } : { id: 'cell-1', pub: cell.pub } });
  const n = createIngest({ mode, db, fresh, seatKey: b.seatKey, acceptBinds: (x) => b.acceptAll(x), cell: mode === 'cell' ? cell : { pub: cell.pub } });
  opened.push(n);
  return { n, b };
}

test('Review Focus #5: after the cell loses its DB, the replay carries the binds before the entries and the rebuilt cell accepts every entry', async () => {
  const relay = bound('relay', 'relay'), c1 = bound('cell1', 'cell');
  const seat = newKeyPair();
  const e = c1.b.enrol(simBindReq('C0001', seat, cell.pub), true);
  if (!e.ok) throw new Error(e.error);
  expect(relay.b.accept(e.bind)).toBeUndefined();
  const s = new SimSeat(keys, 'C0001', cell.pub, 1, seat);
  s.add(25);
  await seatPush(relay.n, s);
  await drain(new Forwarder(relay.n, (req) => c1.n.sync(req), { bindFor: (x) => relay.b.get(x.cand, 1) }));
  expect(c1.n.views()[0].head).toBe(25);

  const c2 = bound('cell2', 'cell', true);                                         // the disk died: a fresh DB that knows no binding
  expect([c2.n.state(), c2.b.seatKey('C0001', 1)]).toEqual(['REBUILDING', undefined]);
  const sent: SyncReq[] = [];
  await drain(new Forwarder(relay.n, (req) => { sent.push(req); return c2.n.sync(req); }, { bindFor: (x) => relay.b.get(x.cand, 1) }));
  expect(c2.n.state()).toBe('LIVE');
  expect(sent.find((r) => r.entries.length)!.binds).toEqual([e.bind]);
  expect(c2.n.views()[0].head).toBe(25);
  expect(evidence('cell2')).toEqual([]);
});

test('Stage 3: a relay with no seats still asks for releases on its heartbeat, and keeps what the cell sends', async () => {
  const cust = simCustody(keys);
  const { db } = openDb(join(dir, 'cellr.db'));
  const c = createIngest({ mode: 'cell', db, fresh: false, seatKey: devSeatKey(keys), cell, releases: () => [cust.release('F1'), cust.release('F2')] });
  opened.push(c);
  const relay = mk('relay', 'relay'), got: ReleaseMsg[] = [];
  const f = new Forwarder(relay, (req) => c.sync(req), { heartbeatMs: 0, releases: { count: () => got.length, accept: (r) => got.push(r) } });
  expect(relay.views()).toEqual([]);
  await f.round();
  expect(got.map((r) => r.form)).toEqual(['F1', 'F2']);
  await f.round();
  expect(got.length).toBe(2);                                                      // have = 2: nothing resent
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test --timeout 60000 apps/server/test/bindings.test.ts apps/server/test/release-store.test.ts apps/server/test/ingest.test.ts apps/server/test/forward.test.ts`
Expected: FAIL — `../src/bindings.ts` and `../src/release-store.ts` cannot be found.

- [ ] **Step 3: Write `apps/server/src/bindings.ts`**

```ts
// Seat bindings (plan §3.2, protocol Addendum B.2): the cell signs a bind certificate at enrolment, and relays and cells trust a
// seat key only through one. A binding is self-proving, so a relay can replay it to a rebuilding cell. The PIN record stays
// sealed to the cell key (which lives outside this DB) even at rest. ponytail: one exam-shift, attempt 1, per node.
import type { Database, Statement } from 'bun:sqlite';
import { hexToBytes, toHex, utf8 } from '@saakshi/core/bytes';
import { canon } from '@saakshi/core/canon';
import { bindArray, checkWireBind, isP256Pub, openPinBox, type Bind, type BindReq, type WireBind } from '@saakshi/core/enrol';
import { nativeBox, signer, verifier } from '@saakshi/core/node';

export type EnrolCode = 'NOT_REGISTERED' | 'ALREADY_BOUND' | 'UNSUPPORTED' | 'BAD';
export type EnrolResult = { ok: true; bind: WireBind } | { ok: false; code: EnrolCode; error: string };
export interface BindingsOpts { exam: string; shift: string; cell: { id: string; pub: Uint8Array; priv?: Uint8Array } }
interface Row { cand: string; key_epoch: number; pub: string; cert: string; sig: string; cell: string; pin_box: string }
const wire = (r: Row): WireBind => ({ cert: r.cert, sig: r.sig, cell: r.cell, pinBox: r.pin_box });

export class Bindings {
  #o: BindingsOpts;
  #db: Database;
  #rows = new Map<string, Row>();
  #keys = new Map<string, Uint8Array>();
  #insert: Statement;
  #sign?: (m: Uint8Array) => Uint8Array;

  constructor(db: Database, o: BindingsOpts) {
    this.#o = o;
    this.#db = db;
    db.run(`CREATE TABLE IF NOT EXISTS bindings (exam TEXT NOT NULL, shift TEXT NOT NULL, attempt INTEGER NOT NULL, cand TEXT NOT NULL,
      key_epoch INTEGER NOT NULL, pub TEXT NOT NULL, cert TEXT NOT NULL, sig TEXT NOT NULL, cell TEXT NOT NULL, pin_box TEXT NOT NULL,
      PRIMARY KEY (exam, shift, attempt, cand, key_epoch)) WITHOUT ROWID`);
    this.#insert = db.query('INSERT OR IGNORE INTO bindings (exam, shift, attempt, cand, key_epoch, pub, cert, sig, cell, pin_box) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?)');
    for (const r of db.query('SELECT cand, key_epoch, pub, cert, sig, cell, pin_box FROM bindings WHERE exam = ? AND shift = ? AND attempt = 1').all(o.exam, o.shift) as Row[]) this.#put(r);
    if (o.cell.priv) this.#sign = signer({ priv: o.cell.priv, pub: o.cell.pub });
  }

  /** The key a relay or cell trusts for (cand, keyEpoch): only one this cell certified. */
  seatKey = (cand: string, keyEpoch: number): Uint8Array | undefined => this.#keys.get(`${cand}/${keyEpoch}`);
  get(cand: string, keyEpoch: number): WireBind | undefined { const r = this.#rows.get(`${cand}/${keyEpoch}`); return r && wire(r); }
  all(): WireBind[] { return [...this.#rows.values()].map(wire); }
  /** Candidates bound at keyEpoch 1: the reconciliation's "checked in". */
  cands(): string[] { return [...this.#rows.values()].filter((r) => r.key_epoch === 1).map((r) => r.cand).sort(); }
  tx<T>(fn: () => T): T { return this.#db.transaction(fn)(); }

  /** Relay and cell: store a binding this cell signed. Idempotent; a second key for the same (cand, keyEpoch) is refused. */
  accept(wb: WireBind): string | undefined {
    let b: Bind;
    try { b = checkWireBind(wb, this.#o.cell.pub, verifier); } catch (e) { return (e as Error).message; }
    if (wb.cell !== this.#o.cell.id) return `bind signed by ${wb.cell}, not ${this.#o.cell.id}`;
    if (b.exam !== this.#o.exam || b.shift !== this.#o.shift || b.attempt !== 1) return 'bind for another exam, shift or attempt';
    if (this.#o.cell.priv) { try { openPinBox(this.#o.cell.priv, { ...b, pinBox: wb.pinBox }, nativeBox); } catch { return 'the PIN box does not open with this cell key'; } }
    const cur = this.#rows.get(`${b.cand}/${b.keyEpoch}`);
    if (cur) return cur.pub === b.pub ? undefined : `${b.cand} is already bound to another key at keyEpoch ${b.keyEpoch}`;
    this.#store({ cand: b.cand, key_epoch: b.keyEpoch, pub: b.pub, cert: wb.cert, sig: wb.sig, cell: wb.cell, pin_box: wb.pinBox });
    return undefined;
  }
  acceptAll(wbs: WireBind[]): (string | undefined)[] { return this.tx(() => wbs.map((wb) => this.accept(wb))); }

  /** Cell only: enrol a seat at keyEpoch 1. The same request again returns the same certificate. */
  enrol(req: BindReq, registered: boolean): EnrolResult {
    const no = (code: EnrolCode, error: string): EnrolResult => ({ ok: false, code, error });
    if (!this.#sign || !this.#o.cell.priv) throw new Error('enrol runs on the cell');
    if (req.exam !== this.#o.exam || req.shift !== this.#o.shift || req.attempt !== 1) return no('BAD', `this cell enrols ${this.#o.exam} ${this.#o.shift} attempt 1 only`);
    if (!registered) return no('NOT_REGISTERED', `${req.cand} is not registered at a centre this cell serves`);
    if (req.keyEpoch !== 1 || req.fromSeq !== 0) return no('UNSUPPORTED', 'moving to another seat (handover) arrives in Stage 4');
    if (!isP256Pub(req.pub)) return no('BAD', 'pub is not a P-256 public key');
    try { openPinBox(this.#o.cell.priv, req, nativeBox); } catch { return no('BAD', 'the PIN box does not open with this cell key'); }
    const cur = this.#rows.get(`${req.cand}/1`);
    if (cur) return cur.pub === req.pub ? { ok: true, bind: wire(cur) } : no('ALREADY_BOUND', `${req.cand} is already bound to another seat — call the invigilator`);
    const b: Bind = { exam: req.exam, shift: req.shift, attempt: 1, cand: req.cand, seatId: req.seatId, pub: req.pub, keyEpoch: 1, fromSeq: 0, attestHash: req.attestHash };
    const cert = canon(bindArray(b));
    const row: Row = { cand: b.cand, key_epoch: 1, pub: b.pub, cert, sig: toHex(this.#sign(utf8(cert))), cell: this.#o.cell.id, pin_box: req.pinBox };
    this.#store(row);
    return { ok: true, bind: wire(row) };
  }

  #put(r: Row): void { const k = `${r.cand}/${r.key_epoch}`; this.#rows.set(k, r); this.#keys.set(k, hexToBytes(r.pub)); }
  #store(r: Row): void { this.#insert.run(this.#o.exam, this.#o.shift, r.cand, r.key_epoch, r.pub, r.cert, r.sig, r.cell, r.pin_box); this.#put(r); }
}
```

- [ ] **Step 4: Write `apps/server/src/release-store.ts`**

```ts
// Paper releases held by a cell or a relay (plan §3.3): control's signed release, or — on a relay — its own unwrap on the
// phoned-code path. Each one passes the seat's own check (kc_f against the signed manifest) before it is kept or passed on.
import type { Database, Statement } from 'bun:sqlite';
import { checkRelease, type Manifest, type ReleaseMsg } from '@saakshi/core/paper';
import type { Verify } from '@saakshi/core/sig';

export interface ReleaseStoreOpts {
  exam: string; shift: string; manifest: Manifest; authority: Verify;
  /** Cell: only control's signed release is accepted. */
  requireSig?: boolean;
  /** Called once per release that is new (or that upgrades an offline-code release to control's signed one). */
  onNew?: (r: ReleaseMsg) => void;
}

export class ReleaseStore {
  #o: ReleaseStoreOpts;
  #m = new Map<string, ReleaseMsg>();
  #set: Statement;

  constructor(db: Database, o: ReleaseStoreOpts) {
    this.#o = o;
    db.run('CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)');
    this.#set = db.query('INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v');
    for (const r of db.query('SELECT v FROM meta WHERE k LIKE ?').all(`release/${o.exam}/${o.shift}/%`) as { v: string }[]) {
      const m = JSON.parse(r.v) as ReleaseMsg;
      this.#m.set(m.form, m);
    }
  }

  list(): ReleaseMsg[] { return [...this.#m.values()].sort((a, b) => (a.form < b.form ? -1 : 1)); }
  /** Signed releases held — what a relay reports as SyncReq.have. */
  count(): number { return [...this.#m.values()].filter((r) => r.sig).length; }

  accept(r: ReleaseMsg): string | undefined {
    if (this.#o.requireSig && !r.sig) return 'only a release signed by control is accepted here';
    const c = checkRelease(r, this.#o.manifest, r.form, this.#o.authority);
    if (!c.ok) return c.error;
    const cur = this.#m.get(r.form);
    if (cur && (cur.sig || !r.sig)) return undefined;                              // same key (kc_f): nothing new
    const kcf = this.#o.manifest.forms.find((f) => f.form === r.form)!.kcf;
    const clean: ReleaseMsg = { exam: r.exam, shift: r.shift, form: r.form, kcf, ts: r.ts, key: r.key, sig: r.sig, via: r.via };
    this.#set.run(`release/${r.exam}/${r.shift}/${r.form}`, JSON.stringify(clean));
    this.#m.set(r.form, clean);
    this.#o.onNew?.(clean);
    return undefined;
  }
}
```

- [ ] **Step 5: Edit `apps/server/src/ingest.ts`**

- Imports: add `import type { WireBind } from '@saakshi/core/enrol';` and `import type { ReleaseMsg } from '@saakshi/core/paper';`.
- `IngestOpts`, after `cellId?: string;`:
```ts
  /** Stage 3: store the cell-signed bindings a request carries, before its entries are checked. One error (or undefined) per bind. */
  acceptBinds?: (binds: WireBind[]) => (string | undefined)[];
  /** Stage 3, cell: the releases it holds; sent in the response when the relay has fewer (SyncReq.have). */
  releases?: () => ReleaseMsg[];
```
- `interface Stream`: add `active: number; activeEpoch: number` (the last accepted entry's `activeMs` and `keyEpoch`), and initialise both to `0` in `get()`.
- In the startup loop that parses each stream's last line, replace `if (p?.ok && p.header.kind === 'submit') s.submitSeq = s.durable;` with:
```ts
    if (p?.ok) { s.active = p.header.activeMs; s.activeEpoch = p.header.keyEpoch; if (p.header.kind === 'submit') s.submitSeq = s.durable; }
```
- In `sync()`, right after the `for (const hl of req.streams) { … }` loop:
```ts
    // Stage 3: bindings first, so the entries below are checked against the keys they certify. A bad bind is evidence, not an error.
    if (req.binds?.length && o.acceptBinds) {
      o.acceptBinds(req.binds).forEach((err, i) => { if (err) evidence.push(['BAD_SUBMISSION', '', 0, `bind: ${err}`, req.binds![i].cert]); });
    }
```
- Right after the fork/duplicate line (`if (hd.seq <= head) return s.hs[hd.seq - 1] === h ? undefined : reject('FORK', …);`):
```ts
      // Addendum B.8: active time never runs backwards within a key epoch (plan §3.6).
      if (hd.keyEpoch === s.activeEpoch && hd.activeMs < s.active) return bad(`activeMs went backwards (${s.active} → ${hd.activeMs}) within keyEpoch ${hd.keyEpoch}`);
```
- Right after `s.hs.push(h);`: `s.active = hd.activeMs; s.activeEpoch = hd.keyEpoch;`
- Replace the final `return { streams: …, rejected };` with:
```ts
    const rel = o.releases?.() ?? [];
    return {
      streams: [...touched].map(([s, need]) => ({ ...s.ctx, head: s.durable, headH: s.durable ? s.hs[s.durable - 1] : '', need, ack: ackOf(s) })),
      rejected,
      ...(rel.length > (req.have ?? 0) ? { releases: rel } : {}),
    };
```

- [ ] **Step 6: Edit `apps/server/src/forward.ts`**

- Imports: add `import type { WireBind } from '@saakshi/core/enrol';`, `import type { ReleaseMsg } from '@saakshi/core/paper';`, `import type { Ctx } from '@saakshi/core/protocol';`.
- Add, above the class:
```ts
export interface ForwardOpts {
  batch?: number; heartbeatMs?: number;
  /** Stage 3: where releases from the cell go, and how many signed ones this relay already holds. */
  releases?: { count(): number; accept(r: ReleaseMsg): unknown };
  /** Stage 3: the binding to replay for a stream while the cell is REBUILDING. */
  bindFor?: (c: Ctx) => WireBind | undefined;
}
```
- Fields `#releases?: ForwardOpts['releases']; #bindFor?: ForwardOpts['bindFor'];`; the constructor becomes `constructor(relay: Ingest, send: CellSend, opts: ForwardOpts = {})` and also sets `this.#releases = opts.releases; this.#bindFor = opts.bindFor;`.
- In `round()`, replace the block from `let heartbeat = false;` to `const res = await this.#send(req);` with:
```ts
      // Stage 3: while the cell rebuilds, each stream's binding travels with its entries (the cell processes binds first).
      if (this.#replaying && this.#bindFor) {
        const binds = req.streams.flatMap((h): WireBind[] => { const b = this.#bindFor!(h); return b ? [b] : []; });
        if (binds.length) req.binds = binds;
      }
      let heartbeat = false;
      if (!req.streams.length) {
        if (this.#replaying) {
          if ((await this.#send({ entries: [], streams: [], replay: true, done: true })) === 'REBUILDING') return 'error';
          this.#replaying = false;
          return 'busy';
        }
        if (Date.now() - this.#lastContact < this.#heartbeatMs) return 'idle';
        req.streams = this.#relay.views().slice(0, 5000).map(hello);
        if (!req.streams.length && !this.#releases) return 'idle';                  // with releases to learn, an empty heartbeat still asks
        heartbeat = true;
      }
      if (this.#releases) req.have = this.#releases.count();
      const res = await this.#send(req);
```
- After the `for (const st of res.streams) { … }` loop: `for (const r of res.releases ?? []) this.#releases?.accept(r);`

- [ ] **Step 7: Run the server suite, the kill test and the typecheck** (the kill test binds ports: sandbox disabled)

Run: `bun test --timeout 60000 apps/server && bun tools/chaos-kill.ts && pnpm --filter @saakshi/server typecheck`
Expected: every test PASSes (all Stage 1–2 tests too; nothing in them runs `activeMs` backwards); the kill test prints `PASS`.

---

### Task 6: Cell routes — enrolment, the release push, bindings, per-centre stats

**Files:**
- Create: `apps/server/src/cell-routes.ts`, `apps/server/src/stats.ts`
- Test: `apps/server/test/cell-routes.test.ts`

**Interfaces:**
- Consumes: Task 5 (`Bindings`, `EnrolResult`, `ReleaseStore`), Task 1 (`parseBindReq`, `parseReleaseMsg`, `Directory`, `CellStats`, `Routes`).
- Produces:
  - `cellStats(i: { cellId; state; dir; views: StreamView[]; bound: string[]; submitted: string[] }): CellStats` — pure. A centre counts only if it is on this cell; `unlocked` = streams with head ≥ 1 (the unlock is always seq 1).
  - `cellRoutes(o: CellRoutesOpts): Routes` for `POST /v1/enrol`, `POST /v1/release`, `GET /v1/binds`, `GET /v1/stats`, with `CellRoutesOpts { cellId; dir: Directory; bindings; releases; state: () => NodeState; views: () => StreamView[]; submitted: () => string[] }`.

- [ ] **Step 1: Write the failing test**

`apps/server/test/cell-routes.test.ts`:
```ts
import { afterEach, beforeEach, expect, test } from 'bun:test';
import type { Database } from 'bun:sqlite';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hexToBytes, toHex } from '@saakshi/core/bytes';
import { cellKey, type KeysFile } from '@saakshi/core/dev';
import type { CellStats, Directory } from '@saakshi/core/directory';
import { checkWireBind, type WireBind } from '@saakshi/core/enrol';
import { newKeyPair, verifier } from '@saakshi/core/node';
import type { NodeState, StreamView } from '@saakshi/core/wire';
import { Bindings, type EnrolResult } from '../src/bindings.ts';
import { cellRoutes } from '../src/cell-routes.ts';
import { ReleaseStore } from '../src/release-store.ts';
import type { Routes } from '../src/serve.ts';
import { openDb } from '../src/store.ts';
import { simBindReq, simCustody } from '../../../tools/sim-custody.ts';

const keys = JSON.parse(readFileSync(new URL('../../../fixtures/keys.json', import.meta.url), 'utf8')) as KeysFile;
const cell = cellKey(keys, 'cell-1'), cust = simCustody(keys);
const e = (centre: string, form: 'F1' | 'F2' = 'F1') => ({ centre, form, extraMs: 0, pseud: '7'.repeat(64) });
const dir = { v: 1, exam: 'DEMO-2026', shift: 'S1', durationMs: 1_800_000, demoCentre: 'CEN042', issuedAt: 0, cells: [],
  centres: { CEN042: { cell: 'cell-1' }, CEN001: { cell: 'cell-1' }, CEN002: { cell: 'cell-2' } },
  cands: { C0001: e('CEN042'), C0002: e('CEN042', 'F2'), C00001: e('CEN001'), C00002: e('CEN002') } } as unknown as Directory;
let tmp: string, db: Database, routes: Routes, state: NodeState, views: StreamView[], submitted: string[];
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'saakshi-cellr-'));
  ({ db } = openDb(join(tmp, 'cell.db')));
  state = 'LIVE'; views = []; submitted = [];
  routes = cellRoutes({
    cellId: 'cell-1', dir, bindings: new Bindings(db, { exam: 'DEMO-2026', shift: 'S1', cell: { id: 'cell-1', ...cell } }),
    releases: new ReleaseStore(db, { exam: 'DEMO-2026', shift: 'S1', manifest: cust.manifest.manifest, authority: verifier(hexToBytes(keys.authority.pub)), requireSig: true }),
    state: () => state, views: () => views, submitted: () => submitted,
  });
});
afterEach(() => { db.close(); rmSync(tmp, { recursive: true, force: true }); });
const srv = { timeout() {} };
async function call<T>(path: string, method: 'GET' | 'POST', body?: unknown): Promise<{ status: number; body: T }> {
  const r = await routes[path][method]!(new Request(`http://cell${path}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }), srv);
  return { status: r.status, body: (await r.json()) as T };
}

test('enrol in a batch: registered seats get certificates; a candidate on another cell is NOT_REGISTERED; a malformed item is BAD; 503 while REBUILDING', async () => {
  const seat = newKeyPair();
  const r = await call<{ results: EnrolResult[] }>('/v1/enrol', 'POST', { enrols: [simBindReq('C0001', seat, cell.pub), simBindReq('C00002', newKeyPair(), cell.pub), { cand: 'C0002' }] });
  expect(r.status).toBe(200);
  const [ok, other, bad] = r.body.results;
  if (!ok.ok) throw new Error(ok.error);
  expect(checkWireBind(ok.bind, cell.pub).pub).toBe(toHex(seat.pub));
  expect([other, bad].map((x) => !x.ok && x.code)).toEqual(['NOT_REGISTERED', 'BAD']);
  expect((await call('/v1/enrol', 'POST', { enrols: 'nope' })).status).toBe(400);
  state = 'REBUILDING';
  expect((await call('/v1/enrol', 'POST', { enrols: [] })).status).toBe(503);
});

test('release push: control\'s signed release is kept; an unsigned one or a key off kc_f is refused with 400', async () => {
  expect((await call<{ accepted: number }>('/v1/release', 'POST', { releases: [cust.release('F1'), cust.release('F2')] })).body.accepted).toBe(2);
  expect((await call('/v1/release', 'POST', { releases: [{ ...cust.release('F1'), sig: '', via: 'code' }] })).status).toBe(400);
  const off = await call<{ errors: string[] }>('/v1/release', 'POST', { releases: [{ ...cust.release('F2'), key: '00'.repeat(32) }] });
  expect([off.status, off.body.errors[0]]).toEqual([400, expect.stringContaining('kc_f')]);
});

test('/v1/binds lists certificates a verifier accepts; /v1/stats counts per centre on this cell only', async () => {
  await call('/v1/enrol', 'POST', { enrols: [simBindReq('C0001', newKeyPair(), cell.pub), simBindReq('C00001', newKeyPair(), cell.pub)] });
  const { binds } = (await call<{ binds: WireBind[] }>('/v1/binds', 'GET')).body;
  expect(binds.map((b) => checkWireBind(b, cell.pub).cand).sort()).toEqual(['C00001', 'C0001']);
  const v = (cand: string, head: number, exam = 'DEMO-2026'): StreamView => ({ exam, shift: 'S1', attempt: 1, cand, head, cellHead: head, senderHead: head, seenAt: 1 });
  views = [v('C0001', 22), v('C0002', 0), v('C00001', 3), v('C00001', 9, 'OTHER-EXAM'), v('ZZZ', 5)];
  submitted = ['C0001'];
  expect((await call<CellStats>('/v1/stats', 'GET')).body).toEqual({
    cell: 'cell-1', state: 'LIVE', entries: 25,
    centres: {
      CEN042: { registered: 2, bound: 1, unlocked: 1, submitted: 1, entries: 22 },
      CEN001: { registered: 1, bound: 1, unlocked: 1, submitted: 0, entries: 3 },
    },
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test --timeout 60000 apps/server/test/cell-routes.test.ts`
Expected: FAIL — `../src/cell-routes.ts` cannot be found.

- [ ] **Step 3: Write `apps/server/src/stats.ts` and `apps/server/src/cell-routes.ts`**

`apps/server/src/stats.ts`:
```ts
// Per-centre numbers for the control room, computed on the cell from what it holds (plan §3.10). Pure.
import type { CellStats, CentreStats, Directory } from '@saakshi/core/directory';
import type { NodeState, StreamView } from '@saakshi/core/wire';

export function cellStats(i: { cellId: string; state: NodeState; dir: Directory; views: StreamView[]; bound: string[]; submitted: string[] }): CellStats {
  const centres: Record<string, CentreStats> = {};
  for (const [id, c] of Object.entries(i.dir.centres)) if (c.cell === i.cellId) centres[id] = { registered: 0, bound: 0, unlocked: 0, submitted: 0, entries: 0 };
  const at = (cand: string): CentreStats | undefined => { const c = i.dir.cands[cand]; return c && centres[c.centre]; };
  for (const cand of Object.keys(i.dir.cands)) { const s = at(cand); if (s) s.registered++; }
  for (const cand of i.bound) { const s = at(cand); if (s) s.bound++; }
  for (const cand of i.submitted) { const s = at(cand); if (s) s.submitted++; }
  let entries = 0;
  for (const v of i.views) {
    if (v.exam !== i.dir.exam || v.shift !== i.dir.shift) continue;
    const s = at(v.cand);
    if (!s) continue;
    s.entries += v.head;
    entries += v.head;
    if (v.head >= 1) s.unlocked++;                                                 // seq 1 is always the unlock
  }
  return { cell: i.cellId, state: i.state, entries, centres };
}
```

`apps/server/src/cell-routes.ts`:
```ts
// Cell routes added in Stage 3: enrolment in batches, control's release push, the bindings (for control's trust) and per-centre stats.
import type { Directory } from '@saakshi/core/directory';
import { parseReleaseMsg } from '@saakshi/core/paper';
import { parseBindReq, type NodeState, type StreamView } from '@saakshi/core/wire';
import type { Bindings, EnrolResult } from './bindings.ts';
import type { ReleaseStore } from './release-store.ts';
import type { Routes } from './serve.ts';
import { cellStats } from './stats.ts';

export interface CellRoutesOpts {
  cellId: string; dir: Directory; bindings: Bindings; releases: ReleaseStore;
  state: () => NodeState; views: () => StreamView[]; submitted: () => string[];
}
const json = (body: unknown, status = 200) => Response.json(body, { status });

export function cellRoutes(o: CellRoutesOpts): Routes {
  const serves = (cand: string): boolean => { const c = o.dir.cands[cand]; return !!c && o.dir.centres[c.centre]?.cell === o.cellId; };
  return {
    '/v1/enrol': { POST: async (req) => {
      if (o.state() === 'REBUILDING') return json({ state: 'REBUILDING' }, 503);
      const b = (await req.json().catch(() => null)) as { enrols?: unknown } | null;
      if (!b || !Array.isArray(b.enrols) || b.enrols.length > 500) return json({ error: 'need {enrols: BindReq[]} (at most 500)' }, 400);
      const enrols = b.enrols;
      const results = o.bindings.tx(() => enrols.map((x): EnrolResult => {
        try { const r = parseBindReq(x); return o.bindings.enrol(r, serves(r.cand)); }
        catch (e) { return { ok: false, code: 'BAD', error: (e as Error).message }; }
      }));
      return json({ results });
    } },
    '/v1/release': { POST: async (req) => {
      const b = (await req.json().catch(() => null)) as { releases?: unknown } | null;
      if (!b || !Array.isArray(b.releases) || b.releases.length > 10) return json({ error: 'need {releases: ReleaseMsg[]} (at most 10)' }, 400);
      const errors: string[] = [];
      let accepted = 0;
      for (const x of b.releases) {
        let err: string | undefined;
        try { err = o.releases.accept(parseReleaseMsg(x)); } catch (e) { err = (e as Error).message; }
        if (err) errors.push(err); else accepted++;
      }
      return json({ accepted, errors }, errors.length && !accepted ? 400 : 200);
    } },
    '/v1/binds': { GET: () => json({ binds: o.bindings.all() }) },
    '/v1/stats': { GET: () => json(cellStats({ cellId: o.cellId, state: o.state(), dir: o.dir, views: o.views(), bound: o.bindings.cands(), submitted: o.submitted() })) },
  };
}
```

- [ ] **Step 4: Run the test**

Run: `bun test --timeout 60000 apps/server/test/cell-routes.test.ts && pnpm --filter @saakshi/server typecheck`
Expected: PASS (3 tests); typecheck exits 0.

---

### Task 7: Relay routes — the package, the enrolment proxy, the release to seats (SSE + pull), the phoned code, DEV chaos

**Files:**
- Create: `apps/server/src/relay-routes.ts`
- Test: `apps/server/test/relay-routes.test.ts`

**Interfaces:**
- Consumes: Task 5 (`Bindings`, `EnrolResult`, `ReleaseStore`), Task 4 (`buildPackage` in the test), Task 1 (`parseBindReq`, `ReleaseMsg`, `SignedManifest`, `SignedPolicy`, `Routes`), `Hub`, `CellSend`, `unwrapForCentre`, `decodeCrockford80`, `kcf`, `toB64`.
- Produces:
  - `class Wan { up: boolean; wrap(send: CellSend): CellSend }` — the DEV switch for "cut Centre 42's link"; while down, the forwarder and the enrolment proxy fail as if the WAN were gone.
  - `relayRoutes(o: RelayOpts): Routes` with `RelayOpts { exam; shift; centre; policy: SignedPolicy; manifest: SignedManifest; papers: Record<string, Uint8Array>; wrap: Uint8Array; cellUrl; bindings; releases; hub: Hub; wan: Wan; dev: boolean; now?; log?; fetch?; timeoutMs? }`.
  - Routes: `GET /v1/package`, `POST /v1/enrol`, `GET /release/current`, `GET /v1/release/events`, `POST /v1/release/offline`, and with `dev`: `POST /v1/dev/wan`, `POST /v1/dev/forge`.
  - stdout lines `OFFLINE-UNLOCK {…}`, `WAN UP|DOWN (DEV chaos)`, `FORGED-KEY …` (the relay terminal shows the fallback).
  - The release hub's snapshot is `{releases: ReleaseMsg[]}` and its live event is `release` (main.ts wires `ReleaseStore.onNew → hub.publish('release', r)`).

- [ ] **Step 1: Write the failing test**

`apps/server/test/relay-routes.test.ts`:
```ts
import { afterAll, beforeAll, expect, test } from 'bun:test';
import type { Database } from 'bun:sqlite';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hexToBytes, toHex } from '@saakshi/core/bytes';
import { combineBundle } from '@saakshi/core/custody';
import { cellKey, type KeysFile } from '@saakshi/core/dev';
import type { Directory } from '@saakshi/core/directory';
import { msg, type BindReq, type WireBind } from '@saakshi/core/enrol';
import { newKeyPair, signer, verifier } from '@saakshi/core/node';
import { openCodes, openShareFile, releaseArray, type ReleaseMsg } from '@saakshi/core/paper';
import { signPolicy, type SignedPolicy } from '@saakshi/core/policy';
import { fromB64 } from '@saakshi/core/wire';
import { Bindings } from '../src/bindings.ts';
import { relayRoutes, Wan } from '../src/relay-routes.ts';
import { ReleaseStore } from '../src/release-store.ts';
import type { Routes } from '../src/serve.ts';
import { Hub } from '../src/sse.ts';
import { openDb } from '../src/store.ts';
import { buildPackage, type Package } from '../../../tools/package.ts';
import { simBindReq } from '../../../tools/sim-custody.ts';

const keys = JSON.parse(readFileSync(new URL('../../../fixtures/keys.json', import.meta.url), 'utf8')) as KeysFile;
const fx = (f: string) => JSON.parse(readFileSync(new URL(`../../../fixtures/paper/${f}`, import.meta.url), 'utf8'));
const cell = cellKey(keys, 'cell-1'), authority = { priv: hexToBytes(keys.authority.priv), pub: hexToBytes(keys.authority.pub) };
const X = { exam: 'DEMO-2026', shift: 'S1' };
const dir = { v: 1, ...X, durationMs: 1_800_000, demoCentre: 'CEN042', issuedAt: 0, cells: [], cands: {},
  centres: { CEN042: { cell: 'cell-1' }, CEN001: { cell: 'cell-2' } } } as unknown as Directory;
let tmp: string, cellDb: Database, relayDb: Database, pkg: Package, codes: Record<string, string>, codeS2: string, K: { kF1: Uint8Array };
let routes: Routes, store: ReleaseStore, hub: Hub, wan: Wan, relayB: Bindings, policy: SignedPolicy;
let cellUp = true;
const logs: string[] = [];
const srv = { timeout() {} };

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'saakshi-relayr-'));
  pkg = await buildPackage(dir, { bank: fx('bank.json'), forms: fx('forms.json') }, authority);
  const k = await combineBundle([openShareFile(pkg.shares.NTA, pkg.passphrases.NTA), openShareFile(pkg.shares.NIC, pkg.passphrases.NIC)]);
  codes = openCodes(k.L, X.exam, X.shift, pkg.codes);
  K = k;
  const s2 = await buildPackage({ ...dir, shift: 'S2' }, { bank: fx('bank.json'), forms: fx('forms.json') }, authority);
  const k2 = await combineBundle([openShareFile(s2.shares.NTA, s2.passphrases.NTA), openShareFile(s2.shares.OBS, s2.passphrases.OBS)]);
  codeS2 = openCodes(k2.L, X.exam, 'S2', s2.codes).CEN042;
  policy = signPolicy({ v: 1, ...X, centre: 'CEN042', cell: { id: 'cell-1', keyId: 'k', pub: toHex(cell.pub) }, durationMs: 1_800_000, roster: { C0001: { form: 'F1', extraMs: 0, pseud: '7'.repeat(64) } }, issuedAt: 0 }, signer(authority));

  ({ db: cellDb } = openDb(join(tmp, 'cell.db')));
  const cellB = new Bindings(cellDb, { ...X, cell: { id: 'cell-1', ...cell } });
  const cellFetch = (async (_url: string, init?: RequestInit) => {
    if (!cellUp) throw new Error('connect ECONNREFUSED');
    const { enrols } = JSON.parse(String(init!.body)) as { enrols: BindReq[] };
    return Response.json({ results: enrols.map((r) => cellB.enrol(r, r.cand !== 'C9999')) });
  }) as unknown as typeof fetch;

  ({ db: relayDb } = openDb(join(tmp, 'relay.db')));
  relayB = new Bindings(relayDb, { ...X, cell: { id: 'cell-1', pub: cell.pub } });
  hub = new Hub(() => ({ releases: store.list() }));
  store = new ReleaseStore(relayDb, { ...X, manifest: pkg.manifest.manifest, authority: verifier(authority.pub), onNew: (r) => hub.publish('release', r) });
  wan = new Wan();
  routes = relayRoutes({ ...X, centre: 'CEN042', policy, manifest: pkg.manifest, papers: pkg.papers, wrap: hexToBytes(pkg.wraps.CEN042), cellUrl: 'http://cell',
    bindings: relayB, releases: store, hub, wan, dev: true, fetch: cellFetch, log: (l) => logs.push(l) });
});
afterAll(() => { cellDb.close(); relayDb.close(); rmSync(tmp, { recursive: true, force: true }); });

async function call<T>(path: string, method: 'GET' | 'POST', body?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; body: T; res: Response }> {
  const res = await routes[path][method]!(new Request(`http://relay${path}`, { method, headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }), srv);
  const isSse = res.headers.get('content-type') === 'text/event-stream';
  return { status: res.status, body: (isSse ? undefined : await res.json()) as T, res };
}
/** Read an SSE response until `done(text)` holds, then hang up (a reconnecting seat does exactly this). */
async function frames(res: Response, done: (text: string) => boolean): Promise<string> {
  const r = res.body!.getReader();
  let text = '';
  while (!done(text)) { const { value, done: end } = await r.read(); if (end) break; text += new TextDecoder().decode(value); }
  await r.cancel();
  return text;
}
const lastId = (text: string) => [...text.matchAll(/^id: (\S+)$/gm)].at(-1)![1];

test('package: the signed policy and manifest and both paper ciphertexts, exactly what the manifest commits to', async () => {
  const { body } = await call<{ policy: SignedPolicy; manifest: unknown; paper: Record<string, string> }>('/v1/package', 'GET');
  expect(body.policy).toEqual(policy);
  expect(body.manifest).toEqual(pkg.manifest);
  for (const f of ['F1', 'F2']) expect(fromB64(body.paper[f])).toEqual(pkg.papers[f]);
});

test('enrolment proxy: bound when the cell answers (and the relay keeps the verified binding); provisional without the WAN or the cell; refusals pass through', async () => {
  const seat = newKeyPair(), req = simBindReq('C0001', seat, cell.pub, 'CEN042-S01');
  const ok = await call<{ bind: WireBind }>('/v1/enrol', 'POST', req);
  expect(ok.status).toBe(200);
  expect(relayB.seatKey('C0001', 1)).toEqual(seat.pub);
  expect((await call<{ bind: WireBind }>('/v1/enrol', 'POST', req)).body.bind).toEqual(ok.body.bind);
  expect((await call<{ code: string }>('/v1/enrol', 'POST', simBindReq('C0001', newKeyPair(), cell.pub))).body.code).toBe('ALREADY_BOUND');
  expect((await call<{ code: string }>('/v1/enrol', 'POST', simBindReq('C9999', newKeyPair(), cell.pub))).status).toBe(409);
  wan.up = false;
  expect(await call('/v1/enrol', 'POST', simBindReq('C0002', newKeyPair(), cell.pub)).then((r) => [r.status, r.body])).toEqual([202, { provisional: true, reason: 'the centre has no WAN link' }]);
  wan.up = true; cellUp = false;
  expect((await call<{ provisional: boolean }>('/v1/enrol', 'POST', simBindReq('C0002', newKeyPair(), cell.pub))).body.provisional).toBe(true);
  cellUp = true;
  expect((await call('/v1/enrol', 'POST', { cand: 'C0002' })).status).toBe(400);
});

test('Review Focus #3: a phoned code typed with spaces, dashes, lowercase and O-for-0 unlocks; a typo asks to re-type; another centre\'s or shift\'s code does not open', async () => {
  const typo = codes.CEN042.slice(0, 5) + (codes.CEN042[5] === 'A' ? 'B' : 'A') + codes.CEN042.slice(6);
  expect((await call<{ error: string }>('/v1/release/offline', 'POST', { code: typo })).body.error).toMatch(/typo/);
  for (const other of [codes.CEN001, codeS2]) {
    const r = await call<{ error: string }>('/v1/release/offline', 'POST', { code: other });
    expect([r.status, r.body.error]).toEqual([400, "This code does not open CEN042's paper for S1. Check the centre and shift with control."]);
  }
  expect(store.list()).toEqual([]);
  const typed = codes.CEN042.replace(/0/g, 'O').replace(/1/g, 'l').toLowerCase().replace(/(.{4})/g, '$1- ');
  const ok = await call<{ released: string[] }>('/v1/release/offline', 'POST', { code: typed });
  expect([ok.status, ok.body]).toEqual([200, { released: ['F1', 'F2'] }]);
  expect(store.list().map((r) => [r.form, r.via, r.sig])).toEqual([['F1', 'code', ''], ['F2', 'code', '']]);
  expect(logs.some((l) => l.startsWith('OFFLINE-UNLOCK {"centre":"CEN042","shift":"S1"'))).toBe(true);
});

test('exit check: the release to seats is idempotent across SSE reconnects — same keys by snapshot, by Last-Event-ID and by pull', async () => {
  const first = await frames((await call('/v1/release/events', 'GET')).res, (t) => t.includes('event: snapshot'));
  const snap = JSON.parse(/event: snapshot\ndata: (.*)/.exec(first)![1]) as { releases: ReleaseMsg[] };
  expect(snap.releases.map((r) => r.key)).toEqual(store.list().map((r) => r.key));
  // control's signed release now reaches the relay (via its cell): one live event, same key
  const r = { ...X, form: 'F1', kcf: pkg.manifest.manifest.forms[0].kcf, ts: 9 };
  const signed: ReleaseMsg = { ...r, key: toHex(K.kF1), sig: toHex(signer(authority)(msg(releaseArray(r)))), via: 'push' };
  const live = (await call('/v1/release/events', 'GET', undefined, { 'last-event-id': lastId(first) })).res;
  expect(store.accept(signed)).toBeUndefined();
  const got = await frames(live, (t) => t.includes('event: release'));
  expect((JSON.parse(/event: release\ndata: (.*)/.exec(got)![1]) as ReleaseMsg).key).toBe(signed.key);
  expect(store.accept(signed)).toBeUndefined();                                   // again: nothing new is published
  expect(hub.catchUp(lastId(got))).toEqual([]);                                   // reconnect with the last id: nothing to replay
  const again = JSON.parse(/data: (.*)/.exec(hub.catchUp('oldboot-7')[0])![1]) as { releases: ReleaseMsg[] };   // a relay restart: one snapshot
  expect(again.releases.map((x) => x.key)).toEqual(store.list().map((x) => x.key));
  expect((await call<{ releases: ReleaseMsg[] }>('/release/current', 'GET')).body.releases).toEqual(store.list());
});

test('DEV chaos: /v1/dev/wan flips the link; /v1/dev/forge publishes a key that matches no commitment and stores nothing; neither exists without DEV', async () => {
  expect((await call('/v1/dev/wan', 'POST', { up: false })).body).toEqual({ up: false });
  expect(wan.up).toBe(false);
  await call('/v1/dev/wan', 'POST', { up: true });
  const before = store.list(), id = hub.lastId;
  await call('/v1/dev/forge', 'POST');
  const [frame] = hub.catchUp(id);
  const forged = JSON.parse(/data: (.*)/.exec(frame)![1]) as ReleaseMsg;
  expect(forged.key).not.toBe(before[0].key);
  expect(store.list()).toEqual(before);
  const quiet = relayRoutes({ ...X, centre: 'CEN042', policy, manifest: pkg.manifest, papers: pkg.papers, wrap: hexToBytes(pkg.wraps.CEN042), cellUrl: 'http://cell', bindings: relayB, releases: store, hub, wan, dev: false });
  expect([quiet['/v1/dev/wan'], quiet['/v1/dev/forge']]).toEqual([undefined, undefined]);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test --timeout 60000 apps/server/test/relay-routes.test.ts`
Expected: FAIL — `../src/relay-routes.ts` cannot be found.

- [ ] **Step 3: Write `apps/server/src/relay-routes.ts`**

```ts
// Relay routes added in Stage 3 (plan §3.2–§3.3): the paper package for seats (T−1 h), the enrolment proxy (the PIN stays sealed
// to the cell), the release to seats by SSE push with a pull fallback, the superintendent's phoned code, and DEV chaos (cut the
// link; push a forged key). The relay is untrusted: every key it passes on is checked by the seat against kc_f.
import { decodeCrockford80, randomBytes, toHex } from '@saakshi/core/bytes';
import { unwrapForCentre } from '@saakshi/core/custody';
import type { ReleaseMsg, SignedManifest } from '@saakshi/core/paper';
import type { SignedPolicy } from '@saakshi/core/policy';
import { kcf } from '@saakshi/core/protocol';
import { parseBindReq, toB64 } from '@saakshi/core/wire';
import type { Bindings, EnrolResult } from './bindings.ts';
import type { CellSend } from './forward.ts';
import type { ReleaseStore } from './release-store.ts';
import type { Routes } from './serve.ts';
import type { Hub } from './sse.ts';

/** DEV chaos: "Cut Centre 42's link". While down, nothing from this relay reaches its cell. */
export class Wan {
  up = true;
  wrap(send: CellSend): CellSend { return (req) => (this.up ? send(req) : Promise.reject(new Error('WAN down (DEV chaos)'))); }
}

export interface RelayOpts {
  exam: string; shift: string; centre: string;
  policy: SignedPolicy; manifest: SignedManifest; papers: Record<string, Uint8Array>; wrap: Uint8Array;
  cellUrl: string; bindings: Bindings; releases: ReleaseStore; hub: Hub; wan: Wan; dev: boolean;
  now?: () => number; log?: (line: string) => void; fetch?: typeof fetch; timeoutMs?: number;
}
const json = (body: unknown, status = 200) => Response.json(body, { status });

export function relayRoutes(o: RelayOpts): Routes {
  const now = o.now ?? Date.now, log = o.log ?? ((l: string) => console.log(l)), f = o.fetch ?? fetch;
  const pkg = { policy: o.policy, manifest: o.manifest, paper: Object.fromEntries(Object.entries(o.papers).map(([form, b]) => [form, toB64(b)])) };
  const provisional = (reason: string) => json({ provisional: true, reason }, 202);

  const routes: Routes = {
    '/v1/package': { GET: () => json(pkg) },

    '/v1/enrol': { POST: async (req) => {
      let r;
      try { r = parseBindReq(await req.json()); } catch (e) { return json({ error: (e as Error).message }, 400); }
      if (!o.wan.up) return provisional('the centre has no WAN link');
      let res: Response;
      try {
        res = await f(`${o.cellUrl}/v1/enrol`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enrols: [r] }), signal: AbortSignal.timeout(o.timeoutMs ?? 5000) });
      } catch (e) { return provisional(`the exam server is unreachable: ${(e as Error).message}`); }
      if (!res.ok) return provisional(`the exam server answered ${res.status}`);
      const out = ((await res.json()) as { results?: EnrolResult[] }).results?.[0];
      if (!out) return provisional('the exam server gave no answer');
      if (!out.ok) return json({ error: out.error, code: out.code }, out.code === 'BAD' ? 400 : 409);
      const err = o.bindings.accept(out.bind);                                     // the relay checks the cell's certificate too
      if (err) return json({ error: `the exam server's certificate does not verify here: ${err}` }, 502);
      return json({ bind: out.bind });
    } },

    '/release/current': { GET: () => json({ releases: o.releases.list() }) },
    '/v1/release/events': { GET: (req, server) => o.hub.response(req, server) },

    '/v1/release/offline': { POST: async (req) => {
      const b = (await req.json().catch(() => null)) as { code?: unknown } | null;
      const code = typeof b?.code === 'string' ? b.code.replace(/\s+/g, '') : '';
      try { decodeCrockford80(code); } catch { return json({ error: 'That code has a typo (its check symbol does not match). Read it back to control and type it again.' }, 400); }
      let k: { kF1: Uint8Array; kF2: Uint8Array };
      try { k = unwrapForCentre(code, { exam: o.exam, shift: o.shift, centre: o.centre }, o.wrap); }
      catch { return json({ error: `This code does not open ${o.centre}'s paper for ${o.shift}. Check the centre and shift with control.` }, 400); }
      const keys: Record<string, Uint8Array> = { F1: k.kF1, F2: k.kF2 };
      for (const form of ['F1', 'F2']) {
        const r: ReleaseMsg = { exam: o.exam, shift: o.shift, form, kcf: kcf(keys[form]), ts: now(), key: toHex(keys[form]), sig: '', via: 'code' };
        const err = o.releases.accept(r);
        if (err) return json({ error: `the unwrapped ${form} key does not match the manifest: ${err}` }, 500);
      }
      log(`OFFLINE-UNLOCK ${JSON.stringify({ centre: o.centre, shift: o.shift, at: new Date(now()).toISOString() })}`);
      return json({ released: ['F1', 'F2'] });
    } },
  };

  if (o.dev) {
    routes['/v1/dev/wan'] = { POST: async (req) => {
      const b = (await req.json().catch(() => null)) as { up?: unknown } | null;
      if (typeof b?.up !== 'boolean') return json({ error: 'need {up: boolean}' }, 400);
      o.wan.up = b.up;
      log(`WAN ${b.up ? 'UP' : 'DOWN'} (DEV chaos)`);
      return json({ up: o.wan.up });
    } };
    routes['/v1/dev/forge'] = { POST: () => {
      const key = randomBytes(32);
      const forged: ReleaseMsg = { exam: o.exam, shift: o.shift, form: 'F1', kcf: kcf(key), ts: now(), key: toHex(key), sig: '', via: 'code' };
      o.hub.publish('release', forged);                                           // not stored: only the seats' check stands in the way
      log('FORGED-KEY pushed to the seats (DEV chaos): every seat must reject it (kc_f)');
      return json({ published: true });
    } };
  }
  return routes;
}
```

- [ ] **Step 4: Run the test**

Run: `bun test --timeout 60000 apps/server/test/relay-routes.test.ts && pnpm --filter @saakshi/server typecheck`
Expected: PASS (5 tests); typecheck exits 0.

---

### Task 8: Control's release — the ephemeral key, custodian shares, the signed push, zeroise, the phoned-in code

**Files:**
- Create: `apps/server/src/release-control.ts`
- Test: `apps/server/test/release-control.test.ts`

**Interfaces:**
- Consumes: Task 1 (`openBox`, `nativeBox`, `shareInfo`, `openCodes`, `releaseArray`, `msg`, `cellKeyId`, `CUSTODIANS`, `ReleaseStatus`, `SignedManifest`, `Routes`), `combineBundle`, `kcf`, `newKeyPair`, `signer`; Task 4 (`buildPackage`, in the test).
- Produces:
  - `releaseControl(o: ReleaseCtlOpts): { routes: Routes; status(): ReleaseStatus; close(): void }` with `ReleaseCtlOpts { dir; exam; shift; authority: KeyPair; manifest: SignedManifest; codes: Uint8Array; cells: { id; url }[]; push?; now?; retryMs? }`.
  - `httpPush(url, releases)`: `POST {url}/v1/release`.
  - Routes: `GET /v1/manifest`, `GET /v1/release/key`, `POST /v1/release/share`, `GET /v1/release/status`, `POST /v1/release/code`.
  - Custody log actions in `DIR/custody.jsonl` (the Stage 2 file and line format): `release-key`, `share-received`, `shares-rejected`, `share-after-release`, `release`, `release-pushed`, `release-push-failed`, `keys-zeroised`, `offline-code-revealed`.
  - Shares, keys and codes exist **only in memory**; nothing secret is written under `DIR`.

- [ ] **Step 1: Write the failing test**

`apps/server/test/release-control.test.ts`:
```ts
import { afterEach, beforeAll, beforeEach, expect, test } from 'bun:test';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hexToBytes, toHex } from '@saakshi/core/bytes';
import { sealBox } from '@saakshi/core/box';
import { combineBundle } from '@saakshi/core/custody';
import type { KeysFile } from '@saakshi/core/dev';
import type { Directory, ReleaseStatus } from '@saakshi/core/directory';
import { verifier } from '@saakshi/core/node';
import { checkRelease, openCodes, openShareFile, shareInfo, type ReleaseMsg } from '@saakshi/core/paper';
import { releaseControl } from '../src/release-control.ts';
import { buildPackage, type Package } from '../../../tools/package.ts';

const keys = JSON.parse(readFileSync(new URL('../../../fixtures/keys.json', import.meta.url), 'utf8')) as KeysFile;
const fx = (f: string) => JSON.parse(readFileSync(new URL(`../../../fixtures/paper/${f}`, import.meta.url), 'utf8'));
const authority = { priv: hexToBytes(keys.authority.priv), pub: hexToBytes(keys.authority.pub) };
const X = { exam: 'DEMO-2026', shift: 'S1' };
const dir = { v: 1, ...X, durationMs: 1, demoCentre: 'CEN042', issuedAt: 0, cells: [], cands: {},
  centres: { CEN042: { cell: 'cell-1' }, CEN001: { cell: 'cell-2' }, CEN002: { cell: 'cell-3' } } } as unknown as Directory;
const cells = [{ id: 'cell-1', url: 'u1' }, { id: 'cell-2', url: 'u2' }, { id: 'cell-3', url: 'u3' }];
let pkg: Package, other: Package, codes: Record<string, string>, tmp: string;
let rc: ReturnType<typeof releaseControl>, pushed: { url: string; rs: ReleaseMsg[] }[], down: Set<string>;
const srv = { timeout() {} };

beforeAll(async () => {
  pkg = await buildPackage(dir, { bank: fx('bank.json'), forms: fx('forms.json') }, authority);
  other = await buildPackage(dir, { bank: fx('bank.json'), forms: fx('forms.json') }, authority);    // another packaging run: other keys
  const k = await combineBundle([openShareFile(pkg.shares.NTA, pkg.passphrases.NTA), openShareFile(pkg.shares.OBS, pkg.passphrases.OBS)]);
  codes = openCodes(k.L, X.exam, X.shift, pkg.codes);
});
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'saakshi-rc-'));
  pushed = []; down = new Set();
  rc = releaseControl({ dir: tmp, ...X, authority, manifest: pkg.manifest, codes: pkg.codes, cells, retryMs: 10, now: () => 1_790_000_100_000,
    push: async (url, rs) => { if (down.has(url)) throw new Error('connect ECONNREFUSED'); pushed.push({ url, rs }); } });
});
afterEach(() => { rc.close(); rmSync(tmp, { recursive: true, force: true }); });

async function call<T>(path: string, method: 'GET' | 'POST', body?: unknown): Promise<{ status: number; body: T }> {
  const r = await rc.routes[path][method]!(new Request(`http://control${path}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }), srv);
  return { status: r.status, body: (await r.json()) as T };
}
/** What /custodian does in the browser: decrypt the share locally, seal it to control's in-memory release key. */
async function share(c: string, from: Package = pkg, damage = false) {
  const key = (await call<{ keyId: string; pub: string }>('/v1/release/key', 'GET')).body;
  const s = openShareFile(from.shares[c], from.passphrases[c]);
  if (damage) s[3] ^= 1;
  return call<ReleaseStatus & { error?: string }>('/v1/release/share', 'POST', { custodian: c, keyId: key.keyId, box: toHex(sealBox(hexToBytes(key.pub), shareInfo(X.exam, X.shift, c, key.keyId), s)) });
}
const actions = () => readFileSync(join(tmp, 'custody.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l).action as string);
const until = async (ok: () => boolean) => { for (let i = 0; i < 200 && !ok(); i++) await Bun.sleep(10); expect(ok()).toBe(true); };

test('two distinct custodians release: kc_f checked, a signed release per form pushed to every cell, keys zeroised, all logged', async () => {
  expect((await call('/v1/release/code', 'POST', { centre: 'CEN042', superintendent: 'SUP-42', callback: true })).status).toBe(409);   // sealed before T0
  const first = (await share('NTA')).body;
  expect([first.received, first.needed, first.released]).toEqual([['NTA'], 2, undefined]);
  const r = await share('NIC');
  expect(r.body.released).toEqual({ at: 1_790_000_100_000, custodians: ['NTA', 'NIC'], forms: pkg.manifest.manifest.forms.map((f) => ({ form: f.form, kcf: f.kcf })) });
  expect(pushed.map((p) => p.url)).toEqual(['u1', 'u2', 'u3']);
  for (const p of pushed) for (const rel of p.rs) expect(checkRelease(rel, pkg.manifest.manifest, rel.form, verifier(authority.pub)).ok).toBe(true);
  expect(rc.status()).toMatchObject({ zeroised: true, pushed: { 'cell-1': true, 'cell-2': true, 'cell-3': true } });
  expect(actions()).toEqual(['release-key', 'share-received', 'share-received', 'release', 'release-pushed', 'release-pushed', 'release-pushed', 'keys-zeroised']);
  expect((await share('OBS')).body.released?.custodians).toEqual(['NTA', 'NIC']);   // late shares change nothing
});

test('Review Focus #1: the same custodian twice counts once; a damaged share cannot release, and a third custodian still can', async () => {
  await share('NTA');
  const twice = (await share('NTA')).body;
  expect([twice.received, twice.released]).toEqual([['NTA'], undefined]);
  const bad = await share('NIC', pkg, true);
  expect([bad.status, bad.body.error]).toEqual([409, expect.stringContaining('do not rebuild the committed keys')]);
  expect(pushed).toEqual([]);
  const wrongExam = await share('OBS', other);
  expect(wrongExam.status).toBe(409);                                              // another packaging's share: kc_f says no
  const ok = await share('OBS');
  expect(ok.body.released?.custodians).toEqual(['NTA', 'OBS']);
  expect((await call('/v1/release/share', 'POST', { custodian: 'EVE', keyId: 'x', box: '' })).status).toBe(400);
  expect((await call('/v1/release/share', 'POST', { custodian: 'NIC', keyId: 'stale', box: '' })).status).toBe(409);
});

test('a cell that is down gets the release when it returns; control zeroises only after every cell has it', async () => {
  down.add('u2');
  await share('NTA'); await share('NIC');
  expect(rc.status()).toMatchObject({ zeroised: false, pushed: { 'cell-1': true, 'cell-2': false, 'cell-3': true } });
  down.delete('u2');
  await until(() => rc.status().zeroised);
  expect(pushed.map((p) => p.url)).toEqual(['u1', 'u3', 'u2']);
  expect(actions()).toContain('release-push-failed');
  expect(actions().filter((a) => a === 'release-pushed').length).toBe(3);
  expect(actions().at(-1)).toBe('keys-zeroised');
});

test('the phoned-in code: only the asked centre\'s code, only after a call-back, each reveal logged; nothing secret on control\'s disk', async () => {
  await share('NTA'); await share('OBS');
  expect((await call('/v1/release/code', 'POST', { centre: 'CEN042', superintendent: 'SUP-42' })).status).toBe(400);   // no call-back
  expect((await call('/v1/release/code', 'POST', { centre: 'CEN999', superintendent: 'SUP-42', callback: true })).status).toBe(400);
  const r = await call<{ centre: string; shift: string; code: string }>('/v1/release/code', 'POST', { centre: 'CEN042', superintendent: 'SUP-42', callback: true });
  expect(r.body).toMatchObject({ centre: 'CEN042', shift: 'S1', code: codes.CEN042 });
  expect(JSON.stringify(r.body).includes(codes.CEN001)).toBe(false);
  expect(rc.status().reveals).toEqual([{ at: 1_790_000_100_000, centre: 'CEN042', superintendent: 'SUP-42' }]);
  expect(actions().at(-1)).toBe('offline-code-revealed');
  const disk = readdirSync(tmp).map((f) => readFileSync(join(tmp, f), 'utf8')).join('\n');
  for (const c of Object.values(codes)) expect(disk.includes(c)).toBe(false);
  for (const c of ['NTA', 'OBS']) expect(disk.includes(toHex(openShareFile(pkg.shares[c], pkg.passphrases[c])))).toBe(false);
});
```
- [ ] **Step 2: Run it to verify it fails**

Run: `bun test --timeout 60000 apps/server/test/release-control.test.ts`
Expected: FAIL — `../src/release-control.ts` cannot be found.

- [ ] **Step 3: Write `apps/server/src/release-control.ts`**

```ts
// Control's side of the T0 release (plan §3.3). An ephemeral release key held only in memory; custodian shares arrive sealed to
// it; once two DISTINCT custodians have sent theirs, control rebuilds {K_F1, K_F2, L}, checks both keys against the manifest's
// kc_f, signs a release per form and pushes it to every cell (retrying until each has it), then zeroises the keys. The offline
// code list stays in memory for the phoned-in fallback; each reveal is logged. Nothing secret is written to disk.
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { hexToBytes, toHex } from '@saakshi/core/bytes';
import { openBox } from '@saakshi/core/box';
import { combineBundle } from '@saakshi/core/custody';
import { CUSTODIANS, type ReleaseStatus } from '@saakshi/core/directory';
import { cellKeyId, msg } from '@saakshi/core/enrol';
import { nativeBox, newKeyPair, signer, type KeyPair } from '@saakshi/core/node';
import { openCodes, releaseArray, shareInfo, type ReleaseMsg, type SignedManifest } from '@saakshi/core/paper';
import { kcf } from '@saakshi/core/protocol';
import type { Routes } from './serve.ts';

export interface ReleaseCtlOpts {
  dir: string; exam: string; shift: string; authority: KeyPair; manifest: SignedManifest; codes: Uint8Array;
  cells: { id: string; url: string }[];
  push?: (url: string, releases: ReleaseMsg[]) => Promise<void>;
  now?: () => number; retryMs?: number;
}
const json = (body: unknown, status = 200) => Response.json(body, { status });

export async function httpPush(url: string, releases: ReleaseMsg[]): Promise<void> {
  const r = await fetch(`${url}/v1/release`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ releases }), signal: AbortSignal.timeout(5000) });
  if (!r.ok) throw new Error(`${url} answered ${r.status}: ${await r.text()}`);
}

export function releaseControl(o: ReleaseCtlOpts) {
  const now = o.now ?? Date.now, push = o.push ?? httpPush, m = o.manifest.manifest;
  mkdirSync(o.dir, { recursive: true });
  const custody = (action: string, detail: Record<string, unknown> = {}) =>
    appendFileSync(join(o.dir, 'custody.jsonl'), JSON.stringify({ at: new Date(now()).toISOString(), actor: 'control (DEV)', action, exam: o.exam, shift: o.shift, ...detail }) + '\n');

  const eph: KeyPair = newKeyPair();                     // ponytail: control restarting before T0 needs a new key; custodians re-send
  const keyId = cellKeyId(eph.pub);                      // same fingerprint rule as cell keys (first 16 hex of SHA-256(pub))
  const shares = new Map<string, Uint8Array>();
  const received: string[] = [];
  const pushed: Record<string, boolean> = Object.fromEntries(o.cells.map((c) => [c.id, false]));
  const reveals: ReleaseStatus['reveals'] = [];
  let released: ReleaseStatus['released'];
  let codes: Record<string, string> | undefined;
  let pending: ReleaseMsg[] = [];
  let zeroised = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  custody('release-key', { keyId });

  const status = (): ReleaseStatus => ({ exam: o.exam, shift: o.shift, keyId, custodians: [...CUSTODIANS], received: [...received], needed: 2, released, pushed: { ...pushed }, zeroised, reveals: [...reveals], manifest: m });

  async function pushAll(): Promise<void> {
    timer = undefined;
    for (const c of o.cells) {
      if (pushed[c.id]) continue;
      try { await push(c.url, pending); pushed[c.id] = true; custody('release-pushed', { cell: c.id }); }
      catch (e) { custody('release-push-failed', { cell: c.id, error: (e as Error).message }); }
    }
    if (Object.values(pushed).every(Boolean)) {
      pending = [];                                      // the keys now live only in cells, relays and seats: the paper is out
      zeroised = true;
      custody('keys-zeroised', { note: 'control holds no paper key (best effort in a garbage-collected runtime)' });
    } else timer = setTimeout(() => void pushAll(), o.retryMs ?? 2000);
  }

  /** Any pair of distinct custodians whose shares rebuild both committed keys releases the paper. */
  async function tryRelease(): Promise<boolean> {
    const got = [...shares.entries()];
    for (let i = 0; i < got.length; i++) for (let j = i + 1; j < got.length; j++) {
      let b;
      try { b = await combineBundle([got[i][1], got[j][1]]); } catch { continue; }
      const K: Record<string, Uint8Array> = { F1: b.kF1, F2: b.kF2 };
      if (!m.forms.every((f) => K[f.form] && kcf(K[f.form]) === f.kcf)) { b.kF1.fill(0); b.kF2.fill(0); b.L.fill(0); continue; }
      const at = now(), sign = signer(o.authority);
      pending = m.forms.map((f) => {
        const r = { exam: o.exam, shift: o.shift, form: f.form, kcf: f.kcf, ts: at };
        return { ...r, key: toHex(K[f.form]), sig: toHex(sign(msg(releaseArray(r)))), via: 'push' as const };
      });
      codes = openCodes(b.L, o.exam, o.shift, o.codes);
      released = { at, custodians: [got[i][0], got[j][0]], forms: m.forms.map((f) => ({ form: f.form, kcf: f.kcf })) };
      for (const x of [b.kF1, b.kF2, b.L, ...shares.values()]) x.fill(0);
      shares.clear();
      custody('release', { custodians: released.custodians, forms: released.forms });
      await pushAll();
      return true;
    }
    return false;
  }

  const routes: Routes = {
    '/v1/manifest': { GET: () => json(o.manifest) },
    '/v1/release/key': { GET: () => json({ exam: o.exam, shift: o.shift, keyId, pub: toHex(eph.pub) }) },
    '/v1/release/status': { GET: () => json(status()) },
    '/v1/release/share': { POST: async (req) => {
      const b = (await req.json().catch(() => null)) as { custodian?: unknown; keyId?: unknown; box?: unknown } | null;
      const c = typeof b?.custodian === 'string' ? b.custodian : '';
      if (!(CUSTODIANS as readonly string[]).includes(c)) return json({ error: `custodian must be one of ${CUSTODIANS.join(', ')}` }, 400);
      if (b!.keyId !== keyId) return json({ error: 'That share was sealed to an old release key. Reload the custodian page and send it again.' }, 409);
      if (released) { custody('share-after-release', { custodian: c }); return json(status()); }
      let share: Uint8Array;
      try { share = openBox(eph.priv, shareInfo(o.exam, o.shift, c, keyId), hexToBytes(String(b!.box)), nativeBox); }
      catch { return json({ error: 'The share does not open with control\'s release key.' }, 400); }
      if (share.length !== 97) return json({ error: 'A share is 97 bytes.' }, 400);
      shares.get(c)?.fill(0);
      shares.set(c, share);                              // one custodian twice is still one custodian
      if (!received.includes(c)) received.push(c);
      custody('share-received', { custodian: c });
      if (shares.size >= 2 && !(await tryRelease())) {
        custody('shares-rejected', { custodians: [...shares.keys()] });
        return json({ ...status(), error: 'These shares do not rebuild the committed keys: one is damaged or from another exam. A third custodian can still release.' }, 409);
      }
      return json(status());
    } },
    '/v1/release/code': { POST: async (req) => {
      const b = (await req.json().catch(() => null)) as { centre?: unknown; superintendent?: unknown; callback?: unknown } | null;
      if (!codes) return json({ error: 'The offline codes stay sealed until two custodians release the paper.' }, 409);
      const centre = String(b?.centre ?? ''), sup = String(b?.superintendent ?? '').trim();
      if (!sup || sup.length > 64 || b?.callback !== true) return json({ error: 'Need the superintendent\'s ID and a confirmed call-back to the registered number.' }, 400);
      const code = codes[centre];
      if (!code) return json({ error: `No centre ${centre} in this shift.` }, 400);
      const at = now();
      reveals.push({ at, centre, superintendent: sup });
      custody('offline-code-revealed', { centre, superintendent: sup, note: 'this centre only, this shift only' });
      return json({ centre, shift: o.shift, code, at });
    } },
  };
  return { routes, status, close: () => clearTimeout(timer) };
}
```

- [ ] **Step 4: Run the test**

Run: `bun test --timeout 60000 apps/server/test/release-control.test.ts && pnpm --filter @saakshi/server typecheck`
Expected: PASS (4 tests); typecheck exits 0.

---

### Task 9: Control fleet — per-centre tiles and entries/s from every cell

**Files:**
- Create: `apps/server/src/fleet.ts`
- Test: `apps/server/test/fleet.test.ts`

**Interfaces:**
- Consumes: Task 1 (`Directory`, `CellEntry`, `CellStats`, `CentreTile`, `FleetView`, `TileTone`, `Routes`).
- Produces:
  - `tone(s: { registered; unlocked }, down: boolean): TileTone` — `down` if the cell is unreachable; `green` only when every registered candidate unlocked; `partial` when some did; else `locked`.
  - `httpStats(c: CellEntry): Promise<CellStats>`.
  - `fleet(o: { dir; stats?; now?; everyMs? }): { routes: Routes; poll(): Promise<FleetView>; view(): FleetView; start(): void; stop(): void }`. `routes` serves `GET /v1/fleet`.
  - A down cell keeps its centres' registered counts (from the directory) and its last entry count, so entries/s never goes negative.

- [ ] **Step 1: Write the failing test**

`apps/server/test/fleet.test.ts`:
```ts
import { expect, test } from 'bun:test';
import type { CellStats, CentreStats, Directory, FleetView } from '@saakshi/core/directory';
import { fleet, tone } from '../src/fleet.ts';

const e = (centre: string) => ({ centre, form: 'F1' as const, extraMs: 0, pseud: '' });
const cellE = (id: string) => ({ id, url: `http://${id}`, keyId: '', pub: '', cert: '' });
const dir = { v: 1, exam: 'DEMO-2026', shift: 'S1', durationMs: 1, demoCentre: 'CEN042', issuedAt: 0, cells: [cellE('cell-1'), cellE('cell-2')],
  centres: { CEN042: { cell: 'cell-1' }, CEN001: { cell: 'cell-1' }, CEN002: { cell: 'cell-2' } },
  cands: { C0001: e('CEN042'), C0002: e('CEN042'), X1: e('CEN001'), X2: e('CEN002'), X3: e('CEN002') } } as unknown as Directory;
const c = (registered: number, bound: number, unlocked: number, submitted: number, entries: number): CentreStats => ({ registered, bound, unlocked, submitted, entries });

test('tone: green only when every registered candidate unlocked; partial; locked; down', () => {
  expect([tone(c(2, 2, 2, 0, 0), false), tone(c(2, 2, 1, 0, 0), false), tone(c(2, 2, 0, 0, 0), false), tone(c(2, 2, 2, 0, 0), true), tone(c(0, 0, 0, 0, 0), false)])
    .toEqual(['green', 'partial', 'locked', 'down', 'locked']);
});

test('sums every cell per centre; a down cell greys its centres but keeps their registered counts and its last entry count', async () => {
  let t = 0;
  const stats: Record<string, CellStats | Error> = {
    'cell-1': { cell: 'cell-1', state: 'LIVE', entries: 100, centres: { CEN042: c(2, 2, 1, 0, 60), CEN001: c(1, 1, 1, 1, 40) } },
    'cell-2': { cell: 'cell-2', state: 'LIVE', entries: 50, centres: { CEN002: c(2, 2, 2, 0, 50) } },
  };
  const f = fleet({ dir, now: () => t, stats: async (x) => { const s = stats[x.id]; if (s instanceof Error) throw s; return s; } });
  let v = await f.poll();
  expect(v.centres.map((x) => [x.centre, x.tone, x.unlocked, x.registered])).toEqual([['CEN001', 'green', 1, 1], ['CEN002', 'green', 2, 2], ['CEN042', 'partial', 1, 2]]);
  expect(v).toMatchObject({ registered: 5, bound: 5, unlocked: 4, submitted: 1, entries: 150, entriesPerSec: 0 });
  t = 2000;
  stats['cell-1'] = { ...(stats['cell-1'] as CellStats), entries: 300 };
  expect((await f.poll()).entriesPerSec).toBe(100);                               // (300 + 50 − 150) / 2 s
  t = 3000;
  stats['cell-2'] = new Error('connect ECONNREFUSED');
  v = await f.poll();
  expect(v.cells).toEqual([{ id: 'cell-1', state: 'LIVE', entries: 300 }, { id: 'cell-2', state: 'DOWN', entries: 50 }]);
  expect(v.centres.find((x) => x.centre === 'CEN002')).toMatchObject({ tone: 'down', registered: 2, unlocked: 0 });
  expect(v.entriesPerSec).toBe(0);
  const res = await f.routes['/v1/fleet'].GET!(new Request('http://control/v1/fleet'), { timeout() {} });
  expect(((await res.json()) as FleetView).at).toBe(3000);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test --timeout 60000 apps/server/test/fleet.test.ts`
Expected: FAIL — `../src/fleet.ts` cannot be found.

- [ ] **Step 3: Write `apps/server/src/fleet.ts`**

```ts
// The control room's live numbers (plan §3.10–§3.11): every cell's /v1/stats each second, one tile per centre, and entries/s.
import type { CellEntry, CellStats, CentreStats, CentreTile, Directory, FleetView, TileTone } from '@saakshi/core/directory';
import type { Routes } from './serve.ts';

export const tone = (s: { registered: number; unlocked: number }, down: boolean): TileTone =>
  down ? 'down' : s.registered > 0 && s.unlocked === s.registered ? 'green' : s.unlocked > 0 ? 'partial' : 'locked';

export async function httpStats(c: CellEntry): Promise<CellStats> {
  const r = await fetch(`${c.url}/v1/stats`, { signal: AbortSignal.timeout(2000) });
  if (!r.ok) throw new Error(`${c.id} answered ${r.status}`);
  return (await r.json()) as CellStats;
}

export function fleet(o: { dir: Directory; stats?: (c: CellEntry) => Promise<CellStats>; now?: () => number; everyMs?: number }) {
  const now = o.now ?? Date.now, stats = o.stats ?? httpStats;
  const registered: Record<string, number> = {};
  for (const c of Object.values(o.dir.cands)) registered[c.centre] = (registered[c.centre] ?? 0) + 1;
  const lastEntries: Record<string, number> = Object.fromEntries(o.dir.cells.map((c) => [c.id, 0]));
  const empty = (centre: string): CentreStats => ({ registered: registered[centre] ?? 0, bound: 0, unlocked: 0, submitted: 0, entries: 0 });
  let prev: { at: number; entries: number } | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let view: FleetView = { at: 0, registered: Object.keys(o.dir.cands).length, bound: 0, unlocked: 0, submitted: 0, entries: 0, entriesPerSec: 0,
    cells: o.dir.cells.map((c) => ({ id: c.id, state: 'DOWN', entries: 0 })), centres: [] };

  async function poll(): Promise<FleetView> {
    const got = await Promise.allSettled(o.dir.cells.map((c) => stats(c)));
    const at = now();
    const byCell = new Map(o.dir.cells.map((c, i) => [c.id, got[i]]));
    const cells = o.dir.cells.map((c) => {
      const g = byCell.get(c.id)!;
      if (g.status === 'fulfilled') lastEntries[c.id] = g.value.entries;                  // a down cell keeps its last count
      return { id: c.id, state: g.status === 'fulfilled' ? g.value.state : ('DOWN' as const), entries: lastEntries[c.id] };
    });
    const centres: CentreTile[] = Object.entries(o.dir.centres).sort(([a], [b]) => a.localeCompare(b)).map(([centre, { cell }]) => {
      const g = byCell.get(cell);
      const s = (g?.status === 'fulfilled' && g.value.centres[centre]) || empty(centre);
      return { centre, cell, ...s, tone: tone(s, g?.status !== 'fulfilled') };
    });
    const sum = (k: keyof CentreStats) => centres.reduce((n, x) => n + x[k], 0);
    const entries = cells.reduce((n, x) => n + x.entries, 0);
    const entriesPerSec = prev && at > prev.at ? Math.max(0, Math.round(((entries - prev.entries) * 1000) / (at - prev.at))) : 0;
    prev = { at, entries };
    view = { at, registered: sum('registered'), bound: sum('bound'), unlocked: sum('unlocked'), submitted: sum('submitted'), entries, entriesPerSec, cells, centres };
    return view;
  }

  const routes: Routes = { '/v1/fleet': { GET: () => Response.json(view) } };
  return {
    routes, poll, view: () => view,
    start(): void { const loop = async () => { await poll().catch(() => {}); timer = setTimeout(loop, o.everyMs ?? 1000); }; void loop(); },
    stop(): void { clearTimeout(timer); },
  };
}
```

- [ ] **Step 4: Run the test**

Run: `bun test --timeout 60000 apps/server/test/fleet.test.ts && pnpm --filter @saakshi/server typecheck`
Expected: PASS (2 tests); typecheck exits 0.

---

### Task 10: The control room and the relay console — tiles, KPIs, entries/s, custody panel, phoned code, chaos

**Files:**
- Modify: `apps/server/src/control.html` (full replacement below), `apps/server/src/control-page.ts` (append), `apps/server/src/control-view.ts` (append)
- Modify: `apps/server/src/console.html` (full replacement below), `apps/server/src/console.ts` (append), `apps/server/src/console-view.ts` (append)
- Test: append to `apps/server/test/control-view.test.ts` and `apps/server/test/console-view.test.ts`

**Interfaces:**
- Consumes: Task 1 (`FleetView`, `CentreTile`, `ReleaseStatus`, `Manifest`, `ReleaseMsg`); the routes `/v1/fleet`, `/v1/release/status`, `/v1/release/code`, `/v1/chaos/wan` (control) and `/release/current`, `/v1/release/offline`, `/v1/dev/forge` (relay). The pages only call routes; Task 16 serves them.
- Produces (pure, tested):
  - `control-view.ts`: `fmt(n)` (en-IN grouping), `group(s, n = 4)`, `kpis(f: FleetView): {label, value}[]`, `tileText(t: CentreTile): {title, line, word, aria}`, `fleetSummary(f): string`, `releaseLines(s: ReleaseStatus): string[]`, `commitment(m: Manifest): string[]`.
  - `console-view.ts`: `paperStatus(releases: ReleaseMsg[]): { text: string; tone: 'locked' | 'released' }`.
  - Button labels: **"Cut Centre 42's link"**, **"Restore Centre 42's link"**, **"Reveal this centre's code"** (control); **"Unlock the paper at this centre"**, **"Push a forged key to the seats"** (relay console, DEV chaos).

- [ ] **Step 1: Write the failing tests**

Append to `apps/server/test/control-view.test.ts` (add the imports):
```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FleetView, ReleaseStatus } from '@saakshi/core/directory';
import { commitment, fleetSummary, kpis, releaseLines, tileText } from '../src/control-view.ts';

/** Every font size is a --s step, and neighbouring steps differ by at least 1.25×. */
function typeScaleOk(html: string): boolean {
  const steps = [...html.matchAll(/--s-?\d:\s*([\d.]+)rem/g)].map((m) => Number(m[1])).sort((a, b) => a - b);
  const ratios = steps.slice(1).map((s, i) => s / steps[i]);
  const decls = [...html.matchAll(/font(-size)?:\s*([^;}]+)/g)].map((m) => m[2]);
  return steps.length >= 3 && ratios.every((r) => r >= 1.249) && decls.every((d) => d.trim() === 'inherit' || d.includes('var(--s'));
}

const fleetView: FleetView = {
  at: 1, registered: 19806, bound: 19806, unlocked: 19798, submitted: 0, entries: 123456, entriesPerSec: 2345,
  cells: [{ id: 'cell-1', state: 'LIVE', entries: 1 }, { id: 'cell-2', state: 'DOWN', entries: 0 }],
  centres: [
    { centre: 'CEN001', cell: 'cell-2', registered: 200, bound: 200, unlocked: 200, submitted: 0, entries: 9, tone: 'green' },
    { centre: 'CEN042', cell: 'cell-1', registered: 8, bound: 2, unlocked: 0, submitted: 0, entries: 0, tone: 'locked' },
  ],
};

test('fleet: KPIs with Indian digit grouping, tiles that carry a word (never colour alone), and a summary', () => {
  expect(kpis(fleetView).map((k) => [k.label, k.value])).toEqual([
    ['Candidates registered', '19,806'], ['Seats bound', '19,806'], ['Paper unlocked', '19,798'], ['Submitted', '0'], ['Entries per second', '2,345'],
  ]);
  expect(tileText(fleetView.centres[1])).toEqual({ title: 'CEN042', line: '0 / 8 unlocked', word: 'Locked', aria: 'CEN042: Locked, 0 of 8 unlocked, 2 bound, 0 submitted, on cell-1' });
  expect(tileText(fleetView.centres[0]).word).toBe('All unlocked');
  expect(fleetSummary(fleetView)).toBe('1 of 2 centres green · 1 of 2 exam servers live');
});

test('custody panel: fingerprint, shares, release, push, zeroise, reveals; the commitment reads in groups', () => {
  const manifest = { exam: 'DEMO-2026', shift: 'S1', forms: [{ form: 'F1', ciphertextHash: 'ab'.repeat(32), kcf: 'cd'.repeat(32) }], ts: 1 };
  const s: ReleaseStatus = { exam: 'DEMO-2026', shift: 'S1', keyId: 'feedfacecafebeef', custodians: ['NTA', 'NIC', 'OBS'], received: ['NTA'], needed: 2, pushed: { 'cell-1': false }, zeroised: false, reveals: [], manifest };
  expect(releaseLines(s)).toEqual(['Release key feed face cafe beef — held in memory only; confirm this fingerprint with each custodian by phone.', 'Shares received: NTA — 1 more needed.']);
  const r: ReleaseStatus = { ...s, received: ['NTA', 'NIC'], released: { at: Date.UTC(2026, 8, 27, 4, 30, 3), custodians: ['NTA', 'NIC'], forms: [{ form: 'F1', kcf: 'cd'.repeat(32) }] },
    pushed: { 'cell-1': true, 'cell-2': false }, reveals: [{ at: Date.UTC(2026, 8, 27, 4, 40), centre: 'CEN042', superintendent: 'SUP-42' }] };
  expect(releaseLines(r).slice(1)).toEqual([
    'Released at 04:30:03 UTC by NTA + NIC.', 'Pushing to the exam servers: cell-1 ✓ · cell-2 …',
    'Offline code for CEN042 revealed to superintendent SUP-42 at 04:40:00 UTC (logged).',
  ]);
  expect(releaseLines({ ...r, zeroised: true })[2]).toBe('Every exam server has the release; control has zeroised the keys.');
  expect(commitment(manifest)).toEqual(['F1: kc_f cdcd cdcd cdcd cdcd … · ciphertext abab abab abab abab …']);
});

test('UI rules: the control page and the relay console use a 1.25 type scale and render server text with textContent only', () => {
  for (const f of ['control.html', 'console.html']) expect(typeScaleOk(readFileSync(join(import.meta.dir, '../src', f), 'utf8'))).toBe(true);
  for (const f of ['control-page.ts', 'console.ts']) expect(readFileSync(join(import.meta.dir, '../src', f), 'utf8')).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
});
```

Append to `apps/server/test/console-view.test.ts`:
```ts
import type { ReleaseMsg } from '@saakshi/core/paper';
import { paperStatus } from '../src/console-view.ts';

test('paper status: locked, released by control, or unlocked here with the phoned code', () => {
  const r = (via: 'push' | 'code', form = 'F1'): ReleaseMsg => ({ exam: 'DEMO-2026', shift: 'S1', form, kcf: '', ts: Date.UTC(2026, 8, 27, 4, 30), key: '', sig: via === 'push' ? 'ab' : '', via });
  expect(paperStatus([])).toEqual({ text: 'Paper locked — waiting for T0 (or for the code phoned in by control if this centre is offline).', tone: 'locked' });
  expect(paperStatus([r('push'), r('push', 'F2')]).text).toBe('Paper released by control at T0 (F1, F2) at 04:30:00 UTC. Every seat checks the key against the published commitment.');
  expect(paperStatus([r('code'), r('code', 'F2')]).text).toBe('Paper unlocked here with the phoned code (F1, F2) at 04:30:00 UTC. Every seat checks the key against the published commitment.');
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test --timeout 60000 apps/server/test/control-view.test.ts apps/server/test/console-view.test.ts`
Expected: FAIL — `kpis`, `tileText`, `paperStatus` … are not exported; the type-scale check fails on the Stage 2 CSS.

- [ ] **Step 3: Append to `apps/server/src/control-view.ts` and `apps/server/src/console-view.ts`**

`apps/server/src/control-view.ts` (add `import type { CentreTile, FleetView, ReleaseStatus } from '@saakshi/core/directory';` and `import type { Manifest } from '@saakshi/core/paper';`):
```ts
export const fmt = (n: number): string => n.toLocaleString('en-IN');
export const group = (s: string, n = 4): string => s.replace(new RegExp(`(.{${n}})(?=.)`, 'g'), '$1 ');
const utc = (ms: number): string => `${new Date(ms).toISOString().slice(11, 19)} UTC`;

export function kpis(f: FleetView): { label: string; value: string }[] {
  return [
    { label: 'Candidates registered', value: fmt(f.registered) },
    { label: 'Seats bound', value: fmt(f.bound) },
    { label: 'Paper unlocked', value: fmt(f.unlocked) },
    { label: 'Submitted', value: fmt(f.submitted) },
    { label: 'Entries per second', value: fmt(f.entriesPerSec) },
  ];
}

const WORD = { green: 'All unlocked', partial: 'Unlocking', locked: 'Locked', down: 'Exam server down' } as const;
export function tileText(t: CentreTile): { title: string; line: string; word: string; aria: string } {
  const word = WORD[t.tone];
  return { title: t.centre, line: `${fmt(t.unlocked)} / ${fmt(t.registered)} unlocked`, word,
    aria: `${t.centre}: ${word}, ${t.unlocked} of ${t.registered} unlocked, ${t.bound} bound, ${t.submitted} submitted, on ${t.cell}` };
}

export function fleetSummary(f: FleetView): string {
  return `${f.centres.filter((c) => c.tone === 'green').length} of ${f.centres.length} centres green · ${f.cells.filter((c) => c.state === 'LIVE').length} of ${f.cells.length} exam servers live`;
}

export function releaseLines(s: ReleaseStatus): string[] {
  const lines = [`Release key ${group(s.keyId)} — held in memory only; confirm this fingerprint with each custodian by phone.`];
  if (!s.released) lines.push(`Shares received: ${s.received.length ? s.received.join(', ') : 'none'} — ${Math.max(0, s.needed - s.received.length)} more needed.`);
  else {
    lines.push(`Released at ${utc(s.released.at)} by ${s.released.custodians.join(' + ')}.`);
    lines.push(s.zeroised ? 'Every exam server has the release; control has zeroised the keys.' : `Pushing to the exam servers: ${Object.entries(s.pushed).map(([c, ok]) => `${c} ${ok ? '✓' : '…'}`).join(' · ')}`);
  }
  for (const r of s.reveals) lines.push(`Offline code for ${r.centre} revealed to superintendent ${r.superintendent} at ${utc(r.at)} (logged).`);
  return lines;
}

export const commitment = (m: Manifest): string[] =>
  m.forms.map((f) => `${f.form}: kc_f ${group(f.kcf.slice(0, 16))} … · ciphertext ${group(f.ciphertextHash.slice(0, 16))} …`);
```

`apps/server/src/console-view.ts` (add `import type { ReleaseMsg } from '@saakshi/core/paper';`):
```ts
export function paperStatus(releases: ReleaseMsg[]): { text: string; tone: 'locked' | 'released' } {
  if (!releases.length) return { text: 'Paper locked — waiting for T0 (or for the code phoned in by control if this centre is offline).', tone: 'locked' };
  const how = releases.some((r) => r.sig) ? 'released by control at T0' : 'unlocked here with the phoned code';
  const at = new Date(Math.max(...releases.map((r) => r.ts))).toISOString().slice(11, 19);
  return { text: `Paper ${how} (${releases.map((r) => r.form).join(', ')}) at ${at} UTC. Every seat checks the key against the published commitment.`, tone: 'released' };
}
```

- [ ] **Step 4: Replace `apps/server/src/control.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Saakshi · Control</title>
    <style>
      :root {
        --s-1: .8rem; --s0: 1rem; --s1: 1.25rem; --s2: 1.563rem; --s3: 1.953rem; --s4: 2.441rem;
        --ink: #202124; --muted: #5f6368; --line: #dadce0; --blue: #1565c0;
        font-family: system-ui, sans-serif; color: var(--ink); background: #fff;
      }
      body { margin: 0; padding: 1rem 1.5rem 3rem; max-width: 80rem; font-size: var(--s0); line-height: 1.5; }
      h1 { font-size: var(--s3); margin: 0 0 1rem; } h2 { font-size: var(--s2); margin: 2rem 0 .5rem; } h3 { font-size: var(--s1); margin: 1.25rem 0 .25rem; }
      .kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr)); gap: .75rem; margin: 0; }
      .kpis div { border: 1px solid var(--line); border-radius: .5rem; padding: .5rem .75rem; }
      .kpis dt { font-size: var(--s-1); color: var(--muted); }
      .kpis dd { margin: 0; font-size: var(--s4); font-weight: 700; font-variant-numeric: tabular-nums; }
      #tiles { list-style: none; padding: 0; margin: .5rem 0 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(8.5rem, 1fr)); gap: .375rem; }
      .tile { border: 2px solid; border-radius: .375rem; padding: .25rem .5rem; display: grid; }
      .tile strong { font-size: var(--s1); }
      .tile span { font-size: var(--s-1); font-variant-numeric: tabular-nums; }
      .tile.green { color: #0d5222; background: #e6f4ea; border-color: #1e6b25; }
      .tile.partial { color: #7a4100; background: #fef7e0; border-color: #b06000; }
      .tile.locked { color: #3c4043; background: #f1f3f4; border-color: #9aa0a6; }
      .tile.down { color: #8c1d18; background: #fce8e6; border-color: #c62828; }
      table { border-collapse: collapse; width: 100%; font-variant-numeric: tabular-nums; }
      th, td { border: 1px solid var(--line); padding: .375rem .5rem; text-align: left; }
      td.ok { background: #e6f4ea; } td.bad { background: #fce8e6; font-weight: 700; }
      .ok { color: #1e6b25; } .bad { color: #b3261e; }
      button { font: inherit; padding: .5rem 1rem; border-radius: .375rem; border: 1px solid var(--muted); background: #fff; color: var(--ink); cursor: pointer; min-height: 2.75rem; }
      button.primary { background: var(--blue); color: #fff; border-color: var(--blue); }
      button.chaos { background: #b3261e; color: #fff; border-color: #b3261e; }
      form { display: flex; flex-wrap: wrap; gap: .5rem; align-items: end; }
      label { display: grid; gap: .125rem; font-size: var(--s-1); }
      input, select { font: inherit; padding: .375rem; min-height: 2.25rem; }
      .check { display: flex; gap: .5rem; align-items: center; min-height: 2.75rem; }
      .out { font: var(--s-1)/1.5 ui-monospace, Menlo, monospace; white-space: pre-wrap; overflow-wrap: anywhere; margin: .5rem 0 0; }
      .code { font: 700 var(--s3)/1.3 ui-monospace, Menlo, monospace; letter-spacing: .06em; margin: .25rem 0; }
      #audit-headline { font-size: var(--s2); font-weight: 700; margin: .5rem 0; }
      .note { color: var(--muted); font-size: var(--s-1); }
      :focus-visible { outline: 3px solid var(--blue); outline-offset: 2px; }
      @media (forced-colors: active) { .tile { border-color: CanvasText; } }
    </style>
  </head>
  <body>
    <h1>Control · DEMO-2026 · S1</h1>

    <h2>Start on time</h2>
    <dl class="kpis" id="kpis"></dl>
    <p id="fleet-summary" role="status">…</p>
    <p id="cells" class="note"></p>
    <h3>Centres</h3>
    <ul id="tiles" aria-label="Centres"></ul>
    <p class="note">Each tile: unlocked / registered. All unlocked: every registered candidate's paper is open · Unlocking: some are · Locked: none yet · Exam server down: its cell does not answer.</p>

    <h2>Custody — the two-key locker</h2>
    <h3>Published commitment (the signed manifest)</h3>
    <ul id="commitment" class="out"></ul>
    <h3>Release</h3>
    <ul id="release"></ul>
    <p><a href="/custodian">Open the custodian page</a> — each custodian uses their own share file and passphrase.</p>

    <h3>Phoned-in fallback</h3>
    <form id="offline">
      <label>Centre <select id="off-centre" name="centre"></select></label>
      <label>Superintendent ID <input name="superintendent" autocomplete="off" required size="10" /></label>
      <label class="check"><input type="checkbox" name="callback" required /> I called back the centre's registered number</label>
      <button class="primary">Reveal this centre's code</button>
    </form>
    <p class="note">Reveals only that centre's code, for this shift only. Every reveal is logged.</p>
    <p id="off-code" class="code"></p>
    <p id="off-out" class="out" role="status"></p>

    <h3>Chaos</h3>
    <form id="wan">
      <button class="chaos" name="up" value="false">Cut Centre 42's link</button>
      <button name="up" value="true">Restore Centre 42's link</button>
    </form>
    <p class="note">DEV chaos: the demo centre's relay stops reaching its exam server, as if the WAN line were cut.</p>
    <p id="wan-out" class="out" role="status"></p>

    <h2>Prove it — Centre 42</h2>
    <h3>Reconciliation (per centre-shift)</h3>
    <table>
      <thead><tr><th scope="col">Centre · shift</th><th scope="col">Registered</th><th scope="col">Checked in</th><th scope="col">Unlocked</th><th scope="col">Submitted</th><th scope="col">Receipts</th><th scope="col">Register leaves</th><th scope="col">Relay = cell heads</th></tr></thead>
      <tbody><tr id="recon-row"></tr></tbody>
    </table>
    <p id="recon-status" role="status">…</p>

    <h3>Sealed public register</h3>
    <button id="seal" class="primary">Seal the shift — publish the register head</button>
    <p id="seal-out" class="out" role="status"></p>

    <h3>Rogue insider</h3>
    <form id="rogue">
      <label>Candidate <input name="cand" value="C0001" size="7" /></label>
      <label>Question <input name="q" type="number" min="1" max="20" value="17" /></label>
      <label>New answer <select name="answer"><option>A</option><option>B</option><option selected>C</option><option>D</option></select></label>
      <button class="chaos">Rogue insider edits an answer</button>
    </form>
    <p class="note">DEV chaos: runs an UPDATE on the exam cell's database, as an insider with DB access would. The cell's terminal prints it.</p>
    <p id="rogue-out" class="out" role="status"></p>

    <h3>Audit</h3>
    <button id="audit" class="primary">Run the audit</button>
    <p id="audit-headline" role="status"></p>
    <ul id="audit-list"></ul>

    <h3>Evidence</h3>
    <form id="evidence">
      <label>Candidate <input id="ev-cand" name="cand" value="C0001" size="7" /></label>
      <button class="primary">Export the evidence pack</button>
      <a id="verify-link" href="/verify?cand=C0001">Open /verify for this candidate</a>
    </form>
    <p id="evidence-out" class="out" role="status"></p>

    <script type="module" src="./control-page.ts"></script>
  </body>
</html>
```
Keep every Stage 2 element id unchanged (the existing `control-page.ts` code and `main.test.ts`'s "Rogue insider edits an answer" check depend on them).

- [ ] **Step 5: Append to `apps/server/src/control-page.ts`**

Add `import type { FleetView, ReleaseStatus } from '@saakshi/core/directory';` and extend the `control-view.ts` import with `commitment, fleetSummary, group, kpis, releaseLines, tileText`. Then append:
```ts
const li = (text: string): HTMLLIElement => { const x = document.createElement('li'); x.textContent = text; return x; };
let lastSummary = '';

async function fleetTick(): Promise<void> {
  try {
    const f = await call<FleetView>('GET', '/v1/fleet');
    $('kpis').replaceChildren(...kpis(f).map((k) => {
      const d = document.createElement('div'), dt = document.createElement('dt'), dd = document.createElement('dd');
      dt.textContent = k.label; dd.textContent = k.value; d.append(dt, dd); return d;
    }));
    $('tiles').replaceChildren(...f.centres.map((t) => {
      const x = tileText(t), item = document.createElement('li');
      item.className = `tile ${t.tone}`;
      item.setAttribute('aria-label', x.aria);
      const title = document.createElement('strong'), line = document.createElement('span'), word = document.createElement('span');
      title.textContent = x.title; line.textContent = x.line; word.textContent = x.word;
      item.append(title, line, word);
      return item;
    }));
    const summary = fleetSummary(f);
    if (summary !== lastSummary) { $('fleet-summary').textContent = summary; lastSummary = summary; }   // the live region speaks only on change
    $('cells').textContent = f.cells.map((c) => `${c.id}: ${c.state === 'DOWN' ? 'down' : c.state.toLowerCase()} · ${c.entries.toLocaleString('en-IN')} entries`).join(' · ');
    const sel = $<HTMLSelectElement>('off-centre');
    if (!sel.options.length) sel.replaceChildren(...f.centres.map((t) => new Option(t.centre, t.centre)));
  } catch (e) { $('fleet-summary').textContent = `Fleet view unavailable: ${(e as Error).message}`; }
}

async function releaseTick(): Promise<void> {
  try {
    const s = await call<ReleaseStatus>('GET', '/v1/release/status');
    $('commitment').replaceChildren(...commitment(s.manifest).map(li));
    $('release').replaceChildren(...releaseLines(s).map(li));
  } catch { $('release').replaceChildren(li('No exam package loaded (control runs without EXAM).')); }
}

$('offline').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const f = new FormData(ev.target as HTMLFormElement);
  try {
    const r = await call<{ centre: string; shift: string; code: string }>('POST', '/v1/release/code', { centre: f.get('centre'), superintendent: f.get('superintendent'), callback: f.get('callback') === 'on' });
    $('off-code').textContent = group(r.code);
    say('off-out', `Read this to the superintendent of ${r.centre} for ${r.shift}. The reveal is logged.`, 'ok');
    void releaseTick();
  } catch (e) { $('off-code').textContent = ''; say('off-out', (e as Error).message, 'bad'); }
});

$('wan').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const up = ((ev as SubmitEvent).submitter as HTMLButtonElement).value === 'true';
  try {
    await call('POST', '/v1/chaos/wan', { up });
    say('wan-out', up ? "Centre 42's link is back." : "Centre 42's link is cut: its relay cannot reach the exam server.", up ? 'ok' : 'bad');
  } catch (e) { say('wan-out', (e as Error).message, 'bad'); }
});

void fleetTick();
void releaseTick();
setInterval(fleetTick, 1000);
setInterval(releaseTick, 2000);
```

- [ ] **Step 6: Replace `apps/server/src/console.html` and append to `apps/server/src/console.ts`**

`apps/server/src/console.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Saakshi · Seat grid</title>
    <style>
      :root { --s-1: .8rem; --s0: 1rem; --s1: 1.25rem; --s2: 1.563rem; --s3: 1.953rem; font-family: system-ui, sans-serif; color: #202124; background: #fff; }
      body { margin: 0; padding: 1rem 1.5rem 2rem; font-size: var(--s0); line-height: 1.5; }
      h1 { font-size: var(--s3); margin: 0 0 .25rem; } h2 { font-size: var(--s2); margin: 1.5rem 0 .5rem; }
      #status { color: #5f6368; margin: 0 0 1rem; }
      #grid { list-style: none; padding: 0; margin: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(12rem, 1fr)); gap: .5rem; }
      .tile { border: 2px solid; border-radius: .5rem; padding: .5rem .75rem; display: grid; gap: .125rem; }
      .tile strong { font-size: var(--s1); }
      .tile span { font-variant-numeric: tabular-nums; font-size: var(--s-1); }
      .tile.ok { border-color: #2e7d32; background: #e6f4ea; }
      .tile.lag { border-color: #b06000; background: #fef7e0; }
      .tile.silent { border-color: #c62828; background: #fce8e6; }
      .legend, .note { color: #5f6368; font-size: var(--s-1); }
      #paper.locked { color: #3c4043; } #paper.released { color: #0d5222; font-weight: 700; }
      form { display: flex; flex-wrap: wrap; gap: .5rem; align-items: end; }
      label { display: grid; gap: .125rem; font-size: var(--s-1); }
      input { font: 700 var(--s1)/1.3 ui-monospace, Menlo, monospace; letter-spacing: .06em; padding: .375rem; min-height: 2.75rem; width: min(100%, 28ch); }
      button { font: inherit; padding: .5rem 1rem; border-radius: .375rem; border: 1px solid #5f6368; background: #fff; color: #202124; cursor: pointer; min-height: 2.75rem; }
      button.primary { background: #1565c0; color: #fff; border-color: #1565c0; }
      button.chaos { background: #b3261e; color: #fff; border-color: #b3261e; }
      .out { font-size: var(--s-1); } .good { color: #1e6b25; } .bad { color: #b3261e; font-weight: 700; }
      :focus-visible { outline: 3px solid #1565c0; outline-offset: 2px; }
      @media (forced-colors: active) { .tile { border-color: CanvasText; } }
    </style>
  </head>
  <body>
    <h1>Seat grid</h1>
    <p id="status">connecting…</p>
    <ul id="grid" aria-label="Seats"></ul>
    <p class="legend">Green: in sync · Amber: seat or cell behind · Red: silent for 30 s or more. Heads are entry counts.</p>

    <h2>Paper</h2>
    <p id="paper" role="status">…</p>
    <form id="offline">
      <label>Code read out by control <input id="code" name="code" autocomplete="off" spellcheck="false" autocapitalize="characters" required /></label>
      <button class="primary">Unlock the paper at this centre</button>
    </form>
    <p class="note">Only when control has phoned this centre's code for this shift. Each seat checks the key against the published commitment before it opens the paper.</p>
    <p id="offline-out" class="out" role="status"></p>

    <h2>DEV chaos</h2>
    <button id="forge" class="chaos">Push a forged key to the seats</button>
    <p class="note">Every seat must reject it: it does not match the published commitment (kc_f).</p>
    <p id="forge-out" class="out" role="status"></p>
    <script type="module" src="./console.ts"></script>
  </body>
</html>
```
The Stage 1 tile classes `ok`/`lag`/`silent` are now scoped as `.tile.ok` etc.; `console.ts` already sets `tile ${tone}`.

Append to `apps/server/src/console.ts` (add `import type { ReleaseMsg } from '@saakshi/core/paper';` and `paperStatus` to the `console-view.ts` import):
```ts
const paper = document.getElementById('paper') as HTMLParagraphElement;
const say = (id: string, text: string, tone: 'good' | 'bad') => { const el = document.getElementById(id)!; el.textContent = text; el.className = `out ${tone}`; };

async function paperTick(): Promise<void> {
  try {
    const r = await fetch('/release/current');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const s = paperStatus(((await r.json()) as { releases: ReleaseMsg[] }).releases);
    paper.textContent = s.text;
    paper.className = s.tone;
  } catch { paper.textContent = 'This relay has no exam package (it runs without EXAM).'; paper.className = 'locked'; }
}

document.getElementById('offline')!.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const code = (document.getElementById('code') as HTMLInputElement).value;
  const r = await fetch('/v1/release/offline', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code }) });
  const j = (await r.json().catch(() => ({}))) as { error?: string };
  say('offline-out', r.ok ? 'Unlocked: the key went to every seat at this centre, and each one checks it against the published commitment.' : (j.error ?? `HTTP ${r.status}`), r.ok ? 'good' : 'bad');
  void paperTick();
});

document.getElementById('forge')!.addEventListener('click', async () => {
  const r = await fetch('/v1/dev/forge', { method: 'POST' });
  say('forge-out', r.ok ? 'A forged key went out. Every seat should say it rejected a key.' : `Not available (HTTP ${r.status}).`, r.ok ? 'good' : 'bad');
});

void paperTick();
setInterval(paperTick, 2000);
```

- [ ] **Step 7: Run the tests and the typecheck**

Run: `bun test --timeout 60000 apps/server/test/control-view.test.ts apps/server/test/console-view.test.ts && pnpm --filter @saakshi/server typecheck`
Expected: PASS; typecheck exits 0.

---

### Task 11: `/custodian` — decrypt the share on the custodian's device, send it sealed to control's release key

**Files:**
- Create: `apps/server/src/custodian.html`, `apps/server/src/custodian-page.ts`, `apps/server/src/custodian-view.ts`
- Test: `apps/server/test/custodian-view.test.ts`

**Interfaces:**
- Consumes: Task 1 (`sealBox`, `openShareFile`, `shareInfo`, `ShareFile`, `ReleaseStatus`, `cellKeyId` in the test); the control routes `/v1/release/key`, `/v1/release/share`, `/v1/release/status` (Task 8; served by Task 16).
- Produces:
  - `custodian-view.ts` (browser-safe, pure): `interface ReleaseKey { exam; shift; keyId; pub }`, `parseShareFile(text): ShareFile`, `shareRequest(f, pass, key): { custodian; keyId; box }` (the plaintext share is wiped before it returns), `statusText(s: ReleaseStatus): string`, `fingerprint(keyId): string`.
  - `custodian.html`, which Task 16 serves at `/custodian` as an HTML import.

- [ ] **Step 1: Write the failing test**

`apps/server/test/custodian-view.test.ts`:
```ts
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { hexToBytes, randomBytes, toHex } from '@saakshi/core/bytes';
import { openBox } from '@saakshi/core/box';
import type { ReleaseStatus } from '@saakshi/core/directory';
import { cellKeyId } from '@saakshi/core/enrol';
import { newKeyPair } from '@saakshi/core/node';
import { sealShareFile, shareInfo } from '@saakshi/core/paper';
import { fingerprint, parseShareFile, shareRequest, statusText } from '../src/custodian-view.ts';

const share = randomBytes(97), pass = 'N5JY1E59BR0FGNVQW';
const file = sealShareFile(share, pass, { exam: 'DEMO-2026', shift: 'S1', custodian: 'NIC' });
const eph = newKeyPair(), key = { exam: 'DEMO-2026', shift: 'S1', keyId: cellKeyId(eph.pub), pub: toHex(eph.pub) };
function typeScaleOk(html: string): boolean {
  const steps = [...html.matchAll(/--s-?\d:\s*([\d.]+)rem/g)].map((m) => Number(m[1])).sort((a, b) => a - b);
  const ratios = steps.slice(1).map((s, i) => s / steps[i]);
  const decls = [...html.matchAll(/font(-size)?:\s*([^;}]+)/g)].map((m) => m[2]);
  return steps.length >= 3 && ratios.every((r) => r >= 1.249) && decls.every((d) => d.trim() === 'inherit' || d.includes('var(--s'));
}

test('the share is decrypted here and leaves only sealed to control\'s release key', () => {
  const req = shareRequest(parseShareFile(JSON.stringify(file)), 'n5jy-1e59 br0f-gnvq-w', key);
  expect([req.custodian, req.keyId]).toEqual(['NIC', key.keyId]);
  expect(req.box.includes(toHex(share))).toBe(false);
  expect(openBox(eph.priv, shareInfo('DEMO-2026', 'S1', 'NIC', key.keyId), hexToBytes(req.box))).toEqual(share);
  expect(() => openBox(newKeyPair().priv, shareInfo('DEMO-2026', 'S1', 'NIC', key.keyId), hexToBytes(req.box))).toThrow();
});

test('clear errors: not a share file, a wrong passphrase, a share for another exam or shift', () => {
  expect(() => parseShareFile('hello')).toThrow(/not a share file/);
  expect(() => parseShareFile('{"v":2}')).toThrow(/not a Saakshi share file/);
  expect(() => shareRequest(file, 'WRONGPASSPHRASE00', key)).toThrow(/wrong passphrase/);
  expect(() => shareRequest(file, pass, { ...key, shift: 'S2' })).toThrow('This share is for DEMO-2026 S1; control is releasing DEMO-2026 S2.');
});

test('status reads plainly, and the fingerprint is grouped for reading aloud', () => {
  const s = { exam: 'DEMO-2026', shift: 'S1', keyId: 'k', custodians: ['NTA', 'NIC', 'OBS'], received: ['NTA'], needed: 2, pushed: {}, zeroised: false, reveals: [] } as unknown as ReleaseStatus;
  expect(statusText(s)).toBe('Control has 1 of 2 shares (NTA). 1 more needed.');
  expect(statusText({ ...s, released: { at: Date.UTC(2026, 8, 27, 4, 30, 3), custodians: ['NTA', 'NIC'], forms: [] } })).toBe('Released at 04:30:03 UTC by NTA + NIC. Thank you.');
  expect(fingerprint('feedfacecafebeef')).toBe('feed face cafe beef');
});

test('the page builds for the browser without Node built-ins or remote scripts, keeps a 1.25 type scale, and renders text safely', async () => {
  const out = await Bun.build({ entrypoints: [join(import.meta.dir, '../src/custodian.html')], target: 'browser', minify: true, throw: false });
  expect(out.success).toBe(true);
  const text = (await Promise.all(out.outputs.map((o) => o.text()))).join('\n');
  expect(text).not.toMatch(/<script[^>]*\ssrc=["']https?:/i);
  expect(text).not.toContain('createPrivateKey');
  const html = readFileSync(join(import.meta.dir, '../src/custodian.html'), 'utf8');
  expect(typeScaleOk(html)).toBe(true);
  expect(readFileSync(join(import.meta.dir, '../src/custodian-page.ts'), 'utf8')).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write|localStorage/);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test --timeout 60000 apps/server/test/custodian-view.test.ts`
Expected: FAIL — `../src/custodian-view.ts` cannot be found.

- [ ] **Step 3: Write the three files**

`apps/server/src/custodian-view.ts`:
```ts
// /custodian logic (browser-safe, pure): decrypt a custodian's share on their own device and seal it to control's in-memory
// release key (protocol Addendum B.4). The plaintext share never leaves shareRequest and is wiped before it returns.
import { hexToBytes, toHex } from '@saakshi/core/bytes';
import { sealBox } from '@saakshi/core/box';
import type { ReleaseStatus } from '@saakshi/core/directory';
import { openShareFile, shareInfo, type ShareFile } from '@saakshi/core/paper';

export interface ReleaseKey { exam: string; shift: string; keyId: string; pub: string }

export function parseShareFile(text: string): ShareFile {
  let f: ShareFile;
  try { f = JSON.parse(text) as ShareFile; } catch { throw new Error('This is not a share file (it is not JSON).'); }
  if (f?.v !== 1 || typeof f.custodian !== 'string' || typeof f.box !== 'string' || typeof f.exam !== 'string' || typeof f.shift !== 'string') throw new Error('This is not a Saakshi share file.');
  return f;
}

export function shareRequest(f: ShareFile, pass: string, k: ReleaseKey): { custodian: string; keyId: string; box: string } {
  if (f.exam !== k.exam || f.shift !== k.shift) throw new Error(`This share is for ${f.exam} ${f.shift}; control is releasing ${k.exam} ${k.shift}.`);
  const share = openShareFile(f, pass);
  try { return { custodian: f.custodian, keyId: k.keyId, box: toHex(sealBox(hexToBytes(k.pub), shareInfo(k.exam, k.shift, f.custodian, k.keyId), share)) }; }
  finally { share.fill(0); }
}

export function statusText(s: ReleaseStatus): string {
  if (s.released) return `Released at ${new Date(s.released.at).toISOString().slice(11, 19)} UTC by ${s.released.custodians.join(' + ')}. Thank you.`;
  const more = Math.max(0, s.needed - s.received.length);
  return `Control has ${s.received.length} of ${s.needed} shares${s.received.length ? ` (${s.received.join(', ')})` : ''}.${more ? ` ${more} more needed.` : ''}`;
}

export const fingerprint = (keyId: string): string => keyId.replace(/(.{4})(?=.)/g, '$1 ');
```

`apps/server/src/custodian.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Saakshi · Custodian</title>
    <style>
      :root { --s-1: .8rem; --s0: 1rem; --s1: 1.25rem; --s2: 1.563rem; --s3: 1.953rem; --ink: #202124; --muted: #5f6368; --blue: #1565c0;
        font-family: system-ui, sans-serif; color: var(--ink); background: #fff; }
      body { margin: 0 auto; padding: 1.5rem; max-width: 42rem; font-size: var(--s0); line-height: 1.5; }
      h1 { font-size: var(--s3); margin: 0 0 .5rem; } h2 { font-size: var(--s1); margin: 1.5rem 0 .5rem; }
      .fp { font: 700 var(--s2)/1.3 ui-monospace, Menlo, monospace; letter-spacing: .06em; margin: .25rem 0; }
      form { display: grid; gap: 1rem; }
      label { display: grid; gap: .25rem; font-weight: 600; }
      input { font: inherit; padding: .5rem; min-height: 2.75rem; border: 1px solid var(--muted); border-radius: .375rem; }
      button { font: inherit; font-weight: 700; padding: .625rem 1rem; min-height: 2.75rem; border-radius: .375rem; border: 1px solid var(--blue); background: var(--blue); color: #fff; cursor: pointer; justify-self: start; }
      .hint { color: var(--muted); font-size: var(--s-1); font-weight: 400; }
      #result { font-size: var(--s1); font-weight: 700; } #result.good { color: #1e6b25; }
      #error { color: #b3261e; font-weight: 700; }
      :focus-visible { outline: 3px solid var(--blue); outline-offset: 2px; }
    </style>
  </head>
  <body>
    <h1>Custodian — release the paper</h1>
    <p>Your share is decrypted <strong>on this computer</strong> and sent to control sealed to its release key; control never stores it. The paper opens only when two of the three custodians (NTA, NIC and the independent observer) have sent theirs.</p>
    <h2>1. Check control's release key</h2>
    <p class="fp" id="fp">…</p>
    <p class="hint">Read these 16 characters to control by phone. Send your share only if they match.</p>
    <h2>2. Send your share</h2>
    <form id="form">
      <label>Your share file <input id="file" type="file" accept=".json,application/json" required /></label>
      <label>Your passphrase <span class="hint">17 characters; dashes and spaces are ignored</span>
        <input id="pass" type="password" autocomplete="off" spellcheck="false" required /></label>
      <button>Decrypt here and send to control</button>
    </form>
    <p id="error" role="alert"></p>
    <h2>3. Status</h2>
    <p id="result" role="status">…</p>
    <script type="module" src="./custodian-page.ts"></script>
  </body>
</html>
```

`apps/server/src/custodian-page.ts`:
```ts
import type { ReleaseStatus } from '@saakshi/core/directory';
import { fingerprint, parseShareFile, shareRequest, statusText, type ReleaseKey } from './custodian-view.ts';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
let key: ReleaseKey | undefined;
async function get<T>(path: string): Promise<T> { const r = await fetch(path); if (!r.ok) throw new Error(`control answered ${r.status}`); return (await r.json()) as T; }
const show = (s: ReleaseStatus) => { $('result').textContent = statusText(s); $('result').className = s.released ? 'good' : ''; };

async function refresh(): Promise<void> {
  try {
    key ??= await get<ReleaseKey>('/v1/release/key');
    $('fp').textContent = fingerprint(key.keyId);
    show(await get<ReleaseStatus>('/v1/release/status'));
  } catch (e) { $('result').textContent = `Cannot reach control: ${(e as Error).message}`; }
}

$('form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  $('error').textContent = '';
  const pass = $<HTMLInputElement>('pass');
  try {
    if (!key) throw new Error("Control's release key is not loaded yet.");
    const file = $<HTMLInputElement>('file').files?.[0];
    if (!file) throw new Error('Choose your share file.');
    const body = shareRequest(parseShareFile(await file.text()), pass.value, key);
    const r = await fetch('/v1/release/share', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const j = (await r.json().catch(() => ({}))) as ReleaseStatus & { error?: string };
    if (r.status === 409 && !j.received) key = undefined;                          // control restarted: a new release key
    if (!r.ok) throw new Error(j.error ?? `control answered ${r.status}`);
    show(j);
  } catch (e) { $('error').textContent = (e as Error).message; }
  finally { pass.value = ''; }
});

void refresh();
setInterval(refresh, 2000);
```

- [ ] **Step 4: Run the test**

Run: `bun test --timeout 60000 apps/server/test/custodian-view.test.ts && pnpm --filter @saakshi/server typecheck`
Expected: PASS (4 tests); typecheck exits 0.

---

### Task 12: Seat identity — the seat's own key, enrolment, provisional binding

**Files:**
- Create: `apps/seat/src/main/identity.ts`
- Test: `apps/seat/test/identity.test.ts`

**Interfaces:**
- Consumes: Task 1 (`attestHash`, `checkWireBind`, `GATE_METHODS`, `isPin`, `makeBindReq`, `pinRecord`, `Bind`, `BindReq`, `GateMethod`, `WireBind`, `nativeBox`, `newKeyPair`, `verifier`, `writeDurable`, `BindState`, `EnrolResult`).
- Produces:
  - `type Post = (path: string, body: unknown) => Promise<{ status: number; body: Record<string, unknown> }>`; `httpPost(relayUrl, timeoutMs = 5000, f = fetch): Post`.
  - `class SeatIdentity` — `static open(o: IdentityOpts)`, getters `key: KeyPair | undefined`, `bind: WireBind | undefined`, `state: BindState`, field `error: string`, `enrol(pin, gate: { operatorId; method }): Promise<EnrolResult>`, `retry(): Promise<BindState>`.
  - `IdentityOpts { path; ctx: Ctx; seatId; wrap: Wrapper; cell: { id; pub }; post: Post; now? }` — `cell` is the key the **signed policy** pins.
  - Rules: one key per (seat, candidate), made once and saved wrapped **before** it is sent; the relay's 200 is accepted only if the certificate verifies under the pinned cell key and every field is this seat's request; 202 → provisional (retried); 409/400 → refused (kept, not retried).

- [ ] **Step 1: Write the failing test**

`apps/seat/test/identity.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { toHex, utf8 } from '@saakshi/core/bytes';
import { canon } from '@saakshi/core/canon';
import { cellKey, DEV_EXAM, type KeysFile } from '@saakshi/core/dev';
import { bindArray, checkPin, openPinBox, type BindReq, type WireBind } from '@saakshi/core/enrol';
import { nativeBox, newKeyPair, signer } from '@saakshi/core/node';
import { SeatIdentity, type Post } from '../src/main/identity.ts';
import type { Wrapper } from '../src/main/journal-store.ts';

const keys = JSON.parse(readFileSync(new URL('../../../fixtures/keys.json', import.meta.url), 'utf8')) as KeysFile;
const cell = cellKey(keys, 'cell-1'), cell2 = cellKey(keys, 'cell-2');
const wrap: Wrapper = { encryptString: (s) => Buffer.from(s).reverse(), decryptString: (b) => Buffer.from(b).reverse().toString() };
const ctx = { ...DEV_EXAM, cand: 'C0001' };
const gate = { operatorId: 'GATE-42-OP7', method: 'aadhaar-face' as const };

/** The relay (and the cell behind it) as the seat sees them. */
function relay(mode: { down?: boolean; lose?: boolean; refuse?: boolean; tamper?: 'otherPub' | 'otherCell' | 'badSig' } = {}) {
  const issued = new Map<string, WireBind>(), seen: BindReq[] = [];
  const sign = signer(mode.tamper === 'otherCell' ? cell2 : cell);
  const post: Post = async (_path, body) => {
    const req = body as BindReq;
    seen.push(req);
    if (mode.down) return { status: 202, body: { provisional: true, reason: 'the centre has no WAN link' } };
    if (mode.refuse) return { status: 409, body: { error: 'C0001 is already bound to another seat — call the invigilator', code: 'ALREADY_BOUND' } };
    let wb = issued.get(req.cand);
    if (!wb) {
      const cert = canon(bindArray(mode.tamper === 'otherPub' ? { ...req, pub: toHex(newKeyPair().pub) } : req));
      wb = { cert, sig: mode.tamper === 'badSig' ? '0'.repeat(128) : toHex(sign(utf8(cert))), cell: 'cell-1', pinBox: req.pinBox };
      issued.set(req.cand, wb);
    }
    if (mode.lose) { mode.lose = false; throw new Error('socket hang up'); }        // the cell signed, but the answer never arrived
    return { status: 200, body: { bind: wb } };
  };
  return { post, seen, issued, mode };
}
const open = (post: Post, path = join(mkdtempSync(join(tmpdir(), 'saakshi-id-')), 'C0001.identity')) =>
  SeatIdentity.open({ path, ctx, seatId: 'CEN042-S01', wrap, cell: { id: 'cell-1', pub: cell.pub }, post, now: () => 1_790_000_000_000 });

test('enrol: bound with a verified certificate; only the cell can read the PIN; the key is saved wrapped and reopens offline', async () => {
  const path = join(mkdtempSync(join(tmpdir(), 'saakshi-id-')), 'C0001.identity');
  const r = relay(), id = open(r.post, path);
  assert.equal(id.state, 'none');
  assert.deepEqual(await id.enrol('482913', gate), { ok: true, bind: 'bound' });
  assert.deepEqual(id.bind, r.issued.get('C0001'));
  const req = r.seen[0];
  assert.equal(req.pub, toHex(id.key!.pub));
  assert.equal(checkPin(openPinBox(cell.priv, req, nativeBox), '482913'), true);
  assert.equal(JSON.stringify(req).includes('482913'), false);
  assert.equal(readFileSync(path, 'utf8').includes(toHex(id.key!.priv)), false);
  const again = open(async () => { throw new Error('offline'); }, path);
  assert.equal(again.state, 'bound');
  assert.deepEqual(again.key, id.key);
});

test('no WAN at check-in: provisional; the retry ratifies it with the same saved request', async () => {
  const r = relay({ down: true }), id = open(r.post);
  assert.deepEqual(await id.enrol('482913', gate), { ok: true, bind: 'provisional' });
  assert.match(id.error, /WAN/);
  r.mode.down = false;
  assert.equal(await id.retry(), 'bound');
  assert.equal(r.seen.length, 2);
  assert.deepEqual(r.seen[0], r.seen[1]);
});

test('Review Focus #2: a lost response — the retry gets the same certificate; enrolling again never makes a second key', async () => {
  const r = relay({ lose: true }), id = open(r.post);
  assert.deepEqual(await id.enrol('482913', gate), { ok: true, bind: 'provisional' });
  assert.equal(await id.retry(), 'bound');
  assert.deepEqual(id.bind, r.issued.get('C0001'));
  const pub = toHex(id.key!.pub);
  assert.deepEqual(await id.enrol('111111', gate), { ok: true, bind: 'bound' });
  assert.equal(toHex(id.key!.pub), pub);
  assert.equal(new Set(r.seen.map((s) => s.pub)).size, 1);
});

test('a certificate for another key, from another cell, or with a bad signature is rejected; the seat stays provisional', async () => {
  for (const tamper of ['otherPub', 'otherCell', 'badSig'] as const) {
    const id = open(relay({ tamper }).post);
    assert.deepEqual(await id.enrol('482913', gate), { ok: true, bind: 'provisional' });
    assert.match(id.error, /rejected/);
    assert.equal(id.bind, undefined);
  }
});

test('refused (already bound): the reason is kept and it is not retried', async () => {
  const r = relay({ refuse: true }), id = open(r.post);
  assert.deepEqual(await id.enrol('482913', gate), { ok: true, bind: 'refused' });
  assert.match(id.error, /already bound/);
  assert.equal(await id.retry(), 'refused');
  assert.equal(r.seen.length, 1);
});

test('the PIN and the gate check are validated before any key is made', async () => {
  const r = relay(), id = open(r.post);
  const bad = async (pin: string, g: { operatorId: string; method: string }) => ((await id.enrol(pin, g as typeof gate)) as { error: string }).error;
  assert.match(await bad('12345', gate), /6 digits/);
  assert.match(await bad('123456', { ...gate, operatorId: '  ' }), /operator/);
  assert.match(await bad('123456', { ...gate, method: 'palm-reading' }), /identity/);
  assert.equal(id.state, 'none');
  assert.equal(r.seen.length, 0);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test apps/seat/test/identity.test.ts`
Expected: FAIL — `../src/main/identity.ts` cannot be found.

- [ ] **Step 3: Write `apps/seat/src/main/identity.ts`**

```ts
// The seat's key and its binding (plan §3.2). The key is made here, never leaves, and is saved wrapped by the OS keystore (or
// the DEV test keystore) before anything is sent. Enrolment goes seat → relay → cell; the relay never sees the PIN, which travels
// sealed to the cell. With no WAN the binding is provisional: the seat retries until the cell ratifies it.
import { existsSync, readFileSync } from 'node:fs';
import { hexToBytes, toHex } from '@saakshi/core/bytes';
import { attestHash, checkWireBind, GATE_METHODS, isPin, makeBindReq, pinRecord, type Bind, type BindReq, type GateMethod, type WireBind } from '@saakshi/core/enrol';
import { nativeBox, newKeyPair, verifier, type KeyPair } from '@saakshi/core/node';
import type { Ctx } from '@saakshi/core/protocol';
import type { BindState, EnrolResult } from '../shared/ipc.ts';
import { writeDurable, type Wrapper } from './journal-store.ts';

export type Post = (path: string, body: unknown) => Promise<{ status: number; body: Record<string, unknown> }>;
export function httpPost(relayUrl: string, timeoutMs = 5000, f: typeof fetch = fetch): Post {
  return async (path, body) => {
    const r = await f(new URL(path, relayUrl), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
    return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, unknown> };
  };
}

export interface IdentityOpts {
  path: string; ctx: Ctx; seatId: string; wrap: Wrapper;
  /** The cell key the signed policy pins: the only key a bind certificate may be signed with. */
  cell: { id: string; pub: Uint8Array };
  post: Post; now?: () => number;
}
interface Saved { priv: string; pub: string; req: BindReq; bind?: WireBind; refused?: string }
const FIELDS = ['exam', 'shift', 'attempt', 'cand', 'seatId', 'pub', 'keyEpoch', 'fromSeq', 'attestHash'] as const;

export class SeatIdentity {
  error = '';
  #o: IdentityOpts;
  #s?: Saved;

  private constructor(o: IdentityOpts) { this.#o = o; }
  static open(o: IdentityOpts): SeatIdentity {
    const id = new SeatIdentity(o);
    if (existsSync(o.path)) id.#s = JSON.parse(o.wrap.decryptString(readFileSync(o.path))) as Saved;
    if (id.#s?.refused) id.error = id.#s.refused;
    return id;
  }

  get key(): KeyPair | undefined { return this.#s && { priv: hexToBytes(this.#s.priv), pub: hexToBytes(this.#s.pub) }; }
  get bind(): WireBind | undefined { return this.#s?.bind; }
  get state(): BindState { return !this.#s ? 'none' : this.#s.bind ? 'bound' : this.#s.refused ? 'refused' : 'provisional'; }

  async enrol(pin: string, gate: { operatorId: string; method: GateMethod }): Promise<EnrolResult> {
    if (this.#s) return { ok: true, bind: await this.retry() };                   // one key per seat and candidate: never a second
    if (!isPin(pin)) return { ok: false, error: 'The PIN must be exactly 6 digits.' };
    const operatorId = gate.operatorId.trim();
    if (!operatorId || operatorId.length > 64) return { ok: false, error: "Enter the gate operator's ID." };
    if (!(GATE_METHODS as readonly string[]).includes(gate.method)) return { ok: false, error: 'Choose how the gate checked identity.' };
    const k = newKeyPair(), c = this.#o.ctx;
    const b: Bind = { ...c, seatId: this.#o.seatId, pub: toHex(k.pub), keyEpoch: 1, fromSeq: 0,
      attestHash: attestHash({ exam: c.exam, shift: c.shift, operatorId, time: (this.#o.now ?? Date.now)(), method: gate.method, cand: c.cand }) };
    // Saved before it is sent: after a crash or a lost answer, the retry sends the same key and gets the same certificate.
    this.#save({ priv: toHex(k.priv), pub: toHex(k.pub), req: makeBindReq(b, this.#o.cell.pub, pinRecord(pin), nativeBox) });
    return { ok: true, bind: await this.retry() };
  }

  /** Send (or resend) the saved request: 200 bound, 202 provisional, 409/400 refused. */
  async retry(): Promise<BindState> {
    const s = this.#s;
    if (!s || s.bind || s.refused) return this.state;
    let r;
    try { r = await this.#o.post('/v1/enrol', s.req); }
    catch (e) { this.error = `the centre server did not answer: ${(e as Error).message}`; return this.state; }
    if (r.status === 200) {
      const wb = r.body.bind as WireBind;
      try { this.#check(wb); } catch (e) { this.error = `the exam server's certificate was rejected: ${(e as Error).message}`; return this.state; }
      this.error = '';
      this.#save({ ...s, bind: wb });
    } else if (r.status === 409 || r.status === 400) {
      this.error = String(r.body.error ?? `refused (${r.status})`);
      this.#save({ ...s, refused: this.error });
    } else this.error = String(r.body.reason ?? r.body.error ?? `the centre server answered ${r.status}`);
    return this.state;
  }

  #check(wb: WireBind): void {
    const got = checkWireBind(wb, this.#o.cell.pub, verifier);
    if (wb.cell !== this.#o.cell.id) throw new Error(`signed by ${wb.cell}, not ${this.#o.cell.id}`);
    for (const f of FIELDS) if (got[f] !== this.#s!.req[f]) throw new Error(`its ${f} is not this seat's`);
  }
  #save(s: Saved): void { writeDurable(this.#o.path, this.#o.wrap.encryptString(JSON.stringify(s))); this.#s = s; }
}
```

- [ ] **Step 4: Run the test**

Run: `node --test apps/seat/test/identity.test.ts && pnpm --filter @saakshi/seat typecheck`
Expected: PASS (6 tests); typecheck exits 0.

---

### Task 13: Seat package and release — verify the package, accept a key only through kc_f, SSE with a pull fallback

**Files:**
- Create: `apps/seat/src/main/pkg.ts`, `apps/seat/src/main/release.ts`
- Test: `apps/seat/test/pkg.test.ts`, `apps/seat/test/release.test.ts`

**Interfaces:**
- Consumes: Task 1 (`openPolicy`, `checkManifest`, `ciphertextHash`, `checkRelease`, `openPaper`, `parseReleaseMsg`, `ReleaseMsg`, `Paper`, `writeDurable`, `fromB64`, `verifier`); Task 4 (`buildPackage`, in the tests).
- Produces:
  - `pkg.ts`: `interface PackageWire { policy; manifest; paper: Record<string, string /* base64 */> }`, `interface SeatPackage { policy: Policy; manifest: Manifest; papers: Record<string, Uint8Array> }`, `verifyPackage(raw, authorityPub, want: { exam; shift; cand }): SeatPackage` (throws), `loadPackage({ path, relayUrl, authorityPub, want, fetch? }): Promise<SeatPackage>` — disk first (re-verified), else the relay; saved only after it verifies.
  - `release.ts`: `acceptRelease(r, pkg, form, authorityPub): { ok: true; key; paper: Paper } | { ok: false; error }` — B.7 then decrypt; `parseSse(buf): { events: SseEvent[]; rest }`; `class ReleaseWatcher({ relayUrl, onRelease, fetch?, retryMs?, onError? })` with `start()`, `stop()`, `pull()`. It pulls `GET /release/current`, then listens on `GET /v1/release/events` (sending `Last-Event-ID`), and on any drop pulls again and reconnects. **It only ever calls `relayUrl`.**

- [ ] **Step 1: Write the failing tests**

Shared fixture at the top of both test files:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { hexToBytes, randomBytes, toHex, utf8 } from '@saakshi/core/bytes';
import { combineBundle } from '@saakshi/core/custody';
import type { KeysFile } from '@saakshi/core/dev';
import type { Directory } from '@saakshi/core/directory';
import { msg } from '@saakshi/core/enrol';
import { newKeyPair, signer } from '@saakshi/core/node';
import { manifestArray, openShareFile, releaseArray, type ReleaseMsg } from '@saakshi/core/paper';
import { signPolicy } from '@saakshi/core/policy';
import { toB64 } from '@saakshi/core/wire';
import type { PackageWire } from '../src/main/pkg.ts';
import { buildPackage } from '../../../tools/package.ts';

const keys = JSON.parse(readFileSync(new URL('../../../fixtures/keys.json', import.meta.url), 'utf8')) as KeysFile;
const fx = (f: string) => JSON.parse(readFileSync(new URL(`../../../fixtures/paper/${f}`, import.meta.url), 'utf8'));
const authority = { priv: hexToBytes(keys.authority.priv), pub: hexToBytes(keys.authority.pub) };
const want = { exam: 'DEMO-2026', shift: 'S1', cand: 'C0001' };
const dir = { v: 1, exam: 'DEMO-2026', shift: 'S1', durationMs: 1, demoCentre: 'CEN042', issuedAt: 0, cells: [], cands: {}, centres: { CEN042: { cell: 'cell-1' } } } as unknown as Directory;
async function fixture(): Promise<{ w: PackageWire; K: { kF1: Uint8Array; kF2: Uint8Array } }> {
  const p = await buildPackage(dir, { bank: fx('bank.json'), forms: fx('forms.json') }, authority);
  const K = await combineBundle([openShareFile(p.shares.NTA, p.passphrases.NTA), openShareFile(p.shares.NIC, p.passphrases.NIC)]);
  const policy = signPolicy({ v: 1, exam: 'DEMO-2026', shift: 'S1', centre: 'CEN042', cell: { id: 'cell-1', keyId: 'k', pub: keys.cells[0].pub }, durationMs: 1_800_000,
    roster: { C0001: { form: 'F1', extraMs: 0, pseud: '7'.repeat(64) } }, issuedAt: 0 }, signer(authority));
  return { w: { policy, manifest: p.manifest, paper: { F1: toB64(p.papers.F1), F2: toB64(p.papers.F2) } }, K };
}
function signedRelease(w: PackageWire, form: 'F1' | 'F2', key: Uint8Array): ReleaseMsg {
  const r = { exam: 'DEMO-2026', shift: 'S1', form, kcf: w.manifest.manifest.forms.find((f) => f.form === form)!.kcf, ts: 5 };
  return { ...r, key: toHex(key), sig: toHex(signer(authority)(msg(releaseArray(r)))), via: 'push' };
}
const until = async (ok: () => boolean) => { for (let i = 0; i < 300 && !ok(); i++) await new Promise((r) => setTimeout(r, 10)); assert.equal(ok(), true); };
```
(`pkg.test.ts` needs only `fixture` and `want`; import what each file uses.)

`apps/seat/test/pkg.test.ts` (add `existsSync`, `mkdtempSync`, `tmpdir`, `join` and `loadPackage, verifyPackage`):
```ts
test('a signed package verifies; the paper stays ciphertext until a key arrives', async () => {
  const { w } = await fixture();
  const pkg = verifyPackage(w, authority.pub, want);
  assert.equal(pkg.policy.centre, 'CEN042');
  assert.deepEqual(pkg.manifest.forms.map((f) => f.form), ['F1', 'F2']);
  assert.equal(Buffer.from(pkg.papers.F1).includes(Buffer.from('SI unit')), false);
});

test('the seat rejects an unsigned or altered policy, a manifest signed by a stranger, a paper that is not the committed one, and a candidate not on the roster', async () => {
  const { w } = await fixture();
  assert.throws(() => verifyPackage({ ...w, policy: { text: w.policy.text, sig: '' } }, authority.pub, want), /not signed/);
  assert.throws(() => verifyPackage({ ...w, policy: { ...w.policy, text: w.policy.text.replace('1800000', '9999999') } }, authority.pub, want), /does not verify/);
  const forged = { ...w.manifest, sig: toHex(signer(newKeyPair())(msg(manifestArray(w.manifest.manifest)))) };
  assert.throws(() => verifyPackage({ ...w, manifest: forged }, authority.pub, want), /manifest signature/);
  assert.throws(() => verifyPackage({ ...w, paper: { ...w.paper, F1: w.paper.F2 } }, authority.pub, want), /not the one the manifest commits to/);
  assert.throws(() => verifyPackage(w, authority.pub, { ...want, cand: 'C0999' }), /not on CEN042's roster/);
});

test('loadPackage saves only a verified package, then works with no relay', async () => {
  const { w } = await fixture();
  const path = join(mkdtempSync(join(tmpdir(), 'saakshi-pkg-')), 'p.json');
  let calls = 0;
  const serve = (body: unknown) => (async (url: URL) => { calls++; assert.equal(String(url), 'http://relay:7070/v1/package'); return Response.json(body); }) as unknown as typeof fetch;
  await assert.rejects(loadPackage({ path, relayUrl: 'http://relay:7070', authorityPub: authority.pub, want, fetch: serve({ ...w, policy: { ...w.policy, sig: '' } }) }), /not signed/);
  assert.equal(existsSync(path), false);
  await loadPackage({ path, relayUrl: 'http://relay:7070', authorityPub: authority.pub, want, fetch: serve(w) });
  const offline = (async () => { throw new Error('offline'); }) as unknown as typeof fetch;
  assert.equal((await loadPackage({ path, relayUrl: 'http://relay:7070', authorityPub: authority.pub, want, fetch: offline })).policy.centre, 'CEN042');
  assert.equal(calls, 2);
});
```

`apps/seat/test/release.test.ts` (add `acceptRelease, parseSse, ReleaseWatcher` from `../src/main/release.ts`, `verifyPackage` from `../src/main/pkg.ts`, and `type Paper` from `../src/shared/ipc.ts`):
```ts
test('exit check — kc_f on both paths: the pushed release and the phoned-code key open the paper; a key off kc_f, a forged signature or another form are refused', async () => {
  const { w, K } = await fixture();
  const pkg = verifyPackage(w, authority.pub, want);
  const push = signedRelease(w, 'F1', K.kF1), code: ReleaseMsg = { ...push, sig: '', via: 'code' };
  const ok = acceptRelease(push, pkg, 'F1', authority.pub);
  assert.deepEqual((ok as { paper: Paper }).paper.items.map((i) => i.id), fx('forms.json').F1);
  assert.equal(acceptRelease(code, pkg, 'F1', authority.pub).ok, true);
  for (const bad of [{ ...push, key: toHex(randomBytes(32)) }, { ...code, key: toHex(randomBytes(32)) }])
    assert.match((acceptRelease(bad, pkg, 'F1', authority.pub) as { error: string }).error, /kc_f/);
  assert.match((acceptRelease({ ...push, ts: 6 }, pkg, 'F1', authority.pub) as { error: string }).error, /signature/);
  assert.equal(acceptRelease(push, pkg, 'F2', authority.pub).ok, false);
});

test('parseSse: frames split across chunks, comments and bare retry lines skipped, ids and event names kept', () => {
  const a = parseSse('retry: 2000\n\nid: b-1\nevent: snapshot\ndata: {"releases":[]}\n\n:ping\n\nid: b-2\nevent: rel');
  assert.deepEqual(a.events, [{ id: 'b-1', event: 'snapshot', data: '{"releases":[]}' }]);
  assert.deepEqual(parseSse(a.rest + 'ease\ndata: {"x":1}\n\n'), { events: [{ id: 'b-2', event: 'release', data: '{"x":1}' }], rest: '' });
});

test('the watcher pulls /release/current, listens on SSE, and reconnects with Last-Event-ID — only ever to its relay', async () => {
  const { w, K } = await fixture();
  const r = signedRelease(w, 'F1', K.kF1);
  const calls: { url: string; lastId: string | null }[] = [];
  let ctl: ReadableStreamDefaultController<Uint8Array> | undefined;
  const f = (async (url: URL, init?: RequestInit) => {
    calls.push({ url: String(url), lastId: new Headers(init?.headers).get('last-event-id') });
    if (String(url).endsWith('/release/current')) return Response.json({ releases: [] });
    return new Response(new ReadableStream<Uint8Array>({ start(c) { ctl = c; } }), { headers: { 'content-type': 'text/event-stream' } });
  }) as unknown as typeof fetch;
  const got: ReleaseMsg[] = [];
  const watcher = new ReleaseWatcher({ relayUrl: 'http://relay:7070', fetch: f, retryMs: 10, onRelease: (x) => got.push(x) });
  watcher.start();
  await until(() => !!ctl);
  ctl!.enqueue(utf8(`id: b-3\nevent: release\ndata: ${JSON.stringify(r)}\n\n`));
  await until(() => got.length === 1);
  ctl!.close(); ctl = undefined;                                                    // the relay restarts
  await until(() => !!ctl);
  watcher.stop(); ctl!.close();
  assert.deepEqual(calls.map((c) => c.url), ['http://relay:7070/release/current', 'http://relay:7070/v1/release/events', 'http://relay:7070/release/current', 'http://relay:7070/v1/release/events']);
  assert.deepEqual(calls.map((c) => c.lastId), [null, null, null, 'b-3']);
  assert.deepEqual(got, [r]);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test apps/seat/test/pkg.test.ts apps/seat/test/release.test.ts`
Expected: FAIL — `../src/main/pkg.ts` and `../src/main/release.ts` cannot be found.

- [ ] **Step 3: Write `apps/seat/src/main/pkg.ts`**

```ts
// The paper package a seat takes from its relay at T−1 h (plan §3.3): the signed policy, the signed manifest (the public
// commitment) and the paper ciphertexts. Everything is checked against the exam authority's key built into the app, and a seat
// never runs on an unsigned policy. Nothing here is readable before T0.
import { existsSync, readFileSync } from 'node:fs';
import { verifier } from '@saakshi/core/node';
import { checkManifest, ciphertextHash, type Manifest, type SignedManifest } from '@saakshi/core/paper';
import { openPolicy, type Policy, type SignedPolicy } from '@saakshi/core/policy';
import { fromB64 } from '@saakshi/core/wire';
import { writeDurable } from './journal-store.ts';

export interface PackageWire { policy: SignedPolicy; manifest: SignedManifest; paper: Record<string, string> }
export interface SeatPackage { policy: Policy; manifest: Manifest; papers: Record<string, Uint8Array> }

export function verifyPackage(raw: unknown, authorityPub: Uint8Array, want: { exam: string; shift: string; cand: string }): SeatPackage {
  const w = raw as PackageWire;
  const authority = verifier(authorityPub);
  const policy = openPolicy(w?.policy, authority, want);
  const manifest = checkManifest(w.manifest, authority);
  if (manifest.exam !== want.exam || manifest.shift !== want.shift) throw new Error(`the manifest is for ${manifest.exam} ${manifest.shift}`);
  const papers: Record<string, Uint8Array> = {};
  for (const f of manifest.forms) {
    const b64 = w.paper?.[f.form];
    if (typeof b64 !== 'string') throw new Error(`the package has no paper for ${f.form}`);
    papers[f.form] = fromB64(b64);
    if (ciphertextHash(papers[f.form]) !== f.ciphertextHash) throw new Error(`the ${f.form} paper is not the one the manifest commits to`);
  }
  const me = policy.roster[want.cand];
  if (!me) throw new Error(`${want.cand} is not on ${policy.centre}'s roster`);
  if (!papers[me.form]) throw new Error(`the manifest has no form ${me.form}`);
  return { policy, manifest, papers };
}

export async function loadPackage(o: { path: string; relayUrl: string; authorityPub: Uint8Array; want: { exam: string; shift: string; cand: string }; fetch?: typeof fetch }): Promise<SeatPackage> {
  if (existsSync(o.path)) return verifyPackage(JSON.parse(readFileSync(o.path, 'utf8')), o.authorityPub, o.want);
  const r = await (o.fetch ?? fetch)(new URL('/v1/package', o.relayUrl), { signal: AbortSignal.timeout(5000) });
  if (!r.ok) throw new Error(`the centre server answered ${r.status}`);
  const text = await r.text();
  const pkg = verifyPackage(JSON.parse(text), o.authorityPub, o.want);
  writeDurable(o.path, new TextEncoder().encode(text));                           // only a package that verified is kept
  return pkg;
}
```

- [ ] **Step 4: Write `apps/seat/src/main/release.ts`**

```ts
// The paper key at T0 (plan §3.3). The seat listens to its relay over SSE and falls back to pulling /release/current; it never
// talks to the national cells. Every key — pushed by control or unlocked at the centre with the phoned code — must match kc_f in
// the signed manifest before the paper opens (protocol Addendum B.7).
import { verifier } from '@saakshi/core/node';
import { checkRelease, openPaper, parseReleaseMsg, type ReleaseMsg } from '@saakshi/core/paper';
import type { Paper } from '../shared/ipc.ts';
import type { SeatPackage } from './pkg.ts';

export type Accepted = { ok: true; key: Uint8Array; paper: Paper } | { ok: false; error: string };
export function acceptRelease(r: ReleaseMsg, pkg: SeatPackage, form: string, authorityPub: Uint8Array): Accepted {
  const c = checkRelease(r, pkg.manifest, form, verifier(authorityPub));
  if (!c.ok) return c;
  let paper: Paper;
  try { paper = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(openPaper(c.key, { exam: pkg.manifest.exam, shift: pkg.manifest.shift, form }, pkg.papers[form]))) as Paper; }
  catch { return { ok: false, error: 'the key matches kc_f but does not open the paper' }; }
  if (paper.form !== form || !Array.isArray(paper.items) || !paper.items.every((i) => typeof i?.id === 'string' && !!i.en && !!i.hi)) return { ok: false, error: 'the paper is malformed' };
  return { ok: true, key: c.key, paper };
}

export interface SseEvent { id: string; event: string; data: string }
/** Split an SSE text buffer into complete events; returns the incomplete rest. Comments (":ping") and data-less blocks are skipped. */
export function parseSse(buf: string): { events: SseEvent[]; rest: string } {
  const blocks = buf.split(/\r?\n\r?\n/);
  const rest = blocks.pop() ?? '';
  const events: SseEvent[] = [];
  for (const b of blocks) {
    const e: SseEvent = { id: '', event: 'message', data: '' }, data: string[] = [];
    for (const line of b.split(/\r?\n/)) {
      if (!line || line.startsWith(':')) continue;
      const i = line.indexOf(':'), k = i < 0 ? line : line.slice(0, i), v = i < 0 ? '' : line.slice(i + 1).replace(/^ /, '');
      if (k === 'id') e.id = v; else if (k === 'event') e.event = v; else if (k === 'data') data.push(v);
    }
    if (data.length) { e.data = data.join('\n'); events.push(e); }
  }
  return { events, rest };
}

export interface WatchOpts { relayUrl: string; onRelease: (r: ReleaseMsg) => void; fetch?: typeof fetch; retryMs?: number; onError?: (e: string) => void }
export class ReleaseWatcher {
  #o: WatchOpts;
  #stopped = false;
  #ctl?: AbortController;
  #lastId = '';

  constructor(o: WatchOpts) { this.#o = o; }
  start(): void { void this.#loop(); }
  stop(): void { this.#stopped = true; this.#ctl?.abort(); }

  /** The pull fallback: GET /release/current on the relay. */
  async pull(): Promise<void> {
    const r = await (this.#o.fetch ?? fetch)(new URL('/release/current', this.#o.relayUrl), { signal: AbortSignal.timeout(5000) });
    if (!r.ok) throw new Error(`/release/current answered ${r.status}`);
    this.#deliver(((await r.json()) as { releases?: unknown[] }).releases);
  }

  #deliver(xs: unknown[] | undefined): void {
    for (const x of xs ?? []) {
      let r: ReleaseMsg;
      try { r = parseReleaseMsg(x); } catch { continue; }                          // malformed: ignored; the seat acts only on keys that verify
      this.#o.onRelease(r);
    }
  }

  async #loop(): Promise<void> {
    while (!this.#stopped) {
      try { await this.pull(); } catch (e) { this.#o.onError?.((e as Error).message); }
      if (this.#stopped) return;
      try {
        this.#ctl = new AbortController();
        const r = await (this.#o.fetch ?? fetch)(new URL('/v1/release/events', this.#o.relayUrl), { headers: this.#lastId ? { 'last-event-id': this.#lastId } : {}, signal: this.#ctl.signal });
        if (!r.ok || !r.body) throw new Error(`/v1/release/events answered ${r.status}`);
        const dec = new TextDecoder();
        let buf = '';
        for await (const chunk of r.body as unknown as AsyncIterable<Uint8Array>) {
          const p = parseSse(buf + dec.decode(chunk, { stream: true }));
          buf = p.rest;
          for (const e of p.events) {
            if (e.id) this.#lastId = e.id;
            const d = JSON.parse(e.data) as { releases?: unknown[] };
            if (e.event === 'snapshot') this.#deliver(d.releases);
            else if (e.event === 'release') this.#deliver([d]);
          }
        }
      } catch (e) { if (!this.#stopped) this.#o.onError?.((e as Error).message); }
      if (!this.#stopped) await new Promise((res) => setTimeout(res, this.#o.retryMs ?? 2000));
    }
  }
}
```

- [ ] **Step 5: Run the tests**

Run: `node --test apps/seat/test/pkg.test.ts apps/seat/test/release.test.ts && pnpm --filter @saakshi/seat typecheck`
Expected: PASS (6 tests); typecheck exits 0.

---

### Task 14: The seat, start to finish — orchestrator, timer, provisional sync, Electron wiring

**Files:**
- Create: `apps/seat/src/main/seat.ts`
- Modify: `apps/seat/src/main/exam.ts` (monotonic `activeMs`), `apps/seat/src/main/sync.ts` (the bind gate; `httpSend` takes `fetch`), `apps/seat/src/main/index.ts` (full replacement below)
- Test: `apps/seat/test/seat.test.ts`; append to `apps/seat/test/exam.test.ts` and `apps/seat/test/sync.test.ts`

**Interfaces:**
- Consumes: Task 2 (`pickWrapper`, `testMode`, `ExamSession` `start(meta)`/`testMode`), Task 12 (`SeatIdentity`, `httpPost`), Task 13 (`loadPackage`, `acceptRelease`, `ReleaseWatcher`), Task 1 (IPC types), Task 4 (`buildPackage`, in the test).
- Produces:
  - `class Seat(o: SeatOpts)` with `open()`, `boot(): ExamBoot`, `enrol(e): Promise<EnrolResult>`, `start()`, `act(a)`, `submit()`, `paper(): Paper | null`, getter `exam`, `close()`.
  - `SeatOpts { dir; relayUrl; ctx; seatId; authorityPub; wrap; camera; testMode; fetch?; clock?; now?; retryMs?; onBoot?; onSync? }`.
  - Files next to the journal (`<dir>/<exam>_<shift>_<attempt>_<cand>.*`): `.package.json` (verified package), `.identity` (wrapped), `.release` (the accepted key, wrapped), `.journal`, `.key`.
  - `SeatSync(src, send, cellVerify, onView, { bind?: () => WireBind | undefined })`: with a bind gate and no binding, a round sends nothing and the view says `provisional: true`; the first request after that carries `binds: [bind]`. Without the option, behaviour and views are exactly as in Stage 1.
  - `ExamSession.activeMs()` never decreases within the session (a clock stepping back is clamped).
  - IPC channels `exam:load`, `exam:enrol`, `exam:paper`, `exam:start`, `exam:act`, `exam:submit`; pushes `boot` and `sync`.

- [ ] **Step 1: Write the failing tests**

Append to `apps/seat/test/exam.test.ts`:
```ts
test('Stage 3 timer: remaining = D_i − activeMs, and activeMs never runs backwards within the epoch even if the clock does', () => {
  const dir = mkdtempSync(join(tmpdir(), 'saakshi-exam-'));
  let t = 0;
  const s = session(dir, () => t);
  s.start();
  t = 10_000; assert.equal((s.act(act('answer', 'I01', 'A', 'D')) as { activeMs: number }).activeMs, 10_000);
  t = 4_000;                                                                       // the clock steps back
  assert.equal(s.activeMs(), 10_000);
  assert.equal((s.act(act('answer', 'I02', 'A', 'B')) as { activeMs: number }).activeMs, 10_000);
  const a = s.journal.headers.map((h) => h.activeMs);
  assert.deepEqual(a, [...a].sort((x, y) => x - y));
  assert.equal(s.remainingMs(), D - 10_000);
  s.close(); rmSync(dir, { recursive: true, force: true });
});
```

Append to `apps/seat/test/sync.test.ts` (add `import type { WireBind } from '@saakshi/core/enrol';` and `import type { SyncReq } from '@saakshi/core/wire';` if missing):
```ts
test('Stage 3 provisional: nothing leaves the seat until the binding exists; then the first request carries it', async () => {
  const sim = new SimSeat(keys, 'C0001', cell.pub);
  sim.add(3);
  const seen: SyncReq[] = [];
  let bind: WireBind | undefined;
  const sync = new SeatSync(source(sim), async (req) => { seen.push(req); return { streams: [{ ...sim.ctx, head: 0, headH: '', need: false }], rejected: [] }; }, verifier(cell.pub), () => {}, { bind: () => bind });
  await sync.round();
  assert.equal(seen.length, 0);
  assert.equal(sync.view().provisional, true);
  bind = { cert: '["bind"]', sig: 'a'.repeat(128), cell: 'cell-1', pinBox: 'ab' };
  await sync.round();
  assert.deepEqual(seen[0].binds, [bind]);
  assert.equal(sync.view().provisional, false);
  await sync.round();
  assert.equal(seen[1].binds, undefined);                                           // the relay knows us now
});
```

`apps/seat/test/seat.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hexToBytes, randomBytes, toHex, utf8 } from '@saakshi/core/bytes';
import { canon } from '@saakshi/core/canon';
import { combineBundle } from '@saakshi/core/custody';
import { cellKey, DEV_EXAM, type KeysFile } from '@saakshi/core/dev';
import type { Directory } from '@saakshi/core/directory';
import { bindArray, msg, type BindReq } from '@saakshi/core/enrol';
import { parseSignedLine } from '@saakshi/core/journal';
import { signer } from '@saakshi/core/node';
import { openShareFile, releaseArray, type ReleaseMsg } from '@saakshi/core/paper';
import { signPolicy } from '@saakshi/core/policy';
import { entryHash } from '@saakshi/core/protocol';
import { toB64, type SyncReq } from '@saakshi/core/wire';
import type { Wrapper } from '../src/main/journal-store.ts';
import type { PackageWire } from '../src/main/pkg.ts';
import { Seat } from '../src/main/seat.ts';
import { buildPackage } from '../../../tools/package.ts';

const keys = JSON.parse(readFileSync(new URL('../../../fixtures/keys.json', import.meta.url), 'utf8')) as KeysFile;
const fx = (f: string) => JSON.parse(readFileSync(new URL(`../../../fixtures/paper/${f}`, import.meta.url), 'utf8'));
const authority = { priv: hexToBytes(keys.authority.priv), pub: hexToBytes(keys.authority.pub) };
const cell = cellKey(keys, 'cell-1');
const wrap: Wrapper = { encryptString: (s) => Buffer.from(s).reverse(), decryptString: (b) => Buffer.from(b).reverse().toString() };
const dir = { v: 1, exam: 'DEMO-2026', shift: 'S1', durationMs: 1, demoCentre: 'CEN042', issuedAt: 0, cells: [], cands: {}, centres: { CEN042: { cell: 'cell-1' } } } as unknown as Directory;
const enrol = { pin: '482913', operatorId: 'GATE-42-OP7', method: 'aadhaar-face' as const };
const until = async (ok: () => boolean) => { for (let i = 0; i < 500 && !ok(); i++) await new Promise((r) => setTimeout(r, 10)); assert.equal(ok(), true); };

async function fixture() {
  const p = await buildPackage(dir, { bank: fx('bank.json'), forms: fx('forms.json') }, authority);
  const K = await combineBundle([openShareFile(p.shares.NTA, p.passphrases.NTA), openShareFile(p.shares.OBS, p.passphrases.OBS)]);
  const policy = signPolicy({ v: 1, exam: 'DEMO-2026', shift: 'S1', centre: 'CEN042', cell: { id: 'cell-1', keyId: 'k', pub: keys.cells[0].pub }, durationMs: 1_800_000,
    roster: { C0001: { form: 'F1', extraMs: 600_000, pseud: '7'.repeat(64) } }, issuedAt: 0 }, signer(authority));
  const w: PackageWire = { policy, manifest: p.manifest, paper: { F1: toB64(p.papers.F1), F2: toB64(p.papers.F2) } };
  const kcf1 = p.manifest.manifest.forms[0].kcf;
  const signed = (ts = 5): ReleaseMsg => { const r = { exam: 'DEMO-2026', shift: 'S1', form: 'F1', kcf: kcf1, ts }; return { ...r, key: toHex(K.kF1), sig: toHex(signer(authority)(msg(releaseArray(r)))), via: 'push' }; };
  return { w, kcf1, signed, code: (): ReleaseMsg => ({ ...signed(), sig: '', via: 'code' }), forged: (): ReleaseMsg => ({ ...signed(), key: toHex(randomBytes(32)), sig: '', via: 'code' }) };
}

/** A relay as the seat sees it: package, enrolment (the cell behind it signs), SSE with a snapshot on every connect, pull, sync. */
function fakeRelay(w: PackageWire) {
  const sign = signer(cell), streams = new Set<ReadableStreamDefaultController<Uint8Array>>();
  let n = 0;
  const me = {
    releases: [] as ReleaseMsg[], sync: [] as SyncReq[], hs: [] as string[], wanDown: false,
    push(r: ReleaseMsg) {
      me.releases = [...me.releases.filter((x) => x.form !== r.form), r];
      const frame = utf8(`id: b-${++n}\nevent: release\ndata: ${JSON.stringify(r)}\n\n`);
      for (const c of streams) c.enqueue(frame);
    },
    drop() { for (const c of streams) c.close(); streams.clear(); },
    fetch: (async (url: URL, init?: RequestInit) => {
      const path = new URL(String(url)).pathname;
      if (path === '/v1/package') return Response.json(w);
      if (path === '/v1/enrol') {
        if (me.wanDown) return Response.json({ provisional: true, reason: 'the centre has no WAN link' }, { status: 202 });
        const req = JSON.parse(String(init!.body)) as BindReq, cert = canon(bindArray(req));
        return Response.json({ bind: { cert, sig: toHex(sign(utf8(cert))), cell: 'cell-1', pinBox: req.pinBox } });
      }
      if (path === '/release/current') return Response.json({ releases: me.releases });
      if (path === '/v1/release/events') return new Response(new ReadableStream<Uint8Array>({ start(c) {
        streams.add(c);
        c.enqueue(utf8(`id: b-${n}\nevent: snapshot\ndata: ${JSON.stringify({ releases: me.releases })}\n\n`));
      } }), { headers: { 'content-type': 'text/event-stream' } });
      if (path === '/v1/sync') {
        const req = JSON.parse(String(init!.body)) as SyncReq;
        me.sync.push(req);
        for (const e of req.entries) { const p = parseSignedLine(e.line); if (p.ok && p.header.seq === me.hs.length + 1) me.hs.push(toHex(entryHash(p.header))); }
        return Response.json({ streams: [{ ...req.streams[0], head: me.hs.length, headH: me.hs.at(-1) ?? '', need: false }], rejected: [] });
      }
      return new Response('not found', { status: 404 });
    }) as unknown as typeof fetch,
  };
  return me;
}
function mkSeat(f: typeof fetch, d = mkdtempSync(join(tmpdir(), 'saakshi-seat-'))) {
  return { d, seat: new Seat({ dir: d, relayUrl: 'http://relay:7070', ctx: { ...DEV_EXAM, cand: 'C0001' }, seatId: 'CEN042-S01', authorityPub: authority.pub, wrap, camera: false, testMode: false, fetch: f, retryMs: 20 }) };
}
const unlocks = (s: Seat) => s.exam!.journal.headers.filter((h) => h.kind === 'unlock').length;

test('package → enrol → locked (the commitment shown) → a pushed release → ready → start journals the unlock with [form, kc_f, "push"]', async () => {
  const x = await fixture(), relay = fakeRelay(x.w), { seat } = mkSeat(relay.fetch);
  await seat.open();
  assert.equal(seat.boot().phase, 'enrol');
  assert.equal(seat.start().ok, false);
  assert.deepEqual(await seat.enrol(enrol), { ok: true, bind: 'bound' });
  assert.deepEqual([seat.boot().phase, seat.boot().commitment, seat.paper()], ['locked', x.kcf1, null]);
  relay.push(x.signed());
  await until(() => seat.boot().phase === 'ready');
  assert.equal(seat.paper()!.items[0].id, 'I01');
  assert.deepEqual(seat.start(), { ok: true, seq: 1, activeMs: 0 });
  assert.deepEqual(seat.exam!.journal.recs[0].body.meta, ['F1', x.kcf1, 'push']);
  assert.deepEqual([seat.boot().phase, seat.boot().durationMs], ['exam', 1_800_000 + 600_000]);   // D_i = D + compensatory time
  seat.close();
});

test('Review Focus #4: the same release by SSE, by snapshot after a reconnect, by pull, and then the phoned code — one unlock entry', async () => {
  const x = await fixture(), relay = fakeRelay(x.w), { seat } = mkSeat(relay.fetch);
  await seat.open(); await seat.enrol(enrol);
  relay.push(x.signed());
  await until(() => seat.boot().phase === 'ready');
  seat.start();
  relay.push(x.signed(6));                                                          // re-sent by the cell
  relay.drop();                                                                     // relay restart: pull + snapshot on reconnect
  await new Promise((r) => setTimeout(r, 150));
  relay.push(x.code());                                                             // the phoned code, after the push
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(unlocks(seat), 1);
  assert.equal(seat.boot().release!.via, 'push');
  assert.equal(seat.boot().notice, '');
  seat.close();
});

test('exit check — kc_f on both paths: a forged key is rejected with a notice and changes nothing; the phoned-code key unlocks', async () => {
  const x = await fixture(), relay = fakeRelay(x.w), { seat } = mkSeat(relay.fetch);
  await seat.open(); await seat.enrol(enrol);
  relay.push(x.forged());
  await until(() => /Rejected a key/.test(seat.boot().notice ?? ''));
  assert.equal(seat.boot().phase, 'locked');
  relay.push(x.code());
  await until(() => seat.boot().phase === 'ready');
  seat.start();
  assert.deepEqual(seat.exam!.journal.recs[0].body.meta, ['F1', x.kcf1, 'code']);
  relay.push(x.forged());
  await until(() => /Rejected a key/.test(seat.boot().notice ?? ''));
  assert.equal(unlocks(seat), 1);
  seat.close();
});

test('provisional (no WAN at check-in): the candidate sits the exam on the phoned code; nothing is sent until the cell ratifies the seat; then the backlog syncs', async () => {
  const x = await fixture(), relay = fakeRelay(x.w), { seat } = mkSeat(relay.fetch);
  relay.wanDown = true;
  await seat.open();
  assert.deepEqual(await seat.enrol(enrol), { ok: true, bind: 'provisional' });
  relay.push(x.code());
  await until(() => seat.boot().phase === 'ready');
  seat.start();
  assert.equal(seat.act({ kind: 'answer', item: 'I01', state: 'A', answer: 'D', dwellMs: 1000 }).ok, true);
  await new Promise((r) => setTimeout(r, 100));
  assert.deepEqual([relay.sync.length, seat.boot().sync.provisional, seat.boot().bind], [0, true, 'provisional']);
  relay.wanDown = false;
  await until(() => seat.boot().bind === 'bound');
  await until(() => relay.hs.length === seat.exam!.head());
  assert.equal(relay.sync[0].binds?.[0].cell, 'cell-1');
  seat.close();
});

test('restart with no relay: package, identity, key and journal all come back from disk', async () => {
  const x = await fixture(), relay = fakeRelay(x.w), a = mkSeat(relay.fetch);
  await a.seat.open(); await a.seat.enrol(enrol);
  relay.push(x.signed());
  await until(() => a.seat.boot().phase === 'ready');
  a.seat.start();
  a.seat.act({ kind: 'answer', item: 'I01', state: 'A', answer: 'D', dwellMs: 1000 });
  a.seat.close();
  const b = mkSeat((async () => { throw new Error('offline'); }) as unknown as typeof fetch, a.d);
  await b.seat.open();
  const boot = b.seat.boot();
  assert.deepEqual([boot.phase, boot.bind, boot.items.I01?.answer, boot.release?.via], ['exam', 'bound', 'D', 'push']);
  b.seat.close();
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test apps/seat/test/seat.test.ts apps/seat/test/exam.test.ts apps/seat/test/sync.test.ts`
Expected: FAIL — `../src/main/seat.ts` cannot be found; the timer and provisional tests fail.

- [ ] **Step 3: `exam.ts` and `sync.ts`**

`apps/seat/src/main/exam.ts`:
- Add a field `#lastActive = 0;` and, in the constructor's resume branch, `this.#lastActive = last.activeMs;`.
- Replace `activeMs()`:
```ts
  /** Active time (plan §3.6): monotonic within this key epoch, even if the clock steps back. */
  activeMs(): number {
    if (!this.started) return 0;
    return (this.#lastActive = Math.max(this.#lastActive, this.#activeBase + Math.round(this.#clock() - this.#runStart)));
  }
```

`apps/seat/src/main/sync.ts`:
- Add `import type { WireBind } from '@saakshi/core/enrol';`.
- `httpSend(relayUrl: string, timeoutMs = 5000, f: typeof fetch = fetch)` and call `f(url, …)` instead of `fetch(url, …)`.
- Add the option and field:
```ts
export interface SeatSyncOpts { /** Stage 3: the seat's cell-signed binding. While it is missing, nothing leaves the seat (provisional). */ bind?: () => WireBind | undefined }
```
  `#bind?: () => WireBind | undefined;`; the constructor takes `opts: SeatSyncOpts = {}` as its fifth parameter and sets `this.#bind = opts.bind;`.
- `view()` becomes:
```ts
  view(): SyncView {
    const v: SyncView = { local: this.#src.head(), relay: this.#relay, cell: this.#cell, online: this.#online, error: this.#error };
    return this.#bind ? { ...v, provisional: !this.#bind() } : v;
  }
```
- At the top of `round()`:
```ts
    const bind = this.#bind?.();
    if (this.#bind && !bind) { this.#onView(this.view()); return; }              // provisional: ✓ only until the cell ratifies the seat
```
  and build the request as `const req: SyncReq = { entries, streams: [{ ...s.ctx, head: s.head() }] }; if (bind && this.#cursor < 0) req.binds = [bind];` then `res = await this.#send(req);` (import `SyncReq` is already there).

- [ ] **Step 4: Write `apps/seat/src/main/seat.ts`**

```ts
// One seat, start to finish (plan §3.2, §3.3, §3.6): the package → enrolment → the key at T0 → the exam. Electron-free, so tests
// and tools/act2.ts drive it directly; index.ts only wires it to IPC.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { hexToBytes } from '@saakshi/core/bytes';
import { verifier } from '@saakshi/core/node';
import type { ReleaseMsg } from '@saakshi/core/paper';
import { kcf, type Ctx } from '@saakshi/core/protocol';
import type { Action, ActResult, EnrolInput, EnrolResult, ExamBoot, Paper, Phase, SubmitResult, SyncView } from '../shared/ipc.ts';
import { ExamSession } from './exam.ts';
import { httpPost, SeatIdentity } from './identity.ts';
import { writeDurable, type Wrapper } from './journal-store.ts';
import { loadPackage, type SeatPackage } from './pkg.ts';
import { acceptRelease, ReleaseWatcher } from './release.ts';
import { httpSend, SeatSync } from './sync.ts';

export interface SeatOpts {
  dir: string; relayUrl: string; ctx: Ctx; seatId: string; authorityPub: Uint8Array; wrap: Wrapper;
  camera: boolean; testMode: boolean;
  fetch?: typeof fetch; clock?: () => number; now?: () => number; retryMs?: number;
  onBoot?: (b: ExamBoot) => void; onSync?: (v: SyncView) => void;
}
interface Unlocked { form: string; key: string; via: 'push' | 'code' }

export class Seat {
  #o: SeatOpts;
  #base: string;
  #pkg?: SeatPackage;
  #id?: SeatIdentity;
  #unlocked?: Unlocked;
  #paper?: Paper;
  #exam?: ExamSession;
  #sync?: SeatSync;
  #watch?: ReleaseWatcher;
  #notice = '';
  #timer?: ReturnType<typeof setInterval>;
  #busy = false;
  #closed = false;

  constructor(o: SeatOpts) {
    this.#o = o;
    this.#base = join(o.dir, `${o.ctx.exam}_${o.ctx.shift}_${o.ctx.attempt}_${o.ctx.cand}`);
  }

  get exam(): ExamSession | undefined { return this.#exam; }

  async open(): Promise<void> {
    await this.#tryPackage();
    this.#timer = setInterval(() => void this.#tick(), this.#o.retryMs ?? 2000);
  }

  boot(): ExamBoot {
    const p = this.#pkg?.policy, me = p?.roster[this.#o.ctx.cand], e = this.#exam;
    return {
      phase: this.#phase(), cand: this.#o.ctx.cand, seatId: this.#o.seatId, centre: p?.centre ?? '', form: me?.form ?? 'F1',
      durationMs: p && me ? p.durationMs + me.extraMs : 0, activeMs: e?.activeMs() ?? 0, started: e?.started ?? false, items: e?.items() ?? {},
      sync: this.#sync?.view() ?? { local: 0, relay: 0, cell: 0, online: false, error: '', provisional: this.#id?.state !== 'bound' },
      receipt: e?.receipt(), camera: this.#o.camera, testMode: this.#o.testMode,
      bind: this.#id?.state ?? 'none', notice: this.#notice || this.#id?.error || '',
      commitment: this.#pkg?.manifest.forms.find((f) => f.form === me?.form)?.kcf,
      release: this.#unlocked && { via: this.#unlocked.via },
    };
  }

  async enrol(x: EnrolInput): Promise<EnrolResult> {
    if (!this.#id) return { ok: false, error: 'Waiting for the centre server.' };
    const r = await this.#id.enrol(x.pin, { operatorId: x.operatorId, method: x.method });
    this.#openExam();
    this.#emit();
    return r;
  }

  start(): ActResult {
    if (!this.#exam || !this.#unlocked) return { ok: false, error: 'The paper is locked until T0.' };
    const r = this.#exam.start([this.#unlocked.form, kcf(hexToBytes(this.#unlocked.key)), this.#unlocked.via]);
    this.#sync?.kick();
    this.#emit();
    return r;
  }

  act(a: Action): ActResult {
    if (!this.#exam) return { ok: false, error: 'exam not started' };
    const r = this.#exam.act(a);
    if (r.ok) this.#sync?.kick();
    return r;
  }

  submit(): SubmitResult {
    if (!this.#exam) return { ok: false, error: 'exam not started' };
    const r = this.#exam.submit();
    this.#sync?.kick();
    this.#emit();
    return r;
  }

  paper(): Paper | null { return this.#paper ?? null; }

  close(): void {
    this.#closed = true;
    clearInterval(this.#timer);
    this.#watch?.stop();
    this.#sync?.stop();
    this.#exam?.close();
  }

  #phase(): Phase {
    if (!this.#pkg) return 'connecting';
    if (!this.#id?.key) return 'enrol';
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
      this.#exam?.tick();
    } finally { this.#busy = false; }
  }

  async #tryPackage(): Promise<void> {
    const { exam, shift, cand } = this.#o.ctx;
    try { this.#pkg = await loadPackage({ path: `${this.#base}.package.json`, relayUrl: this.#o.relayUrl, authorityPub: this.#o.authorityPub, want: { exam, shift, cand }, fetch: this.#o.fetch }); }
    catch (e) { this.#notice = `Waiting for the centre server: ${(e as Error).message}`; this.#emit(); return; }
    this.#notice = '';
    const p = this.#pkg.policy;
    this.#id = SeatIdentity.open({ path: `${this.#base}.identity`, ctx: this.#o.ctx, seatId: this.#o.seatId, wrap: this.#o.wrap,
      cell: { id: p.cell.id, pub: hexToBytes(p.cell.pub) }, post: httpPost(this.#o.relayUrl, 5000, this.#o.fetch), now: this.#o.now });
    const saved = `${this.#base}.release`;
    if (existsSync(saved)) this.#unlock(JSON.parse(this.#o.wrap.decryptString(readFileSync(saved))) as Unlocked);
    this.#watch = new ReleaseWatcher({ relayUrl: this.#o.relayUrl, fetch: this.#o.fetch, retryMs: this.#o.retryMs, onRelease: (r) => this.#onRelease(r) });
    this.#watch.start();
    this.#emit();
  }

  #onRelease(r: ReleaseMsg): void {
    if (r.form !== this.#pkg?.policy.roster[this.#o.ctx.cand]?.form) return;     // the other form's key is not this seat's business
    if (this.#unlocked?.key === r.key) return;                                     // the same key again: reconnect, snapshot, pull, push after code
    this.#unlock({ form: r.form, key: r.key, via: r.via }, r);
  }

  /** B.7 on every path. Without r, this restores a key the seat accepted before a restart. */
  #unlock(u: Unlocked, r?: ReleaseMsg): void {
    const pkg = this.#pkg!;
    const a = acceptRelease(r ?? { exam: pkg.manifest.exam, shift: pkg.manifest.shift, form: u.form, kcf: '', ts: 0, key: u.key, sig: '', via: u.via }, pkg, u.form, this.#o.authorityPub);
    if (!a.ok) { this.#notice = `Rejected a key: ${a.error}.`; this.#emit(); return; }
    if (this.#unlocked) return;
    if (r) writeDurable(`${this.#base}.release`, this.#o.wrap.encryptString(JSON.stringify(u)));
    this.#unlocked = u;
    this.#paper = a.paper;
    this.#notice = '';
    this.#openExam();
    this.#emit();
  }

  #openExam(): void {
    if (this.#exam || !this.#pkg || !this.#paper || !this.#id?.key) return;
    const p = this.#pkg.policy, me = p.roster[this.#o.ctx.cand], cellPub = hexToBytes(p.cell.pub), id = this.#id;
    try {
      this.#exam = new ExamSession({ dir: this.#o.dir, ctx: this.#o.ctx, keyEpoch: 1, seat: id.key!, cellPub, wrap: this.#o.wrap,
        durationMs: p.durationMs + me.extraMs, items: this.#paper.items.map((i) => i.id), form: me.form, pseud: me.pseud, clock: this.#o.clock, testMode: this.#o.testMode });
    } catch (e) { this.#notice = `Journal problem — please call the invigilator: ${(e as Error).message}`; return; }
    this.#sync = new SeatSync(this.#exam, httpSend(this.#o.relayUrl, 5000, this.#o.fetch), verifier(cellPub), (v) => this.#o.onSync?.(v), { bind: () => id.bind });
    this.#sync.start(1000);
  }

  #emit(): void { this.#o.onBoot?.(this.boot()); }
}
```

- [ ] **Step 5: Replace `apps/seat/src/main/index.ts`**

```ts
import { app, BrowserWindow, dialog, ipcMain, protocol, safeStorage, session, systemPreferences } from 'electron';
import { readFile, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { hexToBytes } from '@saakshi/core/bytes';
import { DEV_EXAM } from '@saakshi/core/dev';
import trustJson from '../../../../fixtures/trust-dev.json';
import type { Action, EnrolInput } from '../shared/ipc.ts';
import { resolveAppPath } from './app-path.ts';
import { cameraEnabled } from './camera.ts';
import type { Wrapper } from './journal-store.ts';
import { pickWrapper, testMode } from './keystore.ts';
import { runSelftest } from './probes.ts';
import { Seat } from './seat.ts';

const argValue = (flag: string): string | undefined => { const i = process.argv.indexOf(flag); return i > 0 ? process.argv[i + 1] : undefined; };
const setting = (flag: string, envName: string, dflt: string): string => argValue(flag) ?? process.env[envName] ?? dflt;

if (process.argv.includes('--probe-selftest')) {
  runSelftest().then(async (r) => {
    const json = JSON.stringify(r, null, 2);
    process.stdout.write(json + '\n');
    const out = argValue('--out');
    if (out) await writeFile(out, json);
    app.exit(r.ok ? 0 : 1);
  }, (e) => { process.stderr.write(String(e) + '\n'); app.exit(2); });
} else {
  start();
}

function start(): void {
  protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
  const RENDERER = join(__dirname, '../renderer');
  const MIME: Record<string, string> = {
    '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
    '.wasm': 'application/wasm', '.tflite': 'application/octet-stream', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2',
    '.ttf': 'font/ttf', '.txt': 'text/plain; charset=utf-8',
  };
  const CSP = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'";

  // Stage 3: the app carries only the exam authority's PUBLIC key. The seat key is made at enrolment; the cell key, D_i and the
  // roster come from the signed policy; the paper comes encrypted and opens only with a key that matches kc_f.
  const authorityPub = hexToBytes((trustJson as { authority: string }).authority);
  const cand = setting('--cand', 'SAAKSHI_CAND', 'C0001');
  const seatId = setting('--seat', 'SAAKSHI_SEAT', 'CEN042-S01');
  const relayUrl = setting('--relay', 'SAAKSHI_RELAY', 'http://127.0.0.1:7070');
  const camera = cameraEnabled(process.argv, process.env);
  const test = testMode(process.argv, process.env);
  let seat: Seat | undefined;
  let win: BrowserWindow | undefined;

  const guard = <T>(fn: () => T): T | { ok: false; error: string } => { try { return fn(); } catch (e) { return { ok: false, error: (e as Error).message }; } };
  ipcMain.handle('exam:load', () => seat!.boot());
  ipcMain.handle('exam:enrol', (_e, x: EnrolInput) => seat!.enrol(x));
  ipcMain.handle('exam:paper', () => seat!.paper());
  ipcMain.handle('exam:start', () => guard(() => seat!.start()));
  ipcMain.handle('exam:act', (_e, a: Action) => guard(() => seat!.act(a)));
  ipcMain.handle('exam:submit', () => guard(() => seat!.submit()));

  app.whenReady().then(async () => {
    let wrap: Wrapper;
    try { wrap = pickWrapper({ testMode: test, safeStorage, dir: app.getPath('userData') }); }
    catch (e) { dialog.showErrorBox('Saakshi', (e as Error).message); app.exit(1); return; }
    if (test) console.warn('SAAKSHI TEST MODE — not for real exams (journal key not in the OS keychain)');
    seat = new Seat({ dir: join(app.getPath('userData'), 'journal'), relayUrl, ctx: { ...DEV_EXAM, cand }, seatId, authorityPub, wrap, camera, testMode: test,
      onBoot: (b) => win?.webContents.send('boot', b), onSync: (v) => win?.webContents.send('sync', v) });
    await seat.open();

    protocol.handle('app', async (req) => {
      const p = resolveAppPath(RENDERER, new URL(req.url).pathname);
      if (!p) return new Response('not found', { status: 404 });
      try {
        return new Response(await readFile(p), { headers: { 'content-type': MIME[extname(p)] ?? 'application/octet-stream', 'content-security-policy': CSP } });
      } catch { return new Response('not found', { status: 404 }); }
    });
    // Camera off (--no-camera or test mode): no permission and no macOS prompt.
    session.defaultSession.setPermissionRequestHandler((_wc, perm, cb) => cb(camera && perm === 'media'));
    session.defaultSession.setPermissionCheckHandler((_wc, perm) => camera && perm === 'media');
    if (camera && process.platform === 'darwin') await systemPreferences.askForMediaAccess('camera');

    win = new BrowserWindow({
      width: 1200, height: 800,
      webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, sandbox: true, nodeIntegration: false },
    });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('app://')) e.preventDefault(); });
    const zoom = Number(process.env.SAAKSHI_ZOOM ?? 1);
    if (zoom !== 1) win.webContents.on('did-finish-load', () => win!.webContents.setZoomFactor(zoom));
    const dev = process.env.ELECTRON_RENDERER_URL;
    await (dev && !app.isPackaged ? win.loadURL(dev) : win.loadURL('app://seat/index.html'));
  });
  app.on('window-all-closed', () => { seat?.close(); app.quit(); });
}
```
The Stage 2 imports of `fixtures/keys.json` and `fixtures/paper/forms.json` are gone: the app no longer ships any private key or the form order.

- [ ] **Step 6: Run the seat suite, the typecheck and Act 4**

Run: `pnpm --filter @saakshi/seat test && pnpm --filter @saakshi/seat typecheck && bun tools/act4.ts` (act4 binds ports: sandbox disabled)
Expected: PASS; `act4.ts` still prints `PASS` (it drives `ExamSession` directly, without a bind gate).

---

### Task 15: The seat renderer — check-in, "paper locked", the paper from main, the test-mode banner

**Files:**
- Create: `apps/seat/src/renderer/src/Gate.tsx`, `apps/seat/src/renderer/src/enrol-state.ts`
- Modify: `apps/seat/src/renderer/src/App.tsx` (full replacement below), `apps/seat/src/renderer/src/i18n.ts`, `apps/seat/src/renderer/src/styles.css` (append)
- Test: `apps/seat/test/enrol-state.test.ts`

**Interfaces:**
- Consumes: Task 1 (`ExamBoot.phase/bind/notice/commitment/release/testMode/centre`, `Paper`, `EnrolInput`, `SeatApi.enrol/paper/onBoot`, `SyncView.provisional`).
- Produces:
  - `enrol-state.ts`: `enrolProblem(pin, confirm, operatorId): '' | 'pinDigits' | 'pinMatch' | 'operator'`, `GATE: readonly GateMethod[]`, `shortHex(h?): string` (first 16 hex in groups of 4).
  - Screens: **Connecting** → **Check-in** (PIN twice, gate operator ID, gate method) → **Paper locked until T0** (binding badge; the commitment) → the Stage 2 start screen with "Paper unlocked" → the exam → the slip.
  - The renderer no longer imports `fixtures/paper/bank.json` or `forms.json`: the questions come from `window.saakshi.paper()` only after main accepted a key.
  - The banner **"TEST MODE — not for real exams (journal key not in the OS keychain)"** sits above every screen, including the slip, whenever `boot.testMode`.

- [ ] **Step 1: Write the failing test**

`apps/seat/test/enrol-state.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { enrolProblem, GATE, shortHex } from '../src/renderer/src/enrol-state.ts';

test('check-in form: 6 digits, typed twice the same, and the gate operator named', () => {
  assert.equal(enrolProblem('12345', '12345', 'OP'), 'pinDigits');
  assert.equal(enrolProblem('12a456', '12a456', 'OP'), 'pinDigits');
  assert.equal(enrolProblem('123456', '123465', 'OP'), 'pinMatch');
  assert.equal(enrolProblem('123456', '123456', '  '), 'operator');
  assert.equal(enrolProblem('012345', '012345', 'GATE-42-OP7'), '');
  assert.deepEqual(GATE, ['aadhaar-face', 'aadhaar-fingerprint', 'id-document']);
  assert.equal(shortHex('6065a397d8b6299bbacba68453af1f99'), '6065 a397 d8b6 299b');
  assert.equal(shortHex(undefined), '');
});

test('the renderer never bundles the plaintext paper', () => {
  const src = readFileSync(new URL('../src/renderer/src/App.tsx', import.meta.url), 'utf8');
  assert.equal(/paper\/bank\.json|paper\/forms\.json/.test(src), false);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test apps/seat/test/enrol-state.test.ts`
Expected: FAIL — `enrol-state.ts` cannot be found (and App.tsx still imports `bank.json`).

- [ ] **Step 3: Write `enrol-state.ts`, extend `i18n.ts`, append to `styles.css`**

`apps/seat/src/renderer/src/enrol-state.ts`:
```ts
import type { GateMethod } from '../../shared/ipc.ts';

export type EnrolProblem = '' | 'pinDigits' | 'pinMatch' | 'operator';
export function enrolProblem(pin: string, confirm: string, operatorId: string): EnrolProblem {
  if (!/^[0-9]{6}$/.test(pin)) return 'pinDigits';
  if (pin !== confirm) return 'pinMatch';
  if (!operatorId.trim()) return 'operator';
  return '';
}
export const GATE: readonly GateMethod[] = ['aadhaar-face', 'aadhaar-fingerprint', 'id-document'];
/** 6065a397d8b6299b… → "6065 a397 d8b6 299b": the first 16 hex of a commitment, for reading aloud. */
export const shortHex = (h = ''): string => h.slice(0, 16).replace(/(.{4})(?=.)/g, '$1 ');
```

`apps/seat/src/renderer/src/i18n.ts` — add `import type { BindState, GateMethod } from '../../shared/ipc.ts';` and `import type { EnrolProblem } from './enrol-state.ts';`, add these fields to `Strings`:
```ts
  connecting: string; enrolTitle: string; enrolNote: string; pin: string; pinConfirm: string; gateCheck: string; operator: string; method: string;
  methods: Record<GateMethod, string>; enrol: string; problems: Record<Exclude<EnrolProblem, ''>, string>;
  lockedTitle: string; lockedNote: string; commitment: string; bind: Record<BindState, string>;
  unlocked: string; viaCode: string; provisional: string; testBanner: string;
```
and the values. English:
```ts
    connecting: 'Connecting to the centre server…',
    enrolTitle: 'Check-in',
    enrolNote: 'Set a 6-digit PIN. You need it only if you have to move to another computer. It is sent sealed to the exam server; the centre server cannot read it.',
    pin: 'New PIN (6 digits)', pinConfirm: 'Type the PIN again', gateCheck: 'Gate check (filled in by the gate operator)',
    operator: 'Gate operator ID', method: 'How the gate checked identity',
    methods: { 'aadhaar-face': 'Aadhaar face authentication', 'aadhaar-fingerprint': 'Aadhaar fingerprint', 'id-document': 'Photo ID checked by hand' },
    enrol: 'Check in',
    problems: { pinDigits: 'The PIN must be exactly 6 digits.', pinMatch: 'The two PINs do not match.', operator: "Enter the gate operator's ID." },
    lockedTitle: 'Paper locked until T0',
    lockedNote: 'The paper on this computer is encrypted. It opens only with a key that matches the commitment published before the exam:',
    commitment: 'Published commitment',
    bind: {
      none: 'Not checked in',
      provisional: 'Seat provisional — the exam server will confirm it when the network returns. Your answers are safe on this computer.',
      bound: 'Seat confirmed by the exam server',
      refused: 'Check-in refused — please call the invigilator',
    },
    unlocked: 'Paper unlocked: the key matches the published commitment.',
    viaCode: '(unlocked at this centre with the code phoned in by the superintendent)',
    provisional: 'provisional',
    testBanner: 'TEST MODE — not for real exams (journal key not in the OS keychain)',
```
Hindi:
```ts
    connecting: 'केंद्र सर्वर से जुड़ रहे हैं…',
    enrolTitle: 'चेक-इन',
    enrolNote: '6 अंकों का पिन बनाएँ। इसकी ज़रूरत केवल तब होगी जब आपको दूसरे कंप्यूटर पर जाना पड़े। यह परीक्षा सर्वर को सीलबंद भेजा जाता है; केंद्र सर्वर इसे पढ़ नहीं सकता।',
    pin: 'नया पिन (6 अंक)', pinConfirm: 'पिन दोबारा लिखें', gateCheck: 'गेट जाँच (गेट ऑपरेटर भरेंगे)',
    operator: 'गेट ऑपरेटर आईडी', method: 'गेट पर पहचान कैसे जाँची गई',
    methods: { 'aadhaar-face': 'आधार चेहरा प्रमाणीकरण', 'aadhaar-fingerprint': 'आधार फ़िंगरप्रिंट', 'id-document': 'फ़ोटो पहचान-पत्र हाथ से जाँचा गया' },
    enrol: 'चेक-इन करें',
    problems: { pinDigits: 'पिन ठीक 6 अंकों का होना चाहिए।', pinMatch: 'दोनों पिन मेल नहीं खाते।', operator: 'गेट ऑपरेटर की आईडी लिखें।' },
    lockedTitle: 'T0 तक प्रश्न-पत्र बंद है',
    lockedNote: 'इस कंप्यूटर पर प्रश्न-पत्र एन्क्रिप्टेड है। यह केवल उसी कुंजी से खुलेगा जो परीक्षा से पहले प्रकाशित प्रतिबद्धता से मेल खाती है:',
    commitment: 'प्रकाशित प्रतिबद्धता',
    bind: {
      none: 'चेक-इन नहीं हुआ',
      provisional: 'सीट अस्थायी है — नेटवर्क लौटने पर परीक्षा सर्वर इसकी पुष्टि करेगा। आपके उत्तर इस कंप्यूटर पर सुरक्षित हैं।',
      bound: 'परीक्षा सर्वर ने सीट की पुष्टि की',
      refused: 'चेक-इन अस्वीकार — कृपया निरीक्षक को बुलाएँ',
    },
    unlocked: 'प्रश्न-पत्र खुल गया: कुंजी प्रकाशित प्रतिबद्धता से मेल खाती है।',
    viaCode: '(अधीक्षक द्वारा फ़ोन पर बताए गए कोड से इसी केंद्र पर खोला गया)',
    provisional: 'अस्थायी',
    testBanner: 'परीक्षण मोड — असली परीक्षा के लिए नहीं (जर्नल कुंजी OS कीचेन में नहीं है)',
```

Append to `apps/seat/src/renderer/src/styles.css`:
```css
.test-banner { position: sticky; top: 0; z-index: 10; background: #b3261e; color: #fff; font-weight: 700; text-align: center; padding: .375rem 1rem; }
.gate { display: grid; gap: 1rem; max-width: 26rem; margin: 1rem 0; }
.gate label { display: grid; gap: .25rem; font-weight: 600; }
.gate input, .gate select { font: inherit; padding: .5rem; min-height: 2.75rem; border: 1px solid var(--muted); border-radius: .375rem; }
.gate fieldset { display: grid; gap: 1rem; }
.gate legend { font-weight: 700; margin-bottom: .5rem; }
.problem { color: var(--na); font-weight: 700; min-height: 1.5em; }
.badge { display: inline-block; border-radius: 999px; padding: .125rem .75rem; border: 1px solid var(--line); font-weight: 600; }
.badge.bound { border-color: var(--a); color: var(--a); }
.badge.provisional { border-color: #b06000; color: #7a4100; background: #fef7e0; }
.badge.refused, .badge.none { border-color: var(--na); color: var(--na); }
.commit { font: 700 1.5rem/1.3 ui-monospace, 'SF Mono', Menlo, Consolas, monospace; letter-spacing: .06em; }
```

- [ ] **Step 4: Write `Gate.tsx` and replace `App.tsx`**

`apps/seat/src/renderer/src/Gate.tsx`:
```tsx
import { useState, type FormEvent } from 'react';
import type { ExamBoot, GateMethod, Lang } from '../../shared/ipc.ts';
import { enrolProblem, GATE, shortHex } from './enrol-state.ts';
import type { Strings } from './i18n.ts';

interface P { boot: ExamBoot; t: Strings; lang: Lang; setLang: (l: Lang) => void }

export function TestBanner({ t }: { t: Strings }) {
  return <div className="test-banner" role="note">{t.testBanner}</div>;
}

export function LangToggle({ lang, setLang, t }: { lang: Lang; setLang: (l: Lang) => void; t: Strings }) {
  return (
    <div className="lang" role="group" aria-label={t.lang}>
      <button aria-pressed={lang === 'en'} lang="en" onClick={() => setLang('en')}>English</button>
      <button aria-pressed={lang === 'hi'} lang="hi" onClick={() => setLang('hi')}>हिन्दी</button>
    </div>
  );
}

export function Connecting({ boot, t, lang, setLang }: P) {
  return (
    <main className="start">
      <h1>{t.title}</h1>
      <LangToggle lang={lang} setLang={setLang} t={t} />
      <p role="status">{t.connecting}</p>
      <p className="notice">{boot.notice}</p>
    </main>
  );
}

export function Enrol({ boot, t, lang, setLang }: P) {
  const [pin, setPin] = useState(''), [confirm, setConfirm] = useState(''), [op, setOp] = useState('');
  const [method, setMethod] = useState<GateMethod>('aadhaar-face');
  const [problem, setProblem] = useState(''), [busy, setBusy] = useState(false);
  async function submit(ev: FormEvent) {
    ev.preventDefault();
    const p = enrolProblem(pin, confirm, op);
    if (p) { setProblem(t.problems[p]); return; }
    setBusy(true);
    const r = await window.saakshi.enrol({ pin, operatorId: op, method });
    setBusy(false);
    setPin(''); setConfirm('');
    setProblem(r.ok ? '' : r.error);
  }
  return (
    <main className="start" aria-labelledby="enrol-h">
      <h1 id="enrol-h">{t.enrolTitle}</h1>
      <p>{t.candidate}: {boot.cand} · {boot.seatId} · {boot.centre}</p>
      <LangToggle lang={lang} setLang={setLang} t={t} />
      <p>{t.enrolNote}</p>
      <form className="gate" onSubmit={submit} noValidate>
        <label>{t.pin}
          <input type="password" inputMode="numeric" autoComplete="off" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value)} aria-describedby="enrol-problem" required />
        </label>
        <label>{t.pinConfirm}
          <input type="password" inputMode="numeric" autoComplete="off" maxLength={6} value={confirm} onChange={(e) => setConfirm(e.target.value)} aria-describedby="enrol-problem" required />
        </label>
        <fieldset>
          <legend>{t.gateCheck}</legend>
          <label>{t.operator}<input value={op} onChange={(e) => setOp(e.target.value)} autoComplete="off" aria-describedby="enrol-problem" required /></label>
          <label>{t.method}
            <select value={method} onChange={(e) => setMethod(e.target.value as GateMethod)}>
              {GATE.map((m) => <option key={m} value={m}>{t.methods[m]}</option>)}
            </select>
          </label>
        </fieldset>
        <button className="primary" disabled={busy}>{t.enrol}</button>
      </form>
      <p id="enrol-problem" role="alert" className="problem">{problem || boot.notice}</p>
    </main>
  );
}

export function Locked({ boot, t, lang, setLang }: P) {
  const bind = boot.bind ?? 'none';
  return (
    <main className="start" aria-labelledby="locked-h">
      <h1 id="locked-h">{t.lockedTitle}</h1>
      <p>{t.candidate}: {boot.cand} · {boot.seatId} · {t.form} {boot.form}</p>
      <LangToggle lang={lang} setLang={setLang} t={t} />
      <p className={`badge ${bind}`}>{t.bind[bind]}</p>
      <p>{t.lockedNote}</p>
      <p className="commit"><span className="sr-only">{t.commitment}: </span>{shortHex(boot.commitment)}</p>
      <p role="status" className="notice">{boot.notice}</p>
    </main>
  );
}
```

`apps/seat/src/renderer/src/App.tsx` (replace; the exam screens are the Stage 2 ones, now fed by the decrypted paper):
```tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Action, ExamBoot, ItemState, Lang, Paper, Receipt, SeatApi, SyncView } from '../../shared/ipc.ts';
import { clearResponse, fmtRemaining, GLYPH, legendCounts, markAndNext, PALETTE_STATES, saveAndNext, tickOf, visitAction } from './exam-state.ts';
import { FaceChip } from './FaceChip.tsx';
import { Connecting, Enrol, LangToggle, Locked, TestBanner } from './Gate.tsx';
import { T, type Strings } from './i18n.ts';
import { Palette } from './Palette.tsx';
import { Slip } from './Slip.tsx';

declare global { interface Window { saakshi: SeatApi } }
const LETTERS = ['A', 'B', 'C', 'D'] as const;

export function App() {
  const [boot, setBoot] = useState<ExamBoot | null>(null);
  const [paper, setPaper] = useState<Paper | null>(null);
  const [err, setErr] = useState('');
  const [lang, setLang] = useState<Lang>(() => { try { return localStorage.getItem('lang') === 'hi' ? 'hi' : 'en'; } catch { return 'en'; } });
  useEffect(() => { window.saakshi.load().then(setBoot, (e) => setErr(String(e))); return window.saakshi.onBoot(setBoot); }, []);
  useEffect(() => { try { localStorage.setItem('lang', lang); } catch { /* per-viewer convenience only */ } document.documentElement.lang = lang; }, [lang]);
  const open = !!boot && (boot.phase === 'ready' || boot.phase === 'exam' || boot.phase === 'submitted');
  useEffect(() => { if (open && !paper) void window.saakshi.paper().then(setPaper); }, [open, paper]);
  const t = T[lang];
  const g = { t, lang, setLang };
  let body;
  if (err) body = <p role="alert">{err}</p>;
  else if (!boot) body = <p>…</p>;
  else if (boot.phase === 'connecting') body = <Connecting boot={boot} {...g} />;
  else if (boot.phase === 'enrol') body = <Enrol boot={boot} {...g} />;
  else if (boot.phase === 'locked') body = <Locked boot={boot} {...g} />;
  else if (!paper) body = <p>…</p>;
  else body = <Exam boot={boot} paper={paper} {...g} />;
  return <>{boot?.testMode && <TestBanner t={t} />}{body}</>;
}

function Exam({ boot, paper, t, lang, setLang }: { boot: ExamBoot; paper: Paper; t: Strings; lang: Lang; setLang: (l: Lang) => void }) {
  const order = useMemo(() => paper.items.map((i) => i.id), [paper]);
  const bank = useMemo(() => new Map(paper.items.map((i) => [i.id, i])), [paper]);
  const [started, setStarted] = useState(boot.started);
  const [items, setItems] = useState<Record<string, ItemState>>(boot.items);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const [visited, setVisited] = useState<Set<string>>(() => new Set([...Object.keys(boot.items), ...(boot.started ? [order[0]] : [])]));
  const [idx, setIdx] = useState(0);
  const [selected, setSelected] = useState(boot.items[order[0]]?.answer ?? '');
  const [sync, setSync] = useState<SyncView>(boot.sync);
  const [notice, setNotice] = useState('');
  const [receipt, setReceipt] = useState<Receipt | undefined>(boot.receipt);
  const [confirming, setConfirming] = useState(false);
  const [clock, setClock] = useState({ base: boot.activeMs, at: performance.now() });
  const [now, setNow] = useState(performance.now());
  const shownAt = useRef(performance.now());
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => window.saakshi.onSync(setSync), []);
  useEffect(() => { const id = setInterval(() => setNow(performance.now()), 250); return () => clearInterval(id); }, []);
  // Resume: the question on screen counts as visited (Addendum A.6).
  useEffect(() => { if (boot.started && !boot.receipt) void visit(order[0]); }, []);

  const remaining = boot.durationMs - (started ? clock.base + (now - clock.at) : 0);
  const timeUp = started && remaining <= 0;
  const item = order[idx];

  async function visit(id: string) {
    const a = visitAction(id, itemsRef.current[id]);
    if (!a) return;
    const r = await window.saakshi.act(a);
    if (r.ok) setItems((p) => (p[id] ? p : { ...p, [id]: { state: 'NA', answer: '', seq: r.seq } }));
  }

  function go(i: number, its: Record<string, ItemState> = itemsRef.current) {
    const n = (i + order.length) % order.length, next = order[n];
    setIdx(n);
    setVisited((v) => new Set(v).add(next));
    setSelected(its[next]?.answer ?? '');
    shownAt.current = performance.now();
    requestAnimationFrame(() => heading.current?.focus());
    void visit(next);
  }

  async function commit(a: Action | null, advance: boolean) {
    let its = itemsRef.current;
    if (a) {
      const r = await window.saakshi.act(a);
      if (!r.ok) { setNotice(r.error); return; }
      const st: ItemState = { state: a.state, answer: a.answer, seq: r.seq };
      its = { ...itemsRef.current, [a.item]: st };
      setItems((p) => ({ ...p, [a.item]: st }));
      setClock({ base: r.activeMs, at: performance.now() });
      setNotice(`${t.saved} ✓`);
    }
    if (advance) go(idx + 1, its); else setSelected(its[item]?.answer ?? '');
  }
  const dwell = () => performance.now() - shownAt.current;

  async function submit() {
    const r = await window.saakshi.submit();
    if (r.ok) setReceipt(r.receipt);
    else { setConfirming(false); setNotice(r.error); }
  }

  if (receipt) return <Slip r={receipt} sync={sync} t={t} />;

  if (!started) {
    return (
      <main className="start">
        <h1>{t.title}</h1>
        <p>{t.candidate}: {boot.cand} · {boot.seatId} · {t.form} {boot.form}</p>
        <LangToggle lang={lang} setLang={setLang} t={t} />
        <p className="badge bound">{t.unlocked} {boot.release?.via === 'code' ? t.viaCode : ''}</p>
        <p>{t.startNote}</p>
        <button className="primary" onClick={async () => {
          const r = await window.saakshi.start();
          if (!r.ok) { setNotice(r.error); return; }
          setStarted(true);
          setClock({ base: r.activeMs, at: performance.now() });
          setVisited((v) => new Set(v).add(order[0]));
          shownAt.current = performance.now();
          void visit(order[0]);
        }}>{t.start}</button>
        <p role="status">{notice || boot.notice}</p>
      </main>
    );
  }

  if (confirming) {
    const c = legendCounts(order, items, new Set());
    return (
      <main className="start" aria-labelledby="confirm-h">
        <h1 id="confirm-h">{t.confirmTitle}</h1>
        <ul className="legend">
          {PALETTE_STATES.map((s) => (
            <li key={s}><span className={`pal ${s} mini`} aria-hidden="true">{c[s]}</span>{t.state[s]}<span className="sr-only">: {c[s]}</span></li>
          ))}
        </ul>
        <p>{t.confirmNote}</p>
        <div className="actions">
          <button className="primary" onClick={submit}>{t.submitNow}</button>
          <button onClick={() => setConfirming(false)}>{t.back}</button>
        </div>
      </main>
    );
  }

  const q = bank.get(item)![lang];
  const tick = tickOf(items[item]?.seq ?? 0, sync);
  return (
    <div className="exam">
      <header className="bar">
        <div><strong>{t.title}</strong> · {boot.cand} · {t.form} {boot.form}</div>
        <div role="timer" aria-live="off" className={remaining < 5 * 60_000 ? 'timer low' : 'timer'}>
          <span className="sr-only">{t.timeLeft} </span>{fmtRemaining(remaining)}
        </div>
        <LangToggle lang={lang} setLang={setLang} t={t} />
        <SyncStatus v={sync} t={t} />
        <FaceChip label={t.faces} unavailable={t.cameraOff} off={!boot.camera} offLabel={t.cameraTest} />
        <button className="submit" onClick={() => setConfirming(true)}>{t.submit}</button>
      </header>
      <main className="question" aria-labelledby="qh">
        <h2 id="qh" ref={heading} tabIndex={-1}>
          {t.question} {idx + 1}
          {tick !== 'none' && <span className={`tick ${tick}`} title={t.tick[tick]}><span aria-hidden="true">{GLYPH[tick]}</span><span className="sr-only">, {t.tick[tick]}</span></span>}
        </h2>
        <fieldset disabled={timeUp}>
          <legend className="q-text">{q.q}</legend>
          {q.o.map((o, i) => (
            <label key={LETTERS[i]} className="opt">
              <input type="radio" name="opt" value={LETTERS[i]} checked={selected === LETTERS[i]} onChange={() => setSelected(LETTERS[i])} />
              <span className="letter">{LETTERS[i]}</span> {o}
            </label>
          ))}
        </fieldset>
        <div className="actions">
          <button className="primary" disabled={timeUp} onClick={() => commit(saveAndNext(item, selected, items[item], dwell()), true)}>{t.saveNext}</button>
          <button className="mark" disabled={timeUp} onClick={() => commit(markAndNext(item, selected, items[item], dwell()), true)}>{t.markNext}</button>
          <button disabled={timeUp} onClick={() => { setSelected(''); void commit(clearResponse(item, items[item], dwell()), false); }}>{t.clear}</button>
        </div>
        <p role="status" className="notice">{timeUp ? t.timeUp : notice}</p>
      </main>
      <Palette order={order} items={items} visited={visited} current={idx} sync={sync} t={t} onPick={(i) => go(i)} />
    </div>
  );
}

function SyncStatus({ v, t }: { v: SyncView; t: Strings }) {
  return (
    <div className="sync">
      <span><span aria-hidden="true">✓</span> {v.local}<span className="sr-only"> {t.tick.local}</span></span>
      <span><span aria-hidden="true">✓✓</span> {v.relay}<span className="sr-only"> {t.tick.relay}</span></span>
      <span className="cell"><span aria-hidden="true">✓✓</span> {v.cell}<span className="sr-only"> {t.tick.cell}</span></span>
      {v.provisional && <span className="badge provisional">{t.provisional}</span>}
      <span role="status" className={v.online ? 'online' : 'offline'}>{v.online ? t.online : t.offline}</span>
    </div>
  );
}
```

- [ ] **Step 5: Run the seat tests, the typecheck and a build**

Run: `pnpm --filter @saakshi/seat test && pnpm --filter @saakshi/seat typecheck && (cd apps/seat && pnpm build) && ! grep -rq "SI unit of force" apps/seat/out`
Expected: PASS; typecheck exits 0; the build succeeds and no question text is in the bundle (the grep finds nothing, so the command exits 0).

---

### Task 16: Wiring — the exam directory loader, `main.ts` in EXAM mode, control's enrolled trust and chaos route

**Files:**
- Create: `apps/server/src/exam-env.ts`
- Modify: `apps/server/src/main.ts` (full replacement below), `apps/server/src/control.ts` (`seatKeys`, `/v1/chaos/wan`), `apps/server/src/recon.ts` (`bound`)
- Test: `apps/server/test/exam-env.test.ts`, `apps/server/test/control-stage3.test.ts`; append to `apps/server/test/main.test.ts` and `apps/server/test/recon.test.ts`

**Interfaces:**
- Consumes: everything server-side from Tasks 3–11.
- Produces:
  - `exam-env.ts`: `interface ExamEnv { root; dir: Directory; manifest: SignedManifest; authority: Verify }`, `loadExam(root, authorityPub): ExamEnv` (verifies the manifest and every cell certificate; throws), `loadCellKey(env, id)` (the key file must be the certified key), `relayFiles(env, centre): { policy; papers; wrap; cell: CellEntry }`, `codesFile(env): Uint8Array`.
  - `ControlOpts.seatKeys?: () => Promise<Record<string, string>>` — with it, seal, audit, evidence and reconciliation trust the enrolled keys (and `checkedIn` = bound at keyEpoch 1). Control route `POST /v1/chaos/wan {up}` → the relay's `/v1/dev/wan`, logged as `chaos-wan`.
  - `ReconIn.bound?: string[]`.
  - `main.ts` with `EXAM`: cell (certified key file, Bindings, ReleaseStore with `requireSig`, cell routes), relay (its centre's policy, papers and wrap, Bindings, ReleaseStore → release hub, Wan, relay routes, the forwarder with `releases` and `bindFor`), control (Stage 2 routes with enrolled trust, release control, fleet, `/custodian`). Without `EXAM`, Stage 2 behaviour, unchanged. The loopback guard and control's 64 KB body cap stay.
  - `READY` lines gain `exam` (the directory, or null) and, for a relay, `centre`.

- [ ] **Step 1: Write the failing tests**

`apps/server/test/exam-env.test.ts`:
```ts
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hexToBytes } from '@saakshi/core/bytes';
import type { KeysFile } from '@saakshi/core/dev';
import { FILES } from '@saakshi/core/directory';
import { codesFile, loadCellKey, loadExam, relayFiles } from '../src/exam-env.ts';
import { buildPackage, writePackage } from '../../../tools/package.ts';
import { provision } from '../../../tools/provision.ts';

const keys = JSON.parse(readFileSync(new URL('../../../fixtures/keys.json', import.meta.url), 'utf8')) as KeysFile;
const fx = (f: string) => JSON.parse(readFileSync(new URL(`../../../fixtures/paper/${f}`, import.meta.url), 'utf8'));
const authority = { priv: hexToBytes(keys.authority.priv), pub: hexToBytes(keys.authority.pub) };
let tmp: string, out: string;
beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'saakshi-env-'));
  out = join(tmp, 'exam');
  const d = provision({ out, keys, cands: [{ cand: 'C00001', centre: 'CEN001', form: 'F1', pwd: 0 }] });
  writePackage(out, await buildPackage(d, { bank: fx('bank.json'), forms: fx('forms.json') }, authority));
});
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

test('loads a provisioned, packaged exam: the certified cell key, the relay\'s own files, control\'s code list', () => {
  const X = loadExam(out, authority.pub);
  expect([X.dir.demoCentre, X.manifest.manifest.forms.length]).toEqual(['CEN042', 2]);
  expect(loadCellKey(X, 'cell-1').keyId).toBe(X.dir.cells[0].keyId);
  const rf = relayFiles(X, 'CEN042');
  expect([rf.cell.id, rf.wrap.length, Object.keys(rf.papers)]).toEqual(['cell-1', 104, ['F1', 'F2']]);
  expect(codesFile(X).length).toBeGreaterThan(40);
  expect(() => relayFiles(X, 'CEN999')).toThrow(/no centre CEN999/);
});

test('refuses a tampered cell certificate, a tampered manifest, or a key file the directory does not certify', () => {
  const edit = (rel: string, f: (x: any) => void) => { const p = join(out, rel), orig = readFileSync(p, 'utf8'), x = JSON.parse(orig); f(x); writeFileSync(p, JSON.stringify(x)); return () => writeFileSync(p, orig); };
  let undo = edit(FILES.directory, (d) => { d.cells[1].cert = '0'.repeat(128); });
  expect(() => loadExam(out, authority.pub)).toThrow(/certificate for cell-2/);
  undo();
  undo = edit(FILES.manifest, (m) => { m.manifest.ts++; });
  expect(() => loadExam(out, authority.pub)).toThrow(/manifest signature/);
  undo();
  undo = edit(FILES.cellKey('cell-1'), (k) => { k.pub = keys.cells[1].pub; });
  expect(() => loadCellKey(loadExam(out, authority.pub), 'cell-1')).toThrow(/not the key the directory certifies/);
  undo();
});
```

`apps/server/test/control-stage3.test.ts` (binds ports: sandbox disabled):
```ts
import { afterAll, beforeAll, expect, test } from 'bun:test';
import type { Database } from 'bun:sqlite';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hexToBytes, toHex } from '@saakshi/core/bytes';
import { cellKey, devForm, devPseud, devRoster, trustFromKeys, type KeysFile } from '@saakshi/core/dev';
import { newKeyPair } from '@saakshi/core/node';
import { formsOf, type ReconRow } from '@saakshi/core/sheet';
import page from '../src/control.html';
import { Bindings } from '../src/bindings.ts';
import { controlRoutes } from '../src/control.ts';
import { createIngest, type Ingest } from '../src/ingest.ts';
import type { Routes } from '../src/serve.ts';
import { shiftExport } from '../src/sheet-export.ts';
import { openDb } from '../src/store.ts';
import { FORMS, SimSeat } from '../../../tools/sim-seat.ts';
import { simBindReq } from '../../../tools/sim-custody.ts';

const keys = JSON.parse(readFileSync(new URL('../../../fixtures/keys.json', import.meta.url), 'utf8')) as KeysFile;
const cell = cellKey(keys, 'cell-1'), forms = formsOf(FORMS), X = { exam: 'DEMO-2026', shift: 'S1' };
let dir: string, db: Database, n: Ingest, withKeys: Routes, bare: Routes;
const wan: unknown[] = [], servers: ReturnType<typeof Bun.serve>[] = [];

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'saakshi-ctl3-'));
  ({ db } = openDb(join(dir, 'cell.db')));
  const b = new Bindings(db, { ...X, cell: { id: 'cell-1', ...cell } });
  n = createIngest({ mode: 'cell', db, fresh: false, seatKey: b.seatKey, acceptBinds: (x) => b.acceptAll(x), cell, forms, formOf: devForm, pseud: devPseud });
  const key = newKeyPair();
  const e = b.enrol(simBindReq('C0001', key, cell.pub, 'CEN042-S01'), true);
  if (!e.ok) throw new Error(e.error);
  const seat = new SimSeat(keys, 'C0001', cell.pub, 1, key);
  seat.add(21); seat.submit();
  const r = await n.sync({ entries: seat.entries, streams: [{ ...seat.ctx, head: seat.head }] });
  if (r === 'REBUILDING' || r.rejected.length) throw new Error(JSON.stringify(r));
  const nf = () => Response.json({ error: 'not found' }, { status: 404 });
  const cellSrv = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: nf, routes: {
    '/v1/shift': { GET: () => Response.json(shiftExport(db, { ...X, cell: 'cell-1', formOf: devForm, pseud: devPseud, seatKey: b.seatKey })) },
  } });
  const relaySrv = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: nf, routes: {
    '/v1/heads': { GET: () => Response.json({ mode: 'relay', state: 'LIVE', streams: [{ ...seat.ctx, head: seat.head, cellHead: seat.head, senderHead: seat.head, seenAt: 1 }] }) },
    '/v1/dev/wan': { POST: async (req) => { const body = await req.json(); wan.push(body); return Response.json(body); } },
  } });
  servers.push(cellSrv, relaySrv);
  const o = {
    authority: { priv: hexToBytes(keys.authority.priv), pub: hexToBytes(keys.authority.pub) }, trust: { ...trustFromKeys(keys), seats: {} },
    forms, formOf: devForm, pseud: devPseud, roster: devRoster(keys), centre: 'CEN042', ...X,
    cellUrl: `http://127.0.0.1:${cellSrv.port}`, relayUrl: `http://127.0.0.1:${relaySrv.port}`,
  };
  withKeys = controlRoutes({ ...o, dir: join(dir, 'c1'), seatKeys: async () => ({ 'C0001/1': toHex(key.pub) }) }, page) as unknown as Routes;
  bare = controlRoutes({ ...o, dir: join(dir, 'c2') }, page) as unknown as Routes;
});
afterAll(() => { for (const s of servers) s.stop(true); n.close(); rmSync(dir, { recursive: true, force: true }); });

async function call<T>(r: Routes, path: string, method: 'GET' | 'POST', body?: unknown): Promise<{ status: number; body: T }> {
  const res = await r[path][method]!(new Request(`http://control${path}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }), { timeout() {} });
  return { status: res.status, body: (await res.json()) as T };
}

test('Stage 3 trust: seal, audit and reconciliation use the enrolled key; without it the candidate is not sealed', async () => {
  expect((await call<{ added: string[]; skipped: { cand: string }[] }>(bare, '/v1/seal', 'POST')).body).toMatchObject({ added: [], skipped: [{ cand: 'C0001' }] });
  expect((await call<{ added: string[] }>(withKeys, '/v1/seal', 'POST')).body.added).toEqual(['C0001']);
  expect((await call<{ findings: unknown[] }>(withKeys, '/v1/audit', 'POST')).body.findings).toEqual([]);
  expect((await call<ReconRow>(withKeys, '/v1/recon', 'GET')).body).toMatchObject({ checkedIn: 1, unlocked: 1, leaves: 1, green: true });
});

test('chaos: "Cut Centre 42\'s link" reaches the relay and is logged; a bad body is 400', async () => {
  expect((await call(withKeys, '/v1/chaos/wan', 'POST', { up: false })).body).toEqual({ up: false });
  expect(wan).toEqual([{ up: false }]);
  expect((await call(withKeys, '/v1/chaos/wan', 'POST', { up: 'no' })).status).toBe(400);
  expect(readFileSync(join(dir, 'c1', 'custody.jsonl'), 'utf8')).toContain('"action":"chaos-wan"');
});
```

Append to `apps/server/test/recon.test.ts`:
```ts
test('Stage 3: with bindings, "checked in" counts the bound candidates on the roster', () => {
  const { exp, relay } = shift();
  const r = reconcile({ ...base, relay, cell: exp, rec: seal(undefined, exp, o).rec, bound: ['C0001', 'C0003', 'X9'] });
  expect([r.checkedIn, r.green]).toEqual([2, true]);
});
```

Append to `apps/server/test/main.test.ts` (binds ports: sandbox disabled; add the imports):
```ts
import { readFileSync, writeFileSync } from 'node:fs';
import { hexToBytes } from '@saakshi/core/bytes';
import type { KeysFile } from '@saakshi/core/dev';
import { FILES } from '@saakshi/core/directory';
import { newKeyPair, verifier } from '@saakshi/core/node';
import { openPolicy } from '@saakshi/core/policy';
import { buildPackage, writePackage } from '../../../tools/package.ts';
import { provision } from '../../../tools/provision.ts';
import { simBindReq } from '../../../tools/sim-custody.ts';

const KEYS = JSON.parse(readFileSync(new URL('../../../fixtures/keys.json', import.meta.url), 'utf8')) as KeysFile;
const paperFx = (f: string) => JSON.parse(readFileSync(new URL(`../../../fixtures/paper/${f}`, import.meta.url), 'utf8'));
async function examDir(dir: string): Promise<string> {
  const out = join(dir, 'exam');
  const d = provision({ out, keys: KEYS, cands: [{ cand: 'C00001', centre: 'CEN001', form: 'F1', pwd: 0 }], cellUrls: ['http://127.0.0.1:9', 'http://127.0.0.1:9', 'http://127.0.0.1:9'] });
  writePackage(out, await buildPackage(d, { bank: paperFx('bank.json'), forms: paperFx('forms.json') }, { priv: hexToBytes(KEYS.authority.priv), pub: hexToBytes(KEYS.authority.pub) }));
  return out;
}
const post = (url: string, body: unknown) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('EXAM: a cell boots with its certified key file, enrols a seat of its centre, and reports per-centre stats', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'saakshi-main-'));
  const p = Bun.spawn(['bun', MAIN], { cwd: dir, stdout: 'pipe', stderr: 'pipe', env: { ...process.env, MODE: 'cell', DEV: '1', PORT: '0', DB: join(dir, 'c.db'), EXAM: await examDir(dir), CELL_ID: 'cell-1' } });
  try {
    const u = `http://127.0.0.1:${(await ready(p.stdout)).port}`;
    await post(`${u}/v1/sync`, { entries: [], streams: [], replay: true, done: true });            // a fresh cell rebuilds until a relay says done
    const r = (await (await post(`${u}/v1/enrol`, { enrols: [simBindReq('C0001', newKeyPair(), hexToBytes(KEYS.cells[0].pub))] })).json()) as { results: { ok: boolean }[] };
    expect(r.results[0].ok).toBe(true);
    const s = (await (await fetch(`${u}/v1/stats`)).json()) as { centres: Record<string, { registered: number; bound: number }> };
    expect(Object.keys(s.centres).sort()).toEqual(['CEN001', 'CEN042']);
    expect(s.centres.CEN042).toMatchObject({ registered: 8, bound: 1 });
  } finally { p.kill(); await p.exited; rmSync(dir, { recursive: true, force: true }); }
});

test('EXAM: a cell refuses to start with a key file the directory does not certify', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'saakshi-main-')), exam = await examDir(dir);
  const f = join(exam, FILES.cellKey('cell-1'));
  writeFileSync(f, JSON.stringify({ ...JSON.parse(readFileSync(f, 'utf8')), pub: KEYS.cells[1].pub }));
  const p = Bun.spawn(['bun', MAIN], { cwd: dir, stdout: 'pipe', stderr: 'pipe', env: { ...process.env, MODE: 'cell', DEV: '1', PORT: '0', DB: join(dir, 'c.db'), EXAM: exam } });
  try {
    expect(await p.exited).not.toBe(0);
    expect(await new Response(p.stderr).text()).toContain('is not the key the directory certifies');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('EXAM: a relay serves its centre\'s signed package, and with no reachable cell answers enrolment as provisional', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'saakshi-main-'));
  const p = Bun.spawn(['bun', MAIN], { cwd: dir, stdout: 'pipe', stderr: 'pipe', env: { ...process.env, MODE: 'relay', DEV: '1', PORT: '0', HOST: '127.0.0.1', DB: join(dir, 'r.db'), EXAM: await examDir(dir), CENTRE: 'CEN042' } });
  try {
    const u = `http://127.0.0.1:${(await ready(p.stdout)).port}`;
    const pkg = (await (await fetch(`${u}/v1/package`)).json()) as { policy: { text: string; sig: string } };
    expect(openPolicy(pkg.policy, verifier(hexToBytes(KEYS.authority.pub)), { exam: 'DEMO-2026', shift: 'S1' }).centre).toBe('CEN042');
    const r = await post(`${u}/v1/enrol`, simBindReq('C0001', newKeyPair(), hexToBytes(KEYS.cells[0].pub)));
    expect([r.status, ((await r.json()) as { provisional: boolean }).provisional]).toEqual([202, true]);
    expect(await (await fetch(`${u}/release/current`)).json()).toEqual({ releases: [] });
  } finally { p.kill(); await p.exited; rmSync(dir, { recursive: true, force: true }); }
});

test('EXAM: control serves /custodian, its release key, the public manifest and the fleet view (cells down)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'saakshi-main-')), exam = await examDir(dir);
  const p = Bun.spawn(['bun', MAIN], { cwd: dir, stdout: 'pipe', stderr: 'pipe', env: { ...process.env, MODE: 'control', DEV: '1', PORT: '0', DIR: join(dir, 'control'), EXAM: exam, RELAY_URL: 'http://127.0.0.1:9' } });
  try {
    const u = `http://127.0.0.1:${(await ready(p.stdout)).port}`;
    expect(await (await fetch(`${u}/custodian`)).text()).toContain('Custodian — release the paper');
    expect(((await (await fetch(`${u}/v1/release/key`)).json()) as { keyId: string }).keyId).toMatch(/^[0-9a-f]{16}$/);
    expect(await (await fetch(`${u}/v1/manifest`)).json()).toEqual(JSON.parse(readFileSync(join(exam, FILES.manifest), 'utf8')));
    await Bun.sleep(2500);
    expect(((await (await fetch(`${u}/v1/fleet`)).json()) as { cells: { state: string }[] }).cells.map((c) => c.state)).toEqual(['DOWN', 'DOWN', 'DOWN']);
  } finally { p.kill(); await p.exited; rmSync(dir, { recursive: true, force: true }); }
});
```

- [ ] **Step 2: Run them to verify they fail**

Run (sandbox disabled): `bun test --timeout 60000 apps/server/test/exam-env.test.ts apps/server/test/control-stage3.test.ts apps/server/test/recon.test.ts apps/server/test/main.test.ts`
Expected: FAIL — `../src/exam-env.ts` cannot be found; `seatKeys`, `bound` and `/v1/chaos/wan` do not exist; `EXAM` is ignored.

- [ ] **Step 3: Write `apps/server/src/exam-env.ts`**

```ts
// Loads an exam directory written by tools/provision.ts and tools/package.ts, checking every certificate and the manifest against
// the exam authority's key. A node refuses to start on a directory that does not verify.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { hexToBytes } from '@saakshi/core/bytes';
import { FILES, type CellEntry, type CellKeyFile, type Directory } from '@saakshi/core/directory';
import { cellKeyArray, cellKeyId, msg } from '@saakshi/core/enrol';
import { verifier } from '@saakshi/core/node';
import { checkManifest, type SignedManifest } from '@saakshi/core/paper';
import type { SignedPolicy } from '@saakshi/core/policy';
import type { Verify } from '@saakshi/core/sig';

export interface ExamEnv { root: string; dir: Directory; manifest: SignedManifest; authority: Verify }
const readJson = <T>(root: string, rel: string): T => JSON.parse(readFileSync(join(root, rel), 'utf8')) as T;

export function loadExam(root: string, authorityPub: Uint8Array): ExamEnv {
  const authority = verifier(authorityPub);
  const dir = readJson<Directory>(root, FILES.directory);
  const manifest = readJson<SignedManifest>(root, FILES.manifest);
  const m = checkManifest(manifest, authority);
  if (m.exam !== dir.exam || m.shift !== dir.shift) throw new Error(`the package is for ${m.exam} ${m.shift}, the directory for ${dir.exam} ${dir.shift}`);
  for (const c of dir.cells) {
    const ok = cellKeyId(hexToBytes(c.pub)) === c.keyId && /^[0-9a-f]{128}$/.test(c.cert)
      && authority(msg(cellKeyArray({ exam: dir.exam, cellId: c.id, keyId: c.keyId, pub: c.pub })), hexToBytes(c.cert));
    if (!ok) throw new Error(`the certificate for ${c.id} does not verify`);
  }
  return { root, dir, manifest, authority };
}

/** A cell's private key: from its key file (outside the DB), which must hold exactly the key the directory certifies. */
export function loadCellKey(env: ExamEnv, id: string): { id: string; keyId: string; priv: Uint8Array; pub: Uint8Array } {
  const e = env.dir.cells.find((c) => c.id === id);
  if (!e) throw new Error(`no cell ${id} in the directory`);
  const f = readJson<CellKeyFile>(env.root, FILES.cellKey(id));
  if (f.pub !== e.pub || f.keyId !== e.keyId) throw new Error(`${FILES.cellKey(id)} is not the key the directory certifies`);
  return { id, keyId: f.keyId, priv: hexToBytes(f.priv), pub: hexToBytes(f.pub) };
}

/** What a centre's relay holds: its signed policy, both paper ciphertexts, its own wrap W_c, and its cell's entry. */
export function relayFiles(env: ExamEnv, centre: string): { policy: SignedPolicy; papers: Record<string, Uint8Array>; wrap: Uint8Array; cell: CellEntry } {
  const c = env.dir.centres[centre];
  if (!c) throw new Error(`no centre ${centre} in the directory`);
  const wraps = readJson<Record<string, string>>(env.root, FILES.wraps);
  if (!wraps[centre]) throw new Error(`the package has no wrap for ${centre}`);
  const papers = Object.fromEntries(env.manifest.manifest.forms.map((f) => [f.form, new Uint8Array(readFileSync(join(env.root, FILES.paper(f.form))))]));
  return { policy: readJson<SignedPolicy>(env.root, FILES.policy(centre)), papers, wrap: hexToBytes(wraps[centre]), cell: env.dir.cells.find((x) => x.id === c.cell)! };
}

export const codesFile = (env: ExamEnv): Uint8Array => new Uint8Array(readFileSync(join(env.root, FILES.codes)));
```

- [ ] **Step 4: Edit `apps/server/src/recon.ts` and `apps/server/src/control.ts`**

`recon.ts`: add `bound?: string[]` to `ReconIn`, and replace the `checkedIn:` line with:
```ts
    // Stage 3: checked in = bound (a cell-signed certificate); DEV without enrolment: the relay heard the seat.
    checkedIn: i.bound ? i.bound.filter((c) => i.roster.includes(c)).length : relay.filter((v) => v.senderHead >= 0 && i.roster.includes(v.cand)).length,
```

`control.ts`:
- `ControlOpts`: add `/** Stage 3: the demo cell's enrolled seat keys (\`${cand}/${keyEpoch}\` → pub), each already checked against that cell's certificate. */ seatKeys?: () => Promise<Record<string, string>>;`.
- After `upstream`, add:
```ts
  const seats = async (): Promise<Record<string, string> | undefined> => {
    if (!o.seatKeys) return undefined;
    try { return await o.seatKeys(); } catch (e) { throw new HttpError(502, `the cell's bindings are unavailable: ${(e as Error).message}`); }
  };
  const trustNow = async (): Promise<Trust> => { const s = await seats(); return s ? { ...o.trust, seats: { ...o.trust.seats, ...s } } : o.trust; };
```
- Replace `trust: o.trust` with `trust: await trustNow()` in `findings()`, in `/v1/seal` and in `/v1/evidence`'s `buildPack`.
- In `/v1/recon`:
```ts
      const [cell, relay, s] = await Promise.all([cellExport(), relayHeads(), seats()]);
      const bound = s && Object.keys(s).filter((k) => k.endsWith('/1')).map((k) => k.slice(0, -2));
      return json(reconcile({ centre: o.centre, exam: o.exam, shift: o.shift, roster: o.roster, relay, cell, rec: readRec(), bound }));
```
- Add a route:
```ts
    '/v1/chaos/wan': { POST: handle(async (req) => {
      const b = (await req.json().catch(() => ({}))) as { up?: unknown };
      if (typeof b.up !== 'boolean') throw new HttpError(400, 'need {up: boolean}');
      const out = await upstream<{ up: boolean }>(`${o.relayUrl}/v1/dev/wan`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ up: b.up }) });
      custody('chaos-wan', { centre: o.centre, up: b.up, note: "DEV chaos: the demo centre's WAN link" });
      return json(out);
    }) },
```

- [ ] **Step 5: Replace `apps/server/src/main.ts`**

```ts
// Saakshi server: MODE=relay|cell|control, DEV=1 only. With EXAM=<dir> (Stage 3) keys, roster, policy and paper come from the
// provisioned and packaged exam directory, and seats are trusted only through cell-signed bindings. Without EXAM, every mode
// behaves exactly as in Stage 2 (fixture seat keys, DEV roster): the Stage 1–2 tests and tools rely on that.
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { hexToBytes } from '@saakshi/core/bytes';
import { cellKey, DEV_CENTRE, DEV_EXAM, devForm, devPseud, devRoster, devSeat, devSeatKey, trustFromKeys, type KeysFile } from '@saakshi/core/dev';
import { rosterOf } from '@saakshi/core/directory';
import { checkWireBind, type WireBind } from '@saakshi/core/enrol';
import { verifier } from '@saakshi/core/node';
import { formsOf } from '@saakshi/core/sheet';
import { Bindings } from './bindings.ts';
import { cellRoutes } from './cell-routes.ts';
import consoleHtml from './console.html';
import controlHtml from './control.html';
import { controlRoutes } from './control.ts';
import custodianHtml from './custodian.html';
import { codesFile, loadCellKey, loadExam, relayFiles } from './exam-env.ts';
import { fleet } from './fleet.ts';
import { Forwarder, httpCellSend } from './forward.ts';
import { createIngest } from './ingest.ts';
import { relayRoutes, Wan } from './relay-routes.ts';
import { releaseControl } from './release-control.ts';
import { ReleaseStore } from './release-store.ts';
import { heads, serve, type Routes } from './serve.ts';
import { rogueEdit, type RogueIn, shiftExport } from './sheet-export.ts';
import { Hub } from './sse.ts';
import { openDb, pragmas } from './store.ts';

const env = process.env;
const mode = env.MODE;
if (mode !== 'cell' && mode !== 'relay' && mode !== 'control') { console.error('MODE must be cell, relay or control'); process.exit(2); }
if (env.DEV !== '1') { console.error('Saakshi runs only with DEV=1 (demo keys; see docs/threat-model.md)'); process.exit(2); }
// ponytail: cell and control have unauthenticated routes (/v1/shift, the DEV rogue edit, /v1/enrol, /v1/release) until control↔cell
// auth (S7 mTLS) lands, so they refuse to bind anywhere but loopback. Only the relay faces the centre LAN.
const LOOPBACK = ['127.0.0.1', 'localhost', '::1'];
if (mode !== 'relay' && env.HOST && !LOOPBACK.includes(env.HOST)) {
  console.error(`MODE=${mode} must bind loopback until control↔cell auth exists (got HOST=${env.HOST})`); process.exit(2);
}

const fixtures = resolve(import.meta.dir, '../../../fixtures');
const keys = (await Bun.file(env.KEYS ?? `${fixtures}/keys.json`).json()) as KeysFile;
const forms = formsOf(await Bun.file(env.FORMS ?? `${fixtures}/paper/forms.json`).json());
const authorityPub = hexToBytes(keys.authority.pub);
const X = env.EXAM ? loadExam(resolve(env.EXAM), authorityPub) : undefined;       // throws (exit ≠ 0) if anything fails to verify
const exam = X ? { exam: X.dir.exam, shift: X.dir.shift } : { exam: DEV_EXAM.exam, shift: DEV_EXAM.shift };
const formOf = (cand: string) => (X ? X.dir.cands[cand]?.form : devSeat(keys, cand) ? devForm(cand) : undefined);
const pseud = (cand: string) => (X ? X.dir.cands[cand]?.pseud ?? '' : devPseud(cand));
const json = (body: unknown, status = 200) => Response.json(body, { status });

if (mode === 'control') {
  const dir = resolve(env.DIR ?? 'data/control');
  const authority = { priv: hexToBytes(keys.authority.priv), pub: authorityPub };
  const demo = X?.dir.demoCentre ?? DEV_CENTRE;
  const demoCell = X?.dir.cells.find((c) => c.id === X.dir.centres[demo]?.cell);
  const cellUrl = env.CELL_URL ?? demoCell?.url ?? 'http://127.0.0.1:7080';
  const seatKeys = demoCell && (async () => {
    const r = await fetch(`${cellUrl}/v1/binds`, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) throw new Error(`${cellUrl}/v1/binds answered ${r.status}`);
    const out: Record<string, string> = {};
    for (const wb of ((await r.json()) as { binds: WireBind[] }).binds) {
      try { const b = checkWireBind(wb, hexToBytes(demoCell.pub), verifier); out[`${b.cand}/${b.keyEpoch}`] = b.pub; } catch { /* not certified by that cell: not trusted */ }
    }
    return out;
  });
  const rc = X && releaseControl({ dir, ...exam, authority, manifest: X.manifest, codes: codesFile(X), cells: X.dir.cells.map((c) => ({ id: c.id, url: c.url })) });
  const fl = X && fleet({ dir: X.dir });
  fl?.start();
  const server = Bun.serve({
    port: Number(env.PORT ?? 7090),
    hostname: env.HOST ?? '127.0.0.1',
    maxRequestBodySize: 64 * 1024,
    routes: {
      ...controlRoutes({
        dir, authority, forms, formOf, pseud, ...exam, centre: demo, cellUrl, relayUrl: env.RELAY_URL ?? 'http://127.0.0.1:7070',
        trust: X ? { ...trustFromKeys(keys), seats: {} } : trustFromKeys(keys),              // EXAM: seat keys come only from cell-signed bindings
        seatKeys, roster: X ? rosterOf(X.dir, demo) : devRoster(keys),
      }, controlHtml),
      ...rc?.routes,
      ...fl?.routes,
      ...(X ? { '/custodian': custodianHtml } : {}),
    },
    fetch: () => json({ error: 'not found' }, 404),
  });
  console.log(`READY ${JSON.stringify({ mode, port: server.port, state: 'LIVE', exam: X?.root ?? null })}`);
  const stop = () => { fl?.stop(); rc?.close(); server.stop(true); process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
} else {
  const dbPath = resolve(env.DB ?? `data/${mode}.db`);
  mkdirSync(dirname(dbPath), { recursive: true });
  const { db, fresh } = openDb(dbPath);
  const p = pragmas(db);
  if (p.journal_mode !== 'wal' || p.synchronous !== 2 || (process.platform === 'darwin' && p.fullfsync !== 1)) {
    console.error('durability pragmas did not apply (try Database.setCustomSQLite with Homebrew sqlite)', p);
    process.exit(3);
  }
  const centre = env.CENTRE ?? X?.dir.demoCentre ?? DEV_CENTRE;
  const rf = X && mode === 'relay' ? relayFiles(X, centre) : undefined;
  // The cell's key lives outside its DB: the certified key file (EXAM) or the fixture keys file (DEV).
  const cell = mode === 'cell'
    ? (X ? loadCellKey(X, env.CELL_ID ?? 'cell-1') : cellKey(keys, env.CELL_ID ?? 'cell-1'))
    : { id: rf?.cell.id ?? 'cell-1', pub: rf ? hexToBytes(rf.cell.pub) : cellKey(keys, 'cell-1').pub };
  const cellUrl = env.CELL_URL ?? rf?.cell.url ?? 'http://127.0.0.1:7080';
  const bindings = X ? new Bindings(db, { ...exam, cell }) : undefined;
  const releaseHub = new Hub(() => ({ releases: releases?.list() ?? [] }));
  const releases = X ? new ReleaseStore(db, { ...exam, manifest: X.manifest.manifest, authority: X.authority, requireSig: mode === 'cell', onNew: (r) => releaseHub.publish('release', r) }) : undefined;
  const seatKey = bindings ? bindings.seatKey : devSeatKey(keys);                       // EXAM: only cell-certified seat keys, never the fixtures

  let hub: Hub | undefined;
  const ingest = createIngest({
    mode, db, fresh, seatKey,
    acceptBinds: bindings && ((b) => bindings.acceptAll(b)),
    releases: mode === 'cell' && releases ? () => releases.list() : undefined,
    cell: mode === 'cell' ? cell : { pub: cell.pub },
    rebuildRelays: Number(env.REBUILD_RELAYS ?? 1),
    forms, formOf, pseud, cellId: cell.id,
    onView: (v) => hub?.publish('stream', v),
    onState: (s) => hub?.publish('state', { state: s }),
  });
  hub = new Hub(() => heads(ingest));
  const wan = new Wan();
  const modeRoutes: Routes = mode === 'cell' ? {
    '/v1/shift': { GET: (req) => {
      const u = new URL(req.url), qExam = u.searchParams.get('exam'), qShift = u.searchParams.get('shift');
      if (!qExam || !qShift) return json({ error: 'need ?exam=&shift=' }, 400);
      return json(shiftExport(db, { exam: qExam, shift: qShift, cell: cell.id, formOf, pseud, seatKey }));
    } },
    // DEV chaos only — the "rogue insider" button. Prints the SQL so the cell's terminal shows the edit.
    '/v1/dev/rogue': { POST: async (req) => {
      const b = (await req.json().catch(() => null)) as RogueIn | null;
      if (!b || typeof b.exam !== 'string' || typeof b.shift !== 'string' || !Number.isSafeInteger(b.attempt) || typeof b.cand !== 'string'
        || typeof b.item !== 'string' || !['A', 'B', 'C', 'D'].includes(b.answer)) return json({ error: 'need {exam, shift, attempt, cand, item, answer}' }, 400);
      try { const r = rogueEdit(db, b); console.log(`ROGUE ${r.sql}`); return json(r); }
      catch (e) { return json({ error: (e as Error).message }, 404); }
    } },
    ...(X && bindings && releases ? cellRoutes({
      cellId: cell.id, dir: X.dir, bindings, releases, state: () => ingest.state(), views: () => ingest.views(),
      submitted: () => (db.query('SELECT cand FROM receipts WHERE exam = ? AND shift = ?').all(exam.exam, exam.shift) as { cand: string }[]).map((r) => r.cand),
    }) : {}),
  } : X && rf && bindings && releases
    ? relayRoutes({ ...exam, centre, policy: rf.policy, manifest: X.manifest, papers: rf.papers, wrap: rf.wrap, cellUrl, bindings, releases, hub: releaseHub, wan, dev: true })
    : {};
  const server = serve(ingest, hub, {
    port: Number(env.PORT ?? (mode === 'relay' ? 7070 : 7080)),
    hostname: env.HOST ?? (mode === 'relay' ? '0.0.0.0' : '127.0.0.1'),
    consoleHtml: mode === 'relay' ? consoleHtml : undefined,
    routes: modeRoutes,
  });
  const fwd = mode === 'relay'
    ? new Forwarder(ingest, wan.wrap(httpCellSend(cellUrl)), bindings && releases ? { releases, bindFor: (c) => bindings.get(c.cand, 1) } : {})
    : undefined;
  fwd?.start();

  console.log(`READY ${JSON.stringify({ mode, port: server.port, state: ingest.state(), db: dbPath, pragmas: p, exam: X?.root ?? null, ...(mode === 'relay' ? { centre } : {}) })}`);

  const stop = async () => { await fwd?.stop(); server.stop(true); ingest.close(); process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
```

- [ ] **Step 6: Run the whole server suite, the kill test, Act 4 and the typecheck** (sandbox disabled)

Run: `bun test --timeout 60000 apps/server && bun tools/chaos-kill.ts && bun tools/act4.ts && pnpm --filter @saakshi/server typecheck`
Expected: every test PASSes (Stage 1–2 unchanged); the kill test and `act4.ts` print `PASS`; typecheck exits 0.

---

### Task 17: Swarm v1 — simulated centres in one process, in memory, replaying G1

**Files:**
- Create: `tools/swarm.ts`
- Test: `apps/server/test/swarm.test.ts`

**Interfaces:**
- Consumes: Task 5 (`Bindings`, `ReleaseStore`, `ForwardOpts`), Task 6 (`cellRoutes`, in the test), Task 3 (`provision`, `readCohort`, `CohortRow`), Task 1 (`simBindReq`, `simCustody`, `checkRelease`, `Directory`), `createIngest`, `openDb`, `Forwarder`, `httpCellSend`, `sealBody`, `signedLine`, `responsesOf`, `finalHash`.
- Produces:
  - `plan(ctx, form, items, rows: CohortRow[]): Step[]` — a candidate's G1 rows as the entries a seat would journal, on G1's clock: form order, NV skipped, `A` → `answer`, `NA` → `clear`, `MR`/`AMR` → `mark`, then the `submit` with the replayed `finalHash`. `activeMs` = the cumulative dwell (monotonic).
  - `interface SwarmCell { send: CellSend; enrol(reqs: BindReq[]): Promise<EnrolResult[]> }`.
  - `Swarm.start(o: SwarmOpts): Promise<Swarm>` with `SwarmOpts { dir; manifest; authorityPub; rows: Iterable<CohortRow>; forms; cell(id): SwarmCell; speed?; tickMs? }`; `swarm.stats(): { centres; cands; bound; unlocked; done; sent; rejected; enrolFailed }`; `swarm.stop()`.
  - Each simulated centre is the **real relay code**: `createIngest('relay')` on `:memory:`, `Bindings`, `ReleaseStore`, `Forwarder` (with `releases` and `bindFor`). Simulated seats enrol (a batch per centre, through the cell's `/v1/enrol`), wait for the release, run the seat's own `checkRelease`, journal the unlock (`[form, kc_f, via]`), then their G1 answers at `speed` × real time. The demo centre and its G1 rows are skipped.
  - CLI: `bun tools/swarm.ts --exam data/exam --cohort data/g1/cohort.jsonl [--speed 20]` prints `SWARM {…stats}` every 2 s.

- [ ] **Step 1: Write the failing test**

`apps/server/test/swarm.test.ts` (in-process cells; no ports):
```ts
import { afterAll, beforeAll, expect, test } from 'bun:test';
import type { Database } from 'bun:sqlite';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hexToBytes } from '@saakshi/core/bytes';
import type { KeysFile } from '@saakshi/core/dev';
import type { CellStats, Directory } from '@saakshi/core/directory';
import type { BindReq } from '@saakshi/core/enrol';
import { verifier } from '@saakshi/core/node';
import { formsOf } from '@saakshi/core/sheet';
import { Bindings, type EnrolResult } from '../src/bindings.ts';
import { cellRoutes } from '../src/cell-routes.ts';
import { createIngest, type Ingest } from '../src/ingest.ts';
import { ReleaseStore } from '../src/release-store.ts';
import { openDb } from '../src/store.ts';
import type { CohortRow } from '../../../tools/cohort.ts';
import { provision } from '../../../tools/provision.ts';
import { simCustody } from '../../../tools/sim-custody.ts';
import { plan, Swarm } from '../../../tools/swarm.ts';
import { FORMS } from '../../../tools/sim-seat.ts';

const keys = JSON.parse(readFileSync(new URL('../../../fixtures/keys.json', import.meta.url), 'utf8')) as KeysFile;
const forms = formsOf(FORMS), cust = simCustody(keys), A = verifier(hexToBytes(keys.authority.pub));
const STATES = ['A', 'A', 'NA', 'MR', 'AMR', 'NV', 'A'] as const;
/** 3 simulated centres × 4 candidates, 20 demo items each (the G1 shape, small), plus rows at CEN042 that must be skipped. */
function cohort(): CohortRow[] {
  const rows: CohortRow[] = [];
  let k = 0;
  for (const centre of ['CEN001', 'CEN002', 'CEN003', 'CEN042']) for (let i = 0; i < 4; i++) {
    const cand = `C9${String(++k).padStart(4, '0')}`, form = k % 2 ? 'F1' : 'F2';
    forms[form].forEach((item, j) => {
      const state = STATES[(k + j) % STATES.length];
      rows.push({ cand, centre, shift: 'S1', form, lang: 'en', pwd: 0, item, state, answer: state === 'A' || state === 'AMR' ? 'ABCD'[j % 4] : '', dwellMs: 20_000 + j * 1000, visits: 1, changes: 0, tFirstMs: -1 });
    });
  }
  return rows;
}
let tmp: string, dir: Directory, swarm: Swarm;
const cells: { id: string; db: Database; ingest: Ingest; releases: ReleaseStore; routes: ReturnType<typeof cellRoutes> }[] = [];

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'saakshi-swarm-'));
  const rows = cohort();
  dir = provision({ out: join(tmp, 'exam'), keys, cands: [...new Map(rows.map((r) => [r.cand, { cand: r.cand, centre: r.centre, form: r.form, pwd: r.pwd }])).values()] });
  for (const c of dir.cells) {
    const k = keys.cells.find((x) => x.id === c.id)!, cell = { id: c.id, priv: hexToBytes(k.priv), pub: hexToBytes(k.pub) };
    const { db } = openDb(join(tmp, `${c.id}.db`));
    const bindings = new Bindings(db, { exam: dir.exam, shift: dir.shift, cell });
    const releases = new ReleaseStore(db, { exam: dir.exam, shift: dir.shift, manifest: cust.manifest.manifest, authority: A, requireSig: true });
    const ingest = createIngest({ mode: 'cell', db, fresh: false, seatKey: bindings.seatKey, acceptBinds: (b) => bindings.acceptAll(b), releases: () => releases.list(),
      cell, forms, formOf: (x) => dir.cands[x]?.form, pseud: (x) => dir.cands[x]?.pseud ?? '', cellId: c.id });
    const routes = cellRoutes({ cellId: c.id, dir, bindings, releases, state: () => ingest.state(), views: () => ingest.views(),
      submitted: () => (db.query('SELECT cand FROM receipts').all() as { cand: string }[]).map((r) => r.cand) });
    cells.push({ id: c.id, db, ingest, releases, routes });
  }
  const cellOf = (id: string) => cells.find((c) => c.id === id)!;
  swarm = await Swarm.start({
    dir, manifest: cust.manifest, authorityPub: hexToBytes(keys.authority.pub), rows, forms, speed: 2000, tickMs: 20,
    cell: (id) => ({
      send: (req) => cellOf(id).ingest.sync(req),
      enrol: async (reqs: BindReq[]) => ((await (await cellOf(id).routes['/v1/enrol'].POST!(new Request('http://cell/v1/enrol', { method: 'POST', body: JSON.stringify({ enrols: reqs }) }), { timeout() {} })).json()) as { results: EnrolResult[] }).results,
    }),
  });
});
afterAll(async () => { await swarm.stop(); for (const c of cells) c.ingest.close(); rmSync(tmp, { recursive: true, force: true }); });
const stats = async (c: (typeof cells)[number]) => (await (await c.routes['/v1/stats'].GET!(new Request('http://cell/v1/stats'), { timeout() {} })).json()) as CellStats;
const receipts = () => cells.reduce((n, c) => n + (c.db.query('SELECT count(*) AS n FROM receipts').get() as { n: number }).n, 0);

test('plan: G1 rows become the seat\'s entries in form order, NV skipped, active time monotonic, ending in the replayed submit', () => {
  const rows = cohort().filter((r) => r.cand === 'C90001');
  const steps = plan({ exam: 'DEMO-2026', shift: 'S1', attempt: 1, cand: 'C90001' }, 'F1', forms.F1, rows);
  expect(steps.length).toBe(rows.filter((r) => r.state !== 'NV').length + 1);
  expect(steps.at(-1)!.kind).toBe('submit');
  expect(steps.map((s) => s.at)).toEqual([...steps.map((s) => s.at)].sort((a, b) => a - b));
  expect(steps.filter((s) => s.kind === 'clear').every((s) => s.body.state === 'NA' && s.body.answer === '')).toBe(true);
});

test('the swarm in miniature: every simulated seat enrols; nothing moves before the release; after it every centre goes green and every answer reaches its cell', async () => {
  expect(swarm.stats()).toMatchObject({ centres: 3, cands: 12, bound: 12, unlocked: 0, enrolFailed: 0 });
  await Bun.sleep(200);
  expect(cells.reduce((n, c) => n + c.ingest.views().filter((v) => v.head > 0).length, 0)).toBe(0);
  for (const c of cells) for (const f of ['F1', 'F2'] as const) expect(c.releases.accept(cust.release(f))).toBeUndefined();   // control's push
  for (let i = 0; i < 1000 && receipts() < 12; i++) await Bun.sleep(20);
  expect(receipts()).toBe(12);
  expect(swarm.stats()).toMatchObject({ unlocked: 12, done: 12, rejected: 0 });
  const tiles = (await Promise.all(cells.map(stats))).flatMap((s) => Object.entries(s.centres)).filter(([c]) => c !== 'CEN042');
  expect(tiles.map(([, t]) => [t.registered, t.unlocked, t.submitted])).toEqual(tiles.map(() => [4, 4, 4]));
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test --timeout 60000 apps/server/test/swarm.test.ts`
Expected: FAIL — `../../../tools/swarm.ts` cannot be found.

- [ ] **Step 3: Write `tools/swarm.ts`**

```ts
// Swarm v1 (plan §5 Stage 3): the simulated centres in ONE process, in memory, replaying the G1 cohort. Each simulated centre
// runs the real relay code — createIngest('relay') on an in-memory DB, Bindings, ReleaseStore and the Forwarder — so what reaches
// the cells is exactly what a real relay sends. Only the seats are simulated: they enrol, wait for the release, run the seat's
// own kc_f check, then journal their G1 answers on G1's clock, sped up. Cells are the real processes over HTTP (or in-process
// ones in tests). The demo centre is real, so its G1 rows are skipped.
//   bun tools/swarm.ts --exam data/exam --cohort data/g1/cohort.jsonl [--speed 20]
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { hexToBytes, randomBytes, toHex } from '../packages/core/src/bytes.ts';
import type { KeysFile } from '../packages/core/src/dev.ts';
import { FILES, type Directory } from '../packages/core/src/directory.ts';
import type { BindReq } from '../packages/core/src/enrol.ts';
import { signedLine } from '../packages/core/src/journal.ts';
import { responsesOf } from '../packages/core/src/log.ts';
import { newKeyPair, sealBody, signer, verifier, type KeyPair } from '../packages/core/src/node.ts';
import { checkRelease, type ReleaseMsg, type SignedManifest } from '../packages/core/src/paper.ts';
import { entryHash, finalHash, genesisPrev, type Body, type Ctx, type Header, type Kind } from '../packages/core/src/protocol.ts';
import { formsOf, type Forms } from '../packages/core/src/sheet.ts';
import type { Verify } from '../packages/core/src/sig.ts';
import { toB64, type WireEntry } from '../packages/core/src/wire.ts';
import { Bindings, type EnrolResult } from '../apps/server/src/bindings.ts';
import { Forwarder, httpCellSend, type CellSend } from '../apps/server/src/forward.ts';
import { createIngest, type Ingest } from '../apps/server/src/ingest.ts';
import { ReleaseStore } from '../apps/server/src/release-store.ts';
import { openDb } from '../apps/server/src/store.ts';
import { readCohort, type CohortRow } from './cohort.ts';
import { simBindReq } from './sim-custody.ts';

export interface Step { at: number; kind: Kind; body: Body }
const EMPTY: Body = { item: '', state: '', answer: '', meta: [] };

export function plan(ctx: Ctx, form: string, items: readonly string[], rows: CohortRow[]): Step[] {
  const pos = new Map(items.map((id, i) => [id, i]));
  const steps: Step[] = [];
  let t = 0;
  for (const r of [...rows].filter((x) => pos.has(x.item)).sort((a, b) => pos.get(a.item)! - pos.get(b.item)!)) {
    if (r.state === 'NV') continue;
    t += Math.max(1000, r.dwellMs);
    const kind: Kind = r.state === 'A' ? 'answer' : r.state === 'NA' ? 'clear' : 'mark';
    steps.push({ at: t, kind, body: { item: r.item, state: r.state, answer: r.state === 'A' || r.state === 'AMR' ? r.answer : '', meta: [r.dwellMs, []] } });
  }
  steps.push({ at: t + 1000, kind: 'submit', body: { ...EMPTY, meta: [form, finalHash(ctx, form, responsesOf(items, steps.map((s) => s.body)))] } });
  return steps;
}

export interface SwarmCell { send: CellSend; enrol(reqs: BindReq[]): Promise<EnrolResult[]> }
export interface SwarmOpts {
  dir: Directory; manifest: SignedManifest; authorityPub: Uint8Array; rows: Iterable<CohortRow>; forms: Forms;
  cell(id: string): SwarmCell; speed?: number; tickMs?: number;
}
interface Sim { ctx: Ctx; form: string; seat: KeyPair; sign: (m: Uint8Array) => Uint8Array; steps: Step[]; next: number; hs: string[]; t0: number; bound: boolean; unlocked: boolean }
interface Centre { id: string; cellId: string; cellPub: Uint8Array; ingest: Ingest; bindings: Bindings; fwd: Forwarder; sims: Sim[] }

export class Swarm {
  readonly centres: Centre[] = [];
  #o: SwarmOpts;
  #authority: Verify;
  #timer?: ReturnType<typeof setInterval>;
  #sent = 0;
  #rejected = 0;
  #enrolFailed = 0;

  private constructor(o: SwarmOpts) { this.#o = o; this.#authority = verifier(o.authorityPub); }

  static async start(o: SwarmOpts): Promise<Swarm> {
    const s = new Swarm(o);
    const byCand = new Map<string, CohortRow[]>();
    for (const r of o.rows) {
      const c = o.dir.cands[r.cand];
      if (!c || c.centre === o.dir.demoCentre || !o.forms[c.form]?.includes(r.item)) continue;
      let a = byCand.get(r.cand);
      if (!a) byCand.set(r.cand, (a = []));
      a.push(r);
    }
    const byCentre = new Map<string, string[]>();
    for (const cand of byCand.keys()) {
      const id = o.dir.cands[cand].centre;
      let a = byCentre.get(id);
      if (!a) byCentre.set(id, (a = []));
      a.push(cand);
    }
    for (const [id, cands] of [...byCentre].sort(([a], [b]) => a.localeCompare(b))) s.centres.push(s.#centre(id, cands, byCand));
    await Promise.all(s.centres.map((c) => s.#enrol(c)));
    s.#timer = setInterval(() => s.#tick(), o.tickMs ?? 100);
    return s;
  }

  stats() {
    let cands = 0, bound = 0, unlocked = 0, done = 0;
    for (const c of this.centres) for (const s of c.sims) { cands++; if (s.bound) bound++; if (s.unlocked) unlocked++; if (s.unlocked && s.next >= s.steps.length) done++; }
    return { centres: this.centres.length, cands, bound, unlocked, done, sent: this.#sent, rejected: this.#rejected, enrolFailed: this.#enrolFailed };
  }

  async stop(): Promise<void> {
    clearInterval(this.#timer);
    await Promise.all(this.centres.map((c) => c.fwd.stop()));
    for (const c of this.centres) c.ingest.close();
  }

  #centre(id: string, cands: string[], byCand: Map<string, CohortRow[]>): Centre {
    const o = this.#o, X = { exam: o.dir.exam, shift: o.dir.shift };
    const cellId = o.dir.centres[id].cell, cellPub = hexToBytes(o.dir.cells.find((c) => c.id === cellId)!.pub);
    const { db } = openDb(':memory:');                                                         // simulated centres live in memory
    const bindings = new Bindings(db, { ...X, cell: { id: cellId, pub: cellPub } });
    const releases = new ReleaseStore(db, { ...X, manifest: o.manifest.manifest, authority: this.#authority, onNew: (r) => this.#unlock(id, r) });
    const ingest = createIngest({ mode: 'relay', db, fresh: false, seatKey: bindings.seatKey, acceptBinds: (b) => bindings.acceptAll(b), cell: { pub: cellPub } });
    const fwd = new Forwarder(ingest, o.cell(cellId).send, { releases, bindFor: (c) => bindings.get(c.cand, 1) });
    const sims = cands.map((cand): Sim => {
      const e = o.dir.cands[cand], ctx = { ...X, attempt: 1, cand }, seat = newKeyPair();
      return { ctx, form: e.form, seat, sign: signer(seat), steps: plan(ctx, e.form, o.forms[e.form], byCand.get(cand)!), next: 0, hs: [], t0: 0, bound: false, unlocked: false };
    });
    fwd.start();
    return { id, cellId, cellPub, ingest, bindings, fwd, sims };
  }

  /** One batch per 500 seats through the cell's /v1/enrol, retried while the cell is still starting (503 or unreachable). */
  async #enrol(c: Centre): Promise<void> {
    for (let i = 0; i < c.sims.length; i += 500) {
      const batch = c.sims.slice(i, i + 500);
      const reqs = batch.map((s) => simBindReq(s.ctx.cand, s.seat, c.cellPub, `${c.id}-SIM`, s.ctx));
      let res: EnrolResult[] | undefined;
      for (let attempt = 0; attempt < 20 && !res; attempt++) {
        try { res = await this.#o.cell(c.cellId).enrol(reqs); } catch { await new Promise((r) => setTimeout(r, 500)); }
      }
      if (!res) { this.#enrolFailed += batch.length; continue; }
      res.forEach((r, j) => { if (r.ok && !c.bindings.accept(r.bind)) batch[j].bound = true; else this.#enrolFailed++; });
    }
  }

  /** The release reached this centre's relay: every bound seat runs the seat's own check, then journals its unlock. */
  #unlock(centreId: string, r: ReleaseMsg): void {
    const c = this.centres.find((x) => x.id === centreId);
    if (!c) return;
    const now = Date.now();
    for (const s of c.sims) {
      if (s.unlocked || !s.bound || s.form !== r.form || !checkRelease(r, this.#o.manifest.manifest, s.form, this.#authority).ok) continue;
      s.unlocked = true;
      s.t0 = now;
      s.steps.unshift({ at: 0, kind: 'unlock', body: { ...EMPTY, meta: [s.form, r.kcf, r.via] } });
    }
  }

  #tick(): void {
    const speed = this.#o.speed ?? 20, now = Date.now();
    for (const c of this.centres) {
      const entries: WireEntry[] = [];
      for (const s of c.sims) {
        if (!s.unlocked) continue;
        const clock = (now - s.t0) * speed;
        while (s.next < s.steps.length && s.steps[s.next].at <= clock && entries.length < 500) entries.push(this.#entry(c, s, s.steps[s.next++]));
      }
      if (entries.length) void c.ingest.sync({ entries, streams: [] }).then((r) => {
        if (r === 'REBUILDING') return;
        this.#sent += entries.length - r.rejected.length;
        this.#rejected += r.rejected.length;
      });
    }
  }

  #entry(c: Centre, s: Sim, st: Step): WireEntry {
    const seq = s.hs.length + 1;
    const { envelope, bodyCommit } = sealBody(c.cellPub, { ...s.ctx, seq }, randomBytes(16), st.body);
    const h: Header = { ...s.ctx, keyEpoch: 1, seq, prev: s.hs.at(-1) ?? genesisPrev(s.ctx), kind: st.kind, tMonoMs: st.at, activeMs: st.at, bodyCommit };
    s.hs.push(toHex(entryHash(h)));
    return { line: signedLine(h, s.sign), env: toB64(envelope) };
  }
}

if (import.meta.main) {
  const arg = (f: string) => { const i = process.argv.indexOf(f); return i > 0 ? process.argv[i + 1] : undefined; };
  const root = resolve(arg('--exam') ?? 'data/exam'), cohort = arg('--cohort');
  if (!cohort) throw new Error('need --cohort <G1 cohort.jsonl>');
  const fx = resolve(import.meta.dirname, '../fixtures');
  const keys = JSON.parse(readFileSync(join(fx, 'keys.json'), 'utf8')) as KeysFile;
  const forms = formsOf(JSON.parse(readFileSync(join(fx, 'paper/forms.json'), 'utf8')));
  const dir = JSON.parse(readFileSync(join(root, FILES.directory), 'utf8')) as Directory;
  const manifest = JSON.parse(readFileSync(join(root, FILES.manifest), 'utf8')) as SignedManifest;
  const rows: CohortRow[] = [];
  for await (const r of readCohort(cohort)) if (dir.cands[r.cand] && forms[r.form]?.includes(r.item)) rows.push({ ...r, shift: dir.shift });   // G1's sittings merged into the demo shift
  const httpCell = new Map(dir.cells.map((c) => [c.id, {
    send: httpCellSend(c.url, 10_000),
    enrol: async (reqs: BindReq[]) => {
      const r = await fetch(`${c.url}/v1/enrol`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enrols: reqs }), signal: AbortSignal.timeout(30_000) });
      if (!r.ok) throw new Error(`${c.id} answered ${r.status}`);
      return ((await r.json()) as { results: EnrolResult[] }).results;
    },
  }]));
  const swarm = await Swarm.start({ dir, manifest, authorityPub: hexToBytes(keys.authority.pub), rows, forms, cell: (id) => httpCell.get(id)!, speed: Number(arg('--speed') ?? 20) });
  console.log(`SWARM ${JSON.stringify(swarm.stats())}`);
  const t = setInterval(() => console.log(`SWARM ${JSON.stringify(swarm.stats())}`), 2000);
  const stop = async () => { clearInterval(t); await swarm.stop(); process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
```
ponytail note for the reviewer: one tick loop drives every simulated seat and the relay CPU (sign + seal + verify ≈ 0.3 ms per entry) caps the swarm at a few thousand entries/s on one core; the entries/s tile shows what was actually reached. Split the swarm across processes if Stage 7 needs more.

- [ ] **Step 4: Run the test**

Run: `bun test --timeout 60000 apps/server/test/swarm.test.ts && pnpm --filter @saakshi/server typecheck`
Expected: PASS (2 tests); typecheck exits 0. (`tools/*.ts` are covered by the server package's `tsc` only through the test imports; that is enough.)

---

### Task 18: Act 2 end to end — `tools/act2.ts` — and CI

**Files:**
- Create: `tools/act2.ts`
- Modify: `.github/workflows/server.yml`

**Interfaces:**
- Consumes: the real server binary in all three modes with `EXAM` (Task 16), `provision`/`cohortCands` (Task 3), `buildPackage`/`writePackage`/`zeroise` (Task 4), `shareRequest` (Task 11, exactly what the custodian page runs), `Seat` (Task 14, the seat's own code), `Swarm` (Task 17), `readCohort`, `httpCellSend`.
- Produces: `bun tools/act2.ts [--cohort path]` prints one `✓` line per stage of Act 2, then `PASS`; it exits non-zero on the first failure. Without `--cohort` it generates a small G1 (`--n 300 --centres 6`) with `uv`. CI runs it on macOS.

- [ ] **Step 1: Write `tools/act2.ts`**

```ts
// Stage 3 end to end (Act 2) on real processes: provision → package → 3 cells + the Centre 42 relay + control; the swarm (a small
// G1) and a real seat at Centre 42 (the seat's own code) → cut Centre 42's link → two custodians release → every simulated centre
// goes green while Centre 42 stays locked → a typo and another centre's code fail → the phoned code unlocks Centre 42 → a forged
// key is rejected → a relay restart re-delivers the release without a second unlock → the link returns and the seat syncs.
// Needs local ports (run it unsandboxed) and uv (it generates a small G1 unless --cohort is given).
//   bun tools/act2.ts [--cohort path/to/cohort.jsonl]
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { hexToBytes } from '../packages/core/src/bytes.ts';
import { DEV_EXAM, type KeysFile } from '../packages/core/src/dev.ts';
import { FILES, type FleetView, type ReleaseStatus } from '../packages/core/src/directory.ts';
import type { BindReq } from '../packages/core/src/enrol.ts';
import { formsOf } from '../packages/core/src/sheet.ts';
import type { EnrolResult } from '../apps/server/src/bindings.ts';
import { shareRequest, type ReleaseKey } from '../apps/server/src/custodian-view.ts';
import { httpCellSend } from '../apps/server/src/forward.ts';
import type { Wrapper } from '../apps/seat/src/main/journal-store.ts';
import { Seat } from '../apps/seat/src/main/seat.ts';
import { readCohort, type CohortRow } from './cohort.ts';
import { buildPackage, writePackage, zeroise } from './package.ts';
import { cohortCands, provision } from './provision.ts';
import { Swarm } from './swarm.ts';

const root = resolve(import.meta.dir, '..');
const arg = (f: string) => { const i = process.argv.indexOf(f); return i > 0 ? process.argv[i + 1] : undefined; };
const read = (f: string) => JSON.parse(readFileSync(join(root, f), 'utf8'));
const keys = read('fixtures/keys.json') as KeysFile;
const forms = formsOf(read('fixtures/paper/forms.json'));
const authority = { priv: hexToBytes(keys.authority.priv), pub: hexToBytes(keys.authority.pub) };
const dir = mkdtempSync(join(tmpdir(), 'saakshi-act2-'));
const fail = (m: string): never => { throw new Error(m); };
const step = (m: string) => console.log(`✓ ${m}`);
const freePort = (): number => { const s = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Response() }); const p = s.port!; s.stop(true); return p; };

async function spawnServer(env: Record<string, string>) {
  const proc = Bun.spawn(['bun', join(root, 'apps/server/src/main.ts')], { cwd: dir, env: { ...process.env, DEV: '1', ...env }, stdout: 'pipe', stderr: 'inherit' });
  const out: string[] = [];
  void (async () => {
    const dec = new TextDecoder();
    let buf = '';
    for await (const chunk of proc.stdout) {
      buf += dec.decode(chunk);
      for (let i = buf.indexOf('\n'); i >= 0; i = buf.indexOf('\n')) { out.push(buf.slice(0, i)); buf = buf.slice(i + 1); }
    }
  })();
  const deadline = Date.now() + 15_000;
  while (!out.some((l) => l.startsWith('READY '))) {
    if (Date.now() > deadline) fail(`${env.MODE} did not start`);
    await Bun.sleep(20);
  }
  return { proc, out };
}
async function call<T>(url: string, method = 'GET', body?: unknown): Promise<T> {
  const r = await fetch(url, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  if (!r.ok) fail(`${method} ${url} → ${r.status} ${await r.text()}`);
  return (await r.json()) as T;
}
async function until(ok: () => boolean | Promise<boolean>, ms: number, what: string): Promise<void> {
  const end = Date.now() + ms;
  while (!(await ok())) { if (Date.now() > end) fail(`timed out: ${what}`); await Bun.sleep(100); }
}

// 0. A small G1 cohort, unless one is given.
let cohort = arg('--cohort');
if (!cohort) {
  const out = join(dir, 'g1');
  const g = Bun.spawnSync(['uv', 'run', '--directory', join(root, 'analytics'), 'python', '-m', 'saakshi_analytics.generate', out, '--n', '300', '--centres', '6', '--seed', '7'], { stdout: 'inherit', stderr: 'inherit' });
  if (g.exitCode !== 0) fail('uv could not generate the G1 cohort');
  cohort = join(out, 'cohort.jsonl');
}

const ports = { cells: [freePort(), freePort(), freePort()], relay: freePort(), control: freePort() };
const R = `http://127.0.0.1:${ports.relay}`, C = `http://127.0.0.1:${ports.control}`;
const exam = join(dir, 'exam');
const procs: { proc: ReturnType<typeof Bun.spawn> }[] = [];
let swarm: Swarm | undefined, seat: Seat | undefined;

try {
  // 1. Provision and package (the packager zeroises; the custodians keep their files and passphrases).
  const X = provision({ out: exam, keys, cands: await cohortCands(cohort), cellUrls: ports.cells.map((p) => `http://127.0.0.1:${p}`) });
  const pkg = await buildPackage(X, { bank: read('fixtures/paper/bank.json'), forms: read('fixtures/paper/forms.json') }, authority);
  writePackage(exam, pkg);
  const custodians = { NTA: { file: pkg.shares.NTA, pass: pkg.passphrases.NTA }, NIC: { file: pkg.shares.NIC, pass: pkg.passphrases.NIC } };
  zeroise(pkg);
  const sim = Object.keys(X.centres).filter((c) => c !== X.demoCentre);
  step(`provisioned ${Object.keys(X.cands).length} candidates at ${Object.keys(X.centres).length} centres (${sim.length} simulated + ${X.demoCentre}) on 3 cells; packaged; packager secrets zeroised`);

  // 2. Before T0 the paper is ciphertext.
  const ct = readFileSync(join(exam, FILES.paper('F1')));
  if ((read('fixtures/paper/bank.json') as { items: { en: { q: string } }[] }).items.some((i) => ct.includes(Buffer.from(i.en.q)))) fail('paper-F1.bin contains question text');
  console.log(`  hexdump package/paper-F1.bin: ${ct.subarray(0, 24).toString('hex').replace(/(.{4})/g, '$1 ')}…`);
  step('the paper on disk is ciphertext: no question text in it');

  // 3. The servers: three cells, Centre 42's relay, control.
  for (const [i, port] of ports.cells.entries()) procs.push(await spawnServer({ MODE: 'cell', PORT: String(port), EXAM: exam, CELL_ID: `cell-${i + 1}`, DB: join(dir, `cell-${i + 1}.db`) }));
  const relayEnv = { MODE: 'relay', PORT: String(ports.relay), HOST: '127.0.0.1', EXAM: exam, CENTRE: X.demoCentre, DB: join(dir, 'relay.db') };
  let relayP = await spawnServer(relayEnv);
  procs.push(relayP);
  procs.push(await spawnServer({ MODE: 'control', PORT: String(ports.control), EXAM: exam, DIR: join(dir, 'control'), RELAY_URL: R }));

  // 4. A real seat at Centre 42, run by the seat's own code (package → enrolment → release watcher → exam).
  const wrap: Wrapper = { encryptString: (s) => Buffer.from(s), decryptString: (b) => b.toString() };
  seat = new Seat({ dir: join(dir, 'seat'), relayUrl: R, ctx: { ...DEV_EXAM, cand: 'C0001' }, seatId: 'CEN042-S01', authorityPub: authority.pub, wrap, camera: false, testMode: true, retryMs: 200 });
  await seat.open();
  await until(() => seat!.boot().phase === 'enrol', 10_000, 'the seat loading its package');
  await seat.enrol({ pin: '482913', operatorId: 'GATE-42-OP7', method: 'aadhaar-face' });
  await until(() => seat!.boot().bind === 'bound', 20_000, 'the seat enrolment');
  if (seat.start().ok || seat.paper()) fail('the seat started before T0');
  step(`seat C0001 enrolled at ${X.demoCentre}: its bind certificate verified against the policy-pinned cell key; the paper stays locked`);

  // 5. The swarm: the simulated centres run the real relay code in this process; the cells are the real processes.
  const rows: CohortRow[] = [];
  for await (const r of readCohort(cohort)) if (X.cands[r.cand] && forms[r.form]?.includes(r.item)) rows.push({ ...r, shift: X.shift });
  swarm = await Swarm.start({ dir: X, manifest: pkg.manifest, authorityPub: authority.pub, rows, forms, speed: 200, cell: (id) => {
    const url = X.cells.find((c) => c.id === id)!.url;
    return {
      send: httpCellSend(url, 10_000),
      enrol: async (reqs: BindReq[]) => {
        const r = await fetch(`${url}/v1/enrol`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enrols: reqs }) });
        if (!r.ok) throw new Error(`${id} answered ${r.status}`);
        return ((await r.json()) as { results: EnrolResult[] }).results;
      },
    };
  } });
  const s0 = swarm.stats();
  if (!s0.cands || s0.bound !== s0.cands) fail(`swarm enrolment: ${JSON.stringify(s0)}`);
  step(`swarm: ${s0.centres} simulated centres, ${s0.cands} candidates enrolled`);

  // 6. Cut Centre 42's link (DEV chaos, through control).
  await call(`${C}/v1/chaos/wan`, 'POST', { up: false });
  step(`${X.demoCentre}'s link cut`);

  // 7. Two custodians release — exactly what /custodian runs in their browsers.
  const key = await call<ReleaseKey>(`${C}/v1/release/key`);
  for (const c of ['NTA', 'NIC'] as const) await call(`${C}/v1/release/share`, 'POST', shareRequest(custodians[c].file, custodians[c].pass, key));
  await until(async () => (await call<ReleaseStatus>(`${C}/v1/release/status`)).zeroised, 30_000, 'the release reaching every cell');
  const rs = await call<ReleaseStatus>(`${C}/v1/release/status`);
  step(`released by ${rs.released!.custodians.join(' + ')}; pushed to ${Object.keys(rs.pushed).join(', ')}; keys zeroised at control`);

  // 8. Every simulated centre goes green; Centre 42 stays locked.
  await until(async () => (await call<FleetView>(`${C}/v1/fleet`)).centres.filter((t) => t.centre !== X.demoCentre).every((t) => t.tone === 'green'), 90_000, 'every simulated centre green');
  const f1 = await call<FleetView>(`${C}/v1/fleet`);
  const t42 = f1.centres.find((t) => t.centre === X.demoCentre)!;
  if (t42.unlocked !== 0 || seat.paper()) fail(`${X.demoCentre} unlocked without its link: ${JSON.stringify(t42)}`);
  step(`${f1.centres.filter((t) => t.tone === 'green').length} of ${f1.centres.length} centres green; ${X.demoCentre} locked (link cut); ${f1.registered} candidates registered`);

  // 9. A code with a typo, and another centre's code, do not open Centre 42's paper.
  const other = await call<{ code: string }>(`${C}/v1/release/code`, 'POST', { centre: sim[0], superintendent: 'SUP-1', callback: true });
  const typo = other.code.slice(0, 5) + (other.code[5] === 'A' ? 'B' : 'A') + other.code.slice(6);
  for (const [code, want] of [[typo, /typo/], [other.code, /does not open/]] as const) {
    const r = await fetch(`${R}/v1/release/offline`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code }) });
    if (r.status !== 400 || !want.test(((await r.json()) as { error: string }).error)) fail(`the relay did not refuse ${code}`);
  }
  step(`a typo and ${sim[0]}'s code are refused at ${X.demoCentre}`);

  // 10. The superintendent phones in: control reveals only Centre 42's code (logged); the relay console unwraps and pushes it.
  const phoned = await call<{ code: string }>(`${C}/v1/release/code`, 'POST', { centre: X.demoCentre, superintendent: 'SUP-42', callback: true });
  await call(`${R}/v1/release/offline`, 'POST', { code: phoned.code.toLowerCase().replace(/(.{4})/g, '$1 ') });
  await until(() => seat!.boot().phase === 'ready', 20_000, 'the seat unlocking with the phoned code');
  if (seat.boot().release?.via !== 'code') fail('the seat did not record the offline path');
  if (!seat.start().ok) fail('start failed after the unlock');
  seat.paper()!.items.slice(0, 5).forEach((it, i) => seat!.act({ kind: 'answer', item: it.id, state: 'A', answer: 'ABCD'[i % 4], dwellMs: 1000 }));
  const meta = seat.exam!.journal.recs[0].body.meta;
  if (meta[2] !== 'code' || meta[1] !== rs.released!.forms.find((f) => f.form === 'F1')!.kcf) fail(`unlock meta ${JSON.stringify(meta)}`);
  step(`${X.demoCentre} unlocked with the phoned code: the seat checked kc_f and journaled the unlock via "code"`);

  // 11. A forged key is rejected by the seat.
  await call(`${R}/v1/dev/forge`, 'POST');
  await until(() => /Rejected a key/.test(seat!.boot().notice ?? ''), 10_000, 'the seat rejecting a forged key');
  step('a forged key pushed by the relay was rejected by the seat (it does not match kc_f)');

  // 12. The relay restarts: the seat reconnects (a new boot → a snapshot), the signed release arrives too; still one unlock.
  relayP.proc.kill();
  await relayP.proc.exited;
  relayP = await spawnServer(relayEnv);                                             // the DEV WAN switch is in memory: the link is back
  procs.push(relayP);
  await Bun.sleep(3000);
  const unlocks = seat.exam!.journal.headers.filter((h) => h.kind === 'unlock').length;
  if (unlocks !== 1) fail(`${unlocks} unlock entries after the relay restart`);
  step('relay restarted: the release reached the seat again by snapshot and by push; exactly one unlock');

  // 13. The link is back: the seat's answers reach its cell; the custody log records the fallback.
  await until(() => seat!.boot().sync.cell >= seat!.exam!.head(), 30_000, "the seat's entries reaching cell-1");
  const log = readFileSync(join(dir, 'control', 'custody.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { action: string; centre?: string });
  for (const a of ['chaos-wan', 'share-received', 'release', 'keys-zeroised', 'offline-code-revealed']) if (!log.some((l) => l.action === a)) fail(`the custody log lacks ${a}`);
  const reveals = log.filter((l) => l.action === 'offline-code-revealed').map((l) => l.centre);
  if (reveals.join() !== [sim[0], X.demoCentre].join()) fail(`reveals: ${reveals.join()}`);
  step(`custody log: 2 custodians released, keys zeroised, codes revealed for ${reveals.join(' and ')}, each logged`);

  // 14. The swarm's answers flow into the cells and every simulated candidate submits.
  await until(async () => (await call<FleetView>(`${C}/v1/fleet`)).submitted >= s0.cands, 120_000, 'every simulated candidate submitting');
  const f2 = await call<FleetView>(`${C}/v1/fleet`);
  step(`${f2.entries} entries committed at the cells; ${f2.submitted} candidates submitted`);
  console.log('PASS');
} finally {
  seat?.close();
  await swarm?.stop();
  for (const p of procs) p.proc.kill();
  await Promise.all(procs.map((p) => p.proc.exited));
  rmSync(dir, { recursive: true, force: true });
}
```

- [ ] **Step 2: Run it** (sandbox disabled)

Run: `bun tools/act2.ts`
Expected: fourteen `✓` lines (the provisioning line, the hexdump and every Act 2 stage), then `PASS`.

- [ ] **Step 3: CI**

In `.github/workflows/server.yml`:
- Add to both `paths` lists: `'analytics/src/**'`, `'analytics/pyproject.toml'`, `'analytics/uv.lock'`.
- Raise `timeout-minutes` to 25.
- After `oven-sh/setup-bun`, add `- uses: astral-sh/setup-uv@v6`.
- After the Act 4 step, add:
```yaml
      - name: Act 2 end to end (custodians release → simulated centres green → phoned code → kc_f checks)
        run: bun tools/act2.ts
```
`windows.yml` needs no change: its `paths` already cover the new files, and `pnpm -r test` runs the new core, server and seat tests on Windows (none of them bind ports except those that already did).

- [ ] **Step 4: Push and watch both workflows**

This is the controller's job, with the sandbox disabled (`.git` and the network). Push, then `gh run watch` for `server` and `windows`.
Expected: both green. If Windows fails on a path, line-ending or file-lock detail in a new test, fix the test rather than skipping it.

---

### Task 19: Stage 3 exit check, the claims ledger, and the Act 2 demo

**Files:**
- Create: `docs/evidence/stage3-*.png`, `docs/evidence/stage3-act2.txt`, `docs/evidence/stage3-hexdump.txt`, `docs/evidence/stage3-custody.txt`
- Modify: `docs/claims-ledger.md`, `docs/threat-model.md`
- Update: the memory file `saakshi-hackathon-plan.md`

**Interfaces:**
- Consumes: everything above.
- Produces: the evidence the user approves before Stage 4.

- [ ] **Step 1: Exit check** (sandbox disabled)

```bash
pnpm -r test && pnpm -r typecheck
bun test --timeout 60000 apps/server
bun tools/chaos-kill.ts
bun tools/act4.ts
bun tools/act2.ts | tee docs/evidence/stage3-act2.txt
(cd apps/seat && pnpm build) && ! grep -rq "SI unit of force" apps/seat/out && ! grep -rq '"priv"' apps/seat/out && echo "seat bundle: no plaintext paper, no private key"
```
Expected: everything passes; `act2.ts` and the other tools print `PASS`; the last line prints. The Stage 3 exit tests, by name:
- **A code works only for its own centre and shift:** `package.test.ts` "the code list opens with L; each centre's code unwraps only its own wrap, not another centre's, not another shift's"; `relay-routes.test.ts` "Review Focus #3 …"; `custody.test.ts` (Stage 0).
- **The release stays idempotent across SSE reconnects:** `relay-routes.test.ts` "exit check: the release to seats is idempotent across SSE reconnects …"; `release.test.ts` "the watcher … reconnects with Last-Event-ID"; `seat.test.ts` "Review Focus #4 …"; `act2.ts` step 12.
- **The seat checks `kc_f` on both paths:** `stage3-core.test.ts` "checkRelease (B.7) …"; `release.test.ts` "exit check — kc_f on both paths …"; `seat.test.ts` "exit check — kc_f on both paths …"; `act2.ts` steps 10–11.

- [ ] **Step 2: Start the stack on a clean slate**

These commands are for the controller or the user, outside the sandbox (`open` is blocked inside it). Keep the relay's terminal visible: it prints `OFFLINE-UNLOCK` and `FORGED-KEY`.
```bash
rm -rf data "$HOME/Library/Application Support/Saakshi/journal" "$HOME/Library/Application Support/Saakshi/test-mode.key"
uv run --directory analytics python -m saakshi_analytics.generate "$PWD/data/g1"                  # ≈20k candidates, ≈350 MB
bun tools/provision.ts --out data/exam --cohort data/g1/cohort.jsonl
bun tools/package.ts --exam data/exam | tee data/exam/PACKAGER-OUTPUT.dev.txt   # DEV only: a real packager prints the passphrases once, on paper
xxd data/exam/package/paper-F1.bin | head -4 | tee docs/evidence/stage3-hexdump.txt
DEV=1 MODE=cell CELL_ID=cell-1 PORT=7080 EXAM=data/exam DB=data/cell-1.db bun apps/server/src/main.ts &
DEV=1 MODE=cell CELL_ID=cell-2 PORT=7081 EXAM=data/exam DB=data/cell-2.db bun apps/server/src/main.ts &
DEV=1 MODE=cell CELL_ID=cell-3 PORT=7082 EXAM=data/exam DB=data/cell-3.db bun apps/server/src/main.ts &
DEV=1 MODE=relay EXAM=data/exam CENTRE=CEN042 DB=data/relay.db bun apps/server/src/main.ts &
DEV=1 MODE=control EXAM=data/exam bun apps/server/src/main.ts &
bun tools/swarm.ts --exam data/exam --cohort data/g1/cohort.jsonl --speed 20 &
(cd apps/seat && pnpm pack:mac)
IP=$(ipconfig getifaddr en0)
open apps/seat/release/mac-arm64/Saakshi.app --args --relay http://$IP:7070 --cand C0001 --seat CEN042-S01 --test-mode --no-camera
open http://127.0.0.1:7090/control
```
The app **always** launches with `--test-mode --no-camera`: no keychain prompt, the red TEST MODE banner is on every screen, the chip reads "Camera off (test mode)", and the macOS camera indicator never lights.

- [ ] **Step 3: Act 2, step by step**

1. **Check-in.** The seat shows the TEST MODE banner and "Check-in". Enter PIN `482913` twice, operator `GATE-42-OP7`, method "Aadhaar face authentication", press **Check in**. The screen changes to **"Paper locked until T0"** with "Seat confirmed by the exam server" and the commitment (the first 16 hex of `kc_f` for F1 — it matches the packager's printed manifest). Screenshot → `docs/evidence/stage3-seat-locked.png`.
2. **Paper unreadable before T0.** `stage3-hexdump.txt` shows random bytes; `grep -c "SI unit" data/exam/package/paper-F1.bin` prints `0`, and so does `grep -c "SI unit" "$HOME/Library/Application Support/Saakshi/journal/"*.package.json`.
3. **Dashboard.** `curl -s localhost:7090/v1/manifest | jq '.manifest.forms'` prints the public commitment. `/control` shows ≈19.8k registered (G1 minus Centre 42's rows, plus the 8 at Centre 42), "Seats bound" climbing to the same number as the swarm enrols, 100 tiles all **Locked**, three exam servers live. Screenshot → `stage3-control-before.png`.
4. **Cut the link.** Press **"Cut Centre 42's link"**. The relay terminal prints `WAN DOWN (DEV chaos)`.
5. **Two custodians release.** Open `http://127.0.0.1:7090/custodian` in two browser tabs. In each, check the fingerprint against the control page's "Release key …" line, choose `data/exam/custodians/NTA.share.json` (then `NIC.share.json`) and type its passphrase from `PACKAGER-OUTPUT.dev.txt`. The first tab says "Control has 1 of 2 shares"; the second says "Released at … by NTA + NIC". Screenshot → `stage3-custodian.png`.
6. **99 centres go green.** Within seconds the control page reads "99 of 100 centres green", entries/s climbs, and the custody panel says "Every exam server has the release; control has zeroised the keys." CEN042 stays **Locked**. The same by curl: `curl -s localhost:7090/v1/release/status | jq '{released, zeroised, pushed}'` and `curl -s localhost:7090/v1/fleet | jq '{registered, unlocked, entriesPerSec, locked: [.centres[] | select(.tone != "green") | .centre]}'` (the last prints `["CEN042"]`). Screenshot → `stage3-control-released.png`.
7. **A wrong code fails.** Open `http://$IP:7070/console`. Type a random code: "That code has a typo…" (or `curl -s -X POST localhost:7070/v1/release/offline -H 'content-type: application/json' -d '{"code":"0000-0000-0000-0000-1"}' | jq`). On `/control`, reveal CEN001's code (superintendent `SUP-1`, call-back ticked) and type it at the relay console: "This code does not open CEN042's paper for S1…". Screenshot → `stage3-relay-wrong-code.png`.
8. **The phoned code.** On `/control`, reveal **CEN042**'s code (superintendent `SUP-42`, call-back ticked). Read it out and type it at the relay console, in lowercase with spaces. The console says "Unlocked…", the relay terminal prints `OFFLINE-UNLOCK {"centre":"CEN042",…}`, and the seat shows **"Paper unlocked: the key matches the published commitment. (unlocked at this centre with the code phoned in by the superintendent)"**. Press **Start**, answer a few questions (ticks stay ✓✓ grey: the link is cut). Screenshots → `stage3-control-code.png`, `stage3-seat-unlocked-code.png`.
9. **A forged key is rejected.** On the relay console press **"Push a forged key to the seats"**. The seat keeps working and shows "Rejected a key: the key does not match the published commitment kc_f." Screenshot → `stage3-seat-forged.png`.
10. **The link returns.** Press **"Restore Centre 42's link"**. The seat's ticks turn blue; the CEN042 tile shows "1 / 8 unlocked" (one seat of eight sat in this demo).
11. **The log records the fallback.** `grep -E '"action":"(release|keys-zeroised|offline-code-revealed|chaos-wan)"' data/control/custody.jsonl | tee docs/evidence/stage3-custody.txt` shows the release by NTA + NIC, the zeroisation, both reveals (CEN001 and CEN042) and the chaos switch.
12. **Quit the app:** `pkill -f 'Saakshi.app/Contents/MacOS/Saakshi'`.

- [ ] **Step 4: Clean up**

```bash
pkill -f 'Saakshi.app/Contents/MacOS/Saakshi'          # the seat app is gone (camera never on: test mode)
pkill -f 'tools/swarm.ts'
for p in 7090 7070 7080 7081 7082; do kill $(lsof -ti tcp:$p -sTCP:LISTEN) 2>/dev/null; done
```

- [ ] **Step 5: The claims ledger and the threat model**

`docs/claims-ledger.md`:
- P1 → **Proven**: `release-control.test.ts` (two distinct custodians; one custodian twice counts once; a damaged share cannot release), `tools/act2.ts`.
- P2 → **Proven**: `package.test.ts`, `relay-routes.test.ts` "Review Focus #3", `tools/act2.ts` steps 9–10.
- P3 → **Proven**: `stage3-core.test.ts` "checkRelease (B.7)", `release.test.ts` and `seat.test.ts` "exit check — kc_f on both paths", `tools/act2.ts` step 11.
- P4 → **Proven**: `package.test.ts` "ciphertext only", the seat bundle grep (Step 1), `tools/act2.ts` step 2; "on time even offline": `tools/act2.ts` step 10.
- P5 → **Proven**: `bindings.test.ts`, `identity.test.ts`, `seat.test.ts` "provisional …".
- C5 → **Built** (the swarm replays G1: ≈20k candidates, 100 centres, 3 cells, live); throughput is **measured in Stage 7**.
- R7 → three cells run in the Stage 3 demo; the blast radius stays **Planned (Stage 4)**.

`docs/threat-model.md` — add these honest limits under the custody and identity sections:
- The custodian page is served by control, so a compromised control could serve a page that captures a passphrase. Production: a signed, offline custodian app.
- Enrolment is first-come: a rogue relay could try to bind a candidate before they arrive. It cannot forge the cell's certificate, and the real candidate's enrolment is then refused (`ALREADY_BOUND`, "call the invigilator"); matching `attestHash` against the gate's own log is later work.
- While `DEV=1`, the relay's chaos routes (`/v1/dev/wan`, `/v1/dev/forge`) are reachable on the centre LAN.
- The phoned code is the credential for the relay's unlock route; that is its purpose, and control logs every reveal.
- Control sees `K_f` at T0 and zeroises it after every cell has the release, best effort in a garbage-collected runtime. Control restarting before the release makes a new release key; the custodians re-send.
- `/verify` still pins the fixture seat keys, so an **enrolled** candidate's proof shows the keys row failing there until Stage 4 extends the proof with the bind and cell certificates (see this plan's Conflicts).
- The DEV test keystore keeps the journal key in a file; it is never silent (banner, `integrity` entry).

- [ ] **Step 6: Update memory and ask for approval**

- Record in `saakshi-hackathon-plan.md` that Stage 3 is done, with: the `act2.ts` PASS line; the CI run links; Addendum B (B.1–B.9); `EXAM` mode vs DEV mode; test mode (`--test-mode`); the `/verify` conflict deferred to Stage 4; any deviations.
- Send the user the screenshots, `stage3-act2.txt`, `stage3-hexdump.txt` and `stage3-custody.txt`.
- Ask for approval to start Stage 4.

---

## Conflicts, assumptions and deferred work

- **`/verify` and enrolled keys (conflict).** `/verify` (Stage 2, just landed, not to be changed) pins seat keys from `fixtures/trust-dev.json`. After enrolment a candidate's key is not in that file, so `/verify` of an enrolled candidate shows the keys row failing (the chain, bodies, receipt, STH and inclusion rows still verify). Control's own seal, audit, reconciliation and evidence use the enrolled keys (Task 16). Proposed first task of Stage 4: **Addendum C** — the proof carries the candidate's bind certificates and the cell's key certificate, and `/verify` pins only the authority key. Until then, the Stage 2 Act 4 demo still runs in DEV mode (no `EXAM`).
- **Stage 2 assumed landed as planned** — it has (`control.ts`, `main.ts`, `act4.ts`, `/verify`, the loopback guard and the 64 KB body cap from `6e0c31e`); Task 16 keeps all of them.
- **The shift.** G1 has three sittings; the demo runs one shift, so the swarm merges them into S1 (Decision 1). The dashboard therefore shows ≈20k in one shift. Stage 6 should decide whether the radar's "same room" needs the original sittings.
- **The count.** G1's own Centre 42 rows are not replayed (that centre is the real one), so the dashboard shows ≈19.8k + 8, not exactly 20,000.
- **No T0 clock gate** at control (Decision 7). The custodians decide when; a policy `t0` check is easy to add later.
- **The DEV keys.** Cell keys reuse the published fixture keys, and control signs releases with the fixture authority key. Production keys come from an HSM; nothing in the protocol changes.
- **Handover by PIN** (plan §3.2 (ii)) is Stage 4: Stage 3 stores the PIN record sealed to the cell so Stage 4 can check it, and the cell answers `UNSUPPORTED` for `keyEpoch > 1`.
