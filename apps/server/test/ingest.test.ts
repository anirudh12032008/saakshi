import { afterEach, beforeEach, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hexToBytes } from '@saakshi/core/bytes';
import { ackMessage } from '@saakshi/core/ack';
import { cellKey, devSeat, devSeatKey, type KeysFile } from '@saakshi/core/dev';
import { signedLine } from '@saakshi/core/journal';
import { sealBody, signer } from '@saakshi/core/node';
import type { Header } from '@saakshi/core/protocol';
import { nobleVerifier } from '@saakshi/core/sig';
import { toB64, type SyncRes } from '@saakshi/core/wire';
import { createIngest, type Ingest, type IngestOpts, type Mode } from '../src/ingest.ts';
import { openDb } from '../src/store.ts';
import { SimSeat } from '../../../tools/sim-seat.ts';

const keys = JSON.parse(readFileSync(new URL('../../../fixtures/keys.json', import.meta.url), 'utf8')) as KeysFile;
const cell = cellKey(keys, 'cell-1');
let dir: string;
const opened: Ingest[] = [];
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'saakshi-ingest-')); });
afterEach(() => { for (const n of opened.splice(0)) n.close(); rmSync(dir, { recursive: true, force: true }); });

/** A node on dir/<name>.db. `fresh` defaults to false so cells start LIVE unless a test is about rebuilding. */
function node(mode: Mode, o: { name?: string; fresh?: boolean } & Partial<IngestOpts> = {}): Ingest {
  const { db } = openDb(join(dir, `${o.name ?? mode}.db`));
  const n = createIngest({ mode, db, fresh: o.fresh ?? false, seatKey: devSeatKey(keys), cell: mode === 'cell' ? cell : { pub: cell.pub }, ...o });
  opened.push(n);
  return n;
}
const ok = (r: SyncRes | 'REBUILDING'): SyncRes => { if (r === 'REBUILDING') throw new Error('unexpected REBUILDING'); return r; };
const push = async (n: Ingest, s: SimSeat, entries = s.entries) => ok(await n.sync({ entries, streams: [{ ...s.ctx, head: s.head }] }));
const rows = (name: string, table = 'entries'): { code?: string }[] => { const d = new Database(join(dir, `${name}.db`)); try { return d.query(`SELECT * FROM ${table}`).all() as { code?: string }[]; } finally { d.close(); } };

