import { expect, test } from 'bun:test';
import type { Directory, FleetView } from '@saakshi/core/directory';
import { OPS_DEMO, type CellEvent, type LinkView } from '@saakshi/core/ops';
import type { HeadsRes } from '@saakshi/core/wire';
import { certInHtml } from '../src/certin.ts';
import { blastText, Incidents } from '../src/incidents.ts';

const e = (centre: string) => ({ centre, form: 'F1' as const, extraMs: 0, pseud: '7'.repeat(64) });
const dir = { v: 1, exam: 'DEMO-2026', shift: 'S1', durationMs: 1_800_000, demoCentre: 'CEN042', issuedAt: 0, cells: [],
  centres: { CEN042: { cell: 'cell-1' }, CEN001: { cell: 'cell-2' }, CEN002: { cell: 'cell-2' } },
  cands: { C0001: e('CEN042'), C0002: e('CEN042'), C0003: e('CEN042'), C0004: e('CEN042'), A1: e('CEN001'), A2: e('CEN001'), A3: e('CEN001'), B1: e('CEN002'), B2: e('CEN002') } } as unknown as Directory;
const fleet = (cell2: FleetView['cells'][number], tones: Record<string, 'green' | 'locked' | 'partial' | 'down'> = {}): FleetView => ({
  at: 0, registered: 9, bound: 9, unlocked: 9, submitted: 0, entries: 0, entriesPerSec: 0,
  cells: [{ id: 'cell-1', state: 'LIVE', entries: 100 }, cell2],
  centres: ['CEN001', 'CEN002', 'CEN042'].map((centre) => ({ centre, cell: dir.centres[centre].cell, registered: centre === 'CEN042' ? 4 : centre === 'CEN001' ? 3 : 2, bound: 0, unlocked: 0, submitted: 0, entries: 0, tone: tones[centre] ?? 'green' })),
});
const link = (risk: LinkView['risk'], o: Partial<LinkView> = {}): LinkView => ({ centre: 'CEN042', up: risk !== 'down', cut: false, degraded: false, rttMs: 40, errRate: 0, backlog: 0, lastContactAt: 0, risk, reason: risk === 'warn' ? 'WAN failure likely: round trips 2.1 s (smoothed)' : 'healthy', cell: 'LIVE', ...o });
let evId = 0;
const ev = (code: CellEvent['code'], cand: string, seq: number, data?: CellEvent['data'], reason = ''): CellEvent => ({ id: ++evId, at: 0, cell: 'cell-1', code, cand, centre: 'CEN042', seq, reason, ...(data ? { data } : {}) });

test('CELL_DOWN: a P1 at the control rung with its blast radius; it closes after rebuilding with the answers lost measured', () => {
  const x = new Incidents(dir, OPS_DEMO);
  x.evaluate({ now: 0, fleet: fleet({ id: 'cell-2', state: 'LIVE', entries: 500 }) });
  const [i] = x.evaluate({ now: 1_000, fleet: fleet({ id: 'cell-2', state: 'DOWN', entries: 500 }) });
  expect(i).toMatchObject({ kind: 'CELL_DOWN', severity: 'P1', rung: 2, title: 'Data Centre 2 is down', blast: { cells: ['cell-2'], centres: ['CEN001', 'CEN002'], candidates: 5, answersLost: null } });
  expect(blastText(i.blast)).toBe('1 cell · 2 centres · 5 candidates · answers lost: not known yet');
  expect(x.evaluate({ now: 2_000, fleet: fleet({ id: 'cell-2', state: 'REBUILDING', entries: 120, rebuild: { done: 1, expected: 2 } }) })[0].detail).toBe('1 of 2 relays have replayed');
  x.evaluate({ now: 3_000, fleet: fleet({ id: 'cell-2', state: 'LIVE', entries: 530 }) });
  expect(x.get(i.id)!.resolvedAt).toBeUndefined();                                 // debounce: clear for clearMs first
  x.evaluate({ now: 8_000, fleet: fleet({ id: 'cell-2', state: 'LIVE', entries: 530 }) });
  expect(x.get(i.id)).toMatchObject({ resolvedAt: 8_000, blast: { answersLost: 0 }, data: { before: 500, after: 530 } });

  const y = new Incidents(dir, OPS_DEMO);                                             // a rebuild that came back short
  y.evaluate({ now: 0, fleet: fleet({ id: 'cell-2', state: 'LIVE', entries: 500 }) });
  y.evaluate({ now: 1, fleet: fleet({ id: 'cell-2', state: 'DOWN', entries: 500 }) });
  y.evaluate({ now: 2, fleet: fleet({ id: 'cell-2', state: 'LIVE', entries: 480 }) });
  expect(y.evaluate({ now: 6_000, fleet: fleet({ id: 'cell-2', state: 'LIVE', entries: 480 }) })[0].blast.answersLost).toBe(20);
});

