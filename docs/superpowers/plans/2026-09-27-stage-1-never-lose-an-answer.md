# Stage 1 — "Never lose an answer" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sit a real exam on the Mac and watch every answer tick ✓ → ✓✓ → blue ✓✓. With the network gone it keeps working, after `kill -9` of the cell nothing acknowledged is lost, and everything syncs when the cell returns.

**Architecture:**
- `apps/server` is one Bun binary, run as `MODE=relay` or `MODE=cell`. Both modes share one ingest engine (`ingest.ts`). It applies the protocol check order, BAD_SUBMISSION vs FORK, duplicate no-op and NEED/gap, and commits through a 10 ms / 500-row group commit on `bun:sqlite` (WAL, `synchronous=FULL`, `fullfsync`).
  - The **relay** verifies headers only. It stores the sealed envelope it cannot open and forwards to its cell (`forward.ts`). It passes the cell's countersigned acks back to seats and serves the `/console` seat grid over SSE.
  - The **cell** also opens every envelope and checks `bodyCommit`. It signs acks with a key read from a keys file, never from its DB. On a fresh DB it is REBUILDING: it returns 503 to live traffic until the relay replays from genesis.
- **Seat** (Electron main): `journal-store.ts` is an append-only file of XChaCha-encrypted lines (AAD bound to the seq), fsynced, with torn-tail recovery; its session key is wrapped by `safeStorage`. `exam.ts` builds, signs and seals entries and keeps the active-time clock. `sync.ts` sends the backlog to the relay and turns relay heads and verified cell acks into ticks.
- **Exam UI** (renderer): NTA layout and palette, EN/HI with a bundled Noto Sans Devanagari, ticks, timer, WCAG basics, and a face-count chip.

**Tech Stack:**
- TypeScript, run natively by Node 25 and Bun 1.3.14.
- `bun:sqlite`, `Bun.serve` routes, and Bun HTML imports for `/console`.
- `node:test` in `packages/core` and `apps/seat`; `bun:test` in `apps/server`.
- `@noble/*`, Electron 44, electron-vite 5, React 19, `@mediapipe/tasks-vision`.

**Spec:** `docs/plan.md`: §2 (architecture, stack table, "Path of one answer", failure handling), §3.1, §3.6, §3.11, §4 and §5 "Stage 1: Never lose an answer". The frozen wire bytes are in `docs/protocol-v1.md`.

## Global Constraints

**Protocol and code reuse**
- Protocol v1 is frozen. Reuse `packages/core` for all encoding, hashing, signing and sealing: `canon`, `protocol`, `node.ts` (`signer`, `verifier`, `sealBody`, `openBody`) and `journal.ts`.
  - No task may change a byte that is hashed, signed, encrypted or encoded.
  - If a task believes it must, it **stops and reports**.
  - Task 1 adds only new, additive core modules: `ack.ts`, `dev.ts`, `wire.ts`, and `signedLine`/`parseSignedLine` in `journal.ts`, where `verifyChain` keeps identical behaviour.
- **Ack signature (flagged as a protocol gap):**
  - `docs/protocol-v1.md` §5 reserves `["ack",exam,shift,attempt,cand,keyEpoch,seq,h]` but names no signing prefix.
  - Stage 1 signs `m = UTF-8(canon(ackArray))` **with no domain byte**. The `ack` type tag cannot collide with entry messages, which start with `0x02`.
  - Native: `crypto.sign('sha256', m, ieee-p1363)`, normalised to low-S by `signer()`.
- **Imports:**
  - Core is imported as `@saakshi/core/<module>`; Task 1 adds it as a workspace dependency.
  - `tools/*.ts` import core by relative path, as Stage 0 did.
  - Relative TS imports use an explicit `.ts` extension. There is no barrel file.
- **TypeScript:** `erasableSyntaxOnly`, so no enums, namespaces or constructor parameter properties.
- **Dependencies:** only Task 1 runs `pnpm`. Its commands carry `--config.confirm-modules-purge=false </dev/null`, because `pnpm install` can hang on a purge prompt. The only new download is `@types/bun@1.3.14`.

**Wire format**

JSON over HTTP. Hashes and signatures are lowercase hex. The body envelope (§8, `ephPub‖nonce‖ct`) is **standard padded base64**. The entry itself is the §11 signed line `canon(["signed", header, sigHex])`, byte for byte as the seat journals it. The types live in `packages/core/src/wire.ts`:

```ts
interface WireEntry { line: string; env: string }                 // §11 line + base64 envelope
interface Hello extends Ctx { head: number }                      // sender's own head: heartbeat + status request
interface SyncReq { entries: WireEntry[]; streams: Hello[]; replay?: true; done?: true }
interface WireAck { keyEpoch: number; seq: number; h: string; sig: string }
interface StreamStatus extends Ctx { head: number; headH: string; need: boolean; ack?: WireAck }
interface Rejection { index: number; code: 'BAD_SUBMISSION' | 'FORK'; reason: string }
interface SyncRes { streams: StreamStatus[]; rejected: Rejection[] }
interface StreamView extends Ctx { head: number; cellHead: number; senderHead: number; seenAt: number }
interface HeadsRes { mode: 'cell' | 'relay'; state: 'LIVE' | 'REBUILDING'; streams: StreamView[] }
```

Limits: 500 entries per request, 5,000 hellos, a line of at most 4,096 characters, an envelope of at most 16,384 base64 characters, and ctx strings of 1–64 characters.

**HTTP routes (both modes unless noted)**

| Route | Request | Response |
|---|---|---|
| `POST /v1/sync` | `SyncReq` | `200 SyncRes`; `400 {error}` for a bad shape; `503 {state:"REBUILDING"}` from a cell that is rebuilding, unless `replay: true` |
| `GET /v1/heads` | — | `HeadsRes` |
| `GET /v1/events` | `Last-Event-ID` header (optional) | SSE: `retry: 2000`, then either the missed events or one `snapshot` (`HeadsRes`). After that come `stream` (`StreamView`) and `state` (`{state}`) events, and `:ping` every 15 s. Ids are `<boot>-<n>`. |
| `GET /console` | — | Relay only: the seat-grid page (Bun HTML import) |

- **Server env:**
  - `MODE=cell|relay` (required); `DEV=1` (required until Stage 3).
  - `PORT`: relay 7070, cell 7080; `0` means any free port.
  - `HOST`: relay `0.0.0.0`, cell `127.0.0.1`.
  - `DB`: default `data/<mode>.db`.
  - `KEYS`: default `fixtures/keys.json`.
  - `CELL_ID`: default `cell-1`.
  - `CELL_URL`: relay only; default `http://127.0.0.1:7080`.
  - `REBUILD_RELAYS`: default 1.
  - The server prints exactly one stdout line: `READY {"mode":…,"port":…,…}`.
- **Seat settings:** `--relay` or `SAAKSHI_RELAY` (default `http://127.0.0.1:7070`); `--cand` or `SAAKSHI_CAND` (default `C0001`); and `SAAKSHI_ZOOM` (sets the zoom factor, for the 200% check).

**Rules**
- **Check order** at relay and cell, per entry:
  1. The line parses (a failure is BAD_SUBMISSION).
  2. A seat key exists for `(cand, keyEpoch)` (otherwise BAD_SUBMISSION).
  3. The signature verifies (otherwise BAD_SUBMISSION, **never** FORK). Then `seq ≥ 1` (otherwise BAD_SUBMISSION).
  4. If `seq > head+1`, answer with a gap: `need: true`, and the sender resends from `head+1`.
  5. Check `prev` against the stored chain. A mismatch is FORK.
  6. If `seq ≤ head`, the same `h` is a no-op; a different `h` is FORK.
  7. The envelope must be valid base64 of at least 121 bytes. On the cell only, `openBody` and `bodyCommit` must also pass (otherwise BAD_SUBMISSION).
  8. Append.
  - BAD_SUBMISSION and FORK are written to the `evidence` table.
- **Group commit:** a single writer commits every **10 ms or 500 rows**, in one transaction. A response is built only **after** the commit it depends on. If a commit fails, the process exits (crash-only) so the chain reloads from disk.
- **DEV roster (until Stage 3):**
  - Candidate `C000n` signs with `fixtures/keys.json` `seats[n-1]` at `keyEpoch 1`. Any other epoch has no key.
  - Form `F1` if n is odd, `F2` if n is even.
  - The exam context is `DEMO-2026 / S1 / attempt 1`.
  - The cell key is `cells[0]` (`cell-1`). Its public key is pinned into the seat build through the bundled `keys.json`. **DEV only:** that bundle also carries private keys. Stage 3 replaces it with a signed policy.
- **Ticks:**
  - ✓ means `seq ≤` the seat's fsynced journal head.
  - ✓✓ means `seq ≤` the relay head, where the relay's `headH` equals the seat's own `h` at that seq.
  - Blue ✓✓ means `seq ≤` the highest seq that has a **cell ack verifying under the pinned cell key over the seat's own `h`**.
  - The seat never trusts the relay's word for either tick.
- **Seat journal at rest:**
  - One line per entry: `base64(nonce24 ‖ XChaCha20-Poly1305(sessionKey, nonce, AAD).encrypt(UTF-8(canon(["rec", line, envB64, saltHex, bodyArray]))))` plus `\n`.
  - AAD = `UTF-8(canon(["aad",exam,shift,attempt,cand,seq]))`.
  - `sessionKey` is 32 random bytes, stored as `safeStorage.encryptString(hex)` in `<exam>_<shift>_<attempt>_<cand>.key`, next to `.journal`.
  - Every append is fsynced.
  - Timer: remaining = `durationMs − activeMs`. `activeMs` never decreases, including across a resume. An `idle` entry is appended after 60 s with no entry.

**Environment gotchas**
- **Sandbox:**
  - It blocks `.git` writes, `open`, some network, **local port binding** (every `apps/server` HTTP test, `main.test.ts` and `tools/chaos-kill.ts`) and launching packaged apps.
  - Re-run such commands with `dangerouslyDisableSandbox: true`.
- **Tests:**
  - Write `assert.throws(fn, /re/, msg)` or `assert.throws(fn, msg)`. Never `assert.throws(fn, undefined, msg)`, which does not type-check.
  - The Bun per-test timeout defaults to 5 s. Heavy tests run with `bun test --timeout 60000`, which the package script already passes.
- **Module format:**
  - The root `package.json` is `"type":"module"`.
  - `apps/seat` has **no** type field: electron-vite bundles main and preload as CJS. Therefore seat main code must not use top-level `await`, and seat test and lib files must not use `__dirname` or `require`.
- **Dependencies:** `@saakshi/core` is a seat **devDependency** so that electron-vite bundles it; electron-vite 5 externalises only `dependencies`.
- **Commits:** agents share one working tree, touch only the files their task lists and **do not commit**. The controller reviews and commits each task.

## Review Focus

These are the five likeliest real-world failures. Each is pinned by a named test in the task that owns the code.

1. **An untrusted relay forges a blue tick, or claims a head it does not hold.**
   - Expected: blue appears only for a cell signature over the seat's *own* `h`, and ✓✓ only when `headH` matches.
   - Pinned in Task 7: "a forged or mismatched ack never turns a tick blue" and "a relay that disagrees about our chain does not advance ✓✓".
2. **Power is cut mid-append on the seat**, leaving a partial or zero-filled tail.
   - Expected: the journal reopens, drops only the torn tail and carries on. Damage anywhere before the tail refuses loudly instead of silently dropping answers.
   - Pinned in Task 6: "a torn tail is cut back to the last whole line" and "damage before the tail refuses to open".
3. **A garbled or foreign-key resubmission at an already-stored seq**, for example a relay bit flip or a buggy seat.
   - Expected: BAD_SUBMISSION, **never** FORK. A false FORK would open a tamper case against an honest candidate.
   - Pinned in Task 2: "an invalid signature at a stored seq is BAD_SUBMISSION, never FORK".
4. **The invigilator console silently stops updating** because Bun's idle timeout or a proxy drops the SSE stream.
   - Expected: `server.timeout(req,0)`, pings, and Last-Event-ID replay.
   - Pinned in Task 3: "SSE outlives Bun's idle timeout" and "Last-Event-ID replays only the missed events over HTTP".
5. **The cell is SIGKILLed between COMMIT and ack delivery, or its DB is deleted.**
   - Expected: nothing acknowledged is lost; the resend is a no-op; REBUILDING returns 503 and the relay replays; the forwarder does not spin on a rejecting cell.
   - The heartbeat notices a wiped cell even when no seat is sending.
   - Pinned in Task 4: "cell SIGKILL after COMMIT but before the ack…", "a wiped cell REBUILDs…", "with nothing pending, the heartbeat still notices a wiped cell…" and "a cell that rejects everything makes the forwarder back off".
   - Also pinned end to end by the Task 10 kill test.

## Parallelism map

```
T1 contracts ─┬─► T2 ingest ────┐
              ├─► T3 http+sse ──┼─► T4 forwarder+main ─┐
              ├─► T5 console ───┘                      ├─► T10 kill test ─► T11 CI ─┐
              ├─► T6 seat journal ─┐                   │                            │
              ├─► T7 seat sync ────┼─► T8 session+IPC ─┴────────────────────────────┼─► T12 exit + demo
              └─► T9 exam UI ──────┴────────────────────────────────────────────────┘
```

| Wave | Tasks | Notes |
|---|---|---|
| 1 | T1 | Contracts, dependencies and shared test fixtures. Everything else depends on it. |
| 2 | T2, T3, T5, T6, T7, T9 | Six agents on disjoint paths. T3 tests against a fake `Api`, and T9 against the `SeatApi` type only. |
| 3 | T4 (needs T2, T3, T5), T8 (needs T6, T7) | |
| 4 | T10 (needs T4, T7) | |
| 5 | T11 | |
| 6 | T12 | Integration of T8 and T9 is proven here. |

---

### Task 1: Contracts — wire types, ack, DEV roster, signed-line helpers, simulated seat, dependencies

**Files:**
- Create: `packages/core/src/{wire,ack,dev}.ts`
- Modify: `packages/core/src/journal.ts` (add `signedLine` and `parseSignedLine`, and use them in `buildChain`/`verifyChain` without changing behaviour)
- Test: `packages/core/test/{wire,ack,dev,line}.test.ts`
- Create: `tools/sim-seat.ts`, `apps/server/package.json`, `apps/server/tsconfig.json`, `apps/server/test/sim-seat.test.ts`, `apps/seat/src/shared/ipc.ts`
- Modify: `apps/seat/package.json` (through pnpm), `apps/seat/tsconfig.json` (`resolveJsonModule`), `.gitignore` (add `data/`)

**Interfaces:**
- Produces:
  - `wire.ts`: the types in Global Constraints, plus:
    - `LIMITS`
    - `streamKey(c: Ctx): string`
    - `toB64(b: Uint8Array): string`
    - `fromB64(s: string): Uint8Array` (throws `not base64`)
    - `parseSyncReq(x: unknown): SyncReq` (throws `sync: …`)
  - `ack.ts`:
    - `interface Ack extends Ctx { keyEpoch; seq; h }`
    - `ackArray(a): Canon[]`
    - `ackMessage(a): Uint8Array`
  - `dev.ts`:
    - `KeysFile`
    - `DEV_EXAM`
    - `devSeat(keys, cand): (KeyPair & {seatId}) | undefined`
    - `devSeatKey(keys): (cand, keyEpoch) => Uint8Array | undefined`
    - `cellKey(keys, id): KeyPair & {id}` (throws if the id is unknown)
    - `devForm(cand): 'F1' | 'F2'`
  - `journal.ts`:
    - `signedLine(h: Header, sign): string`
    - `type ParsedLine = {ok:true; header; m; sig} | {ok:false; fault:'parse'|'shape'; detail}`
    - `parseSignedLine(line): ParsedLine`
  - `tools/sim-seat.ts`:
    - `class SimSeat(keys, cand, cellPub, keyEpoch = 1)`
    - Fields and getters: `ctx`, `entries: WireEntry[]`, `hs: string[]`, `headers: Header[]`, `head`
    - Methods: `add(n): WireEntry[]`, `alt(seq): WireEntry`, `after(acked, limit=500): WireEntry[]`, `make(seq, prev, answer, body?) → {entry, header, h}`
  - `apps/seat/src/shared/ipc.ts`: `Lang`, `ItemState`, `SyncView`, `ExamBoot`, `Action`, `ActResult`, `SeatApi`. **There is no `declare global`**; Task 9 declares `window.saakshi` when it replaces `App.tsx`.

- [ ] **Step 1: Add dependencies and package files**

`apps/server/package.json`:
```json
{
  "name": "@saakshi/server",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "license": "Apache-2.0",
  "scripts": {
    "start": "bun src/main.ts",
    "test": "bun test --timeout 60000 ./test",
    "typecheck": "tsc -p tsconfig.json"
  }
}
```

`apps/server/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "lib": ["ES2023", "DOM"], "types": ["bun"] },
  "include": ["src", "test"]
}
```

`apps/seat/tsconfig.json`: add `"resolveJsonModule": true` to `compilerOptions`. Leave everything else unchanged.

`.gitignore`: append the line `data/`.

```bash
pnpm --filter @saakshi/server add @saakshi/core@workspace:* --config.confirm-modules-purge=false </dev/null
pnpm --filter @saakshi/server add -D @types/bun@1.3.14 --config.confirm-modules-purge=false </dev/null
pnpm --filter @saakshi/seat add -D @saakshi/core@workspace:* --config.confirm-modules-purge=false </dev/null
```
Expected: `pnpm-lock.yaml` updates, and `node_modules/@saakshi/core` resolves to `packages/core`. `@types/bun` is a download; if the sandbox blocks it, re-run outside the sandbox.

- [ ] **Step 2: Write the failing core tests**

`packages/core/test/wire.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fromB64, parseSyncReq, streamKey, toB64 } from '../src/wire.ts';

const hello = { exam: 'DEMO-2026', shift: 'S1', attempt: 1, cand: 'C0001', head: 3 };

test('parseSyncReq keeps exactly the contract fields', () => {
  const r = parseSyncReq({ entries: [{ line: '["signed"]', env: 'AAAA', extra: 1 }], streams: [{ ...hello, x: 2 }], junk: true });
  assert.deepEqual(r, { entries: [{ line: '["signed"]', env: 'AAAA' }], streams: [hello] });
  assert.deepEqual(parseSyncReq({ entries: [], streams: [], replay: true, done: true }), { entries: [], streams: [], replay: true, done: true });
  assert.deepEqual(parseSyncReq({ entries: [] }), { entries: [], streams: [] });
});

test('parseSyncReq rejects every malformed shape', () => {
  const bad: unknown[] = [
    null, [], 'x', { entries: 'x' }, { entries: Array(501).fill({ line: 'a', env: '' }) },
    { entries: [{ line: 1, env: '' }] }, { entries: [{ line: 'a', env: 'abc' }] }, { entries: [{ line: 'a', env: '!!!!' }] },
    { entries: [{ line: 'x'.repeat(4097), env: '' }] },
    { entries: [], streams: [{ ...hello, head: -1 }] }, { entries: [], streams: [{ ...hello, attempt: 1.5 }] },
    { entries: [], streams: [{ ...hello, cand: '' }] }, { entries: [], streams: [{ ...hello, exam: 'x'.repeat(65) }] },
    { entries: [], replay: false }, { entries: [], done: true },
  ];
  for (const b of bad) assert.throws(() => parseSyncReq(b), /sync:/, JSON.stringify(b)?.slice(0, 80));
});

test('base64 round-trips and rejects non-base64', () => {
  const b = Uint8Array.from({ length: 200 }, (_, i) => i);
  assert.deepEqual(fromB64(toB64(b)), b);
  assert.deepEqual(fromB64(toB64(b.subarray(10, 20))), b.subarray(10, 20));
  for (const s of ['abc', 'ab$=', 'a===']) assert.throws(() => fromB64(s), /base64/, s);
});

test('streamKey separates fields unambiguously', () => {
  assert.notEqual(streamKey({ exam: 'a', shift: 'b|c', attempt: 1, cand: 'd' }), streamKey({ exam: 'a|b', shift: 'c', attempt: 1, cand: 'd' }));
});
```

`packages/core/test/ack.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ackArray, ackMessage, type Ack } from '../src/ack.ts';
import { canon } from '../src/canon.ts';
import { newKeyPair, signer, verifier } from '../src/node.ts';
import { nobleVerifier } from '../src/sig.ts';

const a: Ack = { exam: 'DEMO-2026', shift: 'S1', attempt: 1, cand: 'C0001', keyEpoch: 1, seq: 5, h: 'ab'.repeat(32) };

test('ack layout is the reserved protocol-v1 §5 array; the message is its canonical UTF-8 with no domain byte', () => {
  assert.equal(canon(ackArray(a)), `["ack","DEMO-2026","S1",1,"C0001",1,5,"${'ab'.repeat(32)}"]`);
  assert.equal(new TextDecoder().decode(ackMessage(a)), canon(ackArray(a)));
});

test('a cell ack verifies natively and with noble, and any field change breaks it', () => {
  const k = newKeyPair();
  const sig = signer(k)(ackMessage(a));
  assert.ok(verifier(k.pub)(ackMessage(a), sig));
  assert.ok(nobleVerifier(k.pub)(ackMessage(a), sig));
  for (const change of [{ seq: 6 }, { h: 'cd'.repeat(32) }, { cand: 'C0002' }, { keyEpoch: 2 }, { attempt: 2 }])
    assert.equal(verifier(k.pub)(ackMessage({ ...a, ...change }), sig), false, JSON.stringify(change));
});
```

`packages/core/test/dev.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { toHex } from '../src/bytes.ts';
import { cellKey, devForm, devSeat, devSeatKey, type KeysFile } from '../src/dev.ts';

const keys = JSON.parse(readFileSync(new URL('../../../fixtures/keys.json', import.meta.url), 'utf8')) as KeysFile;

test('DEV roster: C000n signs with seats[n-1] at keyEpoch 1 only', () => {
  const s = devSeat(keys, 'C0001')!;
  assert.equal(s.seatId, 'CEN042-S01');
  assert.equal(toHex(s.pub), keys.seats[0].pub);
  assert.equal(toHex(devSeatKey(keys)('C0008', 1)!), keys.seats[7].pub);
  for (const [cand, ep] of [['C0001', 2], ['C0009', 1], ['C0000', 1], ['X0001', 1], ['C01', 1]] as const)
    assert.equal(devSeatKey(keys)(cand, ep), undefined, `${cand}/${ep}`);
});

test('cell keys come from the keys file; forms alternate', () => {
  assert.equal(toHex(cellKey(keys, 'cell-1').pub), keys.cells[0].pub);
  assert.throws(() => cellKey(keys, 'cell-9'), /cell-9/);
  assert.deepEqual(['C0001', 'C0002', 'C0003'].map(devForm), ['F1', 'F2', 'F1']);
});
```

