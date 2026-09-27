import { afterEach, beforeEach, expect, test } from 'bun:test';
import type { Database } from 'bun:sqlite';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hexToBytes, toHex } from '@saakshi/core/bytes';
import { cellKey, devForm, type KeysFile } from '@saakshi/core/dev';
import type { Directory } from '@saakshi/core/directory';
import { makeBindReq, msg, pinRecord } from '@saakshi/core/enrol';
import { checkGrant, handoverArray, sealHandoverPin, type HandoverReq, type StreamSnap } from '@saakshi/core/handover';
import { responsesOf } from '@saakshi/core/log';
import { nativeBox, newKeyPair, signer, verifier, type KeyPair } from '@saakshi/core/node';
import type { CellEvent } from '@saakshi/core/ops';
import { formsOf } from '@saakshi/core/sheet';
import { Bindings } from '../src/bindings.ts';
import { cellRoutes } from '../src/cell-routes.ts';
import { cellHandover } from '../src/handover.ts';
import { ReleaseStore } from '../src/release-store.ts';
import { openDb } from '../src/store.ts';
import { FORMS, SimSeat } from '../../../tools/sim-seat.ts';
import { simCustody } from '../../../tools/sim-custody.ts';

const keys = JSON.parse(readFileSync(new URL('../../../fixtures/keys.json', import.meta.url), 'utf8')) as KeysFile;
const cell = cellKey(keys, 'cell-1'), forms = formsOf(FORMS);
const X = { exam: 'DEMO-2026', shift: 'S1' }, ctx = { ...X, attempt: 1, cand: 'C0001' };
const PIN = '482913', appr = { by: 'INV-42-A', at: 1 };
const recs = new Map<string, string>();
const recFor = (pin: string) => { if (!recs.has(pin)) recs.set(pin, pinRecord(pin)); return recs.get(pin)!; };    // scrypt ~150 ms each
let tmp: string, db: Database, b: Bindings, seatA: KeyPair, seatB: KeyPair, s: SimSeat, events: { cand: string; seq: number; data: unknown }[];

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'saakshi-move-'));
  ({ db } = openDb(join(tmp, 'cell.db')));
  b = new Bindings(db, { ...X, cell });
  seatA = newKeyPair(); seatB = newKeyPair(); events = [];
  const e = b.enrol(makeBindReq({ ...ctx, seatId: 'CEN042-S01', pub: toHex(seatA.pub), keyEpoch: 1, fromSeq: 0, attestHash: 'a'.repeat(64) }, cell.pub, recFor(PIN), nativeBox), true);
  if (!e.ok) throw new Error(e.error);
  s = new SimSeat(keys, 'C0001', cell.pub, 1, seatA);
  s.add(6);                                                                          // unlock + 5 answers, all at the cell
});
afterEach(() => { db.close(); rmSync(tmp, { recursive: true, force: true }); });

const snap = (o: Partial<StreamSnap> = {}): StreamSnap =>
  ({ head: s.head, headH: s.hs[s.head - 1], activeMs: s.headers[s.head - 1].activeMs, pending: 0, submitted: false, bodies: s.bodies, rxAt: () => 1_000, ...o });
const grantor = (stream: () => StreamSnap | undefined = () => snap()) => cellHandover({
  ...X, cell, bindings: b, forms, formOf: devForm, stream: () => stream(), pinTries: 3, now: () => 109_000,
  record: (c, seq, data) => events.push({ cand: c.cand, seq, data }),
});
function req(pin = PIN, seat = seatB, seatId = 'CEN042-S02', recordPin = pin): HandoverReq {
  const pub = toHex(seat.pub);
  return {
    ...ctx, seatId, pub, attestHash: 'b'.repeat(64),
    pinBox: makeBindReq({ ...ctx, seatId, pub, keyEpoch: 1, fromSeq: 0, attestHash: 'b'.repeat(64) }, cell.pub, recFor(recordPin), nativeBox).pinBox,
    proof: { via: 'pin', pin: sealHandoverPin(cell.pub, ctx, seatId, pub, pin, nativeBox) },
  };
}
const from = () => ({ fromSeq: 6, fromHead: s.hs[5] });

