import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hexToBytes } from '@saakshi/core/bytes';
import { cellKey, devForm, devPseud, type KeysFile } from '@saakshi/core/dev';
import { newKeyPair } from '@saakshi/core/node';
import type { RoundSample } from '@saakshi/core/ops';
import { formsOf } from '@saakshi/core/sheet';
import type { SyncRes } from '@saakshi/core/wire';
import { Bindings } from '../src/bindings.ts';
import { Forwarder } from '../src/forward.ts';
import { createIngest, type IngestOpts } from '../src/ingest.ts';
import { shiftExport } from '../src/sheet-export.ts';
import { openDb } from '../src/store.ts';
import { FORMS, SimSeat } from '../../../tools/sim-seat.ts';
import { simBindReq } from '../../../tools/sim-custody.ts';

const keys = JSON.parse(readFileSync(new URL('../../../fixtures/keys.json', import.meta.url), 'utf8')) as KeysFile;
const cell = cellKey(keys, 'cell-1'), forms = formsOf(FORMS);
const A = newKeyPair(), B = newKeyPair();
const seatKey = (c: string, e: number) => (c === 'C0001' ? (e === 1 ? A.pub : e === 2 ? B.pub : undefined) : undefined);
function node(mode: 'cell' | 'relay', o: Partial<IngestOpts> = {}) {
  const { db } = openDb(':memory:');
  const n = createIngest({ mode, db, fresh: false, seatKey, cell: mode === 'cell' ? cell : { pub: cell.pub }, forms, formOf: devForm, pseud: devPseud, ...o });
  return { n, db };
}
const rej = (r: SyncRes | 'REBUILDING') => { if (r === 'REBUILDING') throw new Error('REBUILDING'); return r.rejected; };
const X = { exam: 'DEMO-2026', shift: 'S1', cell: 'cell-1', formOf: devForm, pseud: devPseud, seatKey };

test('C.7 rxWall: the relay stamps its clock and forwards it; the cell keeps the relay\'s stamp and its own; the export carries both', async () => {
  let t = 1_000;
  const relay = node('relay', { now: () => t });
  const c = node('cell', { now: () => t + 50 });
  const s = new SimSeat(keys, 'C0001', cell.pub, 1, A);
  s.add(3);
  expect(rej(await relay.n.sync({ entries: s.entries, streams: [] }))).toEqual([]);
  const fwd = relay.n.entriesAfter(s.ctx, 0, 10);
  expect(fwd.map((e) => e.rx)).toEqual([1_000, 1_000, 1_000]);
  t = 9_000;
  expect(rej(await c.n.sync({ entries: [...fwd.slice(0, 2), { ...fwd[2], rx: 9_999_999_999 }], streams: [] }))).toEqual([]);
  expect(shiftExport(c.db, X).sheets[0].entries.map((e) => e.rx)).toEqual([[1_000, 9_050], [1_000, 9_050], [9_050, 9_050]]);   // a stamp from the future is not believed
  relay.n.close(); c.n.close();
});

test('Review Focus #2: an old-epoch entry after the new fromSeq is ORPHANED (evidence with envelope), before or after the new seat\'s entries, never FORK', async () => {
  for (const mode of ['relay', 'cell'] as const) {
    const from = new Map<number, number>([[1, 0]]);
    const { n, db } = node(mode, { fromSeq: (c, e) => (c === 'C0001' ? from.get(e) : undefined) });
    const s = new SimSeat(keys, 'C0001', cell.pub, 1, A);
    s.add(5);
    expect(rej(await n.sync({ entries: s.entries, streams: [] }))).toEqual([]);
    const tailBefore = s.make(6, s.hs[4], 'C').entry;                         // seat A's unsent tail, still keyEpoch 1
    from.set(2, 5);                                                            // the cell granted keyEpoch 2 from seq 5
    expect(rej(await n.sync({ entries: [tailBefore], streams: [] }))).toEqual([{ index: 0, code: 'ORPHANED', reason: expect.stringContaining('replaced at seq 5') }]);
    const early = new SimSeat(keys, 'C0001', cell.pub, 2, B).make(5, s.hs[3], 'A').entry;   // keyEpoch 2 may not sign seq 5
    expect(rej(await n.sync({ entries: [early], streams: [] }))[0]).toMatchObject({ code: 'BAD_SUBMISSION', reason: expect.stringContaining("fromSeq 5") });
    s.rekey(2, B);
    s.append('handover', { item: '', state: '', answer: '', meta: ['pin', 5, 0] });
    s.add(2);
    expect(rej(await n.sync({ entries: s.entries.slice(5), streams: [] }))).toEqual([]);
    const tailAfter = new SimSeat(keys, 'C0001', cell.pub, 1, A).make(7, '0'.repeat(64), 'D').entry;
    expect(rej(await n.sync({ entries: [tailAfter], streams: [] }))[0].code).toBe('ORPHANED');
    const ev = db.query("SELECT code, seq, env IS NOT NULL AS hasEnv FROM evidence WHERE code IN ('ORPHANED', 'FORK') ORDER BY id").all();
    expect(ev).toEqual([{ code: 'ORPHANED', seq: 6, hasEnv: 1 }, { code: 'ORPHANED', seq: 7, hasEnv: 1 }]);
    expect(n.snapshot(s.ctx)).toMatchObject({ head: 8, headH: s.hs[7], pending: 0, submitted: false });
    expect(n.events(0).filter((e) => e.code === 'ORPHANED').map((e) => [e.cand, e.seq])).toEqual([['C0001', 6], ['C0001', 7]]);
    n.close();
  }
});