for (const mode of ['relay', 'cell'] as const) {
  test(`${mode}: accepts a valid chain and reports head and headH`, async () => {
    const n = node(mode), s = new SimSeat(keys, 'C0001', cell.pub);
    s.add(5);
    const r = await push(n, s);
    expect(r.rejected).toEqual([]);
    expect(r.streams[0]).toMatchObject({ cand: 'C0001', head: 5, headH: s.hs[4], need: false });
    expect(rows(mode).length).toBe(5);
  });

  test(`${mode}: an exact resend is a no-op`, async () => {
    const n = node(mode), s = new SimSeat(keys, 'C0001', cell.pub);
    s.add(5);
    await push(n, s);
    const r = await push(n, s);
    expect(r.rejected).toEqual([]);
    expect(r.streams[0].head).toBe(5);
    expect(rows(mode).length).toBe(5);
    expect(rows(mode, 'evidence')).toEqual([]);
  });

  test(`${mode}: a gap is answered with NEED and the sender resends from head+1`, async () => {
    const n = node(mode), s = new SimSeat(keys, 'C0001', cell.pub);
    s.add(6);
    await push(n, s, s.entries.slice(0, 2));
    const r = await push(n, s, s.entries.slice(4));
    expect(r.streams[0]).toMatchObject({ head: 2, need: true });
    expect(r.rejected).toEqual([]);
    const r2 = await push(n, s, s.after(r.streams[0].head));
    expect(r2.streams[0]).toMatchObject({ head: 6, need: false });
  });

  test(`${mode}: an invalid signature at a stored seq is BAD_SUBMISSION, never FORK`, async () => {
    const n = node(mode), s = new SimSeat(keys, 'C0001', cell.pub);
    s.add(3);
    await push(n, s);
    const other: Header = { ...s.headers[1], bodyCommit: 'ab'.repeat(32) };
    const foreignKey = { line: signedLine(other, signer(devSeat(keys, 'C0002')!)), env: s.entries[1].env };
    const flipped = { line: s.entries[2].line.replace(/"([0-9a-f])([0-9a-f]{127})"\]$/, (_, a: string, b: string) => `"${a === '0' ? '1' : '0'}${b}"]`), env: s.entries[2].env };
    const garbage = { line: 'not json', env: '' };
    const r = ok(await n.sync({ entries: [foreignKey, flipped, garbage], streams: [] }));
    expect(r.rejected.map((x) => x.code)).toEqual(['BAD_SUBMISSION', 'BAD_SUBMISSION', 'BAD_SUBMISSION']);
    expect(r.streams[0].head).toBe(3);
    expect(rows(mode, 'evidence').map((e) => e.code)).toEqual(['BAD_SUBMISSION', 'BAD_SUBMISSION', 'BAD_SUBMISSION']);
  });

  test(`${mode}: a validly signed different entry at a stored seq, or a broken prev, is FORK`, async () => {
    const n = node(mode), s = new SimSeat(keys, 'C0001', cell.pub);
    s.add(3);
    await push(n, s);
    const badPrev = s.make(4, 'cd'.repeat(32), 'A').entry;
    const r = ok(await n.sync({ entries: [s.alt(2), badPrev], streams: [] }));
    expect(r.rejected.map((x) => x.code)).toEqual(['FORK', 'FORK']);
    expect(r.streams[0].head).toBe(3);
    expect(rows(mode, 'evidence').map((e) => e.code)).toEqual(['FORK', 'FORK']);
  });

  test(`${mode}: an unknown key epoch, seq 0 and a short envelope are BAD_SUBMISSION`, async () => {
    const n = node(mode);
    const e2 = new SimSeat(keys, 'C0001', cell.pub, 2); e2.add(1);
    const s = new SimSeat(keys, 'C0002', cell.pub);
    const seq0 = s.make(0, 'ab'.repeat(32), 'A').entry;
    s.add(1);
    const short = { line: s.entries[0].line, env: toB64(new Uint8Array(40)) };
    const r = ok(await n.sync({ entries: [e2.entries[0], seq0, short], streams: [] }));
    expect(r.rejected.map((x) => [x.code, x.reason.split(' ')[0]])).toEqual([['BAD_SUBMISSION', 'no'], ['BAD_SUBMISSION', 'seq'], ['BAD_SUBMISSION', 'envelope']]);
  });

  test(`${mode}: a hello alone returns status and updates the seat grid view`, async () => {
    const seen: number[] = [];
    const n = node(mode, { onView: (v) => seen.push(v.senderHead), now: () => 1_000 });
    const r = ok(await n.sync({ entries: [], streams: [{ exam: 'DEMO-2026', shift: 'S1', attempt: 1, cand: 'C0004', head: 7 }] }));
    expect(r.streams[0]).toMatchObject({ cand: 'C0004', head: 0, headH: '', need: false });
    expect(n.views()[0]).toMatchObject({ cand: 'C0004', head: 0, senderHead: 7, seenAt: 1_000 });
    expect(seen).toEqual([7]);
  });
}

test('cell: a body that does not open or does not match bodyCommit is BAD_SUBMISSION; the relay cannot tell', async () => {
  const s = new SimSeat(keys, 'C0001', cell.pub);
  s.add(3);
  const swapped = [s.entries[0], { line: s.entries[1].line, env: s.entries[2].env }];
  const c = ok(await node('cell').sync({ entries: swapped, streams: [] }));
  expect(c.rejected).toEqual([{ index: 1, code: 'BAD_SUBMISSION', reason: expect.stringMatching(/^body:/) }]);
  const r = ok(await node('relay').sync({ entries: swapped, streams: [] }));
  expect(r.rejected).toEqual([]);
});

test('relay: stores only headers and sealed envelopes — no answer text reaches its disk', async () => {
  const s = new SimSeat(keys, 'C0001', cell.pub);
  s.add(1);
  const marker = 'हिन्दी-SECRET-ANSWER';
  const { entry } = s.make(2, s.hs[0], 'B', { item: 'I17', state: 'A', answer: 'B', meta: [4200, [marker]] });
  const relay = node('relay');
  expect(ok(await relay.sync({ entries: [s.entries[0], entry], streams: [] })).rejected).toEqual([]);
  relay.close();
  const bytes = readFileSync(join(dir, 'relay.db'));
  const wal = (() => { try { return readFileSync(join(dir, 'relay.db-wal')); } catch { return Buffer.alloc(0); } })();
  expect(Buffer.concat([bytes, wal]).includes(Buffer.from(marker))).toBe(false);
});

