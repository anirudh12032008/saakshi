import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cellKey, DEV_EXAM, devPseud, devSeat, type KeysFile } from '@saakshi/core/dev';
import { responsesOf } from '@saakshi/core/log';
import { finalHash } from '@saakshi/core/protocol';
import { ExamSession, type Restore } from '../src/main/exam.ts';
import type { Wrapper } from '../src/main/journal-store.ts';

const keys = JSON.parse(readFileSync(new URL('../../../fixtures/keys.json', import.meta.url), 'utf8')) as KeysFile;
const cell = cellKey(keys, 'cell-1');
const wrap: Wrapper = { encryptString: (s) => Buffer.from('W' + s), decryptString: (b) => b.toString().slice(1) };
const items = ['I01', 'I02', 'I03'], ctx = { ...DEV_EXAM, cand: 'C0001' };
const answer = (item: string, a: string) => ({ kind: 'answer' as const, item, state: 'A' as const, answer: a, dwellMs: 1 });
function mk(dir: string, clock: () => number, o: { restore?: Restore; wall?: () => number } = {}): ExamSession {
  return new ExamSession({ dir, ctx, keyEpoch: o.restore ? 2 : 1, seat: devSeat(keys, o.restore ? 'C0002' : 'C0001')!, cellPub: cell.pub, wrap,
    durationMs: 30 * 60_000, items, form: 'F1', pseud: devPseud('C0001'), clock, wall: o.wall, restore: o.restore });
}

test('a moved seat continues the chain from the grant: a handover entry first, the restored answers in its palette, one receipt over both', () => {
  const dir = mkdtempSync(join(tmpdir(), 'saakshi-move-'));
  let t = 0;
  const head = 'e'.repeat(64);
  const restore: Restore = { seq: 5, head, activeMs: 50_000, responses: [['I01', 'A', 'B'], ['I02', 'NA', '']], via: 'pin', creditedMs: 108_000 };
  const s = mk(dir, () => t, { restore });
  assert.deepEqual([s.started, s.resumed, s.journal.head, s.journal.base], [true, false, 6, 5]);
  const h = s.journal.headers[0];
  assert.deepEqual([h.seq, h.keyEpoch, h.kind, h.prev, h.activeMs], [6, 2, 'handover', head, 50_000]);
  assert.deepEqual(s.journal.recs[0].body.meta, ['pin', 5, 108_000]);
  assert.deepEqual(s.items(), { I01: { state: 'A', answer: 'B', seq: 5 }, I02: { state: 'NA', answer: '', seq: 5 } });
  assert.equal(s.hashAt(5), head);
  t = 10_000;
  assert.deepEqual(s.act(answer('I03', 'C')), { ok: true, seq: 7, activeMs: 60_000 });
  assert.deepEqual([s.entriesAfter(5, 10).length, s.entriesAfter(6, 10).length, s.entriesAfter(0, 10).length], [2, 1, 2]);
  const r = s.submit();
  if (!r.ok) throw new Error(r.error);
  const rs = responsesOf(items, [{ item: 'I01', state: 'A', answer: 'B', meta: [] }, { item: 'I02', state: 'NA', answer: '', meta: [] }, { item: 'I03', state: 'A', answer: 'C', meta: [1, []] }]);
  assert.deepEqual([r.receipt.seq, r.receipt.finalHash, r.receipt.attempted, r.receipt.answered], [8, finalHash(ctx, 'F1', rs), 3, 2]);
  s.close();
  const again = mk(dir, () => t, { restore });                                        // a restart: no second handover entry, the same receipt
  assert.deepEqual([again.resumed, again.journal.head, again.journal.headers.filter((x) => x.kind === 'handover').length], [true, 8, 1]);
  assert.deepEqual(again.receipt(), r.receipt);
  again.close();
  assert.throws(() => mk(dir, () => t, { restore: { ...restore, head: 'f'.repeat(64) } }), /chain broken/);   // not the head it continued from
  rmSync(dir, { recursive: true, force: true });
});

test('Review Focus #4: suspend freezes activeMs; resume journals a gap with the wall pause; restart journals a restart gap', () => {
  const dir = mkdtempSync(join(tmpdir(), 'saakshi-gap-'));
  let t = 0, w = 1_790_000_000_000;
  const s = mk(dir, () => t, { wall: () => w });
  s.pause('suspend');                                                                 // before the unlock: nothing to pause
  assert.equal(s.paused, false);
  s.start();
  t = 10_000;
  s.pause('suspend');
  t += 125_000; w += 125_000;
  assert.deepEqual([s.paused, s.activeMs()], [true, 10_000]);
  assert.deepEqual(s.act(answer('I01', 'A')), { ok: false, error: 'the exam is paused' });
  assert.equal(s.resume(), 2);
  assert.deepEqual([s.journal.headers[1].kind, s.journal.headers[1].activeMs, s.journal.recs[1].body.meta], ['gap', 10_000, ['suspend', 125_000]]);
  t += 5_000;
  assert.equal(s.activeMs(), 15_000);
  assert.equal(s.resume(), undefined);
  s.close();
  const r = mk(dir, () => t, { wall: () => w });
  assert.equal(r.resumed, true);
  assert.equal(r.restartGap(), 3);
  assert.deepEqual(r.journal.recs[2].body.meta, ['restart', 0]);
  r.submit();
  assert.equal(r.restartGap(), undefined);                                            // never after the submit
  r.close();
  rmSync(dir, { recursive: true, force: true });
});
