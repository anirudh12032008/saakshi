import { expect, test } from 'bun:test';
import type { Finding, ReconRow } from '@saakshi/core/sheet';
import { findingText, headline, reconCells } from '../src/control-view.ts';

const row: ReconRow = { centre: 'CEN-01', exam: 'DEMO-2026', shift: 'S1', registered: 8, checkedIn: 1, unlocked: 1, submitted: 1, receipts: 1, leaves: 1, headsEqual: true, headMismatches: [], green: true };

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