test('the ladder: unacknowledged incidents climb every ladderMs to their top rung; TAMPER at the regulator drafts CERT-In once; an ack stops it', () => {
  const drafted: string[] = [];
  const x = new Incidents(dir, OPS_DEMO, { regulator: (i) => { drafted.push(i.id); return `certin/${i.id}.html`; } });
  const [t] = x.evaluate({ now: 0, events: [ev('FORK', 'C0001', 7, undefined, 'seq 7 already holds a different signed entry')] });
  expect(t).toMatchObject({ kind: 'TAMPER', severity: 'P0', rung: 2 });
  const [b] = x.evaluate({ now: 0, events: [ev('BAD_SUBMISSION', 'C0002', 3, undefined, 'signature does not verify')] });
  const [h] = x.evaluate({ now: 0, events: [ev('HANDOVER', 'C0003', 6, { keyEpoch: 2, fromSeq: 6, via: 'pin', approvedBy: 'INV-42-A', creditedMs: 108_000, seatId: 'CEN042-S02' })] });
  x.evaluate({ now: 9_999 });
  expect([x.get(t.id)!.rung, x.get(b.id)!.rung]).toEqual([2, 0]);
  x.evaluate({ now: 10_000 });
  expect([x.get(t.id)!.rung, x.get(t.id)!.certIn, x.get(b.id)!.rung]).toEqual([3, `certin/${t.id}.html`, 1]);
  x.evaluate({ now: 20_000 }); x.evaluate({ now: 40_000 });
  expect([x.get(t.id)!.ladder.map((l) => l.rung), x.get(b.id)!.rung, x.get(h.id)!.rung]).toEqual([['control', 'regulator'], 2, 0]);   // P2 tops at control; P3 never climbs
  expect(drafted).toEqual([t.id]);
  const [t2] = x.evaluate({ now: 50_000, events: [ev('FORK', 'C0004', 2, undefined, 'x')] });
  x.ack(t2.id, ' SUP-42 ', 55_000);
  x.evaluate({ now: 70_000 });
  expect(x.get(t2.id)).toMatchObject({ rung: 2, ack: { by: 'SUP-42', rung: 'control', at: 55_000 } });
  expect(() => x.ack('NOPE-1', 'x', 1)).toThrow(/no incident/);
  expect(() => x.ack(t2.id, '  ', 1)).toThrow(/who/);
  expect(() => x.resolve(x.open().find((i) => i.kind === 'TAMPER')!.id, 1)).not.toThrow();
});

test('SYNC_LAG predicts; the cut opens RELAY_WAN_DOWN, which records how much earlier the warning came', () => {
  const x = new Incidents(dir, OPS_DEMO);
  const [w] = x.evaluate({ now: 0, link: link('warn') });
  expect(w).toMatchObject({ kind: 'SYNC_LAG', severity: 'P2', rung: 0, title: 'WAN failure likely at CEN042 (predicted)', blast: { centres: ['CEN042'], candidates: 4 } });
  const [d] = x.evaluate({ now: 12_000, link: link('down', { cut: true, reason: 'the link is cut' }) }).filter((i) => i.kind === 'RELAY_WAN_DOWN');
  expect(d.data.warnedMs).toBe(12_000);
  x.evaluate({ now: 17_000, link: link('down', { cut: true }) });
  expect(x.get(w.id)!.resolvedAt).toBe(17_000);
});

test('Review Focus #5: a flapping link keeps one incident until it has been clear for clearMs', () => {
  const x = new Incidents(dir, OPS_DEMO);                                             // clearMs = 5 s
  x.evaluate({ now: 0, link: link('down') });
  x.evaluate({ now: 1_000, link: link('ok') });
  x.evaluate({ now: 3_000, link: link('down') });
  x.evaluate({ now: 4_000, link: link('ok') });
  x.evaluate({ now: 8_999, link: link('ok') });
  expect(x.all().filter((i) => i.kind === 'RELAY_WAN_DOWN').map((i) => i.resolvedAt)).toEqual([undefined]);
  x.evaluate({ now: 9_000, link: link('ok') });
  x.evaluate({ now: 20_000, link: link('down') });
  expect(x.all().filter((i) => i.kind === 'RELAY_WAN_DOWN').map((i) => i.resolvedAt)).toEqual([9_000, undefined]);
});