`packages/core/test/line.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toHex } from '../src/bytes.ts';
import { buildChain, demoEntries, parseSignedLine, signedLine } from '../src/journal.ts';
import { newKeyPair, signer, verifier } from '../src/node.ts';

const ctx = { exam: 'DEMO-2026', shift: 'S1', attempt: 1, cand: 'C0001' };
const key = newKeyPair();

test('signedLine builds the §11 line that parseSignedLine reads back and the seat key verifies', () => {
  const { headers, lines } = buildChain(ctx, 1, demoEntries(3), signer(key));
  const line = signedLine(headers[1], signer(key));
  assert.equal(line.slice(0, line.lastIndexOf(',"')), lines[1].slice(0, lines[1].lastIndexOf(',"')));  // same header, fresh signature
  const p = parseSignedLine(line);
  assert.ok(p.ok);
  assert.deepEqual(p.header, headers[1]);
  assert.ok(verifier(key.pub)(p.m, p.sig));
  assert.equal(toHex(p.sig).length, 128);
});

test('parseSignedLine reports parse and shape faults like verifyChain', () => {
  const { lines } = buildChain(ctx, 1, demoEntries(1), signer(key));
  const cases: [string, 'parse' | 'shape'][] = [
    ['not json', 'parse'], ['["signed", 1]', 'parse'], ['["signed",[],"00"]', 'shape'],
    [lines[0].replace('"unlock"', '"teleport"'), 'shape'], ['["signed",["entry"],"' + '0'.repeat(128) + '"]', 'shape'],
  ];
  for (const [line, fault] of cases) {
    const p = parseSignedLine(line);
    assert.equal(p.ok ? 'ok' : p.fault, fault, line.slice(0, 40));
  }
});
```

Run: `cd packages/core && node --test "test/{wire,ack,dev,line}.test.ts"`
Expected: FAIL with `Cannot find module` or a missing export.

- [ ] **Step 3: Implement the core modules**

`packages/core/src/wire.ts`:
```ts
import { Buffer } from 'node:buffer';
import type { Ctx } from './protocol.ts';

/** One journal entry on the wire: the protocol §11 signed line, plus the §8 body envelope as standard padded base64. */
export interface WireEntry { line: string; env: string }
/** The sender's own head for a stream: a heartbeat and a status request in one. */
export interface Hello extends Ctx { head: number }
/** POST /v1/sync. `replay`/`done` are sent only relay → cell while the cell is REBUILDING. */
export interface SyncReq { entries: WireEntry[]; streams: Hello[]; replay?: true; done?: true }
/** A cell signature (hex) over ackMessage({...ctx, keyEpoch, seq, h}) — see ack.ts. */
export interface WireAck { keyEpoch: number; seq: number; h: string; sig: string }
/** head: highest contiguous seq committed here; headH: its h ('' when head = 0); need: a gap was seen, resend from head+1. */
export interface StreamStatus extends Ctx { head: number; headH: string; need: boolean; ack?: WireAck }
export type RejectCode = 'BAD_SUBMISSION' | 'FORK';
export interface Rejection { index: number; code: RejectCode; reason: string }
export interface SyncRes { streams: StreamStatus[]; rejected: Rejection[] }
/** One seat-grid tile. cellHead −1 = not yet known (relay); senderHead −1 = never heard; seenAt = epoch ms of the last hello, 0 = never. */
export interface StreamView extends Ctx { head: number; cellHead: number; senderHead: number; seenAt: number }
export type NodeState = 'LIVE' | 'REBUILDING';
export interface HeadsRes { mode: 'cell' | 'relay'; state: NodeState; streams: StreamView[] }

export const LIMITS = { entries: 500, streams: 5000, line: 4096, env: 16384, field: 64 } as const;
export const streamKey = (c: Ctx): string => JSON.stringify([c.exam, c.shift, c.attempt, c.cand]);

const B64 = /^[A-Za-z0-9+/]*={0,2}$/;
export const toB64 = (b: Uint8Array): string => Buffer.from(b.buffer, b.byteOffset, b.byteLength).toString('base64');
export function fromB64(s: string): Uint8Array {
  if (s.length % 4 !== 0 || !B64.test(s)) throw new Error('not base64');
  return new Uint8Array(Buffer.from(s, 'base64'));
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const nat = (x: unknown): x is number => Number.isSafeInteger(x) && (x as number) >= 0;
const field = (x: unknown): x is string => typeof x === 'string' && x.length > 0 && x.length <= LIMITS.field;

/** Validate an untrusted POST /v1/sync body; returns a clean copy with only the contract fields. */
export function parseSyncReq(x: unknown): SyncReq {
  if (!isObj(x)) throw new Error('sync: body must be an object');
  const { entries, streams = [], replay, done } = x;
  if (!Array.isArray(entries) || entries.length > LIMITS.entries) throw new Error(`sync: entries must be an array of at most ${LIMITS.entries}`);
  if (!Array.isArray(streams) || streams.length > LIMITS.streams) throw new Error(`sync: streams must be an array of at most ${LIMITS.streams}`);
  if (replay !== undefined && replay !== true) throw new Error('sync: replay must be true or absent');
  if (done !== undefined && (done !== true || replay !== true)) throw new Error('sync: done must be true and needs replay');
  const out: SyncReq = {
    entries: entries.map((e, i) => {
      if (!isObj(e) || typeof e.line !== 'string' || e.line.length > LIMITS.line || typeof e.env !== 'string'
        || e.env.length > LIMITS.env || e.env.length % 4 !== 0 || !B64.test(e.env)) throw new Error(`sync: entries[${i}] must be {line, env: base64}`);
      return { line: e.line, env: e.env };
    }),
    streams: streams.map((h, i) => {
      if (!isObj(h) || !field(h.exam) || !field(h.shift) || !nat(h.attempt) || !field(h.cand) || !nat(h.head))
        throw new Error(`sync: streams[${i}] must be {exam, shift, attempt, cand, head}`);
      return { exam: h.exam, shift: h.shift, attempt: h.attempt, cand: h.cand, head: h.head };
    }),
  };
  if (replay) out.replay = true;
  if (done) out.done = true;
  return out;
}
```

`packages/core/src/ack.ts`:
```ts
import { utf8 } from './bytes.ts';
import { canon, type Canon } from './canon.ts';
import type { Ctx } from './protocol.ts';

export interface Ack extends Ctx { keyEpoch: number; seq: number; h: string }

/** Reserved in protocol-v1 §5. */
export const ackArray = (a: Ack): Canon[] => ['ack', a.exam, a.shift, a.attempt, a.cand, a.keyEpoch, a.seq, a.h];

/**
 * The signed message. §5 names no domain byte for acks, so the cell signs the canonical UTF-8 alone;
 * the 'ack' tag keeps it apart from entry messages, which start with 0x02. (Flagged for the protocol doc.)
 */
export const ackMessage = (a: Ack): Uint8Array => utf8(canon(ackArray(a)));
```

`packages/core/src/dev.ts`:
```ts
import { hexToBytes } from './bytes.ts';
import type { KeyPair } from './node.ts';

/** Shape of fixtures/keys.json. DEMO KEYS — published in the repo. */
export interface KeysFile {
  authority: { priv: string; pub: string };
  cells: { id: string; priv: string; pub: string }[];
  seats: { seatId: string; priv: string; pub: string }[];
}

export const DEV_EXAM = { exam: 'DEMO-2026', shift: 'S1', attempt: 1 } as const;

const index = (cand: string): number => { const m = /^C(\d{4})$/.exec(cand); return m ? Number(m[1]) - 1 : -1; };
const pair = (x: { priv: string; pub: string }): KeyPair => ({ priv: hexToBytes(x.priv), pub: hexToBytes(x.pub) });

/** DEV roster until Stage 3 enrolment: candidate C000n signs with seats[n-1]. */
export function devSeat(keys: KeysFile, cand: string): (KeyPair & { seatId: string }) | undefined {
  const s = keys.seats[index(cand)];
  return s && { seatId: s.seatId, ...pair(s) };
}

/** The key a relay or cell trusts for (cand, keyEpoch). DEV: epoch 1 only. */
export const devSeatKey = (keys: KeysFile) => (cand: string, keyEpoch: number): Uint8Array | undefined =>
  keyEpoch === 1 ? devSeat(keys, cand)?.pub : undefined;

/** Cell keys live in the keys file, never in the cell DB, so acks stay valid after a rebuild. */
export function cellKey(keys: KeysFile, id: string): KeyPair & { id: string } {
  const c = keys.cells.find((x) => x.id === id);
  if (!c) throw new Error(`no cell key ${id}`);
  return { id, ...pair(c) };
}

export const devForm = (cand: string): 'F1' | 'F2' => (index(cand) % 2 === 0 ? 'F1' : 'F2');
```

`packages/core/src/journal.ts`: add the two helpers below. Make `buildChain` and `verifyChain` use them, keeping their outputs and the §11 fault order byte-for-byte identical. The existing `journal.test.ts` and `vectors.test.ts` must still pass unchanged.
```ts
/** One §11 journal line: canon(["signed", header, sigHex]). */
export const signedLine = (h: Header, sign: (m: Uint8Array) => Uint8Array): string =>
  canon(['signed', headerArray(h), toHex(sign(tagged(D.ENTRY, headerArray(h))))]);

export type ParsedLine = { ok: true; header: Header; m: Uint8Array; sig: Uint8Array } | { ok: false; fault: 'parse' | 'shape'; detail: string };

/** §11 checks 1–2 for a single line; m is the exact signed message (0x02 ‖ canonical header). */
export function parseSignedLine(line: string): ParsedLine {
  let a: Canon[];
  try { a = parseCanon(line); } catch (e) { return { ok: false, fault: 'parse', detail: (e as Error).message }; }
  const [tag, ha, sig] = a;
  if (a.length !== 3 || tag !== 'signed' || !Array.isArray(ha) || typeof sig !== 'string' || !SIG_HEX.test(sig)) return { ok: false, fault: 'shape', detail: 'not ["signed",header,sigHex]' };
  try { return { ok: true, header: headerFromArray(ha), m: tagged(D.ENTRY, ha), sig: hexToBytes(sig) }; }
  catch (e) { return { ok: false, fault: 'shape', detail: (e as Error).message }; }
}
```
In `buildChain`, replace the `lines.push(canon([...]))` line with `lines.push(signedLine(h, sign));`. The `verifyChain` loop body becomes:
```ts
    const fail = (fault: ChainFault, detail: string): ChainResult => ({ ok: false, index: i, fault, detail });
    const p = parseSignedLine(lines[i]);
    if (!p.ok) return fail(p.fault, p.detail);
    const h = p.header;
    if (h.exam !== c.exam || h.shift !== c.shift || h.attempt !== c.attempt || h.cand !== c.cand) return fail('context', 'entry belongs to another exam, shift, attempt or candidate');
    if (!verify(p.m, p.sig)) return fail('sig', 'signature does not verify');
    if (h.seq !== i + 1) return fail('seq', `expected seq ${i + 1}, found ${h.seq}`);
    if (h.prev !== prev) return fail('prev', 'prev does not match the previous entry hash');
    prev = toHex(entryHash(h));
```
Move `const SIG_HEX` above `parseSignedLine`.

- [ ] **Step 4: Run all core tests**

Run: `cd packages/core && pnpm test && pnpm typecheck`
Expected: everything passes under node and bun, including the unchanged vectors, the 1,000-flip test and the new files.

- [ ] **Step 5: Simulated seat, with its test**

`tools/sim-seat.ts`:
```ts
// A scripted seat for server tests, seat sync tests and tools/chaos-kill.ts: a valid signed chain for one
// DEV candidate, with every body sealed to the cell exactly as the real seat does it.
import { randomBytes, toHex } from '../packages/core/src/bytes.ts';
import { DEV_EXAM, devSeat, type KeysFile } from '../packages/core/src/dev.ts';
import { signedLine } from '../packages/core/src/journal.ts';
import { sealBody, signer } from '../packages/core/src/node.ts';
import { entryHash, genesisPrev, type Body, type Ctx, type Header } from '../packages/core/src/protocol.ts';
import { toB64, type WireEntry } from '../packages/core/src/wire.ts';

export class SimSeat {
  readonly ctx: Ctx;
  readonly entries: WireEntry[] = [];
  readonly hs: string[] = [];
  readonly headers: Header[] = [];
  #sign: (m: Uint8Array) => Uint8Array;
  #cellPub: Uint8Array;
  #keyEpoch: number;

  constructor(keys: KeysFile, cand: string, cellPub: Uint8Array, keyEpoch = 1) {
    const k = devSeat(keys, cand);
    if (!k) throw new Error(`no DEV seat key for ${cand}`);
    this.ctx = { ...DEV_EXAM, cand };
    this.#sign = signer(k);
    this.#cellPub = cellPub;
    this.#keyEpoch = keyEpoch;
  }

  get head(): number { return this.hs.length; }

  /** Append n entries: an unlock first, then answers cycling through I01…I20. */
  add(n = 1): WireEntry[] {
    const out: WireEntry[] = [];
    for (let i = 0; i < n; i++) {
      const seq = this.hs.length + 1;
      const { entry, header, h } = this.make(seq, this.hs.at(-1) ?? genesisPrev(this.ctx), 'ABCD'[seq % 4]);
      this.entries.push(entry); this.headers.push(header); this.hs.push(h); out.push(entry);
    }
    return out;
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

  make(seq: number, prev: string, answer: string, body?: Body): { entry: WireEntry; header: Header; h: string } {
    const b: Body = body ?? (seq === 1 ? { item: '', state: '', answer: '', meta: [] }
      : { item: `I${String(((seq - 2) % 20) + 1).padStart(2, '0')}`, state: 'A', answer, meta: [1000, []] });
    const { envelope, bodyCommit } = sealBody(this.#cellPub, { ...this.ctx, seq }, randomBytes(16), b);
    const header: Header = { ...this.ctx, keyEpoch: this.#keyEpoch, seq, prev, kind: seq === 1 ? 'unlock' : 'answer', tMonoMs: seq * 1000, activeMs: seq * 1000, bodyCommit };
    return { entry: { line: signedLine(header, this.#sign), env: toB64(envelope) }, header, h: toHex(entryHash(header)) };
  }
}
```

`apps/server/test/sim-seat.test.ts`:
```ts
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { cellKey, devSeat, type KeysFile } from '@saakshi/core/dev';
import { parseSignedLine, verifyChain } from '@saakshi/core/journal';
import { openBody, verifier } from '@saakshi/core/node';
import { fromB64 } from '@saakshi/core/wire';
import { SimSeat } from '../../../tools/sim-seat.ts';

const keys = JSON.parse(readFileSync(new URL('../../../fixtures/keys.json', import.meta.url), 'utf8')) as KeysFile;
const cell = cellKey(keys, 'cell-1');

test('SimSeat builds a chain the seat key verifies and envelopes only the cell can open', () => {
  const s = new SimSeat(keys, 'C0003', cell.pub);
  s.add(25);
  const r = verifyChain(s.ctx, s.entries.map((e) => e.line), verifier(devSeat(keys, 'C0003')!.pub));
  expect(r).toEqual({ ok: true, head: s.hs[24], count: 25 });
  s.entries.forEach((e, i) => {
    const p = parseSignedLine(e.line);
    if (!p.ok) throw new Error(p.detail);
    const { body } = openBody(cell.priv, { ...s.ctx, seq: i + 1 }, fromB64(e.env), p.header.bodyCommit);
    expect(body.item).toBe(i === 0 ? '' : `I${String((i - 1) % 20 + 1).padStart(2, '0')}`);
  });
  expect(s.after(20).length).toBe(5);
  expect(s.after(-1, 3).length).toBe(3);
});

test('alt() is validly signed at an existing seq but hashes differently', () => {
  const s = new SimSeat(keys, 'C0001', cell.pub);
  s.add(3);
  const p = parseSignedLine(s.alt(2).line);
  if (!p.ok) throw new Error(p.detail);
  expect(p.header.seq).toBe(2);
  expect(p.header.prev).toBe(s.hs[0]);
  expect(verifier(devSeat(keys, 'C0001')!.pub)(p.m, p.sig)).toBe(true);
  expect(s.alt(2).line).not.toBe(s.entries[1].line);
});
```
Run: `cd apps/server && bun test ./test`. Expected: 2 pass.

- [ ] **Step 6: Seat IPC contract**

`apps/seat/src/shared/ipc.ts`:
```ts
// Contract between Electron main (Task 8) and the renderer (Task 9). Types only.
import type { State } from '@saakshi/core/protocol';

export type Lang = 'en' | 'hi';
/** The latest journaled state of one item; seq is the entry that set it (drives the tick). */
export interface ItemState { state: State; answer: string; seq: number }
/** local: journal head (✓). relay: highest seq the relay confirmed with our own h (✓✓). cell: highest seq with a verified cell ack (blue ✓✓). */
export interface SyncView { local: number; relay: number; cell: number; online: boolean; error: string }
export interface ExamBoot {
  cand: string; seatId: string; form: 'F1' | 'F2'; durationMs: number;
  activeMs: number; started: boolean; items: Record<string, ItemState>; sync: SyncView;
}
/** answer → A + option; mark → MR with '' or AMR + option; clear → NA with ''. */
export interface Action { kind: 'answer' | 'mark' | 'clear'; item: string; state: State; answer: string; dwellMs: number }
export type ActResult = { ok: true; seq: number; activeMs: number } | { ok: false; error: string };
export interface SeatApi {
  load(): Promise<ExamBoot>;
  start(): Promise<ActResult>;
  act(a: Action): Promise<ActResult>;
  onSync(cb: (v: SyncView) => void): () => void;
}
```

- [ ] **Step 7: Typecheck everything**

Run: `pnpm -r typecheck && pnpm --filter @saakshi/seat test`
Expected: clean. The seat's existing tests still pass.

- [ ] **Step 8: Hand back for review and commit** with the message `feat: Stage 1 contracts — wire types, cell ack, DEV roster, signed-line helpers, simulated seat`.

---

### Task 2: Server ingest — durable store, group commit, check order, acks, REBUILDING

**Files:**
- Create: `apps/server/src/store.ts`, `apps/server/src/ingest.ts`
- Test: `apps/server/test/store.test.ts`, `apps/server/test/ingest.test.ts`

**Interfaces:**
- Consumes (Task 1):
  - `parseSignedLine`
  - `ackMessage`
  - `devSeatKey`, `cellKey`
  - the `wire.ts` types, `streamKey`, `toB64`, `fromB64`
  - `SimSeat`
- Produces:
  - `store.ts`:
    - `interface Row extends Ctx { seq; keyEpoch; h; line; env: Uint8Array }`
    - `openDb(path): { db: Database; fresh: boolean }`
    - `pragmas(db): { journal_mode: string; synchronous: number; fullfsync: number; checkpoint_fullfsync: number }`
    - `class GroupCommit(db, onCommit, opts?: { ms?: number; max?: number; onFatal?: (e) => void })` with `add(rows): Promise<void>`, `flush(): void` and a `transactions` counter
  - `ingest.ts`:
    - `type Mode = 'cell' | 'relay'`
    - `interface IngestOpts { mode; db; fresh; seatKey; cell: {pub; priv?}; rebuildRelays?; onView?; onState?; now?; commit? }`
    - `interface Ingest`, whose members are:
      - `mode`
      - `state()`
      - `sync(req): Promise<SyncRes | 'REBUILDING'>`
      - `views(): StreamView[]`
      - `entriesAfter(c, after, limit): WireEntry[]`
      - `setCellStatus(st: StreamStatus): boolean` (relay)
      - `resetCell(): void` (relay)
      - `close(): void` (idempotent)
    - `createIngest(o): Ingest`

- [ ] **Step 1: Write the failing store tests**

`apps/server/test/store.test.ts`:
```ts
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GroupCommit, openDb, pragmas, type Row } from '../src/store.ts';

let dir: string, path: string, db: Database;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'saakshi-store-')); path = join(dir, 's.db'); db = openDb(path).db; });
afterEach(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });

const row = (seq: number): Row => ({ exam: 'E', shift: 'S', attempt: 1, cand: 'C', seq, keyEpoch: 1, h: 'a'.repeat(64), line: `l${seq}`, env: new Uint8Array([seq % 256]) });
const count = (): number => { const d = new Database(path); try { return (d.query('SELECT count(*) AS n FROM entries').get() as { n: number }).n; } finally { d.close(); } };

test('durability pragmas apply: WAL, synchronous=FULL, fullfsync on macOS', () => {
  const p = pragmas(db);
  expect(p.journal_mode).toBe('wal');
  expect(p.synchronous).toBe(2);
  if (process.platform === 'darwin') { expect(p.fullfsync).toBe(1); expect(p.checkpoint_fullfsync).toBe(1); }
});

test('openDb reports a fresh file once', () => {
  expect(openDb(join(dir, 'new.db')).fresh).toBe(true);
  expect(openDb(join(dir, 'new.db')).fresh).toBe(false);
});

test('rows are invisible to other readers until the group commits; the promise resolves only after COMMIT', async () => {
  let committed = 0;
  const gc = new GroupCommit(db, (rows) => { committed += rows.length; });
  const done = gc.add([row(1), row(2), row(3)]);
  expect(count()).toBe(0);
  expect(committed).toBe(0);
  await done;
  expect(count()).toBe(3);
  expect(committed).toBe(3);
});

test('500 pending rows flush at once, without waiting for the timer', () => {
  const gc = new GroupCommit(db, () => {}, { ms: 10_000, max: 500 });
  void gc.add(Array.from({ length: 500 }, (_, i) => row(i + 1)));
  expect(count()).toBe(500);
  expect(gc.transactions).toBe(1);
});

test('concurrent adds inside one 10 ms window share one transaction', async () => {
  const gc = new GroupCommit(db, () => {});
  await Promise.all(Array.from({ length: 20 }, (_, i) => gc.add([row(i + 1)])));
  expect(gc.transactions).toBe(1);
  expect(count()).toBe(20);
});

test('a failed commit rejects its waiters and calls onFatal (crash-only)', async () => {
  let fatal: unknown;
  const gc = new GroupCommit(db, () => {}, { ms: 1, onFatal: (e) => { fatal = e; } });
  await gc.add([row(1)]);
  await expect(gc.add([row(1)])).rejects.toThrow();
  expect(fatal).toBeDefined();
});
```

Run: `cd apps/server && bun test ./test/store.test.ts`. Expected: FAIL with `Cannot find module '../src/store.ts'`.

- [ ] **Step 2: Implement `store.ts`, then run the tests and confirm they pass**

`apps/server/src/store.ts`:
```ts
import { Database } from 'bun:sqlite';
import { existsSync } from 'node:fs';
import type { Ctx } from '@saakshi/core/protocol';

export interface Row extends Ctx { seq: number; keyEpoch: number; h: string; line: string; env: Uint8Array }

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
  db.run(`CREATE TABLE IF NOT EXISTS evidence (id INTEGER PRIMARY KEY, at INTEGER NOT NULL, code TEXT NOT NULL,
    stream TEXT NOT NULL, seq INTEGER NOT NULL, reason TEXT NOT NULL, line TEXT NOT NULL)`);
  db.run('CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)');
  return { db, fresh };
}

export function pragmas(db: Database): { journal_mode: string; synchronous: number; fullfsync: number; checkpoint_fullfsync: number } {
  const one = <T>(name: string): T => Object.values(db.query(`PRAGMA ${name}`).get() as Record<string, T>)[0];
  return { journal_mode: one<string>('journal_mode'), synchronous: one<number>('synchronous'), fullfsync: one<number>('fullfsync'), checkpoint_fullfsync: one<number>('checkpoint_fullfsync') };
}

interface Waiter { resolve: () => void; reject: (e: unknown) => void }

/** Single-writer group commit: one transaction every `ms` or every `max` rows; waiters resolve only after COMMIT. */
export class GroupCommit {
  transactions = 0;
  #rows: Row[] = [];
  #waiters: Waiter[] = [];
  #timer: ReturnType<typeof setTimeout> | undefined;
  #insert: (rows: Row[]) => void;
  #onCommit: (rows: Row[]) => void;
  #ms: number;
  #max: number;
  #onFatal: (e: unknown) => void;

  constructor(db: Database, onCommit: (rows: Row[]) => void, opts: { ms?: number; max?: number; onFatal?: (e: unknown) => void } = {}) {
    const ins = db.query('INSERT INTO entries (exam, shift, attempt, cand, seq, key_epoch, h, line, env) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    this.#insert = db.transaction((rows: Row[]) => {
      for (const r of rows) ins.run(r.exam, r.shift, r.attempt, r.cand, r.seq, r.keyEpoch, r.h, r.line, r.env);
    });
    this.#onCommit = onCommit;
    this.#ms = opts.ms ?? 10;
    this.#max = opts.max ?? 500;
    // ponytail: crash-only — in-memory heads are ahead of disk after a failed COMMIT, so restart and reload.
    this.#onFatal = opts.onFatal ?? ((e) => { console.error('group commit failed; exiting so the chain reloads from disk', e); process.exit(1); });
  }

  add(rows: Row[]): Promise<void> {
    this.#rows.push(...rows);
    const p = new Promise<void>((resolve, reject) => this.#waiters.push({ resolve, reject }));
    if (this.#rows.length >= this.#max) this.flush();
    else this.#timer ??= setTimeout(() => this.flush(), this.#ms);
    return p;
  }

  flush(): void {
    clearTimeout(this.#timer);
    this.#timer = undefined;
    const rows = this.#rows, waiters = this.#waiters;
    this.#rows = [];
    this.#waiters = [];
    if (rows.length) {
      try { this.#insert(rows); this.transactions++; }
      catch (e) { for (const w of waiters) w.reject(e); this.#onFatal(e); return; }
      this.#onCommit(rows);
    }
    for (const w of waiters) w.resolve();
  }
}
```
Run: `bun test ./test/store.test.ts`. Expected: 6 pass.

