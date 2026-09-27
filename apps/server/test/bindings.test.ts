import { afterEach, beforeEach, expect, test } from 'bun:test';
import type { Database } from 'bun:sqlite';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { toHex } from '@saakshi/core/bytes';
import { cellKey, type KeysFile } from '@saakshi/core/dev';
import { checkWireBind } from '@saakshi/core/enrol';
import { newKeyPair } from '@saakshi/core/node';
import { Bindings } from '../src/bindings.ts';
import { openDb } from '../src/store.ts';
import { simBindReq, simPinRecord } from '../../../tools/sim-custody.ts';

const keys = JSON.parse(readFileSync(new URL('../../../fixtures/keys.json', import.meta.url), 'utf8')) as KeysFile;
const cell = cellKey(keys, 'cell-1'), cell2 = cellKey(keys, 'cell-2');
const X = { exam: 'DEMO-2026', shift: 'S1' };
let dir: string;
const dbs: Database[] = [];
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'saakshi-bind-')); });
afterEach(() => { for (const d of dbs.splice(0)) d.close(); rmSync(dir, { recursive: true, force: true }); });
const open = (name: string, c: { id: string; pub: Uint8Array; priv?: Uint8Array } = cell) => {
  const { db } = openDb(join(dir, `${name}.db`));
  dbs.push(db);
  return new Bindings(db, { ...X, cell: c });
};

test('enrol: a registered seat gets a cell-signed certificate; the same request again returns the same certificate; a second key is ALREADY_BOUND', () => {
  const b = open('cell');
  const seat = newKeyPair(), req = simBindReq('C0001', seat, cell.pub, 'CEN042-S01');
  const r1 = b.enrol(req, true);
  if (!r1.ok) throw new Error(r1.error);
  expect(checkWireBind(r1.bind, cell.pub)).toMatchObject({ cand: 'C0001', seatId: 'CEN042-S01', pub: toHex(seat.pub), keyEpoch: 1, fromSeq: 0 });
  expect(b.enrol(req, true)).toEqual(r1);                                          // a lost response, retried
  expect(b.seatKey('C0001', 1)).toEqual(seat.pub);
  expect(b.enrol(simBindReq('C0001', newKeyPair(), cell.pub), true)).toMatchObject({ ok: false, code: 'ALREADY_BOUND' });
  expect(b.seatKey('C0001', 1)).toEqual(seat.pub);                                 // never silently rebound
  expect(b.cands()).toEqual(['C0001']);
});

test('enrol refuses a stranger, a handover (Stage 4), a PIN box sealed to another cell, and a key that is not a P-256 point', () => {
  const b = open('cell'), seat = newKeyPair();
  expect(b.enrol(simBindReq('C0001', seat, cell.pub), false)).toMatchObject({ ok: false, code: 'NOT_REGISTERED' });
  expect(b.enrol({ ...simBindReq('C0001', seat, cell.pub), keyEpoch: 2, fromSeq: 9 }, true)).toMatchObject({ ok: false, code: 'UNSUPPORTED' });
  expect(b.enrol(simBindReq('C0001', seat, cell2.pub), true)).toMatchObject({ ok: false, code: 'BAD', error: expect.stringContaining('PIN box') });
  expect(b.enrol({ ...simBindReq('C0001', seat, cell.pub), pub: '04' + '00'.repeat(64) }, true)).toMatchObject({ ok: false, code: 'BAD' });
  expect(b.all()).toEqual([]);
});

test('relay side: accept verifies the cell signature; a forged or foreign certificate is refused; bindings survive a restart', () => {
  const c = open('cell'), relay = open('relay', { id: 'cell-1', pub: cell.pub });
  const r = c.enrol(simBindReq('C0002', newKeyPair(), cell.pub), true);
  if (!r.ok) throw new Error(r.error);
  expect(relay.accept(r.bind)).toBeUndefined();
  expect(relay.accept(r.bind)).toBeUndefined();                                    // idempotent
  expect(relay.accept({ ...r.bind, sig: (r.bind.sig[0] === '0' ? '1' : '0') + r.bind.sig.slice(1) })).toMatch(/does not verify/);
  expect(relay.accept({ ...r.bind, cell: 'cell-2' })).toMatch(/cell-2/);
  const foreign = open('cell2', cell2).enrol(simBindReq('C0003', newKeyPair(), cell2.pub), true);
  if (!foreign.ok) throw new Error(foreign.error);
  expect(relay.accept(foreign.bind)).toBeDefined();
  expect(open('relay', { id: 'cell-1', pub: cell.pub }).get('C0002', 1)).toEqual(r.bind);   // reopened from disk
});

test('the PIN is never readable at rest: the cell DB holds only the sealed box', () => {
  const c = open('cell');
  c.enrol(simBindReq('C0004', newKeyPair(), cell.pub), true);
  const rec = simPinRecord(), hash = rec.slice(-66, -2);
  const wal = join(dir, 'cell.db-wal');
  const bytes = Buffer.concat([readFileSync(join(dir, 'cell.db')), existsSync(wal) ? readFileSync(wal) : Buffer.alloc(0)]);
  expect(bytes.includes(Buffer.from(hash))).toBe(false);
  expect(bytes.includes(Buffer.from(rec))).toBe(false);
});
