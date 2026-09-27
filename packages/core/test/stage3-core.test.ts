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