test('PIN + invigilator: keyEpoch 2 from the cell\'s head; the new seat can check everything; its answers come back sealed to it', () => {
  const g = grantor()(req(), from(), appr);
  if (!g.ok) throw new Error(g.error);
  const c = checkGrant(g.grant, { ...ctx, seatId: 'CEN042-S02', pub: toHex(seatB.pub) }, cell.pub, seatB.priv, verifier, nativeBox);
  expect(c.bind).toMatchObject({ keyEpoch: 2, fromSeq: 6, seatId: 'CEN042-S02', attestHash: 'b'.repeat(64) });
  expect(c.grant).toMatchObject({ keyEpoch: 2, fromSeq: 6, fromHead: s.hs[5], activeMs: 6_000, creditedMs: 108_000 });
  expect(c.responses).toEqual(responsesOf(FORMS.F1, s.bodies).filter((r) => r[1] !== 'NV'));
  expect([g.grant.via, g.grant.approvedBy]).toEqual(['pin', 'INV-42-A']);
  expect(b.seatKey('C0001', 2)).toEqual(seatB.pub);
  expect([b.fromSeqOf('C0001', 1), b.fromSeqOf('C0001', 2), b.forCand('C0001').length]).toEqual([0, 6, 2]);
  expect(events).toEqual([{ cand: 'C0001', seq: 6, data: { keyEpoch: 2, fromSeq: 6, via: 'pin', approvedBy: 'INV-42-A', creditedMs: 108_000, seatId: 'CEN042-S02' } }]);
  const again = new Bindings(db, { ...X, cell });                                   // the new binding survives a restart
  expect([again.fromSeqOf('C0001', 2), again.latest('C0001')?.bind.keyEpoch]).toEqual([6, 2]);
});

test('Review Focus #3: the same move twice gets the same grant; three wrong PINs lock, across a restart', () => {
  const h = grantor();
  const first = h(req(), from(), appr), second = h(req(), from(), { by: 'INV-42-B', at: 2 });
  expect(second).toEqual(first);
  expect(events.length).toBe(1);

  b = new Bindings(db, { ...X, cell });                                              // fresh candidate state: another test, same cell
  const cand2 = { ...ctx, cand: 'C0003' };
  const seat3 = newKeyPair();
  const e = b.enrol(makeBindReq({ ...cand2, seatId: 'CEN042-S03', pub: toHex(seat3.pub), keyEpoch: 1, fromSeq: 0, attestHash: 'a'.repeat(64) }, cell.pub, recFor(PIN), nativeBox), true);
  if (!e.ok) throw new Error(e.error);
  const t = new SimSeat(keys, 'C0003', cell.pub, 1, seat3);
  t.add(2);
  const snap3 = (): StreamSnap => ({ head: 2, headH: t.hs[1], activeMs: 2_000, pending: 0, submitted: false, bodies: t.bodies, rxAt: () => 1_000 });
  const h3 = grantor(snap3);
  const r3 = (pin: string) => ({ ...req(pin), cand: 'C0003', proof: { via: 'pin' as const, pin: sealHandoverPin(cell.pub, cand2, 'CEN042-S02', toHex(seatB.pub), pin, nativeBox) },
    pinBox: makeBindReq({ ...cand2, seatId: 'CEN042-S02', pub: toHex(seatB.pub), keyEpoch: 1, fromSeq: 0, attestHash: 'b'.repeat(64) }, cell.pub, recFor(pin), nativeBox).pinBox });
  const f3 = { fromSeq: 2, fromHead: t.hs[1] };
  expect(h3(r3('111111'), f3, appr)).toMatchObject({ ok: false, code: 'PIN_WRONG', left: 2 });
  expect(h3(r3('222222'), f3, appr)).toMatchObject({ ok: false, code: 'PIN_WRONG', left: 1 });
  expect(h3(r3('333333'), f3, appr)).toMatchObject({ ok: false, code: 'PIN_LOCKED' });
  b = new Bindings(db, { ...X, cell });                                              // a cell restart forgets nothing
  expect(grantor(snap3)(r3(PIN), f3, appr)).toMatchObject({ ok: false, code: 'PIN_LOCKED' });
  expect(b.seatKey('C0003', 2)).toBeUndefined();
});

test('refusals: behind, pending, ahead, submitted, not bound, no approval, a wrong head, a new PIN record with another PIN, the current key', () => {
  const r = (x: ReturnType<ReturnType<typeof grantor>>) => (x.ok ? 'ok' : x.code);
  expect(r(grantor()(req(), { fromSeq: 7, fromHead: s.hs[5] }, appr))).toBe('BEHIND');
  expect(r(grantor(() => snap({ pending: 1 }))(req(), from(), appr))).toBe('BEHIND');
  expect(r(grantor()(req(), { fromSeq: 5, fromHead: s.hs[4] }, appr))).toBe('AHEAD');
  expect(r(grantor(() => snap({ submitted: true }))(req(), from(), appr))).toBe('SUBMITTED');
  expect(r(grantor()({ ...req(), cand: 'C0404' }, from(), appr))).toBe('NOT_BOUND');
  expect(r(grantor()(req(), from(), undefined))).toBe('BAD');
  expect(r(grantor()(req(), { fromSeq: 6, fromHead: s.hs[4] }, appr))).toBe('BAD');
  expect(r(grantor()(req(PIN, seatB, 'CEN042-S02', '999999'), from(), appr))).toBe('BAD');
  expect(r(grantor()(req(PIN, seatA, 'CEN042-S01'), from(), appr))).toBe('BAD');
  expect(b.seatKey('C0001', 2)).toBeUndefined();
  expect(b.pinFailures('C0001')).toBe(0);                                            // none of these was a wrong PIN
});

