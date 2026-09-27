# Stage 0 — Foundations and Risk Spikes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove feasibility. That means a packaged macOS seat app that counts faces live, a Windows CI artifact with probe JSON, and protocol v1 frozen with golden vectors and a CLI tamper lab.

**Architecture:** This is a pnpm 11 monorepo.
- `packages/core` is the protocol v1 library. It is universal TypeScript on noble, except `node.ts`, which holds native ECDSA and ECDH (`node:crypto`).
- `apps/seat` is an Electron spike (electron-vite + electron-builder). It serves the renderer over `app://` with a CSP, runs MediaPipe on the CPU, checks safeStorage, and has a `--probe-selftest` mode.
- `analytics/` is a uv project that validates the frozen cohort schema.
- A Windows-only GitHub Actions job runs the tests and the packaged probe self-test.

**Tech Stack:**
- TypeScript, run natively by Node 25 (type stripping) and Bun 1.3.
- `node:test`, which runs under both runtimes.
- `@noble/{hashes,curves,ciphers}` v2 and `shamir-secret-sharing`.
- Electron, electron-vite, electron-builder, React and `@mediapipe/tasks-vision`.
- koffi.
- Python 3.14 via uv, with pytest.
- GitHub Actions.

**Spec:** `docs/plan.md`: §2 (stack table), §3 (protocol v1), §3.4 and §3.5 (probes, hardening, face presence), §4 (repo layout) and §5 "Stage 0".

## Global Constraints

- pnpm 11 settings live in `pnpm-workspace.yaml`: `nodeLinker: hoisted` plus an `allowBuilds:` map (key verified on pnpm 11.5.2). `"packageManager": "pnpm@11.5.2"`.
- Licence: Apache-2.0.
- Canonical encoding: a type-tagged JSON array. Allowed values are strings, safe integers and nested arrays only; no objects, floats, −0, null or booleans.
- Domain bytes: `0x00` leaf, `0x01` node, `0x02` entry, `0x03` genesis, `0x04` body, `0x05` receipt, `0x06` final, `0x07` key commitment.
- Signatures: `ECDSA-P256-SHA256` over `domain ‖ UTF-8(canon)`, IEEE-P1363 (64 bytes). Signers normalise to low-S.
  - Native verify: `crypto.verify('sha256', m, {key, dsaEncoding:'ieee-p1363'}, sig)`.
  - noble verify: `p256.verify(sig, m, pub, {prehash:true, lowS:false})`.
  - Golden vectors assert cross-verification, never byte-identical signatures.
- noble v2 imports need the `.js` suffix: `@noble/curves/nist.js`, `@noble/hashes/{sha2,hkdf,utils}.js`, `@noble/ciphers/chacha.js`.
  - HKDF `info` must be a `Uint8Array`.
  - noble v2 has **no** `normalizeS`; low-S is done by hand.
- Hashes inside protocol arrays are lowercase hex. Public keys are 65-byte uncompressed P-256; private keys are 32 bytes. `seq` starts at 1, and the first `prev` is `genesisPrev(ctx)`.
- Probes: absolute paths, a 5 s timeout, and `unknown` on failure; never blocking.
- Electron: `contextIsolation`, `sandbox`, no nodeIntegration. CSP `script-src 'self' 'wasm-unsafe-eval'`. Register `app://` as privileged (standard, secure, supportFetchAPI) before `ready`.
- Release-build fuses: RunAsNode off, NodeOptions off, inspect args off, embedded ASAR integrity on, OnlyLoadAppFromAsar on.
- macOS signing: electron-builder `mac.identity: null` and `hardenedRuntime: false`, then `codesign --force --deep --sign -`. This avoids the camera regression in electron-builder ≥ 26.0.13's own ad-hoc path.
- Core modules are imported by path (`@saakshi/core/<name>`). **There is no barrel file**, so parallel tasks never edit the same file. Imports between TS sources use an explicit `.ts` extension.
- All npm dependencies are added in Task 1. **Later tasks must not run `pnpm add`.** If one is needed, stop and report.

## Review Focus

1. **A byte flip on a newline or line boundary** must still be located at the exact entry that contains the byte. Pinned by the 1,000-flip test (Task 6).
2. **Devanagari inside hashed structures** must give identical bytes across Node, Bun and the Python reference. Pinned by the `bodyCommitHi` known answer (Task 2).
3. **The native signer emits high-S about 50% of the time.** Every `signer()` output must be low-S and verify under both verifiers. Pinned in Task 3.
4. **An offline code dictated over the phone.** Lowercase, dashes and O/0 or I/L must be accepted; a one-symbol typo must be rejected. Pinned in Task 5.
5. **`app://` traversal** (`/../`, `%2e%2e`, a bad `%`) must return 404. **A hanging probe** must return `unknown` after its timeout. Pinned in Tasks 9 and 11.

## Parallelism map

```
T1 ─┬─► T2 ─┬─► T3 ─┬─► T6 ─┐
    │       ├─► T4  │       ├─► T8 ─┐
    │       └─► T5 ─┘       │       ├─► T12 ─► T13
    ├─► T7 (after T2) ──────┘       │
    └─► T9 ─► T10 ─► T11 ───────────┘
```
- Agents share one working tree, work on disjoint paths and **do not commit**. The controller reviews and commits each task.
- The seat chain (T9–T11) runs in parallel with the core chain.

---

### Task 1: Monorepo scaffold, dependencies, first commit

**Files:**
- Create: `.gitignore`, `LICENSE`, `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`
- Create: `packages/core/{package.json,tsconfig.json}`
- Create: `apps/seat/package.json`

**Interfaces:**
- Produces:
  - `pnpm -r test`.
  - `@saakshi/core/<name>` → `packages/core/src/<name>.ts`.
  - All Stage 0 npm dependencies, installed and locked.

- [ ] **Step 1: Write the files**

`.gitignore`:
```gitignore
node_modules/
out/
release/
dist/
.venv/
__pycache__/
*.log
.DS_Store
.claude/
apps/seat/src/renderer/public/mediapipe/wasm/
```

`package.json`:
```json
{
  "name": "saakshi",
  "private": true,
  "license": "Apache-2.0",
  "packageManager": "pnpm@11.5.2",
  "engines": { "node": ">=25" },
  "scripts": { "test": "pnpm -r test", "typecheck": "pnpm -r typecheck", "tamper-lab": "node tools/tamper-lab.ts" }
}
```

`pnpm-workspace.yaml`:
```yaml
packages:
  - apps/*
  - packages/*
nodeLinker: hoisted
allowBuilds:
  electron: true
  esbuild: true
  koffi: true
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2023", "lib": ["ES2023"], "module": "NodeNext", "moduleResolution": "NodeNext",
    "strict": true, "noEmit": true, "allowImportingTsExtensions": true, "erasableSyntaxOnly": true,
    "verbatimModuleSyntax": true, "skipLibCheck": true, "types": ["node"]
  }
}
```

`packages/core/package.json`:
```json
{
  "name": "@saakshi/core", "version": "0.0.1", "private": true, "type": "module", "license": "Apache-2.0",
  "exports": { "./*": "./src/*.ts" },
  "scripts": { "test": "node --test \"test/**/*.test.ts\" && bun test ./test", "typecheck": "tsc -p tsconfig.json" }
}
```

`packages/core/tsconfig.json`: `{ "extends": "../../tsconfig.base.json", "include": ["src", "test"] }`

`apps/seat/package.json`:
```json
{ "name": "@saakshi/seat", "version": "0.0.1", "private": true, "description": "Saakshi exam seat", "license": "Apache-2.0", "main": "./out/main/index.js" }
```

- [ ] **Step 2: Install**

```bash
pnpm add -Dw typescript @types/node
pnpm --filter @saakshi/core add @noble/curves @noble/hashes @noble/ciphers shamir-secret-sharing
pnpm --filter @saakshi/seat add koffi
pnpm --filter @saakshi/seat add -D electron electron-vite electron-builder vite @vitejs/plugin-react react react-dom @types/react @types/react-dom @mediapipe/tasks-vision
```
Expected: no "ignored build scripts" warning for electron, esbuild or koffi. If another Electron-path package is listed, add it to `allowBuilds`. If the sandbox blocks the Electron download, re-run outside it.

- [ ] **Step 3: Licence and install checks**

```bash
cp node_modules/typescript/LICENSE.txt LICENSE && head -3 LICENSE
pnpm --filter @saakshi/seat exec electron --version
node -e "import('@noble/curves/nist.js').then(m => console.log(typeof m.p256.verify))"
```
Expected: `Apache License`, `v3x.y.z` and `function`.

- [ ] **Step 4: Commit**

```bash
git add .gitignore LICENSE package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json packages/core apps/seat/package.json docs
git commit -m "chore: scaffold pnpm monorepo, add plan and research docs"
```

---

### Task 2: Core base — bytes, canonical encoding, protocol structures

**Files:**
- Create: `packages/core/src/{bytes,canon,protocol}.ts`
- Test: `packages/core/test/{canon,protocol}.test.ts`

**Interfaces:**
- Produces:
  - `bytes.ts`: `toHex`, `hexToBytes`, `concat`, `utf8`, `randomBytes`, `equal(a,b)`, `crockford80(b): string` (17 symbols), `decodeCrockford80(code): Uint8Array` (10 bytes; throws on a bad check symbol).
  - `canon.ts`: `type Canon = string | number | Canon[]`, `canon(v: Canon[]): string`, `parseCanon(text): Canon[]`.
  - `protocol.ts`:
    - `V`, `D`, `tagged(domain, v)`, `hashTagged(domain, v)`.
    - `KINDS`/`Kind`, `STATES`/`State`.
    - `Ctx {exam, shift, attempt, cand}`, `Header`, `Body {item, state: State|'', answer, meta: Canon[]}`, `Response = [string, State, string]`.
    - `headerArray`, `headerFromArray`, `entryHash`, `genesisPrev`, `bodyArray`, `bodyFromArray`, `bodyCommit(salt, body): string`.
    - `finalHash(ctx, form, responses): string`, `counts(responses)`, `ReceiptIn`, `receiptArray`, `receiptCode`, `leafArray`, `kcf(K): string`.

- [ ] **Step 1: Write the failing tests**

`packages/core/test/canon.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canon, parseCanon, type Canon } from '../src/canon.ts';

test('canon emits compact JSON for tagged arrays', () => {
  assert.equal(canon(['x', 1, 'a', [2, ['b']]]), '["x",1,"a",[2,["b"]]]');
  assert.equal(canon(['x', 'हिन्दी']), '["x","हिन्दी"]');
});

test('canon rejects everything outside the allowed value set', () => {
  const bad: unknown[] = [['x', 1.5], ['x', -0], ['x', 2 ** 53], ['x', null], ['x', true], ['x', {}], [1, 'x'], [], 'x'];
  for (const v of bad) assert.throws(() => canon(v as Canon[]), /canon/, JSON.stringify(v));
  // eslint-disable-next-line no-sparse-arrays
  assert.throws(() => canon(['x', , 1] as Canon[]), /sparse/);
});

test('parseCanon accepts only the exact canonical text', () => {
  assert.deepEqual(parseCanon('["x",1,["y"]]'), ['x', 1, ['y']]);
  for (const t of ['["x", 1]', '["x",1.0]', '["x",-0]', '["x",1e2]', '{"a":1}', '["x",null]'])
    assert.throws(() => parseCanon(t), t);
});
```

`packages/core/test/protocol.test.ts` (the expected values come from an independent Python implementation):
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crockford80, decodeCrockford80, hexToBytes, toHex } from '../src/bytes.ts';
import { bodyCommit, counts, entryHash, finalHash, genesisPrev, headerArray, headerFromArray, kcf, receiptCode, type Header, type Response } from '../src/protocol.ts';

const ctx = { exam: 'DEMO-2026', shift: 'S1', attempt: 1, cand: 'C0001' };
const salt = Uint8Array.from({ length: 16 }, (_, i) => i);

test('known-answer hashes match the Python reference', () => {
  const gen = genesisPrev(ctx);
  assert.equal(gen, '5d69bc2c61786a76aca971f7b9dce3b2d12f9e592b92cc102720078d6564fd8a');
  const bc = bodyCommit(salt, { item: 'I17', state: 'A', answer: 'B', meta: [4200, []] });
  assert.equal(bc, 'b4997b8f90d9bd710864ddc02d92c38dda34fa89f51f5cc98bfeb61174539751');
  assert.equal(bodyCommit(salt, { item: 'I17', state: 'A', answer: 'B', meta: [4200, ['हिन्दी']] }),
    '569ca0a8b89f49a2bb9114f5a1b01af2ce890d59cc7677990b83ea7f7d0315d4');
  const h: Header = { ...ctx, keyEpoch: 1, seq: 1, prev: gen, kind: 'answer', tMonoMs: 61000, activeMs: 60500, bodyCommit: bc };
  const eh = toHex(entryHash(h));
  assert.equal(eh, 'f5f6406a4576292cf2ece742bb5898f0de9ff0b9279c660e2de3a558e9683afa');
  const resp: Response[] = [['I17', 'AMR', 'B'], ['I03', 'A', 'C'], ['I05', 'MR', '']];
  const fh = finalHash(ctx, 'F1', resp);
  assert.equal(fh, '57c9e6df0d30bdcdef888cd1ae4e0212692ca58d6d7000bfd9eba519af561752');
  assert.deepEqual(counts(resp), { attempted: 3, answered: 2, marked: 2 });
  const code = receiptCode({ exam: 'DEMO-2026', shift: 'S1', attempt: 1, pseud: '7'.repeat(64), seq: 1, h: eh, finalHash: fh, attempted: 3, answered: 2, marked: 2 });
  assert.equal(code, '8Q6GQ5AZGKYFPVZKR');
  assert.equal(kcf(new Uint8Array(32).fill(0x11)), '6065a397d8b6299bbacba68453af1f9920929f4f02b067fd04f86d7ad43f0ba5');
});

test('crockford80 encodes 80 bits plus a mod-37 check symbol', () => {
  const b = Uint8Array.from({ length: 10 }, (_, i) => i);
  assert.equal(crockford80(b), '000G40R40M30E209Y');
  assert.deepEqual(decodeCrockford80('000g-40r4-0m30-e209-y'), b);
  assert.deepEqual(decodeCrockford80('OOOG40R4OM3OE2O9Y'), b);
  assert.throws(() => decodeCrockford80('000G40R40M30E209Z'), /check/);
  assert.throws(() => decodeCrockford80('000G40R40M30E209'), /17/);
});

test('headerFromArray round-trips and rejects malformed headers', () => {
  const h: Header = { ...ctx, keyEpoch: 1, seq: 3, prev: 'a'.repeat(64), kind: 'mark', tMonoMs: 5, activeMs: 4, bodyCommit: 'b'.repeat(64) };
  assert.deepEqual(headerFromArray(headerArray(h)), h);
  const a = headerArray(h);
  assert.throws(() => headerFromArray([...a.slice(0, 9), 'teleport', ...a.slice(10)]), /kind/);
  assert.throws(() => headerFromArray([...a.slice(0, 8), 'A'.repeat(64), ...a.slice(9)]), /hash/);
  assert.throws(() => headerFromArray(a.slice(0, 12)), /length/);
});

