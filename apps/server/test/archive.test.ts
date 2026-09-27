import { afterEach, beforeEach, expect, test } from 'bun:test';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hexToBytes } from '@saakshi/core/bytes';
import { cellKey, devPseud, trustFromKeys, type KeysFile } from '@saakshi/core/dev';
import { sthId } from '@saakshi/core/log';
import { signer, verifier } from '@saakshi/core/node';
import { bundleName, purgeRelay, purgeRoute, signPurge, verifyArchive, writeArchive, type ArchiveBundle } from '../src/archive.ts';
import { createIngest } from '../src/ingest.ts';
import { seal } from '../src/seal.ts';
import { openDb } from '../src/store.ts';
import { SimSeat } from '../../../tools/sim-seat.ts';

const keys = JSON.parse(readFileSync(new URL('../../../fixtures/keys.json', import.meta.url), 'utf8')) as KeysFile;
const cell = cellKey(keys, 'cell-1'), authority = { priv: hexToBytes(keys.authority.priv), pub: hexToBytes(keys.authority.pub) };
const seat1 = hexToBytes(keys.seats[0].pub);
let dir: string, stores: string[], bundle: ArchiveBundle;
const writable = (p: string) => { if (process.platform !== 'win32' && existsSync(p)) chmodSync(p, 0o644); };

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'saakshi-worm-'));
  stores = [join(dir, 'worm-a'), join(dir, 'worm-b')];
  const seats = ['C0001', 'C0002'].map((c) => { const s = new SimSeat(keys, c, cell.pub); s.add(21); s.submit(); return s; });
  const exp = { cell: 'cell-1', exam: 'DEMO-2026', shift: 'S1', sheets: seats.map((s) => s.sheet()) };
  const { rec } = seal(undefined, exp, { authority, trust: trustFromKeys(keys), pseud: devPseud, now: () => 1 });
  bundle = { v: 1, exam: 'DEMO-2026', shift: 'S1', sth: rec.sths[0], leaves: rec.leaves, export: exp };
});
afterEach(() => {
  const f = bundleName('DEMO-2026', 'S1', 2);
  for (const s of stores) for (const p of [join(s, f), join(s, `${f}.sha256`)]) writable(p);   // read-only files: make them removable first
  rmSync(dir, { recursive: true, force: true });
});

test('two write-once stores: written once, verified against the signed register head; a second write changes nothing', () => {
  const w = writeArchive(stores, bundle);
  expect(w.map((r) => [r.ok, r.detail])).toEqual([[true, 'written (write-once, read-only)'], [true, 'written (write-once, read-only)']]);
  expect(w[0].sha256).toBe(w[1].sha256);
  expect(writeArchive(stores, bundle).map((r) => r.detail)).toEqual(['already archived (write-once)', 'already archived (write-once)']);
  const v = verifyArchive(stores, bundle, verifier(authority.pub));
  expect(v).toMatchObject({ exam: 'DEMO-2026', shift: 'S1', size: 2, root: bundle.sth.sth.root, ok: true });
  expect(v.stores.every((s) => s.ok && /2 leaves rebuild the signed root/.test(s.detail))).toBe(true);
});

test('one damaged store fails verification, so there is no purge; a missing store or a single store fails too', () => {
  writeArchive(stores, bundle);
  const p = join(stores[1], bundleName('DEMO-2026', 'S1', 2));
  writable(p);
  writeFileSync(p, readFileSync(p, 'utf8').replace('"C0002"', '"C0009"'));
  const v = verifyArchive(stores, bundle, verifier(authority.pub));
  expect([v.ok, v.stores[0].ok, v.stores[1].detail]).toEqual([false, true, 'the bundle does not match its recorded SHA-256']);
  expect(verifyArchive([stores[0], join(dir, 'nowhere')], bundle, verifier(authority.pub)).ok).toBe(false);
  expect(verifyArchive(stores.slice(0, 1), bundle, verifier(authority.pub)).ok).toBe(false);             // always two stores
});

test('the relay purges a shift only on an authority-signed order for that shift', async () => {
  const { db } = openDb(':memory:');
  const relay = createIngest({ mode: 'relay', db, fresh: false, seatKey: (c) => (c === 'C0001' ? seat1 : undefined), cell: { pub: cell.pub } });
  const s = new SimSeat(keys, 'C0001', cell.pub); s.add(3);
  await relay.sync({ entries: s.entries, streams: [] });
  const logs: string[] = [];
  const routes = purgeRoute({ exam: 'DEMO-2026', shift: 'S1', authority: verifier(authority.pub), db, log: (l) => logs.push(l) });
  const post = async (b: unknown) => { const r = await routes['/v1/purge'].POST!(new Request('http://relay/v1/purge', { method: 'POST', body: JSON.stringify(b) }), { timeout() {} }); return { status: r.status, body: await r.json() }; };
  const order = { exam: 'DEMO-2026', shift: 'S1', sthId: sthId(bundle.sth.sth), ts: 5 };
  expect((await post(signPurge(order, signer(cell)))).status).toBe(403);                  // signed, but not by the authority
  expect((await post(signPurge({ ...order, shift: 'S2' }, signer(authority)))).status).toBe(400);
  expect(await post(signPurge(order, signer(authority)))).toEqual({ status: 200, body: { purged: 3 } });
  expect(purgeRelay(db, 'DEMO-2026', 'S1')).toBe(0);
  expect(logs[0]).toMatch(/^PURGED /);
  relay.close();
});
