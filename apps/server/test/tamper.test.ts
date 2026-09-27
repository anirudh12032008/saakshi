import { afterEach, beforeEach, expect, test } from 'bun:test';
import type { Database } from 'bun:sqlite';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hexToBytes } from '@saakshi/core/bytes';
import { canon, parseCanon, type Canon } from '@saakshi/core/canon';
import { cellKey, devForm, devPseud, devRoster, devSeatKey, trustFromKeys, type KeysFile } from '@saakshi/core/dev';
import { verifier } from '@saakshi/core/node';
import { formsOf, type ShiftExport, type SthRecord } from '@saakshi/core/sheet';
import { mismatchText, verifyProof } from '@saakshi/core/verify';
import type { HeadsRes } from '@saakshi/core/wire';
import { audit } from '../src/audit.ts';
import { createIngest, type Ingest } from '../src/ingest.ts';
import { reconcile } from '../src/recon.ts';
import { proofFor, seal } from '../src/seal.ts';
import { rogueEdit, shiftExport } from '../src/sheet-export.ts';
import { openDb } from '../src/store.ts';
import { FORMS, SimSeat } from '../../../tools/sim-seat.ts';

const keys = JSON.parse(readFileSync(new URL('../../../fixtures/keys.json', import.meta.url), 'utf8')) as KeysFile;
const cell = cellKey(keys, 'cell-1');
const forms = formsOf(FORMS), trust = trustFromKeys(keys);
const authority = { priv: hexToBytes(keys.authority.priv), pub: hexToBytes(keys.authority.pub) };
const EX = { exam: 'DEMO-2026', shift: 'S1', cell: 'cell-1', formOf: devForm, pseud: devPseud, seatKey: devSeatKey(keys) };
const WHERE = "exam = 'DEMO-2026' AND shift = 'S1' AND attempt = 1 AND cand = 'C0001'";
let dir: string, n: Ingest, db: Database;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'saakshi-tamper-')); ({ db } = openDb(join(dir, 'cell.db'))); n = createIngest({ mode: 'cell', db, fresh: false, seatKey: devSeatKey(keys), cell, forms, formOf: devForm, pseud: devPseud }); });
afterEach(() => { n.close(); rmSync(dir, { recursive: true, force: true }); });

/** C0001 and C0002 each answer all 20 items and submit (22 entries); the shift is sealed and archived; the relay agrees. */
async function sealedShift(sealIt = true) {
  const seats = ['C0001', 'C0002'].map((c) => { const s = new SimSeat(keys, c, cell.pub); s.add(21); s.submit(); return s; });
  for (const s of seats) {
    const r = await n.sync({ entries: s.entries, streams: [{ ...s.ctx, head: s.head }] });
    if (r === 'REBUILDING' || r.rejected.length) throw new Error(JSON.stringify(r));
  }
  const relay: HeadsRes = { mode: 'relay', state: 'LIVE', streams: seats.map((s) => ({ ...s.ctx, head: s.head, cellHead: s.head, senderHead: s.head, seenAt: 1 })) };
  const archive: ShiftExport | undefined = sealIt ? shiftExport(db, EX) : undefined;
  const rec: SthRecord | undefined = archive && seal(undefined, archive, { authority, trust, pseud: devPseud }).rec;
  return () => {
    const cur = shiftExport(db, EX);
    const findings = audit({ cell: cur, relay, archive, rec, trust, forms });
    const recon = reconcile({ centre: 'CEN-01', exam: 'DEMO-2026', shift: 'S1', roster: devRoster(keys), relay, cell: cur, rec });
    const sheet = cur.sheets.find((s) => s.ctx.cand === 'C0001');
    const proof = rec && sheet ? proofFor(rec, sheet) : undefined;
    return { findings, recon, verified: proof && verifyProof(proof, forms, trust, undefined, verifier) };
  };
}
const kinds = (fs: { kind: string; seq: number }[]) => fs.map((f) => [f.kind, f.seq]);
const lineAt = (seq: number) => (db.query(`SELECT line FROM entries WHERE ${WHERE} AND seq = ?`).get(seq) as { line: string }).line;
const setLine = (seq: number, line: string) => db.query(`UPDATE entries SET line = ? WHERE ${WHERE} AND seq = ?`).run(line, seq);
/** What the insider runs: remove rows of C0001 from one table. */
const drop = (table: string, cond: string) => db.run(`DELETE FROM ${table} WHERE ${WHERE}${cond}`);

