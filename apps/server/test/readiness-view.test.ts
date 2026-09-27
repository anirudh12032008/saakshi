import { expect, test } from 'bun:test';
import type { SignedReadiness } from '@saakshi/core/integrity';
import { readinessBoard, seatLine } from '../src/readiness-view.ts';

const sr = (cand: string, verdict: SignedReadiness['r']['verdict'], at = 900, names: string[] = []): SignedReadiness => ({ sig: '0'.repeat(128),
  r: { exam: 'E', shift: 'S1', attempt: 1, cand, seatId: `CEN042-S${cand.slice(-2)}`, keyEpoch: 1, at, verdict,
    findings: names.length ? [{ code: 'blocklisted', level: 'block', detail: '', names }] : [] } });

test('a centre is as bad as its worst fresh seat; missing and stale seats are counted, not hidden', () => {
  const c = readinessBoard({ at: 1_000, centre: 'CEN042', roster: ['C0001', 'C0002', 'C0003', 'C0004'], staleMs: 60_000,
    seats: [sr('C0001', 'block', 900, ['AnyDesk', 'overlay-sim']), sr('C0002', 'amber'), sr('C0003', 'green', -100_000)] });
  expect(c.verdict).toBe('block');
  expect(c.counts).toEqual({ green: 0, amber: 1, review: 1, block: 1 });   // the stale green counts as review
  expect(c.missing).toBe(1);
  expect(seatLine(c.seats[0])).toBe('C0001 · CEN042-S01 · Blocked — AnyDesk, overlay-sim');
});

test('amber only: Centre 42 is amber', () => {
  expect(readinessBoard({ at: 1_000, centre: 'CEN042', roster: ['C0001', 'C0002'], staleMs: 60_000, seats: [sr('C0001', 'green'), sr('C0002', 'amber')] }).verdict).toBe('amber');
});
