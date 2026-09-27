# Stage 2 — "Prove it" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Act 4 works end to end.
- The candidate submits. The receipt code and the attempted, answered and marked counts appear on a printable slip at once, even offline.
- A rogue insider edits an answer in the cell DB. The audit locates the edit, and `/verify` shows **"Q17: record says C — the seat committed B"**.
- The reconciliation row stays green, and one click exports an evidence pack.

**Architecture:**
- **Seat** (Electron main):
  - A `submit` entry closes the chain. The seat computes the receipt locally from its own journal, using the replay rule shared through core (`responsesOf`, then `finalHash`, `counts` and `receiptCode`).
  - The renderer journals each item's first visit as `clear`/`NA`, asks for confirmation before submitting, and shows the slip with `window.print()`.
- **Cell** (`MODE=cell`):
  - It stores the opened body of every entry in `bodies`. This table is the official "record".
  - At submit it replays the chain, rejects a `finalHash` mismatch and anything after the submit, and countersigns the receipt into `receipts`.
  - It serves the response sheets at `GET /v1/shift`, plus a DEV-only rogue edit at `POST /v1/dev/rogue`.
- **Relay:** rejects entries after a submit. It can see the header `kind` but cannot read bodies.
- **Control** (`MODE=control`, new and minimal):
  - Seals the shift: RFC 9162 leaves and root, an STH signed with the authority key, and an archive snapshot.
  - Audits, reconciles, proxies the rogue button, and builds evidence packs.
  - Serves `/control` and `/verify`.
- **`/verify`:** one self-contained HTML file compiled by `Bun.build({ compile: true, target: 'browser' })`.
  - It uses noble only, pins public keys from `fixtures/trust-dev.json`, and runs the golden vectors on load.
  - Control serves it, and it is also copied into every evidence pack, so it opens from `file://` with no network.
- **Core** (all browser-safe) holds the shared logic: `log.ts` (STH, pseudonym, replay), `sheet.ts` (file formats), `verify.ts` (the one verifier used by the audit and the browser alike) and `selftest.ts`.

**Tech Stack:**
- TypeScript, run by Node 25 and Bun 1.3.14.
- `bun:sqlite`, and `Bun.serve` routes with HTML imports.
- `Bun.build` `compile: true` for the single-file `/verify`, and `Bun.Archive` for the `.tar.gz` evidence packs.
- `node:test` in core and seat; `bun:test` in server.
- `@noble/*`, Electron 44 and React 19.
- **No new dependencies.**

**Spec:**
- `docs/plan.md`: §2 (architecture, "Path of one answer", failure handling), §3.1, §3.7 (receipts, log, audit, evidence), §3.11 (UIs) and §5 "Stage 2: Prove it".
- `docs/protocol-v1.md` is frozen. Task 1 appends **Addendum A**, which is additive only; see "Protocol addenda" below.

## Decisions (the open questions, settled)

1. **Visited but not answered (the Stage 1 open issue).**
   - The first time an item is shown without a journaled state, the seat journals `clear` with body `["body",item,"NA","",[0,[]]]`.
   - This needs no new kind or state, because `clear` and `NA` already exist.
   - NA now survives a resume, and "attempted" (not NV) is correct.
2. **What `finalHash` covers.**
   - `responses` covers **every item of the candidate's form**; items never touched are `[item,"NV",""]`. Otherwise "attempted" would be meaningless.
   - The last entry per item wins.
   - One function, `responsesOf`, is used by the seat, the cell and `/verify`.
3. **Non-entry signatures** (ack, receipt countersignature, STH) sign `UTF-8(canon(array))` with no domain byte. This matches the ack choice from Stage 1.
4. **Pseudonym.**
   - `pseud = hex(HMAC-SHA256(K_pseud, roll))`.
   - DEV uses `K_pseud = SHA-256("saakshi-dev-pseud")` and `roll = cand`. This key is published, so DEV pseudonyms are not private. Stage 3 moves the key to control.
5. **Minimum control mode.**
   - Included: `MODE=control` with seal, audit, reconcile, rogue proxy, proof, evidence and `/verify`.
   - Left out:
     - the witness (S6);
     - a consistency-proof endpoint (control keeps every leaf in order, so S6 can compute proofs later);
     - the second archive store and the purge (Stage 4).
6. **Where `/verify` lives.**
   - There is no `apps/web`. The page is `apps/server/src/verify.html` plus its TypeScript, compiled at runtime into one HTML string.
   - Control serves it and every evidence pack embeds it.
   - The relay does not serve it, because the relay is untrusted.
7. **Evidence pack format.**
   - `Bun.Archive` writes a `.tar.gz`, and control also writes the unpacked directory. This needs no dependency.
   - Windows 10 and later extract `.tar.gz` with the built-in `tar`, and Windows 11 Explorer opens it directly.
   - The report and the BSA 2023 s.63 certificate are printable HTML: print them to PDF from the browser, so no PDF library is needed.
8. **Archive.** The export snapshot that control writes when it seals is the "replica/archive" for the audit's recovery order. Stage 4 adds the second WORM store and the purge.
9. **The cell countersignature on the receipt** lives in the response sheet and the evidence. It is **not** pushed back to the seat in Stage 2; the printed slip is complete without it.
10. **Trust anchors for `/verify`.**
    - They come from `fixtures/trust-dev.json`, which holds **public keys only**, generated from `keys.json`.
    - The page never imports `keys.json`, which contains private keys.

## Protocol addenda (flagged; Task 1 writes them as `docs/protocol-v1.md` §14)

These are additive only. No byte defined in §1–§13 changes, so `V` stays 1. They get new vectors in `fixtures/vectors/protocol-v1-addendum-a.json`.

| # | Addendum | Why |
|---|---|---|
| A.1 | ack, receipt countersignature and STH sign `m = UTF-8(canon(array))` with **no domain byte**. It cannot collide with a domain-tagged message: those start with 0x00–0x07, and canonical text starts with `[` (0x5b) | Stage 1 already signs acks this way (required) |
| A.2 | STH field types: `root` is the MTH over leaves in log order; `prevSTH` is `hex(SHA-256(previous STH message))`, or 64 × `0` for the first; `ts` is ms since the Unix epoch. Leaves are append-only | §5 reserved the layout without types |
| A.3 | Leaf: `h` is the submit entry's `h`; `finalHash` is the submit body's `meta[1]` | §10 names no source |
| A.4 | `pseud = hex(HMAC-SHA256(K_pseud, UTF-8(roll)))`, plus the DEV key | §5 calls `pseud` opaque |
| A.5 | Submit rules become **enforced**: body `["body","","","",[form,finalHash]]`; the replay rule for `responses` (every form item, last write wins, NV fill); an item outside the form is rejected; nothing is accepted after the submit | §6 listed these as unchecked conventions |
| A.6 | First visit is journaled as `clear`/`NA` with meta `[0,[]]` | Resolves the Stage 1 NA gap without a new kind or state |
| A.7 | Non-normative JSON for the response sheet and the proof, so a third party can write their own verifier | Needed for `/verify` inputs |

## Global Constraints

**Protocol and code reuse**
- Protocol v1 is frozen. All hashing, signing and sealing goes through `packages/core`.
  - No task may change a byte that §1–§13 define.
  - If a task believes it must, it **stops and reports**.
  - Task 1 is the only task that adds core modules (`log.ts`, `sheet.ts`) or edits `dev.ts` and `journal.ts`. Task 2 adds `verify.ts` and `selftest.ts`.
- **Browser-safe core.**
  - `verify.ts`, `selftest.ts`, `log.ts`, `sheet.ts`, `journal.ts`, `merkle.ts`, `protocol.ts`, `canon.ts`, `bytes.ts`, `sig.ts` and `ack.ts` must import **nothing** from `node.ts`, `wire.ts` or `node:*`.
  - The `/verify` bundle imports only these modules.
- **Imports:**
  - Core is imported as `@saakshi/core/<module>` in apps.
  - `tools/*.ts` import core by relative path.
  - Relative TypeScript imports carry an explicit `.ts` extension. There is no barrel file.
  - JSON imported in `apps/server/src` uses `with { type: 'json' }`. Task 1 turns on `resolveJsonModule` there.
- **TypeScript:** `erasableSyntaxOnly`, so no enums, namespaces or constructor parameter properties.
- **Dependencies:** none are added.
  - `Bun.Archive`, `Bun.build`, `node:crypto` and the installed `@noble/*` packages cover everything.
  - If a task needs a package, it stops and reports. Only Task 1 may run `pnpm`, and then only with `--config.confirm-modules-purge=false </dev/null`.

**File formats** (types in `packages/core/src/sheet.ts`, written by Task 1)

```ts
interface SheetEntry { line: string; salt: string /* 32 hex */; body: Canon[] /* bodyArray as recorded; ['missing'] or ['unreadable'] if the row is gone/garbled */ }
interface SheetReceipt { cell: string; seq: number; h: string; code: string; sig: string }
interface ResponseSheet { ctx: Ctx; form: string; pseud: string; keys: { keyEpoch: number; pub: string }[]; entries: SheetEntry[]; receipt?: SheetReceipt }
interface ShiftExport { cell: string; exam: string; shift: string; sheets: ResponseSheet[] }
interface Proof { v: 1; sheet: ResponseSheet; sth: SignedSth; index: number; inclusion: string[] }
interface Trust { authority: string; cells: Record<string, string>; seats: Record<string, string> /* `${cand}/${keyEpoch}` → pub */ }
interface LogLeaf extends Leaf { cand: string }                        // Leaf = {exam, shift, attempt, pseud, h, finalHash}
interface SthRecord { exam: string; shift: string; leaves: LogLeaf[]; sths: SignedSth[] }
type FindingKind = 'body' | 'chain' | 'truncated' | 'count' | 'missing' | 'finalHash' | 'receipt';
interface Recovery { from: 'archive' | 'next.prev' | 'option-search'; value: string }
interface Finding { cand: string; seq: number /* 0 = whole chain */; kind: FindingKind; detail: string; recovered?: Recovery }
interface ReconRow { centre: string; exam: string; shift: string; registered: number; checkedIn: number; unlocked: number; submitted: number; receipts: number; leaves: number; headsEqual: boolean; headMismatches: string[]; green: boolean }
type Forms = Record<string, readonly string[]>;                        // forms.json minus durationMin
```

**Cell DB** (Task 3 adds these to `openDb`; both are `CREATE TABLE IF NOT EXISTS`)

```sql
CREATE TABLE bodies (exam TEXT NOT NULL, shift TEXT NOT NULL, attempt INTEGER NOT NULL, cand TEXT NOT NULL, seq INTEGER NOT NULL,
  item TEXT NOT NULL, state TEXT NOT NULL, answer TEXT NOT NULL, meta TEXT NOT NULL /* JSON.stringify(body.meta) */, salt BLOB NOT NULL,
  PRIMARY KEY (exam, shift, attempt, cand, seq)) WITHOUT ROWID;
CREATE TABLE receipts (exam TEXT NOT NULL, shift TEXT NOT NULL, attempt INTEGER NOT NULL, cand TEXT NOT NULL,
  seq INTEGER NOT NULL, h TEXT NOT NULL, final_hash TEXT NOT NULL, pseud TEXT NOT NULL,
  attempted INTEGER NOT NULL, answered INTEGER NOT NULL, marked INTEGER NOT NULL, code TEXT NOT NULL, cell TEXT NOT NULL, sig TEXT NOT NULL,
  PRIMARY KEY (exam, shift, attempt, cand)) WITHOUT ROWID;
```
- Only a cell writes `bodies` and `receipts`. The relay leaves them empty.
- A Stage 1 DB has no bodies, so wipe `data/` before running Stage 2. The demo does this.

**HTTP routes (new)**

| Mode | Route | Request | Response |
|---|---|---|---|
| cell | `GET /v1/shift?exam=&shift=` | — | `ShiftExport` (served even while REBUILDING); `400 {error}` if a parameter is missing |
| cell | `POST /v1/dev/rogue` | `{exam, shift, attempt, cand, item, answer: A–D}` | `200 {seq, item, from, to, sql}`; also prints `ROGUE <sql>` to stdout; `400` for a bad shape; `404 {error}` if there is no recorded answer |
| control | `GET /control` | — | the control page (HTML import) |
| control | `GET /verify` | — | the compiled single-file verifier (`text/html`) |
| control | `GET /v1/recon` | — | `ReconRow` |
| control | `POST /v1/seal` | — | `{ sth: SignedSth, added: string[], skipped: {cand, reason}[] }` |
| control | `POST /v1/audit` | — | `{ at: number, findings: Finding[] }` |
| control | `POST /v1/rogue` | `{cand, q, answer}` | the cell's rogue response plus `q` |
| control | `GET /v1/proof?cand=` | — | `Proof`; `404` until the candidate is in a sealed STH |
| control | `GET /v1/evidence?cand=` | — | `application/gzip`, `content-disposition: attachment; filename="<name>.tar.gz"`. The same files are also written under `DIR/evidence/<name>/` |

- Every control error is `{error}`: `400` for bad input or an unknown candidate, `404` when not sealed yet, `502` when the cell or relay is unreachable or failing, `500` otherwise.
- Cell and relay keep every Stage 1 route unchanged.

**Server environment (additions)**
- `MODE=control`: `PORT` 7090, `HOST` 127.0.0.1, `DIR` default `data/control`, `CELL_URL` default `http://127.0.0.1:7080`, `RELAY_URL` default `http://127.0.0.1:7070`.
- All modes: `FORMS`, default `fixtures/paper/forms.json`.
- `DEV=1` is still required in every mode.
- The DEV roster:
  - candidates `C0001`–`C0008`;
  - centre `CEN-01`;
  - exam `DEMO-2026 / S1 / attempt 1`;
  - form F1 for odd candidates and F2 for even ones;
  - the authority key is `keys.authority`.

**Control's storage** (plain files under `DIR`)
- `sth-<exam>-<shift>.json`: the `SthRecord`.
- `archive/<exam>-<shift>-<size>.json`: the `ShiftExport` sealed at that size.
- `custody.jsonl`: one JSON object per line, `{at, actor, action, exam, shift, …}`. The actions are `seal`, `audit`, `rogue-simulated` and `evidence-export`.
- `evidence/<name>/` and `evidence/<name>.tar.gz`, where `name = evidence-<exam>-<shift>-<cand>-<YYYYMMDDTHHMMSSZ>`.

**Evidence pack files:**
- `README.txt`
- `proof.json`
- `sth.json`
- `audit.json`
- `custody.jsonl`
- `verify.html`
- `report.html`
- `certificate-s63.html`
- `manifest.sha256`: `sha256  file` lines covering every other file, in a format `shasum -a 256 -c` accepts.

**Rules**
- **Check order additions at relay and cell.**
  - After the signature and `seq ≥ 1` checks, and **before** the gap check: `seq > submitSeq` is BAD_SUBMISSION (`entry after submit`).
  - An exact resend at `seq ≤ submitSeq` is still a no-op.
  - On the cell only, after `openBody`:
    - an item outside the candidate's form is BAD_SUBMISSION;
    - a `submit` must pass the replay (Addendum A.5), or it is BAD_SUBMISSION.
- **Audit recovery order** (§3.7):
  1. The replica or archive copy of that entry, used only if its line is byte-identical and its body matches the signed `bodyCommit`.
  2. `next.prev`: the next entry's `prev` pins the original `h`.
  3. Option search over `state × answer`, using the stored salt, against the signed `bodyCommit`.
- **Honest claims** (use these words): "located; original recovered from the archive, or by option search when only the answer was edited". Never say "tamper-proof".

