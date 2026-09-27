import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { toHex, utf8 } from '@saakshi/core/bytes';
import { canon } from '@saakshi/core/canon';
import { cellKey, type KeysFile } from '@saakshi/core/dev';
import { bindArray, type Bind } from '@saakshi/core/enrol';
import type { HandoverGrant, HandoverReq } from '@saakshi/core/handover';
import { newKeyPair, signer } from '@saakshi/core/node';
import { Bindings } from '../src/bindings.ts';
import { moveKey, relayHandover } from '../src/relay-handover.ts';
import { openDb } from '../src/store.ts';
import { simBindReq } from '../../../tools/sim-custody.ts';

const keys = JSON.parse(readFileSync(new URL('../../../fixtures/keys.json', import.meta.url), 'utf8')) as KeysFile;
const cell = cellKey(keys, 'cell-1'), X = { exam: 'DEMO-2026', shift: 'S1' }, ctx = { ...X, attempt: 1, cand: 'C0001' };
const signC = signer(cell);

function setup(script: { status: number; body: Record<string, unknown> }[] = []) {
  const { db } = openDb(':memory:');
  const bindings = new Bindings(db, { ...X, cell: { id: 'cell-1', pub: cell.pub } });
  const origin = new Bindings(openDb(':memory:').db, { ...X, cell });
  const e = origin.enrol(simBindReq('C0001', newKeyPair(), cell.pub, 'CEN042-S01'), true);
  if (!e.ok) throw new Error(e.error);
  bindings.accept(e.bind);
  const seatB = newKeyPair(), pub = toHex(seatB.pub);
  const b2: Bind = { ...ctx, seatId: 'CEN042-S02', pub, keyEpoch: 2, fromSeq: 6, attestHash: 'b'.repeat(64) };
  const cert = canon(bindArray(b2));
  const grant = { bind: { cert, sig: toHex(signC(utf8(cert))), cell: 'cell-1', pinBox: 'ab' }, grant: { ...ctx, keyEpoch: 2, fromSeq: 6, fromHead: 'e'.repeat(64), activeMs: 6_000, creditedMs: 108_000, respHash: 'f'.repeat(64) },
    sig: 'c'.repeat(128), restore: 'dd', via: 'pin', approvedBy: 'INV-42-A' } as HandoverGrant;
  const calls: Record<string, unknown>[] = [], logs: string[] = [];
  const answers = [...script];
  const fetch = (async (_url: string, init: RequestInit) => {
    calls.push(JSON.parse(String(init.body)));
    const a = answers.shift() ?? { status: 200, body: grant as unknown as Record<string, unknown> };
    return Response.json(a.body, { status: a.status });
  }) as unknown as typeof globalThis.fetch;
  const routes = relayHandover({ ...X, cellUrl: 'http://cell', bindings, head: () => ({ seq: 6, h: 'e'.repeat(64) }), fetch, log: (l) => logs.push(l), retryMs: 1, now: () => 5_000 });
  const req: HandoverReq = { ...ctx, seatId: 'CEN042-S02', pub, attestHash: 'b'.repeat(64), pinBox: 'ab', proof: { via: 'pin', pin: 'cd' } };
  const call = async (path: string, method: 'GET' | 'POST', body?: unknown) => {
    const r = await routes[path][method]!(new Request(`http://relay${path}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }), { timeout() {} });
    return { status: r.status, body: (await r.json()) as Record<string, any> };
  };
  return { bindings, pub, key: moveKey(pub), req, calls, logs, call, grant };
}

test('a PIN move waits for the invigilator; approval adds the relay\'s head; BEHIND is retried; the relay keeps the new binding', async () => {
  const t = setup([{ status: 409, body: { code: 'BEHIND', error: 'the exam server has 5 of 6 entries' } }]);
  expect(await t.call('/v1/handover', 'POST', t.req)).toEqual({ status: 202, body: { state: 'pending' } });
  expect(t.calls).toEqual([]);                                                        // nothing reaches the cell before approval
  const pending = (await t.call('/v1/handover/pending', 'GET')).body.pending;
  expect(pending).toEqual([{ cand: 'C0001', seatId: 'CEN042-S02', key: t.key, at: 5_000, error: '' }]);
  expect(JSON.stringify(pending)).not.toContain('"cd"');                              // the sealed PIN box is never listed
  const ok = await t.call('/v1/handover/approve', 'POST', { cand: 'C0001', key: t.key, invigilator: ' INV-42-A ' });
  expect(ok).toEqual({ status: 200, body: { state: 'granted', keyEpoch: 2, fromSeq: 6, creditedMs: 108_000 } });
  expect(t.calls.length).toBe(2);
  expect(t.calls[1]).toMatchObject({ approval: { by: 'INV-42-A' }, fromSeq: 6, fromHead: 'e'.repeat(64), req: { cand: 'C0001', pub: t.pub } });
  expect(t.bindings.seatKey('C0001', 2)).toBeDefined();
  expect((await t.call('/v1/handover', 'POST', t.req))).toMatchObject({ status: 200, body: { state: 'granted', grant: t.grant } });
  expect(t.logs.map((l) => l.split(' ')[0])).toEqual(['HANDOVER-REQUEST', 'HANDOVER-GRANTED']);
});

test('Review Focus #3: two approvals at once share one forward; a wrong PIN refuses the move and the seat can ask again', async () => {
  const t = setup();
  await t.call('/v1/handover', 'POST', t.req);
  const both = await Promise.all([1, 2].map(() => t.call('/v1/handover/approve', 'POST', { cand: 'C0001', key: t.key, invigilator: 'INV-42-A' })));
  expect(both.map((r) => r.status)).toEqual([200, 200]);
  expect(t.calls.length).toBe(1);

  const w = setup([{ status: 409, body: { code: 'PIN_WRONG', error: 'wrong PIN — 2 tries left', left: 2 } }]);
  await w.call('/v1/handover', 'POST', w.req);
  expect(await w.call('/v1/handover/approve', 'POST', { cand: 'C0001', key: w.key, invigilator: 'INV' })).toMatchObject({ status: 409, body: { code: 'PIN_WRONG' } });
  expect(await w.call('/v1/handover', 'POST', w.req)).toEqual({ status: 202, body: { state: 'pending' } });   // a fresh request replaces the refused one
});

test('refuse, the old-key path, a cell that cannot be reached, and bad input', async () => {
  const t = setup();
  await t.call('/v1/handover', 'POST', t.req);
  expect((await t.call('/v1/handover/refuse', 'POST', { cand: 'C0001', key: t.key })).body).toEqual({ state: 'refused' });
  expect(await t.call('/v1/handover', 'POST', t.req)).toEqual({ status: 202, body: { state: 'pending' } });

  const k = setup();
  const byKey = { ...k.req, proof: { via: 'key' as const, keyEpoch: 1, fromSeq: 6, fromHead: 'e'.repeat(64), sig: 'a'.repeat(128) } };
  expect((await k.call('/v1/handover', 'POST', byKey)).status).toBe(200);             // forwarded at once, no approval
  expect(k.calls[0]).not.toHaveProperty('approval');
  expect(k.calls[0]).not.toHaveProperty('fromSeq');                                   // the signed claim carries it

  const d = setup();
  const routes = relayHandover({ ...X, cellUrl: 'http://cell', bindings: d.bindings, head: () => ({ seq: 6, h: 'e'.repeat(64) }), fetch: (async () => { throw new Error('ECONNREFUSED'); }) as unknown as typeof fetch });
  const post = (path: string, body: unknown) => routes[path].POST!(new Request(`http://relay${path}`, { method: 'POST', body: JSON.stringify(body) }), { timeout() {} });
  await post('/v1/handover', d.req);
  const r = await post('/v1/handover/approve', { cand: 'C0001', key: d.key, invigilator: 'INV' });
  expect([r.status, ((await r.json()) as { error: string }).error]).toEqual([202, expect.stringContaining('unreachable')]);

  expect((await t.call('/v1/handover', 'POST', { nope: 1 })).status).toBe(400);
  expect((await t.call('/v1/handover', 'POST', { ...t.req, exam: 'OTHER' })).status).toBe(400);
  expect((await t.call('/v1/handover/approve', 'POST', { cand: 'C0001', key: t.key })).status).toBe(400);
  expect((await t.call('/v1/handover/approve', 'POST', { cand: 'C0001', key: 'ffff', invigilator: 'INV' })).status).toBe(404);
});
