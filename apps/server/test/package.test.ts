import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hexToBytes } from '@saakshi/core/bytes';
import { combineBundle, unwrapForCentre } from '@saakshi/core/custody';
import type { KeysFile } from '@saakshi/core/dev';
import { CUSTODIANS, FILES, type Directory } from '@saakshi/core/directory';
import { verifier } from '@saakshi/core/node';
import { checkManifest, ciphertextHash, openCodes, openPaper, openShareFile, type Manifest } from '@saakshi/core/paper';
import { kcf } from '@saakshi/core/protocol';
import { buildPackage, writePackage, zeroise, type Package } from '../../../tools/package.ts';

const keys = JSON.parse(readFileSync(new URL('../../../fixtures/keys.json', import.meta.url), 'utf8')) as KeysFile;
const fx = (f: string) => JSON.parse(readFileSync(new URL(`../../../fixtures/paper/${f}`, import.meta.url), 'utf8'));
const paper = () => ({ bank: fx('bank.json'), forms: fx('forms.json') });
const authority = { priv: hexToBytes(keys.authority.priv), pub: hexToBytes(keys.authority.pub) };
const dir = { v: 1, exam: 'DEMO-2026', shift: 'S1', durationMs: 1_800_000, demoCentre: 'CEN042', issuedAt: 0, cells: [], cands: {},
  centres: { CEN042: { cell: 'cell-1' }, CEN001: { cell: 'cell-2' }, CEN002: { cell: 'cell-3' } } } as unknown as Directory;
let p: Package, m: Manifest, root: string;
beforeAll(async () => {
  p = await buildPackage(dir, paper(), authority, 1_790_000_000_000);
  m = checkManifest(p.manifest, verifier(authority.pub));
  root = mkdtempSync(join(tmpdir(), 'saakshi-pkg-'));
  writePackage(root, p);
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

test('ciphertext only: no question text in either form on disk; the files are exactly what the manifest commits to', () => {
  const bank = fx('bank.json') as { items: { en: { q: string }; hi: { q: string } }[] };
  for (const f of ['F1', 'F2']) {
    const ct = readFileSync(join(root, FILES.paper(f)));
    for (const it of bank.items) { expect(ct.includes(Buffer.from(it.en.q))).toBe(false); expect(ct.includes(Buffer.from(it.hi.q))).toBe(false); }
    expect(ciphertextHash(new Uint8Array(ct))).toBe(m.forms.find((x) => x.form === f)!.ciphertextHash);
  }
  expect(JSON.parse(readFileSync(join(root, FILES.manifest), 'utf8'))).toEqual(p.manifest);
  expect(m.ts).toBe(1_790_000_000_000);
  expect(readdirSync(root).sort()).toEqual(['custodians', 'package']);           // no passphrase or plaintext file anywhere
});

test('any two custodians rebuild keys that match kc_f and open the paper in form order; one share or a wrong passphrase cannot', async () => {
  const raw = Object.fromEntries(CUSTODIANS.map((c) => [c, openShareFile(JSON.parse(readFileSync(join(root, FILES.share(c)), 'utf8')), p.passphrases[c])]));
  for (const [a, b] of [['NTA', 'NIC'], ['NTA', 'OBS'], ['NIC', 'OBS']]) {
    const k = await combineBundle([raw[a], raw[b]]);
    expect([kcf(k.kF1), kcf(k.kF2)]).toEqual(m.forms.map((f) => f.kcf));
    const doc = JSON.parse(new TextDecoder().decode(openPaper(k.kF2, { exam: 'DEMO-2026', shift: 'S1', form: 'F2' }, p.papers.F2)));
    expect(doc.items.map((i: { id: string }) => i.id)).toEqual(fx('forms.json').F2);
  }
  await expect(combineBundle([raw.NTA])).rejects.toThrow(/2 of 3/);
  expect(() => openShareFile(p.shares.NTA, p.passphrases.NIC)).toThrow(/wrong passphrase/);
});

test('the code list opens with L; each centre\'s code unwraps only its own wrap, not another centre\'s, not another shift\'s', async () => {
  const k = await combineBundle([openShareFile(p.shares.NTA, p.passphrases.NTA), openShareFile(p.shares.OBS, p.passphrases.OBS)]);
  const codes = openCodes(k.L, 'DEMO-2026', 'S1', new Uint8Array(readFileSync(join(root, FILES.codes))));
  expect(Object.keys(codes).sort()).toEqual(['CEN001', 'CEN002', 'CEN042']);
  const wraps = JSON.parse(readFileSync(join(root, FILES.wraps), 'utf8')) as Record<string, string>;
  const c42 = { exam: 'DEMO-2026', shift: 'S1', centre: 'CEN042' };
  expect(kcf(unwrapForCentre(codes.CEN042, c42, hexToBytes(wraps.CEN042)).kF1)).toBe(m.forms[0].kcf);
  expect(() => unwrapForCentre(codes.CEN001, c42, hexToBytes(wraps.CEN042))).toThrow();
  const s2 = await buildPackage({ ...dir, shift: 'S2' }, paper(), authority);
  const s2k = await combineBundle([openShareFile(s2.shares.NTA, s2.passphrases.NTA), openShareFile(s2.shares.NIC, s2.passphrases.NIC)]);
  expect(() => unwrapForCentre(openCodes(s2k.L, 'DEMO-2026', 'S2', s2.codes).CEN042, c42, hexToBytes(wraps.CEN042))).toThrow();
});

test('zeroise wipes every secret the packager generated and forgets the passphrases', async () => {
  const q = await buildPackage(dir, paper(), authority);
  expect(q.secrets.length).toBe(6);                                                // K_F1, K_F2, L and the three raw shares
  zeroise(q);
  for (const s of q.secrets) expect(s.every((b) => b === 0)).toBe(true);
  expect(q.passphrases).toEqual({});
});