- [ ] **Step 3: Write the failing ingest tests**

`apps/server/test/ingest.test.ts`:
```ts
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hexToBytes } from '@saakshi/core/bytes';
import { ackMessage } from '@saakshi/core/ack';
import { cellKey, devSeat, devSeatKey, type KeysFile } from '@saakshi/core/dev';
import { signedLine } from '@saakshi/core/journal';
import { sealBody, signer } from '@saakshi/core/node';
import type { Header } from '@saakshi/core/protocol';
import { nobleVerifier } from '@saakshi/core/sig';
import { toB64, type SyncRes } from '@saakshi/core/wire';
import { createIngest, type Ingest, type IngestOpts, type Mode } from '../src/ingest.ts';
import { openDb } from '../src/store.ts';
import { SimSeat } from '../../../tools/sim-seat.ts';

const keys = JSON.parse(readFileSync(new URL('../../../fixtures/keys.json', import.meta.url), 'utf8')) as KeysFile;
const cell = cellKey(keys, 'cell-1');
let dir: string;
const opened: Ingest[] = [];
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'saakshi-ingest-')); });
afterEach(() => { for (const n of opened.splice(0)) n.close(); rmSync(dir, { recursive: true, force: true }); });

/** A node on dir/<name>.db. `fresh` defaults to false so cells start LIVE unless a test is about rebuilding. */
function node(mode: Mode, o: { name?: string; fresh?: boolean } & Partial<IngestOpts> = {}): Ingest {
  const { db } = openDb(join(dir, `${o.name ?? mode}.db`));
  const n = createIngest({ mode, db, fresh: o.fresh ?? false, seatKey: devSeatKey(keys), cell: mode === 'cell' ? cell : { pub: cell.pub }, ...o });
  opened.push(n);
  return n;
}
const ok = (r: SyncRes | 'REBUILDING'): SyncRes => { if (r === 'REBUILDING') throw new Error('unexpected REBUILDING'); return r; };
const push = async (n: Ingest, s: SimSeat, entries = s.entries) => ok(await n.sync({ entries, streams: [{ ...s.ctx, head: s.head }] }));
const rows = (name: string, table = 'entries'): { code?: string }[] => { const d = new Database(join(dir, `${name}.db`)); try { return d.query(`SELECT * FROM ${table}`).all() as { code?: string }[]; } finally { d.close(); } };

for (const mode of ['relay', 'cell'] as const) {
  test(`${mode}: accepts a valid chain and reports head and headH`, async () => {
    const n = node(mode), s = new SimSeat(keys, 'C0001', cell.pub);
    s.add(5);
    const r = await push(n, s);
    expect(r.rejected).toEqual([]);
    expect(r.streams[0]).toMatchObject({ cand: 'C0001', head: 5, headH: s.hs[4], need: false });
    expect(rows(mode).length).toBe(5);
  });

  test(`${mode}: an exact resend is a no-op`, async () => {
    const n = node(mode), s = new SimSeat(keys, 'C0001', cell.pub);
    s.add(5);
    await push(n, s);
    const r = await push(n, s);
    expect(r.rejected).toEqual([]);
    expect(r.streams[0].head).toBe(5);
    expect(rows(mode).length).toBe(5);
    expect(rows(mode, 'evidence')).toEqual([]);
  });

  test(`${mode}: a gap is answered with NEED and the sender resends from head+1`, async () => {
    const n = node(mode), s = new SimSeat(keys, 'C0001', cell.pub);
    s.add(6);
    await push(n, s, s.entries.slice(0, 2));
    const r = await push(n, s, s.entries.slice(4));
    expect(r.streams[0]).toMatchObject({ head: 2, need: true });
    expect(r.rejected).toEqual([]);
    const r2 = await push(n, s, s.after(r.streams[0].head));
    expect(r2.streams[0]).toMatchObject({ head: 6, need: false });
  });

  test(`${mode}: an invalid signature at a stored seq is BAD_SUBMISSION, never FORK`, async () => {
    const n = node(mode), s = new SimSeat(keys, 'C0001', cell.pub);
    s.add(3);
    await push(n, s);
    const other: Header = { ...s.headers[1], bodyCommit: 'ab'.repeat(32) };
    const foreignKey = { line: signedLine(other, signer(devSeat(keys, 'C0002')!)), env: s.entries[1].env };
    const flipped = { line: s.entries[2].line.replace(/"([0-9a-f])([0-9a-f]{127})"\]$/, (_, a: string, b: string) => `"${a === '0' ? '1' : '0'}${b}"]`), env: s.entries[2].env };
    const garbage = { line: 'not json', env: '' };
    const r = ok(await n.sync({ entries: [foreignKey, flipped, garbage], streams: [] }));
    expect(r.rejected.map((x) => x.code)).toEqual(['BAD_SUBMISSION', 'BAD_SUBMISSION', 'BAD_SUBMISSION']);
    expect(r.streams[0].head).toBe(3);
    expect(rows(mode, 'evidence').map((e) => e.code)).toEqual(['BAD_SUBMISSION', 'BAD_SUBMISSION', 'BAD_SUBMISSION']);
  });

  test(`${mode}: a validly signed different entry at a stored seq, or a broken prev, is FORK`, async () => {
    const n = node(mode), s = new SimSeat(keys, 'C0001', cell.pub);
    s.add(3);
    await push(n, s);
    const badPrev = s.make(4, 'cd'.repeat(32), 'A').entry;
    const r = ok(await n.sync({ entries: [s.alt(2), badPrev], streams: [] }));
    expect(r.rejected.map((x) => x.code)).toEqual(['FORK', 'FORK']);
    expect(r.streams[0].head).toBe(3);
    expect(rows(mode, 'evidence').map((e) => e.code)).toEqual(['FORK', 'FORK']);
  });

  test(`${mode}: an unknown key epoch, seq 0 and a short envelope are BAD_SUBMISSION`, async () => {
    const n = node(mode);
    const e2 = new SimSeat(keys, 'C0001', cell.pub, 2); e2.add(1);
    const s = new SimSeat(keys, 'C0002', cell.pub);
    const seq0 = s.make(0, 'ab'.repeat(32), 'A').entry;
    s.add(1);
    const short = { line: s.entries[0].line, env: toB64(new Uint8Array(40)) };
    const r = ok(await n.sync({ entries: [e2.entries[0], seq0, short], streams: [] }));
    expect(r.rejected.map((x) => [x.code, x.reason.split(' ')[0]])).toEqual([['BAD_SUBMISSION', 'no'], ['BAD_SUBMISSION', 'seq'], ['BAD_SUBMISSION', 'envelope']]);
  });

  test(`${mode}: a hello alone returns status and updates the seat grid view`, async () => {
    const seen: number[] = [];
    const n = node(mode, { onView: (v) => seen.push(v.senderHead), now: () => 1_000 });
    const r = ok(await n.sync({ entries: [], streams: [{ exam: 'DEMO-2026', shift: 'S1', attempt: 1, cand: 'C0004', head: 7 }] }));
    expect(r.streams[0]).toMatchObject({ cand: 'C0004', head: 0, headH: '', need: false });
    expect(n.views()[0]).toMatchObject({ cand: 'C0004', head: 0, senderHead: 7, seenAt: 1_000 });
    expect(seen).toEqual([7]);
  });
}

test('cell: a body that does not open or does not match bodyCommit is BAD_SUBMISSION; the relay cannot tell', async () => {
  const s = new SimSeat(keys, 'C0001', cell.pub);
  s.add(3);
  const swapped = [s.entries[0], { line: s.entries[1].line, env: s.entries[2].env }];
  const c = ok(await node('cell').sync({ entries: swapped, streams: [] }));
  expect(c.rejected).toEqual([{ index: 1, code: 'BAD_SUBMISSION', reason: expect.stringMatching(/^body:/) }]);
  const r = ok(await node('relay').sync({ entries: swapped, streams: [] }));
  expect(r.rejected).toEqual([]);
});

test('relay: stores only headers and sealed envelopes — no answer text reaches its disk', async () => {
  const s = new SimSeat(keys, 'C0001', cell.pub);
  s.add(1);
  const marker = 'हिन्दी-SECRET-ANSWER';
  const { entry } = s.make(2, s.hs[0], 'B', { item: 'I17', state: 'A', answer: 'B', meta: [4200, [marker]] });
  const relay = node('relay');
  expect(ok(await relay.sync({ entries: [s.entries[0], entry], streams: [] })).rejected).toEqual([]);
  relay.close();
  const bytes = readFileSync(join(dir, 'relay.db'));
  const wal = (() => { try { return readFileSync(join(dir, 'relay.db-wal')); } catch { return Buffer.alloc(0); } })();
  expect(Buffer.concat([bytes, wal]).includes(Buffer.from(marker))).toBe(false);
});

test('cell: the countersigned ack covers the head h and verifies under the cell public key (native and noble)', async () => {
  const s = new SimSeat(keys, 'C0001', cell.pub);
  s.add(4);
  const st = (await push(node('cell'), s)).streams[0];
  expect(st.ack).toMatchObject({ keyEpoch: 1, seq: 4, h: s.hs[3] });
  expect(nobleVerifier(cell.pub)(ackMessage({ ...s.ctx, keyEpoch: 1, seq: 4, h: s.hs[3] }), hexToBytes(st.ack!.sig))).toBe(true);
});

test('cell restart: heads reload from disk, a resend is a no-op, and acks from the file-held key still verify', async () => {
  const s = new SimSeat(keys, 'C0001', cell.pub);
  s.add(8);
  const first = node('cell');
  await push(first, s);
  first.close();
  const again = node('cell');
  expect(again.views()[0]).toMatchObject({ cand: 'C0001', head: 8 });
  const r = await push(again, s);
  expect(r.rejected).toEqual([]);
  expect(nobleVerifier(cell.pub)(ackMessage({ ...s.ctx, keyEpoch: 1, seq: 8, h: s.hs[7] }), hexToBytes(r.streams[0].ack!.sig))).toBe(true);
  expect(rows('cell').length).toBe(8);
});

test('cell REBUILDING: 503 for live traffic, replay accepted, LIVE after done, and the state survives a crash mid-rebuild', async () => {
  const s = new SimSeat(keys, 'C0001', cell.pub);
  s.add(5);
  const states: string[] = [];
  const c = node('cell', { fresh: true, onState: (x) => states.push(x) });
  expect(c.state()).toBe('REBUILDING');
  expect(await c.sync({ entries: s.entries, streams: [] })).toBe('REBUILDING');
  ok(await c.sync({ entries: s.entries.slice(0, 3), streams: [], replay: true }));
  c.close();                                                       // killed mid-rebuild
  const c2 = node('cell');                                         // file exists now, so fresh = false
  expect(c2.state()).toBe('REBUILDING');
  ok(await c2.sync({ entries: s.after(3), streams: [], replay: true }));
  ok(await c2.sync({ entries: [], streams: [], replay: true, done: true }));
  expect(c2.state()).toBe('LIVE');
  expect(c2.views()[0].head).toBe(5);
  c2.close();
  expect(node('cell').state()).toBe('LIVE');
  expect(states).toEqual([]);                                      // first node never reached LIVE
});

test('relay: keeps only cell acks that verify over its own h; resetCell forgets them', async () => {
  const s = new SimSeat(keys, 'C0001', cell.pub);
  s.add(3);
  const relay = node('relay'), c = node('cell');
  await push(relay, s);
  const st = (await push(c, s)).streams[0];
  expect(relay.setCellStatus({ ...st, ack: { ...st.ack!, sig: st.ack!.sig.replace(/^./, (x) => (x === '0' ? '1' : '0')) } })).toBe(true);
  expect((await push(relay, s)).streams[0].ack).toBeUndefined();
  relay.setCellStatus({ ...st, ack: { ...st.ack!, h: 'ee'.repeat(32) } });
  expect((await push(relay, s)).streams[0].ack).toBeUndefined();
  relay.setCellStatus(st);
  expect((await push(relay, s)).streams[0].ack).toEqual(st.ack);
  expect(relay.views()[0].cellHead).toBe(3);
  relay.resetCell();
  expect(relay.views()[0].cellHead).toBe(0);
  expect((await push(relay, s)).streams[0].ack).toBeUndefined();
});

test('a response is sent only after its rows are committed (visible to another connection)', async () => {
  const n = node('relay'), s = new SimSeat(keys, 'C0005', cell.pub);
  s.add(50);
  await push(n, s);
  expect(rows('relay').length).toBe(50);
  expect(n.entriesAfter(s.ctx, 45, 10).map((e) => e.line)).toEqual(s.entries.slice(45).map((e) => e.line));
});
```
Run: `bun test ./test/ingest.test.ts`. Expected: FAIL with `Cannot find module '../src/ingest.ts'`.

- [ ] **Step 4: Implement `ingest.ts`**

`apps/server/src/ingest.ts`:
```ts
import type { Database } from 'bun:sqlite';
import { ackMessage } from '@saakshi/core/ack';
import { hexToBytes, toHex } from '@saakshi/core/bytes';
import { parseSignedLine } from '@saakshi/core/journal';
import { openBody, signer, verifier } from '@saakshi/core/node';
import { entryHash, genesisPrev, type Ctx } from '@saakshi/core/protocol';
import type { Verify } from '@saakshi/core/sig';
import {
  fromB64, streamKey, toB64,
  type NodeState, type Rejection, type RejectCode, type StreamStatus, type StreamView, type SyncReq, type SyncRes, type WireAck, type WireEntry,
} from '@saakshi/core/wire';
import { GroupCommit, type Row } from './store.ts';

export type Mode = 'cell' | 'relay';

export interface IngestOpts {
  mode: Mode;
  db: Database;
  /** The DB file did not exist: a cell starts REBUILDING. */
  fresh: boolean;
  /** Which seat key signs (cand, keyEpoch). DEV: devSeatKey(keys). */
  seatKey: (cand: string, keyEpoch: number) => Uint8Array | undefined;
  /** relay: the cell public key (to check its acks); cell: its key pair (read from the keys file, never the DB). */
  cell: { pub: Uint8Array; priv?: Uint8Array };
  /** cell: how many relays must send `done` before REBUILDING ends (default 1). */
  rebuildRelays?: number;
  onView?: (v: StreamView) => void;
  onState?: (s: NodeState) => void;
  now?: () => number;
  commit?: { ms?: number; max?: number };
}

export interface Ingest {
  readonly mode: Mode;
  state(): NodeState;
  sync(req: SyncReq): Promise<SyncRes | 'REBUILDING'>;
  views(): StreamView[];
  /** Committed entries after `after`, oldest first (what the relay forwards). */
  entriesAfter(c: Ctx, after: number, limit: number): WireEntry[];
  /** relay: record what the cell reported; keeps the ack only if it verifies over our own h. */
  setCellStatus(st: StreamStatus): boolean;
  /** relay: the cell is REBUILDING — forget its heads and acks. */
  resetCell(): void;
  close(): void;
}

interface Stream { ctx: Ctx; hs: string[]; durable: number; epoch: number; ack?: WireAck; cellHead: number; senderHead: number; seenAt: number }

const ENV_MIN = 65 + 24 + 16 + 16;
const SIG_HEX = /^[0-9a-f]{128}$/;
const ctxOf = (x: Ctx): Ctx => ({ exam: x.exam, shift: x.shift, attempt: x.attempt, cand: x.cand });

export function createIngest(o: IngestOpts): Ingest {
  const { db, mode } = o;
  const now = o.now ?? Date.now;
  if (mode === 'cell' && !o.cell.priv) throw new Error('cell mode needs the cell private key');
  const cellSign = mode === 'cell' ? signer({ priv: o.cell.priv!, pub: o.cell.pub }) : undefined;
  const cellVerify = verifier(o.cell.pub);
  const streams = new Map<string, Stream>();
  const verifiers = new Map<string, Verify>();
  const getMeta = db.query('SELECT v FROM meta WHERE k = ?');
  const setMeta = db.query('INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v');
  const addEvidence = db.query('INSERT INTO evidence (at, code, stream, seq, reason, line) VALUES (?, ?, ?, ?, ?, ?)');
  const readAfter = db.query('SELECT line, env FROM entries WHERE exam = ? AND shift = ? AND attempt = ? AND cand = ? AND seq > ? ORDER BY seq LIMIT ?');
  let closed = false;

  let state: NodeState = mode === 'cell' && (o.fresh || (getMeta.get('state') as { v: string } | null)?.v === 'REBUILDING') ? 'REBUILDING' : 'LIVE';
  if (state === 'REBUILDING') setMeta.run('state', 'REBUILDING');
  let dones = 0;

  const get = (c: Ctx): Stream => {
    const k = streamKey(c);
    let s = streams.get(k);
    if (!s) streams.set(k, (s = { ctx: ctxOf(c), hs: [], durable: 0, epoch: 0, cellHead: mode === 'cell' ? 0 : -1, senderHead: -1, seenAt: 0 }));
    return s;
  };
  const view = (s: Stream): StreamView => ({ ...s.ctx, head: s.durable, cellHead: mode === 'cell' ? s.durable : s.cellHead, senderHead: s.senderHead, seenAt: s.seenAt });
  const emit = (s: Stream) => o.onView?.(view(s));

  // ponytail: every h stays in memory (~100 B per entry); page from the DB if one node outgrows RAM.
  for (const r of db.query('SELECT exam, shift, attempt, cand, seq, h, key_epoch FROM entries ORDER BY exam, shift, attempt, cand, seq').all() as (Ctx & { seq: number; h: string; key_epoch: number })[]) {
    const s = get(r);
    s.hs.push(r.h);
    s.durable = r.seq;
    s.epoch = r.key_epoch;
  }

  const commit = new GroupCommit(db, (rows) => {
    const touched = new Set<Stream>();
    for (const r of rows) { const s = get(r); s.durable = r.seq; s.epoch = r.keyEpoch; touched.add(s); }
    for (const s of touched) emit(s);
  }, o.commit);

  const verifierFor = (cand: string, keyEpoch: number): Verify | undefined => {
    const k = `${cand}\u0000${keyEpoch}`;
    let v = verifiers.get(k);
    if (!v) {
      const pub = o.seatKey(cand, keyEpoch);
      if (!pub) return undefined;
      verifiers.set(k, (v = verifier(pub)));
    }
    return v;
  };

  /** cell: sign lazily, once per new durable head. relay: the last verified cell ack. */
  const ackOf = (s: Stream): WireAck | undefined => {
    if (!cellSign) return s.ack;
    if (s.durable === 0) return undefined;
    if (s.ack?.seq !== s.durable) {
      const a = { ...s.ctx, keyEpoch: s.epoch, seq: s.durable, h: s.hs[s.durable - 1] };
      s.ack = { keyEpoch: a.keyEpoch, seq: a.seq, h: a.h, sig: toHex(cellSign(ackMessage(a))) };
    }
    return s.ack;
  };

  async function sync(req: SyncReq): Promise<SyncRes | 'REBUILDING'> {
    if (state === 'REBUILDING' && !req.replay) return 'REBUILDING';
    const t = now();
    const touched = new Map<Stream, boolean>();            // stream → a gap was seen (NEED)
    const rejected: Rejection[] = [];
    const evidence: [RejectCode, string, number, string, string][] = [];
    const rows: Row[] = [];

    for (const hl of req.streams) {
      const s = get(hl);
      const changed = s.senderHead !== hl.head || t - s.seenAt > 5_000;
      s.senderHead = hl.head;
      s.seenAt = t;
      if (changed) emit(s);
      touched.set(s, touched.get(s) ?? false);
    }

    // Synchronous from here to commit.add: no other request interleaves with this validation.
    req.entries.forEach((e, index) => {
      const reject = (code: RejectCode, reason: string, key = '', seq = 0) => { rejected.push({ index, code, reason }); evidence.push([code, key, seq, reason, e.line]); };
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
      const head = s.hs.length;
      if (hd.seq > head + 1) { touched.set(s, true); return; }            // gap → NEED{cand, head}
      // 2. prev against the stored chain
      const h = toHex(entryHash(hd));
      if (hd.prev !== (hd.seq === 1 ? genesisPrev(hd) : s.hs[hd.seq - 2])) return reject('FORK', `seq ${hd.seq}: prev does not match the stored chain`, key, hd.seq);
      // 3. fork or duplicate
      if (hd.seq <= head) return s.hs[hd.seq - 1] === h ? undefined : reject('FORK', `seq ${hd.seq} already holds a different signed entry`, key, hd.seq);
      let env: Uint8Array;
      try { env = fromB64(e.env); } catch { return bad('envelope is not base64'); }
      if (env.length < ENV_MIN) return bad('envelope too short');
      if (mode === 'cell') {
        try { openBody(o.cell.priv!, { ...hd }, env, hd.bodyCommit); } catch (err) { return bad(`body: ${(err as Error).message}`); }
      }
      s.hs.push(h);
      rows.push({ ...ctxOf(hd), seq: hd.seq, keyEpoch: hd.keyEpoch, h, line: e.line, env });
    });

    if (evidence.length) db.transaction(() => { for (const ev of evidence) addEvidence.run(t, ...ev); })();
    if (rows.length) await commit.add(rows);
    if (req.replay && req.done && state === 'REBUILDING' && ++dones >= (o.rebuildRelays ?? 1)) {
      state = 'LIVE';
      setMeta.run('state', 'LIVE');
      o.onState?.(state);
    }
    return {
      streams: [...touched].map(([s, need]) => ({ ...s.ctx, head: s.durable, headH: s.durable ? s.hs[s.durable - 1] : '', need, ack: ackOf(s) })),
      rejected,
    };
  }

  return {
    mode,
    state: () => state,
    sync,
    views: () => [...streams.values()].map(view),
    entriesAfter: (c, after, limit) =>
      (readAfter.all(c.exam, c.shift, c.attempt, c.cand, after, limit) as { line: string; env: Uint8Array }[]).map((r) => ({ line: r.line, env: toB64(r.env) })),
    setCellStatus(st) {
      const s = streams.get(streamKey(st));
      if (!s || mode !== 'relay') return false;
      s.cellHead = st.head;
      const a = st.ack;
      if (a && a.seq === st.head && a.seq >= 1 && s.hs[a.seq - 1] === a.h && SIG_HEX.test(a.sig)
        && cellVerify(ackMessage({ ...s.ctx, keyEpoch: a.keyEpoch, seq: a.seq, h: a.h }), hexToBytes(a.sig))) {
        s.ack = { keyEpoch: a.keyEpoch, seq: a.seq, h: a.h, sig: a.sig };
      }
      emit(s);
      return true;
    },
    resetCell() {
      for (const s of streams.values()) { s.cellHead = 0; s.ack = undefined; emit(s); }
    },
    close() {
      if (closed) return;
      closed = true;
      commit.flush();
      db.close();
    },
  };
}
```

