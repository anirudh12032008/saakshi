import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { hexToBytes } from '@saakshi/core/bytes';
import { cellKey, devPseud, devRoster, trustFromKeys, type KeysFile } from '@saakshi/core/dev';
import type { ResponseSheet, ShiftExport } from '@saakshi/core/sheet';
import type { HeadsRes } from '@saakshi/core/wire';
import { reconcile } from '../src/recon.ts';
import { seal } from '../src/seal.ts';
import { SimSeat } from '../../../tools/sim-seat.ts';

const keys = JSON.parse(readFileSync(new URL('../../../fixtures/keys.json', import.meta.url), 'utf8')) as KeysFile;
const cell = cellKey(keys, 'cell-1');
const o = { authority: { priv: hexToBytes(keys.authority.priv), pub: hexToBytes(keys.authority.pub) }, trust: trustFromKeys(keys), pseud: devPseud };
const withReceipt = (sh: ResponseSheet): ResponseSheet => ({ ...sh, receipt: { cell: 'cell-1', seq: sh.entries.length, h: 'a'.repeat(64), code: 'X', sig: 'b'.repeat(128) } });
function shift() {
  const a = new SimSeat(keys, 'C0001', cell.pub); a.add(5); a.submit();
  const b = new SimSeat(keys, 'C0002', cell.pub); b.add(5); b.submit();
  const exp: ShiftExport = { cell: 'cell-1', exam: 'DEMO-2026', shift: 'S1', sheets: [withReceipt(a.sheet()), withReceipt(b.sheet())] };
  const relay: HeadsRes = { mode: 'relay', state: 'LIVE', streams: [a, b].map((s) => ({ ...s.ctx, head: s.head, cellHead: s.head, senderHead: s.head, seenAt: 1 })) };
  return { exp, relay };
}
const base = { centre: 'CEN-01', exam: 'DEMO-2026', shift: 'S1', roster: devRoster(keys) };

test('a sealed, fully synced shift reconciles green', () => {
  const { exp, relay } = shift();
  const r = reconcile({ ...base, relay, cell: exp, rec: seal(undefined, exp, o).rec });
  expect(r).toEqual({ centre: 'CEN-01', exam: 'DEMO-2026', shift: 'S1', registered: 8, checkedIn: 2, unlocked: 2, submitted: 2, receipts: 2, leaves: 2, headsEqual: true, headMismatches: [], green: true });
});

test('not yet sealed: leaves 0, not green', () => {
  const { exp, relay } = shift();
  const r = reconcile({ ...base, relay, cell: exp });
  expect([r.leaves, r.green]).toEqual([0, false]);
});

test('a relay head that differs from the cell\'s count names the candidate and turns the row red', () => {
  const { exp, relay } = shift();
  relay.streams[0].head = 8;
  const r = reconcile({ ...base, relay, cell: exp, rec: seal(undefined, exp, o).rec });
  expect(r.headsEqual).toBe(false);
  expect(r.headMismatches).toEqual(['C0001: relay 8 · cell 6']);
  expect(r.green).toBe(false);
});

test('an empty shift (nothing checked in, submitted or sealed) is not green', () => {
  const r = reconcile({ ...base, relay: { mode: 'relay', state: 'LIVE', streams: [] }, cell: { cell: 'cell-1', exam: 'DEMO-2026', shift: 'S1', sheets: [] } });
  expect([r.checkedIn, r.submitted, r.leaves, r.headsEqual, r.green]).toEqual([0, 0, 0, true, false]);
});
