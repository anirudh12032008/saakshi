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
