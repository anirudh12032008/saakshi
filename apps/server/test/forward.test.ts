import { afterEach, beforeEach, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ackMessage } from '@saakshi/core/ack';
import { hexToBytes } from '@saakshi/core/bytes';
import { cellKey, devSeatKey, type KeysFile } from '@saakshi/core/dev';
import { nobleVerifier } from '@saakshi/core/sig';
import type { SyncRes } from '@saakshi/core/wire';
import { Forwarder } from '../src/forward.ts';
import { createIngest, type Ingest, type Mode } from '../src/ingest.ts';
import { openDb } from '../src/store.ts';
import { SimSeat } from '../../../tools/sim-seat.ts';
import { newKeyPair } from '@saakshi/core/node';
import type { ReleaseMsg } from '@saakshi/core/paper';
import type { SyncReq } from '@saakshi/core/wire';
import { Bindings } from '../src/bindings.ts';
import { simBindReq, simCustody } from '../../../tools/sim-custody.ts';

const keys = JSON.parse(readFileSync(new URL('../../../fixtures/keys.json', import.meta.url), 'utf8')) as KeysFile;
const cell = cellKey(keys, 'cell-1');
let dir: string;
const opened: Ingest[] = [];
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'saakshi-fwd-')); });
afterEach(() => { for (const n of opened.splice(0)) n.close(); rmSync(dir, { recursive: true, force: true }); });

function mk(mode: Mode, name: string, fresh = false, seatKey = devSeatKey(keys)): Ingest {
  const { db } = openDb(join(dir, `${name}.db`));
  const n = createIngest({ mode, db, fresh, seatKey, cell: mode === 'cell' ? cell : { pub: cell.pub } });
  opened.push(n);
  return n;
}
async function seatPush(relay: Ingest, s: SimSeat): Promise<SyncRes> {
  const r = await relay.sync({ entries: s.entries, streams: [{ ...s.ctx, head: s.head }] });
  if (r === 'REBUILDING') throw new Error('relay never rebuilds');
  return r;
}
async function drain(f: Forwarder, max = 500): Promise<void> {
  for (let i = 0; i < max; i++) if ((await f.round()) === 'idle') return;
  throw new Error('forwarder never went idle');
}
const evidence = (name: string) => { const d = new Database(join(dir, `${name}.db`)); try { return d.query('SELECT code FROM evidence').all(); } finally { d.close(); } };

test('forwards committed entries; the relay hands the seat a cell ack that verifies', async () => {
  const relay = mk('relay', 'relay'), c = mk('cell', 'cell');
  const f = new Forwarder(relay, (req) => c.sync(req));
  const s = new SimSeat(keys, 'C0001', cell.pub);
  s.add(30);
  await seatPush(relay, s);
  await drain(f);
  expect(relay.views()[0]).toMatchObject({ head: 30, cellHead: 30 });
  const st = (await seatPush(relay, s)).streams[0];              // the seat's next resend is a no-op carrying the ack
  expect(st.ack?.seq).toBe(30);
  expect(nobleVerifier(cell.pub)(ackMessage({ ...s.ctx, keyEpoch: 1, seq: 30, h: s.hs[29] }), hexToBytes(st.ack!.sig))).toBe(true);
});

test('cell down: the relay keeps acking (✓✓) and catches the cell up when it returns', async () => {
  const relay = mk('relay', 'relay'), c = mk('cell', 'cell');
  let up = false;
  const f = new Forwarder(relay, async (req) => { if (!up) throw new Error('connect ECONNREFUSED'); return c.sync(req); });
  const s = new SimSeat(keys, 'C0001', cell.pub);
  s.add(10);
  expect((await seatPush(relay, s)).streams[0].head).toBe(10);
  expect(await f.round()).toBe('error');
  up = true;
  await drain(f);
  expect(relay.views()[0].cellHead).toBe(10);
});

test('cell SIGKILL after COMMIT but before the ack: the resend is a no-op and nothing is lost', async () => {
  const relay = mk('relay', 'relay');
  let target = mk('cell', 'cell');
  let dropReply = true;
  const f = new Forwarder(relay, async (req) => {
    const res = await target.sync(req);
    if (dropReply && req.entries.length) { dropReply = false; throw new Error('socket hang up'); }
    return res;
  });
  const s = new SimSeat(keys, 'C0001', cell.pub);
  s.add(20);
  await seatPush(relay, s);
  await f.round();                                                // hello: learns cellHead 0
  expect(await f.round()).toBe('error');                          // cell committed 20, the reply was lost
  target.close();
  target = mk('cell', 'cell');                                    // restart on the same DB
  expect(target.views()[0].head).toBe(20);
  await drain(f);
  expect(relay.views()[0].cellHead).toBe(20);
  expect(evidence('cell')).toEqual([]);                           // no FORK, no BAD_SUBMISSION
});

