import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ItemState, SyncView } from '../src/shared/ipc.ts';
import { bannerOf, clearResponse, displayState, fmtRemaining, legendCounts, markAndNext, mmss, saveAndNext, slipCode, tickOf, visitAction } from '../src/renderer/src/exam-state.ts';
import { T } from '../src/renderer/src/i18n.ts';

const v: SyncView = { local: 10, relay: 7, cell: 4, online: true, error: '' };
const A = (answer: string, seq = 3): ItemState => ({ state: 'A', answer, seq });

test('ticks: ✓ local, ✓✓ relay, blue ✓✓ cell', () => {
  assert.deepEqual([0, 3, 4, 5, 7, 8, 10].map((s) => tickOf(s, v)), ['none', 'cell', 'cell', 'relay', 'relay', 'local', 'local']);
});

test('palette state: saved state wins, else NA if visited, else NV', () => {
  const items = { I01: A('B'), I02: { state: 'MR', answer: '', seq: 4 } as ItemState };
  const visited = new Set(['I01', 'I03']);
  assert.deepEqual(['I01', 'I02', 'I03', 'I04'].map((i) => displayState(items, visited, i)), ['A', 'MR', 'NA', 'NV']);
  assert.deepEqual(legendCounts(['I01', 'I02', 'I03', 'I04'], items, visited), { NV: 1, NA: 1, A: 1, MR: 1, AMR: 0 });
});

test('NTA buttons map to journal actions, and to nothing when nothing changes', () => {
  assert.deepEqual(saveAndNext('I01', 'C', undefined, 5), { kind: 'answer', item: 'I01', state: 'A', answer: 'C', dwellMs: 5 });
  assert.equal(saveAndNext('I01', 'C', A('C'), 5), null);
  assert.deepEqual(saveAndNext('I01', 'C', { state: 'AMR', answer: 'C', seq: 2 }, 5)?.state, 'A');   // unmarks
  assert.equal(saveAndNext('I01', '', undefined, 5), null);                                           // navigation only
  assert.deepEqual(markAndNext('I01', '', undefined, 5), { kind: 'mark', item: 'I01', state: 'MR', answer: '', dwellMs: 5 });
  assert.deepEqual(markAndNext('I01', 'B', A('B'), 5)?.state, 'AMR');
  assert.equal(markAndNext('I01', 'B', { state: 'AMR', answer: 'B', seq: 2 }, 5), null);
  assert.deepEqual(clearResponse('I01', A('D'), 5), { kind: 'clear', item: 'I01', state: 'NA', answer: '', dwellMs: 5 });
  assert.equal(clearResponse('I01', undefined, 5), null);
  assert.equal(clearResponse('I01', { state: 'MR', answer: '', seq: 2 }, 5), null);
});

test('timer text clamps at zero and switches to h:mm:ss', () => {
  assert.deepEqual([-5, 0, 999, 61_000, 30 * 60_000, 3_600_000 + 1_000].map(fmtRemaining), ['00:00', '00:00', '00:01', '01:01', '30:00', '1:00:01']);
});

test('EN and HI catalogues have the same keys, no empty strings, and HI is Devanagari', () => {
  const flat = (o: object, p = ''): [string, string][] => Object.entries(o).flatMap(([k, x]) => (typeof x === 'string' ? [[p + k, x] as [string, string]] : flat(x, `${p}${k}.`)));
  const en = flat(T.en), hi = flat(T.hi);
  assert.deepEqual(hi.map(([k]) => k), en.map(([k]) => k));
  for (const [k, s] of [...en, ...hi]) if (k !== 'tick.none') assert.ok(s.length > 0, k);
  for (const k of ['saveNext', 'markNext', 'clear', 'timeUp']) assert.match(hi.find(([x]) => x === k)![1], /[ऀ-ॿ]/, k);
});

test('the first display of an item with no journaled state is journaled as visited (clear, NA)', () => {
  assert.deepEqual(visitAction('I04', undefined), { kind: 'clear', item: 'I04', state: 'NA', answer: '', dwellMs: 0 });
  assert.equal(visitAction('I04', { state: 'NA', answer: '', seq: 3 }), null);
  assert.equal(visitAction('I04', A('B')), null);
});

test('the slip code is grouped in fours for copying by hand', () => {
  assert.equal(slipCode('N5JY1E59BR0FGNVQW'), 'N5JY-1E59-BR0F-GNVQ-W');
});

test('the in-exam banner: paused beats everything; a rebuilding server carries its ETA; a down link or an offline seat; a slow link; else none', () => {
  const sync = { local: 46, relay: 46, cell: 31, online: true, error: '' };
  assert.deepEqual(bannerOf(undefined, sync, true), { kind: 'paused' });
  assert.deepEqual(bannerOf({ link: 'up', cell: 'REBUILDING', etaMs: 90_000, at: 0 }, sync, false), { kind: 'cell', etaMs: 90_000 });
  assert.deepEqual(bannerOf({ link: 'down', cell: 'unreachable', at: 0 }, sync, false), { kind: 'link' });
  assert.deepEqual(bannerOf({ link: 'up', cell: 'LIVE', at: 0 }, { ...sync, online: false }, false), { kind: 'link' });
  assert.deepEqual(bannerOf({ link: 'degraded', cell: 'LIVE', at: 0 }, sync, false), { kind: 'slow' });
  assert.equal(bannerOf({ link: 'up', cell: 'LIVE', at: 0 }, sync, false), null);
  assert.equal(mmss(108_000), '1:48');
});

test('the Stage 4 strings exist in EN and HI and read the tick counts', () => {
  for (const l of ['en', 'hi'] as const) {
    assert.match(T[l].preserved(46, 46, 31), /46.*46.*31/);
    assert.match(T[l].credited('1:48', 'INV-42-A'), /1:48.*INV-42-A/);
    assert.ok(T[l].banner.cell && T[l].banner.link && T[l].banner.slow && T[l].banner.paused && T[l].moveTitle && T[l].movedTitle);
  }
  assert.match(T.hi.movingTitle, /[ऀ-ॿ]/);
});

test('every new string exists in both languages; the Hindi count puts the total first', () => {
  for (const k of Object.keys(T.en) as (keyof typeof T.en)[]) assert.ok(T.hi[k], `hi lacks ${k}`);
  assert.equal(T.en.of(5, 20), '5 of 20');
  assert.equal(T.hi.of(5, 20), '20 में से 5');
  assert.equal(T.en.cameraTest, 'Camera off (test mode)');
});