**Camera in automated checks** (the user's requirement: no webcam during automated demo checks)
- The seat honours `SAAKSHI_NO_CAMERA=1` or the CLI flag `--no-camera`. Main computes `cameraEnabled(argv, env)` (Task 4) and passes it to the renderer as `ExamBoot.camera` (Task 1 contract).
- With the camera off:
  - main skips `systemPreferences.askForMediaAccess` and denies every `media` permission request;
  - the renderer never calls `getUserMedia` and never loads MediaPipe (it is imported dynamically, and only when the camera is on);
  - the face chip reads **"Camera off (test mode)"** (Hindi: "कैमरा बंद (परीक्षण मोड)").
- **Every** step in this plan that launches the packaged app passes `--no-camera`, unless that step specifically tests the face check (none in Stage 2).
- **Every** such step ends with an explicit quit: `pkill -f 'Saakshi.app/Contents/MacOS/Saakshi'`.

**Environment gotchas** (carried over from Stage 1)
- **Sandbox:**
  - It blocks `.git` writes, `open`, some network, **local port binding** and launching packaged apps.
  - Port binding covers every `apps/server` test that calls `Bun.serve` (`main.test.ts`, `control.test.ts`, `serve.test.ts`, `sse.test.ts`), plus `tools/chaos-kill.ts` and `tools/act4.ts`.
  - Re-run those with `dangerouslyDisableSandbox: true`.
- **Tests:**
  - Write `assert.throws(fn, /re/, msg)` or `assert.throws(fn, msg)`. Never `assert.throws(fn, undefined, msg)`, which does not type-check.
  - Bun's per-test timeout defaults to 5 s. Server tests run with `bun test --timeout 60000`, which the package script already passes.
- **Module format:**
  - The root `package.json` is `"type":"module"`.
  - `apps/seat` has **no** type field, and electron-vite bundles main and preload as CommonJS. So seat main code has no top-level `await`, and seat test and lib files use neither `__dirname` nor `require`.
- **Killing by port:** `kill -9 $(lsof -ti tcp:7080 -sTCP:LISTEN)`. A plain `lsof -ti tcp:7080` also matches the relay's client socket.
- **Commits:** agents share one working tree, touch only the files their task lists, and **do not commit**. The controller reviews and commits each task.

## Review Focus

These are the five likeliest real-world failures. Each is pinned by a named test in the task that owns the code.

1. **Seat and cell disagree about the answer vector.**
   - Triggers: F2's reversed order, a re-answered item, an answer then Clear, first-visit NA, or a mark.
   - Result if broken: an honest submit is rejected, or the slip's code differs from the cell's.
   - Expected: both compute the same `finalHash` and receipt code.
   - Pinned in:
     - Task 3: "an honest submit with visits, re-answers and a clear is accepted and its receipt matches the seat's".
     - Task 14: `tools/act4.ts` "seat slip code equals the cell's countersigned code" (the real `ExamSession`, form F2).
2. **A retried submit.**
   - Triggers: the seat crashes after appending, a network retry, or a relay replay after REBUILDING.
   - Expected: an exact resend is a no-op, never "entry after submit". Submitting again returns the same receipt and appends nothing. The receipt survives a restart.
   - Pinned in:
     - Task 3: "resending the exact submit is a no-op, not 'after submit'".
     - Task 4: "submitting twice returns the same receipt and appends nothing" and "the receipt survives a restart".
3. **A false tamper alarm against an honest candidate.**
   - Expected:
     - An honest shift audits to zero findings, and reconciliation is green.
     - A candidate still sitting the exam (no submit, no leaf, no receipt) is not "truncated".
     - A relay stream with only hellos is not "missing".
   - Pinned in:
     - Task 7: "an honest shift audits clean" and "an in-progress candidate is not called truncated or missing".
     - Task 13: "an honest DB: no findings, green, every proof verifies".
4. **The receipt code copied by hand.**
   - Triggers: lowercase, dashes, `O` for `0`, `I`/`L` for `1`, or one wrong symbol.
   - Expected: a valid transcription still matches. A typo says "re-type it", never "tampered".
   - Pinned in Task 2: "slip: lowercase, dashes and O-for-0 still match; a one-symbol typo asks to re-type".
5. **The "offline" verifier is not offline or not trustworthy.**
   - Failure modes: it loads a CDN script, pulls in a Node builtin, ships a private key, or renders hostile JSON as HTML.
   - Expected: one self-contained file; public keys only; `textContent` only; malformed proofs are rejected with a message.
   - Pinned in:
     - Task 9: "verify.html compiles to one self-contained page with no network, no Node and no private keys" and "the page renders untrusted text with textContent only".
     - Task 2: "parseProof rejects malformed proofs".
     - Task 10: "report.html escapes recorded strings".

## Parallelism map

```
T1 contracts ─┬─► T2 core verify ─┬─► T7 audit ────────┐
              │                   ├─► T9 /verify page ─┤
              │                   └─► T10 evidence ────┤
              ├─► T3 cell ingest ──► T8 cell export ───┼─► T12 control+main ─┐
              ├─► T6 seal+recon ───────────────────────┤                     ├─► T14 act4 + CI ─► T15 exit + demo
              ├─► T11 control UI ──────────────────────┘                     │
              ├─► T4 seat main ─────────────────────────────────────────────►│
              └─► T5 seat renderer ─────────────────────────────────────────►┘
                                             T13 tamper suite (wave 4, needs T3 T6 T7 T8)
```

| Wave | Tasks | Notes |
|---|---|---|
| 1 | T1 | Contracts, fixtures, the protocol addendum, and the shared test seat. Everything depends on it. |
| 2 | T2, T3, T4, T5, T6, T11 | Six agents on disjoint paths. T11 tests pure view helpers only. |
| 3 | T7 (needs T2), T8 (needs T3), T9 (needs T2, T6), T10 (needs T2, T6) | |
| 4 | T12 (needs T3, T6–T11), T13 (needs T3, T6, T7, T8) | These touch disjoint files. |
| 5 | T14 (needs T4, T12) | |
| 6 | T15 | Integration of T4 and T5 in the packaged app is proven here. |

---

### Task 1: Contracts — log and sheet types, DEV pseudonym and trust, keyed chain verify, addendum vectors, test seat, IPC types

**Files:**
- Create: `packages/core/src/log.ts`, `packages/core/src/sheet.ts`
- Modify: `packages/core/src/dev.ts` (append), `packages/core/src/journal.ts` (add `verifyChainKeyed`; `verifyChain` delegates with identical behaviour)
- Create: `tools/gen-trust.ts`, `tools/gen-vectors-addendum.ts`, and the generated `fixtures/trust-dev.json` and `fixtures/vectors/protocol-v1-addendum-a.json`
- Test: `packages/core/test/log.test.ts`, `packages/core/test/addendum.test.ts`
- Modify: `tools/sim-seat.ts` (salts, bodies, `append`, `submit`, `sheet`), `apps/server/test/sim-seat.test.ts` (add one test)
- Modify: `apps/seat/src/shared/ipc.ts` (`Receipt`, `SubmitResult`, `ExamBoot.receipt`, `ExamBoot.camera`, `SeatApi.submit`)
- Modify: `apps/server/tsconfig.json` (`"resolveJsonModule": true`)
- Modify: `docs/protocol-v1.md` (append §14 Addendum A)

**Interfaces:**
- Consumes: `canon`, `protocol` (`leafArray`, `receiptArray`, `finalHash`, `counts`, `bodyArray`, `type Body`, `type Response`), `merkle.leafHash`, `bytes`, and `@noble/hashes` `hmac` and `sha256`.
- Produces:
  - `log.ts`:
    - `interface Sth {exam; shift; size; root; prevSTH; ts}`, `interface SignedSth {sth; sig}`, `interface Leaf {exam; shift; attempt; pseud; h; finalHash}`
    - `NO_PREV_STH`
    - `sthArray(s): Canon[]`, `sthMessage(s): Uint8Array`, `sthId(s): string`
    - `receiptMessage(r: ReceiptIn): Uint8Array`
    - `leafHashHex(l: Leaf): string`
    - `pseudOf(key: Uint8Array, roll: string): string`
    - `responsesOf(form: readonly string[], bodies: readonly Body[]): Response[]`
  - `sheet.ts`: every type in Global Constraints → File formats, plus `formsOf(json): Forms`.
  - `dev.ts`:
    - `DEV_PSEUD_KEY`
    - `devPseud(cand): string`
    - `DEV_CENTRE = 'CEN-01'`
    - `devRoster(keys): string[]`
    - `trustFromKeys(keys): Trust`
  - `journal.ts`: `verifyChainKeyed(c, lines, keyFor: (keyEpoch: number) => Verify | undefined): ChainResult`.
  - `tools/sim-seat.ts`:
    - `FORMS`
    - `SimSeat` fields `salts: Uint8Array[]` and `bodies: Body[]`
    - `append(kind, body): WireEntry`
    - `submit(form?): WireEntry`
    - `sheet(form?): ResponseSheet`
    - `make(seq, prev, answer, body?, kind?)` now also returns `{salt, body}`
  - `ipc.ts`:
    - `interface Receipt {exam; shift; cand; form; code; seq; h; finalHash; attempted; answered; marked; total}`
    - `type SubmitResult`
    - `ExamBoot.receipt?: Receipt`
    - `ExamBoot.camera: boolean` (the no-camera test mode; see Global Constraints)
    - `SeatApi.submit(): Promise<SubmitResult>`

- [ ] **Step 1: Write the failing core tests**

`packages/core/test/log.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { hexToBytes } from '../src/bytes.ts';
import { DEV_PSEUD_KEY, devPseud, devRoster, trustFromKeys, type KeysFile } from '../src/dev.ts';
import { verifyChain, verifyChainKeyed } from '../src/journal.ts';
import { NO_PREV_STH, pseudOf, responsesOf, sthId, type Sth } from '../src/log.ts';
import { verifier } from '../src/node.ts';
import type { Body } from '../src/protocol.ts';
import { formsOf } from '../src/sheet.ts';

const root = new URL('../../../', import.meta.url);
const read = (p: string) => JSON.parse(readFileSync(new URL(p, root), 'utf8'));
const V = read('fixtures/vectors/protocol-v1.json');
const keys = read('fixtures/keys.json') as KeysFile;
const b = (item: string, state: Body['state'], answer = ''): Body => ({ item, state, answer, meta: [] });

test('responsesOf: last entry per item wins, untouched form items are NV, form order is kept', () => {
  const r = responsesOf(['I03', 'I01', 'I02', 'I04'], [b('', ''), b('I01', 'NA'), b('I01', 'A', 'C'), b('I03', 'AMR', 'B'), b('I01', 'A', 'D'), b('', '')]);
  assert.deepEqual(r, [['I03', 'AMR', 'B'], ['I01', 'A', 'D'], ['I02', 'NV', ''], ['I04', 'NV', '']]);
});

test('responsesOf rejects an item outside the form and an item entry with no state', () => {
  assert.throws(() => responsesOf(['I01'], [b('I99', 'A', 'B')]), /not in the form/);
  assert.throws(() => responsesOf(['I01'], [b('I01', '')]), /no state/);
});

test('pseudonyms are 64 hex, stable for a roll, and differ between rolls', () => {
  assert.match(devPseud('C0001'), /^[0-9a-f]{64}$/);
  assert.equal(devPseud('C0001'), pseudOf(DEV_PSEUD_KEY, 'C0001'));
  assert.notEqual(devPseud('C0001'), devPseud('C0002'));
});

test('sthId changes when any STH field changes', () => {
  const s: Sth = { exam: 'E', shift: 'S', size: 1, root: 'a'.repeat(64), prevSTH: NO_PREV_STH, ts: 1 };
  const base = sthId(s);
  for (const t of [{ exam: 'X' }, { shift: 'X' }, { size: 2 }, { root: 'b'.repeat(64) }, { prevSTH: 'c'.repeat(64) }, { ts: 2 }]) assert.notEqual(sthId({ ...s, ...t }), base);
});

test('verifyChainKeyed: same result as verifyChain with one key; a missing epoch key is a sig fault at the first line', () => {
  const v = verifier(hexToBytes(keys.seats[0].pub));
  assert.deepEqual(verifyChainKeyed(V.ctx, V.chain.lines, () => v), verifyChain(V.ctx, V.chain.lines, v));
  const r = verifyChainKeyed(V.ctx, V.chain.lines, () => undefined);
  assert.deepEqual(r.ok ? null : [r.index, r.fault], [0, 'sig']);
});

test('fixtures/trust-dev.json is exactly the public half of keys.json', () => {
  const t = read('fixtures/trust-dev.json');
  assert.deepEqual(t, trustFromKeys(keys));
  const text = JSON.stringify(t);
  for (const k of [keys.authority, ...keys.cells, ...keys.seats]) assert.ok(!text.includes(k.priv));
  assert.deepEqual(devRoster(keys), ['C0001', 'C0002', 'C0003', 'C0004', 'C0005', 'C0006', 'C0007', 'C0008']);
});

test('formsOf keeps the item lists and drops durationMin', () => {
  const f = formsOf(read('fixtures/paper/forms.json'));
  assert.deepEqual(Object.keys(f).sort(), ['F1', 'F2']);
  assert.equal(f.F1.length, 20);
});
```

`packages/core/test/addendum.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ackArray, ackMessage } from '../src/ack.ts';
import { hexToBytes, toHex } from '../src/bytes.ts';
import { canon } from '../src/canon.ts';
import { DEV_PSEUD_KEY } from '../src/dev.ts';
import { leafHashHex, pseudOf, receiptMessage, responsesOf, sthArray, sthId, sthMessage } from '../src/log.ts';
import { verifier } from '../src/node.ts';
import { bodyFromArray, counts, finalHash, receiptArray } from '../src/protocol.ts';
import { nobleVerifier } from '../src/sig.ts';

const A = JSON.parse(readFileSync(new URL('../../../fixtures/vectors/protocol-v1-addendum-a.json', import.meta.url), 'utf8'));

test('addendum A: every deterministic value recomputes', () => {
  assert.equal(toHex(DEV_PSEUD_KEY), A.pseud.key);
  assert.equal(pseudOf(hexToBytes(A.pseud.key), A.pseud.roll), A.pseud.pseud);
  const responses = responsesOf(A.responses.form, A.responses.bodies.map(bodyFromArray));
  assert.deepEqual(responses, A.responses.responses);
  assert.equal(finalHash(A.ctx, A.responses.formName, responses), A.responses.finalHash);
  assert.deepEqual(counts(responses), A.responses.counts);
  assert.equal(canon(sthArray(A.sth.sth)), A.sth.canon);
  assert.equal(sthId(A.sth.sth), A.sth.id);
  assert.equal(canon(receiptArray(A.receiptSig.in)), A.receiptSig.canon);
  assert.equal(canon(ackArray(A.ack.in)), A.ack.canon);
  assert.equal(leafHashHex(A.leaf.in), A.leaf.hash);
});

test('addendum A: STH, receipt countersignature and ack verify under native and noble', () => {
  for (const mk of [verifier, nobleVerifier]) {
    assert.ok(mk(hexToBytes(A.sth.pub))(sthMessage(A.sth.sth), hexToBytes(A.sth.sig)));
    assert.ok(mk(hexToBytes(A.receiptSig.pub))(receiptMessage(A.receiptSig.in), hexToBytes(A.receiptSig.sig)));
    assert.ok(mk(hexToBytes(A.ack.pub))(ackMessage(A.ack.in), hexToBytes(A.ack.sig)));
  }
});

test('A.1: a non-entry message starts with "[" and so can never be read as a domain-tagged message', () => {
  for (const m of [sthMessage(A.sth.sth), receiptMessage(A.receiptSig.in), ackMessage(A.ack.in)]) assert.equal(m[0], 0x5b);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd packages/core && node --test test/log.test.ts test/addendum.test.ts`
Expected: FAIL. `../src/log.ts` cannot be found.

- [ ] **Step 3: Write `log.ts`, `sheet.ts`, and the additions to `dev.ts` and `journal.ts`**

`packages/core/src/log.ts`:
```ts
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { toHex, utf8 } from './bytes.ts';
import { canon, type Canon } from './canon.ts';
import { leafHash } from './merkle.ts';
import { leafArray, receiptArray, type Body, type ReceiptIn, type Response } from './protocol.ts';

/** Signed tree head, protocol-v1 §5 layout with Addendum A.2 field types. */
export interface Sth { exam: string; shift: string; size: number; root: string; prevSTH: string; ts: number }
export interface SignedSth { sth: Sth; sig: string }
export interface Leaf { exam: string; shift: string; attempt: number; pseud: string; h: string; finalHash: string }

export const NO_PREV_STH = '0'.repeat(64);
export const sthArray = (s: Sth): Canon[] => ['sth', s.exam, s.shift, s.size, s.root, s.prevSTH, s.ts];
/** Addendum A.1: non-entry structures sign their canonical UTF-8 with no domain byte. */
export const sthMessage = (s: Sth): Uint8Array => utf8(canon(sthArray(s)));
/** What the next STH's prevSTH holds. */
export const sthId = (s: Sth): string => toHex(sha256(sthMessage(s)));
/** The message a cell signs to countersign receipt B (Addendum A.1). */
export const receiptMessage = (r: ReceiptIn): Uint8Array => utf8(canon(receiptArray(r)));
export const leafHashHex = (l: Leaf): string => toHex(leafHash(utf8(canon(leafArray(l)))));
/** Addendum A.4: pseud = hex(HMAC-SHA256(K_pseud, UTF-8(roll))). */
export const pseudOf = (key: Uint8Array, roll: string): string => toHex(hmac(sha256, key, utf8(roll)));

/**
 * Addendum A.5 replay: for every item of the form, the state and answer of the last body naming it,
 * or NV when none does. Bodies with item '' (unlock, idle, submit…) are skipped. Seat, cell and /verify all use this.
 */
export function responsesOf(form: readonly string[], bodies: readonly Body[]): Response[] {
  const last = new Map<string, Response>();
  for (const b of bodies) {
    if (!b.item) continue;
    if (!form.includes(b.item)) throw new Error(`item ${b.item} is not in the form`);
    if (b.state === '') throw new Error(`item ${b.item} has no state`);
    last.set(b.item, [b.item, b.state, b.answer]);
  }
  return form.map((i) => last.get(i) ?? [i, 'NV', '']);
}
```

`packages/core/src/sheet.ts`:
```ts
// File formats shared by cell, control, the evidence pack and /verify (Addendum A.7, non-normative JSON).
import type { Canon } from './canon.ts';
import type { Leaf, SignedSth } from './log.ts';
import type { Ctx } from './protocol.ts';

/** One entry of the official response sheet: the §11 signed line, and the body as the cell recorded it, with its salt. */
export interface SheetEntry { line: string; salt: string; body: Canon[] }
export interface SheetReceipt { cell: string; seq: number; h: string; code: string; sig: string }
/** A candidate's official response sheet as a cell exports it — "the record". */
export interface ResponseSheet { ctx: Ctx; form: string; pseud: string; keys: { keyEpoch: number; pub: string }[]; entries: SheetEntry[]; receipt?: SheetReceipt }
export interface ShiftExport { cell: string; exam: string; shift: string; sheets: ResponseSheet[] }
/** What /verify reads: the sheet, the signed tree head, and the leaf's inclusion proof. */
export interface Proof { v: 1; sheet: ResponseSheet; sth: SignedSth; index: number; inclusion: string[] }
/** Pinned public keys (hex). seats: `${cand}/${keyEpoch}` → pub. */
export interface Trust { authority: string; cells: Record<string, string>; seats: Record<string, string> }
export interface LogLeaf extends Leaf { cand: string }
/** Control's per-shift log: every leaf in log order (append-only) and every STH issued. */
export interface SthRecord { exam: string; shift: string; leaves: LogLeaf[]; sths: SignedSth[] }
export type FindingKind = 'body' | 'chain' | 'truncated' | 'count' | 'missing' | 'finalHash' | 'receipt';
export interface Recovery { from: 'archive' | 'next.prev' | 'option-search'; value: string }
/** One audit finding. seq 0 = about the whole chain. */
export interface Finding { cand: string; seq: number; kind: FindingKind; detail: string; recovered?: Recovery }
export interface ReconRow {
  centre: string; exam: string; shift: string;
  registered: number; checkedIn: number; unlocked: number; submitted: number; receipts: number; leaves: number;
  headsEqual: boolean; headMismatches: string[]; green: boolean;
}
export type Forms = Record<string, readonly string[]>;
/** forms.json without durationMin. */
export const formsOf = (json: Record<string, unknown>): Forms =>
  Object.fromEntries(Object.entries(json).filter(([, v]) => Array.isArray(v))) as Forms;
```

Append to `packages/core/src/dev.ts`. Merge the new imports into the existing import lines at the top: `hexToBytes` is already imported from `./bytes.ts`, so add `utf8` to that line.
```ts
import { sha256 } from '@noble/hashes/sha2.js';
import { pseudOf } from './log.ts';
import type { Trust } from './sheet.ts';

/** DEV K_pseud (Addendum A.4). Published, so DEV pseudonyms are not private; Stage 3 moves the real key to control. */
export const DEV_PSEUD_KEY: Uint8Array = sha256(utf8('saakshi-dev-pseud'));
export const devPseud = (cand: string): string => pseudOf(DEV_PSEUD_KEY, cand);
export const DEV_CENTRE = 'CEN-01';
/** Registered candidates: one per fixture seat key. */
export const devRoster = (keys: KeysFile): string[] => keys.seats.map((_, i) => `C${String(i + 1).padStart(4, '0')}`);

/** The public half of the keys file: what /verify pins. DEV: every seat key is keyEpoch 1. */
export function trustFromKeys(keys: KeysFile): Trust {
  return {
    authority: keys.authority.pub,
    cells: Object.fromEntries(keys.cells.map((c) => [c.id, c.pub])),
    seats: Object.fromEntries(devRoster(keys).map((cand, i) => [`${cand}/1`, keys.seats[i].pub])),
  };
}
```

In `packages/core/src/journal.ts`, replace the body of `verifyChain` with a delegation. Keep its doc comment, and put the old loop into `verifyChainKeyed`:
```ts
/** verifyChain with one key per keyEpoch; an epoch with no key is a 'sig' fault on that line. */
export function verifyChainKeyed(c: Ctx, lines: string[], keyFor: (keyEpoch: number) => Verify | undefined): ChainResult {
  let prev = genesisPrev(c);
  for (let i = 0; i < lines.length; i++) {
    const fail = (fault: ChainFault, detail: string): ChainResult => ({ ok: false, index: i, fault, detail });
    const p = parseSignedLine(lines[i]);
    if (!p.ok) return fail(p.fault, p.detail);
    const h = p.header;
    if (h.exam !== c.exam || h.shift !== c.shift || h.attempt !== c.attempt || h.cand !== c.cand) return fail('context', 'entry belongs to another exam, shift, attempt or candidate');
    const verify = keyFor(h.keyEpoch);
    if (!verify) return fail('sig', `no pinned key for keyEpoch ${h.keyEpoch}`);
    if (!verify(p.m, p.sig)) return fail('sig', 'signature does not verify');
    if (h.seq !== i + 1) return fail('seq', `expected seq ${i + 1}, found ${h.seq}`);
    if (h.prev !== prev) return fail('prev', 'prev does not match the previous entry hash');
    prev = toHex(entryHash(h));
  }
  return { ok: true, head: prev, count: lines.length };
}

/** Check order: parse, shape, context, then (per spec) signature, position (seq), prev. Returns the first bad entry. */
export const verifyChain = (c: Ctx, lines: string[], verify: Verify): ChainResult => verifyChainKeyed(c, lines, () => verify);
```

`apps/server/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "lib": ["ES2023", "DOM"], "types": ["bun"], "resolveJsonModule": true },
  "include": ["src", "test"]
}
```

- [ ] **Step 4: Write the two generators and run them once**

`tools/gen-trust.ts`:
```ts
// Writes fixtures/trust-dev.json: the PUBLIC half of fixtures/keys.json, which /verify pins. Refuses to overwrite.
//   node tools/gen-trust.ts
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { trustFromKeys, type KeysFile } from '../packages/core/src/dev.ts';

const OUT = 'fixtures/trust-dev.json';
if (existsSync(OUT)) { console.log(`keep ${OUT}`); process.exit(0); }
writeFileSync(OUT, JSON.stringify(trustFromKeys(JSON.parse(readFileSync('fixtures/keys.json', 'utf8')) as KeysFile), null, 2) + '\n');
console.log(`wrote ${OUT}`);
```

`tools/gen-vectors-addendum.ts`:
```ts
// Golden vectors for protocol-v1 Addendum A (Stage 2). Refuses to overwrite: frozen once written.
//   node tools/gen-vectors-addendum.ts
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { ackArray, ackMessage } from '../packages/core/src/ack.ts';
import { hexToBytes, toHex } from '../packages/core/src/bytes.ts';
import { canon } from '../packages/core/src/canon.ts';
import { DEV_PSEUD_KEY, devPseud } from '../packages/core/src/dev.ts';
import { NO_PREV_STH, leafHashHex, receiptMessage, responsesOf, sthArray, sthId, sthMessage, type Sth } from '../packages/core/src/log.ts';
import { signer } from '../packages/core/src/node.ts';
import { bodyArray, counts, finalHash, receiptArray, type Body } from '../packages/core/src/protocol.ts';

const OUT = 'fixtures/vectors/protocol-v1-addendum-a.json';
if (existsSync(OUT)) { console.log(`keep ${OUT} (frozen)`); process.exit(0); }
const V = JSON.parse(readFileSync('fixtures/vectors/protocol-v1.json', 'utf8'));
const keys = JSON.parse(readFileSync('fixtures/keys.json', 'utf8'));
const pair = (k: { priv: string; pub: string }) => ({ priv: hexToBytes(k.priv), pub: hexToBytes(k.pub) });
const authority = signer(pair(keys.authority)), cell = signer(pair(keys.cells[0]));
const ctx = V.ctx;

// A visit (NA), an answer then a re-answer (last wins), a mark with an answer, and an untouched item (NV).
const bodies: Body[] = [
  { item: '', state: '', answer: '', meta: [] },
  { item: 'I02', state: 'NA', answer: '', meta: [0, []] },
  { item: 'I01', state: 'A', answer: 'C', meta: [900, []] },
  { item: 'I01', state: 'A', answer: 'D', meta: [400, []] },
  { item: 'I03', state: 'AMR', answer: 'B', meta: [700, []] },
];
const form = ['I01', 'I02', 'I03', 'I04'];
const responses = responsesOf(form, bodies);
const fh = finalHash(ctx, 'F1', responses);
const sth: Sth = { exam: ctx.exam, shift: ctx.shift, size: 13, root: V.merkle.roots[12], prevSTH: NO_PREV_STH, ts: 1790000000000 };
const ack = { ...ctx, keyEpoch: 1, seq: 1, h: V.entry.h };
const leafIn = { exam: ctx.exam, shift: ctx.shift, attempt: ctx.attempt, pseud: devPseud('C0001'), h: V.entry.h, finalHash: fh };

writeFileSync(OUT, JSON.stringify({
  _note: 'protocol-v1 Addendum A (docs/protocol-v1.md §14). Signatures are random: verify them, never compare bytes.',
  ctx,
  pseud: { key: toHex(DEV_PSEUD_KEY), roll: 'C0001', pseud: devPseud('C0001') },
  responses: { formName: 'F1', form, bodies: bodies.map(bodyArray), responses, finalHash: fh, counts: counts(responses) },
  sth: { sth, canon: canon(sthArray(sth)), id: sthId(sth), pub: keys.authority.pub, sig: toHex(authority(sthMessage(sth))) },
  receiptSig: { in: V.receipt.in, canon: canon(receiptArray(V.receipt.in)), pub: keys.cells[0].pub, sig: toHex(cell(receiptMessage(V.receipt.in))) },
  ack: { in: ack, canon: canon(ackArray(ack)), pub: keys.cells[0].pub, sig: toHex(cell(ackMessage(ack))) },
  leaf: { in: leafIn, hash: leafHashHex(leafIn) },
}, null, 2) + '\n');
console.log(`wrote ${OUT}`);
```

Run: `node tools/gen-trust.ts && node tools/gen-vectors-addendum.ts`
Expected: `wrote fixtures/trust-dev.json` and `wrote fixtures/vectors/protocol-v1-addendum-a.json`.

- [ ] **Step 5: Run the core tests to verify they pass**

Run: `cd packages/core && node --test test/log.test.ts test/addendum.test.ts test/vectors.test.ts test/journal.test.ts`
Expected: PASS. The Stage 0 vectors and journal tests are unchanged.

- [ ] **Step 6: Extend the simulated seat (test first)**

Add to `apps/server/test/sim-seat.test.ts`, merging the imports:
```ts
import { hexToBytes } from '@saakshi/core/bytes';
import { devPseud } from '@saakshi/core/dev';
import { responsesOf } from '@saakshi/core/log';
import { bodyCommit, bodyFromArray, finalHash } from '@saakshi/core/protocol';
import { FORMS } from '../../../tools/sim-seat.ts';

test('submit() closes the chain with [form, finalHash] of the replayed responses; sheet() is the honest record', () => {
  const s = new SimSeat(keys, 'C0002', cell.pub);
  s.add(4);
  s.append('clear', { item: 'I19', state: 'NA', answer: '', meta: [0, []] });
  s.submit();
  const last = parseSignedLine(s.entries.at(-1)!.line);
  if (!last.ok) throw new Error(last.detail);
  expect(last.header.kind).toBe('submit');
  const fh = finalHash(s.ctx, 'F2', responsesOf(FORMS.F2, s.bodies.slice(0, -1)));
  expect(s.bodies.at(-1)!.meta).toEqual(['F2', fh]);
  const sh = s.sheet();
  expect(sh).toMatchObject({ ctx: s.ctx, form: 'F2', pseud: devPseud('C0002'), keys: [{ keyEpoch: 1, pub: keys.seats[1].pub }] });
  expect(sh.entries.length).toBe(6);
  sh.entries.forEach((e, i) => {
    const p = parseSignedLine(e.line);
    if (!p.ok) throw new Error(p.detail);
    expect(e.line).toBe(s.entries[i].line);
    expect(bodyCommit(hexToBytes(e.salt), bodyFromArray(e.body))).toBe(p.header.bodyCommit);
  });
});
```

Run: `bun test apps/server/test/sim-seat.test.ts`
Expected: FAIL. `FORMS` is not exported, and `append` and `submit` do not exist.

- [ ] **Step 7: Rewrite `tools/sim-seat.ts`**

The existing behaviour is kept: `add`, `alt`, `after` and `make` with the same defaults. The new parts are the salt and body bookkeeping, `append`, `submit` and `sheet`.
```ts
// A scripted seat for server tests, seat sync tests and tools: a valid signed chain for one DEV candidate,
// with every body sealed to the cell exactly as the real seat does it, and the salts and bodies kept so a test
// can build the honest response sheet a cell should export.
import { readFileSync } from 'node:fs';
import { randomBytes, toHex } from '../packages/core/src/bytes.ts';
import { DEV_EXAM, devForm, devPseud, devSeat, type KeysFile } from '../packages/core/src/dev.ts';
import { signedLine } from '../packages/core/src/journal.ts';
import { responsesOf } from '../packages/core/src/log.ts';
import { sealBody, signer } from '../packages/core/src/node.ts';
import { bodyArray, entryHash, finalHash, genesisPrev, type Body, type Ctx, type Header, type Kind } from '../packages/core/src/protocol.ts';
import type { ResponseSheet } from '../packages/core/src/sheet.ts';
import { toB64, type WireEntry } from '../packages/core/src/wire.ts';

export const FORMS = JSON.parse(readFileSync(new URL('../fixtures/paper/forms.json', import.meta.url), 'utf8')) as Record<'F1' | 'F2', string[]>;
export interface Made { entry: WireEntry; header: Header; h: string; salt: Uint8Array; body: Body }

export class SimSeat {
  readonly ctx: Ctx;
  readonly entries: WireEntry[] = [];
  readonly hs: string[] = [];
  readonly headers: Header[] = [];
  readonly salts: Uint8Array[] = [];
  readonly bodies: Body[] = [];
  #sign: (m: Uint8Array) => Uint8Array;
  #pub: Uint8Array;
  #cellPub: Uint8Array;
  #keyEpoch: number;

  constructor(keys: KeysFile, cand: string, cellPub: Uint8Array, keyEpoch = 1) {
    const k = devSeat(keys, cand);
    if (!k) throw new Error(`no DEV seat key for ${cand}`);
    this.ctx = { ...DEV_EXAM, cand };
    this.#sign = signer(k);
    this.#pub = k.pub;
    this.#cellPub = cellPub;
    this.#keyEpoch = keyEpoch;
  }

  get head(): number { return this.hs.length; }
  get #prev(): string { return this.hs.at(-1) ?? genesisPrev(this.ctx); }

  /** Append n entries: an unlock first, then answers cycling through I01…I20. */
  add(n = 1): WireEntry[] {
    const out: WireEntry[] = [];
    for (let i = 0; i < n; i++) { const seq = this.head + 1; out.push(this.#push(this.make(seq, this.#prev, 'ABCD'[seq % 4]))); }
    return out;
  }

  /** Append one entry with an explicit kind and body (a first-visit clear/NA, a mark, a bad submit…). */
  append(kind: Kind, body: Body): WireEntry { return this.#push(this.make(this.head + 1, this.#prev, '', body, kind)); }

  /** Append a submit: meta [form, finalHash] over every item of the form (protocol Addendum A.5). */
  submit(form: 'F1' | 'F2' = devForm(this.ctx.cand)): WireEntry {
    const fh = finalHash(this.ctx, form, responsesOf(FORMS[form], this.bodies));
    return this.append('submit', { item: '', state: '', answer: '', meta: [form, fh] });
  }

  /** The honest response sheet a cell should export for this seat (no receipt: the cell adds that). */
  sheet(form: 'F1' | 'F2' = devForm(this.ctx.cand)): ResponseSheet {
    return {
      ctx: this.ctx, form, pseud: devPseud(this.ctx.cand), keys: [{ keyEpoch: this.#keyEpoch, pub: toHex(this.#pub) }],
      entries: this.entries.map((e, i) => ({ line: e.line, salt: toHex(this.salts[i]), body: bodyArray(this.bodies[i]) })),
    };
  }

  /** A validly signed entry at an existing seq with different content — what a forking seat would send. */
  alt(seq: number): WireEntry {
    return this.make(seq, seq === 1 ? genesisPrev(this.ctx) : this.hs[seq - 2], 'Z').entry;
  }

  /** The entries after `acked`, at most `limit` — what a sender resends. */
  after(acked: number, limit = 500): WireEntry[] {
    const from = Math.max(0, acked);
    return this.entries.slice(from, from + limit);
  }

  make(seq: number, prev: string, answer: string, body?: Body, kind?: Kind): Made {
    const b: Body = body ?? (seq === 1 ? { item: '', state: '', answer: '', meta: [] }
      : { item: `I${String(((seq - 2) % 20) + 1).padStart(2, '0')}`, state: 'A', answer, meta: [1000, []] });
    const salt = randomBytes(16);
    const { envelope, bodyCommit } = sealBody(this.#cellPub, { ...this.ctx, seq }, salt, b);
    const header: Header = { ...this.ctx, keyEpoch: this.#keyEpoch, seq, prev, kind: kind ?? (seq === 1 ? 'unlock' : 'answer'), tMonoMs: seq * 1000, activeMs: seq * 1000, bodyCommit };
    return { entry: { line: signedLine(header, this.#sign), env: toB64(envelope) }, header, h: toHex(entryHash(header)), salt, body: b };
  }

  #push(m: Made): WireEntry {
    this.entries.push(m.entry); this.headers.push(m.header); this.hs.push(m.h); this.salts.push(m.salt); this.bodies.push(m.body);
    return m.entry;
  }
}
```

Run: `bun test apps/server/test/sim-seat.test.ts && bun tools/chaos-kill.ts --seats 2 --entries 40` (the second command needs the sandbox disabled)
Expected: PASS, and the kill test still prints `PASS`.

- [ ] **Step 8: Seat IPC contract**

Replace `apps/seat/src/shared/ipc.ts`:
```ts
// Contract between Electron main (Task 4) and the renderer (Task 5). Types only.
import type { State } from '@saakshi/core/protocol';

export type Lang = 'en' | 'hi';
/** The latest journaled state of one item; seq is the entry that set it (drives the tick). */
export interface ItemState { state: State; answer: string; seq: number }
/** local: journal head (✓). relay: highest seq the relay confirmed with our own h (✓✓). cell: highest seq with a verified cell ack (blue ✓✓). */
export interface SyncView { local: number; relay: number; cell: number; online: boolean; error: string }
/** Computed on the seat at submit from its own journal (protocol Addendum A.5). code = receipt code; total = items on the form. */
export interface Receipt {
  exam: string; shift: string; cand: string; form: string; code: string;
  seq: number; h: string; finalHash: string; attempted: number; answered: number; marked: number; total: number;
}
export interface ExamBoot {
  cand: string; seatId: string; form: 'F1' | 'F2'; durationMs: number;
  activeMs: number; started: boolean; items: Record<string, ItemState>; sync: SyncView;
  /** Present once the exam is submitted, so a relaunch shows the slip again. */
  receipt?: Receipt;
  /** false with SAAKSHI_NO_CAMERA=1 or --no-camera: no getUserMedia, no MediaPipe, chip says "Camera off (test mode)". */
  camera: boolean;
}
/** answer → A + option; mark → MR with '' or AMR + option; clear → NA with '' (also a first visit, Addendum A.6). */
export interface Action { kind: 'answer' | 'mark' | 'clear'; item: string; state: State; answer: string; dwellMs: number }
export type ActResult = { ok: true; seq: number; activeMs: number } | { ok: false; error: string };
export type SubmitResult = { ok: true; receipt: Receipt } | { ok: false; error: string };
export interface SeatApi {
  load(): Promise<ExamBoot>;
  start(): Promise<ActResult>;
  act(a: Action): Promise<ActResult>;
  submit(): Promise<SubmitResult>;
  onSync(cb: (v: SyncView) => void): () => void;
}
```

- [ ] **Step 9: Append Addendum A to `docs/protocol-v1.md`**

Append this verbatim at the end of the file:
````markdown
## 14. Addendum A (Stage 2, 2026-09-27)

This addendum is additive only. No byte defined in §1–§13 changes, so `V` stays 1.

- Vectors: `fixtures/vectors/protocol-v1-addendum-a.json`, produced by `tools/gen-vectors-addendum.ts`.
- They are checked by `packages/core/test/addendum.test.ts`, and in the browser by `/verify` on every load.

**A.1 Signatures over non-entry structures.**
- These structures are signed as `m = UTF-8(canon(array))`, with **no domain byte**.
- The algorithm, encoding and low-S rule are those of §7. Stage 1 already signs acks this way.
- Such a message can never be read as a domain-tagged one: every §3 message starts with a byte from 0x00 to 0x07, and canonical text starts with `[` (0x5b).

| Structure | Array | Signed by |
|---|---|---|
| ack | `["ack",exam,shift,attempt,cand,keyEpoch,seq,h]` | the cell |
| receipt countersignature | the §5 receipt array `B` | the cell |
| STH | `["sth",exam,shift,size,root,prevSTH,ts]` | the exam authority |

**A.2 STH fields.**

| Field | Meaning |
|---|---|
| `size` | the number of leaves (a safe integer ≥ 0) |
| `root` | the §10 MTH over the leaf hashes in log order, as 64 hex |
| `prevSTH` | `hex(SHA-256(m))` of the previous STH of the same shift, or 64 × `0` for the first |
| `ts` | milliseconds since the Unix epoch |

- `sthId = hex(SHA-256(m))`.
- Leaves are appended in seal order and are never reordered or removed. So every STH of a shift is consistent with the one before it (§10 consistency proofs).

**A.3 Leaf.** For a submitted chain:
- `h` is the submit entry's `h`;
- `finalHash` is the submit body's `meta[1]`;
- `pseud` follows A.4.

**A.4 Pseudonym.**
- `pseud = hex(HMAC-SHA256(K_pseud, UTF-8(roll)))`, as 64 lowercase hex characters.
- DEV: `K_pseud = SHA-256(UTF-8("saakshi-dev-pseud"))` and `roll = cand`. This key is published.

**A.5 Submit and replay.** These §6 conventions are now enforced by relay and cell.

The submit body:
- It is `["body","","","",[form,finalHash]]`.
- `form` must be the candidate's form.

How `responses` is built:
- It has one row per item of the form's item list.
- Each row is `[item,state,answer]`, taken from the **last** entry in chain order whose body names that item. If no entry does, the row is `[item,"NV",""]`.
- An entry whose body names an item outside the candidate's form is rejected.
- An item entry's `state` is never `''`.

The checks:
- The cell replays the committed bodies before the submit and recomputes `finalHash` (§5). A mismatch is `BAD_SUBMISSION`.
- The submit is the last entry. Relay and cell reject any entry with `seq` greater than the submit's as `BAD_SUBMISSION`.
- An exact resend of the submit, or of any earlier entry, stays a no-op.

The receipt:
- Its counts are `counts(responses)` (§6).
- The cell countersigns `B` (A.1).

**A.6 First visit.**
- The first time an item is displayed with no journaled state, the seat appends a `clear` entry with body `["body",item,"NA","",[0,[]]]`.
- No new kind or state is needed, because `clear`/`NA` already means "visited, not answered". `attempted` therefore counts visited items.

**A.7 Response sheet and proof (non-normative JSON; the types are in `packages/core/src/sheet.ts`).**

The response sheet:
- `{ctx, form, pseud, keys:[{keyEpoch,pub}], entries:[{line, salt, body}], receipt?:{cell,seq,h,code,sig}}`.
- `line` is the §11 signed line.
- `salt` is 32 hex characters.
- `body` is the body array **as recorded**, which may have been tampered with. A missing row is written as `["missing"]`.

The proof:
- `{v:1, sheet, sth:{sth, sig}, index, inclusion:[hex…]}`.

A verifier checks:
1. each key is the pinned key for `(cand, keyEpoch)`;
2. the chain (§11), per epoch;
3. every body against its signed `bodyCommit` (a mismatch triggers an option search with the salt);
4. that the replayed `finalHash` equals the submit's;
5. the receipt code and the cell countersignature;
6. the STH signature;
7. the inclusion of `leafArray(…, h, finalHash)` (§10).
````

- [ ] **Step 10: Run everything this task touches**

Run: `pnpm --filter @saakshi/core test && bun test apps/server/test/sim-seat.test.ts && pnpm --filter @saakshi/core --filter @saakshi/server typecheck`
Expected: PASS. The seat typecheck fails until Tasks 4 and 5 add `submit` to the preload and `camera` to `exam:load`; that is expected in this wave.

---

### Task 2: Core verifier and browser self-test — `verify.ts`, `selftest.ts`

**Files:**
- Create: `packages/core/src/verify.ts`, `packages/core/src/selftest.ts`
- Test: `packages/core/test/verify.test.ts`, `packages/core/test/selftest.test.ts`

**Interfaces:**
- Consumes (Task 1):
  - `verifyChainKeyed`, `parseSignedLine`, `ChainFault`;
  - `responsesOf`, `receiptMessage`, `sthMessage`, `leafHashHex`, `Leaf`;
  - `Proof`, `ResponseSheet`, `Trust`, `Forms`;
  - `SimSeat` (tests only).
- Produces:
  - `type CheckName = 'keys'|'chain'|'bodies'|'finalHash'|'receipt'|'slip'|'sth'|'inclusion'`
  - `interface Check {name; ok; detail}`
  - `interface Answer {state; answer}`
  - `interface Mismatch {seq; item; q; recorded: Answer; committed: Answer | null}`
  - `interface SheetReport {ok; checks; mismatches; fault?; submit?; receipt?; leaf?}`
  - `optionSearch(salt, recorded, commit): Body | null`
  - `mismatchText(m): string`, which produces exactly `Q17: record says C — the seat committed B`
  - `verifySheet(sheet, forms, trust, mkVerify = nobleVerifier): SheetReport`
  - `verifyProof(proof, forms, trust, typedCode?, mkVerify = nobleVerifier): SheetReport`
  - `parseProof(x: unknown): Proof` (throws `proof: …`)
  - `selftest.ts`: `goldenSelfTest(V, A): { pass: number; fail: string[] }`
- Both files are browser-safe: no `node.ts`, `wire.ts` or `node:*`. Tests pass node's `verifier` as `mkVerify` only where speed matters.

- [ ] **Step 1: Write the failing tests**

`packages/core/test/verify.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { hexToBytes, toHex } from '../src/bytes.ts';
import { cellKey, trustFromKeys, type KeysFile } from '../src/dev.ts';
import { leafHashHex, sthMessage, NO_PREV_STH, type Sth } from '../src/log.ts';
import { inclusionProof, rootOf } from '../src/merkle.ts';
import { signer } from '../src/node.ts';
import { formsOf, type Proof, type ResponseSheet } from '../src/sheet.ts';
import { mismatchText, parseProof, verifyProof, verifySheet } from '../src/verify.ts';
import { SimSeat } from '../../../tools/sim-seat.ts';

const root = new URL('../../../', import.meta.url);
const read = (p: string) => JSON.parse(readFileSync(new URL(p, root), 'utf8'));
const keys = read('fixtures/keys.json') as KeysFile;
const forms = formsOf(read('fixtures/paper/forms.json'));
const trust = trustFromKeys(keys);
const cell = cellKey(keys, 'cell-1');
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

/** C0001 (form F1): unlock, visit Q17, answer Q17 = B, answer Q1 = D, submit. */
function honest(): ResponseSheet {
  const s = new SimSeat(keys, 'C0001', cell.pub);
  s.add(1);
  s.append('clear', { item: 'I17', state: 'NA', answer: '', meta: [0, []] });
  s.append('answer', { item: 'I17', state: 'A', answer: 'B', meta: [4000, []] });
  s.append('answer', { item: 'I01', state: 'A', answer: 'D', meta: [2000, []] });
  s.submit();
  return s.sheet();
}

/** A proof for `sheet`: its leaf at index 1 of 3, under an STH signed by the authority. */
function proofOf(sheet: ResponseSheet, signKey = keys.authority): Proof {
  const r = verifySheet(sheet, forms, trust);
  const leaves = [leafHashHex({ ...r.leaf!, pseud: 'a'.repeat(64) }), leafHashHex(r.leaf!), leafHashHex({ ...r.leaf!, pseud: 'b'.repeat(64) })].map(hexToBytes);
  const sth: Sth = { exam: 'DEMO-2026', shift: 'S1', size: 3, root: toHex(rootOf(leaves)), prevSTH: NO_PREV_STH, ts: 1 };
  const sig = toHex(signer({ priv: hexToBytes(signKey.priv), pub: hexToBytes(signKey.pub) })(sthMessage(sth)));
  return { v: 1, sheet, sth: { sth, sig }, index: 1, inclusion: inclusionProof(leaves, 1).map(toHex) };
}
const failed = (r: { checks: { name: string; ok: boolean }[] }) => r.checks.filter((c) => !c.ok).map((c) => c.name);

test('an honest sheet verifies: keys, chain, bodies, finalHash and receipt', () => {
  const r = verifySheet(honest(), forms, trust);
  assert.deepEqual(failed(r), []);
  assert.equal(r.ok, true);
  assert.deepEqual(r.mismatches, []);
  assert.equal(r.submit?.seq, 5);
  assert.match(r.receipt!.code, /^[0-9A-Z*~$=]{17}$/);
  assert.deepEqual([r.receipt!.attempted, r.receipt!.answered, r.receipt!.marked], [2, 2, 0]);
});

test('an edited answer: "Q17: record says C — the seat committed B"; finalHash and receipt still verify from the committed bodies', () => {
  const sheet = honest();
  sheet.entries[2].body = ['body', 'I17', 'A', 'C', [4000, []]];
  const r = verifySheet(sheet, forms, trust);
  assert.equal(r.ok, false);
  assert.deepEqual(failed(r), ['bodies']);
  assert.equal(r.mismatches.length, 1);
  assert.equal(mismatchText(r.mismatches[0]), 'Q17: record says C — the seat committed B');
});

test('an edit that also changes meta cannot be recovered by option search, and finalHash cannot be replayed', () => {
  const sheet = honest();
  sheet.entries[2].body = ['body', 'I17', 'A', 'C', [1, []]];
  const r = verifySheet(sheet, forms, trust);
  assert.equal(r.mismatches[0].committed, null);
  assert.equal(mismatchText(r.mismatches[0]), 'Q17: record says C — what the seat committed cannot be recovered');
  assert.deepEqual(failed(r), ['bodies', 'finalHash', 'receipt']);
});

test('a deleted row, a truncated chain and a changed signature are each located', () => {
  const del = honest(); del.entries.splice(2, 1);
  assert.deepEqual(verifySheet(del, forms, trust).fault, { seq: 3, fault: 'seq', detail: 'expected seq 3, found 4' });

  const cut = honest(); cut.entries.pop();
  const rc = verifySheet(cut, forms, trust);
  assert.deepEqual(failed(rc), ['finalHash', 'receipt']);
  assert.match(rc.checks.find((c) => c.name === 'finalHash')!.detail, /does not end in a submit/);

  const sig = honest();
  sig.entries[3].line = sig.entries[3].line.replace(/"([0-9a-f]{127})([0-9a-f])"\]$/, (_m, a, z) => `"${a}${z === '0' ? '1' : '0'}"]`);
  const rs = verifySheet(sig, forms, trust);
  assert.equal(rs.fault?.seq, 4);
  assert.equal(rs.fault?.fault, 'sig');
});

test('a key that is not the pinned key for (cand, keyEpoch) fails keys and chain', () => {
  const sheet = honest();
  sheet.keys = [{ keyEpoch: 1, pub: keys.seats[5].pub }];
  assert.deepEqual(failed(verifySheet(sheet, forms, trust)).slice(0, 2), ['keys', 'chain']);
});

test('verifyProof: STH signature and inclusion verify; a wrong signer or index fails', () => {
  const p = proofOf(honest());
  assert.deepEqual(failed(verifyProof(p, forms, trust)), []);
  assert.deepEqual(failed(verifyProof(proofOf(honest(), keys.cells[0]), forms, trust)), ['sth']);
  assert.deepEqual(failed(verifyProof({ ...p, index: 0 }, forms, trust)), ['inclusion']);
});

test('slip: lowercase, dashes and O-for-0 still match; a one-symbol typo asks to re-type', () => {
  const p = proofOf(honest());
  const code = verifySheet(p.sheet, forms, trust).receipt!.code;
  const typed = code.toLowerCase().replace(/(.{4})/g, '$1-').replace(/0/g, 'o');
  assert.equal(verifyProof(p, forms, trust, typed).ok, true);
  const other = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'.split('').find((c) => c !== code[0])!;
  const r = verifyProof(p, forms, trust, other + code.slice(1));
  const slip = r.checks.find((c) => c.name === 'slip')!;
  assert.equal(slip.ok, false);
  assert.match(slip.detail, /re-type/);
});

test('parseProof rejects malformed proofs and accepts a JSON round trip of a good one', () => {
  const good = proofOf(honest());
  assert.deepEqual(parseProof(JSON.parse(JSON.stringify(good))), good);
  const bad: unknown[] = [null, {}, { ...good, v: 2 }];
  const b1 = clone(good); b1.sheet.entries[0].salt = 'xyz'; bad.push(b1);
  const b2 = clone(good); b2.sth.sig = 'ab'; bad.push(b2);
  const b3 = clone(good); (b3.sheet.entries[0] as { body: unknown }).body = { a: 1 }; bad.push(b3);
  const b4 = clone(good); b4.inclusion = ['<script>']; bad.push(b4);
  for (const x of bad) assert.throws(() => parseProof(x), /^Error: proof: /);
});
```

`packages/core/test/selftest.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { goldenSelfTest } from '../src/selftest.ts';

const read = (p: string) => JSON.parse(readFileSync(new URL(`../../../${p}`, import.meta.url), 'utf8'));

test('the golden self-test /verify runs in the browser passes on the frozen vectors', () => {
  const r = goldenSelfTest(read('fixtures/vectors/protocol-v1.json'), read('fixtures/vectors/protocol-v1-addendum-a.json'));
  assert.deepEqual(r.fail, []);
  assert.ok(r.pass >= 30, `only ${r.pass} checks ran`);
});

test('the self-test notices a corrupted vector', () => {
  const V = read('fixtures/vectors/protocol-v1.json');
  V.genesisPrev = V.genesisPrev.replace(/^./, (c: string) => (c === '0' ? '1' : '0'));
  const r = goldenSelfTest(V, read('fixtures/vectors/protocol-v1-addendum-a.json'));
  assert.deepEqual(r.fail, ['genesis prev']);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd packages/core && node --test test/verify.test.ts test/selftest.test.ts`