test('finalHash rejects duplicate items; bodyCommit rejects short salts', () => {
  assert.throws(() => finalHash(ctx, 'F1', [['I01', 'A', 'B'], ['I01', 'A', 'C']]), /duplicate/);
  assert.throws(() => bodyCommit(new Uint8Array(8), { item: '', state: '', answer: '', meta: [] }), /16/);
  assert.equal(toHex(hexToBytes('00ff')), '00ff');
});
```

- [ ] **Step 2: Run the tests and confirm they fail.** Run `cd packages/core && node --test "test/**/*.test.ts"`. Expected: FAIL with `Cannot find module`.

- [ ] **Step 3: Implement**

`packages/core/src/bytes.ts`:
```ts
export { bytesToHex as toHex, hexToBytes, concatBytes as concat, utf8ToBytes as utf8, randomBytes } from '@noble/hashes/utils.js';

export const equal = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((x, i) => x === b[i]);

// Crockford base32 for 80-bit codes: 16 symbols + 1 check symbol (value mod 37).
const SYM = '0123456789ABCDEFGHJKMNPQRSTVWXYZ*~$=U';

export function crockford80(bytes: Uint8Array): string {
  if (bytes.length < 10) throw new Error('crockford80 needs at least 10 bytes');
  let n = 0n;
  for (const b of bytes.subarray(0, 10)) n = (n << 8n) | BigInt(b);
  let s = '';
  for (let i = 15; i >= 0; i--) s += SYM[Number((n >> BigInt(5 * i)) & 31n)];
  return s + SYM[Number(n % 37n)];
}

export function decodeCrockford80(code: string): Uint8Array {
  const c = code.toUpperCase().replace(/-/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  if (c.length !== 17) throw new Error('code must be 17 symbols');
  let n = 0n;
  for (const ch of c.slice(0, 16)) {
    const v = SYM.indexOf(ch);
    if (v < 0 || v > 31) throw new Error(`bad symbol ${ch}`);
    n = (n << 5n) | BigInt(v);
  }
  if (SYM[Number(n % 37n)] !== c[16]) throw new Error('check symbol mismatch');
  const out = new Uint8Array(10);
  for (let i = 9; i >= 0; i--) { out[i] = Number(n & 255n); n >>= 8n; }
  return out;
}
```

`packages/core/src/canon.ts`:
```ts
export type Canon = string | number | Canon[];

function check(v: unknown): void {
  if (typeof v === 'string') return;
  if (typeof v === 'number') {
    if (!Number.isSafeInteger(v) || Object.is(v, -0)) throw new Error(`canon: not a safe integer: ${v}`);
    return;
  }
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) {
      if (!(i in v)) throw new Error('canon: sparse array');
      check(v[i]);
    }
    return;
  }
  throw new Error(`canon: disallowed type ${v === null ? 'null' : typeof v}`);
}

/** Canonical encoding: a type-tagged array of strings, safe integers and nested arrays, as compact JSON. */
export function canon(v: Canon[]): string {
  if (!Array.isArray(v) || typeof v[0] !== 'string') throw new Error('canon: top level must be a type-tagged array');
  check(v);
  return JSON.stringify(v);
}

/** Parse, and require the text to be exactly the canonical encoding of what it parses to. */
export function parseCanon(text: string): Canon[] {
  const v = JSON.parse(text) as Canon[];
  if (canon(v) !== text) throw new Error('canon: not canonical');
  return v;
}
```

`packages/core/src/protocol.ts`:
```ts
import { sha256 } from '@noble/hashes/sha2.js';
import { canon, type Canon } from './canon.ts';
import { concat, crockford80, toHex, utf8 } from './bytes.ts';

export const V = 1;
export const D = { LEAF: 0x00, NODE: 0x01, ENTRY: 0x02, GENESIS: 0x03, BODY: 0x04, RECEIPT: 0x05, FINAL: 0x06, KEYCOMMIT: 0x07 } as const;

/** The exact bytes that get hashed and signed: domain byte ‖ UTF-8 canonical JSON. */
export const tagged = (domain: number, v: Canon[]): Uint8Array => concat(Uint8Array.of(domain), utf8(canon(v)));
export const hashTagged = (domain: number, v: Canon[]): Uint8Array => sha256(tagged(domain, v));

export const KINDS = ['unlock', 'answer', 'clear', 'mark', 'integrity', 'gap', 'handover', 'idle', 'submit'] as const;
export type Kind = (typeof KINDS)[number];
export const STATES = ['NV', 'NA', 'A', 'MR', 'AMR'] as const;
export type State = (typeof STATES)[number];

export interface Ctx { exam: string; shift: string; attempt: number; cand: string }
export interface Header extends Ctx { keyEpoch: number; seq: number; prev: string; kind: Kind; tMonoMs: number; activeMs: number; bodyCommit: string }
/** item/state/answer are '' for entries that are not about an item (unlock, integrity, gap, submit…). */
export interface Body { item: string; state: State | ''; answer: string; meta: Canon[] }
export type Response = [item: string, state: State, answer: string];

const isStr = (x: unknown): x is string => typeof x === 'string';
const isNat = (x: unknown): x is number => typeof x === 'number' && Number.isSafeInteger(x) && x >= 0;
const HEX32 = /^[0-9a-f]{64}$/;

export const headerArray = (h: Header): Canon[] =>
  ['entry', V, h.exam, h.shift, h.attempt, h.cand, h.keyEpoch, h.seq, h.prev, h.kind, h.tMonoMs, h.activeMs, h.bodyCommit];

export function headerFromArray(a: Canon[]): Header {
  if (a.length !== 13 || a[0] !== 'entry' || a[1] !== V) throw new Error('header: bad tag, version or length');
  const [, , exam, shift, attempt, cand, keyEpoch, seq, prev, kind, tMonoMs, activeMs, bodyCommit] = a;
  if (!isStr(exam) || !isStr(shift) || !isNat(attempt) || !isStr(cand) || !isNat(keyEpoch) || !isNat(seq) || !isNat(tMonoMs) || !isNat(activeMs))
    throw new Error('header: bad field type');
  if (!isStr(prev) || !HEX32.test(prev) || !isStr(bodyCommit) || !HEX32.test(bodyCommit)) throw new Error('header: bad hash');
  if (!isStr(kind) || !(KINDS as readonly string[]).includes(kind)) throw new Error('header: bad kind');
  return { exam, shift, attempt, cand, keyEpoch, seq, prev, kind: kind as Kind, tMonoMs, activeMs, bodyCommit };
}

export const entryHash = (h: Header): Uint8Array => hashTagged(D.ENTRY, headerArray(h));
export const genesisPrev = (c: Ctx): string => toHex(hashTagged(D.GENESIS, ['saakshi-genesis', V, c.exam, c.shift, c.attempt, c.cand]));

export const bodyArray = (b: Body): Canon[] => ['body', b.item, b.state, b.answer, b.meta];

export function bodyFromArray(a: Canon[]): Body {
  const [tag, item, state, answer, meta] = a;
  if (a.length !== 5 || tag !== 'body' || !isStr(item) || !isStr(state) || !isStr(answer) || !Array.isArray(meta)) throw new Error('body: bad shape');
  if (state !== '' && !(STATES as readonly string[]).includes(state)) throw new Error('body: bad state');
  return { item, state: state as State | '', answer, meta };
}

export function bodyCommit(salt: Uint8Array, b: Body): string {
  if (salt.length !== 16) throw new Error('salt must be 16 bytes');
  return toHex(sha256(concat(Uint8Array.of(D.BODY), salt, utf8(canon(bodyArray(b))))));
}

export function finalHash(c: Ctx, form: string, responses: Response[]): string {
  const sorted = [...responses].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  for (let i = 1; i < sorted.length; i++) if (sorted[i][0] === sorted[i - 1][0]) throw new Error(`duplicate item ${sorted[i][0]}`);
  return toHex(hashTagged(D.FINAL, ['final', c.exam, c.shift, c.attempt, c.cand, form, sorted]));
}

/** attempted = visited (not NV); answered = A or AMR (NTA evaluates both); marked = MR or AMR. */
export function counts(responses: Response[]): { attempted: number; answered: number; marked: number } {
  let attempted = 0, answered = 0, marked = 0;
  for (const [, s] of responses) {
    if (s !== 'NV') attempted++;
    if (s === 'A' || s === 'AMR') answered++;
    if (s === 'MR' || s === 'AMR') marked++;
  }
  return { attempted, answered, marked };
}

export interface ReceiptIn { exam: string; shift: string; attempt: number; pseud: string; seq: number; h: string; finalHash: string; attempted: number; answered: number; marked: number }
export const receiptArray = (r: ReceiptIn): Canon[] => ['receipt', r.exam, r.shift, r.attempt, r.pseud, r.seq, r.h, r.finalHash, r.attempted, r.answered, r.marked];
export const receiptCode = (r: ReceiptIn): string => crockford80(hashTagged(D.RECEIPT, receiptArray(r)));

export const leafArray = (x: { exam: string; shift: string; attempt: number; pseud: string; h: string; finalHash: string }): Canon[] =>
  ['leaf', x.exam, x.shift, x.attempt, x.pseud, x.h, x.finalHash];

export const kcf = (K: Uint8Array): string => toHex(sha256(concat(Uint8Array.of(D.KEYCOMMIT), K)));
```

- [ ] **Step 4: Run the tests and confirm they pass.** Run `cd packages/core && node --test "test/**/*.test.ts" && bun test ./test && npx tsc -p tsconfig.json`. Expected: PASS on both runtimes, and tsc is clean.

- [ ] **Step 5: Hand back for review and commit** with the message `feat(core): canonical encoding, domain hashes, receipt code`.

---

### Task 3: Signatures (native + noble) and sealed bodies

**Files:**
- Create: `packages/core/src/sig.ts` (universal), `packages/core/src/node.ts` (Node, Bun and Electron main)
- Test: `packages/core/test/{sig,body}.test.ts`

**Interfaces:**
- Consumes: Task 2.
- Produces:
  - `sig.ts`: `P256_N`, `type Verify = (m, sig) => boolean`, `toLowS(sig)`, `isLowS(sig)`, `nobleVerifier(pub): Verify`.
  - `node.ts`:
    - `KeyPair {priv(32), pub(65)}`, `newKeyPair()`, `signer(k): (m) => sig`, `verifier(pub): Verify`, `ecdh(priv, peerPub): Uint8Array`.
    - `BodyCtx extends Ctx {seq}`.
    - `sealBody(cellPub, c, salt, body): {envelope, bodyCommit}` and `openBody(cellPriv, c, envelope, expectCommit): {salt, body}`.

- [ ] **Step 1: Write the failing tests**

`packages/core/test/sig.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { p256 } from '@noble/curves/nist.js';
import { hexToBytes, randomBytes, toHex } from '../src/bytes.ts';
import { P256_N, isLowS, nobleVerifier, toLowS } from '../src/sig.ts';
import { newKeyPair, signer, verifier } from '../src/node.ts';

test('1,000 native signatures are low-S and verify under noble and native', () => {
  let k = newKeyPair(), sign = signer(k), nob = nobleVerifier(k.pub), nat = verifier(k.pub);
  for (let i = 0; i < 1000; i++) {
    if (i % 100 === 0) { k = newKeyPair(); sign = signer(k); nob = nobleVerifier(k.pub); nat = verifier(k.pub); }
    const m = randomBytes(120), s = sign(m);
    assert.equal(s.length, 64);
    assert.ok(isLowS(s), `high-S at ${i}`);
    assert.ok(nob(m, s), `noble rejected ${i}`);
    assert.ok(nat(m, s), `native rejected ${i}`);
  }
});

test('noble-signed messages verify natively', () => {
  const sk = p256.utils.randomSecretKey(), pub = p256.getPublicKey(sk, false), m = randomBytes(64);
  assert.ok(verifier(pub)(m, p256.sign(m, sk, { prehash: true })));
});

test('toLowS maps a high-S signature back to its low-S twin', () => {
  const k = newKeyPair(), m = randomBytes(32), low = signer(k)(m);
  const s = BigInt('0x' + toHex(low.subarray(32)));
  const high = low.slice(); high.set(hexToBytes((P256_N - s).toString(16).padStart(64, '0')), 32);
  assert.ok(!isLowS(high));
  assert.ok(nobleVerifier(k.pub)(m, high), 'spec verifies with lowS:false');
  assert.deepEqual(toLowS(high), low);
});

test('tampering is rejected and bad inputs never throw from verify', () => {
  const k = newKeyPair(), m = randomBytes(32), s = signer(k)(m);
  const s2 = s.slice(); s2[10] ^= 1;
  const m2 = m.slice(); m2[0] ^= 1;
  for (const v of [verifier(k.pub), nobleVerifier(k.pub)]) {
    assert.equal(v(m, s2), false);
    assert.equal(v(m2, s), false);
    assert.equal(v(m, s.subarray(0, 63)), false);
  }
  assert.throws(() => verifier(k.pub.subarray(1)), /65-byte/);
});
```

`packages/core/test/body.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, toHex, utf8 } from '../src/bytes.ts';
import { newKeyPair, openBody, sealBody } from '../src/node.ts';
import type { Body } from '../src/protocol.ts';

const cell = newKeyPair();
const c = { exam: 'DEMO-2026', shift: 'S1', attempt: 1, cand: 'C0001', seq: 7 };
const body: Body = { item: 'I17', state: 'A', answer: 'B', meta: [4200, ['हिन्दी']] };

test('seal/open round-trips and binds the commit', () => {
  const salt = randomBytes(16);
  const { envelope, bodyCommit } = sealBody(cell.pub, c, salt, body);
  const out = openBody(cell.priv, c, envelope, bodyCommit);
  assert.deepEqual(out.body, body);
  assert.deepEqual(out.salt, salt);
  const again = sealBody(cell.pub, c, salt, body);
  assert.equal(again.bodyCommit, bodyCommit);
  assert.notDeepEqual(again.envelope, envelope, 'fresh ephemeral key and nonce each time');
});

test('the envelope does not leak the answer to the relay', () => {
  const { envelope } = sealBody(cell.pub, c, randomBytes(16), body);
  assert.ok(!toHex(envelope).includes(toHex(utf8('"I17","A","B"'))));
});

test('wrong key, wrong context, flipped byte, wrong commit, short envelope all throw', () => {
  const { envelope, bodyCommit } = sealBody(cell.pub, c, randomBytes(16), body);
  assert.throws(() => openBody(newKeyPair().priv, c, envelope, bodyCommit));
  assert.throws(() => openBody(cell.priv, { ...c, seq: 8 }, envelope, bodyCommit));
  const bad = envelope.slice(); bad[100] ^= 1;
  assert.throws(() => openBody(cell.priv, c, bad, bodyCommit));
  assert.throws(() => openBody(cell.priv, c, envelope, '0'.repeat(64)), /bodyCommit/);
  assert.throws(() => openBody(cell.priv, c, envelope.subarray(0, 50), bodyCommit), /short/);
});
```

- [ ] **Step 2: Run the tests and confirm they fail.** Run `cd packages/core && node --test test/sig.test.ts test/body.test.ts`. Expected: FAIL with `Cannot find module`.

- [ ] **Step 3: Implement**

`packages/core/src/sig.ts`:
```ts
import { p256 } from '@noble/curves/nist.js';
import { hexToBytes, toHex } from './bytes.ts';

