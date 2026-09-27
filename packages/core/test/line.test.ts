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