test('the old-key path: seat A\'s signed claim moves the candidate with no approval (credit pending); a bad claim is refused', () => {
  const pub = toHex(seatB.pub);
  const claim = { ...ctx, keyEpoch: 1, fromSeq: 6, fromHead: s.hs[5], newPub: pub };
  const sig = toHex(signer(seatA)(msg(handoverArray(claim))));
  const base = { ...req(), proof: { via: 'key' as const, keyEpoch: 1, fromSeq: 6, fromHead: s.hs[5], sig } };
  const g = grantor()(base, undefined, undefined);
  if (!g.ok) throw new Error(g.error);
  expect([g.grant.via, g.grant.approvedBy, g.grant.grant.keyEpoch]).toEqual(['key', '', 2]);
  const bad = grantor()({ ...base, pub: toHex(newKeyPair().pub) }, undefined, undefined);   // the claim names another key
  expect(bad).toMatchObject({ ok: false, code: 'BAD' });
});

test('routes: /v1/handover status codes; /v1/events fills the centre; /v1/stats carries lastSeen and rebuild progress', async () => {
  const dir = { v: 1, exam: 'DEMO-2026', shift: 'S1', durationMs: 1_800_000, demoCentre: 'CEN042', issuedAt: 0, cells: [],
    centres: { CEN042: { cell: 'cell-1' } }, cands: { C0001: { centre: 'CEN042', form: 'F1', extraMs: 0, pseud: '7'.repeat(64) } } } as unknown as Directory;
  let state: 'LIVE' | 'REBUILDING' = 'LIVE';
  const ev: CellEvent[] = [{ id: 7, at: 1, cell: 'cell-1', code: 'GAP', cand: 'C0001', centre: '', seq: 3, reason: '{}', data: {} }];
  const cust = simCustody(keys);
  const routes = cellRoutes({
    cellId: 'cell-1', dir, bindings: b, state: () => state, submitted: () => [],
    releases: new ReleaseStore(db, { ...X, manifest: cust.manifest.manifest, authority: verifier(hexToBytes(keys.authority.pub)), requireSig: true }),
    views: () => [{ ...ctx, head: 6, cellHead: 6, senderHead: 6, seenAt: 4_242 }],
    handover: grantor(), events: (after) => ev.filter((e) => e.id > after), rebuild: () => ({ done: 1, expected: 3 }),
  });
  const call = async (path: string, method: 'GET' | 'POST', body?: unknown) => {
    const r = await routes[path.split('?')[0]][method]!(new Request(`http://cell${path}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }), { timeout() {} });
    return { status: r.status, body: (await r.json()) as Record<string, unknown> };
  };
  expect((await call('/v1/handover', 'POST', { req: req(), approval: { by: 'INV-42-A' }, ...from() })).status).toBe(200);
  expect(await call('/v1/handover', 'POST', { req: req(), ...from() })).toMatchObject({ status: 200 });   // idempotent: no approval needed to fetch it again
  expect((await call('/v1/handover', 'POST', { req: { nope: 1 } })).status).toBe(400);
  expect((await call('/v1/handover', 'POST', { req: req(PIN, newKeyPair(), 'CEN042-S04'), approval: { by: 'INV' }, fromSeq: 9, fromHead: s.hs[5] })).body).toMatchObject({ code: 'BEHIND' });
  state = 'REBUILDING';
  expect((await call('/v1/handover', 'POST', { req: req() })).status).toBe(503);
  expect((await call('/v1/events?after=0', 'GET')).body).toEqual({ events: [{ ...ev[0], centre: 'CEN042' }], last: 7 });
  expect((await call('/v1/events?after=7', 'GET')).body).toEqual({ events: [], last: 7 });
  const st = (await call('/v1/stats', 'GET')).body as { rebuild: unknown; centres: Record<string, { lastSeen?: number }> };
  expect([st.rebuild, st.centres.CEN042.lastSeen]).toEqual([{ done: 1, expected: 3 }, 4_242]);
});