Expected: FAIL. `../src/verify.ts` cannot be found.

- [ ] **Step 3: Write `packages/core/src/verify.ts`**

```ts
// The one verifier: the audit (server) and /verify (browser) both call it. Browser-safe: noble by default.
import { crockford80, decodeCrockford80, hexToBytes, toHex } from './bytes.ts';
import { canon, type Canon } from './canon.ts';
import { parseSignedLine, verifyChainKeyed, type ChainFault } from './journal.ts';
import { leafHashHex, receiptMessage, responsesOf, sthMessage, type Leaf } from './log.ts';
import { verifyInclusion } from './merkle.ts';
import { STATES, bodyCommit, bodyFromArray, counts, entryHash, finalHash, receiptCode, type Body, type ReceiptIn, type Response } from './protocol.ts';
import type { Forms, Proof, ResponseSheet, Trust } from './sheet.ts';
import { nobleVerifier, type Verify } from './sig.ts';

export type CheckName = 'keys' | 'chain' | 'bodies' | 'finalHash' | 'receipt' | 'slip' | 'sth' | 'inclusion';
export interface Check { name: CheckName; ok: boolean; detail: string }
export interface Answer { state: string; answer: string }
/** A body the record holds that is not what the seat committed. committed = null: option search found nothing. */
export interface Mismatch { seq: number; item: string; q: number; recorded: Answer; committed: Answer | null }
export interface SheetReport {
  ok: boolean;
  checks: Check[];
  mismatches: Mismatch[];
  fault?: { seq: number; fault: ChainFault; detail: string };
  submit?: { seq: number; h: string; form: string; finalHash: string };
  /** Receipt B recomputed from the committed bodies, with its code. */
  receipt?: ReceiptIn & { code: string };
  leaf?: Leaf;
}
type MkVerify = (pub: Uint8Array) => Verify;

const OPTIONS = ['', 'A', 'B', 'C', 'D'];

/** Recovery by option search: the body the seat committed, if only state and/or answer were changed. */
export function optionSearch(salt: Uint8Array, recorded: Body, commit: string): Body | null {
  for (const state of ['', ...STATES] as Body['state'][]) {
    for (const answer of OPTIONS) {
      const b: Body = { ...recorded, state, answer };
      if (bodyCommit(salt, b) === commit) return b;
    }
  }
  return null;
}

/** "Q17: record says C — the seat committed B". Falls back to states when the answers agree. */
export function mismatchText(m: Mismatch): string {
  const where = m.q ? `Q${m.q}` : `Entry ${m.seq}`;
  const sameAnswer = m.committed && m.committed.answer === m.recorded.answer;
  const say = (a: Answer) => (sameAnswer ? a.state || 'no state' : a.answer || 'no answer');
  return `${where}: record says ${say(m.recorded)} — ${m.committed ? `the seat committed ${say(m.committed)}` : 'what the seat committed cannot be recovered'}`;
}

export function verifySheet(sheet: ResponseSheet, forms: Forms, trust: Trust, mkVerify: MkVerify = nobleVerifier): SheetReport {
  const { ctx } = sheet;
  const checks: Check[] = [];
  const mismatches: Mismatch[] = [];
  const check = (name: CheckName, ok: boolean, detail: string) => { checks.push({ name, ok, detail }); };
  const form = forms[sheet.form];

  // 1. Keys: each key the sheet names must be the pinned key for (cand, keyEpoch).
  const keyed = new Map<number, Verify>();
  const badKeys: number[] = [];
  for (const k of sheet.keys) {
    if (trust.seats[`${ctx.cand}/${k.keyEpoch}`] === k.pub) keyed.set(k.keyEpoch, mkVerify(hexToBytes(k.pub)));
    else badKeys.push(k.keyEpoch);
  }
  check('keys', badKeys.length === 0 && keyed.size > 0,
    badKeys.length ? `keyEpoch ${badKeys.join(', ')}: not the pinned seat key for ${ctx.cand}` : keyed.size ? `${keyed.size} key epoch(s), each the pinned key for ${ctx.cand}` : 'no seat keys in the record');

  // 2. Chain, one verifier per key epoch.
  const chain = verifyChainKeyed(ctx, sheet.entries.map((e) => e.line), (e) => keyed.get(e));
  const fault = chain.ok ? undefined : { seq: chain.index + 1, fault: chain.fault, detail: chain.detail };
  check('chain', chain.ok, fault ? `entry ${fault.seq}: ${fault.fault} — ${fault.detail}` : `${sheet.entries.length} entries: signatures, sequence and links verify`);

  // 3. Every recorded body against its signed commitment; option search where they differ.
  const committed: (Body | null)[] = [];
  for (const e of sheet.entries) {
    const p = parseSignedLine(e.line);
    if (!p.ok) { committed.push(null); continue; }
    let rb: Body | undefined;
    try { rb = bodyFromArray(e.body); } catch { /* missing or garbled row */ }
    const salt = hexToBytes(e.salt);
    if (rb && bodyCommit(salt, rb) === p.header.bodyCommit) { committed.push(rb); continue; }
    const c = rb ? optionSearch(salt, rb, p.header.bodyCommit) : null;
    mismatches.push({
      seq: p.header.seq, item: rb?.item ?? '', q: rb && form ? form.indexOf(rb.item) + 1 : 0,
      recorded: rb ? { state: rb.state, answer: rb.answer } : { state: '', answer: '(unreadable)' },
      committed: c && { state: c.state, answer: c.answer },
    });
    committed.push(c);
  }
  check('bodies', mismatches.length === 0, mismatches.length
    ? `${mismatches.length} of ${sheet.entries.length} bodies differ from what the seat committed`
    : `${sheet.entries.length} bodies match their signed commitments`);

  // 4. finalHash: the chain must end in a submit whose committed meta is [form, finalHash]; replay must agree.
  const lastLine = sheet.entries.at(-1);
  const last = lastLine ? parseSignedLine(lastLine.line) : undefined;
  const sb = committed.at(-1);
  let submit: SheetReport['submit'];
  if (last?.ok && last.header.kind === 'submit' && sb && typeof sb.meta[0] === 'string' && typeof sb.meta[1] === 'string')
    submit = { seq: last.header.seq, h: toHex(entryHash(last.header)), form: sb.meta[0], finalHash: sb.meta[1] };
  let responses: Response[] | undefined;
  if (!submit) check('finalHash', false, 'the chain does not end in a submit (truncated, or not submitted yet)');
  else if (!form || submit.form !== sheet.form) check('finalHash', false, `the submit names form ${submit.form}; the record says ${sheet.form}`);
  else {
    const before = committed.slice(0, -1);
    const lost = before.findIndex((b) => b === null);
    if (lost >= 0) check('finalHash', false, `cannot replay: entry ${lost + 1} cannot be recovered`);
    else {
      try {
        const rs = responsesOf(form, before as Body[]);
        const same = finalHash(ctx, sheet.form, rs) === submit.finalHash;
        if (same) responses = rs;
        check('finalHash', same, same ? 'replaying the committed answers gives the submitted finalHash' : 'replaying the committed answers does not give the submitted finalHash');
      } catch (e) { check('finalHash', false, `cannot replay: ${(e as Error).message}`); }
    }
  }

  // 5. Receipt B from the committed record, and the cell's countersignature if the record carries one.
  let receipt: SheetReport['receipt'];
  const leaf: Leaf | undefined = submit && { exam: ctx.exam, shift: ctx.shift, attempt: ctx.attempt, pseud: sheet.pseud, h: submit.h, finalHash: submit.finalHash };
  if (submit && responses) {
    const B: ReceiptIn = { exam: ctx.exam, shift: ctx.shift, attempt: ctx.attempt, pseud: sheet.pseud, seq: submit.seq, h: submit.h, finalHash: submit.finalHash, ...counts(responses) };
    receipt = { ...B, code: receiptCode(B) };
    const r = sheet.receipt;
    if (!r) check('receipt', true, `receipt ${receipt.code}; this record carries no cell countersignature yet`);
    else {
      const pub = trust.cells[r.cell];
      const ok = !!pub && r.seq === B.seq && r.h === B.h && r.code === receipt.code && mkVerify(hexToBytes(pub))(receiptMessage(B), hexToBytes(r.sig));
      check('receipt', ok, ok ? `receipt ${receipt.code}, countersigned by ${r.cell}` : `the cell's receipt (${r.code}) does not match this record, or its countersignature fails`);
    }
  } else check('receipt', false, 'no receipt without a verified submit');

  return { ok: checks.every((c) => c.ok), checks, mismatches, fault, submit, receipt, leaf };
}

/** verifySheet plus the slip code as typed, the STH signature and the leaf's inclusion. */
export function verifyProof(p: Proof, forms: Forms, trust: Trust, typedCode?: string, mkVerify: MkVerify = nobleVerifier): SheetReport {
  const r = verifySheet(p.sheet, forms, trust, mkVerify);
  const add = (name: CheckName, ok: boolean, detail: string) => { r.checks.push({ name, ok, detail }); };
  if (typedCode !== undefined && typedCode.trim() !== '') {
    let typed: string | undefined;
    try { typed = crockford80(decodeCrockford80(typedCode.trim())); } catch { /* a typo: bad length, symbol or check */ }
    add('slip', !!typed && typed === r.receipt?.code,
      !typed ? 'the code as typed is not a valid receipt code — check it against the slip and re-type it'
        : typed === r.receipt?.code ? `matches the slip: ${typed}` : `the slip says ${typed}; this record gives ${r.receipt?.code ?? 'no receipt'}`);
  }
  const { sth, sig } = p.sth;
  const sthOk = sth.exam === p.sheet.ctx.exam && sth.shift === p.sheet.ctx.shift && mkVerify(hexToBytes(trust.authority))(sthMessage(sth), hexToBytes(sig));
  add('sth', sthOk, sthOk ? `register head of ${sth.size} leaves (root ${sth.root.slice(0, 16)}…) signed by the exam authority` : 'the register head is not signed by the pinned authority key, or belongs to another exam or shift');
  const incl = !!r.leaf && verifyInclusion(p.index, sth.size, hexToBytes(leafHashHex(r.leaf)), p.inclusion.map(hexToBytes), hexToBytes(sth.root));
  add('inclusion', incl, incl ? `leaf ${p.index + 1} of ${sth.size} is in the sealed register` : 'this submission is not in the sealed register');
  r.ok = r.checks.every((c) => c.ok) && r.mismatches.length === 0;
  return r;
}

const HEX64 = /^[0-9a-f]{64}$/, SIG = /^[0-9a-f]{128}$/, PUB = /^04[0-9a-f]{128}$/, SALT = /^[0-9a-f]{32}$/;
type O = Record<string, unknown>;
const obj = (x: unknown): x is O => typeof x === 'object' && x !== null && !Array.isArray(x);
const nat = (x: unknown): x is number => Number.isSafeInteger(x) && (x as number) >= 0;
const str = (x: unknown, max = 64): x is string => typeof x === 'string' && x.length > 0 && x.length <= max;
const is = (re: RegExp) => (x: unknown): x is string => typeof x === 'string' && re.test(x);
const tagged = (x: unknown): boolean => { try { canon(x as Canon[]); return true; } catch { return false; } };
function need(ok: boolean, what: string): asserts ok { if (!ok) throw new Error(`proof: ${what}`); }

/** Validate an untrusted proof file before anything reads it. */
export function parseProof(x: unknown): Proof {
  need(obj(x) && x.v === 1, 'not a Saakshi proof (v 1)');
  const { sheet, sth, index, inclusion } = x as O;
  need(obj(sheet) && obj(sheet.ctx), 'sheet.ctx is missing');
  const c = sheet.ctx as O;
  need(str(c.exam) && str(c.shift) && nat(c.attempt) && str(c.cand), 'sheet.ctx must be {exam, shift, attempt, cand}');
  need(str(sheet.form) && str(sheet.pseud, 128), 'sheet.form and sheet.pseud');
  need(Array.isArray(sheet.keys) && sheet.keys.length <= 16 && sheet.keys.every((k) => obj(k) && nat(k.keyEpoch) && is(PUB)(k.pub)), 'sheet.keys must be [{keyEpoch, pub}]');
  need(Array.isArray(sheet.entries) && sheet.entries.length <= 10_000
    && sheet.entries.every((e) => obj(e) && str(e.line, 4096) && is(SALT)(e.salt) && Array.isArray(e.body) && tagged(e.body)), 'sheet.entries must be [{line, salt, body}]');
  const r = sheet.receipt;
  need(r === undefined || (obj(r) && str(r.cell) && nat(r.seq) && is(HEX64)(r.h) && str(r.code, 32) && is(SIG)(r.sig)), 'sheet.receipt');
  need(obj(sth) && obj(sth.sth) && is(SIG)(sth.sig), 'sth must be {sth, sig}');
  const t = sth.sth as O;
  need(str(t.exam) && str(t.shift) && nat(t.size) && is(HEX64)(t.root) && is(HEX64)(t.prevSTH) && nat(t.ts), 'sth fields');
  need(nat(index) && Array.isArray(inclusion) && inclusion.length <= 64 && inclusion.every(is(HEX64)), 'index and inclusion');
  return x as unknown as Proof;
}
```

- [ ] **Step 4: Write `packages/core/src/selftest.ts`**

```ts
// Golden-vector self-test that /verify runs in the browser on every load (noble only).
import { ackMessage } from './ack.ts';
import { hexToBytes, toHex } from './bytes.ts';
import { canon, parseCanon } from './canon.ts';
import { verifyChain } from './journal.ts';
import { leafHashHex, pseudOf, receiptMessage, responsesOf, sthId, sthMessage } from './log.ts';
import { consistencyProof, inclusionProof, rootOf, verifyConsistency, verifyInclusion } from './merkle.ts';
import { D, bodyCommit, bodyFromArray, counts, entryHash, finalHash, genesisPrev, headerArray, kcf, receiptCode, tagged } from './protocol.ts';
import { nobleVerifier } from './sig.ts';

// The vector files are plain JSON; their shapes are pinned by packages/core/test/{vectors,addendum}.test.ts.
type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export function goldenSelfTest(V: J, A: J): { pass: number; fail: string[] } {
  let pass = 0;
  const fail: string[] = [];
  const t = (name: string, fn: () => boolean) => {
    try { if (fn()) pass++; else fail.push(name); } catch (e) { fail.push(`${name}: ${(e as Error).message}`); }
  };
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

  for (const [v, s] of V.canon.accept) t(`canon accepts ${s}`, () => canon(v) === s && canon(parseCanon(s)) === s);
  for (const s of V.canon.reject) t(`canon rejects ${s}`, () => { try { parseCanon(s); return false; } catch { return true; } });
  t('genesis prev', () => genesisPrev(V.ctx) === V.genesisPrev);
  t('body commit', () => bodyCommit(hexToBytes(V.body.salt), V.body.body) === V.body.bodyCommit);
  t('entry message', () => toHex(tagged(D.ENTRY, headerArray(V.entry.header))) === V.entry.m);
  t('entry hash', () => toHex(entryHash(V.entry.header)) === V.entry.h);
  t('finalHash', () => finalHash(V.ctx, V.final.form, V.final.responses) === V.final.finalHash);
  t('counts', () => same(counts(V.final.responses), { attempted: V.receipt.in.attempted, answered: V.receipt.in.answered, marked: V.receipt.in.marked }));
  t('receipt code', () => receiptCode(V.receipt.in) === V.receipt.code);
  t('key commitment', () => kcf(hexToBytes(V.kcf.K)) === V.kcf.kc);
  const L: Uint8Array[] = V.merkle.leafHashes.map(hexToBytes);
  t('merkle roots', () => V.merkle.roots.every((r: string, i: number) => toHex(rootOf(L.slice(0, i + 1))) === r));
  t('inclusion proofs', () => V.merkle.inclusion.every(({ size, index, proof }: J) =>
    same(inclusionProof(L.slice(0, size), index).map(toHex), proof) && verifyInclusion(index, size, L[index], proof.map(hexToBytes), hexToBytes(V.merkle.roots[size - 1]))));
  t('consistency proofs', () => V.merkle.consistency.every(({ size1, size2, proof }: J) =>
    same(consistencyProof(L.slice(0, size2), size1).map(toHex), proof)
    && verifyConsistency(size1, size2, proof.map(hexToBytes), hexToBytes(V.merkle.roots[size1 - 1]), hexToBytes(V.merkle.roots[size2 - 1]))));
  const seat = nobleVerifier(hexToBytes(V.signatures.pub));
  t('16 seat signatures (noble)', () => V.signatures.items.every(({ m, sig }: J) => seat(hexToBytes(m), hexToBytes(sig))));
  t('signed chain (noble)', () => verifyChain(V.ctx, V.chain.lines, seat).ok);

  t('A.4 pseudonym', () => pseudOf(hexToBytes(A.pseud.key), A.pseud.roll) === A.pseud.pseud);
  t('A.5 replayed responses', () => {
    const rs = responsesOf(A.responses.form, A.responses.bodies.map(bodyFromArray));
    return same(rs, A.responses.responses) && finalHash(A.ctx, A.responses.formName, rs) === A.responses.finalHash && same(counts(rs), A.responses.counts);
  });
  t('A.2 STH message and id', () => new TextDecoder().decode(sthMessage(A.sth.sth)) === A.sth.canon && sthId(A.sth.sth) === A.sth.id);
  t('A.1 STH signature (noble)', () => nobleVerifier(hexToBytes(A.sth.pub))(sthMessage(A.sth.sth), hexToBytes(A.sth.sig)));
  t('A.1 receipt countersignature (noble)', () => nobleVerifier(hexToBytes(A.receiptSig.pub))(receiptMessage(A.receiptSig.in), hexToBytes(A.receiptSig.sig)));
  t('A.1 ack signature (noble)', () => nobleVerifier(hexToBytes(A.ack.pub))(ackMessage(A.ack.in), hexToBytes(A.ack.sig)));
  t('A.3 leaf hash', () => leafHashHex(A.leaf.in) === A.leaf.hash);
  return { pass, fail };
}
```
If the lint comment is unused (there is no ESLint in the repo), delete it; `type J = any;` alone type-checks.

- [ ] **Step 5: Run them to verify they pass**

Run: `cd packages/core && node --test test/verify.test.ts test/selftest.test.ts && bun test --timeout 60000 test/verify.test.ts test/selftest.test.ts`
Expected: PASS under both Node and Bun.

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @saakshi/core typecheck`
Expected: exit 0.

---

### Task 3: Cell ingest — bodies record, submit replay, countersigned receipt, nothing after submit

**Files:**
- Modify: `apps/server/src/store.ts` (the `bodies` and `receipts` tables; `Row.body`, `Row.receipt`; insert them in the same transaction)
- Modify: `apps/server/src/ingest.ts` (the new options, per-stream `bodies` and `submitSeq`, the new checks, receipt countersigning)
- Test: `apps/server/test/submit.test.ts`

**Interfaces:**
- Consumes (Task 1):
  - `responsesOf`, `receiptMessage` from `@saakshi/core/log`;
  - `Forms` from `@saakshi/core/sheet`;
  - `devForm`, `devPseud`, and `formsOf` (tests);
  - `SimSeat.append/submit/salts/bodies`, `FORMS` (tests).
- Produces:
  - `store.ts`:
    - `interface BodyRow {item; state; answer; meta: string; salt: Uint8Array}`
    - `interface ReceiptRow {seq; h; finalHash; pseud; attempted; answered; marked; code; cell; sig}`
    - `Row.body?: BodyRow`, `Row.receipt?: ReceiptRow`
    - the table DDL exactly as in Global Constraints.
  - `IngestOpts` gains:
    - `forms?: Forms`
    - `formOf?: (cand) => string | undefined`
    - `pseud?: (cand) => string`
    - `cellId?: string` (default `'cell-1'`)
  - A cell without `forms` accepts item entries as before but rejects every submit. That keeps the Stage 1 tests valid.
  - Rejection reasons, which tests match:
    - `entry after submit`
    - `is not in <cand>'s form`
    - `finalHash does not match the replayed chain`
    - `the roster says`

- [ ] **Step 1: Write the failing tests**

`apps/server/test/submit.test.ts`:
```ts
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hexToBytes, toHex } from '@saakshi/core/bytes';
import { cellKey, devForm, devPseud, devSeatKey, type KeysFile } from '@saakshi/core/dev';
import { receiptMessage, responsesOf } from '@saakshi/core/log';
import { verifier } from '@saakshi/core/node';
import { counts, receiptCode } from '@saakshi/core/protocol';
import { formsOf } from '@saakshi/core/sheet';
import type { SyncRes, WireEntry } from '@saakshi/core/wire';
import { createIngest, type Ingest, type Mode } from '../src/ingest.ts';
import { openDb } from '../src/store.ts';
import { FORMS, SimSeat } from '../../../tools/sim-seat.ts';

const keys = JSON.parse(readFileSync(new URL('../../../fixtures/keys.json', import.meta.url), 'utf8')) as KeysFile;
const cell = cellKey(keys, 'cell-1');
const forms = formsOf(FORMS);
let dir: string;
const opened: Ingest[] = [];
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'saakshi-submit-')); });
afterEach(() => { for (const n of opened.splice(0)) n.close(); rmSync(dir, { recursive: true, force: true }); });

function node(mode: Mode, name: string = mode): Ingest {
  const { db } = openDb(join(dir, `${name}.db`));
  const n = createIngest({ mode, db, fresh: false, seatKey: devSeatKey(keys), cell: mode === 'cell' ? cell : { pub: cell.pub }, forms, formOf: devForm, pseud: devPseud, cellId: 'cell-1' });
  opened.push(n);
  return n;
}
const push = async (n: Ingest, s: SimSeat, entries: WireEntry[] = s.entries): Promise<SyncRes> => {
  const r = await n.sync({ entries, streams: [{ ...s.ctx, head: s.head }] });
  if (r === 'REBUILDING') throw new Error('unexpected REBUILDING');
  return r;
};
const rows = <T>(name: string, table: string): T[] => { const d = new Database(join(dir, `${name}.db`)); try { return d.query(`SELECT * FROM ${table} ORDER BY seq`).all() as T[]; } finally { d.close(); } };
const visit = (item: string) => ({ item, state: 'NA' as const, answer: '', meta: [0, []] });

test('cell: an honest submit with visits, re-answers and a clear is accepted and its receipt matches the seat\'s', async () => {
  const n = node('cell'), s = new SimSeat(keys, 'C0002', cell.pub);          // form F2: reversed order
  s.add(4);                                                                    // unlock + I01 I02 I03 answered
  s.append('clear', visit('I19'));                                             // first visit
  s.append('answer', { item: 'I02', state: 'A', answer: 'D', meta: [500, []] }); // re-answer: last wins
  s.append('mark', { item: 'I05', state: 'AMR', answer: 'B', meta: [900, []] });
  s.append('answer', { item: 'I06', state: 'A', answer: 'C', meta: [100, []] });
  s.append('clear', { item: 'I06', state: 'NA', answer: '', meta: [100, []] }); // answered, then cleared
  s.submit();
  const r = await push(n, s);
  expect(r.rejected).toEqual([]);
  expect(r.streams[0].head).toBe(10);
  const rc = responsesOf(FORMS.F2, s.bodies.slice(0, -1));
  const B = { exam: 'DEMO-2026', shift: 'S1', attempt: 1, pseud: devPseud('C0002'), seq: 10, h: s.hs[9], finalHash: s.bodies[9].meta[1] as string, ...counts(rc) };
  expect(counts(rc)).toEqual({ attempted: 6, answered: 4, marked: 1 });
  const [row] = rows<{ cand: string; seq: number; h: string; code: string; cell: string; sig: string; attempted: number }>('cell', 'receipts');
  expect(row).toMatchObject({ cand: 'C0002', seq: 10, h: s.hs[9], code: receiptCode(B), cell: 'cell-1', attempted: 6 });
  expect(verifier(cell.pub)(receiptMessage(B), hexToBytes(row.sig))).toBe(true);
});

test('cell: stores the opened body and salt of every entry — the record the audit checks', async () => {
  const n = node('cell'), s = new SimSeat(keys, 'C0001', cell.pub);
  s.add(3);
  await push(n, s);
  const b = rows<{ seq: number; item: string; state: string; answer: string; meta: string; salt: Uint8Array }>('cell', 'bodies');
  expect(b.map((x) => [x.seq, x.item, x.state, x.answer, x.meta])).toEqual([[1, '', '', '', '[]'], [2, 'I01', 'A', 'C', '[1000,[]]'], [3, 'I02', 'A', 'D', '[1000,[]]']]);
  expect(toHex(b[1].salt)).toBe(toHex(s.salts[1]));
  node('relay', 'relay-unused');                                               // a relay DB has the table, always empty
  expect(rows('relay-unused', 'bodies')).toEqual([]);
});

for (const mode of ['relay', 'cell'] as const) {
  test(`${mode}: nothing is accepted after a submit, even after a restart`, async () => {
    const s = new SimSeat(keys, 'C0001', cell.pub);
    s.add(3); s.submit();
    let n = node(mode);
    await push(n, s);
    const extra = s.make(5, s.hs[3], 'A').entry;
    const r = await push(n, s, [extra]);
    expect(r.rejected).toEqual([{ index: 0, code: 'BAD_SUBMISSION', reason: 'entry after submit (the chain closed at seq 4)' }]);
    n.close();
    n = node(mode);
    expect((await push(n, s, [extra])).rejected[0].reason).toContain('entry after submit');
  });

  test(`${mode}: resending the exact submit is a no-op, not "after submit"`, async () => {
    const n = node(mode), s = new SimSeat(keys, 'C0001', cell.pub);
    s.add(3); s.submit();
    await push(n, s);
    const r = await push(n, s);
    expect(r.rejected).toEqual([]);
    expect(r.streams[0].head).toBe(4);
  });
}

test('cell: a submit whose finalHash does not replay is BAD_SUBMISSION and nothing is stored', async () => {
  const n = node('cell'), s = new SimSeat(keys, 'C0001', cell.pub);
  s.add(3);
  s.append('submit', { item: '', state: '', answer: '', meta: ['F1', '0'.repeat(64)] });
  const r = await push(n, s);
  expect(r.rejected[0]).toMatchObject({ index: 3, code: 'BAD_SUBMISSION', reason: 'submit: finalHash does not match the replayed chain' });
  expect(r.streams[0].head).toBe(3);
  expect(rows('cell', 'receipts')).toEqual([]);
});

test('cell: a submit naming another form, or an answer to an item outside the form, is BAD_SUBMISSION', async () => {
  const n = node('cell'), s = new SimSeat(keys, 'C0001', cell.pub);
  s.add(2);
  s.submit('F2');
  expect((await push(n, s)).rejected[0].reason).toBe('submit names form F2; the roster says F1');
  const t = new SimSeat(keys, 'C0003', cell.pub);
  t.add(1);
  t.append('answer', { item: 'I99', state: 'A', answer: 'B', meta: [1, []] });
  expect((await push(n, t)).rejected[0].reason).toBe("item I99 is not in C0003's form");
});

test('relay: cannot read bodies, so it stores a submit it cannot check (the cell rejects it)', async () => {
  const n = node('relay'), s = new SimSeat(keys, 'C0001', cell.pub);
  s.add(2);
  s.append('submit', { item: '', state: '', answer: '', meta: ['F1', '0'.repeat(64)] });
  expect((await push(n, s)).rejected).toEqual([]);
  expect(rows('relay', 'bodies')).toEqual([]);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test --timeout 60000 apps/server/test/submit.test.ts`
Expected: FAIL. `no such table: receipts`, and the options are unknown.

- [ ] **Step 3: Rewrite `apps/server/src/store.ts`**

```ts
import { Database } from 'bun:sqlite';
import { existsSync } from 'node:fs';
import type { Ctx } from '@saakshi/core/protocol';

/** The cell's opened copy of a body — "the record". meta is JSON.stringify(body.meta). */
export interface BodyRow { item: string; state: string; answer: string; meta: string; salt: Uint8Array }
/** The cell's countersigned receipt B (protocol Addendum A.1/A.5). */
export interface ReceiptRow { seq: number; h: string; finalHash: string; pseud: string; attempted: number; answered: number; marked: number; code: string; cell: string; sig: string }
export interface Row extends Ctx { seq: number; keyEpoch: number; h: string; line: string; env: Uint8Array; body?: BodyRow; receipt?: ReceiptRow }

/** Open (or create) a node DB. `fresh` = the file did not exist, which puts a cell into REBUILDING. */
export function openDb(path: string): { db: Database; fresh: boolean } {
  const fresh = !existsSync(path);
  const db = new Database(path, { create: true, strict: true });
  db.run('PRAGMA journal_mode = WAL');
  db.run('PRAGMA synchronous = FULL');
  db.run('PRAGMA fullfsync = ON');            // macOS: F_FULLFSYNC on commit
  db.run('PRAGMA checkpoint_fullfsync = ON');
  db.run(`CREATE TABLE IF NOT EXISTS entries (
    exam TEXT NOT NULL, shift TEXT NOT NULL, attempt INTEGER NOT NULL, cand TEXT NOT NULL, seq INTEGER NOT NULL,
    key_epoch INTEGER NOT NULL, h TEXT NOT NULL, line TEXT NOT NULL, env BLOB NOT NULL,
    PRIMARY KEY (exam, shift, attempt, cand, seq)) WITHOUT ROWID`);
  db.run(`CREATE TABLE IF NOT EXISTS bodies (
    exam TEXT NOT NULL, shift TEXT NOT NULL, attempt INTEGER NOT NULL, cand TEXT NOT NULL, seq INTEGER NOT NULL,
    item TEXT NOT NULL, state TEXT NOT NULL, answer TEXT NOT NULL, meta TEXT NOT NULL, salt BLOB NOT NULL,
    PRIMARY KEY (exam, shift, attempt, cand, seq)) WITHOUT ROWID`);
  db.run(`CREATE TABLE IF NOT EXISTS receipts (
    exam TEXT NOT NULL, shift TEXT NOT NULL, attempt INTEGER NOT NULL, cand TEXT NOT NULL,
    seq INTEGER NOT NULL, h TEXT NOT NULL, final_hash TEXT NOT NULL, pseud TEXT NOT NULL,
    attempted INTEGER NOT NULL, answered INTEGER NOT NULL, marked INTEGER NOT NULL, code TEXT NOT NULL, cell TEXT NOT NULL, sig TEXT NOT NULL,
    PRIMARY KEY (exam, shift, attempt, cand)) WITHOUT ROWID`);
  db.run(`CREATE TABLE IF NOT EXISTS evidence (id INTEGER PRIMARY KEY, at INTEGER NOT NULL, code TEXT NOT NULL,
    stream TEXT NOT NULL, seq INTEGER NOT NULL, reason TEXT NOT NULL, line TEXT NOT NULL)`);
  db.run('CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)');
  return { db, fresh };
}
```
Keep `pragmas()` and the `Waiter` interface unchanged. In `GroupCommit`, replace the constructor's `ins`/`#insert` setup with the version below. The rest of the class is unchanged.
```ts
    const ins = db.query('INSERT INTO entries (exam, shift, attempt, cand, seq, key_epoch, h, line, env) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    const insBody = db.query('INSERT INTO bodies (exam, shift, attempt, cand, seq, item, state, answer, meta, salt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    const insReceipt = db.query(`INSERT OR REPLACE INTO receipts (exam, shift, attempt, cand, seq, h, final_hash, pseud, attempted, answered, marked, code, cell, sig)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    this.#insert = db.transaction((rows: Row[]) => {
      for (const r of rows) {
        ins.run(r.exam, r.shift, r.attempt, r.cand, r.seq, r.keyEpoch, r.h, r.line, r.env);
        const b = r.body;
        if (b) insBody.run(r.exam, r.shift, r.attempt, r.cand, r.seq, b.item, b.state, b.answer, b.meta, b.salt);
        const x = r.receipt;
        if (x) insReceipt.run(r.exam, r.shift, r.attempt, r.cand, x.seq, x.h, x.finalHash, x.pseud, x.attempted, x.answered, x.marked, x.code, x.cell, x.sig);
      }
    });
```

- [ ] **Step 4: Edit `apps/server/src/ingest.ts`**

These edits are exact; everything else in the file stays as it is.

(a) Imports. Replace the protocol import and add three new ones:
```ts
import { receiptMessage, responsesOf } from '@saakshi/core/log';
import { counts, entryHash, finalHash, genesisPrev, receiptCode, type Body, type Ctx, type Header, type State } from '@saakshi/core/protocol';
import type { Forms } from '@saakshi/core/sheet';
import { GroupCommit, type ReceiptRow, type Row } from './store.ts';
```
(`./store.ts` was already imported; widen that line.)

(b) Add to `IngestOpts`:
```ts
  /** cell: the form item lists (forms.json without durationMin). Without them every submit is rejected. */
  forms?: Forms;
  /** cell: the form the roster assigns to a candidate (DEV: devForm). */
  formOf?: (cand: string) => string | undefined;
  /** cell: the candidate's pseudonym for receipts (DEV: devPseud). */
  pseud?: (cand: string) => string;
  /** cell: the id stamped on countersigned receipts. Default 'cell-1'. */
  cellId?: string;
