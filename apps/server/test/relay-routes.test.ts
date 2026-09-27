import { afterAll, beforeAll, expect, test } from 'bun:test';
import type { Database } from 'bun:sqlite';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hexToBytes, toHex } from '@saakshi/core/bytes';
import { combineBundle } from '@saakshi/core/custody';
import { cellKey, type KeysFile } from '@saakshi/core/dev';
import type { Directory } from '@saakshi/core/directory';
import { msg, type BindReq, type WireBind } from '@saakshi/core/enrol';
import { newKeyPair, signer, verifier } from '@saakshi/core/node';
import { openCodes, openShareFile, releaseArray, type ReleaseMsg } from '@saakshi/core/paper';
import { signPolicy, type SignedPolicy } from '@saakshi/core/policy';
import { fromB64 } from '@saakshi/core/wire';
import { Bindings } from '../src/bindings.ts';
import { relayRoutes, Wan } from '../src/relay-routes.ts';
import { ReleaseStore } from '../src/release-store.ts';
import type { Routes } from '../src/serve.ts';
import { Hub } from '../src/sse.ts';
import { openDb } from '../src/store.ts';
import { buildPackage, type Package } from '../../../tools/package.ts';
import { simBindReq } from '../../../tools/sim-custody.ts';

const keys = JSON.parse(readFileSync(new URL('../../../fixtures/keys.json', import.meta.url), 'utf8')) as KeysFile;
const fx = (f: string) => JSON.parse(readFileSync(new URL(`../../../fixtures/paper/${f}`, import.meta.url), 'utf8'));
const cell = cellKey(keys, 'cell-1'), authority = { priv: hexToBytes(keys.authority.priv), pub: hexToBytes(keys.authority.pub) };
const X = { exam: 'DEMO-2026', shift: 'S1' };
const dir = { v: 1, ...X, durationMs: 1_800_000, demoCentre: 'CEN042', issuedAt: 0, cells: [], cands: {},
  centres: { CEN042: { cell: 'cell-1' }, CEN001: { cell: 'cell-2' } } } as unknown as Directory;
let tmp: string, cellDb: Database, relayDb: Database, pkg: Package, codes: Record<string, string>, codeS2: string, K: { kF1: Uint8Array };
let routes: Routes, store: ReleaseStore, hub: Hub, wan: Wan, relayB: Bindings, policy: SignedPolicy;
let cellUp = true;
const logs: string[] = [];
const srv = { timeout() {} };

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'saakshi-relayr-'));
  pkg = await buildPackage(dir, { bank: fx('bank.json'), forms: fx('forms.json') }, authority);
  const k = await combineBundle([openShareFile(pkg.shares.NTA, pkg.passphrases.NTA), openShareFile(pkg.shares.NIC, pkg.passphrases.NIC)]);
  codes = openCodes(k.L, X.exam, X.shift, pkg.codes);
  K = k;
  const s2 = await buildPackage({ ...dir, shift: 'S2' }, { bank: fx('bank.json'), forms: fx('forms.json') }, authority);
  const k2 = await combineBundle([openShareFile(s2.shares.NTA, s2.passphrases.NTA), openShareFile(s2.shares.OBS, s2.passphrases.OBS)]);
  codeS2 = openCodes(k2.L, X.exam, 'S2', s2.codes).CEN042;
  policy = signPolicy({ v: 1, ...X, centre: 'CEN042', cell: { id: 'cell-1', keyId: 'k', pub: toHex(cell.pub) }, durationMs: 1_800_000, roster: { C0001: { form: 'F1', extraMs: 0, pseud: '7'.repeat(64) } }, issuedAt: 0 }, signer(authority));

  ({ db: cellDb } = openDb(join(tmp, 'cell.db')));
  const cellB = new Bindings(cellDb, { ...X, cell });
  const cellFetch = (async (_url: string, init?: RequestInit) => {
    if (!cellUp) throw new Error('connect ECONNREFUSED');
    const { enrols } = JSON.parse(String(init!.body)) as { enrols: BindReq[] };
    return Response.json({ results: enrols.map((r) => cellB.enrol(r, r.cand !== 'C9999')) });
  }) as unknown as typeof fetch;

  ({ db: relayDb } = openDb(join(tmp, 'relay.db')));
  relayB = new Bindings(relayDb, { ...X, cell: { id: 'cell-1', pub: cell.pub } });
  hub = new Hub(() => ({ releases: store.list() }));
  store = new ReleaseStore(relayDb, { ...X, manifest: pkg.manifest.manifest, authority: verifier(authority.pub), onNew: (r) => hub.publish('release', r) });
  wan = new Wan();
  routes = relayRoutes({ ...X, centre: 'CEN042', policy, manifest: pkg.manifest, papers: pkg.papers, wrap: hexToBytes(pkg.wraps.CEN042), cellUrl: 'http://cell',
    bindings: relayB, releases: store, hub, wan, dev: true, fetch: cellFetch, log: (l) => logs.push(l) });
});
afterAll(() => { cellDb.close(); relayDb.close(); rmSync(tmp, { recursive: true, force: true }); });

