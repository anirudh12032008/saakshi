import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fromB64, parseSyncReq, streamKey, toB64 } from '../src/wire.ts';

const hello = { exam: 'DEMO-2026', shift: 'S1', attempt: 1, cand: 'C0001', head: 3 };

test('parseSyncReq keeps exactly the contract fields', () => {
  const r = parseSyncReq({ entries: [{ line: '["signed"]', env: 'AAAA', extra: 1 }], streams: [{ ...hello, x: 2 }], junk: true });
  assert.deepEqual(r, { entries: [{ line: '["signed"]', env: 'AAAA' }], streams: [hello] });
  assert.deepEqual(parseSyncReq({ entries: [], streams: [], replay: true, done: true }), { entries: [], streams: [], replay: true, done: true });
  assert.deepEqual(parseSyncReq({ entries: [] }), { entries: [], streams: [] });
});

test('parseSyncReq rejects every malformed shape', () => {
  const bad: unknown[] = [
    null, [], 'x', { entries: 'x' }, { entries: Array(501).fill({ line: 'a', env: '' }) },
    { entries: [{ line: 1, env: '' }] }, { entries: [{ line: 'a', env: 'abc' }] }, { entries: [{ line: 'a', env: '!!!!' }] },
    { entries: [{ line: 'x'.repeat(4097), env: '' }] },
    { entries: [], streams: [{ ...hello, head: -1 }] }, { entries: [], streams: [{ ...hello, attempt: 1.5 }] },
    { entries: [], streams: [{ ...hello, cand: '' }] }, { entries: [], streams: [{ ...hello, exam: 'x'.repeat(65) }] },
    { entries: [], replay: false }, { entries: [], done: true },
  ];
  for (const b of bad) assert.throws(() => parseSyncReq(b), /sync:/, JSON.stringify(b)?.slice(0, 80));
});

test('base64 round-trips and rejects non-base64', () => {
  const b = Uint8Array.from({ length: 200 }, (_, i) => i);
  assert.deepEqual(fromB64(toB64(b)), b);
  assert.deepEqual(fromB64(toB64(b.subarray(10, 20))), b.subarray(10, 20));
  for (const s of ['abc', 'ab$=', 'a===']) assert.throws(() => fromB64(s), /base64/, s);
});

test('streamKey separates fields unambiguously', () => {
  assert.notEqual(streamKey({ exam: 'a', shift: 'b|c', attempt: 1, cand: 'd' }), streamKey({ exam: 'a|b', shift: 'c', attempt: 1, cand: 'd' }));
});
