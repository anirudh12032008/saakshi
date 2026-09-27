import { expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { toHex } from '@saakshi/core/bytes';
import { cellKey, type KeysFile } from '@saakshi/core/dev';
import { msg } from '@saakshi/core/enrol';
import { faceArray, readinessArray, sealThumb, thumbHashOf, type FaceFlag, type Readiness } from '@saakshi/core/integrity';
import { newKeyPair, signer } from '@saakshi/core/node';
import { Bindings } from '../src/bindings.ts';
import { relayIntegrity } from '../src/relay-integrity.ts';
import { openDb } from '../src/store.ts';
import { simBindReq } from '../../../tools/sim-custody.ts';

const keys = JSON.parse(readFileSync(new URL('../../../fixtures/keys.json', import.meta.url), 'utf8')) as KeysFile;
const cell = cellKey(keys, 'cell-1'), X = { exam: 'DEMO-2026', shift: 'S1' }, ctx = { ...X, attempt: 1, cand: 'C0001' };

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'relay-int-'));
  const { db } = openDb(':memory:');
  const bindings = new Bindings(db, { ...X, cell: { id: 'cell-1', pub: cell.pub } });
  const origin = new Bindings(openDb(':memory:').db, { ...X, cell });
  const seat = newKeyPair();
  const e = origin.enrol(simBindReq('C0001', seat, cell.pub, 'CEN042-S01'), true);
  if (!e.ok) throw new Error(e.error);
  bindings.accept(e.bind);
  const routes = relayIntegrity({ ...X, dir, bindings, cellPub: cell.pub, now: () => 1_000 });
  const post = (p: string, body: unknown) => (routes[p] as any).POST(new Request(`http://r${p}`, { method: 'POST', body: JSON.stringify(body) }));
  const get = (p: string) => (routes[p.split('?')[0]] as any).GET(new Request(`http://r${p}`));
  return { dir, seat, post, get, done: () => { db.close(); rmSync(dir, { recursive: true, force: true }); } };
}
const report = (at: number, verdict: Readiness['verdict'] = 'green'): Readiness => ({ ...ctx, seatId: 'CEN042-S01', keyEpoch: 1, at, verdict, findings: [] });

test('a signed report is kept, served, and replaced only by a newer one', async () => {
  const s = setup();
  const sign = signer(s.seat);
  expect((await s.post('/v1/readiness', { r: report(10, 'block'), sig: toHex(sign(msg(readinessArray(report(10, 'block'))))) })).status).toBe(200);
  expect((await s.post('/v1/readiness', { r: report(5), sig: toHex(sign(msg(readinessArray(report(5))))) })).status).toBe(200);
  const body = await (await s.get('/v1/readiness')).json();
  expect(body.seats).toHaveLength(1);
  expect(body.seats[0].r.verdict).toBe('block');
  s.done();
});

test('Review Focus #5: a report signed by another key is 403; an older report does not replace a newer one; a bad thumbHash is 400', async () => {
  const s = setup();
  const other = signer(newKeyPair());
  expect((await s.post('/v1/readiness', { r: report(10), sig: toHex(other(msg(readinessArray(report(10))))) })).status).toBe(403);
  expect((await s.post('/v1/readiness', { r: { ...report(10), keyEpoch: 2 }, sig: toHex(signer(s.seat)(msg(readinessArray({ ...report(10), keyEpoch: 2 })))) })).status).toBe(403);
  const review = newKeyPair(), thumb = sealThumb(review.pub, ctx, 50, new Uint8Array([1, 2]));
  const f: FaceFlag = { ...ctx, seatId: 'CEN042-S01', at: 50, code: 'face-none', faces: 0, expected: 1, thumb, thumbHash: 'a'.repeat(64) };
  expect((await s.post('/v1/faces', { f, sig: toHex(signer(s.seat)(msg(faceArray(f)))) })).status).toBe(400);
  s.done();
});

test('face flags: stored once per (cand, at), survive a restart, paged by id', async () => {
  const s = setup();
  const review = newKeyPair(), thumb = sealThumb(review.pub, ctx, 50, new Uint8Array([1, 2]));
  const f: FaceFlag = { ...ctx, seatId: 'CEN042-S01', at: 50, code: 'face-none', faces: 0, expected: 1, thumb, thumbHash: thumbHashOf(thumb) };
  const sig = toHex(signer(s.seat)(msg(faceArray(f))));
  const a = await (await s.post('/v1/faces', { f, sig })).json(), b = await (await s.post('/v1/faces', { f, sig })).json();
  expect(a.id).toBe(1); expect(b.id).toBe(1);
  const again = relayIntegrity({ ...X, dir: s.dir, bindings: new Bindings(openDb(':memory:').db, { ...X, cell: { id: 'cell-1', pub: cell.pub } }), cellPub: cell.pub });
  const page = await (await (again['/v1/faces'] as any).GET(new Request('http://r/v1/faces?after=0'))).json();
  expect(page.flags.map((x: { id: number }) => x.id)).toEqual([1]);
  expect(page.last).toBe(1);
  s.done();
});