- [ ] **Step 5: Run the ingest tests**

Run: `cd apps/server && bun test ./test && pnpm typecheck`
Expected: all pass (the store, ingest and sim-seat suites). tsc is clean.

- [ ] **Step 6: Hand back for review and commit** with the message `feat(server): durable ingest — check order, BAD_SUBMISSION vs FORK, NEED, group commit, cell acks, REBUILDING`.

---

### Task 3: HTTP routes and SSE hub

**Files:**
- Create: `apps/server/src/sse.ts`, `apps/server/src/serve.ts`
- Test: `apps/server/test/sse.test.ts`, `apps/server/test/serve.test.ts`. The serve tests bind ports, so run them with the sandbox disabled.

**Interfaces:**
- Consumes: `parseSyncReq` and the wire types (Task 1). There is no dependency on Task 2; the tests use a fake `Api`.
- Produces:
  - `sse.ts`:
    - `interface Timeouts { timeout(req: Request, seconds: number): void }`
    - `class Hub(snapshot: () => unknown, opts?: { ring?: number; pingMs?: number })` with `boot`, `lastId`, `publish(event, data)`, `catchUp(lastEventId: string | null): string[]` and `response(req, server: Timeouts): Response`
  - `serve.ts`:
    - `interface Api { readonly mode; state(); sync(req); views() }` (an `Ingest` satisfies it)
    - `interface ServeOpts { port; hostname?; idleTimeout?; consoleHtml?: HTMLBundle }`
    - `serve(api, hub, o): ReturnType<typeof Bun.serve>`
    - `heads(api): HeadsRes`

- [ ] **Step 1: Write the failing tests**

`apps/server/test/sse.test.ts`:
```ts
import { expect, test } from 'bun:test';
import { Hub } from '../src/sse.ts';

test('frames are valid SSE: id, event, one JSON data line, blank line', () => {
  const hub = new Hub(() => ({ snap: 1 }));
  hub.publish('stream', { cand: 'C0001', head: 3 });
  const [frame] = hub.catchUp(`${hub.boot}-0`);
  expect(frame).toBe(`id: ${hub.boot}-1\nevent: stream\ndata: {"cand":"C0001","head":3}\n\n`);
  expect(hub.lastId).toBe(`${hub.boot}-1`);
});

test('Last-Event-ID inside the ring replays only the missed events', () => {
  const hub = new Hub(() => ({}));
  for (let i = 1; i <= 5; i++) hub.publish('stream', { i });
  const frames = hub.catchUp(`${hub.boot}-3`);
  expect(frames.map((f) => f.split('\n')[0])).toEqual([`id: ${hub.boot}-4`, `id: ${hub.boot}-5`]);
  expect(hub.catchUp(hub.lastId)).toEqual([]);
});

test('first connect, another boot, a future id, or an id older than the ring get a snapshot', () => {
  const hub = new Hub(() => ({ mode: 'relay' }), { ring: 3 });
  for (let i = 1; i <= 6; i++) hub.publish('stream', { i });
  const snap = `id: ${hub.boot}-6\nevent: snapshot\ndata: {"mode":"relay"}\n\n`;
  for (const id of [null, 'zzz-2', `${hub.boot}-99`, `${hub.boot}-1`, 'garbage']) expect(hub.catchUp(id)).toEqual([snap]);
  expect(hub.catchUp(`${hub.boot}-3`).length).toBe(3);   // oldest kept is 4; 3 is exactly one before it
});
```

`apps/server/test/serve.test.ts`:
```ts
import { afterEach, expect, test } from 'bun:test';
import type { NodeState, StreamView, SyncReq, SyncRes } from '@saakshi/core/wire';
import { serve, type Api } from '../src/serve.ts';
import { Hub } from '../src/sse.ts';

const servers: { stop(force?: boolean): void }[] = [];
afterEach(() => { for (const s of servers.splice(0)) s.stop(true); });

function fake(state: NodeState = 'LIVE'): Api & { got: SyncReq[] } {
  const got: SyncReq[] = [];
  return {
    mode: 'cell', got, state: () => state, views: (): StreamView[] => [],
    async sync(r: SyncReq): Promise<SyncRes | 'REBUILDING'> { got.push(r); return state === 'REBUILDING' && !r.replay ? 'REBUILDING' : { streams: [], rejected: [] }; },
  };
}
function start(api: Api, hub = new Hub(() => ({ mode: api.mode, state: api.state(), streams: [] })), idleTimeout?: number) {
  const s = serve(api, hub, { port: 0, hostname: '127.0.0.1', idleTimeout });
  servers.push(s);
  return { url: `http://127.0.0.1:${s.port}`, hub };
}
async function sse(url: string, lastId?: string) {
  const res = await fetch(url, { headers: lastId ? { 'last-event-id': lastId } : {} });
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = '';
  return {
    res,
    async until(pred: (b: string) => boolean, ms = 3000): Promise<string> {
      const t0 = Date.now();
      while (!pred(buf)) {
        const left = ms - (Date.now() - t0);
        if (left <= 0) throw new Error(`timed out; got: ${buf}`);
        const r = await Promise.race([reader.read(), Bun.sleep(left).then(() => null)]);
        if (r === null) continue;
        if (r.done) throw new Error(`stream closed; got: ${buf}`);
        buf += dec.decode(r.value);
      }
      return buf;
    },
    close: () => reader.cancel(),
  };
}
const post = (url: string, body: string) => fetch(`${url}/v1/sync`, { method: 'POST', headers: { 'content-type': 'application/json' }, body });

test('POST /v1/sync: 400 on bad JSON or shape, 200 with the result, 503 while REBUILDING (replay still accepted)', async () => {
  const api = fake();
  const { url } = start(api);
  expect((await post(url, '{nope')).status).toBe(400);
  const bad = await post(url, JSON.stringify({ entries: 'x' }));
  expect(bad.status).toBe(400);
  expect((await bad.json()).error).toMatch(/^sync:/);
  const good = await post(url, JSON.stringify({ entries: [], streams: [] }));
  expect(good.status).toBe(200);
  expect(await good.json()).toEqual({ streams: [], rejected: [] });

  const { url: rb } = start(fake('REBUILDING'));
  const r = await post(rb, JSON.stringify({ entries: [], streams: [] }));
  expect(r.status).toBe(503);
  expect(await r.json()).toEqual({ state: 'REBUILDING' });
  expect((await post(rb, JSON.stringify({ entries: [], streams: [], replay: true }))).status).toBe(200);
});

test('GET /v1/heads, 404 elsewhere, and no /console without a page', async () => {
  const { url } = start(fake());
  expect(await (await fetch(`${url}/v1/heads`)).json()).toEqual({ mode: 'cell', state: 'LIVE', streams: [] });
  expect((await fetch(`${url}/nope`)).status).toBe(404);
  expect((await fetch(`${url}/console`)).status).toBe(404);
});

test('SSE: retry, snapshot, live events with ids, and :ping frames', async () => {
  const api = fake();
  const hub = new Hub(() => ({ mode: 'cell', state: 'LIVE', streams: [] }), { pingMs: 100 });
  const { url } = start(api, hub);
  const s = await sse(`${url}/v1/events`);
  expect(s.res.headers.get('content-type')).toBe('text/event-stream');
  await s.until((b) => b.includes('event: snapshot'));
  hub.publish('stream', { cand: 'C0001', head: 1 });
  const b = await s.until((x) => x.includes('event: stream') && x.includes(':ping'));
  expect(b.startsWith('retry: 2000\n\n')).toBe(true);
  expect(b).toContain(`id: ${hub.boot}-1\nevent: stream\ndata: {"cand":"C0001","head":1}`);
  await s.close();
});

test('SSE outlives Bun\'s idle timeout (server.timeout(req, 0))', async () => {
  const hub = new Hub(() => ({}), { pingMs: 60_000 });
  const { url } = start(fake(), hub, 2);
  const s = await sse(`${url}/v1/events`);
  await s.until((b) => b.includes('event: snapshot'));
  await Bun.sleep(6_000);                                   // well past idleTimeout: 2
  hub.publish('state', { state: 'LIVE' });
  await s.until((b) => b.includes('event: state'));
  await s.close();
});

test('Last-Event-ID replays only the missed events over HTTP', async () => {
  const hub = new Hub(() => ({}));
  const { url } = start(fake(), hub);
  hub.publish('stream', { n: 1 });
  const seen = hub.lastId;
  hub.publish('stream', { n: 2 });
  hub.publish('stream', { n: 3 });
  const s = await sse(`${url}/v1/events`, seen);
  const b = await s.until((x) => x.includes('{"n":3}'));
  expect(b).not.toContain('{"n":1}');
  expect(b).not.toContain('event: snapshot');
  expect(b).toContain('{"n":2}');
  await s.close();
});
```
Run: `cd apps/server && bun test ./test/sse.test.ts ./test/serve.test.ts` (with the sandbox disabled). Expected: FAIL with `Cannot find module`.

- [ ] **Step 2: Implement**

`apps/server/src/sse.ts`:
```ts
/** The slice of Bun's Server we need (avoids depending on its generic signature). */
export interface Timeouts { timeout(req: Request, seconds: number): void }

interface Frame { n: number; text: string }

/** SSE fan-out with event ids `<boot>-<n>`, a replay ring for Last-Event-ID, a snapshot fallback and 15 s pings. */
export class Hub {
  readonly boot = Date.now().toString(36);
  #n = 0;
  #ring: Frame[] = [];
  #subs = new Set<(text: string) => void>();
  #snapshot: () => unknown;
  #ringSize: number;
  #pingMs: number;

  constructor(snapshot: () => unknown, opts: { ring?: number; pingMs?: number } = {}) {
    this.#snapshot = snapshot;
    this.#ringSize = opts.ring ?? 1000;
    this.#pingMs = opts.pingMs ?? 15_000;
  }

  get lastId(): string { return `${this.boot}-${this.#n}`; }

  publish(event: string, data: unknown): void {
    const n = ++this.#n;
    const text = `id: ${this.boot}-${n}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    this.#ring.push({ n, text });
    if (this.#ring.length > this.#ringSize) this.#ring.shift();
    for (const send of this.#subs) send(text);
  }

  /** What a (re)connecting client gets first: the missed events if its id is still in the ring, else one snapshot. */
  catchUp(lastEventId: string | null): string[] {
    const m = lastEventId?.match(/^([0-9a-z]+)-(\d+)$/);
    if (m && m[1] === this.boot) {
      const last = Number(m[2]), oldest = this.#ring[0]?.n ?? this.#n + 1;
      if (last <= this.#n && last >= oldest - 1) return this.#ring.filter((f) => f.n > last).map((f) => f.text);
    }
    return [`id: ${this.lastId}\nevent: snapshot\ndata: ${JSON.stringify(this.#snapshot())}\n\n`];
  }

  response(req: Request, server: Timeouts): Response {
    server.timeout(req, 0);                       // SSE must outlive Bun's idleTimeout
    const enc = new TextEncoder();
    let send: ((text: string) => void) | undefined;
    let ping: ReturnType<typeof setInterval> | undefined;
    const stop = () => { if (send) this.#subs.delete(send); clearInterval(ping); };
    const body = new ReadableStream<Uint8Array>({
      start: (ctrl) => {
        send = (text) => { try { ctrl.enqueue(enc.encode(text)); } catch { stop(); } };
        send('retry: 2000\n\n');
        for (const f of this.catchUp(req.headers.get('last-event-id'))) send(f);
        this.#subs.add(send);
        ping = setInterval(() => send!(':ping\n\n'), this.#pingMs);
      },
      cancel: stop,
    });
    return new Response(body, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-store' } });
  }
}
```

`apps/server/src/serve.ts`:
```ts
import type { HTMLBundle } from 'bun';
import { parseSyncReq, type HeadsRes, type NodeState, type StreamView, type SyncReq, type SyncRes } from '@saakshi/core/wire';
import type { Hub } from './sse.ts';

export interface Api {
  readonly mode: 'cell' | 'relay';
  state(): NodeState;
  sync(req: SyncReq): Promise<SyncRes | 'REBUILDING'>;
  views(): StreamView[];
}
export interface ServeOpts { port: number; hostname?: string; idleTimeout?: number; consoleHtml?: HTMLBundle }

export const heads = (api: Api): HeadsRes => ({ mode: api.mode, state: api.state(), streams: api.views() });
const json = (body: unknown, status = 200) => Response.json(body, { status });
const notFound = () => json({ error: 'not found' }, 404);

export function serve(api: Api, hub: Hub, o: ServeOpts) {
  return Bun.serve({
    port: o.port,
    hostname: o.hostname ?? '127.0.0.1',
    idleTimeout: o.idleTimeout ?? 10,
    maxRequestBodySize: 16 * 1024 * 1024,           // 500 × (4 KB line + 16 KB envelope) fits
    routes: {
      '/v1/sync': {
        POST: async (req) => {
          let body: SyncReq;
          try { body = parseSyncReq(await req.json()); } catch (e) { return json({ error: (e as Error).message }, 400); }
          const r = await api.sync(body);
          return r === 'REBUILDING' ? json({ state: 'REBUILDING' }, 503) : json(r);
        },
      },
      '/v1/heads': { GET: () => json(heads(api)) },
      '/v1/events': { GET: (req, server) => hub.response(req, server) },
      '/console': o.consoleHtml ?? notFound,
    },
    fetch: notFound,
  });
}
```
If `import type { HTMLBundle } from 'bun'` does not resolve under `@types/bun@1.3.14`, type the field as `consoleHtml?: Parameters<typeof Bun.serve>[0] extends { routes?: infer R } ? R[keyof R] : never`, or fall back to `unknown` with a cast at the call site. Report which you used.

- [ ] **Step 3: Run the tests**

Run: `cd apps/server && bun test ./test/sse.test.ts ./test/serve.test.ts && pnpm typecheck` (with the sandbox disabled, since the tests bind ports).
Expected: 8 pass. The idle-timeout test takes about 6 s.

- [ ] **Step 4: Hand back for review and commit** with the message `feat(server): /v1 routes and SSE hub — idle-proof streams, pings, Last-Event-ID replay`.

---

### Task 4: Relay forwarder and the server entry point

**Files:**
- Create: `apps/server/src/forward.ts`, `apps/server/src/main.ts`
- Test: `apps/server/test/forward.test.ts`, `apps/server/test/main.test.ts` (the latter spawns processes and binds ports, so run it with the sandbox disabled)

**Interfaces:**
- Consumes:
  - `createIngest`, `Ingest`, `openDb`, `pragmas` (Task 2)
  - `Hub`, `serve`, `heads` (Task 3)
  - `console.html` (Task 5)
  - `cellKey`, `devSeatKey`, `KeysFile` (Task 1)
- Produces:
  - `forward.ts`:
    - `type CellSend = (req: SyncReq) => Promise<SyncRes | 'REBUILDING'>`
    - `httpCellSend(base: string, timeoutMs?): CellSend`
    - `type Round = 'idle' | 'busy' | 'error'`
    - `class Forwarder(relay: Ingest, send: CellSend, opts?: { batch?: number; heartbeatMs?: number })` with `replaying`, `round(): Promise<Round>`, `start(idleMs = 50, errorMs = 500)` and `stop(): Promise<void>`
      - `batch` defaults to 500.
      - `heartbeatMs` defaults to 2000. It is the interval for hellos to all streams when nothing is pending, which is how a restarted or wiped cell is noticed.
  - `main.ts`: the env contract in Global Constraints, and the `READY {json}` stdout line

- [ ] **Step 1: Write the failing forwarder tests**

`apps/server/test/forward.test.ts`:
```ts
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ackMessage } from '@saakshi/core/ack';
import { hexToBytes } from '@saakshi/core/bytes';
import { cellKey, devSeatKey, type KeysFile } from '@saakshi/core/dev';
import { nobleVerifier } from '@saakshi/core/sig';
import type { SyncRes } from '@saakshi/core/wire';
import { Forwarder } from '../src/forward.ts';
import { createIngest, type Ingest, type Mode } from '../src/ingest.ts';
import { openDb } from '../src/store.ts';
import { SimSeat } from '../../../tools/sim-seat.ts';

const keys = JSON.parse(readFileSync(new URL('../../../fixtures/keys.json', import.meta.url), 'utf8')) as KeysFile;
const cell = cellKey(keys, 'cell-1');
let dir: string;
const opened: Ingest[] = [];
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'saakshi-fwd-')); });
afterEach(() => { for (const n of opened.splice(0)) n.close(); rmSync(dir, { recursive: true, force: true }); });

function mk(mode: Mode, name: string, fresh = false, seatKey = devSeatKey(keys)): Ingest {
  const { db } = openDb(join(dir, `${name}.db`));
  const n = createIngest({ mode, db, fresh, seatKey, cell: mode === 'cell' ? cell : { pub: cell.pub } });
  opened.push(n);
  return n;
}
async function seatPush(relay: Ingest, s: SimSeat): Promise<SyncRes> {
  const r = await relay.sync({ entries: s.entries, streams: [{ ...s.ctx, head: s.head }] });
  if (r === 'REBUILDING') throw new Error('relay never rebuilds');
  return r;
}
async function drain(f: Forwarder, max = 500): Promise<void> {
  for (let i = 0; i < max; i++) if ((await f.round()) === 'idle') return;
  throw new Error('forwarder never went idle');
}
const evidence = (name: string) => { const d = new Database(join(dir, `${name}.db`)); try { return d.query('SELECT code FROM evidence').all(); } finally { d.close(); } };

test('forwards committed entries; the relay hands the seat a cell ack that verifies', async () => {
  const relay = mk('relay', 'relay'), c = mk('cell', 'cell');
  const f = new Forwarder(relay, (req) => c.sync(req));
  const s = new SimSeat(keys, 'C0001', cell.pub);
  s.add(30);
  await seatPush(relay, s);
  await drain(f);
  expect(relay.views()[0]).toMatchObject({ head: 30, cellHead: 30 });
  const st = (await seatPush(relay, s)).streams[0];              // the seat's next resend is a no-op carrying the ack
  expect(st.ack?.seq).toBe(30);
  expect(nobleVerifier(cell.pub)(ackMessage({ ...s.ctx, keyEpoch: 1, seq: 30, h: s.hs[29] }), hexToBytes(st.ack!.sig))).toBe(true);
});

test('cell down: the relay keeps acking (✓✓) and catches the cell up when it returns', async () => {
  const relay = mk('relay', 'relay'), c = mk('cell', 'cell');
  let up = false;
  const f = new Forwarder(relay, async (req) => { if (!up) throw new Error('connect ECONNREFUSED'); return c.sync(req); });
  const s = new SimSeat(keys, 'C0001', cell.pub);
  s.add(10);
  expect((await seatPush(relay, s)).streams[0].head).toBe(10);
  expect(await f.round()).toBe('error');
  up = true;
  await drain(f);
  expect(relay.views()[0].cellHead).toBe(10);
});

test('cell SIGKILL after COMMIT but before the ack: the resend is a no-op and nothing is lost', async () => {
  const relay = mk('relay', 'relay');
  let target = mk('cell', 'cell');
  let dropReply = true;
  const f = new Forwarder(relay, async (req) => {
    const res = await target.sync(req);
    if (dropReply && req.entries.length) { dropReply = false; throw new Error('socket hang up'); }
    return res;
  });
  const s = new SimSeat(keys, 'C0001', cell.pub);
  s.add(20);
  await seatPush(relay, s);
  await f.round();                                                // hello: learns cellHead 0
  expect(await f.round()).toBe('error');                          // cell committed 20, the reply was lost
  target.close();
  target = mk('cell', 'cell');                                    // restart on the same DB
  expect(target.views()[0].head).toBe(20);
  await drain(f);
  expect(relay.views()[0].cellHead).toBe(20);
  expect(evidence('cell')).toEqual([]);                           // no FORK, no BAD_SUBMISSION
});

test('a wiped cell REBUILDs: 503 for live traffic, the relay replays from genesis, heads end identical', async () => {
  const relay = mk('relay', 'relay');
  const a = new SimSeat(keys, 'C0001', cell.pub), b = new SimSeat(keys, 'C0002', cell.pub);
  a.add(25); b.add(7);
  await seatPush(relay, a);
  await seatPush(relay, b);
  const c = mk('cell', 'cell', true);
  expect(await c.sync({ entries: [], streams: [] })).toBe('REBUILDING');
  const f = new Forwarder(relay, (req) => c.sync(req));
  await drain(f);
  expect(c.state()).toBe('LIVE');
  expect(f.replaying).toBe(false);
  const heads = (n: Ingest) => n.views().map((v) => [v.cand, v.head]).sort();
  expect(heads(c)).toEqual(heads(relay));
  expect(relay.views().every((v) => v.cellHead === v.head)).toBe(true);
});

test('with nothing pending, the heartbeat still notices a wiped cell and rebuilds it', async () => {
  const relay = mk('relay', 'relay');
  let target = mk('cell', 'cell');
  const f = new Forwarder(relay, (req) => target.sync(req), { heartbeatMs: 0 });
  const s = new SimSeat(keys, 'C0001', cell.pub);
  s.add(12);
  await seatPush(relay, s);
  await drain(f);
  expect(relay.views()[0].cellHead).toBe(12);
  target = mk('cell', 'wiped', true);                             // the DB is gone; the seat is silent
  await drain(f);                                                 // heartbeat → 503 → replay → done
  expect(target.state()).toBe('LIVE');
  expect(target.views()[0].head).toBe(12);
});

test('a cell that rejects everything makes the forwarder back off instead of spinning', async () => {
  const relay = mk('relay', 'relay'), c = mk('cell', 'cell', false, () => undefined);   // cell knows no seat keys
  const s = new SimSeat(keys, 'C0001', cell.pub);
  s.add(3);
  await seatPush(relay, s);
  const f = new Forwarder(relay, (req) => c.sync(req));
  expect(await f.round()).toBe('busy');                           // hello: cellHead −1 → 0
  expect(await f.round()).toBe('error');                          // 3 entries rejected, no progress
});
```

`apps/server/test/main.test.ts`:
```ts
import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const MAIN = join(import.meta.dir, '../src/main.ts');

async function ready(stdout: ReadableStream<Uint8Array>): Promise<{ port: number; mode: string; state: string }> {
  const reader = stdout.getReader();
  let buf = '';
  while (!buf.includes('\n')) {
    const { value, done } = await reader.read();
    if (done) throw new Error(`exited before READY: ${buf}`);
    buf += new TextDecoder().decode(value);
  }
  const m = /^READY (.*)$/m.exec(buf);
  if (!m) throw new Error(`no READY line: ${buf}`);
  return JSON.parse(m[1]);
}

test('relay boots with DEV=1, prints READY, serves /console and /v1/heads', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'saakshi-main-'));
  const p = Bun.spawn(['bun', MAIN], { cwd: dir, stdout: 'pipe', stderr: 'pipe', env: { ...process.env, MODE: 'relay', DEV: '1', PORT: '0', HOST: '127.0.0.1', DB: join(dir, 'r.db'), CELL_URL: 'http://127.0.0.1:9' } });
  try {
    const r = await ready(p.stdout);
    expect(r).toMatchObject({ mode: 'relay', state: 'LIVE' });
    const page = await fetch(`http://127.0.0.1:${r.port}/console`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('Seat grid');
    expect(await (await fetch(`http://127.0.0.1:${r.port}/v1/heads`)).json()).toEqual({ mode: 'relay', state: 'LIVE', streams: [] });
  } finally { p.kill(); await p.exited; rmSync(dir, { recursive: true, force: true }); }
});

