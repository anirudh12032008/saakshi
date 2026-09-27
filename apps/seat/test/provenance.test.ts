import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyProv, provClick, provKey, provMove, provSummary } from '../src/renderer/src/provenance.ts';

test('empty tracker summarizes to zero counts and lastMoveMs -1 (never moved)', () => {
  assert.deepEqual(provSummary(emptyProv(), 1000), { moves: 0, pathPx: 0, clicks: 0, keys: 0, untrusted: 0, lastMoveMs: -1 });
});

test('moves accumulate path length and recency', () => {
  let s = emptyProv();
  s = provMove(s, 0, 0, 100, true);   // first move: no delta counted (no prior point)
  s = provMove(s, 3, 4, 200, true);   // 3-4-5 triangle
  const sum = provSummary(s, 500);
  assert.equal(sum.moves, 2);
  assert.equal(sum.pathPx, 5);
  assert.equal(sum.lastMoveMs, 300);
});

test('clicks, keys and untrusted events are counted', () => {
  let s = emptyProv();
  s = provClick(s, true);
  s = provClick(s, false);
  s = provKey(s, true);
  s = provMove(s, 10, 10, 10, false);
  const sum = provSummary(s, 10);
  assert.equal(sum.clicks, 2);
  assert.equal(sum.keys, 1);
  assert.equal(sum.moves, 1);
  assert.equal(sum.untrusted, 2);   // one untrusted click, one untrusted move
});

test('state updates are immutable (no shared mutation between snapshots)', () => {
  const a = emptyProv();
  const b = provClick(a, true);
  assert.equal(a.clicks, 0);
  assert.equal(b.clicks, 1);
});