export const P256_N = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;
export type Verify = (m: Uint8Array, sig: Uint8Array) => boolean;

const sOf = (sig: Uint8Array): bigint => BigInt('0x' + toHex(sig.subarray(32)));
export const isLowS = (sig: Uint8Array): boolean => sOf(sig) <= P256_N / 2n;

/** Normalise an IEEE-P1363 signature to low-S (noble v2 has no normalizeS). */
export function toLowS(sig: Uint8Array): Uint8Array {
  if (sig.length !== 64) throw new Error('sig must be 64 bytes (IEEE-P1363)');
  if (isLowS(sig)) return sig;
  const out = sig.slice();
  out.set(hexToBytes((P256_N - sOf(sig)).toString(16).padStart(64, '0')), 32);
  return out;
}

/** Browser-safe verifier; m is domain ‖ canonical JSON, hashed with SHA-256 inside. */
export function nobleVerifier(pub: Uint8Array): Verify {
  return (m, sig) => {
    try { return sig.length === 64 && p256.verify(sig, m, pub, { prehash: true, lowS: false }); } catch { return false; }
  };
}
```

`packages/core/src/node.ts`:
```ts
import crypto from 'node:crypto';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { concat, randomBytes, utf8 } from './bytes.ts';
import { canon, parseCanon } from './canon.ts';
import { V, bodyArray, bodyCommit, bodyFromArray, type Body, type Ctx } from './protocol.ts';
import { toLowS, type Verify } from './sig.ts';

export interface KeyPair { priv: Uint8Array; pub: Uint8Array }

const b64u = (b: Uint8Array): string => Buffer.from(b).toString('base64url');
const xy = (pub: Uint8Array) => {
  if (pub.length !== 65 || pub[0] !== 4) throw new Error('pub must be a 65-byte uncompressed P-256 point');
  return { kty: 'EC', crv: 'P-256', x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33)) };
};

export function newKeyPair(): KeyPair {
  const e = crypto.createECDH('prime256v1');
  e.generateKeys();
  const priv = new Uint8Array(32);
  const p = e.getPrivateKey();
  priv.set(p, 32 - p.length); // left-pad: Node drops leading zero bytes
  return { priv, pub: new Uint8Array(e.getPublicKey()) };
}

export function signer(k: KeyPair): (m: Uint8Array) => Uint8Array {
  const key = crypto.createPrivateKey({ key: { ...xy(k.pub), d: b64u(k.priv) }, format: 'jwk' });
  return (m) => toLowS(new Uint8Array(crypto.sign('sha256', m, { key, dsaEncoding: 'ieee-p1363' })));
}

export function verifier(pub: Uint8Array): Verify {
  const key = crypto.createPublicKey({ key: xy(pub), format: 'jwk' });
  return (m, sig) => {
    if (sig.length !== 64) return false;
    try { return crypto.verify('sha256', m, { key, dsaEncoding: 'ieee-p1363' }, sig); } catch { return false; }
  };
}

export function ecdh(priv: Uint8Array, peerPub: Uint8Array): Uint8Array {
  const e = crypto.createECDH('prime256v1');
  e.setPrivateKey(priv);
  return new Uint8Array(e.computeSecret(peerPub));
}

export interface BodyCtx extends Ctx { seq: number }

const bodyKey = (shared: Uint8Array, c: BodyCtx): Uint8Array =>
  hkdf(sha256, shared, undefined, utf8(canon(['saakshi-body', V, c.exam, c.shift, c.attempt, c.cand, c.seq])), 32);

/** Envelope = ephPub(65) ‖ nonce(24) ‖ XChaCha20-Poly1305(salt(16) ‖ canon(body)). Only the cell can open it; the relay cannot. */
export function sealBody(cellPub: Uint8Array, c: BodyCtx, salt: Uint8Array, body: Body): { envelope: Uint8Array; bodyCommit: string } {
  const commit = bodyCommit(salt, body);
  const eph = newKeyPair();
  const nonce = randomBytes(24);
  const ct = xchacha20poly1305(bodyKey(ecdh(eph.priv, cellPub), c), nonce).encrypt(concat(salt, utf8(canon(bodyArray(body)))));
  return { envelope: concat(eph.pub, nonce, ct), bodyCommit: commit };
}

export function openBody(cellPriv: Uint8Array, c: BodyCtx, envelope: Uint8Array, expectCommit: string): { salt: Uint8Array; body: Body } {
  if (envelope.length < 65 + 24 + 16 + 16) throw new Error('envelope too short');
  const key = bodyKey(ecdh(cellPriv, envelope.subarray(0, 65)), c);
  const pt = xchacha20poly1305(key, envelope.subarray(65, 89)).decrypt(envelope.subarray(89));
  const salt = pt.slice(0, 16);
  const body = bodyFromArray(parseCanon(new TextDecoder('utf-8', { fatal: true }).decode(pt.subarray(16))));
  if (bodyCommit(salt, body) !== expectCommit) throw new Error('bodyCommit mismatch');
  return { salt, body };
}
```

- [ ] **Step 4: Run the tests and confirm they pass.** Run `cd packages/core && node --test test/sig.test.ts test/body.test.ts && bun test ./test/sig.test.ts ./test/body.test.ts && npx tsc -p tsconfig.json`. Expected: PASS.

- [ ] **Step 5: Hand back for review and commit** with the message `feat(core): P-256 signatures cross-verified native/noble, sealed bodies`.

---

### Task 4: RFC 9162 Merkle tree with inclusion and consistency proofs

**Files:**
- Create: `packages/core/src/merkle.ts`
- Test: `packages/core/test/merkle.test.ts`

**Interfaces:**
- Consumes: `bytes.ts`, `canon.ts`, `protocol.ts` (`D`, `hashTagged`, `leafArray`).
- Produces: `leafHash(data)`, `rootOf(leafHashes)`, `inclusionProof(hs, index)`, `verifyInclusion(index, size, leaf, proof, root)`, `consistencyProof(hs, oldSize)`, `verifyConsistency(size1, size2, proof, root1, root2)`.

- [ ] **Step 1: Write the failing test**

`packages/core/test/merkle.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hexToBytes, toHex, utf8 } from '../src/bytes.ts';
import { canon } from '../src/canon.ts';
import { D, hashTagged, leafArray } from '../src/protocol.ts';
import { consistencyProof, inclusionProof, leafHash, rootOf, verifyConsistency, verifyInclusion } from '../src/merkle.ts';

// RFC 6962 / certificate-transparency test leaves and roots (re-derived independently in Python).
const LEAVES = ['', '00', '10', '2021', '3031', '40414243', '5051525354555657', '606162636465666768696a6b6c6d6e6f'].map(hexToBytes);
const ROOTS = [
  '6e340b9cffb37a989ca544e6bb780a2c78901d3fb33738768511a30617afa01d',
  'fac54203e7cc696cf0dfcb42c92a1d9dbaf70ad9e621f4bd8d98662f00e3c125',
  'aeb6bcfe274b70a14fb067a5e5578264db0fa9b51af5e0ba159158f329e06e77',
  'd37ee418976dd95753c1c73862b9398fa2a2cf9b4ff0fdfe8b30cd95209614b7',
  '4e3bbb1f7b478dcfe71fb631631519a3bca12c9aefca1612bfce4c13a86264d4',
  '76e67dadbcdf1e10e1b74ddc608abd2f98dfb16fbce75277b5232a127f2087ef',
  'ddb89be403809e325750d3d263cd78929c2942b7942a34b77e122c9594a74c8c',
  '5dc9da79a70659a9ad559cb701ded9a2ab9d823aad2f4960cfe370eff4604328',
];

test('roots match the RFC 6962 vectors', () => {
  assert.equal(toHex(rootOf([])), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  const hs = LEAVES.map(leafHash);
  ROOTS.forEach((r, i) => assert.equal(toHex(rootOf(hs.slice(0, i + 1))), r, `size ${i + 1}`));
});

const tree = (n: number) => Array.from({ length: n }, (_, i) => leafHash(utf8(`leaf-${i}`)));

test('every inclusion proof up to size 33 verifies; tampering fails', () => {
  for (let n = 1; n <= 33; n++) {
    const hs = tree(n), root = rootOf(hs);
    for (let m = 0; m < n; m++) {
      const p = inclusionProof(hs, m);
      assert.ok(verifyInclusion(m, n, hs[m], p, root), `n=${n} m=${m}`);
      assert.ok(!verifyInclusion(m, n, leafHash(utf8('x')), p, root));
      if (n > 1) assert.ok(!verifyInclusion((m + 1) % n, n, hs[m], p, root));
      if (p.length) assert.ok(!verifyInclusion(m, n, hs[m], p.slice(0, -1), root));
    }
    assert.ok(!verifyInclusion(n, n, hs[0], [], root));
  }
});

test('every consistency proof up to size 33 verifies; tampering fails', () => {
  for (let n = 1; n <= 33; n++) {
    const hs = tree(n), r2 = rootOf(hs);
    for (let m = 1; m <= n; m++) {
      const r1 = rootOf(hs.slice(0, m)), p = consistencyProof(hs, m);
      assert.ok(verifyConsistency(m, n, p, r1, r2), `m=${m} n=${n}`);
      if (m < n) {
        assert.ok(!verifyConsistency(m, n, [], r1, r2), 'empty proof');
        assert.ok(!verifyConsistency(m, n, p, leafHash(utf8('x')), r2), 'wrong old root');
        const bad = p.map((x) => x.slice()); bad[0][0] ^= 1;
        assert.ok(!verifyConsistency(m, n, bad, r1, r2), 'flipped proof');
      }
    }
  }
});

test('protocol leaves hash with domain 0x00 over the canonical leaf array', () => {
  const x = { exam: 'DEMO-2026', shift: 'S1', attempt: 1, pseud: '7'.repeat(64), h: 'a'.repeat(64), finalHash: 'b'.repeat(64) };
  assert.deepEqual(leafHash(utf8(canon(leafArray(x)))), hashTagged(D.LEAF, leafArray(x)));
});
```

- [ ] **Step 2: Run the test and confirm it fails.** Run `cd packages/core && node --test test/merkle.test.ts`. Expected: FAIL with `Cannot find module`.

- [ ] **Step 3: Implement** (RFC 9162 §2.1.1–2.1.4.2, verbatim algorithms)

`packages/core/src/merkle.ts`:
```ts
import { sha256 } from '@noble/hashes/sha2.js';
import { concat, equal } from './bytes.ts';

export const leafHash = (data: Uint8Array): Uint8Array => sha256(concat(Uint8Array.of(0x00), data));
const node = (l: Uint8Array, r: Uint8Array): Uint8Array => sha256(concat(Uint8Array.of(0x01), l, r));
const half = (x: number): number => Math.floor(x / 2);
const odd = (x: number): boolean => x % 2 === 1;
/** Largest power of two strictly less than n (n >= 2). */
const split = (n: number): number => { let k = 1; while (k * 2 < n) k *= 2; return k; };
const isPow2 = (x: number): boolean => { let p = 1; while (p < x) p *= 2; return p === x; };

// ponytail: proofs recompute subtree roots from all leaf hashes (O(n) per proof). Fine for one shift; cache subtree roots if STH issuance gets slow.
export function rootOf(hs: Uint8Array[]): Uint8Array {
  if (hs.length === 0) return sha256(new Uint8Array());
  if (hs.length === 1) return hs[0];
  const k = split(hs.length);
  return node(rootOf(hs.slice(0, k)), rootOf(hs.slice(k)));
}

export function inclusionProof(hs: Uint8Array[], m: number): Uint8Array[] {
  if (m < 0 || m >= hs.length) throw new RangeError('leaf index out of range');
  if (hs.length === 1) return [];
  const k = split(hs.length);
  return m < k
    ? [...inclusionProof(hs.slice(0, k), m), rootOf(hs.slice(k))]
    : [...inclusionProof(hs.slice(k), m - k), rootOf(hs.slice(0, k))];
}

export function verifyInclusion(index: number, size: number, leaf: Uint8Array, proof: Uint8Array[], root: Uint8Array): boolean {
  if (index >= size) return false;
  let fn = index, sn = size - 1, r = leaf;
  for (const p of proof) {
    if (sn === 0) return false;
    if (odd(fn) || fn === sn) {
      r = node(p, r);
      while (!odd(fn) && fn !== 0) { fn = half(fn); sn = half(sn); }
    } else {
      r = node(r, p);
    }
    fn = half(fn); sn = half(sn);
  }
  return sn === 0 && equal(r, root);
}

export function consistencyProof(hs: Uint8Array[], m: number): Uint8Array[] {
  if (m < 1 || m > hs.length) throw new RangeError('old size out of range');
  return subproof(hs, m, true);
}

function subproof(hs: Uint8Array[], m: number, b: boolean): Uint8Array[] {
  const n = hs.length;
  if (m === n) return b ? [] : [rootOf(hs)];
  const k = split(n);
  return m <= k
    ? [...subproof(hs.slice(0, k), m, b), rootOf(hs.slice(k))]
    : [...subproof(hs.slice(k), m - k, false), rootOf(hs.slice(0, k))];
}

export function verifyConsistency(size1: number, size2: number, proof: Uint8Array[], root1: Uint8Array, root2: Uint8Array): boolean {
  if (size1 < 1 || size1 > size2) return false;
  if (size1 === size2) return proof.length === 0 && equal(root1, root2);
  if (proof.length === 0) return false;
  const path = isPow2(size1) ? [root1, ...proof] : proof;
  let fn = size1 - 1, sn = size2 - 1;
  while (odd(fn)) { fn = half(fn); sn = half(sn); }
  let fr = path[0], sr = path[0];
  for (const c of path.slice(1)) {
    if (sn === 0) return false;
    if (odd(fn) || fn === sn) {
      fr = node(c, fr); sr = node(c, sr);
      while (!odd(fn) && fn !== 0) { fn = half(fn); sn = half(sn); }
    } else {
      sr = node(sr, c);
    }
    fn = half(fn); sn = half(sn);
  }
  return sn === 0 && equal(fr, root1) && equal(sr, root2);
}
```

- [ ] **Step 4: Run the test and confirm it passes.** Run `cd packages/core && node --test test/merkle.test.ts && bun test ./test/merkle.test.ts && npx tsc -p tsconfig.json`. Expected: PASS.

- [ ] **Step 5: Hand back for review and commit** with the message `feat(core): RFC 9162 Merkle tree, inclusion and consistency proofs`.

---

### Task 5: Split custody — Shamir 2-of-3, offline wrap, key commitment

**Files:**
- Create: `packages/core/src/custody.ts`
- Test: `packages/core/test/custody.test.ts`

**Interfaces:**
- Consumes: `bytes.ts`, `canon.ts`, `protocol.ts` (`kcf`).
- Produces: `CentreCtx {exam, shift, centre}`, `Bundle {kF1, kF2, L}` (32 bytes each), `newOfflineCode()`, `wrapForCentre(code, c, kF1, kF2)`, `unwrapForCentre(code, c, wrap)`, `splitBundle(b): Promise<Uint8Array[]>`, `combineBundle(shares): Promise<Bundle>`.

- [ ] **Step 1: Write the failing test**

`packages/core/test/custody.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from '../src/bytes.ts';
import { kcf } from '../src/protocol.ts';
import { combineBundle, newOfflineCode, splitBundle, unwrapForCentre, wrapForCentre } from '../src/custody.ts';

const bundle = { kF1: randomBytes(32), kF2: randomBytes(32), L: randomBytes(32) };

test('any 2 of 3 custodian shares rebuild the bundle; 1 share does not', async () => {
  const s = await splitBundle(bundle);
  assert.equal(s.length, 3);
  for (const [a, b] of [[0, 1], [0, 2], [1, 2]]) assert.deepEqual(await combineBundle([s[a], s[b]]), bundle);
  await assert.rejects(combineBundle([s[0]]), /2 of 3/);
});

test('a corrupted share is caught by the published key commitment', async () => {
  const s = await splitBundle(bundle);
  const bad = s[1].slice(); bad[3] ^= 1;
  const got = await combineBundle([s[0], bad]);
  assert.notEqual(kcf(got.kF1), kcf(bundle.kF1));
});

test('offline code unwraps only its own centre and shift, and tolerates phone dictation', () => {
  const code = newOfflineCode();
  assert.match(code, /^[0-9A-Z*~$=]{17}$/);
  const c = { exam: 'DEMO-2026', shift: 'S1', centre: 'CEN042' };
  const w = wrapForCentre(code, c, bundle.kF1, bundle.kF2);
  const got = unwrapForCentre(code.toLowerCase().replace(/(.{4})/g, '$1-'), c, w);
  assert.equal(kcf(got.kF1), kcf(bundle.kF1));
  assert.equal(kcf(got.kF2), kcf(bundle.kF2));
  assert.throws(() => unwrapForCentre(code, { ...c, centre: 'CEN043' }, w));
  assert.throws(() => unwrapForCentre(code, { ...c, shift: 'S2' }, w));
  const typo = code.slice(0, 5) + (code[5] === '0' ? '1' : '0') + code.slice(6);
  assert.throws(() => unwrapForCentre(typo, c, w));
});
```

- [ ] **Step 2: Run the test and confirm it fails.** Run `cd packages/core && node --test test/custody.test.ts`. Expected: FAIL with `Cannot find module`.

- [ ] **Step 3: Implement**

`packages/core/src/custody.ts`:
```ts
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { combine, split } from 'shamir-secret-sharing';
import { concat, crockford80, decodeCrockford80, randomBytes, utf8 } from './bytes.ts';
import { canon } from './canon.ts';

export interface CentreCtx { exam: string; shift: string; centre: string }
export interface Bundle { kF1: Uint8Array; kF2: Uint8Array; L: Uint8Array }

const need32 = (...ks: Uint8Array[]) => { for (const k of ks) if (k.length !== 32) throw new Error('keys must be 32 bytes'); };

/** 80-bit per-centre, per-shift code: 16 Crockford symbols + check symbol. */
export const newOfflineCode = (): string => crockford80(randomBytes(10));

const wrapKey = (code: string, c: CentreCtx): Uint8Array =>
  hkdf(sha256, decodeCrockford80(code), undefined, utf8(canon(['saakshi-offline', c.exam, c.shift, c.centre])), 32);

/** W_c = nonce(24) ‖ XChaCha20-Poly1305(HKDF(code, info), kF1 ‖ kF2). */
export function wrapForCentre(code: string, c: CentreCtx, kF1: Uint8Array, kF2: Uint8Array): Uint8Array {
  need32(kF1, kF2);
  const nonce = randomBytes(24);
  return concat(nonce, xchacha20poly1305(wrapKey(code, c), nonce).encrypt(concat(kF1, kF2)));
}

export function unwrapForCentre(code: string, c: CentreCtx, wrap: Uint8Array): { kF1: Uint8Array; kF2: Uint8Array } {
  const pt = xchacha20poly1305(wrapKey(code, c), wrap.subarray(0, 24)).decrypt(wrap.subarray(24));
  return { kF1: pt.slice(0, 32), kF2: pt.slice(32, 64) };
}

/** Shamir 2-of-3 over kF1 ‖ kF2 ‖ L — one share each for NTA, NIC and the independent observer. */
export async function splitBundle(b: Bundle): Promise<Uint8Array[]> {
  need32(b.kF1, b.kF2, b.L);
  return split(concat(b.kF1, b.kF2, b.L), 3, 2);
}

export async function combineBundle(shares: Uint8Array[]): Promise<Bundle> {
  if (shares.length < 2) throw new Error('need 2 of 3 shares');
  const s = await combine(shares);
  if (s.length !== 96) throw new Error('bundle must be 96 bytes');
  return { kF1: s.slice(0, 32), kF2: s.slice(32, 64), L: s.slice(64) };
}
```

- [ ] **Step 4: Run the test and confirm it passes.** Run `cd packages/core && node --test test/custody.test.ts && bun test ./test/custody.test.ts && npx tsc -p tsconfig.json`. Expected: PASS.

- [ ] **Step 5: Hand back for review and commit** with the message `feat(core): split custody (Shamir 2-of-3), offline centre wrap, kc_f`.

---

### Task 6: Signed chain verifier and CLI tamper lab

**Files:**
- Create: `packages/core/src/journal.ts`, `tools/tamper-lab.ts`
- Test: `packages/core/test/journal.test.ts`

**Interfaces:**
- Consumes: `protocol.ts`, `sig.ts` (`Verify`), and `node.ts` (tests and CLI).
- Produces:
  - `EntryIn {kind, tMonoMs, activeMs, body, salt}`.
  - `buildChain(c, keyEpoch, entries, sign): {headers, lines}`.
  - `ChainFault = 'parse'|'shape'|'context'|'sig'|'seq'|'prev'`.
  - `ChainResult = {ok: true, head, count} | {ok: false, index, fault, detail}`.
  - `verifyChain(c, lines, verify): ChainResult`.
  - `demoEntries(n): EntryIn[]`.
  - The line format is `canon(["signed", headerArray, sigHex])`.

- [ ] **Step 1: Write the failing test**

`packages/core/test/journal.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toHex, utf8 } from '../src/bytes.ts';
import { entryHash } from '../src/protocol.ts';
import { nobleVerifier } from '../src/sig.ts';
import { newKeyPair, signer, verifier } from '../src/node.ts';
import { buildChain, demoEntries, verifyChain } from '../src/journal.ts';