```

(c) The stream carries its replay state:
```ts
/** bodies[seq-1] = the opened body (cell only); submitSeq = seq of the submit, 0 while the chain is open. */
interface Stream { ctx: Ctx; hs: string[]; durable: number; epoch: number; ack?: WireAck; cellHead: number; senderHead: number; seenAt: number; bodies: Body[]; submitSeq: number }
```
In `get()`, create streams with `bodies: [], submitSeq: 0`.

(d) After the existing loop that loads `entries` into memory, add:
```ts
  if (mode === 'cell') {
    // ponytail: replay state is rebuilt from the bodies table, so a post-startup DB edit only affects later submits; the audit catches edits regardless.
    for (const r of db.query('SELECT exam, shift, attempt, cand, seq, item, state, answer, meta FROM bodies ORDER BY exam, shift, attempt, cand, seq').all() as (Ctx & { seq: number; item: string; state: string; answer: string; meta: string })[])
      get(r).bodies[r.seq - 1] = { item: r.item, state: r.state as State | '', answer: r.answer, meta: JSON.parse(r.meta) };
  }
  const lineAt = db.query('SELECT line FROM entries WHERE exam = ? AND shift = ? AND attempt = ? AND cand = ? AND seq = ?');
  for (const s of streams.values()) {
    const row = s.durable ? (lineAt.get(s.ctx.exam, s.ctx.shift, s.ctx.attempt, s.ctx.cand, s.durable) as { line: string } | null) : null;
    const p = row ? parseSignedLine(row.line) : undefined;
    if (p?.ok && p.header.kind === 'submit') s.submitSeq = s.durable;
  }
  const cellId = o.cellId ?? 'cell-1';

  /** Protocol Addendum A.5: replay the committed bodies; the submit's finalHash must match. Returns the countersigned receipt, or why not. */
  function checkSubmit(s: Stream, hd: Header, h: string, body: Body): ReceiptRow | string {
    const [form, fh] = body.meta;
    if (body.item || body.state || body.answer || body.meta.length !== 2 || typeof form !== 'string' || typeof fh !== 'string')
      return 'submit body must be ["body","","","",[form, finalHash]]';
    const want = o.formOf?.(hd.cand);
    const items = o.forms?.[form];
    if (!items || form !== want) return `submit names form ${form}; the roster says ${want ?? 'nothing'}`;
    if (!o.pseud) return 'this cell has no pseudonym key';
    for (let i = 0; i < hd.seq - 1; i++) if (!s.bodies[i]) return `cannot replay: no body for seq ${i + 1}`;
    let responses;
    try { responses = responsesOf(items, s.bodies.slice(0, hd.seq - 1)); } catch (e) { return `submit: ${(e as Error).message}`; }
    if (finalHash(hd, form, responses) !== fh) return 'submit: finalHash does not match the replayed chain';
    const B = { exam: hd.exam, shift: hd.shift, attempt: hd.attempt, pseud: o.pseud(hd.cand), seq: hd.seq, h, finalHash: fh, ...counts(responses) };
    return { seq: B.seq, h, finalHash: fh, pseud: B.pseud, attempted: B.attempted, answered: B.answered, marked: B.marked, code: receiptCode(B), cell: cellId, sig: toHex(cellSign!(receiptMessage(B))) };
  }
```

(e) In `sync()`'s per-entry validation, right after `if (hd.seq < 1) return bad('seq must start at 1');`:
```ts
      if (s.submitSeq && hd.seq > s.submitSeq) return bad(`entry after submit (the chain closed at seq ${s.submitSeq})`);
```

(f) Replace the tail of the per-entry validation. That is everything from `if (mode === 'cell') { try { openBody(…` down to `rows.push(…)`:
```ts
      let body: Body | undefined, rec: Row['body'], receipt: ReceiptRow | undefined;
      if (mode === 'cell') {
        let opened: { salt: Uint8Array; body: Body };
        try { opened = openBody(o.cell.priv!, { ...hd }, env, hd.bodyCommit); } catch (err) { return bad(`body: ${(err as Error).message}`); }
        body = opened.body;
        if (body.item && o.forms && !o.forms[o.formOf?.(hd.cand) ?? '']?.includes(body.item)) return bad(`item ${body.item} is not in ${hd.cand}'s form`);
        if (hd.kind === 'submit') {
          const r = checkSubmit(s, hd, h, body);
          if (typeof r === 'string') return bad(r);
          receipt = r;
        }
        rec = { item: body.item, state: body.state, answer: body.answer, meta: JSON.stringify(body.meta), salt: opened.salt };
      }
      s.hs.push(h);
      if (body) s.bodies[hd.seq - 1] = body;
      if (hd.kind === 'submit') s.submitSeq = hd.seq;
      rows.push({ ...ctxOf(hd), seq: hd.seq, keyEpoch: hd.keyEpoch, h, line: e.line, env, body: rec, receipt });
```

- [ ] **Step 5: Run the new and the Stage 1 server tests**

Run: `bun test --timeout 60000 apps/server/test/submit.test.ts apps/server/test/ingest.test.ts apps/server/test/store.test.ts apps/server/test/forward.test.ts`
Expected: PASS. The Stage 1 behaviour is unchanged.

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @saakshi/server typecheck`
Expected: exit 0.

---

### Task 4: Seat main — submit, receipt, resume, no-camera test mode

**Files:**
- Modify: `apps/seat/src/main/exam.ts` (`SessionOpts.form` and `SessionOpts.pseud`, `submitted`, `submit()`, `receipt()`, and the guards after submit)
- Create: `apps/seat/src/main/camera.ts` (`cameraEnabled`)
- Modify: `apps/seat/src/main/index.ts` (`exam:submit`; `exam:load` returns `receipt` and `camera`; skip camera access when it is off)
- Modify: `apps/seat/src/preload/index.ts` (`submit`)
- Test: `apps/seat/test/exam.test.ts` (update the helper and add tests), `apps/seat/test/camera.test.ts`

**Interfaces:**
- Consumes (Task 1):
  - `responsesOf` from `@saakshi/core/log`;
  - `devPseud` from `@saakshi/core/dev`;
  - `Receipt`, `SubmitResult`, `ExamBoot.camera` from `../shared/ipc.ts`.
- Produces:
  - `ExamSession`:
    - `get submitted(): boolean`
    - `submit(): SubmitResult`, which is idempotent: after a submit it returns the same receipt and appends nothing
    - `receipt(): Receipt | undefined`
  - After a submit, `act()` returns `{ok:false, error:'exam submitted'}` and `tick()` appends no `idle`.
  - Submit is allowed after time is up.
  - `cameraEnabled(argv: readonly string[], env: Record<string, string | undefined>): boolean`
  - IPC: `exam:submit` → `SubmitResult`; `exam:load` → `ExamBoot` with `receipt` and `camera`.

- [ ] **Step 1: Write the failing tests**

In `apps/seat/test/exam.test.ts`, add these imports and change the `session()` helper to pass the two new options:
```ts
import { devPseud } from '@saakshi/core/dev';
import { counts, finalHash, receiptCode, type Response } from '@saakshi/core/protocol';
// …
function session(dir: string, clock: () => number): ExamSession {
  return new ExamSession({ dir, ctx: { ...DEV_EXAM, cand: 'C0001' }, keyEpoch: 1, seat: devSeat(keys, 'C0001')!, cellPub: cell.pub, wrap, durationMs: D, items: ['I01', 'I02', 'I03'], form: 'F1', pseud: devPseud('C0001'), clock });
}
```
Then append:
```ts
test('submit closes the journal with [form, finalHash] and returns the receipt the cell will compute', () => {
  const dir = mkdtempSync(join(tmpdir(), 'saakshi-exam-'));
  let t = 0;
  const s = session(dir, () => t);
  s.start();
  t = 1_000; s.act(act('clear', 'I02', 'NA', ''));        // first visit (Addendum A.6)
  t = 2_000; s.act(act('answer', 'I01', 'A', 'B'));
  t = 3_000; s.act(act('mark', 'I03', 'MR', ''));
  const r = s.submit();
  if (!r.ok) throw new Error(r.error);
  const responses: Response[] = [['I01', 'A', 'B'], ['I02', 'NA', ''], ['I03', 'MR', '']];
  const fh = finalHash(s.ctx, 'F1', responses);
  const B = { exam: 'DEMO-2026', shift: 'S1', attempt: 1, pseud: devPseud('C0001'), seq: 5, h: s.hashAt(5), finalHash: fh, ...counts(responses) };
  assert.deepEqual(r.receipt, { exam: 'DEMO-2026', shift: 'S1', cand: 'C0001', form: 'F1', code: receiptCode(B), seq: 5, h: s.hashAt(5), finalHash: fh, attempted: 3, answered: 1, marked: 1, total: 3 });
  const [e] = s.entriesAfter(4, 1);
  const p = parseSignedLine(e.line);
  if (!p.ok) throw new Error(p.detail);
  assert.equal(p.header.kind, 'submit');
  assert.deepEqual(openBody(cell.priv, { ...s.ctx, seq: 5 }, fromB64(e.env), p.header.bodyCommit).body, { item: '', state: '', answer: '', meta: ['F1', fh] });
  s.close();
  rmSync(dir, { recursive: true });
});

test('submitting twice returns the same receipt and appends nothing; nothing else is journaled after submit', () => {
  const dir = mkdtempSync(join(tmpdir(), 'saakshi-exam-'));
  let t = 0;
  const s = session(dir, () => t);
  s.start();
  s.act(act('answer', 'I01', 'A', 'C'));
  const a = s.submit(), b = s.submit();
  assert.deepEqual(a, b);
  assert.equal(s.head(), 3);
  assert.deepEqual(s.act(act('answer', 'I02', 'A', 'D')), { ok: false, error: 'exam submitted' });
  t = 10 * 60_000; s.tick();
  assert.equal(s.head(), 3);
  s.close();
  rmSync(dir, { recursive: true });
});

test('the receipt survives a restart', () => {
  const dir = mkdtempSync(join(tmpdir(), 'saakshi-exam-'));
  const a = session(dir, () => 0);
  a.start();
  a.act(act('answer', 'I03', 'A', 'A'));
  const r = a.submit();
  a.close();
  const b = session(dir, () => 0);
  assert.equal(b.submitted, true);
  assert.deepEqual(b.receipt(), r.ok ? r.receipt : null);
  b.close();
  rmSync(dir, { recursive: true });
});

test('submit is refused before start and allowed after time is up', () => {
  const dir = mkdtempSync(join(tmpdir(), 'saakshi-exam-'));
  let t = 0;
  const s = session(dir, () => t);
  assert.deepEqual(s.submit(), { ok: false, error: 'exam not started' });
  s.start();
  t = D + 5_000;
  assert.equal(s.submit().ok, true);
  s.close();
  rmSync(dir, { recursive: true });
});
```

`apps/seat/test/camera.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cameraEnabled } from '../src/main/camera.ts';

test('the camera is on by default and off with --no-camera or SAAKSHI_NO_CAMERA=1', () => {
  assert.equal(cameraEnabled(['electron', '.'], {}), true);
  assert.equal(cameraEnabled(['electron', '.', '--no-camera'], {}), false);
  assert.equal(cameraEnabled(['electron', '.'], { SAAKSHI_NO_CAMERA: '1' }), false);
  assert.equal(cameraEnabled(['electron', '.'], { SAAKSHI_NO_CAMERA: '0' }), true);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd apps/seat && node --test test/exam.test.ts test/camera.test.ts`
Expected: FAIL. `s.submit is not a function`, and `../src/main/camera.ts` cannot be found.

- [ ] **Step 3: Write `apps/seat/src/main/camera.ts`**

```ts
/** Test mode for automated checks: SAAKSHI_NO_CAMERA=1 or --no-camera keeps the webcam off (no getUserMedia, no MediaPipe). */
export const cameraEnabled = (argv: readonly string[], env: Record<string, string | undefined>): boolean =>
  !argv.includes('--no-camera') && env.SAAKSHI_NO_CAMERA !== '1';
```

- [ ] **Step 4: Rewrite `apps/seat/src/main/exam.ts`**

```ts
import { randomBytes } from '@saakshi/core/bytes';
import { signedLine } from '@saakshi/core/journal';
import { responsesOf } from '@saakshi/core/log';
import { sealBody, signer, verifier, type KeyPair } from '@saakshi/core/node';
import { counts, finalHash, genesisPrev, receiptCode, type Body, type Ctx, type Header, type Kind, type State } from '@saakshi/core/protocol';
import { toB64, type WireEntry } from '@saakshi/core/wire';
import type { Action, ActResult, ItemState, Receipt, SubmitResult } from '../shared/ipc.ts';
import { SeatJournal, type Wrapper } from './journal-store.ts';
import type { SyncSource } from './sync.ts';

export interface SessionOpts {
  dir: string; ctx: Ctx; keyEpoch: number; seat: KeyPair; cellPub: Uint8Array; wrap: Wrapper;
  durationMs: number; items: readonly string[];
  /** The candidate's form (F1/F2) — goes into the submit's meta. */
  form: string;
  /** The candidate's pseudonym (Addendum A.4) — goes into receipt B. DEV: devPseud(cand). */
  pseud: string;
  clock?: () => number;
}

export const IDLE_MS = 60_000;
const OPTIONS = ['A', 'B', 'C', 'D'];
const EMPTY: Body = { item: '', state: '', answer: '', meta: [] };

/** One candidate's exam on this seat: builds, signs and seals entries, keeps the active-time clock, and computes the receipt. */
export class ExamSession implements SyncSource {
  readonly ctx: Ctx;
  readonly journal: SeatJournal;
  #o: SessionOpts;
  #sign: (m: Uint8Array) => Uint8Array;
  #clock: () => number;
  #activeBase = 0;
  #monoBase = 0;
  #runStart: number;
  #lastEntryAt: number;

  constructor(o: SessionOpts) {
    this.#o = o;
    this.ctx = o.ctx;
    this.#clock = o.clock ?? (() => performance.now());
    this.#sign = signer(o.seat);
    this.journal = SeatJournal.open(o.dir, o.ctx, o.wrap, verifier(o.seat.pub));
    this.#runStart = this.#lastEntryAt = this.#clock();
    const last = this.journal.headers.at(-1);
    // Resume: time between the last entry and the crash is not charged (at most IDLE_MS, thanks to idle entries).
    if (last) { this.#activeBase = last.activeMs; this.#monoBase = last.tMonoMs; }
  }

  get started(): boolean { return this.journal.head > 0; }
  get submitted(): boolean { return this.journal.headers.at(-1)?.kind === 'submit'; }
  activeMs(): number { return this.started ? this.#activeBase + Math.round(this.#clock() - this.#runStart) : 0; }
  remainingMs(): number { return Math.max(0, this.#o.durationMs - this.activeMs()); }

  items(): Record<string, ItemState> {
    const out: Record<string, ItemState> = {};
    this.journal.recs.forEach((r, i) => { if (r.body.item) out[r.body.item] = { state: r.body.state as State, answer: r.body.answer, seq: i + 1 }; });
    return out;
  }

  /** Stage 1 unlock: the candidate presses Start (custody release arrives in Stage 3). */
  start(): ActResult {
    if (this.started) return { ok: true, seq: 1, activeMs: this.activeMs() };
    this.#runStart = this.#clock();
    return { ok: true, seq: this.#append('unlock', EMPTY), activeMs: 0 };
  }

  act(a: Action): ActResult {
    const error = this.#check(a);
    if (error) return { ok: false, error };
    const seq = this.#append(a.kind, { item: a.item, state: a.state, answer: a.answer, meta: [Math.max(0, Math.round(a.dwellMs)), []] });
    return { ok: true, seq, activeMs: this.activeMs() };
  }

  /**
   * Close the chain (Addendum A.5): meta [form, finalHash] over every item of the form. Works offline — the receipt
   * comes from this seat's own journal. Idempotent: after a submit it returns the same receipt. Allowed after time is up.
   */
  submit(): SubmitResult {
    if (this.submitted) return { ok: true, receipt: this.receipt()! };
    if (!this.started) return { ok: false, error: 'exam not started' };
    const responses = responsesOf(this.#o.items, this.journal.recs.map((r) => r.body));
    this.#append('submit', { item: '', state: '', answer: '', meta: [this.#o.form, finalHash(this.ctx, this.#o.form, responses)] });
    return { ok: true, receipt: this.receipt()! };
  }

  /** The receipt, recomputed from the journal (so it survives a restart); undefined until submitted. */
  receipt(): Receipt | undefined {
    if (!this.submitted) return undefined;
    const n = this.journal.head;
    const [form, fh] = this.journal.recs[n - 1].body.meta as [string, string];
    const c = counts(responsesOf(this.#o.items, this.journal.recs.slice(0, n - 1).map((r) => r.body)));
    const h = this.journal.hashAt(n);
    const code = receiptCode({ exam: this.ctx.exam, shift: this.ctx.shift, attempt: this.ctx.attempt, pseud: this.#o.pseud, seq: n, h, finalHash: fh, ...c });
    return { exam: this.ctx.exam, shift: this.ctx.shift, cand: this.ctx.cand, form, code, seq: n, h, finalHash: fh, ...c, total: this.#o.items.length };
  }

  /** Called every few seconds: checkpoints activeMs with an idle entry after 60 s of silence. */
  tick(): void {
    if (this.started && !this.submitted && this.remainingMs() > 0 && this.#clock() - this.#lastEntryAt >= IDLE_MS) this.#append('idle', EMPTY);
  }

  head(): number { return this.journal.head; }
  hashAt(seq: number): string { return this.journal.hashAt(seq); }
  entriesAfter(after: number, limit: number): WireEntry[] {
    return this.journal.recs.slice(after, after + limit).map((r) => ({ line: r.line, env: toB64(r.env) }));
  }
  close(): void { this.journal.close(); }

  #check(a: Action): string {
    if (this.submitted) return 'exam submitted';
    if (!this.started) return 'exam not started';
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
    const prev = seq === 1 ? genesisPrev(this.ctx) : this.journal.hashAt(seq - 1);
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

- [ ] **Step 5: Wire IPC, preload and the camera flag**

In `apps/seat/src/main/index.ts`:
```ts
// imports: add
import { devPseud } from '@saakshi/core/dev';           // merge into the existing '@saakshi/core/dev' import
import type { SubmitResult } from '../shared/ipc.ts';   // merge into the existing ipc import
import { cameraEnabled } from './camera.ts';

// inside start(), next to the other settings:
const camera = cameraEnabled(process.argv, process.env);

// make guard generic, and add the submit handler:
const guard = <T>(fn: () => T): T | { ok: false; error: string } => { try { return fn(); } catch (e) { return { ok: false, error: (e as Error).message }; } };
ipcMain.handle('exam:load', (): ExamBoot => ({
  cand, seatId: seat!.seatId, form, durationMs, activeMs: exam!.activeMs(), started: exam!.started, items: exam!.items(), sync: sync!.view(),
  receipt: exam!.receipt(), camera,
}));
ipcMain.handle('exam:submit', (): SubmitResult => guard(() => { const r = exam!.submit(); sync!.kick(); return r; }));

// ExamSession options: add the form and the pseudonym
exam = new ExamSession({ dir: join(app.getPath('userData'), 'journal'), ctx: { ...DEV_EXAM, cand }, keyEpoch: 1, seat, cellPub: cell.pub, wrap: safeStorage, durationMs, items: forms[form], form, pseud: devPseud(cand) });

// camera: no permission, no macOS prompt, when it is off
session.defaultSession.setPermissionRequestHandler((_wc, perm, cb) => cb(camera && perm === 'media'));
session.defaultSession.setPermissionCheckHandler((_wc, perm) => camera && perm === 'media');
if (camera && process.platform === 'darwin') await systemPreferences.askForMediaAccess('camera');
```
The existing `exam:start` and `exam:act` handlers keep working with the generic `guard`.

In `apps/seat/src/preload/index.ts`, add to `api`:
```ts
  submit: () => ipcRenderer.invoke('exam:submit'),
```

- [ ] **Step 6: Run the tests and the build**

Run: `cd apps/seat && node --test "test/**/*.test.ts" && pnpm build`
Expected: the tests PASS and electron-vite builds. The seat typecheck passes once Task 5 has added `camera` handling to the renderer.

---

### Task 5: Seat renderer — first-visit NA, submit confirmation, the slip and printing, camera-off chip

**Files:**
- Modify: `apps/seat/src/renderer/src/exam-state.ts` (`visitAction`, `slipCode`)
- Modify: `apps/seat/src/renderer/src/App.tsx` (full replacement below)
- Create: `apps/seat/src/renderer/src/Slip.tsx`
- Modify: `apps/seat/src/renderer/src/FaceChip.tsx` (the `off` prop; MediaPipe imported dynamically)
- Modify: `apps/seat/src/renderer/src/i18n.ts` (new strings, EN and HI)
- Modify: `apps/seat/src/renderer/src/styles.css` (append the slip, submit and print rules)
- Test: `apps/seat/test/exam-state.test.ts` (append)

**Interfaces:**
- Consumes (Task 1): `Receipt`, `SubmitResult`, `ExamBoot.receipt`, `ExamBoot.camera`, `SeatApi.submit` from `../../shared/ipc.ts`. It relies on Task 4's `exam:submit` at runtime only.
- Produces:
  - `visitAction(item, cur): Action | null`
  - `slipCode(code): string`, which groups a code in fours with dashes: `N5JY-1E59-BR0F-GNVQ-W`
  - `<Slip r sync t />`
  - `<FaceChip label unavailable off offLabel />`
  - the new `Strings` keys: `exam`, `submit`, `confirmTitle`, `confirmNote`, `submitNow`, `back`, `receiptTitle`, `receiptCode`, `attempted`, `answered`, `marked`, `of(n, total)`, `keepCode`, `print`, `submission`, `cameraTest`.

- [ ] **Step 1: Write the failing tests**

Append to `apps/seat/test/exam-state.test.ts`, adding `slipCode` and `visitAction` to its import from `exam-state.ts`:
```ts
test('the first display of an item with no journaled state is journaled as visited (clear, NA)', () => {
  assert.deepEqual(visitAction('I04', undefined), { kind: 'clear', item: 'I04', state: 'NA', answer: '', dwellMs: 0 });
  assert.equal(visitAction('I04', { state: 'NA', answer: '', seq: 3 }), null);
  assert.equal(visitAction('I04', A('B')), null);
});

test('the slip code is grouped in fours for copying by hand', () => {
  assert.equal(slipCode('N5JY1E59BR0FGNVQW'), 'N5JY-1E59-BR0F-GNVQ-W');
});

test('every new string exists in both languages; the Hindi count puts the total first', () => {
  for (const k of Object.keys(T.en) as (keyof typeof T.en)[]) assert.ok(T.hi[k], `hi lacks ${k}`);
  assert.equal(T.en.of(5, 20), '5 of 20');
  assert.equal(T.hi.of(5, 20), '20 में से 5');
  assert.equal(T.en.cameraTest, 'Camera off (test mode)');
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd apps/seat && node --test test/exam-state.test.ts`
Expected: FAIL. `visitAction` is not exported.

- [ ] **Step 3: Add the helpers to `exam-state.ts`**

```ts
/**
 * Protocol Addendum A.6: the first display of an item with no journaled state is journaled as visited
 * (clear, NA), so NA survives a resume and counts as attempted on the receipt.
 */
export function visitAction(item: string, cur: ItemState | undefined): Action | null {
  return cur ? null : { kind: 'clear', item, state: 'NA', answer: '', dwellMs: 0 };
}

/** N5JY1E59BR0FGNVQW → N5JY-1E59-BR0F-GNVQ-W (decoding ignores the dashes). */
export const slipCode = (code: string): string => code.replace(/(.{4})(?=.)/g, '$1-');
```

- [ ] **Step 4: Update `i18n.ts`**

Change `Strings` to add these keys:
```ts
  exam: string; submit: string; confirmTitle: string; confirmNote: string; submitNow: string; back: string;
  receiptTitle: string; receiptCode: string; attempted: string; answered: string; marked: string;
  of: (n: number, total: number) => string; keepCode: string; print: string; submission: string; cameraTest: string;
```
Add to `en`:
```ts
    exam: 'Exam', submit: 'Submit', confirmTitle: 'Submit your exam?', confirmNote: 'You cannot change any answer after submitting.',
    submitNow: 'Submit now', back: 'Back to the questions', receiptTitle: 'Submission receipt', receiptCode: 'Receipt code',
    attempted: 'Attempted', answered: 'Answered', marked: 'Marked for review', of: (n, total) => `${n} of ${total}`,
    keepCode: 'Copy this code onto your admit card. With it you can check later that your answers were recorded exactly as you submitted them.',
    print: 'Print slip', submission: 'Your submission', cameraTest: 'Camera off (test mode)',
```
Add to `hi`:
```ts
    exam: 'परीक्षा', submit: 'जमा करें', confirmTitle: 'क्या आप परीक्षा जमा करना चाहते हैं?', confirmNote: 'जमा करने के बाद कोई भी उत्तर बदला नहीं जा सकता।',
    submitNow: 'अभी जमा करें', back: 'प्रश्नों पर लौटें', receiptTitle: 'जमा करने की रसीद', receiptCode: 'रसीद कोड',
    attempted: 'प्रयास किए', answered: 'उत्तर दिए', marked: 'समीक्षा हेतु चिह्नित', of: (n, total) => `${total} में से ${n}`,
    keepCode: 'यह कोड अपने प्रवेश-पत्र पर लिख लें। इससे आप बाद में जाँच सकते हैं कि आपके उत्तर ठीक वैसे ही दर्ज हुए जैसे आपने जमा किए थे।',
    print: 'रसीद प्रिंट करें', submission: 'आपका जमा किया गया उत्तर-पत्र', cameraTest: 'कैमरा बंद (परीक्षण मोड)',
```

- [ ] **Step 5: `FaceChip.tsx`: camera-off mode and a dynamic MediaPipe import**

```tsx
import { useEffect, useRef, useState } from 'react';

/** off = test mode (SAAKSHI_NO_CAMERA=1 / --no-camera): never touches getUserMedia or MediaPipe. */
export function FaceChip({ label, unavailable, off, offLabel }: { label: string; unavailable: string; off: boolean; offLabel: string }) {
  const video = useRef<HTMLVideoElement>(null);
  const [faces, setFaces] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (off) return;
    let timer: number | undefined, stream: MediaStream | undefined, detector: { close(): void } | undefined;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
        const v = video.current!;
        v.srcObject = stream;
        await v.play();
        const { FaceDetector, FilesetResolver } = await import('@mediapipe/tasks-vision');
        const fileset = await FilesetResolver.forVisionTasks(new URL('mediapipe/wasm', location.href).href);
        const d = await FaceDetector.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: new URL('mediapipe/blaze_face_short_range.tflite', location.href).href, delegate: 'CPU' },
          runningMode: 'VIDEO',
        });
        detector = d;
        timer = window.setInterval(() => { if (v.readyState >= 2) setFaces(d.detectForVideo(v, performance.now()).detections.length); }, 500);
      } catch { setFailed(true); }
    })();
    return () => { clearInterval(timer); stream?.getTracks().forEach((t) => t.stop()); detector?.close(); };
  }, [off]);

  if (off) return <span className="chip" aria-label={offLabel}><span aria-hidden="true">{offLabel}</span></span>;
  const text = failed ? unavailable : `${label}: ${faces ?? '—'}`;
  return (
    <span className={`chip${faces !== null && faces !== 1 ? ' warn' : ''}`} aria-label={text}>
      <video ref={video} muted playsInline aria-hidden="true" />
      <span aria-hidden="true">{text}</span>
    </span>
  );
}
```

- [ ] **Step 6: Write `Slip.tsx`**

```tsx
import type { Receipt, SyncView } from '../../shared/ipc.ts';
import { GLYPH, slipCode, tickOf } from './exam-state.ts';
import type { Strings } from './i18n.ts';

/** The receipt slip: computed on this seat at submit (works offline); the invigilator prints it with window.print. */
export function Slip({ r, sync, t }: { r: Receipt; sync: SyncView; t: Strings }) {
  const tick = tickOf(r.seq, sync);
  return (
    <main className="slip" aria-labelledby="slip-h">
      <h1 id="slip-h">{t.receiptTitle}</h1>
      <dl className="slip-meta">
        <dt>{t.candidate}</dt><dd>{r.cand}</dd>
        <dt>{t.exam}</dt><dd>{r.exam} · {r.shift}</dd>
        <dt>{t.form}</dt><dd>{r.form}</dd>
      </dl>
      <p className="code-label">{t.receiptCode}</p>
      <p className="code">{slipCode(r.code)}</p>
      <table className="slip-counts">
        <tbody>
          <tr><th scope="row">{t.attempted}</th><td>{t.of(r.attempted, r.total)}</td></tr>
          <tr><th scope="row">{t.answered}</th><td>{t.of(r.answered, r.total)}</td></tr>
          <tr><th scope="row">{t.marked}</th><td>{r.marked}</td></tr>
        </tbody>
      </table>
      <p>{t.keepCode}</p>
      <p className="slip-sync">
        <span className={`tick ${tick}`} aria-hidden="true">{GLYPH[tick]} </span>{t.submission}: {t.tick[tick]}
      </p>
      <button className="primary no-print" onClick={() => window.print()}>{t.print}</button>
    </main>
  );
}
```

- [ ] **Step 7: Replace `App.tsx`**

What changes:
- the first-visit journaling: `visit()`, called from `go()`, from start, and on resume;
- functional `setItems` together with `itemsRef`, so a visit that resolves late never overwrites an answer;
- the Submit button, the confirm screen and the slip;
- the `off` prop on `FaceChip`.
```tsx
import { useEffect, useRef, useState } from 'react';
import bankJson from '../../../../../fixtures/paper/bank.json';
import formsJson from '../../../../../fixtures/paper/forms.json';
import type { Action, ExamBoot, ItemState, Lang, Receipt, SeatApi, SyncView } from '../../shared/ipc.ts';
import { clearResponse, fmtRemaining, GLYPH, legendCounts, markAndNext, PALETTE_STATES, saveAndNext, tickOf, visitAction } from './exam-state.ts';
import { FaceChip } from './FaceChip.tsx';
import { T, type Strings } from './i18n.ts';
import { Palette } from './Palette.tsx';
import { Slip } from './Slip.tsx';

declare global { interface Window { saakshi: SeatApi } }

interface BankItem { id: string; subject: string; en: { q: string; o: string[] }; hi: { q: string; o: string[] } }
const BANK = new Map((bankJson as { items: BankItem[] }).items.map((i) => [i.id, i]));
const FORMS = formsJson as unknown as Record<'F1' | 'F2', string[]>;
const LETTERS = ['A', 'B', 'C', 'D'] as const;

export function App() {
  const [boot, setBoot] = useState<ExamBoot | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => { window.saakshi.load().then(setBoot, (e) => setErr(String(e))); }, []);
  if (err) return <p role="alert">{err}</p>;
  return boot ? <Exam boot={boot} /> : <p>…</p>;
}

