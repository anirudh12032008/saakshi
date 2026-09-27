import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { enrolProblem, GATE, shortHex } from '../src/renderer/src/enrol-state.ts';

test('check-in form: 6 digits, typed twice the same, and the gate operator named', () => {
  assert.equal(enrolProblem('12345', '12345', 'OP'), 'pinDigits');
  assert.equal(enrolProblem('12a456', '12a456', 'OP'), 'pinDigits');
  assert.equal(enrolProblem('123456', '123465', 'OP'), 'pinMatch');
  assert.equal(enrolProblem('123456', '123456', '  '), 'operator');
  assert.equal(enrolProblem('012345', '012345', 'GATE-42-OP7'), '');
  assert.deepEqual(GATE, ['aadhaar-face', 'aadhaar-fingerprint', 'id-document']);
  assert.equal(shortHex('6065a397d8b6299bbacba68453af1f99'), '6065 a397 d8b6 299b');
  assert.equal(shortHex(undefined), '');
});

test('the renderer never bundles the plaintext paper', () => {
  const src = readFileSync(new URL('../src/renderer/src/App.tsx', import.meta.url), 'utf8');
  assert.equal(/paper\/bank\.json|paper\/forms\.json/.test(src), false);
});
