import { afterEach, beforeEach, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hexToBytes, toHex } from '@saakshi/core/bytes';
import { cellKey, devForm, devPseud, devSeatKey, type KeysFile } from '@saakshi/core/dev';
import { receiptMessage, responsesOf } from '@saakshi/core/log';
import { verifier } from '@saakshi/core/node';
import { counts, receiptCode } from '@saakshi/core/protocol';
import { formsOf } from '@saakshi/core/sheet';
import type { SyncRes, WireEntry } from '@saakshi/core/wire';
import { createIngest, type Ingest, type Mode } from '../src/ingest.ts';
import { openDb } from '../src/store.ts';
import { FORMS, SimSeat } from '../../../tools/sim-seat.ts';

const keys = JSON.parse(readFileSync(new URL('../../../fixtures/keys.json', import.meta.url), 'utf8')) as KeysFile;
const cell = cellKey(keys, 'cell-1');
const forms = formsOf(FORMS);
let dir: string;
const opened: Ingest[] = [];
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'saakshi-submit-')); });
afterEach(() => { for (const n of opened.splice(0)) n.close(); rmSync(dir, { recursive: true, force: true }); });

function node(mode: Mode, name: string = mode): Ingest {
  const { db } = openDb(join(dir, `${name}.db`));
  const n = createIngest({ mode, db, fresh: false, seatKey: devSeatKey(keys), cell: mode === 'cell' ? cell : { pub: cell.pub }, forms, formOf: devForm, pseud: devPseud, cellId: 'cell-1' });
  opened.push(n);
  return n;
}
const push = async (n: Ingest, s: SimSeat, entries: WireEntry[] = s.entries): Promise<SyncRes> => {
  const r = await n.sync({ entries, streams: [{ ...s.ctx, head: s.head }] });
  if (r === 'REBUILDING') throw new Error('unexpected REBUILDING');
  return r;
};
const rows = <T>(name: string, table: string): T[] => { const d = new Database(join(dir, `${name}.db`)); try { return d.query(`SELECT * FROM ${table} ORDER BY seq`).all() as T[]; } finally { d.close(); } };
const visit = (item: string) => ({ item, state: 'NA' as const, answer: '', meta: [0, []] });

test('cell: an honest submit with visits, re-answers and a clear is accepted and its receipt matches the seat\'s', async () => {
  const n = node('cell'), s = new SimSeat(keys, 'C0002', cell.pub);          // form F2: reversed order
  s.add(4);                                                                    // unlock + I01 I02 I03 answered
  s.append('clear', visit('I19'));                                             // first visit
  s.append('answer', { item: 'I02', state: 'A', answer: 'D', meta: [500, []] }); // re-answer: last wins
  s.append('mark', { item: 'I05', state: 'AMR', answer: 'B', meta: [900, []] });
  s.append('answer', { item: 'I06', state: 'A', answer: 'C', meta: [100, []] });
  s.append('clear', { item: 'I06', state: 'NA', answer: '', meta: [100, []] }); // answered, then cleared
  s.submit();
  const r = await push(n, s);
  expect(r.rejected).toEqual([]);
  expect(r.streams[0].head).toBe(10);
  const rc = responsesOf(FORMS.F2, s.bodies.slice(0, -1));
  const B = { exam: 'DEMO-2026', shift: 'S1', attempt: 1, pseud: devPseud('C0002'), seq: 10, h: s.hs[9], finalHash: s.bodies[9].meta[1] as string, ...counts(rc) };
  expect(counts(rc)).toEqual({ attempted: 6, answered: 4, marked: 1 });
  const [row] = rows<{ cand: string; seq: number; h: string; code: string; cell: string; sig: string; attempted: number }>('cell', 'receipts');
  expect(row).toMatchObject({ cand: 'C0002', seq: 10, h: s.hs[9], code: receiptCode(B), cell: 'cell-1', attempted: 6 });
  expect(verifier(cell.pub)(receiptMessage(B), hexToBytes(row.sig))).toBe(true);
});

test('cell: stores the opened body and salt of every entry — the record the audit checks', async () => {
  const n = node('cell'), s = new SimSeat(keys, 'C0001', cell.pub);
  s.add(3);
  await push(n, s);
  const b = rows<{ seq: number; item: string; state: string; answer: string; meta: string; salt: Uint8Array }>('cell', 'bodies');
  expect(b.map((x) => [x.seq, x.item, x.state, x.answer, x.meta])).toEqual([[1, '', '', '', '[]'], [2, 'I01', 'A', 'C', '[1000,[]]'], [3, 'I02', 'A', 'D', '[1000,[]]']]);
  expect(toHex(b[1].salt)).toBe(toHex(s.salts[1]));
  node('relay', 'relay-unused');                                               // a relay DB has the table, always empty
  expect(rows('relay-unused', 'bodies')).toEqual([]);
});

for (const mode of ['relay', 'cell'] as const) {
  test(`${mode}: nothing is accepted after a submit, even after a restart`, async () => {
    const s = new SimSeat(keys, 'C0001', cell.pub);
    s.add(3); s.submit();
    let n = node(mode);
    await push(n, s);
    const extra = s.make(5, s.hs[3], 'A').entry;
    const r = await push(n, s, [extra]);
    expect(r.rejected).toEqual([{ index: 0, code: 'BAD_SUBMISSION', reason: 'entry after submit (the chain closed at seq 4)' }]);
    n.close();
    n = node(mode);
    expect((await push(n, s, [extra])).rejected[0].reason).toContain('entry after submit');
  });

  test(`${mode}: resending the exact submit is a no-op, not "after submit"`, async () => {
    const n = node(mode), s = new SimSeat(keys, 'C0001', cell.pub);
    s.add(3); s.submit();
    await push(n, s);
    const r = await push(n, s);
    expect(r.rejected).toEqual([]);
    expect(r.streams[0].head).toBe(4);
  });
}

test('cell: a submit whose finalHash does not replay is BAD_SUBMISSION and nothing is stored', async () => {
  const n = node('cell'), s = new SimSeat(keys, 'C0001', cell.pub);
  s.add(3);
  s.append('submit', { item: '', state: '', answer: '', meta: ['F1', '0'.repeat(64)] });
  const r = await push(n, s);
  expect(r.rejected[0]).toMatchObject({ index: 3, code: 'BAD_SUBMISSION', reason: 'submit: finalHash does not match the replayed chain' });
  expect(r.streams[0].head).toBe(3);
  expect(rows('cell', 'receipts')).toEqual([]);
});

test('cell: a submit naming another form, or an answer to an item outside the form, is BAD_SUBMISSION', async () => {
  const n = node('cell'), s = new SimSeat(keys, 'C0001', cell.pub);
  s.add(2);
  s.submit('F2');
  expect((await push(n, s)).rejected[0].reason).toBe('submit names form F2; the roster says F1');
  const t = new SimSeat(keys, 'C0003', cell.pub);
  t.add(1);
  t.append('answer', { item: 'I99', state: 'A', answer: 'B', meta: [1, []] });
  expect((await push(n, t)).rejected[0].reason).toBe("item I99 is not in C0003's form");
});

test('relay: cannot read bodies, so it stores a submit it cannot check (the cell rejects it)', async () => {
  const n = node('relay'), s = new SimSeat(keys, 'C0001', cell.pub);
  s.add(2);
  s.append('submit', { item: '', state: '', answer: '', meta: ['F1', '0'.repeat(64)] });
  expect((await push(n, s)).rejected).toEqual([]);
  expect(rows('relay', 'bodies')).toEqual([]);
});
