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
