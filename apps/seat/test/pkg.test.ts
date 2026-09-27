import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hexToBytes, toHex } from '@saakshi/core/bytes';
import { combineBundle } from '@saakshi/core/custody';
import type { KeysFile } from '@saakshi/core/dev';
import type { Directory } from '@saakshi/core/directory';
import { msg } from '@saakshi/core/enrol';
import { newKeyPair, signer } from '@saakshi/core/node';
import { manifestArray, openShareFile } from '@saakshi/core/paper';
import { signPolicy } from '@saakshi/core/policy';
import { toB64 } from '@saakshi/core/wire';
import { loadPackage, verifyPackage, type PackageWire } from '../src/main/pkg.ts';
import { buildPackage } from '../../../tools/package.ts';

const keys = JSON.parse(readFileSync(new URL('../../../fixtures/keys.json', import.meta.url), 'utf8')) as KeysFile;
const fx = (f: string) => JSON.parse(readFileSync(new URL(`../../../fixtures/paper/${f}`, import.meta.url), 'utf8'));
const authority = { priv: hexToBytes(keys.authority.priv), pub: hexToBytes(keys.authority.pub) };
const want = { exam: 'DEMO-2026', shift: 'S1', cand: 'C0001' };
const dir = { v: 1, exam: 'DEMO-2026', shift: 'S1', durationMs: 1, demoCentre: 'CEN042', issuedAt: 0, cells: [], cands: {}, centres: { CEN042: { cell: 'cell-1' } } } as unknown as Directory;
async function fixture(): Promise<{ w: PackageWire; K: { kF1: Uint8Array; kF2: Uint8Array } }> {
  const p = await buildPackage(dir, { bank: fx('bank.json'), forms: fx('forms.json') }, authority);
  const K = await combineBundle([openShareFile(p.shares.NTA, p.passphrases.NTA), openShareFile(p.shares.NIC, p.passphrases.NIC)]);
  const policy = signPolicy({ v: 1, exam: 'DEMO-2026', shift: 'S1', centre: 'CEN042', cell: { id: 'cell-1', keyId: 'k', pub: keys.cells[0].pub }, durationMs: 1_800_000,
    roster: { C0001: { form: 'F1', extraMs: 0, pseud: '7'.repeat(64) } }, issuedAt: 0 }, signer(authority));
  return { w: { policy, manifest: p.manifest, paper: { F1: toB64(p.papers.F1), F2: toB64(p.papers.F2) } }, K };
}

test('a signed package verifies; the paper stays ciphertext until a key arrives', async () => {
  const { w } = await fixture();
  const pkg = verifyPackage(w, authority.pub, want);
  assert.equal(pkg.policy.centre, 'CEN042');
  assert.deepEqual(pkg.manifest.forms.map((f) => f.form), ['F1', 'F2']);
  assert.equal(Buffer.from(pkg.papers.F1).includes(Buffer.from('SI unit')), false);
});

test('the seat rejects an unsigned or altered policy, a manifest signed by a stranger, a paper that is not the committed one, and a candidate not on the roster', async () => {
  const { w } = await fixture();
  assert.throws(() => verifyPackage({ ...w, policy: { text: w.policy.text, sig: '' } }, authority.pub, want), /not signed/);
  assert.throws(() => verifyPackage({ ...w, policy: { ...w.policy, text: w.policy.text.replace('1800000', '9999999') } }, authority.pub, want), /does not verify/);
  const forged = { ...w.manifest, sig: toHex(signer(newKeyPair())(msg(manifestArray(w.manifest.manifest)))) };
  assert.throws(() => verifyPackage({ ...w, manifest: forged }, authority.pub, want), /manifest signature/);
  assert.throws(() => verifyPackage({ ...w, paper: { ...w.paper, F1: w.paper.F2 } }, authority.pub, want), /not the one the manifest commits to/);
  assert.throws(() => verifyPackage(w, authority.pub, { ...want, cand: 'C0999' }), /not on CEN042's roster/);
});

test('loadPackage saves only a verified package, then works with no relay', async () => {
  const { w } = await fixture();
  const path = join(mkdtempSync(join(tmpdir(), 'saakshi-pkg-')), 'p.json');
  let calls = 0;
  const serve = (body: unknown) => (async (url: URL) => { calls++; assert.equal(String(url), 'http://relay:7070/v1/package'); return Response.json(body); }) as unknown as typeof fetch;
  await assert.rejects(loadPackage({ path, relayUrl: 'http://relay:7070', authorityPub: authority.pub, want, fetch: serve({ ...w, policy: { ...w.policy, sig: '' } }) }), /not signed/);
  assert.equal(existsSync(path), false);
  await loadPackage({ path, relayUrl: 'http://relay:7070', authorityPub: authority.pub, want, fetch: serve(w) });
  const offline = (async () => { throw new Error('offline'); }) as unknown as typeof fetch;
  assert.equal((await loadPackage({ path, relayUrl: 'http://relay:7070', authorityPub: authority.pub, want, fetch: offline })).policy.centre, 'CEN042');
  assert.equal(calls, 2);
});
