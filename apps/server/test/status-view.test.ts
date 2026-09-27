import { expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FleetView } from '@saakshi/core/directory';
import type { Incident } from '@saakshi/core/ops';
import { draftNotice, Outbox } from '../src/comms.ts';
import { publicStatus } from '../src/status-view.ts';

const fleet: FleetView = { at: 0, registered: 30, bound: 30, unlocked: 22, submitted: 0, entries: 0, entriesPerSec: 0, cells: [],
  centres: [
    { centre: 'CEN001', cell: 'cell-2', registered: 10, bound: 10, unlocked: 10, submitted: 0, entries: 0, tone: 'down' },
    { centre: 'CEN042', cell: 'cell-1', registered: 8, bound: 8, unlocked: 0, submitted: 0, entries: 0, tone: 'locked' },
    { centre: 'CEN007', cell: 'cell-1', registered: 12, bound: 12, unlocked: 12, submitted: 0, entries: 0, tone: 'green' },
  ] };
const inc = (o: Partial<Incident>): Incident => ({ id: 'X-1', kind: 'CELL_DOWN', severity: 'P1', key: 'k', title: 'Data Centre 2 is down', detail: 'd',
  blast: { cells: ['cell-2'], centres: ['CEN001', 'CEN002'], candidates: 6_600, answersLost: null }, openedAt: 5, updatedAt: 5, rung: 2, ladder: [], data: {}, ...o });
const incidents: Incident[] = [
  inc({}),
  inc({ id: 'H-2', kind: 'HANDOVER', severity: 'P3', cand: 'C0001', title: 'C0001 moved to CEN042-S02 (PIN + invigilator INV-42-A)', blast: { cells: [], centres: ['CEN042'], candidates: 1, answersLost: 0 }, data: { seatId: 'CEN042-S02', approvedBy: 'INV-42-A' } }),
  inc({ id: 'W-3', kind: 'RELAY_WAN_DOWN', severity: 'P2', title: 'CEN042 has lost its link', blast: { cells: [], centres: ['CEN042'], candidates: 8, answersLost: 0 } }),
  inc({ id: 'T-4', kind: 'TAMPER', severity: 'P0', cand: 'C0002', title: 'The record for C0002 was altered' }),
  inc({ id: 'S-5', kind: 'SEAT_SILENT', severity: 'P3', cand: 'C0003', title: "C0003's seat is silent" }),
  inc({ id: 'R-6', kind: 'RELAY_WAN_DOWN', resolvedAt: 9 }),
];

test('the public status page: centres and public incidents in EN and HI — and no PII, whatever the incidents hold', () => {
  const dir = mkdtempSync(join(tmpdir(), 'saakshi-out-'));
  const ob = new Outbox(join(dir, 'outbox.jsonl'));
  ob.draft(draftNotice(incidents[0], 'DEMO-2026', 'S1', 6));
  ob.approve('N-X-1', 'CONTROL-OFFICER-ANITA', 7);
  const s = publicStatus({ exam: 'DEMO-2026', shift: 'S1', now: 10, fleet, incidents, notices: ob.sent() });
  expect(s.summary).toEqual({ en: '1 of 3 centres running normally', hi: '3 में से 1 केंद्र सामान्य रूप से चल रहे हैं', ta: expect.stringMatching(/[஀-௿]/) });
  expect(s.centres.map((c) => [c.centre, c.en])).toEqual([['CEN001', 'Exam server being restored'], ['CEN042', 'Not started yet'], ['CEN007', 'Running normally']]);
  for (const c of s.centres) expect(c.ta).toMatch(/[஀-௿]/);                                // every tone has Tamil-script text
  expect(s.incidents.map((i) => i.kind)).toEqual(['CELL_DOWN', 'RELAY_WAN_DOWN']);                  // centre-level, open incidents only
  expect(s.incidents[0].en).toBe("An exam server is being restored from the centres' copies. 2 centres affected. Candidates' time and answers are preserved.");
  expect(s.incidents[0].hi).toContain('परीक्षा सर्वर');
  for (const i of s.incidents) expect(i.ta).toMatch(/[஀-௿]/);                              // every public incident kind has Tamil-script text
  expect(s.notices).toEqual([{ at: 7, en: expect.stringContaining('Your answers and your exam time are preserved'), hi: expect.stringContaining('सुरक्षित'), ta: expect.stringMatching(/[஀-௿]/) }]);
  const text = JSON.stringify(s);
  for (const pii of ['C0001', 'C0002', 'C0003', 'CEN042-S02', 'INV-42-A', 'CONTROL-OFFICER-ANITA', '7777777777']) expect(text).not.toContain(pii);
  expect(text).not.toMatch(/\bC\d{4,}\b/);
  rmSync(dir, { recursive: true, force: true });
});

test('notices: one draft per incident, a human approves, the outbox appends a line and survives a restart', () => {
  const dir = mkdtempSync(join(tmpdir(), 'saakshi-out-'));
  const path = join(dir, 'outbox.jsonl');
  const ob = new Outbox(path);
  const n = draftNotice(incidents[2], 'DEMO-2026', 'S1', 6);
  expect(n).toMatchObject({ id: 'N-W-3', incident: 'W-3', centres: ['CEN042'], audience: 8, channels: ['sms', 'email', 'digilocker'] });
  expect(n.en).toBe('Saakshi DEMO-2026 S1: a technical problem affected centre CEN042. Your answers and your exam time are preserved. You do not need to do anything; you will be told if anything changes.');
  expect([ob.draft(n), ob.draft(n)]).toEqual([true, false]);
  expect(() => ob.approve('N-W-3', '  ', 7)).toThrow(/who/);
  expect(ob.approve('N-W-3', 'CONTROL-1', 7)).toMatchObject({ approvedBy: 'CONTROL-1', approvedAt: 7 });
  expect(ob.draft(n)).toBe(false);                                                       // already sent
  expect(() => ob.approve('N-W-3', 'CONTROL-1', 8)).toThrow(/no draft/);
  expect(readFileSync(path, 'utf8').trim().split('\n').length).toBe(1);
  expect(new Outbox(path).sent().map((x) => x.id)).toEqual(['N-W-3']);
  rmSync(dir, { recursive: true, force: true });
});

test('UI rules: /status keeps the 1.25 type scale, a language toggle with aria-pressed, visible focus, and textContent only', () => {
  const html = readFileSync(join(import.meta.dir, '../src/status.html'), 'utf8'), ts = readFileSync(join(import.meta.dir, '../src/status-page.ts'), 'utf8');
  const steps = [...html.matchAll(/--s-?\d:\s*([\d.]+)rem/g)].map((m) => Number(m[1])).sort((a, b) => a - b);
  expect(steps.length).toBeGreaterThanOrEqual(3);
  expect(steps.slice(1).every((s, i) => s / steps[i] >= 1.249)).toBe(true);
  expect([...html.matchAll(/font(-size)?:\s*([^;}]+)/g)].every((m) => m[2].trim() === 'inherit' || m[2].includes('var(--s'))).toBe(true);
  expect(html).toContain(':focus-visible');
  expect(ts).toContain('aria-pressed');
  expect(ts).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
  expect([...ts.matchAll(/fetch\(/g)].length).toBe(1);
  expect(ts).toContain('/v1/status/public');
});
