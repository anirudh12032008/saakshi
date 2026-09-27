import { afterEach, beforeAll, beforeEach, expect, test } from 'bun:test';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hexToBytes, toHex } from '@saakshi/core/bytes';
import { sealBox } from '@saakshi/core/box';
import { combineBundle } from '@saakshi/core/custody';
import type { KeysFile } from '@saakshi/core/dev';
import type { Directory, ReleaseStatus } from '@saakshi/core/directory';
import { verifier } from '@saakshi/core/node';
import { checkRelease, openCodes, openShareFile, shareInfo, type ReleaseMsg } from '@saakshi/core/paper';
import { releaseControl } from '../src/release-control.ts';
import { buildPackage, type Package } from '../../../tools/package.ts';

const keys = JSON.parse(readFileSync(new URL('../../../fixtures/keys.json', import.meta.url), 'utf8')) as KeysFile;
const fx = (f: string) => JSON.parse(readFileSync(new URL(`../../../fixtures/paper/${f}`, import.meta.url), 'utf8'));
const authority = { priv: hexToBytes(keys.authority.priv), pub: hexToBytes(keys.authority.pub) };
const X = { exam: 'DEMO-2026', shift: 'S1' };
const dir = { v: 1, ...X, durationMs: 1, demoCentre: 'CEN042', issuedAt: 0, cells: [], cands: {},
  centres: { CEN042: { cell: 'cell-1' }, CEN001: { cell: 'cell-2' }, CEN002: { cell: 'cell-3' } } } as unknown as Directory;
const cells = [{ id: 'cell-1', url: 'u1' }, { id: 'cell-2', url: 'u2' }, { id: 'cell-3', url: 'u3' }];
let pkg: Package, other: Package, codes: Record<string, string>, tmp: string;
let rc: ReturnType<typeof releaseControl>, pushed: { url: string; rs: ReleaseMsg[] }[], down: Set<string>;
const srv = { timeout() {} };

beforeAll(async () => {
  pkg = await buildPackage(dir, { bank: fx('bank.json'), forms: fx('forms.json') }, authority);
  other = await buildPackage(dir, { bank: fx('bank.json'), forms: fx('forms.json') }, authority);    // another packaging run: other keys
  const k = await combineBundle([openShareFile(pkg.shares.NTA, pkg.passphrases.NTA), openShareFile(pkg.shares.OBS, pkg.passphrases.OBS)]);
  codes = openCodes(k.L, X.exam, X.shift, pkg.codes);
});
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'saakshi-rc-'));
  pushed = []; down = new Set();
  rc = releaseControl({ dir: tmp, ...X, authority, manifest: pkg.manifest, codes: pkg.codes, cells, retryMs: 10, now: () => 1_790_000_100_000,
    push: async (url, rs) => { if (down.has(url)) throw new Error('connect ECONNREFUSED'); pushed.push({ url, rs }); } });
});
afterEach(() => { rc.close(); rmSync(tmp, { recursive: true, force: true }); });

