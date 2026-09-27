import { afterEach, beforeEach, expect, test } from 'bun:test';
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hexToBytes, randomBytes, toHex } from '@saakshi/core/bytes';
import { devPseud, trustFromKeys, type KeysFile } from '@saakshi/core/dev';
import type { Directory, FleetView } from '@saakshi/core/directory';
import { msg } from '@saakshi/core/enrol';
import { purgeArray, type PurgeOrder } from '@saakshi/core/handover';
import { signedLine } from '@saakshi/core/journal';
import { newKeyPair, signer, verifier } from '@saakshi/core/node';
import { OPS_DEMO, type CellEvent, type Incident, type PublicStatus, type TimeRow } from '@saakshi/core/ops';
import { bodyArray, bodyCommit, entryHash, genesisPrev, type Body, type Header, type Kind } from '@saakshi/core/protocol';
import { formsOf } from '@saakshi/core/sheet';
import { opsMonitor } from '../src/ops-monitor.ts';
import { opsRoutes } from '../src/ops-routes.ts';
import { seal } from '../src/seal.ts';
import { FORMS, SimSeat } from '../../../tools/sim-seat.ts';

const keys = JSON.parse(readFileSync(new URL('../../../fixtures/keys.json', import.meta.url), 'utf8')) as KeysFile;
const authority = { priv: hexToBytes(keys.authority.priv), pub: hexToBytes(keys.authority.pub) };
const forms = formsOf(FORMS);
const e = (centre: string) => ({ centre, form: 'F1' as const, extraMs: 0, pseud: '7'.repeat(64) });
const dir = { v: 1, exam: 'DEMO-2026', shift: 'S1', durationMs: 1_800_000, demoCentre: 'CEN042', issuedAt: 0,
  cells: [{ id: 'cell-1', url: 'http://c1', keyId: 'k', pub: keys.cells[0].pub, cert: '' }, { id: 'cell-2', url: 'http://c2', keyId: 'k', pub: keys.cells[1].pub, cert: '' }],
  centres: { CEN042: { cell: 'cell-1' }, CEN001: { cell: 'cell-2' } }, cands: { C0001: e('CEN042'), C0002: e('CEN042'), A1: e('CEN001') } } as unknown as Directory;
let tmp: string, t: number, cell2: FleetView['cells'][number], events: CellEvent[], calls: { url: string; body: unknown }[], sheets: unknown[];
const fleet = (): FleetView => ({ at: t, registered: 3, bound: 3, unlocked: 3, submitted: 0, entries: 0, entriesPerSec: 0, cells: [{ id: 'cell-1', state: 'LIVE', entries: 10 }, cell2],
  centres: [{ centre: 'CEN001', cell: 'cell-2', registered: 1, bound: 1, unlocked: 1, submitted: 0, entries: 1, tone: cell2.state === 'LIVE' ? 'green' : 'down' },
    { centre: 'CEN042', cell: 'cell-1', registered: 2, bound: 2, unlocked: 2, submitted: 0, entries: 9, tone: 'green' }] });
