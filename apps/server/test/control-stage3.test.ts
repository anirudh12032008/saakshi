import { afterAll, beforeAll, expect, test } from 'bun:test';
import type { Database } from 'bun:sqlite';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hexToBytes, toHex } from '@saakshi/core/bytes';
import { cellKey, devForm, devPseud, devRoster, trustFromKeys, type KeysFile } from '@saakshi/core/dev';
import { newKeyPair } from '@saakshi/core/node';
import { formsOf, type ReconRow } from '@saakshi/core/sheet';
import page from '../src/control.html';
import { Bindings } from '../src/bindings.ts';
import { controlRoutes } from '../src/control.ts';
import { createIngest, type Ingest } from '../src/ingest.ts';
import type { Routes } from '../src/serve.ts';
import { shiftExport } from '../src/sheet-export.ts';
import { openDb } from '../src/store.ts';
import { FORMS, SimSeat } from '../../../tools/sim-seat.ts';
import { simBindReq } from '../../../tools/sim-custody.ts';

const keys = JSON.parse(readFileSync(new URL('../../../fixtures/keys.json', import.meta.url), 'utf8')) as KeysFile;
const cell = cellKey(keys, 'cell-1'), forms = formsOf(FORMS), X = { exam: 'DEMO-2026', shift: 'S1' };
let dir: string, db: Database, n: Ingest, withKeys: Routes, bare: Routes;
const wan: unknown[] = [], servers: ReturnType<typeof Bun.serve>[] = [];

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'saakshi-ctl3-'));
  ({ db } = openDb(join(dir, 'cell.db')));
  const b = new Bindings(db, { ...X, cell });
  n = createIngest({ mode: 'cell', db, fresh: false, seatKey: b.seatKey, acceptBinds: (x) => b.acceptAll(x), cell, forms, formOf: devForm, pseud: devPseud });
  const key = newKeyPair();
  const e = b.enrol(simBindReq('C0001', key, cell.pub, 'CEN042-S01'), true);
  if (!e.ok) throw new Error(e.error);
  const seat = new SimSeat(keys, 'C0001', cell.pub, 1, key);
  seat.add(21); seat.submit();
  const r = await n.sync({ entries: seat.entries, streams: [{ ...seat.ctx, head: seat.head }] });
  if (r === 'REBUILDING' || r.rejected.length) throw new Error(JSON.stringify(r));
  const nf = () => Response.json({ error: 'not found' }, { status: 404 });
  const cellSrv = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: nf, routes: {
    '/v1/shift': { GET: () => Response.json(shiftExport(db, { ...X, cell: 'cell-1', formOf: devForm, pseud: devPseud, seatKey: b.seatKey })) },
  } });
  const relaySrv = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: nf, routes: {
    '/v1/heads': { GET: () => Response.json({ mode: 'relay', state: 'LIVE', streams: [{ ...seat.ctx, head: seat.head, cellHead: seat.head, senderHead: seat.head, seenAt: 1 }] }) },
    '/v1/dev/wan': { POST: async (req) => { const body = await req.json(); wan.push(body); return Response.json(body); } },
  } });
  servers.push(cellSrv, relaySrv);
  const o = {
    authority: { priv: hexToBytes(keys.authority.priv), pub: hexToBytes(keys.authority.pub) }, trust: { ...trustFromKeys(keys), seats: {} },
    forms, formOf: devForm, pseud: devPseud, roster: devRoster(keys), centre: 'CEN042', ...X,
    cellUrl: `http://127.0.0.1:${cellSrv.port}`, relayUrl: `http://127.0.0.1:${relaySrv.port}`,
  };
  withKeys = controlRoutes({ ...o, dir: join(dir, 'c1'), seatKeys: async () => ({ 'C0001/1': toHex(key.pub) }) }, page) as unknown as Routes;
  bare = controlRoutes({ ...o, dir: join(dir, 'c2') }, page) as unknown as Routes;
});
afterAll(() => { for (const s of servers) s.stop(true); n.close(); rmSync(dir, { recursive: true, force: true }); });

async function call<T>(r: Routes, path: string, method: 'GET' | 'POST', body?: unknown): Promise<{ status: number; body: T }> {
  const res = await r[path][method]!(new Request(`http://control${path}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }), { timeout() {} });
  return { status: res.status, body: (await res.json()) as T };
}

test('Stage 3 trust: seal, audit and reconciliation use the enrolled key; without it the candidate is not sealed', async () => {
  expect((await call<{ added: string[]; skipped: { cand: string }[] }>(bare, '/v1/seal', 'POST')).body).toMatchObject({ added: [], skipped: [{ cand: 'C0001' }] });
  expect((await call<{ added: string[] }>(withKeys, '/v1/seal', 'POST')).body.added).toEqual(['C0001']);
  expect((await call<{ findings: unknown[] }>(withKeys, '/v1/audit', 'POST')).body.findings).toEqual([]);
  expect((await call<ReconRow>(withKeys, '/v1/recon', 'GET')).body).toMatchObject({ checkedIn: 1, unlocked: 1, leaves: 1, green: true });
});

test('chaos: "Cut Centre 42\'s link" reaches the relay and is logged; a bad body is 400', async () => {
  expect((await call(withKeys, '/v1/chaos/wan', 'POST', { up: false })).body).toEqual({ up: false });
  expect(wan).toEqual([{ up: false }]);
  expect((await call(withKeys, '/v1/chaos/wan', 'POST', { up: 'no' })).status).toBe(400);
  expect(readFileSync(join(dir, 'c1', 'custody.jsonl'), 'utf8')).toContain('"action":"chaos-wan"');
});
