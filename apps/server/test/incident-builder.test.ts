import { expect, test } from 'bun:test';
import type { Directory } from '@saakshi/core/directory';
import type { Incident, TimeRow } from '@saakshi/core/ops';
import type { IncidentIn } from '@saakshi/core/analytics';
import { buildIncident } from '../src/incident-builder.ts';

const dir: Directory = {
  v: 1, exam: 'DEMO-2026', shift: 'S1', durationMs: 180 * 60_000, demoCentre: 'CEN001', issuedAt: 0,
  cells: [],
  centres: { CEN001: { cell: 'CELL-A' }, CEN042: { cell: 'CELL-A' } },
  cands: {
    C0001: { pseud: 'p1', form: 'F1', centre: 'CEN001' } as Directory['cands'][string],
    C0002: { pseud: 'p2', form: 'F1', centre: 'CEN001' } as Directory['cands'][string],
  },
};

const startMs = 1_000_000_000_000;

function timeRow(cand: string, gaps: TimeRow['gaps'], flags: TimeRow['flags'] = []): TimeRow {
  return { cand, wallMs: 0, activeMs: 0, unaccountedMs: 0, gaps, creditedMs: 0, flags, changedAfterMove: [] };
}
function gapLine(seq: number, measuredMs: number, approved: boolean): TimeRow['gaps'][number] {
  return { seq, kind: 'gap', cause: 'suspend', pausedMs: measuredMs, measuredMs, approved, approvedBy: approved ? 'CONTROL-1' : '' };
}
function outage(id: string, kind: Incident['kind'], centres: string[], openedAt: number, resolvedAt?: number): Incident {
  return {
    id, kind, severity: 'P1', key: id, title: '', detail: '', blast: { cells: [], centres, candidates: 0, answersLost: null },
    openedAt, updatedAt: openedAt, resolvedAt, rung: 0, ladder: [], data: {},
  };
}
const baseInput = (extra: Partial<IncidentIn> = {}): IncidentIn => ({ id: 'INC-1', ...extra });

test('approved gaps only: an unapproved line is ignored', () => {
  const time = [timeRow('C0001', [gapLine(1, 61_000, true), gapLine(2, 90_000, false)])];
  const r = buildIncident({ input: baseInput(), time, incidents: [], dir, startMs });
  expect(r.gaps).toEqual({ C0001: [2] });
});

test('ceil to minutes: 61 s -> 2', () => {
  const time = [timeRow('C0001', [gapLine(1, 61_000, true)])];
  const r = buildIncident({ input: baseInput(), time, incidents: [], dir, startMs });
  expect(r.gaps).toEqual({ C0001: [2] });
});

test('input wins for a candidate it names', () => {
  const time = [timeRow('C0001', [gapLine(1, 61_000, true)])];
  const r = buildIncident({ input: baseInput({ gaps: { C0001: [99] } }), time, incidents: [], dir, startMs });
  expect(r.gaps).toEqual({ C0001: [99] });
});

test('RETEST_ELIGIBLE joins left, sorted and unique', () => {
  const time = [timeRow('C0002', [], ['RETEST_ELIGIBLE']), timeRow('C0001', [], ['RETEST_ELIGIBLE'])];
  const r = buildIncident({ input: baseInput({ left: ['C0001'] }), time, incidents: [], dir, startMs });
  expect(r.left).toEqual(['C0001', 'C0002']);
});

test('an outage incident becomes a disruption window', () => {
  const incidents = [outage('I-1', 'CENTRE_OUTAGE', ['CEN042'], startMs + 5 * 60_000, startMs + 20 * 60_000)];
  const r = buildIncident({ input: baseInput(), time: [], incidents, dir, startMs });
  expect(r.disruptions).toEqual([{ centre: 'CEN042', shift: 'S1', fromMin: 5, toMin: 20 }]);
});

test('two overlapping outages at one centre merge', () => {
  const incidents = [
    outage('I-1', 'CENTRE_OUTAGE', ['CEN042'], startMs + 5 * 60_000, startMs + 20 * 60_000),
    outage('I-2', 'RELAY_WAN_DOWN', ['CEN042'], startMs + 15 * 60_000, startMs + 30 * 60_000),
  ];
  const r = buildIncident({ input: baseInput(), time: [], incidents, dir, startMs });
  expect(r.disruptions).toEqual([{ centre: 'CEN042', shift: 'S1', fromMin: 5, toMin: 30 }]);
});

test('a SEAT_SILENT incident adds nothing', () => {
  const incidents = [outage('I-1', 'SEAT_SILENT', ['CEN042'], startMs, startMs + 60_000)];
  const r = buildIncident({ input: baseInput(), time: [], incidents, dir, startMs });
  expect(r.disruptions).toEqual([]);
});

test('windows clamp to [0, durationMin]', () => {
  const incidents = [outage('I-1', 'CENTRE_OUTAGE', ['CEN042'], startMs - 10 * 60_000, startMs + (200) * 60_000)];
  const r = buildIncident({ input: baseInput(), time: [], incidents, dir, startMs });
  expect(r.disruptions).toEqual([{ centre: 'CEN042', shift: 'S1', fromMin: 0, toMin: 180 }]);
});

test('breach and id pass through unchanged', () => {
  const breach = { perimeter: ['CEN042'], systemic: false, evidence: 'e' };
  const r = buildIncident({ input: baseInput({ breach }), time: [], incidents: [], dir, startMs });
  expect(r.id).toBe('INC-1');
  expect(r.breach).toEqual(breach);
});

test('throws naming the field: missing id', () => {
  expect(() => buildIncident({ input: { id: '' }, time: [], incidents: [], dir, startMs })).toThrow(/id/);
});

test('throws naming the field: a disruption at a centre not in the directory', () => {
  const input = baseInput({ disruptions: [{ centre: 'CEN999', shift: 'S1', fromMin: 0, toMin: 5 }] });
  expect(() => buildIncident({ input, time: [], incidents: [], dir, startMs })).toThrow(/disruption/i);
});

test('throws naming the field: fromMin > toMin', () => {
  const input = baseInput({ disruptions: [{ centre: 'CEN042', shift: 'S1', fromMin: 10, toMin: 5 }] });
  expect(() => buildIncident({ input, time: [], incidents: [], dir, startMs })).toThrow(/fromMin/);
});

test('throws naming the field: a left candidate not in the directory', () => {
  const input = baseInput({ left: ['C9999'] });
  expect(() => buildIncident({ input, time: [], incidents: [], dir, startMs })).toThrow(/left/);
});

test('throws naming the field: a gaps candidate not in the directory', () => {
  const input = baseInput({ gaps: { C9999: [1] } });
  expect(() => buildIncident({ input, time: [], incidents: [], dir, startMs })).toThrow(/gaps/);
});
