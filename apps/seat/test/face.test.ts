import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FaceMonitor } from '../src/main/face.ts';

const mk = (expected = 1) => new FaceMonitor({ expected, noFaceMs: 10_000, window: 5, over: 3 });
const feed = (m: FaceMonitor, counts: number[], t0 = 0, every = 500) => counts.map((faces, i) => m.sample({ faces, at: t0 + i * every, thumb: faces === 1 ? undefined : `T${i}` })).filter(Boolean);

test('Review Focus #4: 9.5 s without a face is nothing; 10 s is one flag; a whole episode is one flag', () => {
  assert.equal(feed(mk(), Array(20).fill(0)).length, 0);                       // 0 … 9.5 s
  const flags = feed(mk(), Array(60).fill(0));                                   // 30 s away
  assert.equal(flags.length, 1);
  assert.deepEqual({ ...flags[0], thumb: undefined }, { code: 'face-none', at: 10_000, faces: 0, expected: 1, thumb: undefined });
  assert.equal(flags[0]!.thumb, 'T20');                                        // the latest frame of the episode
  const m = mk();
  assert.equal(feed(m, [...Array(21).fill(0), 1, ...Array(21).fill(0)]).length, 2);   // back, then gone again: a new episode
});

test('extra faces: 3 of the last 5 samples, once per episode; one stray sample does nothing', () => {
  assert.equal(feed(mk(), [1, 2, 1, 1, 1, 1, 2, 1]).length, 0);
  const f = feed(mk(), [1, 2, 2, 1, 2, 2, 2, 2]);
  assert.equal(f.length, 1);
  assert.equal(f[0]!.code, 'face-extra');
  assert.equal(f[0]!.faces, 2);
});

test('a scribe seat (expected 2) flags only at 3 faces', () => {
  assert.equal(feed(mk(2), Array(10).fill(2)).length, 0);
  assert.equal(feed(mk(2), Array(10).fill(3))[0]!.expected, 2);
});

test('a flag without any frame still goes out with no thumb', () => {
  const m = mk();
  let flag;
  for (let i = 0; i <= 20; i++) flag = m.sample({ faces: 0, at: i * 500 }) ?? flag;
  assert.equal(flag!.thumb, undefined);
});