test('a wiped cell REBUILDs: 503 for live traffic, the relay replays from genesis, heads end identical', async () => {
  const relay = mk('relay', 'relay');
  const a = new SimSeat(keys, 'C0001', cell.pub), b = new SimSeat(keys, 'C0002', cell.pub);
  a.add(25); b.add(7);
  await seatPush(relay, a);
  await seatPush(relay, b);
  const c = mk('cell', 'cell', true);
  expect(await c.sync({ entries: [], streams: [] })).toBe('REBUILDING');
  const f = new Forwarder(relay, (req) => c.sync(req));
  await drain(f);
  expect(c.state()).toBe('LIVE');
  expect(f.replaying).toBe(false);
  const heads = (n: Ingest) => n.views().map((v) => [v.cand, v.head]).sort();
  expect(heads(c)).toEqual(heads(relay));
  expect(relay.views().every((v) => v.cellHead === v.head)).toBe(true);
});

test('with nothing pending, the heartbeat still notices a wiped cell and rebuilds it', async () => {
  const relay = mk('relay', 'relay');
  let target = mk('cell', 'cell');
  const f = new Forwarder(relay, (req) => target.sync(req), { heartbeatMs: 0 });
  const s = new SimSeat(keys, 'C0001', cell.pub);
  s.add(12);
  await seatPush(relay, s);
  await drain(f);
  expect(relay.views()[0].cellHead).toBe(12);
  target = mk('cell', 'wiped', true);                             // the DB is gone; the seat is silent
  await drain(f);                                                 // heartbeat → 503 → replay → done
  expect(target.state()).toBe('LIVE');
  expect(target.views()[0].head).toBe(12);
});

test('a cell that rejects everything makes the forwarder back off instead of spinning', async () => {
  const relay = mk('relay', 'relay'), c = mk('cell', 'cell', false, () => undefined);   // cell knows no seat keys
  const s = new SimSeat(keys, 'C0001', cell.pub);
  s.add(3);
  await seatPush(relay, s);
  const f = new Forwarder(relay, (req) => c.sync(req));
  expect(await f.round()).toBe('busy');                           // hello: cellHead −1 → 0
  expect(await f.round()).toBe('error');                          // 3 entries rejected, no progress
});

function bound(name: string, mode: Mode, fresh = false) {
  const { db } = openDb(join(dir, `${name}.db`));
  const b = new Bindings(db, { exam: 'DEMO-2026', shift: 'S1', cell: mode === 'cell' ? cell : { id: 'cell-1', pub: cell.pub } });
  const n = createIngest({ mode, db, fresh, seatKey: b.seatKey, acceptBinds: (x) => b.acceptAll(x), cell: mode === 'cell' ? cell : { pub: cell.pub } });
  opened.push(n);
  return { n, b };
}

test('Review Focus #5: after the cell loses its DB, the replay carries the binds before the entries and the rebuilt cell accepts every entry', async () => {
  const relay = bound('relay', 'relay'), c1 = bound('cell1', 'cell');
  const seat = newKeyPair();
  const e = c1.b.enrol(simBindReq('C0001', seat, cell.pub), true);
  if (!e.ok) throw new Error(e.error);
  expect(relay.b.accept(e.bind)).toBeUndefined();
  const s = new SimSeat(keys, 'C0001', cell.pub, 1, seat);
  s.add(25);
  await seatPush(relay.n, s);
  await drain(new Forwarder(relay.n, (req) => c1.n.sync(req), { bindFor: (x) => relay.b.forCand(x.cand) }));
  expect(c1.n.views()[0].head).toBe(25);

  const c2 = bound('cell2', 'cell', true);                                         // the disk died: a fresh DB that knows no binding
  expect([c2.n.state(), c2.b.seatKey('C0001', 1)]).toEqual(['REBUILDING', undefined]);
  const sent: SyncReq[] = [];
  await drain(new Forwarder(relay.n, (req) => { sent.push(req); return c2.n.sync(req); }, { bindFor: (x) => relay.b.forCand(x.cand) }));
  expect(c2.n.state()).toBe('LIVE');
  expect(sent.find((r) => r.entries.length)!.binds).toEqual([e.bind]);
  expect(c2.n.views()[0].head).toBe(25);
  expect(evidence('cell2')).toEqual([]);
});

test('Stage 3: a relay with no seats still asks for releases on its heartbeat, and keeps what the cell sends', async () => {
  const cust = simCustody(keys);
  const { db } = openDb(join(dir, 'cellr.db'));
  const c = createIngest({ mode: 'cell', db, fresh: false, seatKey: devSeatKey(keys), cell, releases: () => [cust.release('F1'), cust.release('F2')] });
  opened.push(c);
  const relay = mk('relay', 'relay'), got: ReleaseMsg[] = [];
  const f = new Forwarder(relay, (req) => c.sync(req), { heartbeatMs: 0, releases: { count: () => got.length, accept: (r) => got.push(r) } });
  expect(relay.views()).toEqual([]);
  await f.round();
  expect(got.map((r) => r.form)).toEqual(['F1', 'F2']);
  await f.round();
  expect(got.length).toBe(2);                                                      // have = 2: nothing resent
});
