import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Finding, ReconRow } from '@saakshi/core/sheet';
import type { FleetView, ReleaseStatus } from '@saakshi/core/directory';
import { commitment, findingText, fleetSummary, headline, kpis, reconCells, releaseLines, tileText } from '../src/control-view.ts';

const row: ReconRow = { centre: 'CEN-01', exam: 'DEMO-2026', shift: 'S1', registered: 8, checkedIn: 1, unlocked: 1, submitted: 1, receipts: 1, leaves: 1, headsEqual: true, headMismatches: [], green: true };

/** Every font size is a --s step, and neighbouring steps differ by at least 1.25×. */
function typeScaleOk(html: string): boolean {
  const steps = [...html.matchAll(/--s-?\d:\s*([\d.]+)rem/g)].map((m) => Number(m[1])).sort((a, b) => a - b);
  const ratios = steps.slice(1).map((s, i) => s / steps[i]);
  const decls = [...html.matchAll(/font(-size)?:\s*([^;}]+)/g)].map((m) => m[2]);
  return steps.length >= 3 && ratios.every((r) => r >= 1.249) && decls.every((d) => d.trim() === 'inherit' || d.includes('var(--s'));
}

const fleetView: FleetView = {
  at: 1, registered: 19806, bound: 19806, unlocked: 19798, submitted: 0, entries: 123456, entriesPerSec: 2345,
  cells: [{ id: 'cell-1', state: 'LIVE', entries: 1 }, { id: 'cell-2', state: 'DOWN', entries: 0 }],
  centres: [
    { centre: 'CEN001', cell: 'cell-2', registered: 200, bound: 200, unlocked: 200, submitted: 0, entries: 9, tone: 'green' },
    { centre: 'CEN042', cell: 'cell-1', registered: 8, bound: 2, unlocked: 0, submitted: 0, entries: 0, tone: 'locked' },
  ],
};

test('fleet: KPIs with Indian digit grouping, tiles that carry a word (never colour alone), and a summary', () => {
  expect(kpis(fleetView).map((k) => [k.label, k.value])).toEqual([
    ['Candidates registered', '19,806'], ['Seats bound', '19,806'], ['Paper unlocked', '19,798'], ['Submitted', '0'], ['Entries per second', '2,345'],
  ]);
  expect(tileText(fleetView.centres[1])).toEqual({ title: 'CEN042', line: '0 / 8 unlocked', word: 'Locked', aria: 'CEN042: Locked, 0 of 8 unlocked, 2 bound, 0 submitted, on cell-1' });
  expect(tileText(fleetView.centres[0]).word).toBe('All unlocked');
  expect(fleetSummary(fleetView)).toBe('1 of 2 centres green · 1 of 2 exam servers live');
});

test('custody panel: fingerprint, shares, release, push, zeroise, reveals; the commitment reads in groups', () => {
  const manifest = { exam: 'DEMO-2026', shift: 'S1', forms: [{ form: 'F1', ciphertextHash: 'ab'.repeat(32), kcf: 'cd'.repeat(32) }], ts: 1 };
  const s: ReleaseStatus = { exam: 'DEMO-2026', shift: 'S1', keyId: 'feedfacecafebeef', custodians: ['NTA', 'NIC', 'OBS'], received: ['NTA'], needed: 2, pushed: { 'cell-1': false }, zeroised: false, reveals: [], manifest };
  expect(releaseLines(s)).toEqual(['Release key feed face cafe beef — held in memory only; confirm this fingerprint with each custodian by phone.', 'Shares received: NTA — 1 more needed.']);
  const r: ReleaseStatus = { ...s, received: ['NTA', 'NIC'], released: { at: Date.UTC(2026, 8, 27, 4, 30, 3), custodians: ['NTA', 'NIC'], forms: [{ form: 'F1', kcf: 'cd'.repeat(32) }] },
    pushed: { 'cell-1': true, 'cell-2': false }, reveals: [{ at: Date.UTC(2026, 8, 27, 4, 40), centre: 'CEN042', superintendent: 'SUP-42' }] };
  expect(releaseLines(r).slice(1)).toEqual([
    'Released at 04:30:03 UTC by NTA + NIC.', 'Pushing to the exam servers: cell-1 ✓ · cell-2 …',
    'Offline code for CEN042 revealed to superintendent SUP-42 at 04:40:00 UTC (logged).',
  ]);
  expect(releaseLines({ ...r, zeroised: true })[2]).toBe('Every exam server has the release; control has zeroised the keys.');
  expect(commitment(manifest)).toEqual(['F1: kc_f cdcd cdcd cdcd cdcd … · ciphertext abab abab abab abab …']);
});

test('UI rules: the control page and the relay console use a 1.25 type scale and render server text with textContent only', () => {
  for (const f of ['control.html', 'console.html']) expect(typeScaleOk(readFileSync(join(import.meta.dir, '../src', f), 'utf8'))).toBe(true);
  for (const f of ['control-page.ts', 'console.ts']) expect(readFileSync(join(import.meta.dir, '../src', f), 'utf8')).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
});

test('reconciliation cells: all ok when green; leaves behind receipts and head mismatches are flagged', () => {
  expect(reconCells(row).map((c) => [c.label, c.value, c.ok])).toEqual([
    ['Registered', '8', true], ['Checked in', '1', true], ['Unlocked', '1', true], ['Submitted', '1', true],
    ['Receipts', '1', true], ['Register leaves', '1', true], ['Relay = cell heads', 'all equal', true],
  ]);
  const bad = reconCells({ ...row, leaves: 0, headsEqual: false, headMismatches: ['C0001: relay 22 · cell 21'], green: false });
  expect(bad.filter((c) => !c.ok).map((c) => c.value)).toEqual(['0', 'C0001: relay 22 · cell 21']);
});

test('findings read as one line each; the headline prefers the altered answer', () => {
  const fs: Finding[] = [
    { cand: 'C0001', seq: 0, kind: 'count', detail: 'relay holds 22 entries, cell holds 21' },
    { cand: 'C0001', seq: 18, kind: 'body', detail: 'Q17: record says C — the seat committed B', recovered: { from: 'archive', value: 'B' } },
  ];
  expect(findingText(fs[1])).toBe('C0001 · entry 18 · body: Q17: record says C — the seat committed B → recovered from archive: B');
  expect(findingText(fs[0])).toBe('C0001 · whole chain · count: relay holds 22 entries, cell holds 21');
  expect(headline(fs)).toBe('Q17: record says C — the seat committed B');
  expect(headline([])).toBe('No tampering found: every record matches what the seats committed.');
});
