import { afterEach, beforeEach, expect, test } from 'bun:test';
import type { Database } from 'bun:sqlite';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hexToBytes, toHex } from '@saakshi/core/bytes';
import { cellKey, type KeysFile } from '@saakshi/core/dev';
import type { CellStats, Directory } from '@saakshi/core/directory';
import { checkWireBind, type WireBind } from '@saakshi/core/enrol';
import { newKeyPair, verifier } from '@saakshi/core/node';
import type { NodeState, StreamView } from '@saakshi/core/wire';
import { Bindings, type EnrolResult } from '../src/bindings.ts';
import { cellRoutes } from '../src/cell-routes.ts';
import { ReleaseStore } from '../src/release-store.ts';
import type { Routes } from '../src/serve.ts';
import { openDb } from '../src/store.ts';
import { simBindReq, simCustody } from '../../../tools/sim-custody.ts';

const keys = JSON.parse(readFileSync(new URL('../../../fixtures/keys.json', import.meta.url), 'utf8')) as KeysFile;
const cell = cellKey(keys, 'cell-1'), cust = simCustody(keys);
const e = (centre: string, form: 'F1' | 'F2' = 'F1') => ({ centre, form, extraMs: 0, pseud: '7'.repeat(64) });
const dir = { v: 1, exam: 'DEMO-2026', shift: 'S1', durationMs: 1_800_000, demoCentre: 'CEN042', issuedAt: 0, cells: [],
  centres: { CEN042: { cell: 'cell-1' }, CEN001: { cell: 'cell-1' }, CEN002: { cell: 'cell-2' } },
  cands: { C0001: e('CEN042'), C0002: e('CEN042', 'F2'), C00001: e('CEN001'), C00002: e('CEN002') } } as unknown as Directory;
let tmp: string, db: Database, routes: Routes, state: NodeState, views: StreamView[], submitted: string[];
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'saakshi-cellr-'));
  ({ db } = openDb(join(tmp, 'cell.db')));
  state = 'LIVE'; views = []; submitted = [];
  routes = cellRoutes({
    cellId: 'cell-1', dir, bindings: new Bindings(db, { exam: 'DEMO-2026', shift: 'S1', cell: { ...cell } }),
    releases: new ReleaseStore(db, { exam: 'DEMO-2026', shift: 'S1', manifest: cust.manifest.manifest, authority: verifier(hexToBytes(keys.authority.pub)), requireSig: true }),
    state: () => state, views: () => views, submitted: () => submitted,
  });
});
afterEach(() => { db.close(); rmSync(tmp, { recursive: true, force: true }); });
const srv = { timeout() {} };
async function call<T>(path: string, method: 'GET' | 'POST', body?: unknown): Promise<{ status: number; body: T }> {
  const r = await routes[path][method]!(new Request(`http://cell${path}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }), srv);
  return { status: r.status, body: (await r.json()) as T };
}

test('enrol in a batch: registered seats get certificates; a candidate on another cell is NOT_REGISTERED; a malformed item is BAD; 503 while REBUILDING', async () => {
  const seat = newKeyPair();
  const r = await call<{ results: EnrolResult[] }>('/v1/enrol', 'POST', { enrols: [simBindReq('C0001', seat, cell.pub), simBindReq('C00002', newKeyPair(), cell.pub), { cand: 'C0002' }] });
  expect(r.status).toBe(200);
  const [ok, other, bad] = r.body.results;
  if (!ok.ok) throw new Error(ok.error);
  expect(checkWireBind(ok.bind, cell.pub).pub).toBe(toHex(seat.pub));
  expect([other, bad].map((x) => !x.ok && x.code)).toEqual(['NOT_REGISTERED', 'BAD']);
  expect((await call('/v1/enrol', 'POST', { enrols: 'nope' })).status).toBe(400);
  state = 'REBUILDING';
  expect((await call('/v1/enrol', 'POST', { enrols: [] })).status).toBe(503);
});

test('release push: control\'s signed release is kept; an unsigned one or a key off kc_f is refused with 400', async () => {
  expect((await call<{ accepted: number }>('/v1/release', 'POST', { releases: [cust.release('F1'), cust.release('F2')] })).body.accepted).toBe(2);
  expect((await call('/v1/release', 'POST', { releases: [{ ...cust.release('F1'), sig: '', via: 'code' }] })).status).toBe(400);
  const off = await call<{ errors: string[] }>('/v1/release', 'POST', { releases: [{ ...cust.release('F2'), key: '00'.repeat(32) }] });
  expect([off.status, off.body.errors[0]]).toEqual([400, expect.stringContaining('kc_f')]);
});

test('/v1/binds lists certificates a verifier accepts; /v1/stats counts per centre on this cell only', async () => {
  await call('/v1/enrol', 'POST', { enrols: [simBindReq('C0001', newKeyPair(), cell.pub), simBindReq('C00001', newKeyPair(), cell.pub)] });
  const { binds } = (await call<{ binds: WireBind[] }>('/v1/binds', 'GET')).body;
  expect(binds.map((b) => checkWireBind(b, cell.pub).cand).sort()).toEqual(['C00001', 'C0001']);
  const v = (cand: string, head: number, exam = 'DEMO-2026'): StreamView => ({ exam, shift: 'S1', attempt: 1, cand, head, cellHead: head, senderHead: head, seenAt: 1 });
  views = [v('C0001', 22), v('C0002', 0), v('C00001', 3), v('C00001', 9, 'OTHER-EXAM'), v('ZZZ', 5)];
  submitted = ['C0001'];
  expect((await call<CellStats>('/v1/stats', 'GET')).body).toEqual({
    cell: 'cell-1', state: 'LIVE', entries: 25,
    centres: {
      CEN042: { registered: 2, bound: 1, unlocked: 1, submitted: 1, entries: 22 },
      CEN001: { registered: 1, bound: 1, unlocked: 1, submitted: 0, entries: 3 },
    },
  });
});