test('cell: the countersigned ack covers the head h and verifies under the cell public key (native and noble)', async () => {
  const s = new SimSeat(keys, 'C0001', cell.pub);
  s.add(4);
  const st = (await push(node('cell'), s)).streams[0];
  expect(st.ack).toMatchObject({ keyEpoch: 1, seq: 4, h: s.hs[3] });
  expect(nobleVerifier(cell.pub)(ackMessage({ ...s.ctx, keyEpoch: 1, seq: 4, h: s.hs[3] }), hexToBytes(st.ack!.sig))).toBe(true);
});

test('cell restart: heads reload from disk, a resend is a no-op, and acks from the file-held key still verify', async () => {
  const s = new SimSeat(keys, 'C0001', cell.pub);
  s.add(8);
  const first = node('cell');
  await push(first, s);
  first.close();
  const again = node('cell');
  expect(again.views()[0]).toMatchObject({ cand: 'C0001', head: 8 });
  const r = await push(again, s);
  expect(r.rejected).toEqual([]);
  expect(nobleVerifier(cell.pub)(ackMessage({ ...s.ctx, keyEpoch: 1, seq: 8, h: s.hs[7] }), hexToBytes(r.streams[0].ack!.sig))).toBe(true);
  expect(rows('cell').length).toBe(8);
});

test('cell REBUILDING: 503 for live traffic, replay accepted, LIVE after done, and the state survives a crash mid-rebuild', async () => {
  const s = new SimSeat(keys, 'C0001', cell.pub);
  s.add(5);
  const states: string[] = [];
  const c = node('cell', { fresh: true, onState: (x) => states.push(x) });
  expect(c.state()).toBe('REBUILDING');
  expect(await c.sync({ entries: s.entries, streams: [] })).toBe('REBUILDING');
  ok(await c.sync({ entries: s.entries.slice(0, 3), streams: [], replay: true }));
  c.close();                                                       // killed mid-rebuild
  const c2 = node('cell');                                         // file exists now, so fresh = false
  expect(c2.state()).toBe('REBUILDING');
  ok(await c2.sync({ entries: s.after(3), streams: [], replay: true }));
  ok(await c2.sync({ entries: [], streams: [], replay: true, done: true }));
  expect(c2.state()).toBe('LIVE');
  expect(c2.views()[0].head).toBe(5);
  c2.close();
  expect(node('cell').state()).toBe('LIVE');
  expect(states).toEqual([]);                                      // first node never reached LIVE
});

test('relay: keeps only cell acks that verify over its own h; resetCell forgets them', async () => {
  const s = new SimSeat(keys, 'C0001', cell.pub);
  s.add(3);
  const relay = node('relay'), c = node('cell');
  await push(relay, s);
  const st = (await push(c, s)).streams[0];
  expect(relay.setCellStatus({ ...st, ack: { ...st.ack!, sig: st.ack!.sig.replace(/^./, (x) => (x === '0' ? '1' : '0')) } })).toBe(true);
  expect((await push(relay, s)).streams[0].ack).toBeUndefined();
  relay.setCellStatus({ ...st, ack: { ...st.ack!, h: 'ee'.repeat(32) } });
  expect((await push(relay, s)).streams[0].ack).toBeUndefined();
  relay.setCellStatus(st);
  expect((await push(relay, s)).streams[0].ack).toEqual(st.ack);
  expect(relay.views()[0].cellHead).toBe(3);
  relay.resetCell();
  expect(relay.views()[0].cellHead).toBe(0);
  expect((await push(relay, s)).streams[0].ack).toBeUndefined();
});

test('a response is sent only after its rows are committed (visible to another connection)', async () => {
  const n = node('relay'), s = new SimSeat(keys, 'C0005', cell.pub);
  s.add(50);
  await push(n, s);
  expect(rows('relay').length).toBe(50);
  expect(n.entriesAfter(s.ctx, 45, 10).map((e) => e.line)).toEqual(s.entries.slice(45).map((e) => e.line));
});