async function call<T>(path: string, method: 'GET' | 'POST', body?: unknown): Promise<{ status: number; body: T }> {
  const r = await rc.routes[path][method]!(new Request(`http://control${path}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }), srv);
  return { status: r.status, body: (await r.json()) as T };
}
/** What /custodian does in the browser: decrypt the share locally, seal it to control's in-memory release key. */
async function share(c: string, from: Package = pkg, damage = false) {
  const key = (await call<{ keyId: string; pub: string }>('/v1/release/key', 'GET')).body;
  const s = openShareFile(from.shares[c], from.passphrases[c]);
  if (damage) s[3] ^= 1;
  return call<ReleaseStatus & { error?: string }>('/v1/release/share', 'POST', { custodian: c, keyId: key.keyId, box: toHex(sealBox(hexToBytes(key.pub), shareInfo(X.exam, X.shift, c, key.keyId), s)) });
}
const actions = () => readFileSync(join(tmp, 'custody.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l).action as string);
const until = async (ok: () => boolean) => { for (let i = 0; i < 200 && !ok(); i++) await Bun.sleep(10); expect(ok()).toBe(true); };

test('two distinct custodians release: kc_f checked, a signed release per form pushed to every cell, keys zeroised, all logged', async () => {
  expect((await call('/v1/release/code', 'POST', { centre: 'CEN042', superintendent: 'SUP-42', callback: true })).status).toBe(409);   // sealed before T0
  const first = (await share('NTA')).body;
  expect([first.received, first.needed, first.released]).toEqual([['NTA'], 2, undefined]);
  const r = await share('NIC');
  expect(r.body.released).toEqual({ at: 1_790_000_100_000, custodians: ['NTA', 'NIC'], forms: pkg.manifest.manifest.forms.map((f) => ({ form: f.form, kcf: f.kcf })) });
  expect(pushed.map((p) => p.url)).toEqual(['u1', 'u2', 'u3']);
  for (const p of pushed) for (const rel of p.rs) expect(checkRelease(rel, pkg.manifest.manifest, rel.form, verifier(authority.pub)).ok).toBe(true);
  expect(rc.status()).toMatchObject({ zeroised: true, pushed: { 'cell-1': true, 'cell-2': true, 'cell-3': true } });
  expect(actions()).toEqual(['release-key', 'share-received', 'share-received', 'release', 'release-pushed', 'release-pushed', 'release-pushed', 'keys-zeroised']);
  expect((await share('OBS')).body.released?.custodians).toEqual(['NTA', 'NIC']);   // late shares change nothing
});

test('Review Focus #1: the same custodian twice counts once; a damaged share cannot release, and a third custodian still can', async () => {
  await share('NTA');
  const twice = (await share('NTA')).body;
  expect([twice.received, twice.released]).toEqual([['NTA'], undefined]);
  const bad = await share('NIC', pkg, true);
  expect([bad.status, bad.body.error]).toEqual([409, expect.stringContaining('do not rebuild the committed keys')]);
  expect(pushed).toEqual([]);
  const wrongExam = await share('OBS', other);
  expect(wrongExam.status).toBe(409);                                              // another packaging's share: kc_f says no
  const ok = await share('OBS');
  expect(ok.body.released?.custodians).toEqual(['NTA', 'OBS']);
  expect((await call('/v1/release/share', 'POST', { custodian: 'EVE', keyId: 'x', box: '' })).status).toBe(400);
  expect((await call('/v1/release/share', 'POST', { custodian: 'NIC', keyId: 'stale', box: '' })).status).toBe(409);
});

test('Review Focus #1: a double click (two shares at once) releases once, pushes each cell once', async () => {
  await share('NTA');
  const rs = await Promise.all([share('NIC'), share('NIC'), share('OBS')]);
  expect(rs.map((r) => r.status)).toEqual([200, 200, 200]);
  expect(pushed.map((p) => p.url)).toEqual(['u1', 'u2', 'u3']);
  expect(actions().filter((a) => a === 'release' || a === 'keys-zeroised')).toEqual(['release', 'keys-zeroised']);
});

test('a cell that is down gets the release when it returns; control zeroises only after every cell has it', async () => {
  down.add('u2');
  await share('NTA'); await share('NIC');
  expect(rc.status()).toMatchObject({ zeroised: false, pushed: { 'cell-1': true, 'cell-2': false, 'cell-3': true } });
  down.delete('u2');
  await until(() => rc.status().zeroised);
  expect(pushed.map((p) => p.url)).toEqual(['u1', 'u3', 'u2']);
  expect(actions()).toContain('release-push-failed');
  expect(actions().filter((a) => a === 'release-pushed').length).toBe(3);
  expect(actions().at(-1)).toBe('keys-zeroised');
});

test('the phoned-in code: only the asked centre\'s code, only after a call-back, each reveal logged; nothing secret on control\'s disk', async () => {
  await share('NTA'); await share('OBS');
  expect((await call('/v1/release/code', 'POST', { centre: 'CEN042', superintendent: 'SUP-42' })).status).toBe(400);   // no call-back
  expect((await call('/v1/release/code', 'POST', { centre: 'CEN999', superintendent: 'SUP-42', callback: true })).status).toBe(400);
  const r = await call<{ centre: string; shift: string; code: string }>('/v1/release/code', 'POST', { centre: 'CEN042', superintendent: 'SUP-42', callback: true });
  expect(r.body).toMatchObject({ centre: 'CEN042', shift: 'S1', code: codes.CEN042 });
  expect(JSON.stringify(r.body).includes(codes.CEN001)).toBe(false);
  expect(rc.status().reveals).toEqual([{ at: 1_790_000_100_000, centre: 'CEN042', superintendent: 'SUP-42' }]);
  expect(actions().at(-1)).toBe('offline-code-revealed');
  const disk = readdirSync(tmp).map((f) => readFileSync(join(tmp, f), 'utf8')).join('\n');
  for (const c of Object.values(codes)) expect(disk.includes(c)).toBe(false);
  for (const c of ['NTA', 'OBS']) expect(disk.includes(toHex(openShareFile(pkg.shares[c], pkg.passphrases[c])))).toBe(false);
});