function Exam({ boot }: { boot: ExamBoot }) {
  const order = FORMS[boot.form];
  const [lang, setLang] = useState<Lang>(() => { try { return localStorage.getItem('lang') === 'hi' ? 'hi' : 'en'; } catch { return 'en'; } });
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
  const t = T[lang];

  useEffect(() => window.saakshi.onSync(setSync), []);
  useEffect(() => { const id = setInterval(() => setNow(performance.now()), 250); return () => clearInterval(id); }, []);
  useEffect(() => { try { localStorage.setItem('lang', lang); } catch { /* per-viewer convenience only */ } document.documentElement.lang = lang; }, [lang]);
  // Resume: the question on screen counts as visited (Addendum A.6).
  useEffect(() => { if (boot.started && !boot.receipt) void visit(order[0]); }, []);

  const remaining = boot.durationMs - (started ? clock.base + (now - clock.at) : 0);
  const timeUp = started && remaining <= 0;
  const item = order[idx];

  /** Journal the first display of an item as visited (clear, NA). Never overwrites a state set meanwhile. */
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
        <p role="status">{notice}</p>
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

  const q = BANK.get(item)![lang];
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

function LangToggle({ lang, setLang, t }: { lang: Lang; setLang: (l: Lang) => void; t: Strings }) {
  return (
    <div className="lang" role="group" aria-label={t.lang}>
      <button aria-pressed={lang === 'en'} lang="en" onClick={() => setLang('en')}>English</button>
      <button aria-pressed={lang === 'hi'} lang="hi" onClick={() => setLang('hi')}>हिन्दी</button>
    </div>
  );
}

function SyncStatus({ v, t }: { v: SyncView; t: Strings }) {
  return (
    <div className="sync">
      <span><span aria-hidden="true">✓</span> {v.local}<span className="sr-only"> {t.tick.local}</span></span>
      <span><span aria-hidden="true">✓✓</span> {v.relay}<span className="sr-only"> {t.tick.relay}</span></span>
      <span className="cell"><span aria-hidden="true">✓✓</span> {v.cell}<span className="sr-only"> {t.tick.cell}</span></span>
      <span role="status" className={v.online ? 'online' : 'offline'}>{v.online ? t.online : t.offline}</span>
    </div>
  );
}
```
A pure navigation (`saveAndNext` returning `null`) still calls `go()`, which journals the next item's visit. The timer-up state keeps Submit enabled on purpose.

- [ ] **Step 8: Append to `styles.css`**

```css
button.submit { margin-left: auto; border-color: var(--ink); font-weight: 700; }
.slip { max-width: 40rem; margin: 2rem auto; padding: 0 1rem; }
.slip-meta { display: grid; grid-template-columns: max-content 1fr; gap: .25rem 1rem; margin: 0 0 1rem; }
.slip-meta dt { color: var(--muted); }
.slip-meta dd { margin: 0; }
.code-label { margin: 0; color: var(--muted); }
.slip .code { font: 700 2rem/1.3 ui-monospace, 'SF Mono', Menlo, Consolas, monospace; letter-spacing: .06em; margin: .25rem 0 1rem; overflow-wrap: anywhere; }
.slip-counts { border-collapse: collapse; margin-bottom: 1rem; }
.slip-counts th { text-align: left; font-weight: 400; padding: .25rem 1.5rem .25rem 0; }
.slip-counts td { font-variant-numeric: tabular-nums; font-weight: 700; }
@media print { .no-print { display: none; } .slip { margin: 0; max-width: none; } :root { color: #000; background: #fff; } }
```

- [ ] **Step 9: Run the tests, typecheck and build**

Run: `cd apps/seat && node --test "test/**/*.test.ts" && pnpm typecheck && pnpm build`
Expected: PASS once Task 4 is merged; the typecheck needs the preload's `submit`. electron-vite emits a separate chunk for `@mediapipe/tasks-vision`.

---

### Task 6: Seal and reconcile (control-side, pure) — `seal.ts`, `recon.ts`

**Files:**
- Create: `apps/server/src/seal.ts`, `apps/server/src/recon.ts`
- Test: `apps/server/test/seal.test.ts`, `apps/server/test/recon.test.ts`

**Interfaces:**
- Consumes (Task 1):
  - `verifyChainKeyed`, `parseSignedLine`;
  - `NO_PREV_STH`, `leafHashHex`, `sthId`, `sthMessage`, `Sth`;
  - `LogLeaf`, `Proof`, `ReconRow`, `ResponseSheet`, `ShiftExport`, `SthRecord`, `Trust`;
  - `SimSeat` (tests only).
- Produces:
  - `interface SealOpts { authority: KeyPair; trust: Trust; pseud: (cand) => string; now?: () => number }`
  - `leafOf(sheet, o): LogLeaf | string`, where a string is the reason it cannot be logged, e.g. `not submitted`
  - `seal(rec | undefined, exp, o): { rec: SthRecord; added: string[]; skipped: {cand, reason}[] }`
    - It does not touch files.
    - It returns the **same** `rec` object when nothing new can be added to an existing log.
  - `proofFor(rec, sheet): Proof | undefined`, using the latest STH
  - `reconcile({centre, exam, shift, roster, relay: HeadsRes, cell: ShiftExport, rec?}): ReconRow`

- [ ] **Step 1: Write the failing tests**

`apps/server/test/seal.test.ts`:
```ts
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { hexToBytes } from '@saakshi/core/bytes';
import { cellKey, devPseud, trustFromKeys, type KeysFile } from '@saakshi/core/dev';
import { leafHashHex, NO_PREV_STH, sthId, sthMessage } from '@saakshi/core/log';
import { consistencyProof, rootOf, verifyConsistency, verifyInclusion } from '@saakshi/core/merkle';
import { verifier } from '@saakshi/core/node';
import type { ShiftExport } from '@saakshi/core/sheet';
import { leafOf, proofFor, seal } from '../src/seal.ts';
import { SimSeat } from '../../../tools/sim-seat.ts';

const keys = JSON.parse(readFileSync(new URL('../../../fixtures/keys.json', import.meta.url), 'utf8')) as KeysFile;
const cell = cellKey(keys, 'cell-1');
const authority = { priv: hexToBytes(keys.authority.priv), pub: hexToBytes(keys.authority.pub) };
const o = { authority, trust: trustFromKeys(keys), pseud: devPseud, now: () => 1_790_000_000_000 };
const seat = (cand: string, submit = true) => { const s = new SimSeat(keys, cand, cell.pub); s.add(5); if (submit) s.submit(); return s; };
const exp = (...seats: SimSeat[]): ShiftExport => ({ cell: 'cell-1', exam: 'DEMO-2026', shift: 'S1', sheets: seats.map((s) => s.sheet()) });
const hashes = (rec: { leaves: Parameters<typeof leafHashHex>[0][] }) => rec.leaves.map((l) => hexToBytes(leafHashHex(l)));

test('the first seal logs every submitted chain, skips the rest, and signs an STH with prevSTH = zeros', () => {
  const a = seat('C0002'), b = seat('C0001'), c = seat('C0003', false);
  const r = seal(undefined, exp(a, b, c), o);
  expect(r.added).toEqual(['C0001', 'C0002']);                                   // sorted by candidate
  expect(r.skipped).toEqual([{ cand: 'C0003', reason: 'not submitted' }]);
  expect(r.rec.leaves.map((l) => [l.cand, l.h, l.pseud])).toEqual([['C0001', b.hs[5], devPseud('C0001')], ['C0002', a.hs[5], devPseud('C0002')]]);   // seq 6 = the submit
  const { sth, sig } = r.rec.sths[0];
  expect(sth).toMatchObject({ exam: 'DEMO-2026', shift: 'S1', size: 2, prevSTH: NO_PREV_STH, ts: 1_790_000_000_000 });
  expect(sth.root).toBe(Buffer.from(rootOf(hashes(r.rec))).toString('hex'));
  expect(verifier(authority.pub)(sthMessage(sth), hexToBytes(sig))).toBe(true);
});

test('re-sealing with nothing new returns the same record; a late submit appends, chains prevSTH and stays consistent', () => {
  const a = seat('C0001'), c = seat('C0003', false);
  const first = seal(undefined, exp(a, c), o).rec;
  expect(seal(first, exp(a, c), o).rec).toBe(first);
  c.submit();
  const second = seal(first, exp(a, c), o);
  expect(second.added).toEqual(['C0003']);
  expect(second.rec.leaves.map((l) => l.cand)).toEqual(['C0001', 'C0003']);    // append-only: never reordered
  const [s1, s2] = second.rec.sths.map((x) => x.sth);
  expect(s2.prevSTH).toBe(sthId(s1));
  const hs = hashes(second.rec);
  expect(verifyConsistency(1, 2, consistencyProof(hs, 1), hexToBytes(s1.root), hexToBytes(s2.root))).toBe(true);
});

test('proofFor gives an inclusion proof under the latest STH, and nothing for a candidate not in the log', () => {
  const a = seat('C0001'), b = seat('C0002'), c = seat('C0003', false);
  const { rec } = seal(undefined, exp(a, b, c), o);
  const p = proofFor(rec, b.sheet())!;
  expect(p.index).toBe(1);
  expect(verifyInclusion(p.index, p.sth.sth.size, hexToBytes(leafHashHex(rec.leaves[1])), p.inclusion.map(hexToBytes), hexToBytes(p.sth.sth.root))).toBe(true);
  expect(proofFor(rec, c.sheet())).toBeUndefined();
});

test('a sheet whose submit body was altered, or whose chain is broken, is not logged', () => {
  const a = seat('C0001');
  const sh = a.sheet();
  sh.entries[5].body = ['body', '', '', '', ['F1', '0'.repeat(64)]];
  expect(leafOf(sh, o)).toBe('submit body does not match its commitment');
  const cut = a.sheet();
  cut.entries.splice(2, 1);
  expect(leafOf(cut, o)).toBe('chain fails at seq 3 (seq)');
});
```

`apps/server/test/recon.test.ts`:
```ts
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { hexToBytes } from '@saakshi/core/bytes';
import { cellKey, devPseud, devRoster, trustFromKeys, type KeysFile } from '@saakshi/core/dev';
import type { ResponseSheet, ShiftExport } from '@saakshi/core/sheet';
import type { HeadsRes } from '@saakshi/core/wire';
import { reconcile } from '../src/recon.ts';
import { seal } from '../src/seal.ts';
import { SimSeat } from '../../../tools/sim-seat.ts';

const keys = JSON.parse(readFileSync(new URL('../../../fixtures/keys.json', import.meta.url), 'utf8')) as KeysFile;
const cell = cellKey(keys, 'cell-1');
const o = { authority: { priv: hexToBytes(keys.authority.priv), pub: hexToBytes(keys.authority.pub) }, trust: trustFromKeys(keys), pseud: devPseud };
const withReceipt = (sh: ResponseSheet): ResponseSheet => ({ ...sh, receipt: { cell: 'cell-1', seq: sh.entries.length, h: 'a'.repeat(64), code: 'X', sig: 'b'.repeat(128) } });
function shift() {
  const a = new SimSeat(keys, 'C0001', cell.pub); a.add(5); a.submit();
  const b = new SimSeat(keys, 'C0002', cell.pub); b.add(5); b.submit();
  const exp: ShiftExport = { cell: 'cell-1', exam: 'DEMO-2026', shift: 'S1', sheets: [withReceipt(a.sheet()), withReceipt(b.sheet())] };
  const relay: HeadsRes = { mode: 'relay', state: 'LIVE', streams: [a, b].map((s) => ({ ...s.ctx, head: s.head, cellHead: s.head, senderHead: s.head, seenAt: 1 })) };
  return { exp, relay };
}
const base = { centre: 'CEN-01', exam: 'DEMO-2026', shift: 'S1', roster: devRoster(keys) };

test('a sealed, fully synced shift reconciles green', () => {
  const { exp, relay } = shift();
  const r = reconcile({ ...base, relay, cell: exp, rec: seal(undefined, exp, o).rec });
  expect(r).toEqual({ centre: 'CEN-01', exam: 'DEMO-2026', shift: 'S1', registered: 8, checkedIn: 2, unlocked: 2, submitted: 2, receipts: 2, leaves: 2, headsEqual: true, headMismatches: [], green: true });
});

test('not yet sealed: leaves 0, not green', () => {
  const { exp, relay } = shift();
  const r = reconcile({ ...base, relay, cell: exp });
  expect([r.leaves, r.green]).toEqual([0, false]);
});

test('a relay head that differs from the cell\'s count names the candidate and turns the row red', () => {
  const { exp, relay } = shift();
  relay.streams[0].head = 8;
  const r = reconcile({ ...base, relay, cell: exp, rec: seal(undefined, exp, o).rec });
  expect(r.headsEqual).toBe(false);
  expect(r.headMismatches).toEqual(['C0001: relay 8 · cell 6']);
  expect(r.green).toBe(false);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test --timeout 60000 apps/server/test/seal.test.ts apps/server/test/recon.test.ts`
Expected: FAIL. The modules cannot be found.

- [ ] **Step 3: Write `apps/server/src/seal.ts`**

```ts
// Control: append submitted chains to the per-shift log and sign a new STH (protocol Addendum A.2/A.3). Pure: no files.
import { hexToBytes, toHex } from '@saakshi/core/bytes';
import { parseSignedLine, verifyChainKeyed } from '@saakshi/core/journal';
import { NO_PREV_STH, leafHashHex, sthId, sthMessage, type Sth } from '@saakshi/core/log';
import { inclusionProof, rootOf } from '@saakshi/core/merkle';
import { signer, verifier, type KeyPair } from '@saakshi/core/node';
import { bodyCommit, bodyFromArray } from '@saakshi/core/protocol';
import type { LogLeaf, Proof, ResponseSheet, ShiftExport, SthRecord, Trust } from '@saakshi/core/sheet';
import type { Verify } from '@saakshi/core/sig';

export interface SealOpts { authority: KeyPair; trust: Trust; pseud: (cand: string) => string; now?: () => number }
export interface SealResult { rec: SthRecord; added: string[]; skipped: { cand: string; reason: string }[] }

/** The leaf a submitted sheet contributes, or why it cannot be logged. Checks only what the leaf commits to. */
export function leafOf(sheet: ResponseSheet, o: Pick<SealOpts, 'trust' | 'pseud'>): LogLeaf | string {
  const { ctx } = sheet;
  if (sheet.pseud !== o.pseud(ctx.cand)) return 'pseudonym does not match';
  const keys = new Map<number, Verify>();
  for (const k of sheet.keys) if (o.trust.seats[`${ctx.cand}/${k.keyEpoch}`] === k.pub) keys.set(k.keyEpoch, verifier(hexToBytes(k.pub)));
  const chain = verifyChainKeyed(ctx, sheet.entries.map((e) => e.line), (e) => keys.get(e));
  if (!chain.ok) return `chain fails at seq ${chain.index + 1} (${chain.fault})`;
  const last = sheet.entries.at(-1);
  const p = last ? parseSignedLine(last.line) : undefined;
  if (!last || !p?.ok || p.header.kind !== 'submit') return 'not submitted';
  let fh: unknown;
  try {
    const b = bodyFromArray(last.body);
    if (bodyCommit(hexToBytes(last.salt), b) !== p.header.bodyCommit) return 'submit body does not match its commitment';
    fh = b.meta[1];
  } catch (e) { return `submit body: ${(e as Error).message}`; }
  if (typeof fh !== 'string' || !/^[0-9a-f]{64}$/.test(fh)) return 'submit meta has no finalHash';
  return { cand: ctx.cand, exam: ctx.exam, shift: ctx.shift, attempt: ctx.attempt, pseud: sheet.pseud, h: chain.head, finalHash: fh };
}

const byCand = (a: ResponseSheet, b: ResponseSheet) => (a.ctx.cand < b.ctx.cand ? -1 : a.ctx.cand > b.ctx.cand ? 1 : a.ctx.attempt - b.ctx.attempt);

/** Append every newly submitted chain (sorted by candidate) and sign an STH. Existing leaves are never reordered. */
export function seal(rec: SthRecord | undefined, exp: ShiftExport, o: SealOpts): SealResult {
  const leaves = [...(rec?.leaves ?? [])];
  const have = new Set(leaves.map((l) => `${l.cand}/${l.attempt}`));
  const added: string[] = [];
  const skipped: SealResult['skipped'] = [];
  for (const s of [...exp.sheets].sort(byCand)) {
    if (have.has(`${s.ctx.cand}/${s.ctx.attempt}`)) continue;
    const l = leafOf(s, o);
    if (typeof l === 'string') { skipped.push({ cand: s.ctx.cand, reason: l }); continue; }
    leaves.push(l);
    added.push(l.cand);
  }
  if (rec && !added.length) return { rec, added, skipped };
  const prev = rec?.sths.at(-1)?.sth;
  const sth: Sth = {
    exam: exp.exam, shift: exp.shift, size: leaves.length,
    root: toHex(rootOf(leaves.map((l) => hexToBytes(leafHashHex(l))))),
    prevSTH: prev ? sthId(prev) : NO_PREV_STH, ts: (o.now ?? Date.now)(),
  };
  const sig = toHex(signer(o.authority)(sthMessage(sth)));
  return { rec: { exam: exp.exam, shift: exp.shift, leaves, sths: [...(rec?.sths ?? []), { sth, sig }] }, added, skipped };
}

/** The proof /verify needs for one sheet, under the latest STH; undefined if the sheet is not in it. */
export function proofFor(rec: SthRecord, sheet: ResponseSheet): Proof | undefined {
  const signed = rec.sths.at(-1);
  if (!signed) return undefined;
  const index = rec.leaves.findIndex((l) => l.cand === sheet.ctx.cand && l.attempt === sheet.ctx.attempt);
  if (index < 0 || index >= signed.sth.size) return undefined;
  const hs = rec.leaves.slice(0, signed.sth.size).map((l) => hexToBytes(leafHashHex(l)));
  return { v: 1, sheet, sth: signed, index, inclusion: inclusionProof(hs, index).map(toHex) };
}
```

- [ ] **Step 4: Write `apps/server/src/recon.ts`**

```ts
// Per centre-shift reconciliation (plan §3.7): counts along the chain of custody, and relay head = cell head per candidate.
import { parseSignedLine } from '@saakshi/core/journal';
import type { ReconRow, ShiftExport, SthRecord } from '@saakshi/core/sheet';
import type { HeadsRes } from '@saakshi/core/wire';

export interface ReconIn { centre: string; exam: string; shift: string; roster: string[]; relay: HeadsRes; cell: ShiftExport; rec?: SthRecord }

export function reconcile(i: ReconIn): ReconRow {
  const relay = i.relay.streams.filter((v) => v.exam === i.exam && v.shift === i.shift);
  const sheets = i.cell.sheets.filter((s) => s.ctx.exam === i.exam && s.ctx.shift === i.shift);
  const key = (cand: string, attempt: number) => `${cand}/${attempt}`;
  const relayHead = new Map(relay.map((v) => [key(v.cand, v.attempt), v.head]));
  const cellHead = new Map(sheets.map((s) => [key(s.ctx.cand, s.ctx.attempt), s.entries.length]));
  const headMismatches = [...new Set([...relayHead.keys(), ...cellHead.keys()])].sort()
    .filter((k) => (relayHead.get(k) ?? 0) !== (cellHead.get(k) ?? 0))
    .map((k) => `${k.slice(0, k.lastIndexOf('/'))}: relay ${relayHead.get(k) ?? 0} · cell ${cellHead.get(k) ?? 0}`);
  const submitted = sheets.filter((s) => { const l = s.entries.at(-1); const p = l && parseSignedLine(l.line); return !!p && p.ok && p.header.kind === 'submit'; }).length;
  const row = {
    centre: i.centre, exam: i.exam, shift: i.shift,
    registered: i.roster.length,
    checkedIn: relay.filter((v) => v.senderHead >= 0 && i.roster.includes(v.cand)).length,  // DEV: the relay heard the seat (enrolment is Stage 3)
    unlocked: sheets.filter((s) => s.entries.length > 0).length,
    submitted,
    receipts: sheets.filter((s) => s.receipt).length,
    leaves: i.rec?.sths.at(-1)?.sth.size ?? 0,
    headsEqual: headMismatches.length === 0,
    headMismatches,
  };
  const green = row.headsEqual && row.submitted === row.receipts && row.receipts === row.leaves
    && row.unlocked <= row.checkedIn && row.checkedIn <= row.registered;
  return { ...row, green };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun test --timeout 60000 apps/server/test/seal.test.ts apps/server/test/recon.test.ts && pnpm --filter @saakshi/server typecheck`
Expected: PASS.

---

### Task 7: Audit — edits, truncation, count mismatches, recovery order

**Files:**
- Create: `apps/server/src/audit.ts`
- Test: `apps/server/test/audit.test.ts`

**Interfaces:**
- Consumes:
  - Task 2: `verifySheet`, `mismatchText`.
  - Task 1: `Finding`, `Recovery`, `Forms`, `ResponseSheet`, `ShiftExport`, `SthRecord`, `Trust`, `parseSignedLine`.
  - Task 6: `seal` (tests only).
  - Node's `verifier`, passed as `mkVerify`.
- Produces:
  - `interface AuditIn { cell: ShiftExport; relay: HeadsRes; archive?: ShiftExport; rec?: SthRecord; trust: Trust; forms: Forms }`
  - `audit(a: AuditIn): Finding[]`. Findings are sorted by candidate. Within a candidate the order is `count` (relay), then `count` (archive), then `chain`, then `body` (by seq), then `truncated`, `finalHash` and `receipt`.
  - Exact detail strings, which the tests pin:
    - body: `mismatchText(m)`, e.g. `Q17: record says B — the seat committed C`
    - count: `relay holds N entries, cell holds M` and `archive holds N entries, cell holds M`
    - chain: `entry S: <fault> — <detail>`
    - truncated: `the chain ends at seq N without the submit the register (or receipt) commits to`
    - missing: `the cell holds no entries; …`

- [ ] **Step 1: Write the failing tests**

`apps/server/test/audit.test.ts`:
```ts
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { hexToBytes } from '@saakshi/core/bytes';
import { cellKey, devPseud, trustFromKeys, type KeysFile } from '@saakshi/core/dev';
import { formsOf, type ShiftExport } from '@saakshi/core/sheet';
import type { HeadsRes } from '@saakshi/core/wire';
import { audit } from '../src/audit.ts';
import { seal } from '../src/seal.ts';
import { FORMS, SimSeat } from '../../../tools/sim-seat.ts';

const keys = JSON.parse(readFileSync(new URL('../../../fixtures/keys.json', import.meta.url), 'utf8')) as KeysFile;
const cell = cellKey(keys, 'cell-1');
const trust = trustFromKeys(keys), forms = formsOf(FORMS);
const authority = { priv: hexToBytes(keys.authority.priv), pub: hexToBytes(keys.authority.pub) };
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

/** C0001 answers all 20 items (I17 at seq 18 = 'C') and submits (seq 22); C0002 is still sitting (5 entries, no submit). */
function shift() {
  const a = new SimSeat(keys, 'C0001', cell.pub); a.add(21); a.submit();
  const b = new SimSeat(keys, 'C0002', cell.pub); b.add(5);
  const exp: ShiftExport = { cell: 'cell-1', exam: 'DEMO-2026', shift: 'S1', sheets: [a.sheet(), b.sheet()] };
  const relay: HeadsRes = { mode: 'relay', state: 'LIVE', streams: [a, b].map((s) => ({ ...s.ctx, head: s.head, cellHead: s.head, senderHead: s.head, seenAt: 1 })) };
  const { rec } = seal(undefined, exp, { authority, trust, pseud: devPseud });
  return { exp, relay, rec, archive: clone(exp) };
}
const run = (x: ReturnType<typeof shift>, cellExp: ShiftExport, o: { archive?: ShiftExport | null } = {}) =>
  audit({ cell: cellExp, relay: x.relay, archive: o.archive === null ? undefined : (o.archive ?? x.archive), rec: x.rec, trust, forms });
const kinds = (fs: { kind: string; seq: number }[]) => fs.map((f) => [f.kind, f.seq]);

test('an honest shift audits clean', () => {
  const x = shift();
  expect(run(x, x.exp)).toEqual([]);
});

test('an in-progress candidate is not called truncated or missing; a hello-only relay stream is ignored', () => {
  const x = shift();
  x.relay.streams.push({ exam: 'DEMO-2026', shift: 'S1', attempt: 1, cand: 'C0005', head: 0, cellHead: 0, senderHead: 0, seenAt: 1 });
  expect(run(x, x.exp)).toEqual([]);
});

test('an edited answer is located and recovered from the archive', () => {
  const x = shift(), cur = clone(x.exp);
  cur.sheets[0].entries[17].body = ['body', 'I17', 'A', 'B', [1000, []]];
  expect(run(x, cur)).toEqual([{ cand: 'C0001', seq: 18, kind: 'body', detail: 'Q17: record says B — the seat committed C', recovered: { from: 'archive', value: 'C' } }]);
});

test('without an archive an answer-only edit is recovered by option search; a meta edit is only located', () => {
  const x = shift(), cur = clone(x.exp);
  cur.sheets[0].entries[17].body = ['body', 'I17', 'A', 'B', [1000, []]];
  expect(run(x, cur, { archive: null })[0].recovered).toEqual({ from: 'option-search', value: 'C' });
  cur.sheets[0].entries[17].body = ['body', 'I17', 'A', 'B', [1, []]];
  const [f] = run(x, cur, { archive: null });
  expect([f.kind, f.seq, f.recovered]).toEqual(['body', 18, undefined]);
  expect(run(x, cur)[0].recovered).toEqual({ from: 'archive', value: 'C' });
});

test('an archive copy that fails its own commitment (edited before the seal) is never used for recovery', () => {
  const x = shift(), cur = clone(x.exp);
  cur.sheets[0].entries[17].body = ['body', 'I17', 'A', 'B', [1000, []]];
  expect(run(x, cur, { archive: clone(cur) })[0].recovered).toEqual({ from: 'option-search', value: 'C' });
});

test('a deleted row: counts disagree with relay and archive, and the gap is located and restored from the archive', () => {
  const x = shift(), cur = clone(x.exp);
  cur.sheets[0].entries.splice(4, 1);                                          // seq 5 gone
  const fs = run(x, cur);
  expect(kinds(fs)).toEqual([['count', 0], ['count', 0], ['chain', 5]]);
  expect(fs[0].detail).toBe('relay holds 22 entries, cell holds 21');
  expect(fs[2].recovered).toEqual({ from: 'archive', value: 'seq 5 restored from the sealed archive' });
  expect(run(x, cur, { archive: null }).at(-1)!.recovered?.from).toBe('next.prev');
});

test('a changed signature is located at its seq', () => {
  const x = shift(), cur = clone(x.exp);
  cur.sheets[0].entries[6].line = cur.sheets[0].entries[6].line.replace(/"([0-9a-f]{127})([0-9a-f])"\]$/, (_m, a, z) => `"${a}${z === '0' ? '1' : '0'}"]`);
  const fs = run(x, cur);
  expect(kinds(fs)).toEqual([['chain', 7]]);
  expect(fs[0].detail).toStartWith('entry 7: sig');
  expect(fs[0].recovered?.from).toBe('archive');
});

test('truncation: the register\'s leaf catches a chain cut before its submit, even with no relay or archive', () => {
  const x = shift(), cur = clone(x.exp);
  cur.sheets[0].entries.splice(19);                                            // keep seq 1–19
  const fs = audit({ cell: cur, relay: { mode: 'relay', state: 'LIVE', streams: [] }, rec: x.rec, trust, forms });
  expect(kinds(fs)).toEqual([['truncated', 19]]);
  expect(fs[0].detail).toBe('the chain ends at seq 19 without the submit the register (or receipt) commits to');
});

test('a candidate the cell has lost entirely is "missing", recovered from the archive', () => {
  const x = shift(), cur = clone(x.exp);
  cur.sheets.splice(0, 1);
  const fs = run(x, cur);
  expect(kinds(fs)).toEqual([['missing', 0]]);
  expect(fs[0].recovered).toEqual({ from: 'archive', value: '22 entries' });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test --timeout 60000 apps/server/test/audit.test.ts`
Expected: FAIL. `../src/audit.ts` cannot be found.

- [ ] **Step 3: Write `apps/server/src/audit.ts`**

```ts
// The audit (plan §3.7): sweep every chain, locate edits, truncation and count mismatches, and try the recovery order
// archive/replica → next.prev → option search. Reads only exports and heads, never a DB, so it can run anywhere.
import { hexToBytes, toHex } from '@saakshi/core/bytes';
import { parseSignedLine } from '@saakshi/core/journal';
import { verifier } from '@saakshi/core/node';
import { bodyCommit, bodyFromArray, entryHash } from '@saakshi/core/protocol';
import type { Finding, Forms, Recovery, ResponseSheet, ShiftExport, SthRecord, Trust } from '@saakshi/core/sheet';
import { mismatchText, verifySheet } from '@saakshi/core/verify';
import type { HeadsRes } from '@saakshi/core/wire';

export interface AuditIn { cell: ShiftExport; relay: HeadsRes; archive?: ShiftExport; rec?: SthRecord; trust: Trust; forms: Forms }

const keyOf = (cand: string, attempt: number) => `${cand}/${attempt}`;
const entryAt = (sheet: ResponseSheet, seq: number) =>
  sheet.entries.find((e) => { const p = parseSignedLine(e.line); return p.ok && p.header.seq === seq; });

/** 1. the archive's copy, only if its line is identical and its body matches the signed commitment; 3. option search. */
function recoverBody(sheet: ResponseSheet, arch: ResponseSheet | undefined, seq: number, searched: string | null): Recovery | undefined {
  const cur = entryAt(sheet, seq), a = arch?.entries[seq - 1];
  if (cur && a && a.line === cur.line) {
    const p = parseSignedLine(a.line);
    try {
      const b = bodyFromArray(a.body);
      if (p.ok && bodyCommit(hexToBytes(a.salt), b) === p.header.bodyCommit) return { from: 'archive', value: b.answer || 'no answer' };
    } catch { /* unusable copy */ }
  }
  return searched === null ? undefined : { from: 'option-search', value: searched };
}

/** 1. the archive's line, if the next entry's prev confirms it is the original; 2. next.prev pins the original h. */
function recoverLine(sheet: ResponseSheet, arch: ResponseSheet | undefined, seq: number): Recovery | undefined {
  const next = entryAt(sheet, seq + 1);
  const np = next ? parseSignedLine(next.line) : undefined;
  const pinned = np?.ok ? np.header.prev : undefined;
  const a = arch?.entries[seq - 1];
  const ap = a ? parseSignedLine(a.line) : undefined;
  if (ap?.ok && ap.header.seq === seq && (!pinned || toHex(entryHash(ap.header)) === pinned)) return { from: 'archive', value: `seq ${seq} restored from the sealed archive` };
  if (pinned) return { from: 'next.prev', value: `original h ${pinned.slice(0, 16)}… pinned by seq ${seq + 1}` };
  return undefined;
}

export function audit(a: AuditIn): Finding[] {
  const { exam, shift } = a.cell;
  const cellBy = new Map(a.cell.sheets.map((s) => [keyOf(s.ctx.cand, s.ctx.attempt), s]));
  const archBy = new Map((a.archive?.sheets ?? []).map((s) => [keyOf(s.ctx.cand, s.ctx.attempt), s]));
  const relayBy = new Map(a.relay.streams.filter((v) => v.exam === exam && v.shift === shift && v.head > 0).map((v) => [keyOf(v.cand, v.attempt), v.head]));
  const leafBy = new Map((a.rec?.leaves ?? []).filter((l) => l.exam === exam && l.shift === shift).map((l) => [keyOf(l.cand, l.attempt), l]));
  const out: Finding[] = [];

  for (const key of [...new Set([...cellBy.keys(), ...archBy.keys(), ...relayBy.keys(), ...leafBy.keys()])].sort()) {
    const cand = key.slice(0, key.lastIndexOf('/'));
    const sheet = cellBy.get(key), arch = archBy.get(key), relayHead = relayBy.get(key), leaf = leafBy.get(key);
    const add = ({ recovered, ...f }: Omit<Finding, 'cand'>) => { out.push(recovered ? { cand, ...f, recovered } : { cand, ...f }); };

    if (!sheet) {
      const held = [relayHead !== undefined && `the relay holds ${relayHead}`, arch && `the archive holds ${arch.entries.length}`, leaf && 'the register has its leaf'].filter(Boolean).join(', ');
      add({ seq: 0, kind: 'missing', detail: `the cell holds no entries; ${held}`, recovered: arch ? { from: 'archive', value: `${arch.entries.length} entries` } : undefined });
      continue;
    }
    const count = sheet.entries.length;
    if (relayHead !== undefined && relayHead !== count) add({ seq: 0, kind: 'count', detail: `relay holds ${relayHead} entries, cell holds ${count}` });
    if (arch && arch.entries.length > count) add({ seq: 0, kind: 'count', detail: `archive holds ${arch.entries.length} entries, cell holds ${count}` });

    const r = verifySheet(sheet, a.forms, a.trust, verifier);
    if (r.fault) add({ seq: r.fault.seq, kind: 'chain', detail: `entry ${r.fault.seq}: ${r.fault.fault} — ${r.fault.detail}`, recovered: recoverLine(sheet, arch, r.fault.seq) });
    for (const m of r.mismatches)
      add({ seq: m.seq, kind: 'body', detail: mismatchText(m), recovered: recoverBody(sheet, arch, m.seq, m.committed ? m.committed.answer || 'no answer' : null) });

    const anchor = leaf?.h ?? sheet.receipt?.h;
    if (anchor && r.submit?.h !== anchor) {
      add({ seq: count, kind: 'truncated', detail: `the chain ends at seq ${count} without the submit the register (or receipt) commits to`,
        recovered: arch && arch.entries.length > count ? { from: 'archive', value: `entries ${count + 1}–${arch.entries.length} restored from the sealed archive` } : undefined });
      continue;
    }
    const failed = (n: string) => r.checks.find((c) => c.name === n && !c.ok);
    if (!r.fault && !r.mismatches.length && r.submit) {
      const fh = failed('finalHash'), rc = failed('receipt');
      if (fh) add({ seq: r.submit.seq, kind: 'finalHash', detail: fh.detail });
      else if (rc && sheet.receipt) add({ seq: r.submit.seq, kind: 'receipt', detail: rc.detail });
    }
  }
  return out;
}
```
The `add` helper drops an undefined `recovered` key, so findings compare cleanly with `toEqual` and serialise without `"recovered": null`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test --timeout 60000 apps/server/test/audit.test.ts && pnpm --filter @saakshi/server typecheck`
Expected: PASS.

---

### Task 8: Cell export and the rogue edit — `sheet-export.ts`

**Files:**
- Create: `apps/server/src/sheet-export.ts`
- Test: `apps/server/test/sheet-export.test.ts`

**Interfaces:**
- Consumes:
  - Task 3: the `entries`, `bodies` and `receipts` tables, and `createIngest` with the cell options.
  - Task 1: `ResponseSheet`, `ShiftExport`, `bodyArray`.
  - Task 2: `verifySheet` and `mismatchText` (tests only).
- Produces:
  - `interface ExportOpts { exam; shift; cell: string; formOf: (cand) => string | undefined; pseud: (cand) => string; seatKey: (cand, keyEpoch) => Uint8Array | undefined }`
  - `shiftExport(db, o): ShiftExport`
    - Sheets are ordered by candidate and attempt, and entries by seq.
    - A missing body row becomes `['missing']`; unparsable meta becomes `['unreadable']`, with salt 32 × `0`.
  - `interface RogueIn { exam; shift; attempt; cand; item; answer }`
  - `rogueEdit(db, r): { seq; item; from; to; sql }`
    - It rewrites `bodies.answer` on the candidate's **latest** entry for that item.
    - It throws `no recorded answer for <cand> <item>` if there is none.

- [ ] **Step 1: Write the failing tests**

`apps/server/test/sheet-export.test.ts`:
```ts
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Database } from 'bun:sqlite';
import { cellKey, devForm, devPseud, devSeatKey, trustFromKeys, type KeysFile } from '@saakshi/core/dev';
import { verifier } from '@saakshi/core/node';
import { formsOf } from '@saakshi/core/sheet';
import { mismatchText, verifySheet } from '@saakshi/core/verify';
import { createIngest, type Ingest } from '../src/ingest.ts';
import { rogueEdit, shiftExport } from '../src/sheet-export.ts';
import { openDb } from '../src/store.ts';
import { FORMS, SimSeat } from '../../../tools/sim-seat.ts';

const keys = JSON.parse(readFileSync(new URL('../../../fixtures/keys.json', import.meta.url), 'utf8')) as KeysFile;
const cell = cellKey(keys, 'cell-1');
const forms = formsOf(FORMS), trust = trustFromKeys(keys);
const EX = { exam: 'DEMO-2026', shift: 'S1', cell: 'cell-1', formOf: devForm, pseud: devPseud, seatKey: devSeatKey(keys) };
let dir: string, n: Ingest, db: Database;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'saakshi-export-'));
  ({ db } = openDb(join(dir, 'cell.db')));
  n = createIngest({ mode: 'cell', db, fresh: false, seatKey: devSeatKey(keys), cell, forms, formOf: devForm, pseud: devPseud });
});
afterEach(() => { n.close(); rmSync(dir, { recursive: true, force: true }); });

async function sat(cand: string, entries: number, submit: boolean) {
  const s = new SimSeat(keys, cand, cell.pub);
  s.add(entries);
  if (submit) s.submit();
  const r = await n.sync({ entries: s.entries, streams: [{ ...s.ctx, head: s.head }] });
  if (r === 'REBUILDING' || r.rejected.length) throw new Error(JSON.stringify(r));
  return s;
}

test('the export is exactly the honest sheet plus the cell\'s countersigned receipt, and it verifies', async () => {
  const a = await sat('C0001', 21, true), b = await sat('C0002', 4, false);
  const exp = shiftExport(db, EX);
  expect(exp.sheets.map((s) => s.ctx.cand)).toEqual(['C0001', 'C0002']);
  const { receipt, ...rest } = exp.sheets[0];
  expect(rest).toEqual(a.sheet());
  expect(receipt).toMatchObject({ cell: 'cell-1', seq: 22, h: a.hs[21] });
  expect(exp.sheets[1]).toEqual(b.sheet());
  const r = verifySheet(exp.sheets[0], forms, trust, verifier);
  expect(r.ok).toBe(true);
  expect(r.receipt!.code).toBe(receipt!.code);
});

test('rogueEdit rewrites the latest recorded answer; the export now shows it and verification names it', async () => {
  const a = await sat('C0001', 21, true);
  const r = rogueEdit(db, { exam: 'DEMO-2026', shift: 'S1', attempt: 1, cand: 'C0001', item: 'I17', answer: 'B' });
  expect(r).toMatchObject({ seq: 18, item: 'I17', from: 'C', to: 'B' });
  expect(r.sql).toBe("UPDATE bodies SET answer = 'B' WHERE exam = 'DEMO-2026' AND shift = 'S1' AND attempt = 1 AND cand = 'C0001' AND seq = 18;");
  const v = verifySheet(shiftExport(db, EX).sheets[0], forms, trust, verifier);
  expect(v.ok).toBe(false);
  expect(v.mismatches.map(mismatchText)).toEqual(['Q17: record says B — the seat committed C']);
  expect(a.head).toBe(22);
});

test('a deleted body row exports as ["missing"]; rogueEdit on an item never answered throws', async () => {
  await sat('C0001', 3, false);
  db.run("DELETE FROM bodies WHERE cand = 'C0001' AND seq = 2");
  expect(shiftExport(db, EX).sheets[0].entries[1]).toMatchObject({ salt: '0'.repeat(32), body: ['missing'] });
  expect(() => rogueEdit(db, { exam: 'DEMO-2026', shift: 'S1', attempt: 1, cand: 'C0001', item: 'I19', answer: 'A' })).toThrow('no recorded answer for C0001 I19');
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test --timeout 60000 apps/server/test/sheet-export.test.ts`
Expected: FAIL. `../src/sheet-export.ts` cannot be found.

- [ ] **Step 3: Write `apps/server/src/sheet-export.ts`**

```ts
// The cell's official response sheets ("the record") for one exam shift, and the DEV rogue-insider edit.
import type { Database } from 'bun:sqlite';
import { toHex } from '@saakshi/core/bytes';
import type { Canon } from '@saakshi/core/canon';
import { bodyArray, type State } from '@saakshi/core/protocol';
import type { ResponseSheet, ShiftExport } from '@saakshi/core/sheet';

export interface ExportOpts {
  exam: string; shift: string; cell: string;
  formOf: (cand: string) => string | undefined;
  pseud: (cand: string) => string;
  seatKey: (cand: string, keyEpoch: number) => Uint8Array | undefined;
}
interface J { attempt: number; cand: string; seq: number; key_epoch: number; line: string; item: string | null; state: string | null; answer: string | null; meta: string | null; salt: Uint8Array | null }
interface R { attempt: number; cand: string; seq: number; h: string; code: string; cell: string; sig: string }

function recorded(r: J): { salt: string; body: Canon[] } {
  if (r.item === null || r.salt === null) return { salt: '0'.repeat(32), body: ['missing'] };
  try { return { salt: toHex(r.salt), body: bodyArray({ item: r.item, state: r.state as State | '', answer: r.answer ?? '', meta: JSON.parse(r.meta ?? '') }) }; }
  catch { return { salt: '0'.repeat(32), body: ['unreadable'] }; }
}

export function shiftExport(db: Database, o: ExportOpts): ShiftExport {
  const rows = db.query(`SELECT e.attempt, e.cand, e.seq, e.key_epoch, e.line, b.item, b.state, b.answer, b.meta, b.salt
    FROM entries e LEFT JOIN bodies b ON b.exam = e.exam AND b.shift = e.shift AND b.attempt = e.attempt AND b.cand = e.cand AND b.seq = e.seq
    WHERE e.exam = ? AND e.shift = ? ORDER BY e.cand, e.attempt, e.seq`).all(o.exam, o.shift) as J[];
  const receipts = new Map((db.query('SELECT attempt, cand, seq, h, code, cell, sig FROM receipts WHERE exam = ? AND shift = ?').all(o.exam, o.shift) as R[])
    .map((r) => [`${r.cand}/${r.attempt}`, r]));
  const sheets = new Map<string, { sheet: ResponseSheet; epochs: Set<number> }>();
  for (const r of rows) {
    const k = `${r.cand}/${r.attempt}`;
    let x = sheets.get(k);
    if (!x) sheets.set(k, (x = { sheet: { ctx: { exam: o.exam, shift: o.shift, attempt: r.attempt, cand: r.cand }, form: o.formOf(r.cand) ?? '', pseud: o.pseud(r.cand), keys: [], entries: [] }, epochs: new Set() }));
    x.epochs.add(r.key_epoch);
    x.sheet.entries.push({ line: r.line, ...recorded(r) });
  }
  for (const [k, { sheet, epochs }] of sheets) {
    sheet.keys = [...epochs].sort((a, b) => a - b).flatMap((e) => { const pub = o.seatKey(sheet.ctx.cand, e); return pub ? [{ keyEpoch: e, pub: toHex(pub) }] : []; });
    const rc = receipts.get(k);
    if (rc) sheet.receipt = { cell: rc.cell, seq: rc.seq, h: rc.h, code: rc.code, sig: rc.sig };
  }
  return { cell: o.cell, exam: o.exam, shift: o.shift, sheets: [...sheets.values()].map((x) => x.sheet) };
}

export interface RogueIn { exam: string; shift: string; attempt: number; cand: string; item: string; answer: string }
export interface RogueOut { seq: number; item: string; from: string; to: string; sql: string }

/** DEV chaos only: what an insider with DB access does — rewrite the recorded answer of the latest entry for an item. */
export function rogueEdit(db: Database, r: RogueIn): RogueOut {
  const row = db.query('SELECT seq, answer FROM bodies WHERE exam = ? AND shift = ? AND attempt = ? AND cand = ? AND item = ? ORDER BY seq DESC LIMIT 1')
    .get(r.exam, r.shift, r.attempt, r.cand, r.item) as { seq: number; answer: string } | null;
  if (!row) throw new Error(`no recorded answer for ${r.cand} ${r.item}`);
  db.query('UPDATE bodies SET answer = ? WHERE exam = ? AND shift = ? AND attempt = ? AND cand = ? AND seq = ?').run(r.answer, r.exam, r.shift, r.attempt, r.cand, row.seq);
  const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
  return {
    seq: row.seq, item: r.item, from: row.answer, to: r.answer,
    sql: `UPDATE bodies SET answer = ${q(r.answer)} WHERE exam = ${q(r.exam)} AND shift = ${q(r.shift)} AND attempt = ${r.attempt} AND cand = ${q(r.cand)} AND seq = ${row.seq};`,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test --timeout 60000 apps/server/test/sheet-export.test.ts && pnpm --filter @saakshi/server typecheck`
Expected: PASS.

---

### Task 9: `/verify` — a single offline HTML page (noble only, golden vectors in the browser)

**Files:**
- Create: `apps/server/src/verify.html`, `apps/server/src/verify-page.ts`, `apps/server/src/verify-view.ts`, `apps/server/src/verify-build.ts`
- Test: `apps/server/test/verify-page.test.ts`

**Interfaces:**
- Consumes:
  - Task 2: `verifyProof`, `parseProof`, `mismatchText`, `goldenSelfTest`, `SheetReport`, `CheckName`.
  - Task 1: `formsOf`, `Trust`, `fixtures/trust-dev.json` and both vector files.
  - Task 6: `seal` and `proofFor` (tests only).
- Produces:
  - `verifyHtml(): Promise<string>`: one self-contained HTML document, built once per process and cached.
  - `viewOf(r: SheetReport): { verdict: 'match' | 'altered' | 'invalid'; title: string; headline: string; rows: { label: string; ok: boolean; detail: string }[]; more: string[] }`
- The page:
  - On load, it runs `goldenSelfTest` and shows the result.
  - It takes `proof.json` from a file picker, and the receipt code from a text field.
  - When it is served over HTTP with `?cand=`, it fetches `/v1/proof?cand=` from the same origin. That is its only network call.
  - It renders with `textContent` only.
  - The bundle imports only the browser-safe core modules and `trust-dev.json`, never `keys.json`.

- [ ] **Step 1: Write the failing tests**

`apps/server/test/verify-page.test.ts`:
```ts
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { hexToBytes } from '@saakshi/core/bytes';
import { cellKey, devPseud, trustFromKeys, type KeysFile } from '@saakshi/core/dev';
import { formsOf } from '@saakshi/core/sheet';
import { verifyProof } from '@saakshi/core/verify';
import { proofFor, seal } from '../src/seal.ts';
import { verifyHtml } from '../src/verify-build.ts';
import { viewOf } from '../src/verify-view.ts';
import { FORMS, SimSeat } from '../../../tools/sim-seat.ts';

const keys = JSON.parse(readFileSync(new URL('../../../fixtures/keys.json', import.meta.url), 'utf8')) as KeysFile;
const cell = cellKey(keys, 'cell-1');
const trust = trustFromKeys(keys), forms = formsOf(FORMS);
const src = readFileSync(join(import.meta.dir, '../src/verify-page.ts'), 'utf8');

function proof() {
  const s = new SimSeat(keys, 'C0001', cell.pub);
  s.add(21); s.submit();
  const exp = { cell: 'cell-1', exam: 'DEMO-2026', shift: 'S1', sheets: [s.sheet()] };
  const { rec } = seal(undefined, exp, { authority: { priv: hexToBytes(keys.authority.priv), pub: hexToBytes(keys.authority.pub) }, trust, pseud: devPseud });
  return proofFor(rec, exp.sheets[0])!;
}

test('verify.html compiles to one self-contained page with no network, no Node and no private keys', async () => {
  const html = await verifyHtml();
  expect(html).toContain('<title>Saakshi · Verify</title>');
  expect(html).not.toMatch(/<script[^>]*\ssrc=/i);
  expect(html).not.toMatch(/<link[^>]*\shref=/i);
  expect(html).not.toMatch(/https?:\/\/(?!www\.w3\.org)/);                     // no CDN or remote URL (SVG namespaces are fine)
  expect(html).not.toContain('createPrivateKey');
  expect(html).not.toContain('node:crypto');
  for (const k of [keys.authority, ...keys.cells, ...keys.seats]) expect(html).not.toContain(k.priv);
  expect(html).toContain(keys.authority.pub);                                    // the pinned trust anchor is inside
  expect(await verifyHtml()).toBe(html);                                         // cached
});

test('the page renders untrusted text with textContent only, and fetches only its own /v1/proof', () => {
  expect(src).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
  expect([...src.matchAll(/fetch\(/g)].length).toBe(1);
  expect(src).toContain('/v1/proof?cand=');
});

test('viewOf: an honest proof is a match; an edited answer is "altered" with the headline', () => {
  const p = proof();
  const ok = viewOf(verifyProof(p, forms, trust));
  expect(ok.verdict).toBe('match');
  expect(ok.rows.every((r) => r.ok)).toBe(true);
  p.sheet.entries[17].body = ['body', 'I17', 'A', 'B', [1000, []]];
  const bad = viewOf(verifyProof(p, forms, trust));
  expect(bad.verdict).toBe('altered');
  expect(bad.title).toBe('The record was altered after the seat committed it');
  expect(bad.headline).toBe('Q17: record says B — the seat committed C');
  expect(bad.rows.find((r) => r.label.startsWith('Answers'))!.ok).toBe(false);
});

test('viewOf: a proof that does not verify for other reasons is "invalid"', () => {
  const p = proof();
  p.sth.sig = p.sth.sig.replace(/^./, (c) => (c === '0' ? '1' : '0'));
  const v = viewOf(verifyProof(p, forms, trust));
  expect(v.verdict).toBe('invalid');
  expect(v.headline).toMatch(/register head/);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test --timeout 60000 apps/server/test/verify-page.test.ts`
Expected: FAIL. The modules cannot be found.

- [ ] **Step 3: Write `verify-view.ts` (pure)**

```ts
import { mismatchText, type CheckName, type SheetReport } from '@saakshi/core/verify';

const LABEL: Record<CheckName, string> = {
  keys: 'Seat keys (one per key epoch, pinned)',
  chain: 'Signed hash chain',
  bodies: 'Answers vs. what the seat committed',
  finalHash: 'Final answer hash (replayed)',
  receipt: 'Receipt code and cell countersignature',
  slip: 'Code on the candidate\'s slip',
  sth: 'Register head signed by the exam authority',
  inclusion: 'Included in the sealed public register',
};

export interface View { verdict: 'match' | 'altered' | 'invalid'; title: string; headline: string; rows: { label: string; ok: boolean; detail: string }[]; more: string[] }

export function viewOf(r: SheetReport): View {
  const altered = r.mismatches.length > 0;
  const firstBad = r.checks.find((c) => !c.ok);
  return {
    verdict: r.ok ? 'match' : altered ? 'altered' : 'invalid',
    title: r.ok ? 'The record matches what the seat committed' : altered ? 'The record was altered after the seat committed it' : 'This record does not verify',
    headline: altered ? mismatchText(r.mismatches[0]) : firstBad ? firstBad.detail : `Receipt ${r.receipt?.code ?? ''} — every check passes`,
    rows: r.checks.map((c) => ({ label: LABEL[c.name], ok: c.ok, detail: c.detail })),
    more: r.mismatches.slice(1).map(mismatchText),
  };
}
```

- [ ] **Step 4: Write `verify.html` and `verify-page.ts`**

`apps/server/src/verify.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Saakshi · Verify</title>
    <style>
      :root { font-family: system-ui, sans-serif; color: #202124; background: #fff; }
      body { margin: 0 auto; padding: 1rem 1.5rem 3rem; max-width: 56rem; }
      h1 { font-size: 1.75rem; margin: 0 0 .25rem; }
      .lede { color: #5f6368; margin: 0 0 1rem; }
      .good { color: #1e6b25; } .bad { color: #b3261e; }
      #selftest { font-size: .875rem; margin: 0 0 1.25rem; }
      form { display: grid; gap: .75rem; margin-bottom: 1.25rem; }
      label { display: grid; gap: .25rem; font-weight: 600; }
      input[type=text] { font: 1.125rem ui-monospace, Menlo, Consolas, monospace; padding: .5rem; border: 1px solid #5f6368; border-radius: .375rem; max-width: 28rem; }
      #verdict { border: 2px solid; border-radius: .5rem; padding: .75rem 1rem; margin: 0 0 1rem; }
      #verdict.match { border-color: #2e7d32; background: #e6f4ea; } #verdict.altered, #verdict.invalid { border-color: #c62828; background: #fce8e6; }
      #verdict h2 { margin: 0 0 .25rem; font-size: 1.25rem; } #headline { font-size: 1.5rem; font-weight: 700; margin: 0; }
      table { border-collapse: collapse; width: 100%; } th, td { text-align: left; padding: .375rem .5rem; border-bottom: 1px solid #dadce0; vertical-align: top; }
      td.state { font-weight: 700; white-space: nowrap; }
      :focus-visible { outline: 3px solid #1565c0; outline-offset: 2px; }
      @media (forced-colors: active) { #verdict { border-color: CanvasText; } }
    </style>
  </head>
  <body>
    <h1>Verify a response sheet</h1>
    <p class="lede">Works offline. Nothing you load here leaves this computer.</p>
    <p id="selftest" role="status">Running the golden vectors…</p>
    <form id="form">
      <label>Proof file (proof.json from the evidence pack)<input id="file" type="file" accept=".json,application/json" /></label>
      <label>Receipt code from the slip (optional)<input id="code" type="text" autocomplete="off" spellcheck="false" placeholder="XXXX-XXXX-XXXX-XXXX-X" /></label>
    </form>
    <p id="loaded" role="status"></p>
    <section id="verdict" hidden aria-live="polite"><h2 id="title"></h2><p id="headline"></p><ul id="more"></ul></section>
    <table id="checks" hidden><thead><tr><th scope="col">Check</th><th scope="col">Result</th><th scope="col">Detail</th></tr></thead><tbody id="rows"></tbody></table>
    <script type="module" src="./verify-page.ts"></script>
  </body>
</html>
```

`apps/server/src/verify-page.ts`:
```ts
// /verify in the browser: noble-only core, pinned public keys, golden vectors on load. Untrusted input is rendered as text only.
import formsJson from '../../../fixtures/paper/forms.json' with { type: 'json' };
import trustJson from '../../../fixtures/trust-dev.json' with { type: 'json' };
import V from '../../../fixtures/vectors/protocol-v1.json' with { type: 'json' };
import A from '../../../fixtures/vectors/protocol-v1-addendum-a.json' with { type: 'json' };
import { goldenSelfTest } from '@saakshi/core/selftest';
import { formsOf, type Proof, type Trust } from '@saakshi/core/sheet';
import { parseProof, verifyProof } from '@saakshi/core/verify';
import { viewOf } from './verify-view.ts';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const forms = formsOf(formsJson as Record<string, unknown>);
const trust = trustJson as Trust;
const code = $<HTMLInputElement>('code');
let proof: Proof | undefined;

const st = goldenSelfTest(V, A);
$('selftest').textContent = st.fail.length
  ? `Golden vectors: ${st.fail.length} FAILED in this browser — do not rely on the result below (${st.fail.join('; ')})`
  : `Golden vectors: all ${st.pass} checks pass in this browser (protocol v1 + addendum A).`;
$('selftest').className = st.fail.length ? 'bad' : 'good';

function load(text: string, source: string): void {
  try {
    proof = parseProof(JSON.parse(text));
    const c = proof.sheet.ctx;
    $('loaded').textContent = `Loaded ${source}: candidate ${c.cand}, ${c.exam} ${c.shift}, ${proof.sheet.entries.length} entries.`;
  } catch (e) {
    proof = undefined;
    $('loaded').textContent = `Cannot read ${source}: ${(e as Error).message}`;
  }
  render();
}

function render(): void {
  const box = $('verdict'), table = $('checks');
  box.hidden = table.hidden = !proof;
  if (!proof) return;
  const v = viewOf(verifyProof(proof, forms, trust, code.value));
  box.className = v.verdict;
  $('title').textContent = v.title;
  $('headline').textContent = v.headline;
  $('more').replaceChildren(...v.more.map((m) => { const li = document.createElement('li'); li.textContent = m; return li; }));
  $('rows').replaceChildren(...v.rows.map((r) => {
    const tr = document.createElement('tr');
    const cells = [r.label, r.ok ? '✓ pass' : '✗ fail', r.detail].map((t) => { const td = document.createElement('td'); td.textContent = t; return td; });
    cells[1].className = `state ${r.ok ? 'good' : 'bad'}`;
    tr.append(...cells);
    return tr;
  }));
}

$<HTMLInputElement>('file').addEventListener('change', async (ev) => {
  const f = (ev.target as HTMLInputElement).files?.[0];
  if (f) load(await f.text(), f.name);
});
code.addEventListener('input', render);
$('form').addEventListener('submit', (ev) => ev.preventDefault());

// Served by control: /verify?cand=C0001 loads that candidate's proof from the same origin. Opened from file://, nothing is fetched.
const cand = new URLSearchParams(location.search).get('cand');
if (location.protocol.startsWith('http') && cand) {
  fetch(`/v1/proof?cand=${encodeURIComponent(cand)}`)
    .then(async (r) => (r.ok ? r.text() : Promise.reject(new Error((await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`))))
    .then((t) => load(t, `the sealed register (${cand})`), (e) => { $('loaded').textContent = `Cannot load ${cand}: ${(e as Error).message}`; });
}
```

- [ ] **Step 5: Write `verify-build.ts`**

```ts
// Compile verify.html into ONE self-contained HTML string (inline script, no external src), so it opens offline from file://.
import { join } from 'node:path';

let cached: Promise<string> | undefined;

export function verifyHtml(): Promise<string> {
  return (cached ??= (async () => {
    const r = await Bun.build({ entrypoints: [join(import.meta.dir, 'verify.html')], target: 'browser', compile: true, minify: true });
    if (!r.success || r.outputs.length !== 1) throw new Error(`verify.html build failed: ${r.logs.map(String).join('\n')}`);
    return r.outputs[0].text();
  })());
}
```
If `@types/bun` rejects `compile: true` together with `target: 'browser'`, cast the options object with `as Parameters<typeof Bun.build>[0]`. Bun 1.3.14 supports it at runtime: it inlines the scripts, styles and JSON.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `bun test --timeout 60000 apps/server/test/verify-page.test.ts && pnpm --filter @saakshi/server typecheck`
Expected: PASS.

- [ ] **Step 7: Check it in a real browser, offline**

Run: `bun -e "import { verifyHtml } from './apps/server/src/verify-build.ts'; await Bun.write(process.env.TMPDIR + '/verify.html', await verifyHtml())"`

The user or the controller then opens `$TMPDIR/verify.html` from `file://` with Wi-Fi off.
Expected: the banner reads `Golden vectors: all 30 checks pass in this browser (protocol v1 + addendum A).`, and the browser console shows no errors.

---

### Task 10: The evidence pack — report, BSA 2023 s.63 certificate template, manifest, `.tar.gz`

**Files:**
- Create: `apps/server/src/evidence.ts`
- Test: `apps/server/test/evidence.test.ts`

**Interfaces:**
- Consumes:
  - Task 2: `verifyProof`, `mismatchText`, `SheetReport`.
  - Task 1: `Finding`, `Forms`, `Proof`, `Trust`, `parseSignedLine`.
  - Task 6: `seal` and `proofFor` (tests only).
  - `Bun.Archive` and `node:crypto`.
- Produces:
  - `interface PackIn { proof: Proof; findings: Finding[]; custody: string[]; verifyHtml: string; forms: Forms; trust: Trust; now: number }`
  - `interface Pack { name: string; files: Record<string, string>; tgz: Uint8Array }`
  - `buildPack(p: PackIn): Promise<Pack>`
    - `name` is `evidence-<exam>-<shift>-<cand>-<YYYYMMDDTHHMMSSZ>`.
    - `files` holds exactly the pack files listed in Global Constraints.
    - Inside `tgz`, every file sits under `<name>/`.
  - `esc(s: unknown): string`, which HTML-escapes `& < > " '`.
- Control (Task 12) writes the files and the `.tar.gz` to disk. This module does no I/O.

- [ ] **Step 1: Write the failing tests**

`apps/server/test/evidence.test.ts`:
```ts
import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { hexToBytes } from '@saakshi/core/bytes';
import { cellKey, devPseud, trustFromKeys, type KeysFile } from '@saakshi/core/dev';
import { formsOf } from '@saakshi/core/sheet';
import { buildPack, esc } from '../src/evidence.ts';
import { proofFor, seal } from '../src/seal.ts';
import { FORMS, SimSeat } from '../../../tools/sim-seat.ts';

const keys = JSON.parse(readFileSync(new URL('../../../fixtures/keys.json', import.meta.url), 'utf8')) as KeysFile;
const cell = cellKey(keys, 'cell-1');
const trust = trustFromKeys(keys), forms = formsOf(FORMS);
const sha = (s: string | Uint8Array) => createHash('sha256').update(s).digest('hex');
const FILES = ['README.txt', 'audit.json', 'certificate-s63.html', 'custody.jsonl', 'manifest.sha256', 'proof.json', 'report.html', 'sth.json', 'verify.html'];

function proof() {
  const s = new SimSeat(keys, 'C0001', cell.pub);
  s.add(21); s.submit();
  const exp = { cell: 'cell-1', exam: 'DEMO-2026', shift: 'S1', sheets: [s.sheet()] };
  const { rec } = seal(undefined, exp, { authority: { priv: hexToBytes(keys.authority.priv), pub: hexToBytes(keys.authority.pub) }, trust, pseud: devPseud });
  return proofFor(rec, exp.sheets[0])!;
}
const input = (p = proof()) => ({ proof: p, findings: [], custody: ['{"at":"2026-09-27T10:00:00.000Z","action":"seal"}'], verifyHtml: '<!doctype html><title>Saakshi · Verify</title>', forms, trust, now: Date.UTC(2026, 8, 27, 10, 30, 0) });

test('the pack holds every file, the manifest hashes each of them, and the tar.gz carries the same bytes under <name>/', async () => {
  const pack = await buildPack(input());
  expect(pack.name).toBe('evidence-DEMO-2026-S1-C0001-20260927T103000Z');
  expect(Object.keys(pack.files).sort()).toEqual(FILES);
  const lines = pack.files['manifest.sha256'].trim().split('\n');
  expect(lines.length).toBe(FILES.length - 1);
  for (const l of lines) { const [h, f] = l.split('  '); expect(sha(pack.files[f])).toBe(h); }
  const files = await new Bun.Archive(pack.tgz).files();
  for (const f of FILES) expect(await files.get(`${pack.name}/${f}`)!.text()).toBe(pack.files[f]);
  expect(JSON.parse(pack.files['proof.json']).v).toBe(1);
});

test('the report states the verdict and the certificate cites s.63 with the file hashes', async () => {
  const p = proof();
  p.sheet.entries[17].body = ['body', 'I17', 'A', 'B', [1000, []]];
  const pack = await buildPack(input(p));
  expect(pack.files['report.html']).toContain('Q17: record says B — the seat committed C');
  const cert = pack.files['certificate-s63.html'];
  expect(cert).toContain('Section 63');
  expect(cert).toContain('Bharatiya Sakshya Adhiniyam, 2023');
  expect(cert).toContain(sha(pack.files['proof.json']));
  expect(cert).toContain('SHA-256');
});

test('report.html escapes recorded strings, so a hostile record cannot inject markup', async () => {
  const p = proof();
  p.sheet.entries[2].body = ['body', 'I01', 'A', '<img src=x onerror=alert(1)>', [1000, []]];
  const html = (await buildPack(input(p))).files['report.html'];
  expect(html).not.toContain('<img src=x');
  expect(html).toContain('&#60;img src=x onerror=alert(1)&#62;');
  expect(esc(`<"'&>`)).toBe('&#60;&#34;&#39;&#38;&#62;');
});
```
- [ ] **Step 2: Run them to verify they fail**

Run: `bun test --timeout 60000 apps/server/test/evidence.test.ts`
Expected: FAIL. `../src/evidence.ts` cannot be found.

- [ ] **Step 3: Write `apps/server/src/evidence.ts`**

```ts
// One-click evidence pack (plan §3.7): printable report, BSA 2023 s.63 certificate TEMPLATE, the proof, the STH,
// audit findings, the chain-of-custody log, the offline verifier and a SHA-256 manifest — as files and as one .tar.gz.
import { createHash } from 'node:crypto';
import { parseSignedLine } from '@saakshi/core/journal';
import { verifier } from '@saakshi/core/node';
import type { Finding, Forms, Proof, Trust } from '@saakshi/core/sheet';
import { mismatchText, verifyProof, type SheetReport } from '@saakshi/core/verify';