test('a cell on a fresh DB starts REBUILDING', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'saakshi-main-'));
  const p = Bun.spawn(['bun', MAIN], { cwd: dir, stdout: 'pipe', stderr: 'pipe', env: { ...process.env, MODE: 'cell', DEV: '1', PORT: '0', DB: join(dir, 'c.db') } });
  try { expect((await ready(p.stdout)).state).toBe('REBUILDING'); } finally { p.kill(); await p.exited; rmSync(dir, { recursive: true, force: true }); }
});

test('refuses to start without DEV=1 (no enrolment until Stage 3)', async () => {
  const env: Record<string, string | undefined> = { ...process.env, MODE: 'relay', PORT: '0' };
  delete env.DEV;
  const p = Bun.spawn(['bun', MAIN], { stdout: 'pipe', stderr: 'pipe', env });
  expect(await p.exited).toBe(2);
});
```
Run: `cd apps/server && bun test ./test/forward.test.ts`. Expected: FAIL with `Cannot find module '../src/forward.ts'`.

- [ ] **Step 2: Implement `forward.ts`, then run its tests and confirm they pass**

`apps/server/src/forward.ts`:
```ts
import { streamKey, type Hello, type StreamView, type SyncReq, type SyncRes } from '@saakshi/core/wire';
import type { Ingest } from './ingest.ts';

export type CellSend = (req: SyncReq) => Promise<SyncRes | 'REBUILDING'>;
export type Round = 'idle' | 'busy' | 'error';

export function httpCellSend(base: string, timeoutMs = 5000): CellSend {
  const url = new URL('/v1/sync', base);
  return async (req) => {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(req), signal: AbortSignal.timeout(timeoutMs) });
    if (r.status === 503) return 'REBUILDING';
    if (!r.ok) throw new Error(`cell answered ${r.status}`);
    return (await r.json()) as SyncRes;
  };
}

const hello = (v: StreamView): Hello => ({ exam: v.exam, shift: v.shift, attempt: v.attempt, cand: v.cand, head: v.head });

/**
 * Relay → cell store-and-forward. Per stream it sends committed entries from cellHead+1 (a hello when the cell's
 * head is unknown), learns the cell's head and ack from the reply, and on 503 replays everything from genesis.
 * With nothing pending it still sends all hellos every `heartbeatMs`, so a restarted or wiped cell is noticed
 * even when no seat is answering.
 */
export class Forwarder {
  #relay: Ingest;
  #send: CellSend;
  #batch: number;
  #heartbeatMs: number;
  #lastContact = 0;
  #replaying = false;
  #stopped = true;
  #loop: Promise<void> | undefined;

  constructor(relay: Ingest, send: CellSend, opts: { batch?: number; heartbeatMs?: number } = {}) {
    this.#relay = relay;
    this.#send = send;
    this.#batch = opts.batch ?? 500;
    this.#heartbeatMs = opts.heartbeatMs ?? 2000;
  }

