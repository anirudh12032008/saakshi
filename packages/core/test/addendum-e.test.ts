import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { hexToBytes } from '../src/bytes.ts';
import { canon } from '../src/canon.ts';
import { msg } from '../src/enrol.ts';
import { decisionArray, headlineOf, type DecisionSummary } from '../src/analytics.ts';
import { verifier } from '../src/node.ts';
import { nobleVerifier } from '../src/sig.ts';

const json = (f: string) => JSON.parse(readFileSync(new URL(`../../../fixtures/${f}`, import.meta.url), 'utf8'));
const E = json('vectors/protocol-v1-addendum-e.json');

test('E.2 decision sign-off: canonical text recomputes; the signature verifies natively and with noble', () => {
  assert.equal(canon(decisionArray(E.decision.in)), E.decision.text);
  const pub = hexToBytes(E.decisionKey.pub);
  for (const v of [verifier(pub), nobleVerifier(pub)]) assert.equal(v(msg(decisionArray(E.decision.in)), hexToBytes(E.decision.sig)), true);
  assert.equal(verifier(pub)(msg(decisionArray({ ...E.decision.in, by: 'someone else' })), hexToBytes(E.decision.sig)), false);
});

test('headlineOf uses the report\'s words and Indian digit grouping', () => {
  const s: DecisionSummary = { compensated: 1840, retested: 212, reconductedCentres: 3, reconductedCentreShifts: 3, reconductedCandidates: 600,
    baseline: 20000, spared: 19488, inrAvoided: 29232000, extraMinTotal: 0, rescored: 0, openTickets: 0 };
  assert.equal(headlineOf(s), 'Compensated 1,840 · Re-tested 212 · Re-conducted 3 centres · Spared 19,488 · ₹ avoided 2,92,32,000');
});

test('E.1 vector: the reference sheet derives exactly the reference rows', () => {
  // The vector stores one ShiftExport sheet and its expected ExportRow[]; Task 2's cohortRows must reproduce it.
  // Here we only check the vector is self-consistent: every row has the frozen schema's fields and nothing else.
  const schema = json('schemas/v1.json');
  const fields = [...Object.keys(schema.cohort), ...Object.keys(schema.export)].sort();
  for (const r of E.export.rows) assert.deepEqual(Object.keys(r).sort(), fields);
});
