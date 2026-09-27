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