test('C.8 the hard stop: entries after unlock + D_i + cap + slack are LATE (kept with envelope); the cell measures by the relay\'s stamp', async () => {
  let t = 1_000;
  const relay = node('relay', { deadlineMs: () => 10_000, now: () => t });
  const s = new SimSeat(keys, 'C0001', cell.pub, 1, A);
  s.add(3);
  expect(rej(await relay.n.sync({ entries: s.entries.slice(0, 2), streams: [] }))).toEqual([]);   // unlock received at 1 000
  t = 11_001;
  expect(rej(await relay.n.sync({ entries: [s.entries[2]], streams: [] }))[0]).toMatchObject({ code: 'LATE' });
  expect(relay.db.query("SELECT count(*) AS n FROM evidence WHERE code = 'LATE' AND env IS NOT NULL").get()).toEqual({ n: 1 });
  const c = node('cell', { deadlineMs: () => 10_000, now: () => 99_000 });                    // buffered through a WAN outage
  expect(rej(await c.n.sync({ entries: s.entries.map((e, i) => ({ ...e, rx: 1_000 + i })), streams: [] }))).toEqual([]);
  relay.n.close(); c.n.close();
});

test('Review Focus #1: a cell serving 3 relays stays REBUILDING until all 3 replay; a dead relay ends it by grace; a late relay\'s binds travel with its first entries', async () => {
  let t = 0;
  const rebuilding = () => { const { db } = openDb(':memory:'); return createIngest({ mode: 'cell', db, fresh: true, seatKey, cell, rebuildRelays: 3, rebuildGraceMs: 60_000, now: () => t }); };
  const c = rebuilding();
  expect(await c.sync({ entries: [], streams: [] })).toBe('REBUILDING');
  for (let i = 1; i <= 3; i++) {
    await c.sync({ entries: [], streams: [], replay: true, done: true });
    expect([c.state(), c.rebuild()]).toEqual([i < 3 ? 'REBUILDING' : 'LIVE', { done: i, expected: 3 }]);
  }
  const d = rebuilding();
  t = 1_000;
  await d.sync({ entries: [], streams: [], replay: true, done: true });
  t = 61_000; expect(d.state()).toBe('REBUILDING');
  t = 61_001; expect(d.state()).toBe('LIVE');
  c.close(); d.close();

  // A relay that was offline during the rebuild: its cell heads are stale; the first failed round makes them unknown, and the
  // entries it then sends carry the bindings, so a LIVE, wiped cell accepts them instead of refusing "no seat key".
  const rdb = openDb(':memory:').db, cdb = openDb(':memory:').db;
  const X3 = { exam: 'DEMO-2026', shift: 'S1' };
  const rb = new Bindings(rdb, { ...X3, cell: { id: 'cell-1', pub: cell.pub } }), cb = new Bindings(cdb, { ...X3, cell });
  const key = newKeyPair();
  const origin = new Bindings(openDb(':memory:').db, { ...X3, cell });
  const e = origin.enrol(simBindReq('C0001', key, cell.pub), true);
  if (!e.ok) throw new Error(e.error);
  expect(rb.accept(e.bind)).toBeUndefined();
  const relay = createIngest({ mode: 'relay', db: rdb, fresh: false, seatKey: rb.seatKey, acceptBinds: (x) => rb.acceptAll(x), cell: { pub: cell.pub } });
  const wiped = createIngest({ mode: 'cell', db: cdb, fresh: false, seatKey: cb.seatKey, acceptBinds: (x) => cb.acceptAll(x), cell, forms, formOf: devForm, pseud: devPseud });
  const s = new SimSeat(keys, 'C0001', cell.pub, 1, key);
  s.add(5);
  await relay.sync({ entries: s.entries, streams: [] });
  relay.setCellStatus({ ...s.ctx, head: 3, headH: s.hs[2], need: false });           // what the old cell knew before it was wiped
  let down = true;
  const sent: { binds: number; entries: number }[] = [];
  const fwd = new Forwarder(relay, async (req) => { if (down) throw new Error('WAN down'); sent.push({ binds: req.binds?.length ?? 0, entries: req.entries.length }); return wiped.sync(req); },
    { bindFor: (x) => rb.forCand(x.cand) });
  expect(await fwd.round()).toBe('error');
  expect(relay.views()[0].cellHead).toBe(-1);
  down = false;
  for (let i = 0; i < 5 && wiped.views()[0]?.head !== 5; i++) await fwd.round();
  expect(wiped.views()[0].head).toBe(5);
  expect(sent).toContainEqual({ binds: 1, entries: 5 });
  expect(cdb.query('SELECT count(*) AS n FROM evidence').get()).toEqual({ n: 0 });                 // no "no seat key" noise
  relay.close(); wiped.close();
});

