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
