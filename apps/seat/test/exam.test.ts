import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cellKey, DEV_EXAM, devSeat, type KeysFile } from '@saakshi/core/dev';
import { parseSignedLine } from '@saakshi/core/journal';
import { openBody } from '@saakshi/core/node';
import { fromB64 } from '@saakshi/core/wire';
import { ExamSession, IDLE_MS } from '../src/main/exam.ts';
import type { Wrapper } from '../src/main/journal-store.ts';

const keys = JSON.parse(readFileSync(new URL('../../../fixtures/keys.json', import.meta.url), 'utf8')) as KeysFile;
const cell = cellKey(keys, 'cell-1');
const wrap: Wrapper = { encryptString: (s) => Buffer.from('W' + s), decryptString: (b) => b.toString().slice(1) };
const D = 30 * 60_000;
function session(dir: string, clock: () => number): ExamSession {
  return new ExamSession({ dir, ctx: { ...DEV_EXAM, cand: 'C0001' }, keyEpoch: 1, seat: devSeat(keys, 'C0001')!, cellPub: cell.pub, wrap, durationMs: D, items: ['I01', 'I02', 'I03'], clock });
}
const act = (kind: 'answer' | 'mark' | 'clear', item: string, state: 'A' | 'MR' | 'AMR' | 'NA', answer: string) => ({ kind, item, state, answer, dwellMs: 1234 });

test('start, answer, mark and clear journal sealed entries in order', () => {
  const dir = mkdtempSync(join(tmpdir(), 'saakshi-exam-'));
  let t = 0;
  const s = session(dir, () => t);
  assert.equal(s.started, false);
  assert.deepEqual(s.start(), { ok: true, seq: 1, activeMs: 0 });
  t = 5_000; assert.deepEqual(s.act(act('answer', 'I01', 'A', 'D')), { ok: true, seq: 2, activeMs: 5_000 });
  t = 9_000; assert.equal((s.act(act('mark', 'I02', 'AMR', 'B')) as { seq: number }).seq, 3);
  t = 12_000; assert.equal((s.act(act('clear', 'I01', 'NA', '')) as { seq: number }).seq, 4);
  assert.deepEqual(s.items(), { I01: { state: 'NA', answer: '', seq: 4 }, I02: { state: 'AMR', answer: 'B', seq: 3 } });
  const [e] = s.entriesAfter(2, 1);
  const p = parseSignedLine(e.line);
  if (!p.ok) throw new Error(p.detail);
  assert.equal(p.header.kind, 'mark');
  assert.equal(p.header.activeMs, 9_000);
  assert.deepEqual(openBody(cell.priv, { ...s.ctx, seq: 3 }, fromB64(e.env), p.header.bodyCommit).body, { item: 'I02', state: 'AMR', answer: 'B', meta: [1234, []] });
  assert.equal(s.hashAt(3), s.journal.headers[3].prev);
  s.close();
  rmSync(dir, { recursive: true });
});

test('resume: answers come back from the journal and activeMs continues from the last entry, never backwards', () => {
  const dir = mkdtempSync(join(tmpdir(), 'saakshi-exam-'));
  let t = 1_000;
  const a = session(dir, () => t);
  a.start();
  t = 61_000; a.act(act('answer', 'I03', 'A', 'C'));
  t = 90_000;                                        // crash: 29 s after the last entry are not charged
  a.close();
  t = 0;                                             // new process, new monotonic clock
  const b = session(dir, () => t);
  assert.equal(b.started, true);
  assert.deepEqual(b.items(), { I03: { state: 'A', answer: 'C', seq: 2 } });
  assert.equal(b.activeMs(), 60_000);
  t = 10_000; b.act(act('answer', 'I01', 'A', 'A'));
  const hs = b.journal.headers;
  assert.equal(hs[2].activeMs, 70_000);
  assert.ok(hs[2].tMonoMs >= hs[1].tMonoMs);
  assert.equal(b.remainingMs(), D - 70_000);
  b.close();
  rmSync(dir, { recursive: true });
});

test('actions outside the NTA rules, before start or after time is up are refused', () => {
  const dir = mkdtempSync(join(tmpdir(), 'saakshi-exam-'));
  let t = 0;
  const s = session(dir, () => t);
  assert.deepEqual(s.act(act('answer', 'I01', 'A', 'B')), { ok: false, error: 'exam not started' });
  s.start();
  for (const bad of [act('answer', 'I99', 'A', 'B'), act('answer', 'I01', 'A', 'E'), act('answer', 'I01', 'MR', ''), act('mark', 'I01', 'MR', 'B'),
    act('mark', 'I01', 'AMR', ''), act('clear', 'I01', 'NA', 'A'), { ...act('answer', 'I01', 'A', 'B'), dwellMs: Number.NaN }])
    assert.equal(s.act(bad).ok, false, JSON.stringify(bad));
  t = D + 1;
  assert.deepEqual(s.act(act('answer', 'I01', 'A', 'B')), { ok: false, error: 'time is up' });
  assert.equal(s.head(), 1);
  s.close();
  rmSync(dir, { recursive: true });
});

test('an idle entry is journaled after 60 s without one, and not before', () => {
  const dir = mkdtempSync(join(tmpdir(), 'saakshi-exam-'));
  let t = 0;
  const s = session(dir, () => t);
  s.tick();
  assert.equal(s.head(), 0);
  s.start();
  t = IDLE_MS - 1; s.tick();
  assert.equal(s.head(), 1);
  t = IDLE_MS; s.tick();
  assert.equal(s.head(), 2);
  assert.equal(s.journal.headers[1].kind, 'idle');
  assert.equal(s.journal.headers[1].activeMs, IDLE_MS);
  s.close();
  rmSync(dir, { recursive: true });
});