async function call<T>(path: string, method: 'GET' | 'POST', body?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; body: T; res: Response }> {
  const res = await routes[path][method]!(new Request(`http://relay${path}`, { method, headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }), srv);
  const isSse = res.headers.get('content-type') === 'text/event-stream';
  return { status: res.status, body: (isSse ? undefined : await res.json()) as T, res };
}
/** Read an SSE response until `done(text)` holds, then hang up (a reconnecting seat does exactly this). */
async function frames(res: Response, done: (text: string) => boolean): Promise<string> {
  const r = res.body!.getReader();
  let text = '';
  while (!done(text)) { const { value, done: end } = await r.read(); if (end) break; text += new TextDecoder().decode(value); }
  await r.cancel();
  return text;
}
const lastId = (text: string) => [...text.matchAll(/^id: (\S+)$/gm)].at(-1)![1];

test('package: the signed policy and manifest and both paper ciphertexts, exactly what the manifest commits to', async () => {
  const { body } = await call<{ policy: SignedPolicy; manifest: unknown; paper: Record<string, string> }>('/v1/package', 'GET');
  expect(body.policy).toEqual(policy);
  expect(body.manifest).toEqual(pkg.manifest);
  for (const f of ['F1', 'F2']) expect(fromB64(body.paper[f])).toEqual(pkg.papers[f]);
});

test('enrolment proxy: bound when the cell answers (and the relay keeps the verified binding); provisional without the WAN or the cell; refusals pass through', async () => {
  const seat = newKeyPair(), req = simBindReq('C0001', seat, cell.pub, 'CEN042-S01');
  const ok = await call<{ bind: WireBind }>('/v1/enrol', 'POST', req);
  expect(ok.status).toBe(200);
  expect(relayB.seatKey('C0001', 1)).toEqual(seat.pub);
  expect((await call<{ bind: WireBind }>('/v1/enrol', 'POST', req)).body.bind).toEqual(ok.body.bind);
  expect((await call<{ code: string }>('/v1/enrol', 'POST', simBindReq('C0001', newKeyPair(), cell.pub))).body.code).toBe('ALREADY_BOUND');
  expect((await call<{ code: string }>('/v1/enrol', 'POST', simBindReq('C9999', newKeyPair(), cell.pub))).status).toBe(409);
  wan.up = false;
  expect(await call('/v1/enrol', 'POST', simBindReq('C0002', newKeyPair(), cell.pub)).then((r) => [r.status, r.body])).toEqual([202, { provisional: true, reason: 'the centre has no WAN link' }]);
  wan.up = true; cellUp = false;
  expect((await call<{ provisional: boolean }>('/v1/enrol', 'POST', simBindReq('C0002', newKeyPair(), cell.pub))).body.provisional).toBe(true);
  cellUp = true;
  expect((await call('/v1/enrol', 'POST', { cand: 'C0002' })).status).toBe(400);
});