test('silence: seats going quiet together are one CENTRE_OUTAGE; a lone quiet seat is SEAT_SILENT; submitted seats are ignored', () => {
  const heads = (seen: [string, number, boolean?][]): HeadsRes => ({ mode: 'relay', state: 'LIVE', streams: seen.map(([cand, seenAt, done]) =>
    ({ exam: 'DEMO-2026', shift: 'S1', attempt: 1, cand, head: 5, cellHead: 5, senderHead: 5, seenAt, ...(done ? { submitted: true as const } : {}) })) });
  const x = new Incidents(dir, OPS_DEMO);
  const out = x.evaluate({ now: 60_000, relay: heads([['C0001', 20_000], ['C0002', 21_000], ['C0003', 22_000], ['C0004', 59_000]]) });
  expect(out.map((i) => [i.kind, i.severity, i.blast.candidates])).toEqual([['CENTRE_OUTAGE', 'P1', 3]]);
  const y = new Incidents(dir, OPS_DEMO);
  expect(y.evaluate({ now: 60_000, relay: heads([['C0001', 20_000], ['C0002', 59_000], ['C0003', 59_000], ['C0004', 10_000, true]]) }).map((i) => [i.kind, i.cand])).toEqual([['SEAT_SILENT', 'C0001']]);
});

test('KEY_RELEASE_DELAY groups the centres still locked after the release; events map to incidents once, however often they arrive', () => {
  const x = new Incidents(dir, OPS_DEMO);
  const release = { released: { at: 0, custodians: ['NTA', 'NIC'], forms: [] } } as never;
  expect(x.evaluate({ now: 9_000, release, fleet: fleet({ id: 'cell-2', state: 'LIVE', entries: 1 }, { CEN042: 'locked' }) })).toEqual([]);
  const [k] = x.evaluate({ now: 11_000, release, fleet: fleet({ id: 'cell-2', state: 'LIVE', entries: 1 }, { CEN042: 'locked', CEN001: 'partial' }) });
  expect(k).toMatchObject({ kind: 'KEY_RELEASE_DELAY', severity: 'P1', title: '1 centre still locked after the release', blast: { centres: ['CEN042'], candidates: 4 } });

  const gap = ev('GAP', 'C0002', 9, { cause: 'suspend', pausedMs: 125_000 });
  const again = { ...gap, id: 999 };                                                   // the same entry, re-noted after a cell rebuild
  const crit = ev('INTEGRITY', 'C0003', 4, { code: 'remote-session' });
  const test = ev('INTEGRITY', 'C0004', 2, { code: 'test-mode' });
  const got = x.evaluate({ now: 12_000, events: [gap, again, crit, test, ev('ORPHANED', 'C0001', 7, undefined, 'moved'), ev('LATE', 'C0001', 30, undefined, 'late')] });
  expect(got.map((i) => [i.kind, i.severity, i.cand])).toEqual([['GAP', 'P3', 'C0002'], ['INTEGRITY_CRITICAL', 'P1', 'C0003'], ['ORPHANED', 'P3', 'C0001'], ['LATE', 'P2', 'C0001']]);
  expect(got[0]).toMatchObject({ title: 'C0002 paused (suspend)', data: { seq: 9, cause: 'suspend', pausedMs: 125_000 } });
  const f = x.evaluate({ now: 13_000, findings: [{ cand: 'C0002', seq: 17, kind: 'body', detail: 'Q17: record says C — the seat committed B', recovered: { from: 'option-search', value: 'B' } }] });
  expect(f[0]).toMatchObject({ kind: 'TAMPER', title: 'The record for C0002 was altered', detail: 'entry 17: Q17: record says C — the seat committed B', blast: { answersLost: 0 } });
});

test('CERT-In: a draft template with the facts, the 6-hour deadline, blanks for the officer, and every value escaped', () => {
  const x = new Incidents(dir, OPS_DEMO);
  const [t] = x.evaluate({ now: Date.UTC(2026, 8, 27, 4, 0), events: [ev('FORK', 'C0001', 7, undefined, '<script>alert(1)</script>')] });
  const html = certInHtml(t, { exam: 'DEMO-2026', shift: 'S1', now: Date.UTC(2026, 8, 27, 4, 1) });
  expect(html).toContain('DRAFT TEMPLATE');
  expect(html).toContain('not been filed');
  expect(html).toContain('2026-09-27T10:00:00.000Z');                                // noticed 04:00 UTC + 6 h
  expect(html).toContain(t.id);
  expect(html).toContain('Unauthorised modification of exam records');
  expect(html).not.toContain('<script>alert');
  expect(html).toContain('&#60;script&#62;');
});

test('a witness alert (S6) is a P0 TAMPER on the log itself, whole-shift blast radius', () => {
  const x = new Incidents(dir, OPS_DEMO);
  const [t] = x.evaluate({ now: 0, events: [{ id: 1, at: 0, cell: 'witness', code: 'EQUIVOCATION', cand: '', centre: '', seq: 3, reason: 'inconsistent: history was rewritten' }] });
  expect(t).toMatchObject({ kind: 'TAMPER', severity: 'P0', key: 'TAMPER:log', title: 'The witness refused to cosign the shift log', detail: 'inconsistent: history was rewritten', blast: { candidates: 9, answersLost: null } });
});