export interface PackIn { proof: Proof; findings: Finding[]; custody: string[]; verifyHtml: string; forms: Forms; trust: Trust; now: number }
export interface Pack { name: string; files: Record<string, string>; tgz: Uint8Array }

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
export const esc = (s: unknown): string => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const stamp = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
const page = (title: string, body: string) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
body{font:14px/1.5 system-ui,sans-serif;color:#202124;max-width:60rem;margin:1.5rem auto;padding:0 1rem}
h1{font-size:1.5rem}h2{font-size:1.125rem;margin-top:1.5rem}table{border-collapse:collapse;width:100%}
th,td{border:1px solid #bbb;padding:.25rem .5rem;text-align:left;vertical-align:top}code{font:12px ui-monospace,Menlo,monospace;overflow-wrap:anywhere}
.bad{color:#b3261e;font-weight:700}.good{color:#1e6b25;font-weight:700}.blank{display:inline-block;min-width:16rem;border-bottom:1px solid #202124}
.note{border:1px solid #b06000;background:#fef7e0;padding:.5rem .75rem}@media print{.note{border-color:#000;background:none}}
</style></head><body>${body}</body></html>
`;

const readme = (name: string) => `Saakshi evidence pack ${name}

1. Check integrity:   shasum -a 256 -c manifest.sha256     (Windows: CertUtil -hashfile <file> SHA256)
2. Verify offline:    open verify.html in any browser, choose proof.json, type the receipt code from the slip.
                      It needs no network and pins the exam authority's public key.
3. Read:              report.html (what was checked, entry by entry) and certificate-s63.html (to be completed and signed).

proof.json      the official response sheet (entries, signatures, bodies with salts), the signed register head and the inclusion proof
sth.json        the signed register head (STH) alone
audit.json      the audit findings for this candidate
custody.jsonl   the chain-of-custody log up to this export
`;

function reportHtml(p: PackIn, r: SheetReport): string {
  const { sheet, sth, index, inclusion } = p.proof;
  const { ctx } = sheet;
  const form = p.forms[sheet.form] ?? [];
  const bad = new Set(r.mismatches.map((m) => m.seq));
  const rows = sheet.entries.map((e) => {
    const l = parseSignedLine(e.line);
    const [, item = '', state = '', answer = ''] = e.body;
    const seq = l.ok ? l.header.seq : '?';
    const q = typeof item === 'string' && form.indexOf(item) >= 0 ? `Q${form.indexOf(item) + 1} (${item})` : '';
    const sig = e.line.match(/"([0-9a-f]{128})"\]$/)?.[1] ?? '';
    return `<tr><td>${esc(seq)}</td><td>${esc(l.ok ? l.header.kind : 'unparseable')}</td><td>${esc(q)}</td><td>${esc(state)} ${esc(answer)}</td>`
      + `<td class="${bad.has(Number(seq)) ? 'bad">✗ differs' : 'good">✓ matches'}</td><td><code>${esc(sig)}</code></td></tr>`;
  }).join('\n');
  const verdict = r.ok ? 'The record matches what the seat committed.' : r.mismatches.length ? mismatchText(r.mismatches[0]) : 'The record does not verify.';
  return page(`Evidence report — ${ctx.cand}`, `
<h1>Evidence report: ${esc(ctx.cand)} · ${esc(ctx.exam)} · ${esc(ctx.shift)} · attempt ${esc(ctx.attempt)}</h1>
<p class="${r.ok ? 'good' : 'bad'}">${esc(verdict)}</p>
${r.mismatches.slice(1).map((m) => `<p class="bad">${esc(mismatchText(m))}</p>`).join('')}
<h2>Checks</h2>
<table><tr><th>Check</th><th>Result</th><th>Detail</th></tr>
${r.checks.map((c) => `<tr><td>${esc(c.name)}</td><td class="${c.ok ? 'good">pass' : 'bad">fail'}</td><td>${esc(c.detail)}</td></tr>`).join('\n')}</table>
<h2>Receipt</h2>
<p>Recomputed from the committed record: <code>${esc(r.receipt?.code ?? 'none')}</code> · attempted ${esc(r.receipt?.attempted ?? '–')} · answered ${esc(r.receipt?.answered ?? '–')} · marked ${esc(r.receipt?.marked ?? '–')}.
Cell countersignature: <code>${esc(sheet.receipt?.sig ?? 'none')}</code> (${esc(sheet.receipt?.cell ?? '')}).</p>
<h2>Sealed register</h2>
<p>STH: ${esc(sth.sth.size)} leaves · root <code>${esc(sth.sth.root)}</code> · prevSTH <code>${esc(sth.sth.prevSTH)}</code> · issued ${esc(new Date(sth.sth.ts).toISOString())}<br>
Authority signature <code>${esc(sth.sig)}</code><br>
This submission is leaf ${esc(index + 1)}; inclusion path: ${inclusion.map((h) => `<code>${esc(h)}</code>`).join(' ') || '(single leaf)'}</p>
<h2>Entries as recorded (${esc(sheet.entries.length)})</h2>
<table><tr><th>Seq</th><th>Kind</th><th>Question</th><th>Recorded state / answer</th><th>vs. seat's commitment</th><th>Seat signature (P-256, IEEE-P1363)</th></tr>
${rows}</table>
<h2>Audit findings</h2>
${p.findings.length ? `<ul>${p.findings.map((f) => `<li>entry ${esc(f.seq)} · ${esc(f.kind)}: ${esc(f.detail)}${f.recovered ? ` — recovered from ${esc(f.recovered.from)}: ${esc(f.recovered.value)}` : ''}</li>`).join('')}</ul>` : '<p>None.</p>'}
<p>Check it yourself: open <code>verify.html</code> (offline) and load <code>proof.json</code>.</p>`);
}

const DESCRIBE: Record<string, string> = {
  'proof.json': 'Official response sheet with signed entries, recorded bodies and salts; signed register head; inclusion proof',
  'sth.json': 'Signed register head (STH) of the sealed per-shift log',
  'audit.json': 'Audit findings for this candidate',
  'custody.jsonl': 'Chain-of-custody log up to this export',
  'report.html': 'Human-readable verification report',
  'verify.html': 'Offline verifier used to check the records',
  'README.txt': 'How to check this pack',
};

function certificateHtml(p: PackIn, hashes: Record<string, string>): string {
  const { ctx } = p.proof.sheet;
  const rows = Object.keys(DESCRIBE).filter((f) => hashes[f]).map((f) => `<tr><td><code>${esc(f)}</code></td><td>${esc(DESCRIBE[f])}</td><td><code>${esc(hashes[f])}</code></td></tr>`).join('\n');
  const blank = '<span class="blank">&nbsp;</span>';
  return page(`Certificate under Section 63 — ${ctx.cand}`, `
<h1>Certificate under Section 63(4)(c), Bharatiya Sakshya Adhiniyam, 2023</h1>
<p class="note">TEMPLATE generated by Saakshi on ${esc(new Date(p.now).toISOString())}. It must be completed, reviewed by counsel and signed by the responsible persons before use. It is not legal advice.</p>
<h2>Part A — to be completed by the party producing the electronic records</h2>
<p>I, ${blank} (name), ${blank} (designation), of ${blank} (organisation), state as follows:</p>
<ol>
<li>The electronic records listed below relate to candidate roll number ${esc(ctx.cand)}, examination ${esc(ctx.exam)}, shift ${esc(ctx.shift)}, attempt ${esc(ctx.attempt)}.</li>
<li>They were produced by the Saakshi examination system (seat application, centre relay, exam cell and control) running on computer systems under my lawful control, in the ordinary course of conducting the examination.</li>
<li>Throughout the material period these systems were operating properly, or any period in which they were not did not affect the accuracy of these records. Details, if any: ${blank}</li>
<li>Each record is identified below by its hash value, computed with the SHA-256 algorithm. Anyone can recompute these values to confirm that a copy is identical.</li>
<li>The chain of custody of the records is set out in <code>custody.jsonl</code>.</li>
</ol>
<table><tr><th>File</th><th>Description</th><th>SHA-256</th></tr>
${rows}</table>
<p>Signature: ${blank} &nbsp; Date: ${blank} &nbsp; Place: ${blank}</p>
<h2>Part B — to be completed by the expert</h2>
<p>I, ${blank} (name), ${blank} (designation and qualification), have examined the electronic records listed in Part A and state:</p>
<ol>
<li>I computed the SHA-256 hash value of each record and it matches the value in Part A: &#9744; yes &#9744; no. Details: ${blank}</li>
<li>I checked the records with the offline verifier supplied with them (<code>verify.html</code>). Its result: ${blank}</li>
</ol>
<p>Signature: ${blank} &nbsp; Date: ${blank} &nbsp; Place: ${blank}</p>`);
}

export async function buildPack(p: PackIn): Promise<Pack> {
  const { ctx } = p.proof.sheet;
  const name = `evidence-${ctx.exam}-${ctx.shift}-${ctx.cand}-${stamp(p.now)}`;
  const report = verifyProof(p.proof, p.forms, p.trust, undefined, verifier);
  const files: Record<string, string> = {
    'README.txt': readme(name),
    'proof.json': JSON.stringify(p.proof, null, 2) + '\n',
    'sth.json': JSON.stringify(p.proof.sth, null, 2) + '\n',
    'audit.json': JSON.stringify(p.findings, null, 2) + '\n',
    'custody.jsonl': p.custody.map((l) => `${l}\n`).join(''),
    'verify.html': p.verifyHtml,
  };
  files['report.html'] = reportHtml(p, report);
  files['certificate-s63.html'] = certificateHtml(p, Object.fromEntries(Object.entries(files).map(([f, c]) => [f, sha(c)])));
  files['manifest.sha256'] = Object.keys(files).sort().map((f) => `${sha(files[f])}  ${f}`).join('\n') + '\n';
  const tgz = await new Bun.Archive(Object.fromEntries(Object.entries(files).map(([f, c]) => [`${name}/${f}`, c])), { compress: 'gzip' }).bytes();
  return { name, files, tgz };
}
```
The certificate lists the hashes of every file except itself and the manifest. The manifest covers every file, including the certificate.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test --timeout 60000 apps/server/test/evidence.test.ts && pnpm --filter @saakshi/server typecheck`
Expected: PASS.

---

### Task 11: The control page — reconciliation row, seal, the rogue insider, audit, evidence, `/verify` link

**Files:**
- Create: `apps/server/src/control-view.ts` (pure), `apps/server/src/control.html`, `apps/server/src/control-page.ts`
- Test: `apps/server/test/control-view.test.ts`

**Interfaces:**
- Consumes: Task 1's `ReconRow` and `Finding`, and the control routes in Global Constraints. The page only calls those routes; Task 12 serves them.
- Produces:
  - `reconCells(r: ReconRow): { label: string; value: string; ok: boolean }[]`, in the column order of the page's table header
  - `findingText(f: Finding): string`
  - `headline(fs: Finding[]): string`: the first `body` finding's detail, else the first finding, else the all-clear sentence
  - `control.html`, which Task 12 serves as an HTML import at `/control`.
- The labelled chaos button reads **"Rogue insider edits an answer"** (plan §3.11), with a visible "DEV chaos" note.

- [ ] **Step 1: Write the failing tests**

`apps/server/test/control-view.test.ts`:
```ts
import { expect, test } from 'bun:test';
import type { Finding, ReconRow } from '@saakshi/core/sheet';
import { findingText, headline, reconCells } from '../src/control-view.ts';

const row: ReconRow = { centre: 'CEN-01', exam: 'DEMO-2026', shift: 'S1', registered: 8, checkedIn: 1, unlocked: 1, submitted: 1, receipts: 1, leaves: 1, headsEqual: true, headMismatches: [], green: true };

test('reconciliation cells: all ok when green; leaves behind receipts and head mismatches are flagged', () => {
  expect(reconCells(row).map((c) => [c.label, c.value, c.ok])).toEqual([
    ['Registered', '8', true], ['Checked in', '1', true], ['Unlocked', '1', true], ['Submitted', '1', true],
    ['Receipts', '1', true], ['Register leaves', '1', true], ['Relay = cell heads', 'all equal', true],
  ]);
  const bad = reconCells({ ...row, leaves: 0, headsEqual: false, headMismatches: ['C0001: relay 22 · cell 21'], green: false });
  expect(bad.filter((c) => !c.ok).map((c) => c.value)).toEqual(['0', 'C0001: relay 22 · cell 21']);
});

test('findings read as one line each; the headline prefers the altered answer', () => {
  const fs: Finding[] = [
    { cand: 'C0001', seq: 0, kind: 'count', detail: 'relay holds 22 entries, cell holds 21' },
    { cand: 'C0001', seq: 18, kind: 'body', detail: 'Q17: record says C — the seat committed B', recovered: { from: 'archive', value: 'B' } },
  ];
  expect(findingText(fs[1])).toBe('C0001 · entry 18 · body: Q17: record says C — the seat committed B → recovered from archive: B');
  expect(findingText(fs[0])).toBe('C0001 · whole chain · count: relay holds 22 entries, cell holds 21');
  expect(headline(fs)).toBe('Q17: record says C — the seat committed B');
  expect(headline([])).toBe('No tampering found: every record matches what the seats committed.');
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test apps/server/test/control-view.test.ts`
Expected: FAIL. `../src/control-view.ts` cannot be found.

- [ ] **Step 3: Write `control-view.ts`**

```ts
import type { Finding, ReconRow } from '@saakshi/core/sheet';

export interface ReconCell { label: string; value: string; ok: boolean }

/** One reconciliation row as table cells, in the page's column order. */
export function reconCells(r: ReconRow): ReconCell[] {
  return [
    { label: 'Registered', value: String(r.registered), ok: true },
    { label: 'Checked in', value: String(r.checkedIn), ok: r.checkedIn <= r.registered },
    { label: 'Unlocked', value: String(r.unlocked), ok: r.unlocked <= r.checkedIn },
    { label: 'Submitted', value: String(r.submitted), ok: r.submitted <= r.unlocked },
    { label: 'Receipts', value: String(r.receipts), ok: r.receipts === r.submitted },
    { label: 'Register leaves', value: String(r.leaves), ok: r.leaves === r.receipts },
    { label: 'Relay = cell heads', value: r.headsEqual ? 'all equal' : r.headMismatches.join('; '), ok: r.headsEqual },
  ];
}

export const findingText = (f: Finding): string =>
  `${f.cand} · ${f.seq ? `entry ${f.seq}` : 'whole chain'} · ${f.kind}: ${f.detail}` + (f.recovered ? ` → recovered from ${f.recovered.from}: ${f.recovered.value}` : '');

export function headline(fs: Finding[]): string {
  if (!fs.length) return 'No tampering found: every record matches what the seats committed.';
  return (fs.find((f) => f.kind === 'body') ?? { detail: findingText(fs[0]) }).detail;
}
```

- [ ] **Step 4: Write `control.html` and `control-page.ts`**

`apps/server/src/control.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Saakshi · Control</title>
    <style>
      :root { font-family: system-ui, sans-serif; color: #202124; background: #fff; }
      body { margin: 0; padding: 1rem 1.5rem 3rem; max-width: 72rem; }
      h1 { font-size: 1.75rem; margin: 0 0 1rem; } h2 { font-size: 1.25rem; margin: 1.5rem 0 .5rem; }
      table { border-collapse: collapse; width: 100%; font-variant-numeric: tabular-nums; }
      th, td { border: 1px solid #dadce0; padding: .375rem .5rem; text-align: left; }
      td.ok { background: #e6f4ea; } td.bad { background: #fce8e6; font-weight: 700; }
      .ok { color: #1e6b25; } .bad { color: #b3261e; }
      button { font: inherit; padding: .5rem 1rem; border-radius: .375rem; border: 1px solid #5f6368; background: #fff; cursor: pointer; min-height: 2.75rem; }
      button.primary { background: #1565c0; color: #fff; border-color: #1565c0; }
      button.chaos { background: #b3261e; color: #fff; border-color: #b3261e; }
      form { display: flex; flex-wrap: wrap; gap: .5rem; align-items: end; }
      label { display: grid; gap: .125rem; font-size: .875rem; }
      input, select { font: inherit; padding: .375rem; min-height: 2.25rem; }
      .out { font: .875rem ui-monospace, Menlo, monospace; white-space: pre-wrap; overflow-wrap: anywhere; margin: .5rem 0 0; }
      #audit-headline { font-size: 1.5rem; font-weight: 700; margin: .5rem 0; }
      .note { color: #5f6368; font-size: .875rem; }
      :focus-visible { outline: 3px solid #1565c0; outline-offset: 2px; }
    </style>
  </head>
  <body>
    <h1>Control · DEMO-2026 · S1</h1>

    <h2>Reconciliation (per centre-shift)</h2>
    <table>
      <thead><tr><th scope="col">Centre · shift</th><th scope="col">Registered</th><th scope="col">Checked in</th><th scope="col">Unlocked</th><th scope="col">Submitted</th><th scope="col">Receipts</th><th scope="col">Register leaves</th><th scope="col">Relay = cell heads</th></tr></thead>
      <tbody><tr id="recon-row"></tr></tbody>
    </table>
    <p id="recon-status" role="status">…</p>

    <h2>Sealed public register</h2>
    <button id="seal" class="primary">Seal the shift — publish the register head</button>
    <p id="seal-out" class="out" role="status"></p>

    <h2>Chaos</h2>
    <form id="rogue">
      <label>Candidate <input name="cand" value="C0001" size="7" /></label>
      <label>Question <input name="q" type="number" min="1" max="20" value="17" /></label>
      <label>New answer <select name="answer"><option>A</option><option>B</option><option selected>C</option><option>D</option></select></label>
      <button class="chaos">Rogue insider edits an answer</button>
    </form>
    <p class="note">DEV chaos: runs an UPDATE on the exam cell's database, as an insider with DB access would. The cell's terminal prints it.</p>
    <p id="rogue-out" class="out" role="status"></p>

    <h2>Audit</h2>
    <button id="audit" class="primary">Run the audit</button>
    <p id="audit-headline" role="status"></p>
    <ul id="audit-list"></ul>

    <h2>Evidence</h2>
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

`apps/server/src/control-page.ts`:
```ts
import type { SignedSth } from '@saakshi/core/log';
import type { Finding, ReconRow } from '@saakshi/core/sheet';
import { findingText, headline, reconCells } from './control-view.ts';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const say = (id: string, text: string, tone = '') => { const el = $(id); el.textContent = text; el.className = `out ${tone}`.trim(); };

async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const r = await fetch(path, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as { error?: string }).error ?? `HTTP ${r.status}`);
  return j as T;
}

async function recon(): Promise<void> {
  try {
    const r = await call<ReconRow>('GET', '/v1/recon');
    $('recon-row').replaceChildren(...[{ value: `${r.centre} · ${r.shift}`, ok: true }, ...reconCells(r)].map((c) => {
      const td = document.createElement('td'); td.textContent = c.value; td.className = c.ok ? 'ok' : 'bad'; return td;
    }));
    say('recon-status', r.green ? 'Green: every count and every head agrees.' : 'Not green: see the red cells.', r.green ? 'ok' : 'bad');
  } catch (e) { say('recon-status', `Cannot reconcile: ${(e as Error).message}`, 'bad'); }
}

$('seal').addEventListener('click', async () => {
  try {
    const r = await call<{ sth: SignedSth; added: string[]; skipped: { cand: string; reason: string }[] }>('POST', '/v1/seal');
    const s = r.sth.sth;
    say('seal-out', `Register head: ${s.size} leaves · root ${s.root.slice(0, 16)}… · ${new Date(s.ts).toLocaleTimeString()}`
      + (r.added.length ? ` · added ${r.added.join(', ')}` : ' · nothing new')
      + (r.skipped.length ? ` · not logged: ${r.skipped.map((x) => `${x.cand} (${x.reason})`).join(', ')}` : ''), 'ok');
    void recon();
  } catch (e) { say('seal-out', (e as Error).message, 'bad'); }
});

$('rogue').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const f = new FormData(ev.target as HTMLFormElement);
  try {
    const r = await call<{ sql: string; from: string; to: string; q: number }>('POST', '/v1/rogue', { cand: f.get('cand'), q: Number(f.get('q')), answer: f.get('answer') });
    say('rogue-out', `${r.sql}\n(Q${r.q}: ${r.from || 'no answer'} → ${r.to})`, 'bad');
  } catch (e) { say('rogue-out', (e as Error).message, 'bad'); }
});

$('audit').addEventListener('click', async () => {
  try {
    const r = await call<{ findings: Finding[] }>('POST', '/v1/audit');
    $('audit-headline').textContent = headline(r.findings);
    $('audit-headline').className = r.findings.length ? 'bad' : 'ok';
    $('audit-list').replaceChildren(...r.findings.map((x) => { const li = document.createElement('li'); li.textContent = findingText(x); return li; }));
  } catch (e) { $('audit-headline').textContent = (e as Error).message; }
});

$('ev-cand').addEventListener('input', () => { $<HTMLAnchorElement>('verify-link').href = `/verify?cand=${encodeURIComponent($<HTMLInputElement>('ev-cand').value)}`; });
$('evidence').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const cand = $<HTMLInputElement>('ev-cand').value;
  const r = await fetch(`/v1/evidence?cand=${encodeURIComponent(cand)}`);
  if (!r.ok) { say('evidence-out', ((await r.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${r.status}`, 'bad'); return; }
  const name = /filename="([^"]+)"/.exec(r.headers.get('content-disposition') ?? '')?.[1] ?? 'evidence.tar.gz';
  const a = document.createElement('a');
  a.href = URL.createObjectURL(await r.blob());
  a.download = name;
  a.click();
  say('evidence-out', `Downloaded ${name}. The same files are under data/control/evidence/.`, 'ok');
});

void recon();
setInterval(recon, 2000);
```
- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun test apps/server/test/control-view.test.ts && pnpm --filter @saakshi/server typecheck`
Expected: PASS.

---

### Task 12: `MODE=control`, cell routes and wiring — `control.ts`, `main.ts`, `serve.ts`

**Files:**
- Create: `apps/server/src/control.ts`
- Modify: `apps/server/src/serve.ts` (`ServeOpts.routes`, extra routes merged in before the built-ins)
- Modify: `apps/server/src/main.ts` (full replacement below)
- Test: `apps/server/test/control.test.ts`; `apps/server/test/main.test.ts` (append)

**Interfaces:**
- Consumes:
  - Task 6: `seal`, `proofFor`, `reconcile`.
  - Task 7: `audit`.
  - Task 8: `shiftExport`, `rogueEdit`, `RogueIn`.
  - Task 9: `verifyHtml`.
  - Task 10: `buildPack`.
  - Task 11: `control.html`.
  - Task 3: the cell options of `createIngest`.
  - Task 1: `devPseud`, `devRoster`, `DEV_CENTRE`, `trustFromKeys`, `formsOf`.
- Produces:
  - `interface ControlOpts { dir; authority: KeyPair; trust; forms; formOf; pseud; roster; centre; exam; shift; cellUrl; relayUrl; now? }`
  - `controlRoutes(o, page: HTMLBundle)`: a Bun `routes` object serving every control route in Global Constraints.
  - `ServeOpts.routes?: Record<string, Partial<Record<'GET' | 'POST', (req: Request) => Response | Promise<Response>>>>`
  - `MODE=control` in `main.ts`; the cell routes `/v1/shift` and `/v1/dev/rogue`; the cell ingest now gets `forms`, `formOf`, `pseud` and `cellId`.

- [ ] **Step 1: Write the failing tests**

`apps/server/test/control.test.ts` (it binds ports, so run it with the sandbox disabled):
```ts
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Database } from 'bun:sqlite';
import { hexToBytes } from '@saakshi/core/bytes';
import { cellKey, devForm, devPseud, devRoster, devSeatKey, trustFromKeys, type KeysFile } from '@saakshi/core/dev';
import { formsOf, type Finding, type Proof, type ReconRow } from '@saakshi/core/sheet';
import { mismatchText, verifyProof } from '@saakshi/core/verify';
import page from '../src/control.html';
import { controlRoutes } from '../src/control.ts';
import { createIngest, type Ingest } from '../src/ingest.ts';
import { rogueEdit, shiftExport } from '../src/sheet-export.ts';
import { openDb } from '../src/store.ts';
import { FORMS, SimSeat } from '../../../tools/sim-seat.ts';

const keys = JSON.parse(readFileSync(new URL('../../../fixtures/keys.json', import.meta.url), 'utf8')) as KeysFile;
const cell = cellKey(keys, 'cell-1');
const forms = formsOf(FORMS), trust = trustFromKeys(keys);
const dir = mkdtempSync(join(tmpdir(), 'saakshi-control-'));
let n: Ingest, db: Database, seat: SimSeat;
const relayHead = 22;                                              // = the seat's head
const servers: ReturnType<typeof Bun.serve>[] = [];
let C = '';
const nf = () => Response.json({ error: 'not found' }, { status: 404 });

beforeAll(async () => {
  ({ db } = openDb(join(dir, 'cell.db')));
  n = createIngest({ mode: 'cell', db, fresh: false, seatKey: devSeatKey(keys), cell, forms, formOf: devForm, pseud: devPseud });
  seat = new SimSeat(keys, 'C0001', cell.pub);
  seat.add(21); seat.submit();                                      // I17 answered C at seq 18
  await n.sync({ entries: seat.entries, streams: [{ ...seat.ctx, head: seat.head }] });
  const EX = { exam: 'DEMO-2026', shift: 'S1', cell: 'cell-1', formOf: devForm, pseud: devPseud, seatKey: devSeatKey(keys) };
  const cellSrv = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: nf, routes: {
    '/v1/shift': { GET: () => Response.json(shiftExport(db, EX)) },
    '/v1/dev/rogue': { POST: async (req) => Response.json(rogueEdit(db, await req.json())) },
  } });
  const relaySrv = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: nf, routes: {
    '/v1/heads': { GET: () => Response.json({ mode: 'relay', state: 'LIVE', streams: [{ ...seat.ctx, head: relayHead, cellHead: relayHead, senderHead: relayHead, seenAt: 1 }] }) },
  } });
  const ctl = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: nf, routes: controlRoutes({
    dir: join(dir, 'control'), authority: { priv: hexToBytes(keys.authority.priv), pub: hexToBytes(keys.authority.pub) }, trust, forms,
    formOf: devForm, pseud: devPseud, roster: devRoster(keys), centre: 'CEN-01', exam: 'DEMO-2026', shift: 'S1',
    cellUrl: `http://127.0.0.1:${cellSrv.port}`, relayUrl: `http://127.0.0.1:${relaySrv.port}`, now: () => Date.UTC(2026, 8, 27, 10, 30),
  }, page) });
  servers.push(cellSrv, relaySrv, ctl);
  C = `http://127.0.0.1:${ctl.port}`;
});
afterAll(() => { for (const s of servers) s.stop(true); n.close(); rmSync(dir, { recursive: true, force: true }); });

const get = async <T>(p: string) => { const r = await fetch(C + p); return { status: r.status, body: (await r.json()) as T }; };
const post = async <T>(p: string, body?: unknown) => { const r = await fetch(C + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: r.status, body: (await r.json()) as T }; };

test('Act 4 through the control routes: seal → green → rogue → audit locates → proof shows it → evidence exports', async () => {
  expect((await get('/v1/proof?cand=C0001')).status).toBe(404);                          // not sealed yet
  expect((await get<ReconRow>('/v1/recon')).body.green).toBe(false);                     // leaves 0

  const sealed = await post<{ sth: { sth: { size: number } }; added: string[] }>('/v1/seal');
  expect([sealed.body.sth.sth.size, sealed.body.added]).toEqual([1, ['C0001']]);
  expect(existsSync(join(dir, 'control', 'sth-DEMO-2026-S1.json'))).toBe(true);
  expect(existsSync(join(dir, 'control', 'archive', 'DEMO-2026-S1-1.json'))).toBe(true);
  expect((await get<ReconRow>('/v1/recon')).body).toMatchObject({ registered: 8, checkedIn: 1, unlocked: 1, submitted: 1, receipts: 1, leaves: 1, headsEqual: true, green: true });
  expect((await post<{ findings: Finding[] }>('/v1/audit')).body.findings).toEqual([]);

  const rogue = await post<{ seq: number; from: string; to: string; q: number; sql: string }>('/v1/rogue', { cand: 'C0001', q: 17, answer: 'B' });
  expect(rogue.body).toMatchObject({ seq: 18, from: 'C', to: 'B', q: 17 });
  const { findings } = (await post<{ findings: Finding[] }>('/v1/audit')).body;
  expect(findings).toEqual([{ cand: 'C0001', seq: 18, kind: 'body', detail: 'Q17: record says B — the seat committed C', recovered: { from: 'archive', value: 'C' } }]);
  expect((await get<ReconRow>('/v1/recon')).body.green).toBe(true);                      // counts are untouched by an edit

  const proof = (await get<Proof>('/v1/proof?cand=C0001')).body;
  expect(mismatchText(verifyProof(proof, forms, trust).mismatches[0])).toBe('Q17: record says B — the seat committed C');

  const ev = await fetch(`${C}/v1/evidence?cand=C0001`);
  expect(ev.headers.get('content-type')).toBe('application/gzip');
  expect(ev.headers.get('content-disposition')).toBe('attachment; filename="evidence-DEMO-2026-S1-C0001-20260927T103000Z.tar.gz"');
  const files = await new Bun.Archive(new Uint8Array(await ev.arrayBuffer())).files();
  expect(await files.get('evidence-DEMO-2026-S1-C0001-20260927T103000Z/report.html')!.text()).toContain('Q17: record says B — the seat committed C');
  expect(existsSync(join(dir, 'control', 'evidence', 'evidence-DEMO-2026-S1-C0001-20260927T103000Z', 'manifest.sha256'))).toBe(true);
  const custody = readFileSync(join(dir, 'control', 'custody.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l).action);
  expect(custody).toEqual(['seal', 'audit', 'rogue-simulated', 'audit', 'evidence-export']);

  const v = await fetch(`${C}/verify`);
  expect(v.headers.get('content-type')).toBe('text/html; charset=utf-8');
  expect(await v.text()).toContain('Saakshi · Verify');
  expect((await fetch(`${C}/control`)).status).toBe(200);
});

test('bad input is 400, an unreachable cell or relay is 502', async () => {
  expect((await get('/v1/proof?cand=C9999')).status).toBe(400);
  expect((await post('/v1/rogue', { cand: 'C0001', q: 99, answer: 'B' })).status).toBe(400);
  expect((await post('/v1/rogue', { cand: 'C0001', q: 1, answer: 'Z' })).status).toBe(400);
  servers[1].stop(true);                                            // the relay goes away
  const r = await get<{ error: string }>('/v1/recon');
  expect(r.status).toBe(502);
  expect(r.body.error).toContain('unreachable');
});
```
Append to `apps/server/test/main.test.ts`:
```ts
test('control boots with DEV=1, prints READY, serves /control and reports an unreachable cell as 502', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'saakshi-main-'));
  const p = Bun.spawn(['bun', MAIN], { cwd: dir, stdout: 'pipe', stderr: 'pipe', env: { ...process.env, MODE: 'control', DEV: '1', PORT: '0', DIR: join(dir, 'control'), CELL_URL: 'http://127.0.0.1:9', RELAY_URL: 'http://127.0.0.1:9' } });
  try {
    const r = await ready(p.stdout);
    expect(r).toMatchObject({ mode: 'control', state: 'LIVE' });
    expect(await (await fetch(`http://127.0.0.1:${r.port}/control`)).text()).toContain('Rogue insider edits an answer');
    expect((await fetch(`http://127.0.0.1:${r.port}/v1/recon`)).status).toBe(502);
  } finally { p.kill(); await p.exited; rmSync(dir, { recursive: true, force: true }); }
});

test('a cell serves its response sheets at /v1/shift (400 without exam and shift)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'saakshi-main-'));
  const p = Bun.spawn(['bun', MAIN], { cwd: dir, stdout: 'pipe', stderr: 'pipe', env: { ...process.env, MODE: 'cell', DEV: '1', PORT: '0', DB: join(dir, 'c.db') } });
  try {
    const { port } = await ready(p.stdout);
    expect((await fetch(`http://127.0.0.1:${port}/v1/shift`)).status).toBe(400);
    expect(await (await fetch(`http://127.0.0.1:${port}/v1/shift?exam=DEMO-2026&shift=S1`)).json()).toEqual({ cell: 'cell-1', exam: 'DEMO-2026', shift: 'S1', sheets: [] });
  } finally { p.kill(); await p.exited; rmSync(dir, { recursive: true, force: true }); }
});
```

- [ ] **Step 2: Run them to verify they fail**

Run (sandbox disabled): `bun test --timeout 60000 apps/server/test/control.test.ts apps/server/test/main.test.ts`
Expected: FAIL. `../src/control.ts` cannot be found, and `MODE must be cell or relay`.

- [ ] **Step 3: Write `apps/server/src/control.ts`**

```ts
// MODE=control (Stage 2 minimum): seal the shift, audit, reconcile, the DEV rogue button, proofs, evidence packs, /verify.
// State is plain files under o.dir (see the plan's Global Constraints). The witness (S6) and the second archive store (Stage 4) come later.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type { HTMLBundle } from 'bun';
import type { KeyPair } from '@saakshi/core/node';
import type { Finding, Forms, Proof, ShiftExport, SthRecord, Trust } from '@saakshi/core/sheet';
import type { HeadsRes } from '@saakshi/core/wire';
import { audit } from './audit.ts';
import { buildPack } from './evidence.ts';
import { reconcile } from './recon.ts';
import { proofFor, seal } from './seal.ts';
import { verifyHtml } from './verify-build.ts';