const fake = (handlers: Record<string, (body: unknown, url: URL) => unknown>) => (async (input: string | URL, init?: RequestInit) => {
  const url = new URL(String(input)), body = init?.body ? JSON.parse(String(init.body)) : undefined, key = url.origin + url.pathname;
  calls.push({ url: key, body });
  const h = handlers[key];
  if (!h) return Response.json({ error: 'not found' }, { status: 404 });
  const out = h(body, url);
  return out instanceof Response ? out : Response.json(out);
}) as unknown as typeof fetch;
const handlers: Record<string, (body: unknown, url: URL) => unknown> = {
  'http://c1/v1/events': (_b, u) => { const after = Number(u.searchParams.get('after')); const ev = events.filter((x) => x.id > after); return { events: ev, last: ev.at(-1)?.id ?? after }; },
  'http://relay/v1/link': () => ({ centre: 'CEN042', up: true, cut: false, degraded: true, rttMs: 2100, errRate: 0.3, backlog: 12, lastContactAt: t, risk: 'warn', reason: 'WAN failure likely: round trips 2.1 s (smoothed)', cell: 'LIVE' }),
  'http://relay/v1/heads': () => ({ mode: 'relay', state: 'LIVE', streams: [] }),
  'http://relay/v1/purge': (b) => { const x = b as { order: PurgeOrder; sig: string }; return verifier(authority.pub)(msg(purgeArray(x.order)), hexToBytes(x.sig)) ? { purged: 42 } : Response.json({ error: 'bad sig' }, { status: 403 }); },
  'http://relay/v1/dev/degrade': (b) => ({ degraded: (b as { on: boolean }).on }),
  'http://stack/kill': (b) => ({ ...(b as object), killed: true, wiped: ['cell-2.db'] }),
  'http://stack/start': (b) => ({ ...(b as object), pid: 4242 }),
  'http://c1/v1/shift': () => ({ cell: 'cell-1', exam: 'DEMO-2026', shift: 'S1', sheets }),
};
function build(o: { stack?: boolean } = {}) {
  const custody: string[] = [];
  const f = fake(handlers);
  const monitor = opsMonitor({ dir, ops: OPS_DEMO, controlDir: tmp, fleet, relayUrl: 'http://relay', fetch: f, now: () => t });
  const routes = opsRoutes({ monitor, dir, ops: OPS_DEMO, controlDir: tmp, authority, cellUrl: 'http://c1', relayUrl: 'http://relay', ...(o.stack ? { stackUrl: 'http://stack' } : {}),
    forms, roster: ['C0001', 'C0002'], recPath: join(tmp, 'sth-DEMO-2026-S1.json'), stores: [join(tmp, 'worm-a'), join(tmp, 'worm-b')],
    custody: (action) => custody.push(action), fetch: f, now: () => t });
  const call = async (path: string, method: 'GET' | 'POST', body?: unknown) => {
    const r = await routes[path.split('?')[0]][method]!(new Request(`http://control${path}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }), { timeout() {} });
    const text = await r.text();
    return { status: r.status, text, body: (() => { try { return JSON.parse(text); } catch { return undefined; } })() };
  };
  return { monitor, call, custody };
}
beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 'saakshi-ops-')); t = 1_000; cell2 = { id: 'cell-2', state: 'LIVE', entries: 50 }; events = []; calls = []; sheets = []; });
afterEach(() => {
  for (const s of ['worm-a', 'worm-b']) { const d = join(tmp, s); if (existsSync(d)) for (const f of readdirSync(d)) if (process.platform !== 'win32') chmodSync(join(d, f), 0o644); }
  rmSync(tmp, { recursive: true, force: true });
});

test('the loop: a down cell, a predicted WAN failure and a gap become incidents; ack works; a notice is drafted for the public ones', async () => {
  const { monitor, call } = build();
  await monitor.tick();
  cell2 = { id: 'cell-2', state: 'DOWN', entries: 50 };
  events = [{ id: 1, at: t, cell: 'cell-1', code: 'GAP', cand: 'C0001', centre: 'CEN042', seq: 9, reason: '{}', data: { cause: 'suspend', pausedMs: 125_000 } }];
  await monitor.tick();
  const r = (await call('/v1/incidents', 'GET')).body as { demo: boolean; incidents: Incident[] };
  expect(r.demo).toBe(true);
  expect(r.incidents.map((i) => i.kind)).toEqual(['CELL_DOWN', 'SYNC_LAG', 'GAP']);                    // by severity, then age
  expect(r.incidents[0].blast).toMatchObject({ cells: ['cell-2'], centres: ['CEN001'], candidates: 1 });
  expect((await call('/v1/incidents/ack', 'POST', { id: r.incidents[0].id, by: 'CONTROL-1' })).body).toMatchObject({ ack: { by: 'CONTROL-1', rung: 'control' } });
  expect((await call('/v1/incidents/ack', 'POST', { id: 'NOPE', by: 'x' })).status).toBe(404);
  expect((await call('/v1/notices', 'GET')).body.drafts.map((n: { incident: string }) => n.incident)).toEqual([r.incidents[0].id]);
  expect(JSON.parse(readFileSync(join(tmp, 'incidents.json'), 'utf8')).length).toBe(3);
});

test('TAMPER climbs to the regulator on DEMO timers and the CERT-In draft is served; unknown drafts are 404', async () => {
  const { monitor, call } = build();
  events = [{ id: 1, at: t, cell: 'cell-1', code: 'FORK', cand: 'C0002', centre: 'CEN042', seq: 5, reason: 'seq 5 already holds a different signed entry' }];
  await monitor.tick();
  t += 10_000;
  await monitor.tick();
  const i = monitor.incidents.open().find((x) => x.kind === 'TAMPER')!;
  expect(i.certIn).toBe(`certin/${i.id}.html`);
  const html = await call(`/v1/incidents/certin?id=${i.id}`, 'GET');
  expect([html.status, html.text.includes('DRAFT TEMPLATE')]).toEqual([200, true]);
  expect((await call('/v1/incidents/certin?id=GAP-9', 'GET')).status).toBe(404);
});

test('approved credit reaches the time audit; a move\'s invigilator approval counts too', async () => {
  const { monitor, call } = build();
  const sign = signer(newKeyPair()), ctx = { exam: 'DEMO-2026', shift: 'S1', attempt: 1, cand: 'C0001' };
  let prev = genesisPrev(ctx);
  const step = (seq: number, kind: Kind, active: number, rx: number, body: Body) => {
    const salt = randomBytes(16);
    const h: Header = { ...ctx, keyEpoch: 1, seq, prev, kind, tMonoMs: active, activeMs: active, bodyCommit: bodyCommit(salt, body) };
    prev = toHex(entryHash(h));
    return { line: signedLine(h, sign), salt: toHex(salt), body: bodyArray(body), rx: [rx, rx] };
  };
  const E: Body = { item: '', state: '', answer: '', meta: [] };
  sheets = [{ ctx, form: 'F1', pseud: '7'.repeat(64), keys: [], entries: [step(1, 'unlock', 0, 1_000, E), step(2, 'gap', 0, 126_000, { ...E, meta: ['suspend', 125_000] })] }];
  expect(((await call('/v1/time', 'GET')).body.rows as TimeRow[])[0].flags).toEqual(['PENDING_APPROVAL']);
  expect((await call('/v1/gaps/approve', 'POST', { cand: 'C0001', seq: 2, by: '' })).status).toBe(400);
  expect((await call('/v1/gaps/approve', 'POST', { cand: 'C0001', seq: 2, by: 'CONTROL-1' })).status).toBe(200);
  const row = ((await call('/v1/time', 'GET')).body.rows as TimeRow[])[0];
  expect([row.creditedMs, row.flags, row.gaps[0].approvedBy]).toEqual([125_000, [], 'CONTROL-1']);
  expect(readFileSync(join(tmp, 'approvals.jsonl'), 'utf8')).toContain('"CONTROL-1"');
  events = [{ id: 1, at: t, cell: 'cell-1', code: 'HANDOVER', cand: 'C0002', centre: 'CEN042', seq: 6, reason: '{}', data: { keyEpoch: 2, fromSeq: 6, via: 'pin', approvedBy: 'INV-42-A', creditedMs: 1, seatId: 'CEN042-S02' } }];
  await monitor.tick();
  expect(monitor.approvals()).toContainEqual({ cand: 'C0002', seq: 7, by: 'INV-42-A', at: t });
});

test('chaos goes through the supervisor: without it the buttons explain; with it the plug is pulled, restarted, the spare started; all logged', async () => {
  const none = build();
  const r = await none.call('/v1/chaos/plug', 'POST', { cell: 'cell-2', wipe: true });
  expect([r.status, r.body.error]).toEqual([409, expect.stringContaining('bun tools/stack.ts')]);
  const s = build({ stack: true });
  expect((await s.call('/v1/chaos/plug', 'POST', { cell: 'cell-9', wipe: true })).status).toBe(400);
  expect((await s.call('/v1/chaos/plug', 'POST', { cell: 'cell-2', wipe: true })).body).toEqual({ node: 'cell-2', wipe: true, killed: true, wiped: ['cell-2.db'] });
  expect((await s.call('/v1/chaos/restart', 'POST', { cell: 'cell-2' })).body).toEqual({ node: 'cell-2', pid: 4242 });
  expect((await s.call('/v1/chaos/spare', 'POST', {})).body).toMatchObject({ node: 'relay', killed: true, pid: 4242 });
  expect((await s.call('/v1/chaos/degrade', 'POST', { on: true })).body).toEqual({ degraded: true });
  expect(s.custody).toEqual(['chaos-plug', 'chaos-restart', 'chaos-spare-relay', 'chaos-degrade']);
});

test('archive: both stores written and verified; purge only then, with an authority-signed order; a damaged store blocks the purge', async () => {
  const { call, custody } = build();
  expect((await call('/v1/archive', 'POST')).status).toBe(409);                                   // nothing sealed yet
  const s = new SimSeat(keys, 'C0001', hexToBytes(keys.cells[0].pub)); s.add(21); s.submit();
  sheets = [s.sheet()];
  const { rec } = seal(undefined, { cell: 'cell-1', exam: 'DEMO-2026', shift: 'S1', sheets: [s.sheet()] }, { authority, trust: trustFromKeys(keys), pseud: devPseud, now: () => 1 });
  writeFileSync(join(tmp, 'sth-DEMO-2026-S1.json'), JSON.stringify(rec));
  const w = await call('/v1/archive', 'POST');
  expect([w.status, w.body.ok, w.body.stores.length]).toEqual([200, true, 2]);
  expect((await call('/v1/archive/purge', 'POST')).body).toMatchObject({ purged: 42, report: { ok: true } });
  const p = join(tmp, 'worm-b', 'DEMO-2026-S1-1.bundle.json');
  if (process.platform !== 'win32') chmodSync(p, 0o644);
  writeFileSync(p, '{}');
  const before = calls.filter((c) => c.url === 'http://relay/v1/purge').length;
  expect((await call('/v1/archive/purge', 'POST')).status).toBe(409);
  expect(calls.filter((c) => c.url === 'http://relay/v1/purge').length).toBe(before);
  expect(custody).toEqual(['archive-write', 'purge-ordered']);
});

test('the public status carries no roll numbers or staff ids; an approved notice appears on it', async () => {
  const { monitor, call } = build();
  cell2 = { id: 'cell-2', state: 'DOWN', entries: 50 };
  events = [{ id: 1, at: t, cell: 'cell-1', code: 'HANDOVER', cand: 'C0002', centre: 'CEN042', seq: 6, reason: '{}', data: { keyEpoch: 2, fromSeq: 6, via: 'pin', approvedBy: 'INV-42-A', creditedMs: 1, seatId: 'CEN042-S02' } }];
  await monitor.tick();
  const [d] = (await call('/v1/notices', 'GET')).body.drafts as { id: string }[];
  expect((await call('/v1/notices/approve', 'POST', { id: d.id, by: 'CONTROL-1' })).status).toBe(200);
  const s = (await call('/v1/status/public', 'GET')).body as PublicStatus;
  expect([s.incidents.length, s.notices.length]).toEqual([1, 1]);
  expect(JSON.stringify(s)).not.toMatch(/C000\d|INV-42-A|CEN042-S02|CONTROL-1/);
});
