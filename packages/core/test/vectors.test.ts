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
