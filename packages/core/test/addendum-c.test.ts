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
