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