test('events: the cell notes gap and integrity entries; note() adds one; ids only grow; snapshot() is what a grant needs', async () => {
  const { n } = node('cell', { now: () => 5_000 });
  const s = new SimSeat(keys, 'C0001', cell.pub, 1, A);
  s.add(2);
  s.append('gap', { item: '', state: '', answer: '', meta: ['suspend', 125_000] });
  s.append('integrity', { item: '', state: '', answer: '', meta: ['test-mode', 'journal key not in the OS keychain'] });
  expect(rej(await n.sync({ entries: s.entries, streams: [] }))).toEqual([]);
  n.note('HANDOVER', s.ctx, 4, { keyEpoch: 2, fromSeq: 4, via: 'pin', approvedBy: 'INV-42-A', creditedMs: 108_000 });
  const ev = n.events(0);
  expect(ev.map((e) => [e.code, e.cand, e.seq, e.data])).toEqual([
    ['GAP', 'C0001', 3, { cause: 'suspend', pausedMs: 125_000 }],
    ['INTEGRITY', 'C0001', 4, { code: 'test-mode' }],
    ['HANDOVER', 'C0001', 4, { keyEpoch: 2, fromSeq: 4, via: 'pin', approvedBy: 'INV-42-A', creditedMs: 108_000 }],
  ]);
  expect(n.events(ev[1].id).length).toBe(1);
  expect(ev.every((e) => e.cell === 'cell-1' && e.centre === '')).toBe(true);
  const snap = n.snapshot(s.ctx)!;
  expect([snap.head, snap.activeMs, snap.bodies.length, snap.rxAt(1), snap.submitted]).toEqual([4, 4_000, 4, 5_000, false]);
  expect(n.snapshot({ ...s.ctx, cand: 'C0404' })).toBeUndefined();
  n.close();
});

test('store: a Stage 3 database gains rx_wall, cell_rx and evidence.env in place', () => {
  const dir = mkdtempSync(join(tmpdir(), 'saakshi-mig-'));
  const path = join(dir, 'old.db');
  const old = new Database(path, { create: true });
  old.run(`CREATE TABLE entries (exam TEXT NOT NULL, shift TEXT NOT NULL, attempt INTEGER NOT NULL, cand TEXT NOT NULL, seq INTEGER NOT NULL,
    key_epoch INTEGER NOT NULL, h TEXT NOT NULL, line TEXT NOT NULL, env BLOB NOT NULL, PRIMARY KEY (exam, shift, attempt, cand, seq)) WITHOUT ROWID`);
  old.run('CREATE TABLE evidence (id INTEGER PRIMARY KEY, at INTEGER NOT NULL, code TEXT NOT NULL, stream TEXT NOT NULL, seq INTEGER NOT NULL, reason TEXT NOT NULL, line TEXT NOT NULL)');
  old.close();
  const { db } = openDb(path);
  const cols = (t: string) => (db.query(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name);
  expect(cols('entries')).toEqual(expect.arrayContaining(['rx_wall', 'cell_rx']));
  expect(cols('evidence')).toContain('env');
  db.close();
  openDb(path).db.close();                                                     // idempotent
  rmSync(dir, { recursive: true, force: true });
});

test('forwarder: one RoundSample per send, with its time, outcome, backlog and replay state', async () => {
  const relay = node('relay');
  const s = new SimSeat(keys, 'C0001', cell.pub, 1, A);
  s.add(4);
  await relay.n.sync({ entries: s.entries, streams: [] });
  const samples: RoundSample[] = [];
  let fail = true;
  const c = node('cell');
  const fwd = new Forwarder(relay.n, async (req) => { if (fail) throw new Error('down'); return c.n.sync(req); }, { onRound: (r) => samples.push(r) });
  await fwd.round();
  fail = false;
  await fwd.round(); await fwd.round();
  expect(samples.map((x) => [x.ok, x.backlog, x.replaying])).toEqual([[false, 4, false], [true, 4, false], [true, 4, false]]);
  expect(samples.every((x) => x.ms >= 0 && x.at > 0)).toBe(true);
  relay.n.close(); c.n.close();
});
