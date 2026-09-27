import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Database } from 'bun:sqlite';
import { cellKey, devForm, devPseud, devSeatKey, trustFromKeys, type KeysFile } from '@saakshi/core/dev';
import { verifier } from '@saakshi/core/node';
import { formsOf } from '@saakshi/core/sheet';
import { mismatchText, verifySheet } from '@saakshi/core/verify';
import { createIngest, type Ingest } from '../src/ingest.ts';
import { rogueEdit, shiftExport } from '../src/sheet-export.ts';
import { openDb } from '../src/store.ts';
import { FORMS, SimSeat } from '../../../tools/sim-seat.ts';

const keys = JSON.parse(readFileSync(new URL('../../../fixtures/keys.json', import.meta.url), 'utf8')) as KeysFile;
const cell = cellKey(keys, 'cell-1');
const forms = formsOf(FORMS), trust = trustFromKeys(keys);
const EX = { exam: 'DEMO-2026', shift: 'S1', cell: 'cell-1', formOf: devForm, pseud: devPseud, seatKey: devSeatKey(keys) };
let dir: string, n: Ingest, db: Database;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'saakshi-export-'));
  ({ db } = openDb(join(dir, 'cell.db')));
  n = createIngest({ mode: 'cell', db, fresh: false, seatKey: devSeatKey(keys), cell, forms, formOf: devForm, pseud: devPseud });
});
afterEach(() => { n.close(); rmSync(dir, { recursive: true, force: true }); });

async function sat(cand: string, entries: number, submit: boolean) {
  const s = new SimSeat(keys, cand, cell.pub);
  s.add(entries);
  if (submit) s.submit();
  const r = await n.sync({ entries: s.entries, streams: [{ ...s.ctx, head: s.head }] });
  if (r === 'REBUILDING' || r.rejected.length) throw new Error(JSON.stringify(r));
  return s;
}

// Stage 4: every exported entry carries the relay's and cell's receive stamps; the seat's sheet has none.
const noRx = <T extends { entries: { rx?: unknown }[] }>(s: T) => ({ ...s, entries: s.entries.map(({ rx: _, ...e }) => e) });

test('the export is exactly the honest sheet plus the cell\'s countersigned receipt, and it verifies', async () => {
  const a = await sat('C0001', 21, true), b = await sat('C0002', 4, false);
  const exp = shiftExport(db, EX);
  expect(exp.sheets.map((s) => s.ctx.cand)).toEqual(['C0001', 'C0002']);
  const { receipt, ...rest } = exp.sheets[0];
  expect(rest.entries.every((e) => e.rx?.length === 2)).toBe(true);
  expect(noRx(rest)).toEqual(a.sheet());
  expect(receipt).toMatchObject({ cell: 'cell-1', seq: 22, h: a.hs[21] });
  expect(noRx(exp.sheets[1])).toEqual(b.sheet());
  const r = verifySheet(exp.sheets[0], forms, trust, verifier);
  expect(r.ok).toBe(true);
  expect(r.receipt!.code).toBe(receipt!.code);
});

test('rogueEdit rewrites the latest recorded answer; the export now shows it and verification names it', async () => {
  const a = await sat('C0001', 21, true);
  const r = rogueEdit(db, { exam: 'DEMO-2026', shift: 'S1', attempt: 1, cand: 'C0001', item: 'I17', answer: 'B' });
  expect(r).toMatchObject({ seq: 18, item: 'I17', from: 'C', to: 'B' });
  expect(r.sql).toBe("UPDATE bodies SET answer = 'B' WHERE exam = 'DEMO-2026' AND shift = 'S1' AND attempt = 1 AND cand = 'C0001' AND seq = 18;");
  const v = verifySheet(shiftExport(db, EX).sheets[0], forms, trust, verifier);
  expect(v.ok).toBe(false);
  expect(v.mismatches.map(mismatchText)).toEqual(['Q17: record says B — the seat committed C']);
  expect(a.head).toBe(22);
});

test('a deleted body row exports as ["missing"]; rogueEdit on an item never answered throws', async () => {
  await sat('C0001', 3, false);
  db.run("DELETE FROM bodies WHERE cand = 'C0001' AND seq = 2");
  expect(shiftExport(db, EX).sheets[0].entries[1]).toMatchObject({ salt: '0'.repeat(32), body: ['missing'] });
  expect(() => rogueEdit(db, { exam: 'DEMO-2026', shift: 'S1', attempt: 1, cand: 'C0001', item: 'I19', answer: 'A' })).toThrow('no recorded answer for C0001 I19');
});