  get replaying(): boolean { return this.#replaying; }

  async round(): Promise<Round> {
    try {
      const req: SyncReq = { entries: [], streams: [] };
      if (this.#replaying) req.replay = true;
      const before = new Map<string, number>();
      // ponytail: first streams first, no fairness; add round-robin if one centre's backlog starves the rest.
      for (const v of this.#relay.views()) {
        if (req.entries.length >= this.#batch || req.streams.length >= 5000) break;
        if (v.cellHead >= 0 && v.head <= v.cellHead) continue;
        req.streams.push(hello(v));
        before.set(streamKey(v), v.cellHead);
        if (v.cellHead >= 0) req.entries.push(...this.#relay.entriesAfter(v, v.cellHead, this.#batch - req.entries.length));
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
        if (!req.streams.length) return 'idle';
        heartbeat = true;
      }
      const res = await this.#send(req);
      this.#lastContact = Date.now();
      if (res === 'REBUILDING') {
        if (!this.#replaying) { this.#replaying = true; this.#relay.resetCell(); }
        return 'busy';
      }
      let progress = false;
      for (const st of res.streams) {
        if (before.get(streamKey(st)) !== st.head) progress = true;
        this.#relay.setCellStatus(st);
      }
      return heartbeat ? 'idle' : progress ? 'busy' : 'error';
    } catch {
      return 'error';
    }
  }

  start(idleMs = 50, errorMs = 500): void {
    if (!this.#stopped) return;
    this.#stopped = false;
    this.#loop = (async () => {
      while (!this.#stopped) {
        const r = await this.round();
        if (r !== 'busy') await Bun.sleep(r === 'idle' ? idleMs : errorMs);
      }
    })();
  }

  async stop(): Promise<void> {
    this.#stopped = true;
    await this.#loop;
  }
}
```
Run: `bun test ./test/forward.test.ts`. Expected: 6 pass.

- [ ] **Step 3: Implement `main.ts`**

`apps/server/src/main.ts`:
```ts
// Saakshi server: MODE=relay|cell. Stage 1 trusts the fixture seat keys only with DEV=1.
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { cellKey, devSeatKey, type KeysFile } from '@saakshi/core/dev';
import consoleHtml from './console.html';
import { Forwarder, httpCellSend } from './forward.ts';
import { createIngest } from './ingest.ts';
import { heads, serve } from './serve.ts';
import { Hub } from './sse.ts';
import { openDb, pragmas } from './store.ts';

const env = process.env;
const mode = env.MODE;
if (mode !== 'cell' && mode !== 'relay') { console.error('MODE must be cell or relay'); process.exit(2); }
if (env.DEV !== '1') { console.error('Stage 1 trusts the fixture seat keys only with DEV=1 (enrolment arrives in Stage 3)'); process.exit(2); }

const keys = (await Bun.file(env.KEYS ?? resolve(import.meta.dir, '../../../fixtures/keys.json')).json()) as KeysFile;
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
  onView: (v) => hub?.publish('stream', v),
  onState: (s) => hub?.publish('state', { state: s }),
});
hub = new Hub(() => heads(ingest));
const server = serve(ingest, hub, {
  port: Number(env.PORT ?? (mode === 'relay' ? 7070 : 7080)),
  hostname: env.HOST ?? (mode === 'relay' ? '0.0.0.0' : '127.0.0.1'),
  consoleHtml: mode === 'relay' ? consoleHtml : undefined,
});
const fwd = mode === 'relay' ? new Forwarder(ingest, httpCellSend(env.CELL_URL ?? 'http://127.0.0.1:7080')) : undefined;
fwd?.start();

console.log(`READY ${JSON.stringify({ mode, port: server.port, state: ingest.state(), db: dbPath, pragmas: p })}`);

const stop = async () => { await fwd?.stop(); server.stop(true); ingest.close(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
```

- [ ] **Step 4: Run all server tests**

Run: `cd apps/server && bun test ./test && pnpm typecheck` (with the sandbox disabled).
Expected: every suite passes (sim-seat, store, ingest, sse, serve, forward, main).

- [ ] **Step 5: Manual smoke test** (with the sandbox disabled)

```bash
DEV=1 MODE=cell DB=$TMPDIR/s1/cell.db bun apps/server/src/main.ts &
DEV=1 MODE=relay DB=$TMPDIR/s1/relay.db bun apps/server/src/main.ts &
sleep 1; curl -s localhost:7070/v1/heads; curl -s localhost:7080/v1/heads; kill %1 %2
```
Expected: two `READY` lines, the cell with `"state":"REBUILDING"`. It stays REBUILDING while the relay holds no streams, because heartbeats cover known streams only. The first seat entry then triggers 503, replay, `done` and LIVE, which is exactly the fresh-cell path.

- [ ] **Step 6: Hand back for review and commit** with the message `feat(server): relay forwarder with replay-from-genesis, MODE=relay|cell entry point`.

---

### Task 5: `/console` seat grid (served by the relay)

**Files:**
- Create: `apps/server/src/console.html`, `apps/server/src/console.ts`, `apps/server/src/console-view.ts`
- Test: `apps/server/test/console-view.test.ts`

**Interfaces:**
- Consumes: the `StreamView`, `HeadsRes` and `NodeState` types, and the SSE event names in Global Constraints.
- Produces:
  - `console.html`, which Task 4 imports as a Bun HTML bundle. Its `<h1>` is `Seat grid`.
  - `console-view.ts`:
    - `type Tone = 'ok' | 'lag' | 'silent'`
    - `interface Tile { key; cand; tone; text; aria }`
    - `SILENT_MS`
    - `tile(v, now): Tile`
    - `applyEvent(views, event, data): { mode?: string; state?: NodeState }`

- [ ] **Step 1: Write the failing test**

`apps/server/test/console-view.test.ts`:
```ts
import { expect, test } from 'bun:test';
import type { StreamView } from '@saakshi/core/wire';
import { applyEvent, SILENT_MS, tile } from '../src/console-view.ts';

const v = (o: Partial<StreamView>): StreamView => ({ exam: 'DEMO-2026', shift: 'S1', attempt: 1, cand: 'C0001', head: 10, cellHead: 10, senderHead: 10, seenAt: 1_000, ...o });

test('tones: in sync, syncing when the seat or the cell is behind, silent after 30 s or never heard', () => {
  expect(tile(v({}), 2_000)).toMatchObject({ tone: 'ok', text: 'seat 10 · relay 10 · cell 10' });
  expect(tile(v({ senderHead: 12 }), 2_000).tone).toBe('lag');
  expect(tile(v({ cellHead: 7 }), 2_000).tone).toBe('lag');
  expect(tile(v({ cellHead: -1 }), 2_000)).toMatchObject({ tone: 'lag', text: 'seat 10 · relay 10 · cell ?' });
  expect(tile(v({}), 1_000 + SILENT_MS + 1).tone).toBe('silent');
  expect(tile(v({ seenAt: 0, senderHead: -1 }), 2_000)).toMatchObject({ tone: 'silent', text: 'seat ? · relay 10 · cell 10' });
  expect(tile(v({}), 2_000).aria).toBe('C0001: in sync; seat 10 · relay 10 · cell 10');
});

test('snapshot replaces the grid, stream upserts one tile, state reports the node state', () => {
  const views = new Map<string, StreamView>();
  expect(applyEvent(views, 'snapshot', { mode: 'relay', state: 'LIVE', streams: [v({}), v({ cand: 'C0002' })] })).toEqual({ mode: 'relay', state: 'LIVE' });
  expect(views.size).toBe(2);
  applyEvent(views, 'stream', v({ cand: 'C0002', head: 11 }));
  applyEvent(views, 'stream', v({ cand: 'C0003' }));
  expect([...views.values()].map((x) => [x.cand, x.head])).toEqual([['C0001', 10], ['C0002', 11], ['C0003', 10]]);
  expect(applyEvent(views, 'state', { state: 'REBUILDING' })).toEqual({ state: 'REBUILDING' });
  applyEvent(views, 'snapshot', { mode: 'relay', state: 'LIVE', streams: [] });
  expect(views.size).toBe(0);
});
```
Run: `cd apps/server && bun test ./test/console-view.test.ts`. Expected: FAIL with `Cannot find module`.

- [ ] **Step 2: Implement**

`apps/server/src/console-view.ts`:
```ts
import type { HeadsRes, NodeState, StreamView } from '@saakshi/core/wire';

export type Tone = 'ok' | 'lag' | 'silent';
export interface Tile { key: string; cand: string; tone: Tone; text: string; aria: string }
export const SILENT_MS = 30_000;

const keyOf = (v: StreamView): string => JSON.stringify([v.exam, v.shift, v.attempt, v.cand]);

export function tile(v: StreamView, now: number): Tile {
  const seat = v.senderHead < 0 ? '?' : String(v.senderHead);
  const cell = v.cellHead < 0 ? '?' : String(v.cellHead);
  const tone: Tone = v.seenAt === 0 || now - v.seenAt > SILENT_MS ? 'silent' : v.senderHead > v.head || v.cellHead < v.head ? 'lag' : 'ok';
  const text = `seat ${seat} · relay ${v.head} · cell ${cell}`;
  const word = tone === 'ok' ? 'in sync' : tone === 'lag' ? 'syncing' : v.seenAt ? `silent ${Math.round((now - v.seenAt) / 1000)} s` : 'never seen';
  return { key: keyOf(v), cand: v.cand, tone, text, aria: `${v.cand}: ${word}; ${text}` };
}

export function applyEvent(views: Map<string, StreamView>, event: string, data: unknown): { mode?: string; state?: NodeState } {
  if (event === 'snapshot') {
    const d = data as HeadsRes;
    views.clear();
    for (const s of d.streams) views.set(keyOf(s), s);
    return { mode: d.mode, state: d.state };
  }
  if (event === 'stream') { const s = data as StreamView; views.set(keyOf(s), s); return {}; }
  if (event === 'state') return { state: (data as { state: NodeState }).state };
  return {};
}
```

`apps/server/src/console.ts`:
```ts
import type { StreamView } from '@saakshi/core/wire';
import { applyEvent, tile, type Tone } from './console-view.ts';

const views = new Map<string, StreamView>();
const grid = document.getElementById('grid') as HTMLUListElement;
const status = document.getElementById('status') as HTMLParagraphElement;
let head: { mode?: string; state?: string } = {};
let conn = 'connecting…';

function render(): void {
  const now = Date.now();
  const tiles = [...views.values()].map((v) => tile(v, now)).sort((a, b) => a.cand.localeCompare(b.cand));
  grid.replaceChildren(...tiles.map((t) => {
    const li = document.createElement('li');
    li.className = `tile ${t.tone}`;
    li.setAttribute('aria-label', t.aria);
    const name = document.createElement('strong');
    name.textContent = t.cand;
    const detail = document.createElement('span');
    detail.textContent = t.text;
    li.append(name, detail);
    return li;
  }));
  const n: Record<Tone, number> = { ok: 0, lag: 0, silent: 0 };
  for (const t of tiles) n[t.tone]++;
  status.textContent = `${head.mode ?? 'node'} · ${head.state ?? '…'} · ${conn} · ${tiles.length} seats: ${n.ok} in sync, ${n.lag} syncing, ${n.silent} silent`;
}

const es = new EventSource('/v1/events');           // reconnects by itself and sends Last-Event-ID
for (const ev of ['snapshot', 'stream', 'state']) {
  es.addEventListener(ev, (m) => { head = { ...head, ...applyEvent(views, ev, JSON.parse((m as MessageEvent<string>).data)) }; render(); });
}
es.onopen = () => { conn = 'live'; render(); };
es.onerror = () => { conn = 'reconnecting…'; render(); };
setInterval(render, 1000);                           // ages "silent" tiles between events
```

`apps/server/src/console.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Saakshi · Seat grid</title>
    <style>
      :root { font-family: system-ui, sans-serif; color: #202124; background: #fff; }
      body { margin: 0; padding: 1rem 1.5rem; }
      h1 { font-size: 1.5rem; margin: 0 0 .25rem; }
      #status { color: #5f6368; margin: 0 0 1rem; }
      #grid { list-style: none; padding: 0; margin: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(12rem, 1fr)); gap: .5rem; }
      .tile { border: 2px solid; border-radius: .5rem; padding: .5rem .75rem; display: grid; gap: .125rem; }
      .tile strong { font-size: 1.125rem; }
      .tile span { font-variant-numeric: tabular-nums; font-size: .875rem; }
      .ok { border-color: #2e7d32; background: #e6f4ea; }
      .lag { border-color: #b06000; background: #fef7e0; }
      .silent { border-color: #c62828; background: #fce8e6; }
      .legend { margin-top: 1rem; color: #5f6368; font-size: .875rem; }
      @media (forced-colors: active) { .tile { border-color: CanvasText; } }
    </style>
  </head>
  <body>
    <h1>Seat grid</h1>
    <p id="status">connecting…</p>
    <ul id="grid" aria-label="Seats"></ul>
    <p class="legend">Green: in sync · Amber: seat or cell behind · Red: silent for 30 s or more. Heads are entry counts.</p>
    <script type="module" src="./console.ts"></script>
  </body>
</html>
```

- [ ] **Step 3: Run the test and typecheck**

Run: `cd apps/server && bun test ./test/console-view.test.ts && pnpm typecheck`
Expected: 2 pass; tsc is clean. If `@types/bun` and the DOM lib conflict, exclude only `src/console.ts` from `tsconfig.json` and report it.

- [ ] **Step 4: Hand back for review and commit** with the message `feat(server): /console seat grid over SSE`.

---

### Task 6: Seat journal — encrypted at rest, fsync, torn-tail recovery

**Files:**
- Create: `apps/seat/src/main/journal-store.ts`
- Test: `apps/seat/test/journal-store.test.ts`

**Interfaces:**
- Consumes: `buildChain`, `demoEntries`, `parseSignedLine`, `verifyChain`, `signer`/`verifier`/`newKeyPair`, `entryHash`, `genesisPrev`, and `bodyArray`/`bodyFromArray` from core.
- Produces:
  - `interface Wrapper { encryptString(s: string): Buffer; decryptString(b: Buffer): string }` (Electron's `safeStorage` satisfies it)
  - `interface Rec { line: string; env: Uint8Array; salt: Uint8Array; body: Body }`
  - `class SeatJournal` with:
    - `static open(dir, ctx, wrap, verify): SeatJournal`
    - `recs: Rec[]`, `headers: Header[]`, `head: number`
    - `hashAt(seq): string`
    - `append(rec): void`
    - `close(): void`

- [ ] **Step 1: Write the failing test**

`apps/seat/test/journal-store.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, copyFileSync, mkdtempSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from '@saakshi/core/bytes';
import { buildChain, demoEntries } from '@saakshi/core/journal';
import { newKeyPair, signer, verifier } from '@saakshi/core/node';
import { SeatJournal, type Rec, type Wrapper } from '../src/main/journal-store.ts';

const ctx = { exam: 'DEMO-2026', shift: 'S1', attempt: 1, cand: 'C0001' };
const key = newKeyPair();
const wrap: Wrapper = { encryptString: (s) => Buffer.from('W' + s), decryptString: (b) => b.toString().slice(1) };
const entries = demoEntries(6);
const { lines } = buildChain(ctx, 1, entries, signer(key));
const recs: Rec[] = lines.map((line, i) => ({ line, env: randomBytes(150), salt: entries[i].salt, body: entries[i].body }));
const base = (dir: string, cand = 'C0001') => join(dir, `DEMO-2026_S1_1_${cand}`);

function fresh(n: number): { dir: string; path: string } {
  const dir = mkdtempSync(join(tmpdir(), 'saakshi-journal-'));
  const j = SeatJournal.open(dir, ctx, wrap, verifier(key.pub));
  for (const r of recs.slice(0, n)) j.append(r);
  j.close();
  return { dir, path: `${base(dir)}.journal` };
}
const reopen = (dir: string, c = ctx) => SeatJournal.open(dir, c, wrap, verifier(key.pub));

test('appends survive a reopen byte-for-byte; hashAt follows the chain', () => {
  const { dir } = fresh(5);
  const j = reopen(dir);
  assert.equal(j.head, 5);
  assert.deepEqual(j.recs, recs.slice(0, 5));
  assert.equal(j.headers[4].seq, 5);
  assert.equal(j.hashAt(2), j.headers[2].prev);
  j.close();
  rmSync(dir, { recursive: true });
});

test('encrypted at rest: no header, context or answer text on disk; the session key is stored wrapped', () => {
  const { dir, path } = fresh(5);
  const text = readFileSync(path, 'latin1');
  for (const s of ['DEMO-2026', '"answer"', 'signed', 'I01']) assert.equal(text.includes(s), false, s);
  const k = readFileSync(`${base(dir)}.key`, 'utf8');
  assert.equal(k[0], 'W');
  assert.equal(k.length, 65);
  rmSync(dir, { recursive: true });
});

test('a torn tail is cut back to the last whole line, and appending continues', () => {
  for (const tail of [Buffer.from(readFileSync(fresh(1).path, 'latin1').slice(0, 40)), Buffer.alloc(300)]) {
    const { dir, path } = fresh(4);
    const clean = statSync(path).size;
    appendFileSync(path, tail);                      // power cut mid-write: partial line or zero-filled blocks
    const j = reopen(dir);
    assert.equal(j.head, 4);
    assert.equal(statSync(path).size, clean);
    j.append(recs[4]);
    j.close();
    assert.equal(reopen(dir).head, 5);
    rmSync(dir, { recursive: true });
  }
});

test('damage before the tail refuses to open (corrupt line, reordered lines, another candidate)', () => {
  const { dir, path } = fresh(4);
  const good = readFileSync(path, 'latin1').split('\n');
  const flipped = [...good];
  flipped[1] = flipped[1].slice(0, 5) + (flipped[1][5] === 'A' ? 'B' : 'A') + flipped[1].slice(6);
  writeFileSync(path, flipped.join('\n'), 'latin1');
  assert.throws(() => reopen(dir), /line 2/);
  writeFileSync(path, [good[1], good[0], ...good.slice(2)].join('\n'), 'latin1');
  assert.throws(() => reopen(dir), /line 1/);
  writeFileSync(path, good.join('\n'), 'latin1');
  copyFileSync(path, `${base(dir, 'C0002')}.journal`);
  copyFileSync(`${base(dir)}.key`, `${base(dir, 'C0002')}.key`);
  assert.throws(() => reopen(dir, { ...ctx, cand: 'C0002' }), /line 1/);
  rmSync(dir, { recursive: true });
});

test('a journal whose session key is gone refuses to start a second journal', () => {
  const { dir } = fresh(2);
  unlinkSync(`${base(dir)}.key`);
  assert.throws(() => reopen(dir), /session key/);
  rmSync(dir, { recursive: true });
});

test('append refuses anything that does not extend the chain', () => {
  const { dir } = fresh(2);
  const j = reopen(dir);
  assert.throws(() => j.append(recs[3]), /seq 3/);
  assert.throws(() => j.append(recs[1]), /seq 3/);
  j.close();
  rmSync(dir, { recursive: true });
});
```
Run: `cd apps/seat && node --test test/journal-store.test.ts`. Expected: FAIL with `Cannot find module`.

- [ ] **Step 2: Implement**

`apps/seat/src/main/journal-store.ts`:
```ts
import { closeSync, existsSync, fsyncSync, ftruncateSync, mkdirSync, openSync, readFileSync, renameSync, writeSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { hexToBytes, randomBytes, toHex, utf8 } from '@saakshi/core/bytes';
import { canon, parseCanon } from '@saakshi/core/canon';
import { parseSignedLine, verifyChain } from '@saakshi/core/journal';
import { bodyArray, bodyFromArray, entryHash, genesisPrev, type Body, type Ctx, type Header } from '@saakshi/core/protocol';
import type { Verify } from '@saakshi/core/sig';

/** Electron's safeStorage has exactly this shape. */
export interface Wrapper { encryptString(s: string): Buffer; decryptString(b: Buffer): string }
/** What the seat keeps per entry: the signed line and envelope (to resend) and its own plaintext body (to resume). */
export interface Rec { line: string; env: Uint8Array; salt: Uint8Array; body: Body }

const SAFE = /^[A-Za-z0-9-]{1,64}$/;
const aad = (c: Ctx, seq: number): Uint8Array => utf8(canon(['aad', c.exam, c.shift, c.attempt, c.cand, seq]));

function syncDir(dir: string): void {
  if (process.platform === 'win32') return;          // Windows cannot open a directory for fsync
  const fd = openSync(dir, 'r');
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

function writeDurable(path: string, data: Uint8Array): void {
  const tmp = `${path}.tmp`;
  const fd = openSync(tmp, 'w');
  try { writeSync(fd, data); fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(tmp, path);
  syncDir(dirname(path));
}

/**
 * Append-only seat journal. Each line: base64(nonce24 ‖ XChaCha20-Poly1305(sessionKey, nonce, AAD=["aad",…,seq])(canon(["rec",…]))).
 * Every append is fsynced. (Honest limit: on macOS, Node's fsync is not F_FULLFSYNC.)
 */
export class SeatJournal {
  readonly recs: Rec[] = [];
  readonly headers: Header[] = [];
  #hs: string[] = [];
  #ctx: Ctx;
  #key: Uint8Array;
  #fd: number;
  #size: number;

  /** Use SeatJournal.open. */
  constructor(ctx: Ctx, key: Uint8Array, fd: number, size: number) {
    this.#ctx = ctx; this.#key = key; this.#fd = fd; this.#size = size;
  }

  static open(dir: string, ctx: Ctx, wrap: Wrapper, verify: Verify): SeatJournal {
    for (const f of [ctx.exam, ctx.shift, ctx.cand]) if (!SAFE.test(f)) throw new Error(`journal: unsafe name ${f}`);
    mkdirSync(dir, { recursive: true });
    const base = join(dir, `${ctx.exam}_${ctx.shift}_${ctx.attempt}_${ctx.cand}`);
    const jPath = `${base}.journal`, kPath = `${base}.key`;
    const existed = existsSync(jPath);
    const buf = existed ? readFileSync(jPath) : Buffer.alloc(0);
    let key: Uint8Array;
    if (existsSync(kPath)) key = hexToBytes(wrap.decryptString(readFileSync(kPath)));
    else if (buf.length > 0) throw new Error('journal: the session key is missing; refusing to start over an existing journal');
    else { key = randomBytes(32); writeDurable(kPath, wrap.encryptString(toHex(key))); }

    const end = buf.lastIndexOf(0x0a) + 1;            // a torn tail has no newline yet
    const fd = openSync(jPath, existed ? 'r+' : 'w+');
    if (!existed) syncDir(dir);
    if (end < buf.length) { ftruncateSync(fd, end); fsyncSync(fd); }
    const j = new SeatJournal(ctx, key, fd, end);
    const lines = buf.subarray(0, end).toString('latin1').split('\n');
    lines.pop();
    lines.forEach((l, i) => j.#push(j.#decrypt(l, i + 1)));
    const chain = verifyChain(ctx, j.recs.map((r) => r.line), verify);
    if (!chain.ok) { closeSync(fd); throw new Error(`journal: chain broken at seq ${chain.index + 1} (${chain.fault})`); }
    return j;
  }

  get head(): number { return this.recs.length; }
  hashAt(seq: number): string { return this.#hs[seq - 1]; }

  append(rec: Rec): void {
    const seq = this.head + 1;
    const p = parseSignedLine(rec.line);
    const prev = seq === 1 ? genesisPrev(this.#ctx) : this.#hs[seq - 2];
    if (!p.ok || p.header.seq !== seq || p.header.prev !== prev) throw new Error(`journal: expected seq ${seq} extending the chain`);
    const pt = utf8(canon(['rec', rec.line, Buffer.from(rec.env).toString('base64'), toHex(rec.salt), bodyArray(rec.body)]));
    const nonce = randomBytes(24);
    const ct = xchacha20poly1305(this.#key, nonce, aad(this.#ctx, seq)).encrypt(pt);
    const data = Buffer.from(Buffer.concat([nonce, ct]).toString('base64') + '\n', 'latin1');
    writeSync(this.#fd, data, 0, data.length, this.#size);
    fsyncSync(this.#fd);
    this.#size += data.length;
    this.#push(rec);
  }

  close(): void { closeSync(this.#fd); }

  #push(rec: Rec): void {
    const p = parseSignedLine(rec.line);
    if (!p.ok) throw new Error(`journal: ${p.detail}`);
    this.recs.push(rec);
    this.headers.push(p.header);
    this.#hs.push(toHex(entryHash(p.header)));
  }

  #decrypt(l: string, seq: number): Rec {
    let pt: Uint8Array;
    try {
      const raw = Buffer.from(l, 'base64');
      pt = xchacha20poly1305(this.#key, raw.subarray(0, 24), aad(this.#ctx, seq)).decrypt(raw.subarray(24));
    } catch { throw new Error(`journal: line ${seq} does not decrypt (corrupted, reordered, or from another candidate)`); }
    const a = parseCanon(new TextDecoder('utf-8', { fatal: true }).decode(pt));
    const [tag, line, env, salt, body] = a;
    if (a.length !== 5 || tag !== 'rec' || typeof line !== 'string' || typeof env !== 'string' || typeof salt !== 'string' || !Array.isArray(body))
      throw new Error(`journal: line ${seq} is not a record`);
    return { line, env: new Uint8Array(Buffer.from(env, 'base64')), salt: hexToBytes(salt), body: bodyFromArray(body) };
  }
}
```

- [ ] **Step 3: Run the tests**

Run: `cd apps/seat && node --test test/journal-store.test.ts && pnpm typecheck`
Expected: 6 pass; tsc is clean.

- [ ] **Step 4: Hand back for review and commit** with the message `feat(seat): encrypted, fsynced journal with torn-tail recovery and safeStorage-wrapped session key`.

---

### Task 7: Seat sync loop and ticks

**Files:**
- Create: `apps/seat/src/main/sync.ts`
- Test: `apps/seat/test/sync.test.ts`

**Interfaces:**
- Consumes:
  - `ackMessage`, `streamKey` and the wire types (Task 1)
  - `SyncView` (`ipc.ts`)
  - `SimSeat` (in the tests)
- Produces:
  - `interface SyncSource { ctx: Ctx; head(): number; hashAt(seq): string; entriesAfter(after, limit): WireEntry[] }` (Task 8's `ExamSession` implements it, and Task 10 builds one around `SimSeat`)
  - `type Send = (req: SyncReq) => Promise<SyncRes>`
  - `httpSend(relayUrl, timeoutMs = 5000): Send`
  - `class SeatSync(src, send, cellVerify: Verify, onView = () => {})` with `view(): SyncView`, `round(): Promise<void>`, `kick()`, `start(everyMs = 1000)` and `stop()`

- [ ] **Step 1: Write the failing test**

`apps/seat/test/sync.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ackMessage } from '@saakshi/core/ack';
import { toHex } from '@saakshi/core/bytes';
import { cellKey, devSeat, type KeysFile } from '@saakshi/core/dev';
import { parseSignedLine } from '@saakshi/core/journal';
import { signer, verifier } from '@saakshi/core/node';
import { entryHash } from '@saakshi/core/protocol';
import type { SyncReq, SyncRes } from '@saakshi/core/wire';
import { SeatSync, type SyncSource } from '../src/main/sync.ts';
import { SimSeat } from '../../../tools/sim-seat.ts';

const keys = JSON.parse(readFileSync(new URL('../../../fixtures/keys.json', import.meta.url), 'utf8')) as KeysFile;
const cell = cellKey(keys, 'cell-1');

/** An in-memory relay that also hands out cell acks — good or deliberately bad. */
function fakeRelay() {
  const cellSign = signer(cell);
  const r = {
    hs: [] as string[], up: true, lieHead: false, forgeAck: false, ackOtherH: false, seen: [] as SyncReq[],
    async send(req: SyncReq): Promise<SyncRes> {
      r.seen.push(req);
      if (!r.up) throw new Error('connect ECONNREFUSED');
      for (const e of req.entries) { const p = parseSignedLine(e.line); if (p.ok && p.header.seq === r.hs.length + 1) r.hs.push(toHex(entryHash(p.header))); }
      const c = req.streams[0], head = r.hs.length, h = r.hs[head - 1] ?? '';
      const ackH = r.ackOtherH ? 'ee'.repeat(32) : h;
      const sign = r.forgeAck ? signer(devSeat(keys, 'C0002')!) : cellSign;
      const ctx = { exam: c.exam, shift: c.shift, attempt: c.attempt, cand: c.cand };
      const ack = head ? { keyEpoch: 1, seq: head, h: ackH, sig: toHex(sign(ackMessage({ ...ctx, keyEpoch: 1, seq: head, h: ackH }))) } : undefined;
      return { streams: [{ ...ctx, head, headH: r.lieHead ? 'f'.repeat(64) : h, need: false, ...(ack ? { ack } : {}) }], rejected: [] };
    },
  };
  return r;
}
const source = (s: SimSeat): SyncSource => ({ ctx: s.ctx, head: () => s.head, hashAt: (q) => s.hs[q - 1], entriesAfter: (a, l) => s.after(a, l) });
function setup() {
  const sim = new SimSeat(keys, 'C0001', cell.pub), relay = fakeRelay(), views: unknown[] = [];
  const sync = new SeatSync(source(sim), (q) => relay.send(q), verifier(cell.pub), (v) => views.push(v));
  return { sim, relay, sync, views };
}

test('first round only says hello; the next sends the backlog; ticks go ✓ → ✓✓ → blue', async () => {
  const { sim, relay, sync, views } = setup();
  sim.add(5);
  assert.deepEqual(sync.view(), { local: 5, relay: 0, cell: 0, online: false, error: '' });
  await sync.round();
  assert.equal(relay.seen[0].entries.length, 0);
  assert.deepEqual(relay.seen[0].streams, [{ ...sim.ctx, head: 5 }]);
  await sync.round();
  assert.equal(relay.seen[1].entries.length, 5);
  assert.deepEqual(sync.view(), { local: 5, relay: 5, cell: 5, online: true, error: '' });
  assert.equal(views.length, 2);
});

test('offline: ✓ keeps growing, nothing is lost, and the backlog drains on return', async () => {
  const { sim, relay, sync } = setup();
  sim.add(5); await sync.round(); await sync.round();
  relay.up = false;
  sim.add(3); await sync.round();
  assert.deepEqual(sync.view(), { local: 8, relay: 5, cell: 5, online: false, error: 'connect ECONNREFUSED' });
  relay.up = true;
  await sync.round();
  assert.deepEqual(sync.view(), { local: 8, relay: 8, cell: 8, online: true, error: '' });
});

test('a forged or mismatched ack never turns a tick blue', async () => {
  const { sim, relay, sync } = setup();
  sim.add(4);
  relay.forgeAck = true;
  await sync.round(); await sync.round();
  assert.equal(sync.view().relay, 4);
  assert.equal(sync.view().cell, 0);
  relay.forgeAck = false; relay.ackOtherH = true;
  await sync.round();
  assert.equal(sync.view().cell, 0);
  relay.ackOtherH = false;
  await sync.round();
  assert.equal(sync.view().cell, 4);
});

test('a relay that disagrees about our chain does not advance ✓✓', async () => {
  const { sim, relay, sync } = setup();
  sim.add(3);
  relay.lieHead = true;
  await sync.round(); await sync.round();
  assert.equal(sync.view().relay, 0);
  assert.match(sync.view().error, /disagrees/);
  assert.equal(relay.seen[1].entries.length, 0);                  // still unsure of the relay's head: only hellos
});

test('a fresh (spare) relay gets the whole journal again; ✓✓ already shown stays', async () => {
  const { sim, relay, sync } = setup();
  sim.add(5); await sync.round(); await sync.round();
  relay.hs = [];
  await sync.round();                                             // learns head 0
  assert.equal(sync.view().relay, 5);
  await sync.round();
  assert.equal(relay.seen.at(-1)!.entries.length, 5);
  assert.equal(relay.hs.length, 5);
});

test('kick() drains a backlog larger than one batch without waiting for the timer', async () => {
  const { sim, sync } = setup();
  sim.add(1200);
  sync.kick();
  const t0 = Date.now();
  while (sync.view().cell !== 1200) {
    if (Date.now() - t0 > 20_000) assert.fail(`stuck at ${JSON.stringify(sync.view())}`);
    await new Promise((r) => setTimeout(r, 10));
  }
});
```
Run: `cd apps/seat && node --test test/sync.test.ts`. Expected: FAIL with `Cannot find module`.

- [ ] **Step 2: Implement**

`apps/seat/src/main/sync.ts`:
```ts
import { ackMessage } from '@saakshi/core/ack';
import { hexToBytes } from '@saakshi/core/bytes';
import type { Ctx } from '@saakshi/core/protocol';
import type { Verify } from '@saakshi/core/sig';
import { streamKey, type SyncReq, type SyncRes, type WireEntry } from '@saakshi/core/wire';
import type { SyncView } from '../shared/ipc.ts';

export interface SyncSource { ctx: Ctx; head(): number; hashAt(seq: number): string; entriesAfter(after: number, limit: number): WireEntry[] }
export type Send = (req: SyncReq) => Promise<SyncRes>;

const BATCH = 500;
const SIG_HEX = /^[0-9a-f]{128}$/;

export function httpSend(relayUrl: string, timeoutMs = 5000): Send {
  const url = new URL('/v1/sync', relayUrl);
  return async (req) => {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(req), signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok) throw new Error(`relay answered ${r.status}`);
    return (await r.json()) as SyncRes;
  };
}

/**
 * Seat → relay sync. The send cursor is the relay's *current* head for us (−1 = ask first), so a spare relay with an
 * empty DB gets everything again. Ticks: ✓✓ only when the relay's headH is our own h; blue only for a cell
 * signature over our own h. The relay is untrusted for both.
 */
export class SeatSync {
  #src: SyncSource;
  #send: Send;
  #cellVerify: Verify;
  #onView: (v: SyncView) => void;
  #cursor = -1;
  #relay = 0;
  #cell = 0;
  #online = false;
  #error = '';
  #busy = false;
  #again = false;
  #timer: ReturnType<typeof setInterval> | undefined;

  constructor(src: SyncSource, send: Send, cellVerify: Verify, onView: (v: SyncView) => void = () => {}) {
    this.#src = src; this.#send = send; this.#cellVerify = cellVerify; this.#onView = onView;
  }

  view(): SyncView { return { local: this.#src.head(), relay: this.#relay, cell: this.#cell, online: this.#online, error: this.#error }; }

  async round(): Promise<void> {
    const s = this.#src;
    const entries = this.#cursor < 0 ? [] : s.entriesAfter(this.#cursor, BATCH);
    let res: SyncRes;
    try { res = await this.#send({ entries, streams: [{ ...s.ctx, head: s.head() }] }); }
    catch (e) { this.#online = false; this.#error = (e as Error).message; this.#onView(this.view()); return; }
    this.#online = true;
    this.#error = res.rejected.map((r) => `${r.code}: ${r.reason}`).join('; ');
    const st = res.streams.find((x) => streamKey(x) === streamKey(s.ctx));
    if (st) {
      const mine = st.head === 0 ? '' : st.head <= s.head() ? s.hashAt(st.head) : undefined;
      if (st.headH === mine) { this.#cursor = st.head; this.#relay = Math.max(this.#relay, st.head); }
      else this.#error ||= `relay disagrees with this seat at seq ${st.head}`;
      const a = st.ack;
      if (a && a.seq >= 1 && a.seq <= s.head() && a.h === s.hashAt(a.seq) && SIG_HEX.test(a.sig)
        && this.#cellVerify(ackMessage({ ...s.ctx, keyEpoch: a.keyEpoch, seq: a.seq, h: a.h }), hexToBytes(a.sig))) {
        this.#cell = Math.max(this.#cell, a.seq);
      }
    }
    this.#onView(this.view());
  }

  /** Run a round now; coalesces concurrent kicks and keeps going while a backlog is draining. */
  kick(): void {
    if (this.#busy) { this.#again = true; return; }
    this.#busy = true;
    const before = this.#cursor;
    void this.round().finally(() => {
      this.#busy = false;
      const draining = this.#online && this.#cursor !== before && this.#cursor < this.#src.head();
      if (this.#again || draining) { this.#again = false; this.kick(); }
    });
  }

  start(everyMs = 1000): void {
    this.stop();
    this.#timer = setInterval(() => this.kick(), everyMs);
    this.kick();
  }

  stop(): void { clearInterval(this.#timer); this.#timer = undefined; }
}
```

- [ ] **Step 3: Run the tests**

Run: `cd apps/seat && node --test test/sync.test.ts && pnpm typecheck`
Expected: 6 pass; tsc is clean.

- [ ] **Step 4: Hand back for review and commit** with the message `feat(seat): sync loop — NEED-safe resend, per-destination heads, ticks from verified cell acks only`.

---

### Task 8: Exam session, timer and IPC in Electron main

**Files:**
- Create: `apps/seat/src/main/exam.ts`
- Replace: `apps/seat/src/main/index.ts` (keep `--probe-selftest`, `app://`, the CSP and the permission handlers), `apps/seat/src/preload/index.ts`
- Test: `apps/seat/test/exam.test.ts`

**Interfaces:**
- Consumes:
  - `SeatJournal`, `Wrapper` (Task 6)
  - `SeatSync`, `httpSend`, `SyncSource` (Task 7)
  - `ipc.ts`, and `devSeat`, `cellKey`, `devForm`, `DEV_EXAM` (Task 1)
- Produces:
  - `exam.ts`:
    - `interface SessionOpts { dir; ctx; keyEpoch; seat: KeyPair; cellPub; wrap: Wrapper; durationMs; items: readonly string[]; clock?: () => number }`
    - `IDLE_MS`
    - `class ExamSession implements SyncSource` with `started`, `activeMs()`, `remainingMs()`, `items()`, `start()`, `act(a)`, `tick()`, `head()`, `hashAt()`, `entriesAfter()` and `close()`
  - IPC channels:
    - `exam:load` → `ExamBoot`
    - `exam:start` → `ActResult`
    - `exam:act` (`Action`) → `ActResult`
    - `sync` (push, main → renderer) → `SyncView`
  - `window.saakshi` is exposed as a `SeatApi`.

- [ ] **Step 1: Write the failing test**

`apps/seat/test/exam.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cellKey, DEV_EXAM, devSeat, type KeysFile } from '@saakshi/core/dev';
import { parseSignedLine } from '@saakshi/core/journal';
import { openBody } from '@saakshi/core/node';
import { fromB64 } from '@saakshi/core/wire';
import { ExamSession, IDLE_MS } from '../src/main/exam.ts';
import type { Wrapper } from '../src/main/journal-store.ts';

const keys = JSON.parse(readFileSync(new URL('../../../fixtures/keys.json', import.meta.url), 'utf8')) as KeysFile;
const cell = cellKey(keys, 'cell-1');
const wrap: Wrapper = { encryptString: (s) => Buffer.from('W' + s), decryptString: (b) => b.toString().slice(1) };
const D = 30 * 60_000;
function session(dir: string, clock: () => number): ExamSession {
  return new ExamSession({ dir, ctx: { ...DEV_EXAM, cand: 'C0001' }, keyEpoch: 1, seat: devSeat(keys, 'C0001')!, cellPub: cell.pub, wrap, durationMs: D, items: ['I01', 'I02', 'I03'], clock });
}
const act = (kind: 'answer' | 'mark' | 'clear', item: string, state: 'A' | 'MR' | 'AMR' | 'NA', answer: string) => ({ kind, item, state, answer, dwellMs: 1234 });

test('start, answer, mark and clear journal sealed entries in order', () => {
  const dir = mkdtempSync(join(tmpdir(), 'saakshi-exam-'));
  let t = 0;
  const s = session(dir, () => t);
  assert.equal(s.started, false);
  assert.deepEqual(s.start(), { ok: true, seq: 1, activeMs: 0 });
  t = 5_000; assert.deepEqual(s.act(act('answer', 'I01', 'A', 'D')), { ok: true, seq: 2, activeMs: 5_000 });
  t = 9_000; assert.equal((s.act(act('mark', 'I02', 'AMR', 'B')) as { seq: number }).seq, 3);
  t = 12_000; assert.equal((s.act(act('clear', 'I01', 'NA', '')) as { seq: number }).seq, 4);
  assert.deepEqual(s.items(), { I01: { state: 'NA', answer: '', seq: 4 }, I02: { state: 'AMR', answer: 'B', seq: 3 } });
  const [e] = s.entriesAfter(2, 1);
  const p = parseSignedLine(e.line);
  if (!p.ok) throw new Error(p.detail);
  assert.equal(p.header.kind, 'mark');
  assert.equal(p.header.activeMs, 9_000);
  assert.deepEqual(openBody(cell.priv, { ...s.ctx, seq: 3 }, fromB64(e.env), p.header.bodyCommit).body, { item: 'I02', state: 'AMR', answer: 'B', meta: [1234, []] });
  assert.equal(s.hashAt(3), s.journal.headers[3].prev);
  s.close();
  rmSync(dir, { recursive: true });
});

test('resume: answers come back from the journal and activeMs continues from the last entry, never backwards', () => {
  const dir = mkdtempSync(join(tmpdir(), 'saakshi-exam-'));
  let t = 1_000;
  const a = session(dir, () => t);
  a.start();
  t = 61_000; a.act(act('answer', 'I03', 'A', 'C'));
  t = 90_000;                                        // crash: 29 s after the last entry are not charged
  a.close();
  t = 0;                                             // new process, new monotonic clock
  const b = session(dir, () => t);
  assert.equal(b.started, true);
  assert.deepEqual(b.items(), { I03: { state: 'A', answer: 'C', seq: 2 } });
  assert.equal(b.activeMs(), 60_000);
  t = 10_000; b.act(act('answer', 'I01', 'A', 'A'));
  const hs = b.journal.headers;
  assert.equal(hs[2].activeMs, 70_000);
  assert.ok(hs[2].tMonoMs >= hs[1].tMonoMs);
  assert.equal(b.remainingMs(), D - 70_000);
  b.close();
  rmSync(dir, { recursive: true });
});

test('actions outside the NTA rules, before start or after time is up are refused', () => {
  const dir = mkdtempSync(join(tmpdir(), 'saakshi-exam-'));
  let t = 0;
  const s = session(dir, () => t);
  assert.deepEqual(s.act(act('answer', 'I01', 'A', 'B')), { ok: false, error: 'exam not started' });
  s.start();
  for (const bad of [act('answer', 'I99', 'A', 'B'), act('answer', 'I01', 'A', 'E'), act('answer', 'I01', 'MR', ''), act('mark', 'I01', 'MR', 'B'),
    act('mark', 'I01', 'AMR', ''), act('clear', 'I01', 'NA', 'A'), { ...act('answer', 'I01', 'A', 'B'), dwellMs: Number.NaN }])
    assert.equal(s.act(bad).ok, false, JSON.stringify(bad));
  t = D + 1;
  assert.deepEqual(s.act(act('answer', 'I01', 'A', 'B')), { ok: false, error: 'time is up' });
  assert.equal(s.head(), 1);
  s.close();
  rmSync(dir, { recursive: true });
});

test('an idle entry is journaled after 60 s without one, and not before', () => {
  const dir = mkdtempSync(join(tmpdir(), 'saakshi-exam-'));
  let t = 0;
  const s = session(dir, () => t);
  s.tick();
  assert.equal(s.head(), 0);
  s.start();
  t = IDLE_MS - 1; s.tick();
  assert.equal(s.head(), 1);
  t = IDLE_MS; s.tick();
  assert.equal(s.head(), 2);
  assert.equal(s.journal.headers[1].kind, 'idle');
  assert.equal(s.journal.headers[1].activeMs, IDLE_MS);
  s.close();
  rmSync(dir, { recursive: true });
});
```
Run: `cd apps/seat && node --test test/exam.test.ts`. Expected: FAIL with `Cannot find module`.

- [ ] **Step 2: Implement `exam.ts`, then run the test and confirm it passes**

`apps/seat/src/main/exam.ts`:
```ts
import { randomBytes } from '@saakshi/core/bytes';
import { signedLine } from '@saakshi/core/journal';
import { sealBody, signer, verifier, type KeyPair } from '@saakshi/core/node';
import { genesisPrev, type Body, type Ctx, type Header, type Kind, type State } from '@saakshi/core/protocol';
import { toB64, type WireEntry } from '@saakshi/core/wire';
import type { Action, ActResult, ItemState } from '../shared/ipc.ts';
import { SeatJournal, type Wrapper } from './journal-store.ts';
import type { SyncSource } from './sync.ts';

export interface SessionOpts {
  dir: string; ctx: Ctx; keyEpoch: number; seat: KeyPair; cellPub: Uint8Array; wrap: Wrapper;
  durationMs: number; items: readonly string[]; clock?: () => number;
}

export const IDLE_MS = 60_000;
const OPTIONS = ['A', 'B', 'C', 'D'];
const EMPTY: Body = { item: '', state: '', answer: '', meta: [] };

/** One candidate's exam on this seat: builds, signs and seals entries, and keeps the active-time clock. */
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

  /** Called every few seconds: checkpoints activeMs with an idle entry after 60 s of silence. */
  tick(): void {
    if (this.started && this.remainingMs() > 0 && this.#clock() - this.#lastEntryAt >= IDLE_MS) this.#append('idle', EMPTY);
  }

  head(): number { return this.journal.head; }
  hashAt(seq: number): string { return this.journal.hashAt(seq); }
  entriesAfter(after: number, limit: number): WireEntry[] {
    return this.journal.recs.slice(after, after + limit).map((r) => ({ line: r.line, env: toB64(r.env) }));
  }
  close(): void { this.journal.close(); }

  #check(a: Action): string {
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
Run: `node --test test/exam.test.ts`. Expected: 4 pass.

- [ ] **Step 3: Wire main and preload**

`apps/seat/src/preload/index.ts`:
```ts
import { contextBridge, ipcRenderer } from 'electron';
import type { Action, SeatApi, SyncView } from '../shared/ipc.ts';

const api: SeatApi = {
  load: () => ipcRenderer.invoke('exam:load'),
  start: () => ipcRenderer.invoke('exam:start'),
  act: (a: Action) => ipcRenderer.invoke('exam:act', a),
  onSync: (cb) => {
    const h = (_e: unknown, v: SyncView) => cb(v);
    ipcRenderer.on('sync', h);
    return () => { ipcRenderer.removeListener('sync', h); };
  },
};
contextBridge.exposeInMainWorld('saakshi', api);
```

`apps/seat/src/main/index.ts` (full replacement; the probe self-test, `app://` handling, CSP and permission handlers are unchanged from Stage 0):
```ts
import { app, BrowserWindow, dialog, ipcMain, protocol, safeStorage, session, systemPreferences } from 'electron';
import { readFile, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { cellKey, DEV_EXAM, devForm, devSeat, type KeysFile } from '@saakshi/core/dev';
import { verifier } from '@saakshi/core/node';
import keysJson from '../../../../fixtures/keys.json';
import formsJson from '../../../../fixtures/paper/forms.json';
import type { Action, ActResult, ExamBoot } from '../shared/ipc.ts';
import { resolveAppPath } from './app-path.ts';
import { ExamSession } from './exam.ts';
import { runSelftest } from './probes.ts';
import { httpSend, SeatSync } from './sync.ts';

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

  // DEV until Stage 3: the seat key and pinned cell key come from the bundled demo fixtures (which also hold private keys).
  const keys = keysJson as KeysFile;
  const forms = formsJson as unknown as Record<'F1' | 'F2', string[]> & { durationMin: number };
  const cand = setting('--cand', 'SAAKSHI_CAND', 'C0001');
  const relayUrl = setting('--relay', 'SAAKSHI_RELAY', 'http://127.0.0.1:7070');
  const seat = devSeat(keys, cand);
  const cell = cellKey(keys, 'cell-1');
  const form = devForm(cand);
  const durationMs = forms.durationMin * 60_000;
  let exam: ExamSession | undefined;
  let sync: SeatSync | undefined;
  let win: BrowserWindow | undefined;

  const guard = (fn: () => ActResult): ActResult => { try { return fn(); } catch (e) { return { ok: false, error: (e as Error).message }; } };
  ipcMain.handle('exam:load', (): ExamBoot => ({
    cand, seatId: seat!.seatId, form, durationMs, activeMs: exam!.activeMs(), started: exam!.started, items: exam!.items(), sync: sync!.view(),
  }));
  ipcMain.handle('exam:start', () => guard(() => { const r = exam!.start(); sync!.kick(); return r; }));
  ipcMain.handle('exam:act', (_e, a: Action) => guard(() => { const r = exam!.act(a); if (r.ok) sync!.kick(); return r; }));

  app.whenReady().then(async () => {
    if (!seat) { dialog.showErrorBox('Saakshi', `No DEV seat key for candidate ${cand}`); app.exit(1); return; }
    if (!safeStorage.isEncryptionAvailable()) { dialog.showErrorBox('Saakshi', 'OS key storage (safeStorage) is unavailable, so the journal cannot be encrypted.'); app.exit(1); return; }
    try {
      exam = new ExamSession({ dir: join(app.getPath('userData'), 'journal'), ctx: { ...DEV_EXAM, cand }, keyEpoch: 1, seat, cellPub: cell.pub, wrap: safeStorage, durationMs, items: forms[form] });
    } catch (e) { dialog.showErrorBox('Saakshi — journal problem, please call the invigilator', (e as Error).message); app.exit(1); return; }
    sync = new SeatSync(exam, httpSend(relayUrl), verifier(cell.pub), (v) => win?.webContents.send('sync', v));
    sync.start(1000);
    setInterval(() => exam!.tick(), 5000);

    protocol.handle('app', async (req) => {
      const p = resolveAppPath(RENDERER, new URL(req.url).pathname);
      if (!p) return new Response('not found', { status: 404 });
      try {
        return new Response(await readFile(p), { headers: { 'content-type': MIME[extname(p)] ?? 'application/octet-stream', 'content-security-policy': CSP } });
      } catch { return new Response('not found', { status: 404 }); }
    });
    session.defaultSession.setPermissionRequestHandler((_wc, perm, cb) => cb(perm === 'media'));
    session.defaultSession.setPermissionCheckHandler((_wc, perm) => perm === 'media');
    if (process.platform === 'darwin') await systemPreferences.askForMediaAccess('camera');

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
  app.on('window-all-closed', () => { sync?.stop(); exam?.close(); app.quit(); });
}
```

- [ ] **Step 4: Run all seat tests and build the bundle**

Run: `cd apps/seat && pnpm test && pnpm typecheck && pnpm build`
Expected:
- The tests pass (app-path, probe-parse, journal-store, sync, exam) and tsc is clean.
- `electron-vite build` succeeds, and `out/main/index.js` contains no `require("@saakshi/core` (core is bundled): check with `grep -c '@saakshi/core' out/main/index.js`, which should print `0`.
- If the JSON import fails to bundle, report it rather than switching to runtime `readFileSync` of repo paths, which breaks when packaged.

- [ ] **Step 5: Hand back for review and commit** with the message `feat(seat): exam session — sealed entries, active-time clock, idle checkpoints, IPC and sync wiring`.

---

### Task 9: Exam UI — NTA layout, palette, EN/HI, ticks, timer, WCAG, face chip

**Files:**
- Create:
  - `apps/seat/src/renderer/src/{exam-state.ts,i18n.ts,Palette.tsx,FaceChip.tsx,styles.css}`
  - `apps/seat/src/renderer/public/fonts/{NotoSansDevanagari.ttf,OFL.txt}` (downloaded)
- Replace: `apps/seat/src/renderer/src/App.tsx`
- Modify: `apps/seat/src/renderer/src/main.tsx` (import `./styles.css`)
- Test: `apps/seat/test/exam-state.test.ts`

**Interfaces:**
- Consumes: the `ipc.ts` types only (Task 1); `window.saakshi` is declared here. `fixtures/paper/{bank,forms}.json` is imported directly.
- Produces:
  - `exam-state.ts`:
    - `type Tick`, `GLYPH`, `PALETTE_STATES`
    - `tickOf(seq, v)`
    - `displayState(items, visited, item)`
    - `saveAndNext(item, selected, cur, dwellMs)`, `markAndNext(…)` and `clearResponse(item, cur, dwellMs)`, each returning `Action | null`
    - `legendCounts(order, items, visited)`
    - `fmtRemaining(ms)`
  - `i18n.ts`: `interface Strings` and `T: Record<Lang, Strings>`

- [ ] **Step 1: Fetch the Devanagari font.** This is a download, so the **controller confirms with the user first**. The file is Noto Sans Devanagari (variable, OFL-1.1) from the Google Fonts repository. As of 2026-09-27 the TTF was 641,944 bytes.

```bash
mkdir -p apps/seat/src/renderer/public/fonts
curl -fL -o apps/seat/src/renderer/public/fonts/NotoSansDevanagari.ttf \
  'https://raw.githubusercontent.com/google/fonts/main/ofl/notosansdevanagari/NotoSansDevanagari%5Bwdth%2Cwght%5D.ttf'
curl -fL -o apps/seat/src/renderer/public/fonts/OFL.txt \
  'https://raw.githubusercontent.com/google/fonts/main/ofl/notosansdevanagari/OFL.txt'
shasum -a 256 apps/seat/src/renderer/public/fonts/*
```
Expected: a TTF of about 640 KB, and `OFL.txt` starting with `Copyright`. Record both sha256 values in the commit message.

- [ ] **Step 2: Write the failing test**

`apps/seat/test/exam-state.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ItemState, SyncView } from '../src/shared/ipc.ts';
import { clearResponse, displayState, fmtRemaining, legendCounts, markAndNext, saveAndNext, tickOf } from '../src/renderer/src/exam-state.ts';
import { T } from '../src/renderer/src/i18n.ts';

const v: SyncView = { local: 10, relay: 7, cell: 4, online: true, error: '' };
const A = (answer: string, seq = 3): ItemState => ({ state: 'A', answer, seq });

test('ticks: ✓ local, ✓✓ relay, blue ✓✓ cell', () => {
  assert.deepEqual([0, 3, 4, 5, 7, 8, 10].map((s) => tickOf(s, v)), ['none', 'cell', 'cell', 'relay', 'relay', 'local', 'local']);
});

test('palette state: saved state wins, else NA if visited, else NV', () => {
  const items = { I01: A('B'), I02: { state: 'MR', answer: '', seq: 4 } as ItemState };
  const visited = new Set(['I01', 'I03']);
  assert.deepEqual(['I01', 'I02', 'I03', 'I04'].map((i) => displayState(items, visited, i)), ['A', 'MR', 'NA', 'NV']);
  assert.deepEqual(legendCounts(['I01', 'I02', 'I03', 'I04'], items, visited), { NV: 1, NA: 1, A: 1, MR: 1, AMR: 0 });
});

test('NTA buttons map to journal actions, and to nothing when nothing changes', () => {
  assert.deepEqual(saveAndNext('I01', 'C', undefined, 5), { kind: 'answer', item: 'I01', state: 'A', answer: 'C', dwellMs: 5 });
  assert.equal(saveAndNext('I01', 'C', A('C'), 5), null);
  assert.deepEqual(saveAndNext('I01', 'C', { state: 'AMR', answer: 'C', seq: 2 }, 5)?.state, 'A');   // unmarks
  assert.equal(saveAndNext('I01', '', undefined, 5), null);                                           // navigation only
  assert.deepEqual(markAndNext('I01', '', undefined, 5), { kind: 'mark', item: 'I01', state: 'MR', answer: '', dwellMs: 5 });
  assert.deepEqual(markAndNext('I01', 'B', A('B'), 5)?.state, 'AMR');
  assert.equal(markAndNext('I01', 'B', { state: 'AMR', answer: 'B', seq: 2 }, 5), null);
  assert.deepEqual(clearResponse('I01', A('D'), 5), { kind: 'clear', item: 'I01', state: 'NA', answer: '', dwellMs: 5 });
  assert.equal(clearResponse('I01', undefined, 5), null);
  assert.equal(clearResponse('I01', { state: 'MR', answer: '', seq: 2 }, 5), null);
});

test('timer text clamps at zero and switches to h:mm:ss', () => {
  assert.deepEqual([-5, 0, 999, 61_000, 30 * 60_000, 3_600_000 + 1_000].map(fmtRemaining), ['00:00', '00:00', '00:01', '01:01', '30:00', '1:00:01']);
});

test('EN and HI catalogues have the same keys, no empty strings, and HI is Devanagari', () => {
  const flat = (o: object, p = ''): [string, string][] => Object.entries(o).flatMap(([k, x]) => (typeof x === 'string' ? [[p + k, x] as [string, string]] : flat(x, `${p}${k}.`)));
  const en = flat(T.en), hi = flat(T.hi);
  assert.deepEqual(hi.map(([k]) => k), en.map(([k]) => k));
  for (const [k, s] of [...en, ...hi]) if (k !== 'tick.none') assert.ok(s.length > 0, k);
  for (const k of ['saveNext', 'markNext', 'clear', 'timeUp']) assert.match(hi.find(([x]) => x === k)![1], /[ऀ-ॿ]/, k);
});
```
Run: `cd apps/seat && node --test test/exam-state.test.ts`. Expected: FAIL with `Cannot find module`.

- [ ] **Step 3: Implement the pure modules, then run the test and confirm it passes**

`apps/seat/src/renderer/src/exam-state.ts`:
```ts
import type { State } from '@saakshi/core/protocol';
import type { Action, ItemState, SyncView } from '../../shared/ipc.ts';

export type Tick = 'none' | 'local' | 'relay' | 'cell';
export const GLYPH: Record<Tick, string> = { none: '', local: '✓', relay: '✓✓', cell: '✓✓' };
export const PALETTE_STATES: readonly State[] = ['NV', 'NA', 'A', 'MR', 'AMR'];

export const tickOf = (seq: number, v: SyncView): Tick => (seq <= 0 ? 'none' : seq <= v.cell ? 'cell' : seq <= v.relay ? 'relay' : 'local');

/** Saved (journaled) state wins; otherwise red once visited. Visits are navigation, which is not journaled. */
export const displayState = (items: Record<string, ItemState>, visited: ReadonlySet<string>, item: string): State =>
  items[item]?.state ?? (visited.has(item) ? 'NA' : 'NV');

export function saveAndNext(item: string, selected: string, cur: ItemState | undefined, dwellMs: number): Action | null {
  if (!selected || (cur?.state === 'A' && cur.answer === selected)) return null;
  return { kind: 'answer', item, state: 'A', answer: selected, dwellMs };
}

export function markAndNext(item: string, selected: string, cur: ItemState | undefined, dwellMs: number): Action | null {
  const state: State = selected ? 'AMR' : 'MR';
  if (cur?.state === state && cur.answer === selected) return null;
  return { kind: 'mark', item, state, answer: selected, dwellMs };
}

export function clearResponse(item: string, cur: ItemState | undefined, dwellMs: number): Action | null {
  return cur?.answer ? { kind: 'clear', item, state: 'NA', answer: '', dwellMs } : null;
}

export function legendCounts(order: readonly string[], items: Record<string, ItemState>, visited: ReadonlySet<string>): Record<State, number> {
  const c: Record<State, number> = { NV: 0, NA: 0, A: 0, MR: 0, AMR: 0 };
  for (const id of order) c[displayState(items, visited, id)]++;
  return c;
}

export function fmtRemaining(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const p = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${p(m)}:${p(sec)}` : `${p(m)}:${p(sec)}`;
}
```

`apps/seat/src/renderer/src/i18n.ts` (the Hindi should be proofread by a native speaker before the demo):
```ts
import type { State } from '@saakshi/core/protocol';
import type { Lang } from '../../shared/ipc.ts';
import type { Tick } from './exam-state.ts';

export interface Strings {
  title: string; candidate: string; form: string; start: string; startNote: string; question: string;
  timeLeft: string; timeUp: string; lang: string; palette: string; saveNext: string; markNext: string; clear: string;
  saved: string; online: string; offline: string; faces: string; cameraOff: string;
  state: Record<State, string>; tick: Record<Tick, string>;
}

export const T: Record<Lang, Strings> = {
  en: {
    title: 'Saakshi exam', candidate: 'Candidate', form: 'Form', start: 'Start exam',
    startNote: 'Each answer is saved on this computer first, then at the centre server, then at the exam server. The ticks next to each question show how far it has reached.',
    question: 'Question', timeLeft: 'Time left', timeUp: 'Time is up. Please wait for the invigilator.', lang: 'Language',
    palette: 'Question palette', saveNext: 'Save & Next', markNext: 'Mark for Review & Next', clear: 'Clear Response',
    saved: 'Saved', online: 'Connected', offline: 'Offline — your answers are safe on this computer', faces: 'Faces', cameraOff: 'Camera unavailable',
    state: { NV: 'Not visited', NA: 'Not answered', A: 'Answered', MR: 'Marked for review', AMR: 'Answered and marked for review (will be evaluated)' },
    tick: { none: '', local: 'saved on this computer', relay: 'saved at the centre server', cell: 'saved at the exam server' },
  },
  hi: {
    title: 'साक्षी परीक्षा', candidate: 'अभ्यर्थी', form: 'प्रश्न-पत्र', start: 'परीक्षा शुरू करें',
    startNote: 'हर उत्तर पहले इस कंप्यूटर पर, फिर केंद्र सर्वर पर और फिर परीक्षा सर्वर पर सहेजा जाता है। हर प्रश्न के पास के टिक बताते हैं कि उत्तर कहाँ तक पहुँचा है।',
    question: 'प्रश्न', timeLeft: 'शेष समय', timeUp: 'समय समाप्त। कृपया निरीक्षक की प्रतीक्षा करें।', lang: 'भाषा',
    palette: 'प्रश्न पैलेट', saveNext: 'सहेजें और आगे बढ़ें', markNext: 'समीक्षा हेतु चिह्नित करें और आगे बढ़ें', clear: 'उत्तर मिटाएँ',
    saved: 'सहेजा गया', online: 'जुड़ा हुआ', offline: 'ऑफ़लाइन — आपके उत्तर इस कंप्यूटर पर सुरक्षित हैं', faces: 'चेहरे', cameraOff: 'कैमरा उपलब्ध नहीं',
    state: { NV: 'नहीं देखा', NA: 'उत्तर नहीं दिया', A: 'उत्तर दिया', MR: 'समीक्षा हेतु चिह्नित', AMR: 'उत्तर दिया और समीक्षा हेतु चिह्नित (मूल्यांकन होगा)' },
    tick: { none: '', local: 'इस कंप्यूटर पर सहेजा गया', relay: 'केंद्र सर्वर पर सहेजा गया', cell: 'परीक्षा सर्वर पर सहेजा गया' },
  },
};
```
Run: `node --test test/exam-state.test.ts`. Expected: 5 pass.

- [ ] **Step 4: Write the components and styles**

`apps/seat/src/renderer/src/FaceChip.tsx` (the Stage 0 detector, shrunk to a status chip):
```tsx
import { useEffect, useRef, useState } from 'react';
import { FaceDetector, FilesetResolver } from '@mediapipe/tasks-vision';

export function FaceChip({ label, unavailable }: { label: string; unavailable: string }) {
  const video = useRef<HTMLVideoElement>(null);
  const [faces, setFaces] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let timer: number | undefined, stream: MediaStream | undefined, detector: FaceDetector | undefined;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
        const v = video.current!;
        v.srcObject = stream;
        await v.play();
        const fileset = await FilesetResolver.forVisionTasks(new URL('mediapipe/wasm', location.href).href);
        detector = await FaceDetector.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: new URL('mediapipe/blaze_face_short_range.tflite', location.href).href, delegate: 'CPU' },
          runningMode: 'VIDEO',
        });
        timer = window.setInterval(() => { if (v.readyState >= 2) setFaces(detector!.detectForVideo(v, performance.now()).detections.length); }, 500);
      } catch { setFailed(true); }
    })();
    return () => { clearInterval(timer); stream?.getTracks().forEach((t) => t.stop()); detector?.close(); };
  }, []);

  const text = failed ? unavailable : `${label}: ${faces ?? '—'}`;
  return (
    <span className={`chip${faces !== null && faces !== 1 ? ' warn' : ''}`} aria-label={text}>
      <video ref={video} muted playsInline aria-hidden="true" />
      <span aria-hidden="true">{text}</span>
    </span>
  );
}
```

`apps/seat/src/renderer/src/Palette.tsx`:
```tsx
import type { ItemState, SyncView } from '../../shared/ipc.ts';
import { displayState, legendCounts, PALETTE_STATES, tickOf } from './exam-state.ts';
import type { Strings } from './i18n.ts';

interface Props { order: readonly string[]; items: Record<string, ItemState>; visited: ReadonlySet<string>; current: number; sync: SyncView; t: Strings; onPick: (i: number) => void }

export function Palette({ order, items, visited, current, sync, t, onPick }: Props) {
  const counts = legendCounts(order, items, visited);
  return (
    <nav className="palette" aria-label={t.palette}>
      <h2 className="palette-title">{t.palette}</h2>
      <ol className="grid">
        {order.map((id, i) => {
          const s = displayState(items, visited, id);
          const tick = tickOf(items[id]?.seq ?? 0, sync);
          return (
            <li key={id}>
              <button
                className={`pal ${s}${i === current ? ' current' : ''}`}
                aria-current={i === current ? 'step' : undefined}
                aria-label={`${t.question} ${i + 1}: ${t.state[s]}${tick === 'none' ? '' : `, ${t.tick[tick]}`}`}
                onClick={() => onPick(i)}
              >{i + 1}</button>
            </li>
          );
        })}
      </ol>
      <ul className="legend">
        {PALETTE_STATES.map((s) => (
          <li key={s}><span className={`pal ${s} mini`} aria-hidden="true">{counts[s]}</span>{t.state[s]}<span className="sr-only">: {counts[s]}</span></li>
        ))}
      </ul>
    </nav>
  );
}
```

`apps/seat/src/renderer/src/App.tsx`:
```tsx
import { useEffect, useRef, useState } from 'react';
import bankJson from '../../../../../fixtures/paper/bank.json';
import formsJson from '../../../../../fixtures/paper/forms.json';
import type { Action, ExamBoot, ItemState, Lang, SeatApi, SyncView } from '../../shared/ipc.ts';
import { clearResponse, fmtRemaining, GLYPH, markAndNext, saveAndNext, tickOf } from './exam-state.ts';
import { FaceChip } from './FaceChip.tsx';
import { T, type Strings } from './i18n.ts';
import { Palette } from './Palette.tsx';

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
  const [visited, setVisited] = useState<Set<string>>(() => new Set([...Object.keys(boot.items), ...(boot.started ? [order[0]] : [])]));
  const [idx, setIdx] = useState(0);
  const [selected, setSelected] = useState(boot.items[order[0]]?.answer ?? '');
  const [sync, setSync] = useState<SyncView>(boot.sync);
  const [notice, setNotice] = useState('');
  const [clock, setClock] = useState({ base: boot.activeMs, at: performance.now() });
  const [now, setNow] = useState(performance.now());
  const shownAt = useRef(performance.now());
  const heading = useRef<HTMLHeadingElement>(null);
  const t = T[lang];

  useEffect(() => window.saakshi.onSync(setSync), []);
  useEffect(() => { const id = setInterval(() => setNow(performance.now()), 250); return () => clearInterval(id); }, []);
  useEffect(() => { try { localStorage.setItem('lang', lang); } catch { /* per-viewer convenience only */ } document.documentElement.lang = lang; }, [lang]);

  const remaining = boot.durationMs - (started ? clock.base + (now - clock.at) : 0);
  const timeUp = started && remaining <= 0;
  const item = order[idx];

  function go(i: number, its: Record<string, ItemState> = items) {
    const n = (i + order.length) % order.length, next = order[n];
    setIdx(n);
    setVisited((v) => new Set(v).add(next));
    setSelected(its[next]?.answer ?? '');
    shownAt.current = performance.now();
    requestAnimationFrame(() => heading.current?.focus());
  }

  async function commit(a: Action | null, advance: boolean) {
    let its = items;
    if (a) {
      const r = await window.saakshi.act(a);
      if (!r.ok) { setNotice(r.error); return; }
      its = { ...items, [a.item]: { state: a.state, answer: a.answer, seq: r.seq } };
      setItems(its);
      setClock({ base: r.activeMs, at: performance.now() });
      setNotice(`${t.saved} ✓`);
    }
    if (advance) go(idx + 1, its); else setSelected(its[item]?.answer ?? '');
  }
  const dwell = () => performance.now() - shownAt.current;

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
        }}>{t.start}</button>
        <p role="status">{notice}</p>
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
        <FaceChip label={t.faces} unavailable={t.cameraOff} />
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

`apps/seat/src/renderer/src/main.tsx`: add `import './styles.css';` as the first line.

`apps/seat/src/renderer/src/styles.css`:
```css
@font-face { font-family: 'Noto Sans Devanagari'; src: url('/fonts/NotoSansDevanagari.ttf') format('truetype'); font-weight: 100 900; font-display: block; }
:root {
  --ink: #202124; --muted: #5f6368; --line: #dadce0; --blue: #1565c0;
  --nv-bg: #e8eaed; --na: #c62828; --a: #2e7d32; --mr: #6a1b9a;
  font-family: system-ui, 'Noto Sans Devanagari', sans-serif; color: var(--ink); background: #fff;
}
:lang(hi) { font-family: 'Noto Sans Devanagari', system-ui, sans-serif; }
* { box-sizing: border-box; }
body { margin: 0; line-height: 1.5; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
:focus-visible { outline: 3px solid var(--blue); outline-offset: 2px; }

.exam { display: grid; grid-template-columns: minmax(0, 1fr) minmax(14rem, 20rem); grid-template-rows: auto 1fr; min-height: 100vh; }
.bar { grid-column: 1 / -1; display: flex; flex-wrap: wrap; gap: .5rem 1.25rem; align-items: center; padding: .5rem 1rem; border-bottom: 1px solid var(--line); }
.question { padding: 1rem 1.5rem; min-width: 0; }
.palette { padding: 1rem; border-left: 1px solid var(--line); }
/* 200% zoom on a 1200 px window is a 600 px viewport: stack the palette under the question. */
@media (max-width: 48rem) { .exam { grid-template-columns: 1fr; } .palette { border-left: 0; border-top: 1px solid var(--line); } }

.timer { font-variant-numeric: tabular-nums; font-size: 1.25rem; font-weight: 700; }
.timer.low { color: var(--na); }
.sync { display: flex; flex-wrap: wrap; gap: .75rem; font-size: .875rem; font-variant-numeric: tabular-nums; }
.sync .cell { color: var(--blue); }
.offline { color: var(--na); font-weight: 700; }
.chip { display: inline-flex; align-items: center; gap: .5rem; font-size: .875rem; border: 1px solid var(--line); border-radius: 999px; padding: .125rem .75rem .125rem .125rem; }
.chip.warn { border-color: var(--na); }
.chip video { width: 48px; height: 36px; border-radius: 999px; object-fit: cover; background: #111; }
.lang { display: inline-flex; gap: .25rem; }
.lang button[aria-pressed='true'] { background: var(--ink); color: #fff; }

h2 { font-size: 1.25rem; margin: 0 0 .75rem; }
.tick { font-size: .9em; color: var(--muted); margin-left: .5rem; }
.tick.cell { color: var(--blue); }
fieldset { border: 0; padding: 0; margin: 0 0 1rem; min-width: 0; }
fieldset:disabled { opacity: .6; }
legend.q-text { font-size: 1.125rem; margin-bottom: .75rem; padding: 0; }
.opt { display: flex; gap: .5rem; align-items: center; padding: .5rem .75rem; border: 1px solid var(--line); border-radius: .375rem; margin: .375rem 0; cursor: pointer; }
.opt:has(input:checked) { border-color: var(--blue); background: #e8f0fe; }
.letter { font-weight: 700; }
.actions { display: flex; flex-wrap: wrap; gap: .5rem; }
button { font: inherit; padding: .5rem 1rem; border-radius: .375rem; border: 1px solid var(--muted); background: #fff; color: var(--ink); cursor: pointer; min-height: 2.75rem; }
button.primary { background: var(--a); color: #fff; border-color: var(--a); }
button.mark { background: var(--mr); color: #fff; border-color: var(--mr); }
button:disabled { opacity: .5; cursor: not-allowed; }
.notice { min-height: 1.5em; color: var(--muted); }

.palette-title { font-size: 1rem; }
.grid { list-style: none; padding: 0; margin: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(2.75rem, 1fr)); gap: .375rem; }
.pal { position: relative; min-width: 2.75rem; min-height: 2.75rem; padding: 0; font-weight: 700; border: 1px solid transparent; border-radius: .375rem; }
.pal.NV { background: var(--nv-bg); color: var(--ink); border-color: #9aa0a6; }
.pal.NA { background: var(--na); color: #fff; }
.pal.A { background: var(--a); color: #fff; }
.pal.MR, .pal.AMR { background: var(--mr); color: #fff; border-radius: 50%; }
.pal.AMR::after { content: ''; position: absolute; right: -2px; bottom: -2px; width: .75rem; height: .75rem; border-radius: 50%; background: var(--a); border: 2px solid #fff; }
.pal.current { outline: 3px solid var(--ink); outline-offset: 2px; }
.legend { list-style: none; padding: 0; margin: 1rem 0 0; display: grid; gap: .375rem; font-size: .875rem; }
.legend .mini { display: inline-grid; place-items: center; min-width: 2rem; min-height: 2rem; margin-right: .5rem; }
.start { max-width: 40rem; margin: 3rem auto; padding: 0 1rem; }
@media (forced-colors: active) { .pal { border: 2px solid CanvasText; } .pal.AMR::after { background: CanvasText; } }
```

- [ ] **Step 5: Typecheck and build**

Run: `cd apps/seat && pnpm test && pnpm typecheck && pnpm build`
Expected:
- The tests pass and tsc is clean.
- The build emits `out/renderer/fonts/NotoSansDevanagari.ttf`.
- Before Task 8 lands, the renderer cannot run (`window.saakshi.load` is missing); the visual check happens in Task 12.

- [ ] **Step 6: Hand back for review and commit** with the message `feat(seat): NTA exam UI — palette, EN/HI with Noto Sans Devanagari, ticks, timer, WCAG basics, face chip`, including the font sha256.

---

### Task 10: Kill test — `tools/chaos-kill.ts`

**Files:**
- Create: `tools/chaos-kill.ts`

**Interfaces:**
- Consumes:
  - `apps/server/src/main.ts` (the env contract and the `READY` line)
  - `SeatSync` and `httpSend` (Task 7): the seat's own sync code drives the simulated seats
  - `SimSeat`, `verifyChain`, `openBody`, `parseSignedLine`, `cellKey`, `devSeat`
- Produces: `bun tools/chaos-kill.ts [--seats 8] [--entries 200]`. It prints `sent=… relay-acked=… cell-acked=… stored=… lost=0 …` and `PASS`, with exit code 0; any failure exits 1.

- [ ] **Step 1: Write the script** (it is the test: it asserts, and exits non-zero on any mismatch)

`tools/chaos-kill.ts`:
```ts
// Stage 1 kill test. Spawns a real cell and relay, pumps entries from simulated seats through the seat's own sync
// loop, SIGKILLs the cell mid-stream, restarts it, then wipes its DB (REBUILDING) and restarts again.
// Asserts: nothing the cell acknowledged is lost, the relay keeps acking while the cell is down, and at the end
// sent = relay-acked = cell-acked = stored, lost = 0, with every stored chain verifying and every body opening.
//   bun tools/chaos-kill.ts [--seats 8] [--entries 200]
import { Database } from 'bun:sqlite';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { cellKey, devSeat, type KeysFile } from '../packages/core/src/dev.ts';
import { parseSignedLine, verifyChain } from '../packages/core/src/journal.ts';
import { openBody, verifier } from '../packages/core/src/node.ts';
import type { HeadsRes } from '../packages/core/src/wire.ts';
import { httpSend, SeatSync } from '../apps/seat/src/main/sync.ts';
import { SimSeat } from './sim-seat.ts';

const { values } = parseArgs({ options: { seats: { type: 'string', default: '8' }, entries: { type: 'string', default: '200' } } });
const SEATS = Number(values.seats), TARGET = Number(values.entries);
const root = resolve(import.meta.dir, '..');
const keys = JSON.parse(readFileSync(join(root, 'fixtures/keys.json'), 'utf8')) as KeysFile;
const cell = cellKey(keys, 'cell-1');
const dir = mkdtempSync(join(tmpdir(), 'saakshi-kill-'));
const cellDb = join(dir, 'cell.db');
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const fail = (m: string): never => { throw new Error(m); };

const freePort = (): number => { const s = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Response() }); const p = s.port!; s.stop(true); return p; };

async function spawnServer(env: Record<string, string>) {
  const proc = Bun.spawn(['bun', join(root, 'apps/server/src/main.ts')], { cwd: dir, env: { ...process.env, DEV: '1', ...env }, stdout: 'pipe', stderr: 'inherit' });
  const reader = proc.stdout.getReader();
  let buf = '';
  const deadline = Date.now() + 15_000;
  while (!buf.includes('READY ')) {
    if (Date.now() > deadline) fail(`${env.MODE} did not start`);
    const { value, done } = await reader.read();
    if (done) fail(`${env.MODE} exited before READY: ${buf}`);
    buf += new TextDecoder().decode(value);
  }
  void (async () => { try { while (!(await reader.read()).done); } catch { /* process gone */ } })();
  return proc;
}

const cellPort = freePort(), relayPort = freePort();
const cellEnv = { MODE: 'cell', PORT: String(cellPort), DB: cellDb };
let cellProc = await spawnServer(cellEnv);
const relayProc = await spawnServer({ MODE: 'relay', PORT: String(relayPort), HOST: '127.0.0.1', DB: join(dir, 'relay.db'), CELL_URL: `http://127.0.0.1:${cellPort}` });
const relayUrl = `http://127.0.0.1:${relayPort}`;

const seats = Array.from({ length: SEATS }, (_, i) => {
  const sim = new SimSeat(keys, `C${String(i + 1).padStart(4, '0')}`, cell.pub);
  const src = { ctx: sim.ctx, head: () => sim.head, hashAt: (s: number) => sim.hs[s - 1], entriesAfter: (a: number, l: number) => sim.after(a, l) };
  return { sim, sync: new SeatSync(src, httpSend(relayUrl, 2000), verifier(cell.pub)) };
});
const produce = (n: number) => { for (const s of seats) s.sim.add(Math.max(0, Math.min(n, TARGET - s.sim.head))); };
const round = () => Promise.all(seats.map((s) => s.sync.round()));
const views = () => seats.map((s) => s.sync.view());
async function until(pred: () => boolean | Promise<boolean>, what: string, ms = 60_000): Promise<number> {
  const t0 = Date.now();
  while (!(await pred())) {
    if (Date.now() - t0 > ms) fail(`timed out waiting for ${what}: ${JSON.stringify(views())}`);
    await round();
    await Bun.sleep(20);
  }
  return Date.now() - t0;
}
function storedCounts(): Map<string, number> {
  const db = new Database(cellDb);                    // read-write open: a crashed WAL needs recovery
  try { return new Map((db.query('SELECT cand, count(*) AS n FROM entries GROUP BY cand').all() as { cand: string; n: number }[]).map((r) => [r.cand, r.n])); }
  finally { db.close(); }
}
const cellHeads = async (): Promise<HeadsRes> => (await (await fetch(`http://127.0.0.1:${cellPort}/v1/heads`)).json()) as HeadsRes;

try {
  // Phase 1: stream, then SIGKILL the cell mid-stream.
  while (seats[0].sim.head < TARGET * 0.4) { produce(2); await round(); await Bun.sleep(10); }
  await until(() => views().every((v) => v.cell > 0), 'first cell acks');
  cellProc.kill('SIGKILL');
  await cellProc.exited;
  const acked = views().map((v) => v.cell);
  const onDisk = storedCounts();
  seats.forEach((s, i) => { if ((onDisk.get(s.sim.ctx.cand) ?? 0) < acked[i]) fail(`${s.sim.ctx.cand}: cell acked ${acked[i]} but only ${onDisk.get(s.sim.ctx.cand) ?? 0} are on disk`); });
  console.log(`kill -9 cell: ${sum(acked)} entries acknowledged by the cell, all on its disk`);

  // Cell down: seats keep getting ✓✓ from the relay.
  const relayBefore = sum(views().map((v) => v.relay));
  for (let i = 0; i < 20; i++) { produce(1); await round(); await Bun.sleep(20); }
  if (sum(views().map((v) => v.relay)) <= relayBefore) fail('the relay stopped acking while the cell was down');
  console.log(`cell down: relay acked ${sum(views().map((v) => v.relay)) - relayBefore} more entries`);

  // Restart on the same DB and port; finish the stream.
  const t0 = Date.now();
  cellProc = await spawnServer(cellEnv);
  while (seats.some((s) => s.sim.head < TARGET)) { produce(3); await round(); await Bun.sleep(10); }
  await until(() => views().every((v) => v.cell === TARGET && v.relay === TARGET), 'cell catch-up after kill -9');
  const rtoKill = Date.now() - t0;

  // Phase 2: wipe the cell DB → REBUILDING → the relay replays from genesis.
  cellProc.kill('SIGKILL');
  await cellProc.exited;
  for (const f of [cellDb, `${cellDb}-wal`, `${cellDb}-shm`]) rmSync(f, { force: true });
  const t1 = Date.now();
  cellProc = await spawnServer(cellEnv);
  await until(async () => { const h = await cellHeads(); return h.state === 'LIVE' && h.streams.length === SEATS && h.streams.every((s) => s.head === TARGET); }, 'rebuild from the relay');
  const rebuild = Date.now() - t1;
  cellProc.kill('SIGKILL');
  await cellProc.exited;

  // Final accounting on the cell's own disk.
  const db = new Database(cellDb);
  let stored = 0;
  for (const s of seats) {
    const rows = db.query('SELECT line, env FROM entries WHERE cand = ? ORDER BY seq').all(s.sim.ctx.cand) as { line: string; env: Uint8Array }[];
    const chain = verifyChain(s.sim.ctx, rows.map((r) => r.line), verifier(devSeat(keys, s.sim.ctx.cand)!.pub));
    if (!chain.ok || chain.count !== TARGET || chain.head !== s.sim.hs[TARGET - 1]) fail(`${s.sim.ctx.cand}: stored chain differs from what was sent`);
    rows.forEach((r, i) => {
      const p = parseSignedLine(r.line);
      if (!p.ok) fail(`${s.sim.ctx.cand}: unparseable stored line`);
      else openBody(cell.priv, { ...s.sim.ctx, seq: i + 1 }, r.env, p.header.bodyCommit);
    });
    stored += rows.length;
  }
  db.close();
  const sent = SEATS * TARGET, relayAcked = sum(views().map((v) => v.relay)), cellAcked = sum(views().map((v) => v.cell));
  console.log(`sent=${sent} relay-acked=${relayAcked} cell-acked=${cellAcked} stored=${stored} lost=${sent - stored} rto-kill=${rtoKill}ms rebuild=${rebuild}ms`);
  if (relayAcked !== sent || cellAcked !== sent || stored !== sent) fail('counts differ');
  console.log('PASS');
} catch (e) {
  console.error(`FAIL: ${(e as Error).message}`);
  process.exitCode = 1;
} finally {
  relayProc.kill();
  cellProc.kill();
  await Promise.all([relayProc.exited, cellProc.exited]);
  rmSync(dir, { recursive: true, force: true });
}
```

- [ ] **Step 2: Prove that the script can fail.** With the sandbox disabled, temporarily comment out `this.#insert(rows);` in `GroupCommit.flush` (`apps/server/src/store.ts`). Acks then claim rows that never reach disk. Run `bun tools/chaos-kill.ts --entries 100`.
  - Expected: `FAIL: C0001: cell acked N but only 0 are on disk`, with exit code 1.
  - **Revert the change** afterwards and confirm with `grep -n "this.#insert(rows)" apps/server/src/store.ts`.

- [ ] **Step 3: Run it for real**

Run: `bun tools/chaos-kill.ts` (with the sandbox disabled).
Expected: three progress lines, then `sent=1600 relay-acked=1600 cell-acked=1600 stored=1600 lost=0 rto-kill=…ms rebuild=…ms` and `PASS`, with exit code 0. Run it 3 times; it must pass every time.

- [ ] **Step 4: Hand back for review and commit** with the message `test: Stage 1 kill test — SIGKILL and wipe the cell mid-stream, lost = 0`, including one PASS line.

---

### Task 11: CI — server tests and the kill test

**Files:**
- Create: `.github/workflows/server.yml`
- Modify: `.github/workflows/windows.yml` (add `apps/server/**` to both `paths` lists)

**Interfaces:**
- Consumes: `bun test --timeout 60000 apps/server`, `tools/chaos-kill.ts`, and `pnpm --filter @saakshi/server typecheck`.
- Produces:
  - A macOS job, since the demo platform is also where `fullfsync` is meaningful.
  - The Windows job now also runs the server tests through `pnpm -r test`, because `apps/server` has a `test` script.

- [ ] **Step 1: Write the workflow**

`.github/workflows/server.yml`:
```yaml
name: server
on:
  push:
    branches: [main]
    paths: ['apps/server/**', 'apps/seat/src/main/sync.ts', 'apps/seat/src/shared/**', 'packages/**', 'tools/**', 'fixtures/**', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'package.json', '.github/workflows/server.yml']
  pull_request:
    paths: ['apps/server/**', 'apps/seat/src/main/sync.ts', 'apps/seat/src/shared/**', 'packages/**', 'tools/**', 'fixtures/**', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'package.json', '.github/workflows/server.yml']
  workflow_dispatch:
concurrency:
  group: server-${{ github.ref }}
  cancel-in-progress: true
jobs:
  macos:
    runs-on: macos-latest
    timeout-minutes: 20
    env:
      ELECTRON_SKIP_BINARY_DOWNLOAD: '1'
    steps:
      - uses: actions/checkout@v5
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v5
        with: { node-version: 25, cache: pnpm }
      - uses: oven-sh/setup-bun@v2
        with: { bun-version: 1.3.14 }
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter @saakshi/server typecheck
      - run: bun test --timeout 60000 apps/server
      - name: Kill test (SIGKILL + wipe the cell mid-stream)
        run: bun tools/chaos-kill.ts
```

`.github/workflows/windows.yml`: in both `push.paths` and `pull_request.paths`, add `'apps/server/**'` after `'apps/seat/**'`. Change nothing else.

- [ ] **Step 2: Validate locally**

Run: `bun -e "for (const f of ['.github/workflows/server.yml','.github/workflows/windows.yml']) { const y = require('js-yaml').load(require('fs').readFileSync(f,'utf8')); console.log(f, Object.keys(y.jobs)); }"`
Expected: `server.yml [ 'macos' ]` and `windows.yml [ 'windows' ]`. `js-yaml` is already hoisted through electron-builder.

- [ ] **Step 3: Commit and push (controller), then watch**

```bash
git add .github/workflows/server.yml .github/workflows/windows.yml
git commit -m "ci: macOS server tests + kill test; Windows runs server tests via pnpm -r test"
git push
gh run watch --exit-status $(gh run list --workflow server --limit 1 --json databaseId -q '.[0].databaseId')
gh run watch --exit-status $(gh run list --workflow windows --limit 1 --json databaseId -q '.[0].databaseId')
```
Expected: both are green. On Windows, `pnpm -r test` includes `apps/server`'s `bun test`. If a Windows-only server failure appears (for example a file lock on a temp DB in `afterEach`), fix the test cleanup rather than removing the path. Push needs the sandbox disabled.

---

### Task 12: Stage 1 exit check and demo

- [ ] **Step 1: Exit check** (with the sandbox disabled)

```bash
pnpm -r test && pnpm -r typecheck
bun test --timeout 60000 apps/server
bun tools/chaos-kill.ts
```
Expected: everything passes, and the kill test prints `lost=0` and `PASS`.

- [ ] **Step 2: Run the stack**

These commands are for the user or the controller, outside the sandbox. `open` is blocked inside it.

```bash
rm -rf data "$HOME/Library/Application Support/Saakshi/journal"      # clean demo state
DEV=1 MODE=cell  bun apps/server/src/main.ts &
DEV=1 MODE=relay bun apps/server/src/main.ts &
open http://127.0.0.1:7070/console
IP=$(ipconfig getifaddr en0)
cd apps/seat && pnpm pack:mac
open release/mac-arm64/Saakshi.app --args --relay http://$IP:7070 --cand C0001
```
Pointing the seat at the Wi-Fi IP rather than `127.0.0.1` is deliberate: with Wi-Fi off the route disappears, as it would on a real LAN.

- [ ] **Step 3: Sit the exam and record the evidence** (screenshots saved to `docs/evidence/stage1-*.png`)
  1. **Ticks.** Start the exam and answer 5 questions with Save & Next. Each question heading shows ✓, then ✓✓, then blue ✓✓ within about a second. The console tile for C0001 is green, showing `seat 6 · relay 6 · cell 6`.
  2. **Palette states.** Use Mark for Review & Next with and without an option, then Clear Response. The palette shows grey, red, green, purple, and purple with a green dot, and the legend counts agree.
  3. **Hindi.** Switch to हिन्दी. The question, the options and the buttons render in Noto Sans Devanagari with no tofu boxes.
  4. **Keyboard only.** Tab through the language toggle, the options (arrow keys), the three buttons and the palette. The focus ring is always visible, and after Save & Next focus lands on the question heading.
  5. **200% zoom.** Relaunch with `SAAKSHI_ZOOM=2 release/mac-arm64/Saakshi.app/Contents/MacOS/Saakshi --relay http://$IP:7070`. The palette stacks under the question with no horizontal scroll.
  6. **Wi-Fi off.** Answer 3 more. The ticks stay at ✓, the header says "Offline — your answers are safe on this computer", and the console tile turns red after 30 s. Turn Wi-Fi on: within a few seconds everything is blue.
  7. **`kill -9` the cell.** Run `kill -9 $(lsof -ti tcp:7080 -sTCP:LISTEN)`, then answer 3 more. They go ✓ → ✓✓ (the relay) but not blue, and the console shows `cell` lagging. Restart the cell (`DEV=1 MODE=cell bun apps/server/src/main.ts &`); the backlog turns blue. Run `curl -s localhost:7080/v1/heads` and check that the head equals the seat's local count.
  8. **Resume.** Force-quit the app (`kill -9` its PID) and relaunch. The same answers, palette and ticks are back, and the timer continues where it left off, never resetting to 30:00.
  9. **Face chip.** It shows `Faces: 1`; covering the camera gives `Faces: 0`, with an amber border.

- [ ] **Step 4: Update memory and ask for approval.**
  - Record in `saakshi-hackathon-plan.md` that Stage 1 is done. Include the kill-test PASS line, the CI run links, the ack-signing choice and any deviations.
  - Send the user the screenshots and the kill-test transcript.
  - Ask for approval to start Stage 2.