const ctx = { exam: 'DEMO-2026', shift: 'S1', attempt: 1, cand: 'C0001' };
const key = newKeyPair();
const { headers, lines } = buildChain(ctx, 1, demoEntries(50), signer(key));
const verify = verifier(key.pub);
const rng = (seed: number) => () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = (r: ReturnType<typeof verifyChain>) => (r.ok ? ['ok'] : [r.index, r.fault]);

test('an honest chain verifies under native and noble; head = last entry hash', () => {
  for (const v of [verify, nobleVerifier(key.pub)])
    assert.deepEqual(verifyChain(ctx, lines, v), { ok: true, head: toHex(entryHash(headers[49])), count: 50 });
});

test('1,000 random byte flips are all detected at the exact entry', () => {
  const text = lines.join('\n') + '\n';
  const rand = rng(20260927);
  for (let i = 0; i < 1000; i++) {
    const bytes = utf8(text);
    const p = Math.floor(rand() * bytes.length);
    let expected = 0;
    for (let j = 0; j < p; j++) if (bytes[j] === 10) expected++; // a newline belongs to its own line
    bytes[p] ^= 1 + Math.floor(rand() * 255);
    const got = new TextDecoder().decode(bytes).split('\n');
    if (got.at(-1) === '') got.pop();
    const r = verifyChain(ctx, got, verify);
    assert.equal(r.ok, false, `flip ${i} at byte ${p} went undetected`);
    assert.equal(!r.ok && r.index, expected, `flip ${i} at byte ${p}: located ${!r.ok && r.index}, expected ${expected}`);
  }
});

test('deleted, swapped, foreign-signed and out-of-context entries are located', () => {
  const del = [...lines]; del.splice(10, 1);
  assert.deepEqual(pick(verifyChain(ctx, del, verify)), [10, 'seq']);
  const swp = [...lines]; [swp[20], swp[21]] = [swp[21], swp[20]];
  assert.deepEqual(pick(verifyChain(ctx, swp, verify)), [20, 'seq']);
  const mix = [...lines]; mix[30] = buildChain(ctx, 1, demoEntries(50), signer(newKeyPair())).lines[30];
  assert.deepEqual(pick(verifyChain(ctx, mix, verify)), [30, 'sig']);
  assert.deepEqual(pick(verifyChain({ ...ctx, cand: 'C0002' }, lines, verify)), [0, 'context']);
});

test('truncation verifies as a shorter chain, but its head no longer matches', () => {
  const full = verifyChain(ctx, lines, verify), cut = verifyChain(ctx, lines.slice(0, 40), verify);
  assert.ok(full.ok && cut.ok && cut.head !== full.head, 'Stage 2 catches truncation by comparing heads with the receipt and the leaf');
});
```

- [ ] **Step 2: Run the test and confirm it fails.** Run `cd packages/core && node --test test/journal.test.ts`. Expected: FAIL with `Cannot find module`.

- [ ] **Step 3: Implement**

`packages/core/src/journal.ts`:
```ts
import { hexToBytes, randomBytes, toHex } from './bytes.ts';
import { canon, parseCanon, type Canon } from './canon.ts';
import { D, bodyCommit, entryHash, genesisPrev, headerArray, headerFromArray, tagged, type Body, type Ctx, type Header, type Kind } from './protocol.ts';
import type { Verify } from './sig.ts';

export interface EntryIn { kind: Kind; tMonoMs: number; activeMs: number; body: Body; salt: Uint8Array }

export function buildChain(c: Ctx, keyEpoch: number, entries: EntryIn[], sign: (m: Uint8Array) => Uint8Array): { headers: Header[]; lines: string[] } {
  let prev = genesisPrev(c);
  const headers: Header[] = [], lines: string[] = [];
  entries.forEach((e, i) => {
    const h: Header = { ...c, keyEpoch, seq: i + 1, prev, kind: e.kind, tMonoMs: e.tMonoMs, activeMs: e.activeMs, bodyCommit: bodyCommit(e.salt, e.body) };
    lines.push(canon(['signed', headerArray(h), toHex(sign(tagged(D.ENTRY, headerArray(h))))]));
    headers.push(h);
    prev = toHex(entryHash(h));
  });
  return { headers, lines };
}

export type ChainFault = 'parse' | 'shape' | 'context' | 'sig' | 'seq' | 'prev';
export type ChainResult = { ok: true; head: string; count: number } | { ok: false; index: number; fault: ChainFault; detail: string };

const SIG_HEX = /^[0-9a-f]{128}$/;

/** Check order per spec: signature, then position (seq), then prev. Returns the first bad entry. */
export function verifyChain(c: Ctx, lines: string[], verify: Verify): ChainResult {
  let prev = genesisPrev(c);
  for (let i = 0; i < lines.length; i++) {
    const fail = (fault: ChainFault, detail: string): ChainResult => ({ ok: false, index: i, fault, detail });
    let a: Canon[];
    try { a = parseCanon(lines[i]); } catch (e) { return fail('parse', (e as Error).message); }
    const [tag, ha, sig] = a;
    if (a.length !== 3 || tag !== 'signed' || !Array.isArray(ha) || typeof sig !== 'string' || !SIG_HEX.test(sig)) return fail('shape', 'not ["signed",header,sigHex]');
    let h: Header;
    try { h = headerFromArray(ha); } catch (e) { return fail('shape', (e as Error).message); }
    if (h.exam !== c.exam || h.shift !== c.shift || h.attempt !== c.attempt || h.cand !== c.cand) return fail('context', 'entry belongs to another exam, shift, attempt or candidate');
    if (!verify(tagged(D.ENTRY, ha), hexToBytes(sig))) return fail('sig', 'signature does not verify');
    if (h.seq !== i + 1) return fail('seq', `expected seq ${i + 1}, found ${h.seq}`);
    if (h.prev !== prev) return fail('prev', 'prev does not match the previous entry hash');
    prev = toHex(entryHash(h));
  }
  return { ok: true, head: prev, count: lines.length };
}

/** An unlock followed by n-1 answers cycling through the 20 bank items. */
export function demoEntries(n: number): EntryIn[] {
  return Array.from({ length: n }, (_, i): EntryIn => i === 0
    ? { kind: 'unlock', tMonoMs: 0, activeMs: 0, body: { item: '', state: '', answer: '', meta: [] }, salt: randomBytes(16) }
    : { kind: 'answer', tMonoMs: i * 30_000, activeMs: i * 30_000 - 500, salt: randomBytes(16),
        body: { item: `I${String(((i - 1) % 20) + 1).padStart(2, '0')}`, state: 'A', answer: 'ABCD'[i % 4], meta: [25_000 + (i % 7) * 1000, []] } });
}
```

- [ ] **Step 4: Run the test and confirm it passes.** Run `cd packages/core && node --test test/journal.test.ts && bun test ./test/journal.test.ts`. Expected: PASS, with 1,000 of 1,000 flips located.

- [ ] **Step 5: Write the tamper lab CLI**

`tools/tamper-lab.ts`:
```ts
// Tamper lab: build a signed answer chain, flip one byte, and show which entry the verifier pins.
//   node tools/tamper-lab.ts [--entries 40] [--offset N]      build + flip + verify
//   node tools/tamper-lab.ts verify <journal.jsonl>             verify a file (reads <file>.pub.json)
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { hexToBytes, toHex } from '../packages/core/src/bytes.ts';
import { buildChain, demoEntries, verifyChain, type ChainResult } from '../packages/core/src/journal.ts';
import { newKeyPair, signer, verifier } from '../packages/core/src/node.ts';

const { values, positionals } = parseArgs({ allowPositionals: true, options: { entries: { type: 'string', default: '40' }, offset: { type: 'string' } } });
const ctx = { exam: 'DEMO-2026', shift: 'S1', attempt: 1, cand: 'C0001' };
const report = (label: string, r: ChainResult) =>
  console.log(r.ok ? `✓ ${label}: ${r.count} entries verify, head ${r.head.slice(0, 16)}…`
    : `✗ ${label}: entry seq ${r.index + 1} (line ${r.index + 1}) — ${r.fault}: ${r.detail}`);
const read = (f: string) => { const l = readFileSync(f, 'utf8').split('\n'); if (l.at(-1) === '') l.pop(); return l; };