export interface ControlOpts {
  dir: string; authority: KeyPair; trust: Trust; forms: Forms;
  formOf: (cand: string) => string | undefined; pseud: (cand: string) => string;
  roster: string[]; centre: string; exam: string; shift: string;
  cellUrl: string; relayUrl: string; now?: () => number;
}

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
const json = (body: unknown, status = 200) => Response.json(body, { status });
const sha = (s: string | Uint8Array) => createHash('sha256').update(s).digest('hex');

export function controlRoutes(o: ControlOpts, page: HTMLBundle) {
  const now = o.now ?? Date.now;
  const tag = `${o.exam}-${o.shift}`;
  mkdirSync(join(o.dir, 'archive'), { recursive: true });
  mkdirSync(join(o.dir, 'evidence'), { recursive: true });
  const recPath = join(o.dir, `sth-${tag}.json`), custodyPath = join(o.dir, 'custody.jsonl');
  const archivePath = (size: number) => join(o.dir, 'archive', `${tag}-${size}.json`);
  const readJson = <T>(p: string): T | undefined => (existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as T) : undefined);
  const readRec = () => readJson<SthRecord>(recPath);
  const readArchive = (rec?: SthRecord) => { const size = rec?.sths.at(-1)?.sth.size; return size === undefined ? undefined : readJson<ShiftExport>(archivePath(size)); };
  const custody = (action: string, detail: Record<string, unknown>) =>
    appendFileSync(custodyPath, JSON.stringify({ at: new Date(now()).toISOString(), actor: 'control (DEV)', action, exam: o.exam, shift: o.shift, ...detail }) + '\n');
  const custodyLines = () => (existsSync(custodyPath) ? readFileSync(custodyPath, 'utf8').split('\n').filter(Boolean) : []);

  async function upstream<T>(url: string, init?: RequestInit): Promise<T> {
    let r: Response;
    try { r = await fetch(url, { ...init, signal: AbortSignal.timeout(5000) }); }
    catch (e) { throw new HttpError(502, `${new URL(url).origin} unreachable: ${(e as Error).message}`); }
    if (!r.ok) throw new HttpError(502, `${new URL(url).pathname} answered ${r.status}: ${await r.text()}`);
    return (await r.json()) as T;
  }
  const cellExport = () => upstream<ShiftExport>(`${o.cellUrl}/v1/shift?exam=${encodeURIComponent(o.exam)}&shift=${encodeURIComponent(o.shift)}`);
  const relayHeads = () => upstream<HeadsRes>(`${o.relayUrl}/v1/heads`);
  const handle = (fn: (req: Request) => Promise<Response>) => async (req: Request): Promise<Response> => {
    try { return await fn(req); } catch (e) { return json({ error: (e as Error).message }, e instanceof HttpError ? e.status : 500); }
  };
  const candOf = (req: Request): string => {
    const c = new URL(req.url).searchParams.get('cand') ?? '';
    if (!o.roster.includes(c)) throw new HttpError(400, `unknown candidate ${c || '(none)'}`);
    return c;
  };
  async function findings(): Promise<Finding[]> {
    const rec = readRec();
    const [cell, relay] = await Promise.all([cellExport(), relayHeads()]);
    return audit({ cell, relay, archive: readArchive(rec), rec, trust: o.trust, forms: o.forms });
  }
  async function proof(cand: string): Promise<Proof> {
    const rec = readRec();
    const sheet = (await cellExport()).sheets.find((s) => s.ctx.cand === cand);
    const p = rec && sheet ? proofFor(rec, sheet) : undefined;
    if (!p) throw new HttpError(404, `${cand} is not in the sealed register yet — seal the shift first`);
    return p;
  }

  return {
    '/control': page,
    '/verify': { GET: handle(async () => new Response(await verifyHtml(), { headers: { 'content-type': 'text/html; charset=utf-8' } })) },
    '/v1/recon': { GET: handle(async () => {
      const [cell, relay] = await Promise.all([cellExport(), relayHeads()]);
      return json(reconcile({ centre: o.centre, exam: o.exam, shift: o.shift, roster: o.roster, relay, cell, rec: readRec() }));
    }) },
    '/v1/seal': { POST: handle(async () => {
      const exp = await cellExport();
      const before = readRec();
      const r = seal(before, exp, { authority: o.authority, trust: o.trust, pseud: o.pseud, now });
      const signed = r.rec.sths.at(-1)!;
      if (r.rec !== before) {
        writeFileSync(recPath, JSON.stringify(r.rec, null, 2));
        writeFileSync(archivePath(signed.sth.size), JSON.stringify(exp));
        custody('seal', { size: signed.sth.size, root: signed.sth.root, added: r.added, skipped: r.skipped });
      }
      return json({ sth: signed, added: r.added, skipped: r.skipped });
    }) },
    '/v1/audit': { POST: handle(async () => {
      const f = await findings();
      custody('audit', { findings: f.length, sha256: sha(JSON.stringify(f)) });
      return json({ at: now(), findings: f });
    }) },
    '/v1/rogue': { POST: handle(async (req) => {
      const b = (await req.json().catch(() => ({}))) as { cand?: unknown; q?: unknown; answer?: unknown };
      const cand = typeof b.cand === 'string' ? b.cand : '';
      const items = o.forms[o.formOf(cand) ?? ''];
      const q = b.q as number;
      if (!o.roster.includes(cand) || !items || !Number.isSafeInteger(q) || q < 1 || q > items.length || !['A', 'B', 'C', 'D'].includes(b.answer as string))
        throw new HttpError(400, 'need {cand, q: 1…n, answer: A|B|C|D}');
      const out = await upstream<Record<string, unknown>>(`${o.cellUrl}/v1/dev/rogue`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ exam: o.exam, shift: o.shift, attempt: 1, cand, item: items[q - 1], answer: b.answer }),
      });
      custody('rogue-simulated', { cand, item: items[q - 1], note: 'DEV chaos button: an insider edit, simulated on purpose' });
      return json({ ...out, q });
    }) },
    '/v1/proof': { GET: handle(async (req) => json(await proof(candOf(req)))) },
    '/v1/evidence': { GET: handle(async (req) => {
      const cand = candOf(req);
      const p = await proof(cand);
      const mine = (await findings()).filter((f) => f.cand === cand);
      const pack = await buildPack({ proof: p, findings: mine, custody: custodyLines(), verifyHtml: await verifyHtml(), forms: o.forms, trust: o.trust, now: now() });
      const out = join(o.dir, 'evidence', pack.name);
      mkdirSync(out, { recursive: true });
      for (const [f, c] of Object.entries(pack.files)) writeFileSync(join(out, f), c);
      writeFileSync(`${out}.tar.gz`, pack.tgz);
      custody('evidence-export', { cand, name: pack.name, manifestSha256: sha(pack.files['manifest.sha256']), tgzSha256: sha(pack.tgz) });
      return new Response(pack.tgz, { headers: { 'content-type': 'application/gzip', 'content-disposition': `attachment; filename="${pack.name}.tar.gz"` } });
    }) },
  };
}
```
The evidence export runs its own audit but logs only `evidence-export`, not `audit`. The custody order the test expects is therefore `seal, audit, rogue-simulated, audit, evidence-export`.

- [ ] **Step 4: Extra routes in `serve.ts`**

```ts
type Handler = (req: Request) => Response | Promise<Response>;
export interface ServeOpts {
  port: number; hostname?: string; idleTimeout?: number; consoleHtml?: HTMLBundle;
  /** Mode-specific routes (cell: /v1/shift, /v1/dev/rogue). The built-in routes win on a clash. */
  routes?: Record<string, Partial<Record<'GET' | 'POST', Handler>>>;
}
```
In `serve()`, change `routes: {` to `routes: { ...o.routes,`. Nothing else in `serve.ts` changes.

- [ ] **Step 5: Replace `apps/server/src/main.ts`**

```ts
// Saakshi server: MODE=relay|cell|control. DEV=1 until Stage 3 (fixture keys and roster, no enrolment).
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { hexToBytes } from '@saakshi/core/bytes';
import { cellKey, DEV_CENTRE, DEV_EXAM, devForm, devPseud, devRoster, devSeat, devSeatKey, trustFromKeys, type KeysFile } from '@saakshi/core/dev';
import { formsOf } from '@saakshi/core/sheet';
import consoleHtml from './console.html';
import controlHtml from './control.html';
import { controlRoutes } from './control.ts';
import { Forwarder, httpCellSend } from './forward.ts';
import { createIngest } from './ingest.ts';
import { heads, serve } from './serve.ts';
import { rogueEdit, type RogueIn, shiftExport } from './sheet-export.ts';
import { Hub } from './sse.ts';
import { openDb, pragmas } from './store.ts';

const env = process.env;
const mode = env.MODE;
if (mode !== 'cell' && mode !== 'relay' && mode !== 'control') { console.error('MODE must be cell, relay or control'); process.exit(2); }
if (env.DEV !== '1') { console.error('Saakshi trusts the fixture keys only with DEV=1 (enrolment arrives in Stage 3)'); process.exit(2); }

const fixtures = resolve(import.meta.dir, '../../../fixtures');
const keys = (await Bun.file(env.KEYS ?? `${fixtures}/keys.json`).json()) as KeysFile;
const forms = formsOf(await Bun.file(env.FORMS ?? `${fixtures}/paper/forms.json`).json());
const formOf = (cand: string) => (devSeat(keys, cand) ? devForm(cand) : undefined);
const json = (body: unknown, status = 200) => Response.json(body, { status });

if (mode === 'control') {
  const server = Bun.serve({
    port: Number(env.PORT ?? 7090),
    hostname: env.HOST ?? '127.0.0.1',
    routes: controlRoutes({
      dir: resolve(env.DIR ?? 'data/control'),
      authority: { priv: hexToBytes(keys.authority.priv), pub: hexToBytes(keys.authority.pub) },
      trust: trustFromKeys(keys), forms, formOf, pseud: devPseud, roster: devRoster(keys), centre: DEV_CENTRE,
      exam: DEV_EXAM.exam, shift: DEV_EXAM.shift,
      cellUrl: env.CELL_URL ?? 'http://127.0.0.1:7080', relayUrl: env.RELAY_URL ?? 'http://127.0.0.1:7070',
    }, controlHtml),
    fetch: () => json({ error: 'not found' }, 404),
  });
  console.log(`READY ${JSON.stringify({ mode, port: server.port, state: 'LIVE' })}`);
  const stop = () => { server.stop(true); process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
} else {
  const cell = cellKey(keys, env.CELL_ID ?? 'cell-1');          // the key lives in the keys file, never in the DB
  const dbPath = resolve(env.DB ?? `data/${mode}.db`);
  mkdirSync(dirname(dbPath), { recursive: true });
  const { db, fresh } = openDb(dbPath);
  const p = pragmas(db);
  if (p.journal_mode !== 'wal' || p.synchronous !== 2 || (process.platform === 'darwin' && p.fullfsync !== 1)) {
    console.error('durability pragmas did not apply (try Database.setCustomSQLite with Homebrew sqlite)', p);
    process.exit(3);
  }

  let hub: Hub | undefined;
  const ingest = createIngest({
    mode, db, fresh,
    seatKey: devSeatKey(keys),
    cell: mode === 'cell' ? cell : { pub: cell.pub },
    rebuildRelays: Number(env.REBUILD_RELAYS ?? 1),
    forms, formOf, pseud: devPseud, cellId: cell.id,
    onView: (v) => hub?.publish('stream', v),
    onState: (s) => hub?.publish('state', { state: s }),
  });
  hub = new Hub(() => heads(ingest));
  const cellRoutes = mode === 'cell' ? {
    '/v1/shift': { GET: (req: Request) => {
      const u = new URL(req.url), exam = u.searchParams.get('exam'), shift = u.searchParams.get('shift');
      if (!exam || !shift) return json({ error: 'need ?exam=&shift=' }, 400);
      return json(shiftExport(db, { exam, shift, cell: cell.id, formOf, pseud: devPseud, seatKey: devSeatKey(keys) }));
    } },
    // DEV chaos only — the "rogue insider" button. Prints the SQL so the cell's terminal shows the edit.
    '/v1/dev/rogue': { POST: async (req: Request) => {
      const b = (await req.json().catch(() => null)) as RogueIn | null;
      if (!b || typeof b.exam !== 'string' || typeof b.shift !== 'string' || !Number.isSafeInteger(b.attempt) || typeof b.cand !== 'string'
        || typeof b.item !== 'string' || !['A', 'B', 'C', 'D'].includes(b.answer)) return json({ error: 'need {exam, shift, attempt, cand, item, answer}' }, 400);
      try { const r = rogueEdit(db, b); console.log(`ROGUE ${r.sql}`); return json(r); }
      catch (e) { return json({ error: (e as Error).message }, 404); }
    } },
  } : undefined;
  const server = serve(ingest, hub, {
    port: Number(env.PORT ?? (mode === 'relay' ? 7070 : 7080)),
    hostname: env.HOST ?? (mode === 'relay' ? '0.0.0.0' : '127.0.0.1'),
    consoleHtml: mode === 'relay' ? consoleHtml : undefined,
    routes: cellRoutes,
  });
  const fwd = mode === 'relay' ? new Forwarder(ingest, httpCellSend(env.CELL_URL ?? 'http://127.0.0.1:7080')) : undefined;
  fwd?.start();

  console.log(`READY ${JSON.stringify({ mode, port: server.port, state: ingest.state(), db: dbPath, pragmas: p })}`);

  const stop = async () => { await fwd?.stop(); server.stop(true); ingest.close(); process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
```

- [ ] **Step 6: Run the server suite, the kill test and the typecheck** (sandbox disabled)

Run: `bun test --timeout 60000 apps/server && bun tools/chaos-kill.ts && pnpm --filter @saakshi/server typecheck`
Expected: every test PASSes, including all Stage 1 tests; the kill test prints `PASS`; the typecheck exits 0.

---

### Task 13: Tamper suite at the database level (the exit check)

**Files:**
- Create: `apps/server/test/tamper.test.ts`

**Interfaces:**
- Consumes:
  - Task 3: `createIngest` with the cell options, and `openDb`.
  - Task 8: `shiftExport`, `rogueEdit`.
  - Task 6: `seal`, `proofFor`, `reconcile`.
  - Task 7: `audit`.
  - Task 2: `verifyProof`, `mismatchText`.
- Produces: one test per kind of tampering, each made with **real SQL against a real cell DB**:
  - an edited answer;
  - a deleted row;
  - a truncated chain;
  - a changed signature;
  - an edited header;
  - the submit and receipt deleted before the seal;
  - plus the honest control case.
- No ports are used, so this runs inside the sandbox.

- [ ] **Step 1: Write the test**

`apps/server/test/tamper.test.ts`:
```ts
import { afterEach, beforeEach, expect, test } from 'bun:test';
import type { Database } from 'bun:sqlite';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hexToBytes } from '@saakshi/core/bytes';
import { canon, parseCanon, type Canon } from '@saakshi/core/canon';
import { cellKey, devForm, devPseud, devRoster, devSeatKey, trustFromKeys, type KeysFile } from '@saakshi/core/dev';
import { verifier } from '@saakshi/core/node';
import { formsOf, type ShiftExport, type SthRecord } from '@saakshi/core/sheet';
import { mismatchText, verifyProof } from '@saakshi/core/verify';
import type { HeadsRes } from '@saakshi/core/wire';
import { audit } from '../src/audit.ts';
import { createIngest, type Ingest } from '../src/ingest.ts';
import { reconcile } from '../src/recon.ts';
import { proofFor, seal } from '../src/seal.ts';
import { rogueEdit, shiftExport } from '../src/sheet-export.ts';
import { openDb } from '../src/store.ts';
import { FORMS, SimSeat } from '../../../tools/sim-seat.ts';

const keys = JSON.parse(readFileSync(new URL('../../../fixtures/keys.json', import.meta.url), 'utf8')) as KeysFile;
const cell = cellKey(keys, 'cell-1');
const forms = formsOf(FORMS), trust = trustFromKeys(keys);
const authority = { priv: hexToBytes(keys.authority.priv), pub: hexToBytes(keys.authority.pub) };
const EX = { exam: 'DEMO-2026', shift: 'S1', cell: 'cell-1', formOf: devForm, pseud: devPseud, seatKey: devSeatKey(keys) };
const WHERE = "exam = 'DEMO-2026' AND shift = 'S1' AND attempt = 1 AND cand = 'C0001'";
let dir: string, n: Ingest, db: Database;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'saakshi-tamper-')); ({ db } = openDb(join(dir, 'cell.db'))); n = createIngest({ mode: 'cell', db, fresh: false, seatKey: devSeatKey(keys), cell, forms, formOf: devForm, pseud: devPseud }); });
afterEach(() => { n.close(); rmSync(dir, { recursive: true, force: true }); });