test('Review Focus #3: a phoned code typed with spaces, dashes, lowercase and O-for-0 unlocks; a typo asks to re-type; another centre\'s or shift\'s code does not open', async () => {
  const typo = codes.CEN042.slice(0, 5) + (codes.CEN042[5] === 'A' ? 'B' : 'A') + codes.CEN042.slice(6);
  expect((await call<{ error: string }>('/v1/release/offline', 'POST', { code: typo })).body.error).toMatch(/typo/);
  for (const other of [codes.CEN001, codeS2]) {
    const r = await call<{ error: string }>('/v1/release/offline', 'POST', { code: other });
    expect([r.status, r.body.error]).toEqual([400, "This code does not open CEN042's paper for S1. Check the centre and shift with control."]);
  }
  expect(store.list()).toEqual([]);
  const typed = codes.CEN042.replace(/0/g, 'O').replace(/1/g, 'l').toLowerCase().replace(/(.{4})/g, '$1- ');
  const ok = await call<{ released: string[] }>('/v1/release/offline', 'POST', { code: typed });
  expect([ok.status, ok.body]).toEqual([200, { released: ['F1', 'F2'] }]);
  expect(store.list().map((r) => [r.form, r.via, r.sig])).toEqual([['F1', 'code', ''], ['F2', 'code', '']]);
  expect(logs.some((l) => l.startsWith('OFFLINE-UNLOCK {"centre":"CEN042","shift":"S1"'))).toBe(true);
});

test('exit check: the release to seats is idempotent across SSE reconnects — same keys by snapshot, by Last-Event-ID and by pull', async () => {
  const first = await frames((await call('/v1/release/events', 'GET')).res, (t) => t.includes('event: snapshot'));
  const snap = JSON.parse(/event: snapshot\ndata: (.*)/.exec(first)![1]) as { releases: ReleaseMsg[] };
  expect(snap.releases.map((r) => r.key)).toEqual(store.list().map((r) => r.key));
  // control's signed release now reaches the relay (via its cell): one live event, same key
  const r = { ...X, form: 'F1', kcf: pkg.manifest.manifest.forms[0].kcf, ts: 9 };
  const signed: ReleaseMsg = { ...r, key: toHex(K.kF1), sig: toHex(signer(authority)(msg(releaseArray(r)))), via: 'push' };
  const live = (await call('/v1/release/events', 'GET', undefined, { 'last-event-id': lastId(first) })).res;
  expect(store.accept(signed)).toBeUndefined();
  const got = await frames(live, (t) => t.includes('event: release'));
  expect((JSON.parse(/event: release\ndata: (.*)/.exec(got)![1]) as ReleaseMsg).key).toBe(signed.key);
  expect(store.accept(signed)).toBeUndefined();                                   // again: nothing new is published
  expect(hub.catchUp(lastId(got))).toEqual([]);                                   // reconnect with the last id: nothing to replay
  const again = JSON.parse(/data: (.*)/.exec(hub.catchUp('oldboot-7')[0])![1]) as { releases: ReleaseMsg[] };   // a relay restart: one snapshot
  expect(again.releases.map((x) => x.key)).toEqual(store.list().map((x) => x.key));
  expect((await call<{ releases: ReleaseMsg[] }>('/release/current', 'GET')).body.releases).toEqual(store.list());
});

test('DEV chaos: /v1/dev/wan flips the link; /v1/dev/forge publishes a key that matches no commitment and stores nothing; neither exists without DEV', async () => {
  expect((await call('/v1/dev/wan', 'POST', { up: false })).body).toEqual({ up: false });
  expect(wan.up).toBe(false);
  await call('/v1/dev/wan', 'POST', { up: true });
  const before = store.list(), id = hub.lastId;
  await call('/v1/dev/forge', 'POST');
  const [frame] = hub.catchUp(id);
  const forged = JSON.parse(/data: (.*)/.exec(frame)![1]) as ReleaseMsg;
  expect(forged.key).not.toBe(before[0].key);
  expect(store.list()).toEqual(before);
  const quiet = relayRoutes({ ...X, centre: 'CEN042', policy, manifest: pkg.manifest, papers: pkg.papers, wrap: hexToBytes(pkg.wraps.CEN042), cellUrl: 'http://cell', bindings: relayB, releases: store, hub, wan, dev: false });
  expect(['/v1/dev/wan', '/v1/dev/forge'].map((p) => p in quiet)).toEqual([false, false]);
});