if (positionals[0] === 'verify') {
  const file = positionals[1];
  const { ctx: c, pub } = JSON.parse(readFileSync(`${file}.pub.json`, 'utf8'));
  const r = verifyChain(c, read(file), verifier(hexToBytes(pub)));
  report(file, r);
  process.exit(r.ok ? 0 : 1);
}

const key = newKeyPair();
const { lines } = buildChain(ctx, 1, demoEntries(Number(values.entries)), signer(key));
const file = join(tmpdir(), 'saakshi-journal.jsonl');
const text = lines.join('\n') + '\n';
const pubJson = JSON.stringify({ ctx, pub: toHex(key.pub) });
writeFileSync(file, text);
writeFileSync(`${file}.pub.json`, pubJson);
report('original', verifyChain(ctx, lines, verifier(key.pub)));

const bytes = Buffer.from(text);
const off = values.offset ? Number(values.offset) : Math.floor(Math.random() * bytes.length);
const line = text.slice(0, off).split('\n').length;
const before = String.fromCharCode(bytes[off]);
bytes[off] ^= 0x01;
writeFileSync(`${file}.tampered`, bytes);
writeFileSync(`${file}.tampered.pub.json`, pubJson);
console.log(`flipped byte ${off} (line ${line}): ${JSON.stringify(before)} → ${JSON.stringify(String.fromCharCode(bytes[off]))}`);
const r = verifyChain(ctx, read(`${file}.tampered`), verifier(key.pub));
report('tampered', r);
console.log(!r.ok && r.index + 1 === line ? `located exactly: line ${line}` : 'MISMATCH — investigate');
console.log(`files: ${file}  (edit by hand, then: node tools/tamper-lab.ts verify ${file})`);
```

- [ ] **Step 6: Run the lab.** Run `node tools/tamper-lab.ts --offset 1234 && node tools/tamper-lab.ts`. Expected: `✓ original: 40 entries verify…`, then `✗ tampered: entry seq N…`, then `located exactly: line N`.

- [ ] **Step 7: Hand back for review and commit** with the message `feat(core): signed chain verifier and CLI tamper lab`.

---

### Task 7: Frozen fixtures, cohort/export schemas, uv project

**Files:**
- Create: `fixtures/paper/{bank,key,forms}.json`, `fixtures/schemas/v1.json`, `tools/gen-fixtures.ts`
- Generated and committed: `fixtures/keys.json`, `fixtures/cohort-stub.jsonl`
- Create: `packages/core/src/schema.ts`
- Test: `packages/core/test/schema.test.ts`
- Create: `analytics/pyproject.toml`
- Test: `analytics/tests/test_schema.py`

**Interfaces:**
- Consumes: `node.ts` `newKeyPair` and `bytes.ts` `toHex`.
- Produces:
  - `schema.ts`: `FieldSpec = 'string'|'int'|'hex64'|(string|number)[]`, and `validateRow(row, spec): string[]`.
  - `keys.json` is `{_warning, authority: {priv, pub}, cells: [{id, priv, pub}×3], seats: [{seatId, priv, pub}×8]}` (hex).
  - An export row is the cohort fields plus the export fields.

- [ ] **Step 1: Write the paper fixtures** (20 bilingual items; keys spread five each across A, B, C and D)

`fixtures/paper/bank.json`:
```json
{
  "exam": "DEMO-2026",
  "items": [
    { "id": "I01", "subject": "physics", "en": { "q": "What is the SI unit of force?", "o": ["Joule", "Watt", "Pascal", "Newton"] }, "hi": { "q": "बल का SI मात्रक क्या है?", "o": ["जूल", "वाट", "पास्कल", "न्यूटन"] } },
    { "id": "I02", "subject": "physics", "en": { "q": "The speed of light in vacuum is approximately:", "o": ["3 × 10⁵ m/s", "3 × 10⁸ m/s", "3 × 10¹⁰ m/s", "3 × 10⁶ m/s"] }, "hi": { "q": "निर्वात में प्रकाश की चाल लगभग कितनी है?", "o": ["3 × 10⁵ m/s", "3 × 10⁸ m/s", "3 × 10¹⁰ m/s", "3 × 10⁶ m/s"] } },
    { "id": "I03", "subject": "physics", "en": { "q": "Which of these is a vector quantity?", "o": ["Mass", "Temperature", "Velocity", "Energy"] }, "hi": { "q": "इनमें से कौन-सी राशि सदिश है?", "o": ["द्रव्यमान", "ताप", "वेग", "ऊर्जा"] } },
    { "id": "I04", "subject": "physics", "en": { "q": "Ohm's law is expressed as:", "o": ["V = IR", "P = VI", "F = ma", "E = mc²"] }, "hi": { "q": "ओम का नियम किस रूप में व्यक्त किया जाता है?", "o": ["V = IR", "P = VI", "F = ma", "E = mc²"] } },
    { "id": "I05", "subject": "physics", "en": { "q": "Acceleration due to gravity at the Earth's surface is about:", "o": ["1.6 m/s²", "6.67 m/s²", "98 m/s²", "9.8 m/s²"] }, "hi": { "q": "पृथ्वी की सतह पर गुरुत्वीय त्वरण लगभग कितना है?", "o": ["1.6 m/s²", "6.67 m/s²", "98 m/s²", "9.8 m/s²"] } },
    { "id": "I06", "subject": "chemistry", "en": { "q": "What is the atomic number of carbon?", "o": ["4", "6", "8", "12"] }, "hi": { "q": "कार्बन का परमाणु क्रमांक क्या है?", "o": ["4", "6", "8", "12"] } },
    { "id": "I07", "subject": "chemistry", "en": { "q": "The pH of pure water at 25 °C is:", "o": ["7", "0", "1", "14"] }, "hi": { "q": "25 °C पर शुद्ध जल का pH कितना होता है?", "o": ["7", "0", "1", "14"] } },
    { "id": "I08", "subject": "chemistry", "en": { "q": "The chemical formula of common salt is:", "o": ["KCl", "NaOH", "NaCl", "CaCO₃"] }, "hi": { "q": "साधारण नमक का रासायनिक सूत्र क्या है?", "o": ["KCl", "NaOH", "NaCl", "CaCO₃"] } },
    { "id": "I09", "subject": "chemistry", "en": { "q": "Which gas is most abundant in the Earth's atmosphere?", "o": ["Oxygen", "Carbon dioxide", "Nitrogen", "Argon"] }, "hi": { "q": "पृथ्वी के वायुमंडल में सबसे अधिक मात्रा में कौन-सी गैस है?", "o": ["ऑक्सीजन", "कार्बन डाइऑक्साइड", "नाइट्रोजन", "आर्गन"] } },
    { "id": "I10", "subject": "chemistry", "en": { "q": "Avogadro's number is approximately:", "o": ["6.022 × 10²³", "3.0 × 10⁸", "1.6 × 10⁻¹⁹", "9.1 × 10⁻³¹"] }, "hi": { "q": "आवोगाद्रो संख्या का मान लगभग कितना है?", "o": ["6.022 × 10²³", "3.0 × 10⁸", "1.6 × 10⁻¹⁹", "9.1 × 10⁻³¹"] } },
    { "id": "I11", "subject": "biology", "en": { "q": "Which organelle is called the powerhouse of the cell?", "o": ["Nucleus", "Ribosome", "Golgi body", "Mitochondrion"] }, "hi": { "q": "कोशिका का ऊर्जा-घर किस कोशिकांग को कहा जाता है?", "o": ["केंद्रक", "राइबोसोम", "गॉल्जी काय", "माइटोकॉन्ड्रिया"] } },
    { "id": "I12", "subject": "biology", "en": { "q": "Which blood components help in clotting?", "o": ["Red blood cells", "White blood cells", "Platelets", "Plasma cells"] }, "hi": { "q": "रक्त का थक्का बनाने में कौन-से घटक सहायक हैं?", "o": ["लाल रक्त कोशिकाएँ", "श्वेत रक्त कोशिकाएँ", "बिम्बाणु (प्लेटलेट्स)", "प्लाज़्मा कोशिकाएँ"] } },
    { "id": "I13", "subject": "biology", "en": { "q": "Photosynthesis mainly takes place in:", "o": ["Mitochondria", "Chloroplasts", "Vacuoles", "Nucleus"] }, "hi": { "q": "प्रकाश-संश्लेषण मुख्यतः कहाँ होता है?", "o": ["माइटोकॉन्ड्रिया", "हरितलवक (क्लोरोप्लास्ट)", "रिक्तिका", "केंद्रक"] } },
    { "id": "I14", "subject": "biology", "en": { "q": "How many chromosomes are in a normal human somatic cell?", "o": ["23", "44", "48", "46"] }, "hi": { "q": "सामान्य मानव कायिक कोशिका में कितने गुणसूत्र होते हैं?", "o": ["23", "44", "48", "46"] } },
    { "id": "I15", "subject": "mathematics", "en": { "q": "The value of sin 30° is:", "o": ["0", "1/2", "√3/2", "1"] }, "hi": { "q": "sin 30° का मान क्या है?", "o": ["0", "1/2", "√3/2", "1"] } },
    { "id": "I16", "subject": "mathematics", "en": { "q": "The derivative of x² with respect to x is:", "o": ["2x", "x", "x²/2", "2"] }, "hi": { "q": "x² का x के सापेक्ष अवकलज क्या है?", "o": ["2x", "x", "x²/2", "2"] } },
    { "id": "I17", "subject": "mathematics", "en": { "q": "The sum of the interior angles of a triangle is:", "o": ["90°", "180°", "270°", "360°"] }, "hi": { "q": "किसी त्रिभुज के अंतःकोणों का योग कितना होता है?", "o": ["90°", "180°", "270°", "360°"] } },
    { "id": "I18", "subject": "mathematics", "en": { "q": "log₁₀ 1000 equals:", "o": ["2", "10", "100", "3"] }, "hi": { "q": "log₁₀ 1000 का मान क्या है?", "o": ["2", "10", "100", "3"] } },
    { "id": "I19", "subject": "mathematics", "en": { "q": "In how many ways can 3 different books be arranged in a row?", "o": ["6", "3", "9", "27"] }, "hi": { "q": "3 भिन्न पुस्तकों को एक पंक्ति में कितने प्रकार से रखा जा सकता है?", "o": ["6", "3", "9", "27"] } },
    { "id": "I20", "subject": "mathematics", "en": { "q": "If 2x + 3 = 11, then x equals:", "o": ["3", "5", "4", "7"] }, "hi": { "q": "यदि 2x + 3 = 11 है, तो x का मान क्या है?", "o": ["3", "5", "4", "7"] } }
  ]
}
```

`fixtures/paper/key.json`:
```json
{ "I01": "D", "I02": "B", "I03": "C", "I04": "A", "I05": "D", "I06": "B", "I07": "A", "I08": "C", "I09": "C", "I10": "A",
  "I11": "D", "I12": "C", "I13": "B", "I14": "D", "I15": "B", "I16": "A", "I17": "B", "I18": "D", "I19": "A", "I20": "C" }
```

`fixtures/paper/forms.json`. The display number is the position, so I17 is "Q17" on F1:
```json
{
  "F1": ["I01","I02","I03","I04","I05","I06","I07","I08","I09","I10","I11","I12","I13","I14","I15","I16","I17","I18","I19","I20"],
  "F2": ["I20","I19","I18","I17","I16","I15","I14","I13","I12","I11","I10","I09","I08","I07","I06","I05","I04","I03","I02","I01"],
  "durationMin": 30
}
```

`fixtures/schemas/v1.json`:
```json
{
  "version": 1,
  "cohort": {
    "cand": "string", "centre": "string", "shift": "string",
    "form": ["F1", "F2"], "lang": ["en", "hi", "ta"], "pwd": [0, 1],
    "item": "string", "state": ["NV", "NA", "A", "MR", "AMR"], "answer": ["", "A", "B", "C", "D"],
    "dwellMs": "int", "visits": "int", "changes": "int", "tFirstMs": "int"
  },
  "export": { "seq": "int", "rxWall": "int", "h": "hex64" },
  "notes": {
    "row": "one row per candidate × item",
    "item": "bank id (I01…), not the display number",
    "tFirstMs": "ms from unlock to the first answer on this item; -1 if never answered",
    "export": "a cell export row = every cohort field + every export field (last entry touching this item)"
  }
}
```

- [ ] **Step 2: Write the failing TS schema test**

`packages/core/test/schema.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateRow, type FieldSpec } from '../src/schema.ts';

const root = new URL('../../../', import.meta.url);
const spec = JSON.parse(readFileSync(new URL('fixtures/schemas/v1.json', root), 'utf8')) as { cohort: Record<string, FieldSpec>; export: Record<string, FieldSpec> };