/** C0001 and C0002 each answer all 20 items and submit (22 entries); the shift is sealed and archived; the relay agrees. */
async function sealedShift(sealIt = true) {
  const seats = ['C0001', 'C0002'].map((c) => { const s = new SimSeat(keys, c, cell.pub); s.add(21); s.submit(); return s; });
  for (const s of seats) {
    const r = await n.sync({ entries: s.entries, streams: [{ ...s.ctx, head: s.head }] });
    if (r === 'REBUILDING' || r.rejected.length) throw new Error(JSON.stringify(r));
  }
  const relay: HeadsRes = { mode: 'relay', state: 'LIVE', streams: seats.map((s) => ({ ...s.ctx, head: s.head, cellHead: s.head, senderHead: s.head, seenAt: 1 })) };
  const archive: ShiftExport | undefined = sealIt ? shiftExport(db, EX) : undefined;
  const rec: SthRecord | undefined = archive && seal(undefined, archive, { authority, trust, pseud: devPseud }).rec;
  return () => {
    const cur = shiftExport(db, EX);
    const findings = audit({ cell: cur, relay, archive, rec, trust, forms });
    const recon = reconcile({ centre: 'CEN-01', exam: 'DEMO-2026', shift: 'S1', roster: devRoster(keys), relay, cell: cur, rec });
    const sheet = cur.sheets.find((s) => s.ctx.cand === 'C0001');
    const proof = rec && sheet ? proofFor(rec, sheet) : undefined;
    return { findings, recon, verified: proof && verifyProof(proof, forms, trust, undefined, verifier) };
  };
}
const kinds = (fs: { kind: string; seq: number }[]) => fs.map((f) => [f.kind, f.seq]);
const lineAt = (seq: number) => (db.query(`SELECT line FROM entries WHERE ${WHERE} AND seq = ?`).get(seq) as { line: string }).line;
const setLine = (seq: number, line: string) => db.query(`UPDATE entries SET line = ? WHERE ${WHERE} AND seq = ?`).run(line, seq);
/** What the insider runs: remove rows of C0001 from one table. */
const drop = (table: string, cond: string) => db.run(`DELETE FROM ${table} WHERE ${WHERE}${cond}`);

test('an honest DB: no findings, reconciliation green, every proof verifies', async () => {
  const check = await sealedShift();
  const { findings, recon, verified } = check();
  expect(findings).toEqual([]);
  expect(recon.green).toBe(true);
  expect(verified!.ok).toBe(true);
});

test('edit: an answer rewritten in the cell DB is located, recovered from the archive, and verification names it', async () => {
  const check = await sealedShift();
  rogueEdit(db, { exam: 'DEMO-2026', shift: 'S1', attempt: 1, cand: 'C0001', item: 'I17', answer: 'B' });   // the seat committed C
  const { findings, recon, verified } = check();
  expect(findings).toEqual([{ cand: 'C0001', seq: 18, kind: 'body', detail: 'Q17: record says B — the seat committed C', recovered: { from: 'archive', value: 'C' } }]);
  expect(recon.green).toBe(true);
  expect(verified!.ok).toBe(false);
  expect(mismatchText(verified!.mismatches[0])).toBe('Q17: record says B — the seat committed C');
});

test('deleted row: located at its seq, restored from the archive; relay count and reconciliation disagree', async () => {
  const check = await sealedShift();
  drop('entries', ' AND seq = 5');
  drop('bodies', ' AND seq = 5');
  const { findings, recon } = check();
  expect(kinds(findings)).toEqual([['count', 0], ['count', 0], ['chain', 5]]);
  expect(findings[2].recovered).toEqual({ from: 'archive', value: 'seq 5 restored from the sealed archive' });
  expect(recon.headMismatches).toEqual(['C0001: relay 22 · cell 21']);
  expect(recon.green).toBe(false);
});

test('truncated chain: rows from seq 20 on (with the submit and its receipt) removed — the register\'s leaf catches it', async () => {
  const check = await sealedShift();
  drop('entries', ' AND seq >= 20');
  drop('bodies', ' AND seq >= 20');
  drop('receipts', '');
  const { findings, recon, verified } = check();
  expect(kinds(findings)).toEqual([['count', 0], ['count', 0], ['truncated', 19]]);
  expect(findings[2].recovered).toEqual({ from: 'archive', value: 'entries 20–22 restored from the sealed archive' });
  expect(recon.green).toBe(false);
  expect(verified!.checks.find((c) => c.name === 'inclusion')!.ok).toBe(false);
});

test('changed signature: located at its seq', async () => {
  const check = await sealedShift();
  setLine(7, lineAt(7).replace(/"([0-9a-f]{127})([0-9a-f])"\]$/, (_m, a, z) => `"${a}${z === '0' ? '1' : '0'}"]`));
  const { findings, verified } = check();
  expect(kinds(findings)).toEqual([['chain', 7]]);
  expect(findings[0].detail).toStartWith('entry 7: sig');
  expect(findings[0].recovered?.from).toBe('archive');
  expect(verified!.checks.find((c) => c.name === 'chain')!.ok).toBe(false);
});

test('edited header (activeMs changed, re-encoded canonically): located at its seq', async () => {
  const check = await sealedShift();
  const a = parseCanon(lineAt(9));
  (a[1] as Canon[])[11] = ((a[1] as Canon[])[11] as number) + 1;
  setLine(9, canon(a));
  expect(kinds(check().findings)).toEqual([['chain', 9]]);
});

test('before any seal, removing the submit and its receipt is still caught by the relay count', async () => {
  const check = await sealedShift(false);
  drop('entries', ' AND seq = 22');
  drop('bodies', ' AND seq = 22');
  drop('receipts', '');
  expect(check().findings).toEqual([{ cand: 'C0001', seq: 0, kind: 'count', detail: 'relay holds 22 entries, cell holds 21' }]);
});
```

- [ ] **Step 2: Run it**

Run: `bun test --timeout 60000 apps/server/test/tamper.test.ts`
Expected: PASS. This is the exit check's "tests catch every kind of tampering". If a case fails, fix the module that owns the behaviour (Tasks 3, 6, 7 or 8). Never loosen the test.

---

### Task 14: Act 4 end to end — `tools/act4.ts` — and CI

**Files:**
- Create: `tools/act4.ts`
- Modify: `.github/workflows/server.yml`

**Interfaces:**
- Consumes:
  - The real seat code: `ExamSession` (Task 4), `SeatSync` and `httpSend` (Stage 1).
  - The real server binary in all three modes (Task 12).
  - Task 2: `verifyProof`, `mismatchText`.
- Produces:
  - `bun tools/act4.ts` prints the seat's slip line, then one line per stage, then `PASS`. It exits non-zero on the first failure.
  - It pins Review Focus #1 end to end: the real `ExamSession` on form F2, with visits, re-answers, a clear and marks, goes through relay → cell, and the seat's code must equal the cell's countersigned code.
  - CI runs it on macOS.

- [ ] **Step 1: Write `tools/act4.ts`**

```ts
// Stage 2 end-to-end (Act 4) on real processes: the real seat session → relay → cell; submit; seal; the rogue insider;
// audit; /verify's logic on the served proof; the evidence pack. Needs local ports (run it unsandboxed).
//   bun tools/act4.ts
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { cellKey, DEV_EXAM, devForm, devPseud, devSeat, trustFromKeys, type KeysFile } from '../packages/core/src/dev.ts';
import { verifier } from '../packages/core/src/node.ts';
import { formsOf, type Finding, type Proof, type ReconRow, type ShiftExport } from '../packages/core/src/sheet.ts';
import { mismatchText, verifyProof } from '../packages/core/src/verify.ts';
import { ExamSession } from '../apps/seat/src/main/exam.ts';
import type { Wrapper } from '../apps/seat/src/main/journal-store.ts';
import { httpSend, SeatSync } from '../apps/seat/src/main/sync.ts';

const root = resolve(import.meta.dir, '..');
const keys = JSON.parse(readFileSync(join(root, 'fixtures/keys.json'), 'utf8')) as KeysFile;
const forms = formsOf(JSON.parse(readFileSync(join(root, 'fixtures/paper/forms.json'), 'utf8')));
const cell = cellKey(keys, 'cell-1');
const dir = mkdtempSync(join(tmpdir(), 'saakshi-act4-'));
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

const [cellPort, relayPort, controlPort] = [freePort(), freePort(), freePort()];
const cellP = await spawnServer({ MODE: 'cell', PORT: String(cellPort), DB: join(dir, 'cell.db') });
const relayP = await spawnServer({ MODE: 'relay', PORT: String(relayPort), HOST: '127.0.0.1', DB: join(dir, 'relay.db'), CELL_URL: `http://127.0.0.1:${cellPort}` });
const controlP = await spawnServer({ MODE: 'control', PORT: String(controlPort), DIR: join(dir, 'control'), CELL_URL: `http://127.0.0.1:${cellPort}`, RELAY_URL: `http://127.0.0.1:${relayPort}` });
const C = `http://127.0.0.1:${controlPort}`;
let exam: ExamSession | undefined;

try {
  // 1. The real seat session: C0002 sits form F2 (reversed order, so Q17 is I04).
  const cand = 'C0002', form = devForm(cand), items = forms[form];
  const wrap: Wrapper = { encryptString: (s) => Buffer.from(s), decryptString: (b) => b.toString() };
  let t = 0;
  exam = new ExamSession({ dir: join(dir, 'seat'), ctx: { ...DEV_EXAM, cand }, keyEpoch: 1, seat: devSeat(keys, cand)!, cellPub: cell.pub, wrap, durationMs: 30 * 60_000, items, form, pseud: devPseud(cand), clock: () => t });
  const sync = new SeatSync(exam, httpSend(`http://127.0.0.1:${relayPort}`), verifier(cell.pub));
  exam.start();
  const q = (n: number) => items[n - 1];
  const act = (kind: 'answer' | 'mark' | 'clear', n: number, state: 'A' | 'NA' | 'MR' | 'AMR', answer: string) => {
    t += 5_000;
    const r = exam!.act({ kind, item: q(n), state, answer, dwellMs: 5_000 });
    if (!r.ok) fail(`act ${kind} Q${n}: ${r.error}`);
  };
  act('clear', 1, 'NA', ''); act('answer', 1, 'A', 'D');                       // visit, then answer
  act('clear', 2, 'NA', ''); act('answer', 2, 'A', 'A'); act('answer', 2, 'A', 'C'); // re-answer: last wins
  act('mark', 3, 'MR', '');
  act('mark', 4, 'AMR', 'B');
  act('answer', 5, 'A', 'B'); act('clear', 5, 'NA', '');                       // answered, then cleared
  act('clear', 17, 'NA', ''); act('answer', 17, 'A', 'B');                     // Q17 = B
  const sub = exam.submit();
  if (!sub.ok) fail(sub.error);
  const slip = sub.receipt;
  console.log(`seat slip: ${slip.code} · attempted ${slip.attempted} · answered ${slip.answered} · marked ${slip.marked} of ${slip.total}`);
  if (slip.attempted !== 6 || slip.answered !== 4 || slip.marked !== 2 || slip.total !== 20) fail('slip counts are wrong');

  // 2. Sync until the cell has acknowledged the submit (blue ✓✓ on the last entry).
  const deadline = Date.now() + 20_000;
  while (sync.view().cell < exam.head()) {
    if (Date.now() > deadline) fail(`the cell never acknowledged the submit: ${JSON.stringify(sync.view())}`);
    await sync.round();
    await Bun.sleep(100);
  }
  const cellSheet = (await call<ShiftExport>(`http://127.0.0.1:${cellPort}/v1/shift?exam=DEMO-2026&shift=S1`)).sheets.find((s) => s.ctx.cand === cand);
  if (cellSheet?.receipt?.code !== slip.code) fail(`seat slip code ${slip.code} ≠ cell countersigned code ${cellSheet?.receipt?.code}`);
  step('seat slip code equals the cell\'s countersigned code');

  // 3. Seal → reconciliation green.
  await call(`${C}/v1/seal`, 'POST');
  const recon = await call<ReconRow>(`${C}/v1/recon`);
  if (!recon.green) fail(`reconciliation is not green: ${JSON.stringify(recon)}`);
  step(`sealed; reconciliation green (${recon.registered} registered · ${recon.submitted} submitted · ${recon.receipts} receipts · ${recon.leaves} leaves)`);

  // 4. The rogue insider; the cell's terminal shows the UPDATE.
  const rogue = await call<{ sql: string }>(`${C}/v1/rogue`, 'POST', { cand, q: 17, answer: 'C' });
  await Bun.sleep(100);
  if (!cellP.out.some((l) => l === `ROGUE ${rogue.sql}`)) fail('the cell did not print the UPDATE');
  step(`rogue insider: ${rogue.sql}`);

  // 5. The audit locates it and recovers the original from the archive.
  const want = 'Q17: record says C — the seat committed B';
  const { findings } = await call<{ findings: Finding[] }>(`${C}/v1/audit`, 'POST');
  if (findings.length !== 1 || findings[0].detail !== want || findings[0].recovered?.value !== 'B') fail(`audit: ${JSON.stringify(findings)}`);
  step(`audit: ${findings[0].detail} (recovered from ${findings[0].recovered?.from})`);

  // 6. /verify's logic on the served proof, with the code typed the way a candidate copies it.
  const proof = await call<Proof>(`${C}/v1/proof?cand=${cand}`);
  const rep = verifyProof(proof, forms, trustFromKeys(keys), slip.code.toLowerCase().replace(/(.{4})/g, '$1-'));
  const failed = rep.checks.filter((c) => !c.ok).map((c) => c.name);
  if (rep.ok || mismatchText(rep.mismatches[0]) !== want || failed.join() !== 'bodies') fail(`verify: ${failed.join()} ${rep.mismatches.map(mismatchText)}`);
  step(`/verify: ${mismatchText(rep.mismatches[0])}; chain, keys, finalHash, receipt, slip, STH and inclusion all pass`);
  const page = await fetch(`${C}/verify`);
  if (!(await page.text()).includes('Saakshi · Verify')) fail('/verify is not served');

  // 7. Reconciliation stays green; the evidence pack exports and its manifest holds.
  if (!(await call<ReconRow>(`${C}/v1/recon`)).green) fail('reconciliation went red after an answer-only edit');
  const ev = await fetch(`${C}/v1/evidence?cand=${cand}`);
  if (!ev.ok) fail(`evidence: ${ev.status}`);
  const files = await new Bun.Archive(new Uint8Array(await ev.arrayBuffer())).files();
  const names = [...files.keys()];
  const prefix = names[0].slice(0, names[0].indexOf('/') + 1);
  const manifest = await files.get(`${prefix}manifest.sha256`)!.text();
  for (const line of manifest.trim().split('\n')) {
    const [h, f] = line.split('  ');
    const got = createHash('sha256').update(new Uint8Array(await files.get(prefix + f)!.arrayBuffer())).digest('hex');
    if (got !== h) fail(`manifest mismatch for ${f}`);
  }
  for (const f of ['proof.json', 'report.html', 'certificate-s63.html', 'verify.html', 'custody.jsonl', 'sth.json', 'audit.json', 'README.txt'])
    if (!names.includes(prefix + f)) fail(`the pack lacks ${f}`);
  step(`evidence pack ${prefix.slice(0, -1)}.tar.gz: ${names.length} files, manifest verifies`);
  console.log('PASS');
} finally {
  exam?.close();
  for (const p of [controlP, relayP, cellP]) p.proc.kill();
  await Promise.all([controlP, relayP, cellP].map((p) => p.proc.exited));
  rmSync(dir, { recursive: true, force: true });
}
```
Expected counts on the slip:
- attempted is 6: Q1, Q2, Q3, Q4, Q5 and Q17.
- answered is 4: Q1, Q2, Q4 (AMR) and Q17.
- marked is 2: Q3 (MR) and Q4 (AMR).

- [ ] **Step 2: Run it** (sandbox disabled)

Run: `bun tools/act4.ts`
Expected: the slip line, six `✓` lines, then `PASS`.

- [ ] **Step 3: CI**

In `.github/workflows/server.yml`:
- Add `'apps/seat/src/main/**'` to both `paths` lists, because `act4.ts` imports `exam.ts` and `journal-store.ts`.
- Replace the steps after `pnpm install --frozen-lockfile` with:
```yaml
      - run: pnpm --filter @saakshi/core --filter @saakshi/server typecheck
      - run: pnpm --filter @saakshi/core test
      - run: bun test --timeout 60000 apps/server
      - name: Kill test (SIGKILL + wipe the cell mid-stream)
        run: bun tools/chaos-kill.ts
      - name: Act 4 end to end (submit → seal → rogue insider → audit → verify → evidence)
        run: bun tools/act4.ts
```
- `windows.yml` needs no change: its `paths` already cover `apps/server/**`, `packages/**` and `tools/**`, and `pnpm -r test` runs the new core, server and seat tests on Windows, including the `Bun.Archive` tests.

- [ ] **Step 4: Push and watch both workflows**

This is the controller's job, with the sandbox disabled because it involves `.git` and the network. Push the branch, then run `gh run watch` for `server` and `windows`.
Expected: both are green. If Windows fails on a path or line-ending detail in the new tests, fix the test rather than skipping it.

---

### Task 15: Stage 2 exit check and the Act 4 demo

**Files:**
- Create: `docs/evidence/stage2-*.png`, `docs/evidence/stage2-slip.pdf`, `docs/evidence/stage2-act4.txt`
- Update: the memory file `saakshi-hackathon-plan.md`

**Interfaces:**
- Consumes: everything above.
- Produces: the evidence the user approves before Stage 3.

- [ ] **Step 1: Exit check** (sandbox disabled)

```bash
pnpm -r test && pnpm -r typecheck
bun test --timeout 60000 apps/server
bun tools/chaos-kill.ts
bun tools/act4.ts | tee docs/evidence/stage2-act4.txt
```
Expected:
- Everything passes.
- `tamper.test.ts` shows its seven cases, which cover an edit, a deleted row, a truncated chain, a changed signature and an edited header.
- The kill test prints `PASS`.
- `act4.ts` prints `PASS`.

- [ ] **Step 2: Start the stack on a clean slate**

These commands are for the controller or the user, outside the sandbox. `open` is blocked inside it.
```bash
rm -rf data "$HOME/Library/Application Support/Saakshi/journal"      # clean demo state (a Stage 1 DB has no bodies)
DEV=1 MODE=cell    bun apps/server/src/main.ts &                    # keep this terminal visible: it prints ROGUE UPDATE …
DEV=1 MODE=relay   bun apps/server/src/main.ts &
DEV=1 MODE=control bun apps/server/src/main.ts &
(cd apps/seat && pnpm pack:mac)
IP=$(ipconfig getifaddr en0)
open apps/seat/release/mac-arm64/Saakshi.app --args --relay http://$IP:7070 --cand C0001 --no-camera
open http://127.0.0.1:7090/control
```
The app **always** launches with `--no-camera` here, because no step in this stage tests the face check. The header chip reads "Camera off (test mode)", and the macOS camera indicator (the green dot) never lights up.

- [ ] **Step 3: Sit the exam, then submit offline**

1. **NA survives a resume** (the Stage 1 open issue).
   - Start. Answer Q1–Q16 with Save & Next, and answer **Q17 = B**.
   - Open Q18 from the palette and leave it unanswered; Q18 turns red. Use Mark for Review & Next on Q19 without an option.
   - Force-quit with `pkill -9 -f 'Saakshi.app/Contents/MacOS/Saakshi'`, then relaunch with the same command as in Step 2, including `--no-camera`.
   - Q18 is still red. Q1 (on screen) stays green.
2. **Submit with Wi-Fi off.**
   - Turn Wi-Fi off and press **Submit**. The confirm screen lists the palette counts. Press **Submit now**.
   - The slip appears at once with the code in groups of four, and counts of the form "Attempted 19 of 20 · Answered 17 of 20 · Marked 1". The exact numbers depend on what you did in item 1.
   - Its sync line says "saved on this computer".
   - Screenshot it to `docs/evidence/stage2-slip.png`.
3. **Print.**
   - Press **Print slip**. The macOS print dialog opens; choose "Save as PDF" and save `docs/evidence/stage2-slip.pdf`.
   - The PDF shows only the slip, without the Print button.
4. **Back online.** Turn Wi-Fi on. Within a few seconds the slip's sync line turns blue ("saved at the exam server"). Then check that the cell's code equals the slip's:
   ```bash
   curl -s 'http://127.0.0.1:7080/v1/shift?exam=DEMO-2026&shift=S1' | jq -r '.sheets[] | select(.ctx.cand=="C0001") | .receipt.code'
   ```
5. **Quit the app:** `pkill -f 'Saakshi.app/Contents/MacOS/Saakshi'`.

- [ ] **Step 4: Act 4 in the control room** (browser at `http://127.0.0.1:7090/control`; each action is also available with curl)

1. **Reconciliation, before sealing.** The row shows `CEN-01 · S1 | 8 | 1 | 1 | 1 | 1 | 0 | all equal`. "Register leaves 0" is red, so the row is not green.
2. **Seal.** Press "Seal the shift — publish the register head", or run `curl -s -X POST localhost:7090/v1/seal | jq`. The row turns all green. Screenshot it to `docs/evidence/stage2-recon-green.png`.
3. **Rogue insider.** With C0001 · Q17 · C, press "Rogue insider edits an answer", or run `curl -s -X POST localhost:7090/v1/rogue -H 'content-type: application/json' -d '{"cand":"C0001","q":17,"answer":"C"}' | jq`.
   - The cell's terminal prints `ROGUE UPDATE bodies SET answer = 'C' WHERE … seq = N;`, and the page shows the same SQL.
4. **Audit.** Press "Run the audit", or run `curl -s -X POST localhost:7090/v1/audit | jq`.
   - The headline reads **"Q17: record says C — the seat committed B"**.
   - The line under it ends "recovered from archive: B".
   - Screenshot it to `docs/evidence/stage2-audit.png`.
5. **`/verify`.** Click "Open /verify for this candidate" and type the slip's code from the PDF, in lowercase with dashes.
   - The banner says "Golden vectors: all 30 checks pass in this browser".
   - The verdict is red: "The record was altered after the seat committed it", with the headline **"Q17: record says C — the seat committed B"**.
   - Bodies is ✗. Chain, keys, finalHash, receipt, slip, register head and inclusion are ✓.
   - Screenshot it to `docs/evidence/stage2-verify.png`.
6. **Still green.** The reconciliation row is still all green, because an answer-only edit changes no count.
7. **Evidence pack.** Press "Export the evidence pack", or run `curl -sOJ 'localhost:7090/v1/evidence?cand=C0001'`. Then:
   ```bash
   mkdir -p /tmp/ev && tar -xzf evidence-DEMO-2026-S1-C0001-*.tar.gz -C /tmp/ev && cd /tmp/ev/evidence-* && shasum -a 256 -c manifest.sha256
   ```
   Every line prints `OK`. Open `certificate-s63.html`: its print preview shows Parts A and B with the hashes filled in.
8. **Offline verify.** Turn Wi-Fi off. Open `/tmp/ev/evidence-*/verify.html` from Finder (`file://`), choose `proof.json` and type the code. You get the same verdict with no network. Screenshot it to `docs/evidence/stage2-verify-offline.png`.

- [ ] **Step 5: Clean up**

```bash
pkill -f 'Saakshi.app/Contents/MacOS/Saakshi'          # make sure the seat app is gone (camera stayed off throughout)
kill $(lsof -ti tcp:7090 -sTCP:LISTEN) $(lsof -ti tcp:7070 -sTCP:LISTEN) $(lsof -ti tcp:7080 -sTCP:LISTEN)
```

- [ ] **Step 6: Update memory and ask for approval**

- Record in `saakshi-hackathon-plan.md` that Stage 2 is done. Include:
  - the `act4.ts` PASS line;
  - the CI run links;
  - Addendum A (A.1–A.7);
  - the NA decision (first visit is `clear`/`NA`);
  - `/verify` as a compiled single file served by control;
  - the evidence pack as a `.tar.gz` via `Bun.Archive` plus printable HTML;
  - the `--no-camera` rule;
  - any deviations.
- Send the user the screenshots, the slip PDF and `stage2-act4.txt`.
- Ask for approval to start Stage 3.