test('an honest DB: no findings, reconciliation green, every proof verifies', async () => {
  const check = await sealedShift();
  const { findings, recon, verified } = check();
  expect(findings).toEqual([]);
  expect(recon.green).toBe(true);
  expect(verified!.ok).toBe(true);
});

test('edit: an answer rewritten in the cell DB is located, recovered from the archive, and verification names it', async () => {
  const check = await sealedShift();
  rogueEdit(db, { exam: 'DEMO-2026', shift: 'S1', attempt: 1, cand: 'C0001', item: 'I17', answer: 'B' });   // the seat committed C
  const { findings, recon, verified } = check();
  expect(findings).toEqual([{ cand: 'C0001', seq: 18, kind: 'body', detail: 'Q17: record says B — the seat committed C', recovered: { from: 'archive', value: 'C' } }]);
  expect(recon.green).toBe(true);
  expect(verified!.ok).toBe(false);
  expect(mismatchText(verified!.mismatches[0])).toBe('Q17: record says B — the seat committed C');
});

test('deleted row: located at its seq, restored from the archive; relay count and reconciliation disagree', async () => {
  const check = await sealedShift();
  drop('entries', ' AND seq = 5');
  drop('bodies', ' AND seq = 5');
  const { findings, recon } = check();
  expect(kinds(findings)).toEqual([['count', 0], ['count', 0], ['chain', 5]]);
  expect(findings[2].recovered).toEqual({ from: 'archive', value: 'seq 5 restored from the sealed archive' });
  expect(recon.headMismatches).toEqual(['C0001: relay 22 · cell 21']);
  expect(recon.green).toBe(false);
});

test('truncated chain: rows from seq 20 on (with the submit and its receipt) removed — the register\'s leaf catches it', async () => {
  const check = await sealedShift();
  drop('entries', ' AND seq >= 20');
  drop('bodies', ' AND seq >= 20');
  drop('receipts', '');
  const { findings, recon, verified } = check();
  expect(kinds(findings)).toEqual([['count', 0], ['count', 0], ['truncated', 19]]);
  expect(findings[2].recovered).toEqual({ from: 'archive', value: 'entries 20–22 restored from the sealed archive' });
  expect(recon.green).toBe(false);
  expect(verified!.checks.find((c) => c.name === 'inclusion')!.ok).toBe(false);
});

test('changed signature: located at its seq', async () => {
  const check = await sealedShift();
  setLine(7, lineAt(7).replace(/"([0-9a-f]{127})([0-9a-f])"\]$/, (_m, a, z) => `"${a}${z === '0' ? '1' : '0'}"]`));
  const { findings, verified } = check();
  expect(kinds(findings)).toEqual([['chain', 7]]);
  expect(findings[0].detail).toStartWith('entry 7: sig');
  expect(findings[0].recovered?.from).toBe('archive');
  expect(verified!.checks.find((c) => c.name === 'chain')!.ok).toBe(false);
});

test('edited header (activeMs changed, re-encoded canonically): located at its seq', async () => {
  const check = await sealedShift();
  const a = parseCanon(lineAt(9));
  (a[1] as Canon[])[11] = ((a[1] as Canon[])[11] as number) + 1;
  setLine(9, canon(a));
  expect(kinds(check().findings)).toEqual([['chain', 9]]);
});

test('before any seal, removing the submit and its receipt is still caught by the relay count', async () => {
  const check = await sealedShift(false);
  drop('entries', ' AND seq = 22');
  drop('bodies', ' AND seq = 22');
  drop('receipts', '');
  expect(check().findings).toEqual([{ cand: 'C0001', seq: 0, kind: 'count', detail: 'relay holds 22 entries, cell holds 21' }]);
});