test('every stub cohort row matches the frozen v1 schema', () => {
  const rows = readFileSync(new URL('fixtures/cohort-stub.jsonl', root), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(rows.length, 60);
  for (const r of rows) assert.deepEqual(validateRow(r, spec.cohort), [], JSON.stringify(r));
});

test('validateRow reports unexpected, mistyped and missing fields', () => {
  const s: Record<string, FieldSpec> = { a: 'string', n: 'int', e: ['x', 'y'], h: 'hex64' };
  assert.deepEqual(validateRow({ a: 'q', n: 1, e: 'x', h: 'f'.repeat(64) }, s), []);
  assert.deepEqual(validateRow({ a: 1, n: 1.5, e: 'z', extra: 0 }, s), ['unexpected field extra', 'bad a: 1', 'bad n: 1.5', 'bad e: "z"', 'missing h']);
});

test('an export row is the cohort fields plus the export fields', () => {
  const row = { cand: 'C0001', centre: 'CEN042', shift: 'S1', form: 'F1', lang: 'hi', pwd: 0, item: 'I17', state: 'A', answer: 'B', dwellMs: 1, visits: 1, changes: 0, tFirstMs: 5, seq: 9, rxWall: 1790000000000, h: 'a'.repeat(64) };
  assert.deepEqual(validateRow(row, { ...spec.cohort, ...spec.export }), []);
});
```

- [ ] **Step 3: Implement `schema.ts`**

```ts
/** Field specs for the frozen v1 cohort/export schemas (fixtures/schemas/v1.json). */
export type FieldSpec = 'string' | 'int' | 'hex64' | (string | number)[];

const ok = (v: unknown, s: FieldSpec): boolean =>
  s === 'string' ? typeof v === 'string'
  : s === 'int' ? Number.isSafeInteger(v)
  : s === 'hex64' ? typeof v === 'string' && /^[0-9a-f]{64}$/.test(v)
  : s.includes(v as string | number);

export function validateRow(row: Record<string, unknown>, spec: Record<string, FieldSpec>): string[] {
  const errs: string[] = [];
  for (const k of Object.keys(row)) if (!(k in spec)) errs.push(`unexpected field ${k}`);
  for (const [k, s] of Object.entries(spec)) {
    if (!(k in row)) errs.push(`missing ${k}`);
    else if (!ok(row[k], s)) errs.push(`bad ${k}: ${JSON.stringify(row[k])}`);
  }
  return errs;
}
```

- [ ] **Step 4: Write and run the fixture generator** (it refuses to overwrite: fixtures are frozen)

`tools/gen-fixtures.ts`:
```ts
// Generates frozen demo fixtures. Refuses to overwrite: deleting a file to regenerate it is a fixture change.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { toHex } from '../packages/core/src/bytes.ts';
import { newKeyPair } from '../packages/core/src/node.ts';

const out = (path: string, text: string) => {
  if (existsSync(path)) { console.log(`keep ${path} (frozen)`); return; }
  writeFileSync(path, text); console.log(`wrote ${path}`);
};
const kp = () => { const k = newKeyPair(); return { priv: toHex(k.priv), pub: toHex(k.pub) }; };

out('fixtures/keys.json', JSON.stringify({
  _warning: 'DEMO KEYS — published in the repo; never use outside the demo',
  authority: kp(),
  cells: [1, 2, 3].map((i) => ({ id: `cell-${i}`, ...kp() })),
  seats: Array.from({ length: 8 }, (_, i) => ({ seatId: `CEN042-S${String(i + 1).padStart(2, '0')}`, ...kp() })),
}, null, 2) + '\n');

// Deterministic stub cohort: 3 candidates × 20 items (mulberry32, seed 42).
let seed = 42;
const rand = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const int = (a: number, b: number) => a + Math.floor(rand() * (b - a + 1));
const forms = JSON.parse(readFileSync('fixtures/paper/forms.json', 'utf8')) as Record<string, string[]>;
const cands = [
  { cand: 'C0001', form: 'F1', lang: 'en', pwd: 0 },
  { cand: 'C0002', form: 'F2', lang: 'hi', pwd: 0 },
  { cand: 'C0003', form: 'F1', lang: 'en', pwd: 1 },
];
const rows: string[] = [];
for (const c of cands) {
  let t = 0;
  for (const item of forms[c.form]) {
    const state = (['A', 'A', 'A', 'NA', 'MR', 'AMR', 'NV'] as const)[int(0, 6)];
    const answered = state === 'A' || state === 'AMR';
    t += int(20_000, 90_000);
    rows.push(JSON.stringify({
      cand: c.cand, centre: 'CEN042', shift: 'S1', form: c.form, lang: c.lang, pwd: c.pwd, item, state,
      answer: answered ? 'ABCD'[int(0, 3)] : '', dwellMs: state === 'NV' ? 0 : int(5_000, 90_000),
      visits: state === 'NV' ? 0 : int(1, 3), changes: answered ? int(0, 2) : 0, tFirstMs: answered ? t : -1,
    }));
  }
}
out('fixtures/cohort-stub.jsonl', rows.join('\n') + '\n');
```

Run: `node tools/gen-fixtures.ts && cd packages/core && node --test test/schema.test.ts && bun test ./test/schema.test.ts`
Expected: `wrote fixtures/keys.json`, `wrote fixtures/cohort-stub.jsonl`, then PASS.

- [ ] **Step 5: Set up the uv project with its own schema test**

`analytics/pyproject.toml`:
```toml
[project]
name = "saakshi-analytics"
version = "0.1.0"
requires-python = ">=3.14"
dependencies = ["numpy", "scipy", "networkx"]

[dependency-groups]
dev = ["pytest"]

[tool.pytest.ini_options]
testpaths = ["tests"]
```

`analytics/tests/test_schema.py`:
```python
import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[2]
SPEC = json.loads((ROOT / "fixtures/schemas/v1.json").read_text())


def check(row: dict, spec: dict) -> list[str]:
    errs = [f"unexpected field {k}" for k in row if k not in spec]
    for k, s in spec.items():
        if k not in row:
            errs.append(f"missing {k}")
            continue
        v = row[k]
        if s == "string":
            ok = isinstance(v, str)
        elif s == "int":
            ok = isinstance(v, int) and not isinstance(v, bool)
        elif s == "hex64":
            ok = isinstance(v, str) and re.fullmatch(r"[0-9a-f]{64}", v) is not None
        else:
            ok = v in s and not isinstance(v, bool)
        if not ok:
            errs.append(f"bad {k}: {v!r}")
    return errs


def test_stub_cohort_matches_frozen_schema():
    rows = [json.loads(l) for l in (ROOT / "fixtures/cohort-stub.jsonl").read_text().splitlines()]
    assert len(rows) == 60
    for r in rows:
        assert check(r, SPEC["cohort"]) == [], r


def test_scientific_stack_imports():
    import networkx, numpy, scipy.stats  # noqa: F401
```

Run: `cd analytics && uv sync && uv run pytest -q`
Expected: `2 passed`, and `analytics/uv.lock` is created.

- [ ] **Step 6: Hand back for review and commit** with the message `feat: frozen fixtures (keys, bilingual paper, cohort stub), v1 schemas, uv project`. Include `analytics/uv.lock`.

---

### Task 8: Golden vectors and the frozen protocol v1 document

**Files:**
- Create: `tools/gen-vectors.ts` → `fixtures/vectors/protocol-v1.json` (committed; refuses to overwrite)
- Create: `docs/protocol-v1.md`
- Test: `packages/core/test/vectors.test.ts`

**Interfaces:**
- Consumes: all core modules (Tasks 2–6) and `fixtures/keys.json` (Task 7). `seats[0]` signs; `cells[0]` receives the body envelope.
- Produces: the normative vectors and the frozen spec.

- [ ] **Step 1: Write and run the generator**

`tools/gen-vectors.ts`:
```ts
// Generates golden vectors for protocol v1. Refuses to overwrite: vectors are frozen with the protocol.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { hexToBytes, toHex, utf8 } from '../packages/core/src/bytes.ts';
import { canon } from '../packages/core/src/canon.ts';
import { D, bodyCommit, counts, entryHash, finalHash, genesisPrev, headerArray, kcf, leafArray, receiptCode, tagged, type Header, type Response } from '../packages/core/src/protocol.ts';
import { sealBody, signer } from '../packages/core/src/node.ts';
import { consistencyProof, inclusionProof, leafHash, rootOf } from '../packages/core/src/merkle.ts';
import { newOfflineCode, splitBundle, wrapForCentre } from '../packages/core/src/custody.ts';
import { buildChain, demoEntries } from '../packages/core/src/journal.ts';

const OUT = 'fixtures/vectors/protocol-v1.json';
if (existsSync(OUT)) { console.log(`keep ${OUT} (frozen)`); process.exit(0); }

const keys = JSON.parse(readFileSync('fixtures/keys.json', 'utf8'));
const seat = { priv: hexToBytes(keys.seats[0].priv), pub: hexToBytes(keys.seats[0].pub) };
const cellPub = hexToBytes(keys.cells[0].pub);
const sign = signer(seat);
const ctx = { exam: 'DEMO-2026', shift: 'S1', attempt: 1, cand: 'C0001' };
const salt = Uint8Array.from({ length: 16 }, (_, i) => i);
const body = { item: 'I17', state: 'A' as const, answer: 'B', meta: [4200, ['हिन्दी']] };
const bc = bodyCommit(salt, body);
const header: Header = { ...ctx, keyEpoch: 1, seq: 1, prev: genesisPrev(ctx), kind: 'answer', tMonoMs: 61000, activeMs: 60500, bodyCommit: bc };
const h = toHex(entryHash(header));
const responses: Response[] = [['I17', 'AMR', 'B'], ['I03', 'A', 'C'], ['I05', 'MR', '']];
const fh = finalHash(ctx, 'F1', responses);
const receiptIn = { exam: ctx.exam, shift: ctx.shift, attempt: 1, pseud: '7'.repeat(64), seq: 1, h, finalHash: fh, ...counts(responses) };
const leaves = Array.from({ length: 13 }, (_, i) => leafHash(utf8(canon(leafArray({ ...ctx, pseud: toHex(new Uint8Array(32).fill(i)), h, finalHash: fh })))));
const K = new Uint8Array(32).fill(0x11);
const bundle = { kF1: new Uint8Array(32).fill(0xf1), kF2: new Uint8Array(32).fill(0xf2), L: new Uint8Array(32).fill(0x1c) };
const code = newOfflineCode();
const centre = { exam: ctx.exam, shift: ctx.shift, centre: 'CEN042' };
const sealed = sealBody(cellPub, { ...ctx, seq: 1 }, salt, body);
const msgs = Array.from({ length: 16 }, (_, i) => tagged(D.ENTRY, headerArray({ ...header, seq: i + 1 })));

const vectors = {
  v: 1,
  _note: 'Normative. Signatures are non-deterministic: check that they VERIFY, never compare bytes.',
  canon: {
    accept: [[['x', 1, 'a', [2, ['b']]], '["x",1,"a",[2,["b"]]]'], [['x', 'हिन्दी'], '["x","हिन्दी"]']],
    reject: ['["x", 1]', '["x",1.0]', '["x",-0]', '["x",1e2]', '{"a":1}', '["x",null]', '["x",true]', '[1,"x"]'],
  },
  ctx, genesisPrev: genesisPrev(ctx),
  body: { salt: toHex(salt), body, bodyCommit: bc },
  entry: { header, m: toHex(tagged(D.ENTRY, headerArray(header))), h },
  final: { form: 'F1', responses, finalHash: fh },
  receipt: { in: receiptIn, code: receiptCode(receiptIn) },
  kcf: { K: toHex(K), kc: kcf(K) },
  merkle: {
    leafHashes: leaves.map(toHex),
    roots: leaves.map((_, i) => toHex(rootOf(leaves.slice(0, i + 1)))),
    inclusion: [0, 5, 12].map((index) => ({ size: 13, index, proof: inclusionProof(leaves, index).map(toHex) })),
    consistency: [[1, 13], [4, 13], [7, 13], [13, 13]].map(([m, n]) => ({ size1: m, size2: n, proof: consistencyProof(leaves.slice(0, n), m).map(toHex) })),
  },
  signatures: { pub: toHex(seat.pub), items: msgs.map((m) => ({ m: toHex(m), sig: toHex(sign(m)) })) },
  bodyEnvelope: { seq: 1, envelope: toHex(sealed.envelope), bodyCommit: sealed.bodyCommit },
  custody: {
    code, centre, wrap: toHex(wrapForCentre(code, centre, bundle.kF1, bundle.kF2)),
    kc: { F1: kcf(bundle.kF1), F2: kcf(bundle.kF2) }, L: toHex(bundle.L),
    shares: (await splitBundle(bundle)).map(toHex),
  },
  chain: { lines: buildChain(ctx, 1, demoEntries(5), sign).lines },
};
mkdirSync('fixtures/vectors', { recursive: true });
writeFileSync(OUT, JSON.stringify(vectors, null, 2) + '\n');
console.log(`wrote ${OUT}`);
```

Run: `node tools/gen-vectors.ts`. Expected: `wrote fixtures/vectors/protocol-v1.json`.

- [ ] **Step 2: Write the vectors test** (it recomputes everything deterministic, and verifies with both verifiers)

`packages/core/test/vectors.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { hexToBytes, toHex } from '../src/bytes.ts';
import { canon, parseCanon } from '../src/canon.ts';
import { D, bodyCommit, counts, entryHash, finalHash, genesisPrev, headerArray, kcf, receiptCode, tagged } from '../src/protocol.ts';
import { nobleVerifier } from '../src/sig.ts';
import { openBody, verifier } from '../src/node.ts';
import { consistencyProof, inclusionProof, rootOf, verifyConsistency, verifyInclusion } from '../src/merkle.ts';
import { combineBundle, unwrapForCentre } from '../src/custody.ts';
import { verifyChain } from '../src/journal.ts';

const root = new URL('../../../', import.meta.url);
const V = JSON.parse(readFileSync(new URL('fixtures/vectors/protocol-v1.json', root), 'utf8'));
const keys = JSON.parse(readFileSync(new URL('fixtures/keys.json', root), 'utf8'));
const hx = (a: string[]) => a.map(hexToBytes);
const seatPub = hexToBytes(keys.seats[0].pub);

test('canonical encoding vectors', () => {
  for (const [v, t] of V.canon.accept) { assert.equal(canon(v), t); assert.deepEqual(parseCanon(t), v); }
  for (const t of V.canon.reject) assert.throws(() => parseCanon(t), t);
});

test('hash vectors recompute exactly', () => {
  assert.equal(genesisPrev(V.ctx), V.genesisPrev);
  assert.equal(bodyCommit(hexToBytes(V.body.salt), V.body.body), V.body.bodyCommit);
  assert.equal(toHex(tagged(D.ENTRY, headerArray(V.entry.header))), V.entry.m);
  assert.equal(toHex(entryHash(V.entry.header)), V.entry.h);
  assert.equal(finalHash(V.ctx, V.final.form, V.final.responses), V.final.finalHash);
  assert.deepEqual(counts(V.final.responses), { attempted: V.receipt.in.attempted, answered: V.receipt.in.answered, marked: V.receipt.in.marked });
  assert.equal(receiptCode(V.receipt.in), V.receipt.code);
  assert.equal(kcf(hexToBytes(V.kcf.K)), V.kcf.kc);
});

test('merkle vectors recompute and verify', () => {
  const L = hx(V.merkle.leafHashes);
  V.merkle.roots.forEach((r: string, i: number) => assert.equal(toHex(rootOf(L.slice(0, i + 1))), r));
  for (const { size, index, proof } of V.merkle.inclusion) {
    assert.deepEqual(inclusionProof(L.slice(0, size), index).map(toHex), proof);
    assert.ok(verifyInclusion(index, size, L[index], hx(proof), hexToBytes(V.merkle.roots[size - 1])));
  }
  for (const { size1, size2, proof } of V.merkle.consistency) {
    assert.deepEqual(consistencyProof(L.slice(0, size2), size1).map(toHex), proof);
    assert.ok(verifyConsistency(size1, size2, hx(proof), hexToBytes(V.merkle.roots[size1 - 1]), hexToBytes(V.merkle.roots[size2 - 1])));
  }
});

test('signature and chain vectors verify under native and noble', () => {
  for (const v of [verifier(seatPub), nobleVerifier(seatPub)]) {
    for (const { m, sig } of V.signatures.items) assert.ok(v(hexToBytes(m), hexToBytes(sig)));
    assert.equal(verifyChain(V.ctx, V.chain.lines, v).ok, true);
  }
});

test('body envelope opens with the fixture cell key', () => {
  const out = openBody(hexToBytes(keys.cells[0].priv), { ...V.ctx, seq: V.bodyEnvelope.seq }, hexToBytes(V.bodyEnvelope.envelope), V.bodyEnvelope.bodyCommit);
  assert.deepEqual(out.body, V.body.body);
});

test('custody vectors: offline code unwraps; any 2 shares rebuild', async () => {
  const k = unwrapForCentre(V.custody.code, V.custody.centre, hexToBytes(V.custody.wrap));
  assert.equal(kcf(k.kF1), V.custody.kc.F1);
  assert.equal(kcf(k.kF2), V.custody.kc.F2);
  const s = hx(V.custody.shares);
  for (const [a, b] of [[0, 1], [0, 2], [1, 2]]) {
    const got = await combineBundle([s[a], s[b]]);
    assert.equal(kcf(got.kF1), V.custody.kc.F1);
    assert.equal(toHex(got.L), V.custody.L);
  }
});
```

Run: `cd packages/core && node --test test/vectors.test.ts && bun test ./test/vectors.test.ts`
Expected: PASS on both runtimes. Artifacts generated by Node verify on Bun, which is the cell and relay runtime.

- [ ] **Step 3: Write `docs/protocol-v1.md`**

This is the frozen spec, byte-precise and taken from the code above. It **must not introduce behaviour** that the code doesn't have. Sections:
1. **Status**: frozen 2026-09-27. Any change requires `V = 2`, new vectors and new fixtures.
2. **Canonical encoding**: the rules and the rejected inputs; "UTF-8 of `JSON.stringify` output".
3. **Domain bytes**: a table from 0x00 to 0x07.
4. **Hex and keys**: lowercase hex, 65-byte uncompressed public keys, 32-byte private keys.
5. **Structure layouts**: one line each for genesis, entry header, body, final, receipt and leaf. These layouts are reserved and implemented in later stages: STH `["sth",exam,shift,size,root,prevSTH,ts]`, ack `["ack",exam,shift,attempt,cand,keyEpoch,seq,h]`, bind `["bind",exam,shift,attempt,cand,seatId,pubkey,keyEpoch,fromSeq,attestHash]`, handover `["handover",…,fromSeq,fromHead,newPub]` and release `["release",exam,shift,form,kc_f,ts]`.
6. **Entries**:
   - `seq` starts at 1; the first `prev` is the genesis.
   - The kinds, and the states with the NTA evaluation rule: A and AMR are evaluated, MR without an answer is not.
   - Non-item bodies use `''` for item, state and answer. A submit body's meta is `[form, finalHash]`.
   - The counts definitions.
7. **Signatures**: as in Global Constraints, plus the low-S rule and "vectors check verification, not bytes".
8. **Body envelope**: `ephPub(65) ‖ nonce(24) ‖ XChaCha20-Poly1305(salt(16) ‖ canon(body))`. The key is `HKDF-SHA256(ECDH x-coord, salt=∅, info=canon(["saakshi-body",1,exam,shift,attempt,cand,seq]), 32)`.
9. **Custody**:
   - The code format: Crockford, 16 symbols + a mod-37 check symbol; O→0 and I/L→1; dashes ignored.
   - The wrap: `nonce(24) ‖ XChaCha(HKDF(code bytes, ∅, canon(["saakshi-offline",exam,shift,centre])), kF1‖kF2)`.
   - Shamir 2-of-3 over `kF1‖kF2‖L` with the `shamir-secret-sharing` share format (97 bytes).
   - `kc_f`.
10. **Merkle**: RFC 9162 §2.1, with the leaf built from `leafArray`.
11. **Signed chain line**: `canon(["signed", header, sigHex])\n`; the verifier check order is parse, shape, context, sig, seq, prev. Truncation is detected by comparing heads with the receipt and the leaf (Stage 2).
12. **Schemas**: the table from `fixtures/schemas/v1.json`.
13. **Vectors and fixtures**: paths, and "generated once by `tools/gen-*.ts`, which refuse to overwrite".

- [ ] **Step 4: Run the full core suite.** Run `pnpm --filter @saakshi/core test && pnpm --filter @saakshi/core typecheck`. Expected: all tests pass under node and bun, and tsc is clean.

- [ ] **Step 5: Hand back for review and commit** with the message `feat(core): freeze protocol v1 — golden vectors and spec`.

---

### Task 9: Seat shell — Electron, `app://`, CSP, safeStorage, packaged macOS build

**Files:**
- Modify: `apps/seat/package.json` (scripts)
- Create: `apps/seat/electron.vite.config.ts`, `apps/seat/electron-builder.yml`, `apps/seat/tsconfig.json`
- Create: `apps/seat/src/main/{index,app-path,probes}.ts` (`probes.ts` is a stub until Task 11), `apps/seat/src/preload/index.ts`
- Create: `apps/seat/src/renderer/index.html`, `apps/seat/src/renderer/src/{main.tsx,App.tsx}`
- Create: `apps/seat/scripts/{adhoc-sign.sh,copy-mediapipe.mjs}` (`copy-mediapipe.mjs` is a no-op until Task 10)
- Test: `apps/seat/test/app-path.test.ts`

**Interfaces:**
- Produces:
  - `resolveAppPath(root, urlPath): string | null`.
  - `window.saakshi.safeStorageCheck(): Promise<string>`.
  - Main handles `--probe-selftest [--out <file>]` by calling `runSelftest()` from `./probes.ts`.

- [ ] **Step 1: Write the failing test**

`apps/seat/test/app-path.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { resolveAppPath } from '../src/main/app-path.ts';

const root = join('/opt', 'seat', 'renderer');

test('resolves files inside the renderer dir', () => {
  assert.equal(resolveAppPath(root, '/'), join(root, 'index.html'));
  assert.equal(resolveAppPath(root, '/index.html'), join(root, 'index.html'));
  assert.equal(resolveAppPath(root, '/mediapipe/wasm/vision_wasm_internal.wasm'), join(root, 'mediapipe', 'wasm', 'vision_wasm_internal.wasm'));
});

test('never escapes the renderer dir', () => {
  for (const p of ['/../secret', '/%2e%2e/secret', '/..%2fsecret', '/a/../../secret', '/%E0%A4', '/x%00y'])
    assert.equal(resolveAppPath(root, p), null, p);
});
```
Run: `cd apps/seat && node --test "test/**/*.test.ts"`. Expected: FAIL with `Cannot find module`.

- [ ] **Step 2: Implement `app-path.ts`**, then run the test and confirm it passes. A "Reparsing as ES module" warning is expected and harmless.

```ts
import { join, normalize, sep } from 'node:path';

/** Map an app:// URL path to a file under root, or null if it would escape root or is malformed. */
export function resolveAppPath(root: string, urlPath: string): string | null {
  let rel: string;
  try { rel = decodeURIComponent(urlPath); } catch { return null; }
  if (rel.includes('\0')) return null;
  const base = normalize(root);
  const full = normalize(join(base, rel === '/' ? 'index.html' : rel));
  return full.startsWith(base + sep) ? full : null;
}
```

- [ ] **Step 3: Write the config files**

Add these to `apps/seat/package.json`:
```json
"scripts": {
  "copy-mediapipe": "node scripts/copy-mediapipe.mjs",
  "dev": "pnpm copy-mediapipe && electron-vite dev",
  "build": "pnpm copy-mediapipe && electron-vite build",
  "pack:mac": "pnpm build && electron-builder --mac --dir && sh scripts/adhoc-sign.sh",
  "pack:win": "pnpm build && electron-builder --win --dir",
  "dist:win": "pnpm build && electron-builder --win nsis",
  "typecheck": "tsc -p tsconfig.json",
  "test": "node --test \"test/**/*.test.ts\""
}
```

`apps/seat/scripts/copy-mediapipe.mjs` (the Task 9 placeholder; Task 10 replaces it): `console.log('mediapipe: nothing to copy yet');`

`apps/seat/electron.vite.config.ts`. If the installed electron-vite says `externalizeDepsPlugin` is deprecated (v5 externalizes by default), remove both plugin entries.
```ts
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  main: { plugins: [externalizeDepsPlugin()] },
  preload: { plugins: [externalizeDepsPlugin()] },
  renderer: { plugins: [react()] },
});
```

`apps/seat/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2023", "lib": ["ES2023", "DOM"], "module": "ESNext", "moduleResolution": "Bundler",
    "jsx": "react-jsx", "strict": true, "noEmit": true, "allowImportingTsExtensions": true,
    "esModuleInterop": true, "skipLibCheck": true, "types": ["node"]
  },
  "include": ["src", "test", "electron.vite.config.ts"]
}
```

`apps/seat/electron-builder.yml`:
```yaml
appId: in.saakshi.seat
productName: Saakshi
directories:
  output: release
files:
  - out/**
  - package.json
asarUnpack:
  - "**/node_modules/koffi/**"
  - "**/node_modules/@koromix/**"
electronFuses:
  runAsNode: false
  enableNodeOptionsEnvironmentVariable: false
  enableNodeCliInspectArguments: false
  enableEmbeddedAsarIntegrityValidation: true
  onlyLoadAppFromAsar: true
mac:
  target: dir
  identity: null
  hardenedRuntime: false
  extendInfo:
    NSCameraUsageDescription: Saakshi checks that the registered candidate is present during the exam. No video is recorded or stored.
win:
  target: dir
  executableName: Saakshi
```

`apps/seat/scripts/adhoc-sign.sh`:
```sh
#!/bin/sh
# electron-builder >= 26.0.13's own ad-hoc path breaks camera frames; sign ad-hoc ourselves after fuses are flipped.
set -e
APP=$(ls -d release/mac*/Saakshi.app | head -1)
codesign --force --deep --sign - "$APP"
codesign --verify --deep --strict "$APP" && echo "ad-hoc signed: $APP"
```

koffi 3.x ships its native binary in a per-platform optional package (`@koromix/koffi-<platform>-<arch>`). Only the host's package is installed, so no prune step is needed; `asarUnpack` above keeps it loadable. This was verified on 2026-09-27 by tracing `process.dlopen` → `node_modules/@koromix/koffi-darwin-arm64/darwin_arm64/koffi.node`.

- [ ] **Step 4: Write main, preload and the renderer shell**

`apps/seat/src/main/index.ts`:
```ts
import { app, BrowserWindow, ipcMain, protocol, safeStorage, session, systemPreferences } from 'electron';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { resolveAppPath } from './app-path.ts';
import { runSelftest } from './probes.ts';

const argValue = (flag: string): string | undefined => { const i = process.argv.indexOf(flag); return i > 0 ? process.argv[i + 1] : undefined; };

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
  };
  const CSP = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'";

  ipcMain.handle('safe-storage-check', async () => {
    if (!safeStorage.isEncryptionAvailable()) return 'unavailable';
    const file = join(app.getPath('userData'), 'safe-storage-probe.bin');
    const persisted = existsSync(file) ? safeStorage.decryptString(await readFile(file)) === 'saakshi' : null;
    await writeFile(file, safeStorage.encryptString('saakshi'));
    return persisted === null ? 'ok (first run)' : persisted ? 'ok (decrypted previous run)' : 'MISMATCH';
  });

  app.whenReady().then(async () => {
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

    const win = new BrowserWindow({
      width: 1100, height: 760,
      webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, sandbox: true, nodeIntegration: false },
    });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('app://')) e.preventDefault(); });
    const dev = process.env.ELECTRON_RENDERER_URL;
    await (dev && !app.isPackaged ? win.loadURL(dev) : win.loadURL('app://seat/index.html'));
  });
  app.on('window-all-closed', () => app.quit());
}
```

`apps/seat/src/main/probes.ts` (a stub that Task 11 replaces):
```ts
export async function runSelftest(): Promise<{ ok: boolean; probes: Record<string, unknown> }> {
  return { ok: false, probes: {} };
}
```

`apps/seat/src/preload/index.ts`:
```ts
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('saakshi', {
  safeStorageCheck: (): Promise<string> => ipcRenderer.invoke('safe-storage-check'),
});
```

`apps/seat/src/renderer/index.html`:
```html
<!doctype html>
<html lang="en">
  <head><meta charset="UTF-8" /><title>Saakshi seat</title></head>
  <body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body>
</html>
```

`apps/seat/src/renderer/src/main.tsx`:
```tsx
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';

createRoot(document.getElementById('root')!).render(<App />);
```

`apps/seat/src/renderer/src/App.tsx` (the shell; Task 10 replaces it):
```tsx
import { useEffect, useState } from 'react';

declare global { interface Window { saakshi: { safeStorageCheck(): Promise<string> } } }

export function App() {
  const [safe, setSafe] = useState('…');
  useEffect(() => { window.saakshi.safeStorageCheck().then(setSafe, (e) => setSafe(String(e))); }, []);
  return (<main><h1>Saakshi seat — feasibility spike</h1><p>Origin: {location.origin}</p><p>safeStorage: {safe}</p></main>);
}
```

- [ ] **Step 5: Package, sign and launch from Finder**

Run: `cd apps/seat && pnpm typecheck && pnpm pack:mac`
Expected: tsc is clean and `ad-hoc signed: release/mac-arm64/Saakshi.app`.

Then, outside the sandbox (Launch Services is blocked inside it), run `open apps/seat/release/mac-arm64/Saakshi.app`.
- Expected: `Origin: app://seat` and `safeStorage: ok (first run)`. On a keychain prompt, click **Always Allow**.
- Quit and relaunch. Expected: `safeStorage: ok (decrypted previous run)`.
- Take a screenshot.

Then run `npx @electron/fuses read --app apps/seat/release/mac-arm64/Saakshi.app`.
Expected: RunAsNode, NodeOptions and CLI-inspect are Disabled; EmbeddedAsarIntegrityValidation and OnlyLoadAppFromAsar are Enabled.

- [ ] **Step 6: Hand back for review and commit** with the message `feat(seat): packaged Electron shell with app://, CSP, fuses, safeStorage`.

---

### Task 10: MediaPipe face count in the packaged app

**Files:**
- Replace: `apps/seat/scripts/copy-mediapipe.mjs`, `apps/seat/src/renderer/src/App.tsx`
- Create: `apps/seat/src/renderer/public/mediapipe/blaze_face_short_range.tflite` (committed)

**Interfaces:**
- Consumes: the Task 9 shell.
- Produces: `Faces: N` at 2 fps on the CPU.

- [ ] **Step 1: Fetch the model.** This is a download, so the **controller confirms with the user first**: `blaze_face_short_range.tflite`, from Google's MediaPipe model bucket, about 230 KB.

```bash
mkdir -p apps/seat/src/renderer/public/mediapipe
curl -fL -o apps/seat/src/renderer/public/mediapipe/blaze_face_short_range.tflite \
  https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/latest/blaze_face_short_range.tflite
shasum -a 256 apps/seat/src/renderer/public/mediapipe/blaze_face_short_range.tflite
```
Expected: a file of about 200–300 KB. Record the sha256 in the commit.

- [ ] **Step 2: Copy the wasm at build time**

`apps/seat/scripts/copy-mediapipe.mjs`:
```js
import { cpSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkg = dirname(fileURLToPath(import.meta.resolve('@mediapipe/tasks-vision')));
const dest = fileURLToPath(new URL('../src/renderer/public/mediapipe/wasm/', import.meta.url));
mkdirSync(dest, { recursive: true });
cpSync(join(pkg, 'wasm'), dest, { recursive: true });
console.log(`mediapipe wasm → ${dest}`);
```
Run: `cd apps/seat && pnpm copy-mediapipe && ls src/renderer/public/mediapipe/wasm`. Expected: `vision_wasm_internal.{js,wasm}` and possibly nosimd variants.

- [ ] **Step 3: Replace `App.tsx`**

```tsx
import { useEffect, useRef, useState } from 'react';
import { FaceDetector, FilesetResolver } from '@mediapipe/tasks-vision';

declare global { interface Window { saakshi: { safeStorageCheck(): Promise<string> } } }

export function App() {
  const video = useRef<HTMLVideoElement>(null);
  const [faces, setFaces] = useState<number | null>(null);
  const [status, setStatus] = useState('starting camera…');
  const [safe, setSafe] = useState('…');

  useEffect(() => { window.saakshi.safeStorageCheck().then(setSafe, (e) => setSafe(String(e))); }, []);

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
        setStatus('detecting at 2 fps');
        timer = window.setInterval(() => {
          if (v.readyState >= 2) setFaces(detector!.detectForVideo(v, performance.now()).detections.length);
        }, 500);
      } catch (e) {
        setStatus(`error: ${(e as Error).message}`);
      }
    })();
    return () => { clearInterval(timer); stream?.getTracks().forEach((t) => t.stop()); detector?.close(); };
  }, []);

  return (
    <main style={{ fontFamily: 'system-ui', padding: 24 }}>
      <h1>Saakshi seat — feasibility spike</h1>
      <video ref={video} muted playsInline width={320} height={240} style={{ background: '#111' }} />
      <p style={{ fontSize: 32 }}>Faces: {faces ?? '—'}</p>
      <p>Status: {status}</p>
      <p>safeStorage: {safe}</p>
      <p>Origin: {location.origin}</p>
    </main>
  );
}
```

- [ ] **Step 4: Package and verify from Finder**

Run: `cd apps/seat && pnpm pack:mac`, then (outside the sandbox) `open release/mac-arm64/Saakshi.app`.
- Expected: the camera prompt appears (allow it), and the status reads `detecting at 2 fps`.
- `Faces:` shows 1 with one face, 0 with the camera covered, and 2 with two people. Take screenshots of 0, 1 and 2.
- Check for CSP violations: run `release/mac-arm64/Saakshi.app/Contents/MacOS/Saakshi 2>&1 | grep -i "content security"`. Expected: no output.

If the video stays black, run `tccutil reset Camera in.saakshi.seat` and `sh scripts/adhoc-sign.sh`, then relaunch.

- [ ] **Step 5: Hand back for review and commit** with the message `feat(seat): MediaPipe face count over app:// (CPU, 2 fps)`, including the model sha256.

---

### Task 11: Probes and `--probe-selftest`

**Files:**
- Replace: `apps/seat/src/main/probes.ts`
- Create: `apps/seat/src/main/{probes-win,probe-parse}.ts`
- Test: `apps/seat/test/probe-parse.test.ts`

**Interfaces:**
- Consumes: the `--probe-selftest` handler from Task 9.
- Produces:
  - `probe-parse.ts`: `ProbeResult`, `BLOCKLIST`, `run(cmd, args, timeoutMs?)`, `probe(fn)`, `parseTasklistCsv`, `parsePs`, `blocklistHits`.
  - `probes.ts`: `Selftest`, `runSelftest()`.

- [ ] **Step 1: Write the failing test**

`apps/seat/test/probe-parse.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blocklistHits, parsePs, parseTasklistCsv, probe, run } from '../src/main/probe-parse.ts';

test('parses tasklist /FO CSV /NH output', () => {
  const csv = '"System Idle Process","0","Services","0","8 K"\r\n"AnyDesk.exe","4242","Console","1","12,345 K"\r\n';
  assert.deepEqual(parseTasklistCsv(csv), [{ name: 'System Idle Process', pid: 0 }, { name: 'AnyDesk.exe', pid: 4242 }]);
});

test('parses ps -axo pid=,comm= output (paths with spaces)', () => {
  const out = '    1 /sbin/launchd\n  812 /System/Library/CoreServices/RemoteManagement/screensharingd.bundle/Contents/MacOS/screensharingd\n 9001 /Applications/OBS.app/Contents/MacOS/OBS Studio\n';
  assert.deepEqual(parsePs(out).map((p) => p.pid), [1, 812, 9001]);
  assert.equal(parsePs(out)[2].name, '/Applications/OBS.app/Contents/MacOS/OBS Studio');
});

test('blocklist matches by lowercase basename without .exe', () => {
  assert.deepEqual(blocklistHits(['C:\\x\\AnyDesk.exe', '/usr/bin/zsh', 'obs64.exe', '/Applications/TeamViewer.app/Contents/MacOS/TeamViewer']), ['anydesk', 'obs64', 'teamviewer']);
});

test('a hanging probe returns unknown after its timeout', async () => {
  const t0 = Date.now();
  const r = await probe(() => run(process.execPath, ['-e', 'setTimeout(() => {}, 10000)'], 200));
  assert.equal(r.status, 'unknown');
  assert.ok(Date.now() - t0 < 3000);
});
```
Run: `cd apps/seat && node --test test/probe-parse.test.ts`. Expected: FAIL with `Cannot find module`.

- [ ] **Step 2: Implement `probe-parse.ts`**, then run the test and confirm it passes.

```ts
import { execFile } from 'node:child_process';

export type ProbeResult = { status: 'ok'; value: unknown } | { status: 'unknown'; error: string };

// ponytail: fixed spike list; Stage 5 moves it into the signed integrity policy with bundle IDs.
export const BLOCKLIST = ['anydesk', 'teamviewer', 'rustdesk', 'parsecd', 'remoting_host', 'vncserver', 'tvnserver', 'winvnc', 'obs', 'obs64', 'obs studio', 'cluely'];

export function run(cmd: string, args: string[], timeoutMs = 5000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: timeoutMs, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => (err ? reject(err) : resolve(stdout)));
  });
}

export async function probe(fn: () => unknown | Promise<unknown>): Promise<ProbeResult> {
  try { return { status: 'ok', value: await fn() }; } catch (e) { return { status: 'unknown', error: String((e as Error).message ?? e) }; }
}

export function parseTasklistCsv(csv: string): { name: string; pid: number }[] {
  return csv.split(/\r?\n/).filter(Boolean).map((line) => {
    const cols = [...line.matchAll(/"([^"]*)"/g)].map((m) => m[1]);
    return { name: cols[0], pid: Number(cols[1]) };
  });
}

export function parsePs(out: string): { name: string; pid: number }[] {
  return out.split('\n').map((l) => l.match(/^\s*(\d+)\s+(.+)$/)).filter((m): m is RegExpMatchArray => m !== null)
    .map((m) => ({ pid: Number(m[1]), name: m[2] }));
}

export function blocklistHits(names: string[]): string[] {
  const base = (n: string) => n.split(/[\\/]/).pop()!.toLowerCase().replace(/\.exe$/, '');
  return [...new Set(names.map(base).filter((b) => BLOCKLIST.includes(b)))];
}
```

- [ ] **Step 3: Windows probes (koffi, loaded only on win32)**

`apps/seat/src/main/probes-win.ts`:
```ts
import koffi from 'koffi';

const user32 = koffi.load('user32.dll');
const EnumWindowsProc = koffi.proto('bool __stdcall EnumWindowsProc(void *hwnd, intptr_t lParam)');
const EnumWindows = user32.func('bool __stdcall EnumWindows(EnumWindowsProc *cb, intptr_t lParam)');
const IsWindowVisible = user32.func('bool __stdcall IsWindowVisible(void *hwnd)');
const GetWindowDisplayAffinity = user32.func('bool __stdcall GetWindowDisplayAffinity(void *hwnd, _Out_ uint32_t *affinity)');
const GetWindowThreadProcessId = user32.func('uint32_t __stdcall GetWindowThreadProcessId(void *hwnd, _Out_ uint32_t *pid)');
const GetSystemMetrics = user32.func('int __stdcall GetSystemMetrics(int nIndex)');
const SM_REMOTESESSION = 0x1000;

export const remoteSession = (): boolean => GetSystemMetrics(SM_REMOTESESSION) !== 0;

/** Visible top-level windows of other processes whose display affinity excludes them from capture. */
export function captureExcludedWindows(): { visibleWindows: number; excluded: { pid: number; affinity: number }[] } {
  let visibleWindows = 0;
  const excluded: { pid: number; affinity: number }[] = [];
  EnumWindows((hwnd: unknown) => {
    if (!IsWindowVisible(hwnd)) return true;
    visibleWindows++;
    const aff = [0];
    if (GetWindowDisplayAffinity(hwnd, aff) && aff[0] !== 0) {
      const pid = [0];
      GetWindowThreadProcessId(hwnd, pid);
      if (pid[0] !== process.pid) excluded.push({ pid: pid[0], affinity: aff[0] });
    }
    return true;
  }, 0);
  return { visibleWindows, excluded };
}
```

- [ ] **Step 4: `probes.ts`**

```ts
import { join } from 'node:path';
import { blocklistHits, parsePs, parseTasklistCsv, probe, run, type ProbeResult } from './probe-parse.ts';

export interface Selftest { app: 'saakshi-seat'; platform: string; arch: string; electron: string; ok: boolean; ms: number; probes: Record<string, ProbeResult> }

async function winProbes(): Promise<Record<string, ProbeResult>> {
  const win = await import('./probes-win.ts');
  const tasklist = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tasklist.exe');
  return {
    remoteSession: await probe(() => win.remoteSession()),
    captureExcluded: await probe(() => win.captureExcludedWindows()),
    processes: await probe(async () => {
      const ps = parseTasklistCsv(await run(tasklist, ['/FO', 'CSV', '/NH']));
      return { count: ps.length, blocklistHits: blocklistHits(ps.map((p) => p.name)) };
    }),
  };
}

async function macProbes(): Promise<Record<string, ProbeResult>> {
  return {
    processes: await probe(async () => {
      const ps = parsePs(await run('/bin/ps', ['-axo', 'pid=,comm=']));
      return { count: ps.length, blocklistHits: blocklistHits(ps.map((p) => p.name)), screensharing: ps.some((p) => p.name.endsWith('/screensharingd')) };
    }),
    hvVmmPresent: await probe(async () => (await run('/usr/sbin/sysctl', ['-n', 'kern.hv_vmm_present'])).trim() === '1'),
  };
}

export async function runSelftest(): Promise<Selftest> {
  const t0 = Date.now();
  const probes = process.platform === 'win32' ? await winProbes() : process.platform === 'darwin' ? await macProbes() : {};
  const ok = Object.keys(probes).length > 0 && Object.values(probes).every((p) => p.status === 'ok');
  return { app: 'saakshi-seat', platform: process.platform, arch: process.arch, electron: process.versions.electron ?? '', ok, ms: Date.now() - t0, probes };
}
```

- [ ] **Step 5: Run the self-test from the packaged macOS app**

Run: `cd apps/seat && pnpm typecheck && pnpm pack:mac && release/mac-arm64/Saakshi.app/Contents/MacOS/Saakshi --probe-selftest --out $TMPDIR/probe.json; echo "exit $?"`
Expected: JSON with `"platform": "darwin"`, `"ok": true`, `processes.status: "ok"` and `hvVmmPresent.value: false`, then `exit 0`.

- [ ] **Step 6: Hand back for review and commit** with the message `feat(seat): integrity probes and --probe-selftest (koffi/tasklist, ps/sysctl)`.

---

### Task 12: Windows CI, GitHub repo, first green run

**Files:**
- Create: `.github/workflows/windows.yml`

**Interfaces:**
- Consumes: `pnpm -r test`, and the `pack:win` / `dist:win` scripts.
- Produces: the `probe-selftest` artifact on every run, and the NSIS installer on dispatch or tag.

- [ ] **Step 1: Write the workflow**

`.github/workflows/windows.yml`:
```yaml
name: windows
on:
  push:
    branches: [main]
    tags: ['v*']
    paths: ['apps/seat/**', 'packages/**', 'fixtures/**', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'package.json', '.github/workflows/windows.yml']
  pull_request:
    paths: ['apps/seat/**', 'packages/**', 'fixtures/**', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'package.json', '.github/workflows/windows.yml']
  workflow_dispatch:
concurrency:
  group: windows-${{ github.ref }}
  cancel-in-progress: true
jobs:
  windows:
    runs-on: windows-latest
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v5
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v5
        with: { node-version: 25, cache: pnpm }
      - uses: oven-sh/setup-bun@v2
      - run: pnpm install --frozen-lockfile
      - run: pnpm -r test
      - run: pnpm --filter @saakshi/seat pack:win
      - name: Probe self-test (packaged exe)
        shell: pwsh
        run: |
          $p = Start-Process -FilePath apps\seat\release\win-unpacked\Saakshi.exe -ArgumentList '--probe-selftest','--out',"$PWD\probe.json" -Wait -PassThru
          Get-Content probe.json
          if ($p.ExitCode -ne 0) { throw "probe self-test failed with exit code $($p.ExitCode)" }
      - uses: actions/upload-artifact@v4
        if: always()
        with: { name: probe-selftest, path: probe.json }
      - if: github.event_name == 'workflow_dispatch' || startsWith(github.ref, 'refs/tags/')
        run: pnpm --filter @saakshi/seat dist:win
      - if: github.event_name == 'workflow_dispatch' || startsWith(github.ref, 'refs/tags/')
        uses: actions/upload-artifact@v4
        with: { name: saakshi-setup, path: apps/seat/release/*.exe }
```

- [ ] **Step 2: Commit, create the repo and push.** This needs the user's `gh auth login` first.

```bash
git add .github/workflows/windows.yml
git commit -m "ci: Windows tests, packaged exe probe self-test, NSIS on dispatch"
gh auth status
gh repo create saakshi --public --source . --push --description "Saakshi (साक्षी): a resilient, provable CBT exam ecosystem — hackathon Challenge 6"
```

- [ ] **Step 3: Watch the run and fetch the artifact**

```bash
gh run watch --exit-status $(gh run list --workflow windows --limit 1 --json databaseId -q '.[0].databaseId')
gh run download --name probe-selftest --dir $TMPDIR/ci && cat $TMPDIR/ci/probe.json
```
Expected: the run is green, and `probe.json` shows `"platform": "win32"` and `"ok": true`, with `remoteSession`, `captureExcluded` and `processes` all at status `ok`.

On failure, read `gh run view --log-failed`, fix and push again. Typical causes are a missing `allowBuilds` entry, a koffi path or the pwsh quoting.

---

### Task 13: Stage 0 exit check and demo

- [ ] **Step 1: Run the exit check**

```bash
pnpm -r test && pnpm -r typecheck
(cd analytics && uv run pytest -q)
node tools/tamper-lab.ts
```
Expected:
- Everything passes under node and bun, including the 1,000 flips and the 1,000 native→noble signatures.
- `2 passed`.
- The tamper lab ends with `located exactly`.

- [ ] **Step 2: Send the evidence to the user**
  - Screenshots of the installed macOS app at 0, 1 and 2 faces, launched from Finder.
  - The CI run link and the Windows `probe.json`.
  - The tamper-lab transcript.

- [ ] **Step 3: Update memory and ask for approval.** Record in `saakshi-hackathon-plan.md` that Stage 0 is done, with the repo URL and any deviations. Then ask for approval to start Stage 1.
