import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from '../src/bytes.ts';
import { kcf } from '../src/protocol.ts';
import { combineBundle, newOfflineCode, splitBundle, unwrapForCentre, wrapForCentre } from '../src/custody.ts';

const bundle = { kF1: randomBytes(32), kF2: randomBytes(32), L: randomBytes(32) };

test('any 2 of 3 custodian shares rebuild the bundle; 1 share does not', async () => {
  const s = await splitBundle(bundle);
  assert.equal(s.length, 3);
  for (const [a, b] of [[0, 1], [0, 2], [1, 2]]) assert.deepEqual(await combineBundle([s[a], s[b]]), bundle);
  await assert.rejects(combineBundle([s[0]]), /2 of 3/);
});

test('a corrupted share is caught by the published key commitment', async () => {
  const s = await splitBundle(bundle);
  const bad = s[1].slice(); bad[3] ^= 1;
  const got = await combineBundle([s[0], bad]);
  assert.notEqual(kcf(got.kF1), kcf(bundle.kF1));
});

test('offline code unwraps only its own centre and shift, and tolerates phone dictation', () => {
  const code = newOfflineCode();
  assert.match(code, /^[0-9A-Z*~$=]{17}$/);
  const c = { exam: 'DEMO-2026', shift: 'S1', centre: 'CEN042' };
  const w = wrapForCentre(code, c, bundle.kF1, bundle.kF2);
  const got = unwrapForCentre(code.toLowerCase().replace(/(.{4})/g, '$1-'), c, w);
  assert.equal(kcf(got.kF1), kcf(bundle.kF1));
  assert.equal(kcf(got.kF2), kcf(bundle.kF2));
  assert.throws(() => unwrapForCentre(code, { ...c, centre: 'CEN043' }, w));
  assert.throws(() => unwrapForCentre(code, { ...c, shift: 'S2' }, w));
  const typo = code.slice(0, 5) + (code[5] === '0' ? '1' : '0') + code.slice(6);
  assert.throws(() => unwrapForCentre(typo, c, w));
});
