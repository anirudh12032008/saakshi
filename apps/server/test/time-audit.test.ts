import { expect, test } from 'bun:test';
import { randomBytes, toHex } from '@saakshi/core/bytes';
import { signedLine } from '@saakshi/core/journal';
import { newKeyPair, signer } from '@saakshi/core/node';
import { OPS } from '@saakshi/core/ops';
import { bodyArray, bodyCommit, entryHash, genesisPrev, type Body, type Header, type Kind } from '@saakshi/core/protocol';
import type { ResponseSheet } from '@saakshi/core/sheet';
import { timeAudit } from '../src/time-audit.ts';

const ctx = { exam: 'DEMO-2026', shift: 'S1', attempt: 1, cand: 'C0001' };
const form = ['I01', 'I02', 'I03', 'I04'];
const E: Body = { item: '', state: '', answer: '', meta: [] };
const ans = (item: string, answer: string): Body => ({ item, state: 'A', answer, meta: [1000, []] });
type Step = { kind: Kind; active: number; rx: number; body?: Body; epoch?: number };
/** A chain with chosen activeMs and relay rxWall per entry (the signatures are real; the audit does not need them). */
function sheet(steps: Step[]): ResponseSheet {
  const sign = signer(newKeyPair());
  let prev = genesisPrev(ctx);
  const entries = steps.map((s, i) => {
    const salt = randomBytes(16), body = s.body ?? E;
    const h: Header = { ...ctx, keyEpoch: s.epoch ?? 1, seq: i + 1, prev, kind: s.kind, tMonoMs: s.active, activeMs: s.active, bodyCommit: bodyCommit(salt, body) };
    prev = toHex(entryHash(h));
    return { line: signedLine(h, sign), salt: toHex(salt), body: bodyArray(body), rx: [s.rx, s.rx + 5] as [number, number] };
  });
  return { ctx, form: 'F1', pseud: '7'.repeat(64), keys: [], entries };
}
const T0 = 1_790_000_000_000;

test('an honest exam: wall time equals active time, no gaps, no flags', () => {
  const r = timeAudit(sheet([{ kind: 'unlock', active: 0, rx: T0 }, { kind: 'answer', active: 30_000, rx: T0 + 30_000, body: ans('I01', 'B') }, { kind: 'answer', active: 60_000, rx: T0 + 60_400, body: ans('I02', 'C') }]), form, [], OPS);
  expect(r).toEqual({ cand: 'C0001', wallMs: 60_400, activeMs: 60_000, unaccountedMs: 400, gaps: [], creditedMs: 0, flags: [], changedAfterMove: [] });
});

test('Review Focus #4: credit is measured by rxWall, capped at 30 min; two gaps flag review; unapproved gaps are pending', () => {
  const steps: Step[] = [
    { kind: 'unlock', active: 0, rx: T0 },
    { kind: 'answer', active: 60_000, rx: T0 + 60_000, body: ans('I01', 'B') },
    { kind: 'gap', active: 60_000, rx: T0 + 185_000, body: { ...E, meta: ['suspend', 999_999] } },          // the seat claims more; the relay saw 125 s
    { kind: 'answer', active: 90_000, rx: T0 + 215_000, body: ans('I02', 'C') },
    { kind: 'gap', active: 90_000, rx: T0 + 215_000 + 40 * 60_000, body: { ...E, meta: ['restart', 0] } },   // 40 min: over the cap
  ];
  const pending = timeAudit(sheet(steps), form, [], OPS);
  expect(pending.gaps.map((g) => [g.seq, g.cause, g.pausedMs, g.measuredMs, g.approved])).toEqual([[3, 'suspend', 999_999, 125_000, false], [5, 'restart', 0, 2_400_000, false]]);
  expect(pending.flags).toEqual(['REVIEW_GAPS', 'PENDING_APPROVAL']);
  expect(pending.creditedMs).toBe(0);
  const approved = timeAudit(sheet(steps), form, [{ cand: 'C0001', seq: 3, by: 'CONTROL-1', at: 1 }, { cand: 'C0001', seq: 5, by: 'CONTROL-1', at: 2 }], OPS);
  expect(approved.creditedMs).toBe(30 * 60_000);
  expect(approved.flags).toEqual(['REVIEW_GAPS', 'RETEST_ELIGIBLE']);
  expect(approved.gaps.every((g) => g.approvedBy === 'CONTROL-1')).toBe(true);
});

test('time nobody explains is flagged; entries without stamps or bodies do not break the audit', () => {
  const r = timeAudit(sheet([{ kind: 'unlock', active: 0, rx: T0 }, { kind: 'answer', active: 30_000, rx: T0 + 30_000 + 5 * 60_000, body: ans('I01', 'B') }]), form, [], OPS);
  expect(r.flags).toEqual(['UNEXPLAINED_TIME']);
  const s = sheet([{ kind: 'unlock', active: 0, rx: 0 }, { kind: 'answer', active: 30_000, rx: 0, body: ans('I01', 'B') }]);
  s.entries[1].body = ['missing'];
  expect(timeAudit(s, form, [], OPS)).toMatchObject({ wallMs: 30_000, activeMs: 30_000, flags: [] });
});

test('a move: its credit is the wall gap across the epochs; approved by the invigilator; answers changed after it are listed for review', () => {
  const r = timeAudit(sheet([
    { kind: 'unlock', active: 0, rx: T0 },
    { kind: 'answer', active: 50_000, rx: T0 + 50_000, body: ans('I02', 'B') },
    { kind: 'answer', active: 100_000, rx: T0 + 100_000, body: ans('I03', 'A') },
    { kind: 'handover', active: 100_000, rx: T0 + 208_000, epoch: 2, body: { ...E, meta: ['pin', 3, 108_000] } },
    { kind: 'answer', active: 120_000, rx: T0 + 228_000, epoch: 2, body: ans('I02', 'C') },             // changed after the move
    { kind: 'answer', active: 130_000, rx: T0 + 238_000, epoch: 2, body: ans('I04', 'D') },             // first answered after it
  ]), form, [{ cand: 'C0001', seq: 4, by: 'INV-42-A', at: 1 }], OPS);
  expect(r.gaps).toEqual([{ seq: 4, kind: 'handover', cause: 'moved (pin)', pausedMs: 0, measuredMs: 108_000, approved: true, approvedBy: 'INV-42-A' }]);
  expect([r.activeMs, r.creditedMs, r.flags]).toEqual([130_000, 108_000, []]);
  expect(r.changedAfterMove).toEqual([{ item: 'I02', q: 2 }]);
});
