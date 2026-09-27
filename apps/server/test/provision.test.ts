import { afterEach, beforeEach, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hexToBytes } from '@saakshi/core/bytes';
import { devPseud, type KeysFile } from '@saakshi/core/dev';
import { FILES, rosterOf, type CellKeyFile, type Directory } from '@saakshi/core/directory';
import { cellKeyArray, cellKeyId, msg } from '@saakshi/core/enrol';
import { verifier } from '@saakshi/core/node';
import { OPS_DEMO } from '@saakshi/core/ops';
import { openPolicy, type SignedPolicy } from '@saakshi/core/policy';
import { provision, type CohortCand } from '../../../tools/provision.ts';

const keys = JSON.parse(readFileSync(new URL('../../../fixtures/keys.json', import.meta.url), 'utf8')) as KeysFile;
const A = verifier(hexToBytes(keys.authority.pub));
let tmp: string, out: string;
beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 'saakshi-prov-')); out = join(tmp, 'exam'); });
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

const cands: CohortCand[] = [
  { cand: 'C00001', centre: 'CEN001', form: 'F1', pwd: 0, lang: 'en' }, { cand: 'C00002', centre: 'CEN002', form: 'F2', pwd: 1, lang: 'hi' },
  { cand: 'C00003', centre: 'CEN003', form: 'F1', pwd: 0, lang: 'ta' }, { cand: 'C00004', centre: 'CEN004', form: 'F2', pwd: 0, lang: 'en' },
  { cand: 'C00005', centre: 'CEN042', form: 'F1', pwd: 0, lang: 'en' },                         // G1's own CEN042 row: the real centre replaces it
];
const read = <T>(rel: string) => JSON.parse(readFileSync(join(out, rel), 'utf8')) as T;

test('directory: CEN042 is the real centre on cell-1 with the 8 fixture candidates; cohort centres go round-robin over the cells', () => {
  const d = provision({ out, keys, cands, now: 1 });
  expect(read<Directory>(FILES.directory)).toEqual(d);
  expect(d).toMatchObject({ exam: 'DEMO-2026', shift: 'S1', durationMs: 1_800_000, demoCentre: 'CEN042' });
  expect(rosterOf(d, 'CEN042')).toEqual(['C0001', 'C0002', 'C0003', 'C0004', 'C0005', 'C0006', 'C0007', 'C0008']);
  expect(d.cands.C00005).toBeUndefined();
  expect(Object.fromEntries(Object.entries(d.centres).map(([c, v]) => [c, v.cell]))).toEqual({ CEN042: 'cell-1', CEN001: 'cell-1', CEN002: 'cell-2', CEN003: 'cell-3', CEN004: 'cell-1' });
  expect(d.cells.map((c) => c.url)).toEqual(['http://127.0.0.1:7080', 'http://127.0.0.1:7081', 'http://127.0.0.1:7082']);
  expect(d.cands.C00002.extraMs).toBe(600_000);                                    // PwD: 20 min per hour → D/3
  expect(d.cands.C0002.form).toBe('F2');
});

test('every cell certificate and every policy verifies under the authority; each policy pins its own cell', () => {
  const d = provision({ out, keys, cands, cellUrls: ['http://a:1', 'http://b:2', 'http://c:3'] });
  expect(d.cells.map((c) => c.url)).toEqual(['http://a:1', 'http://b:2', 'http://c:3']);
  for (const c of d.cells) {
    expect(c.keyId).toBe(cellKeyId(hexToBytes(c.pub)));
    expect(A(msg(cellKeyArray({ exam: d.exam, cellId: c.id, keyId: c.keyId, pub: c.pub })), hexToBytes(c.cert))).toBe(true);
    const f = read<CellKeyFile>(FILES.cellKey(c.id));
    expect([f.id, f.keyId, f.pub]).toEqual([c.id, c.keyId, c.pub]);
  }
  for (const centre of Object.keys(d.centres)) {
    const p = openPolicy(read<SignedPolicy>(FILES.policy(centre)), A, d);
    const cell = d.cells.find((c) => c.id === d.centres[centre].cell)!;
    expect(p.cell).toEqual({ id: cell.id, keyId: cell.keyId, pub: cell.pub });
    expect(Object.keys(p.roster).sort()).toEqual(rosterOf(d, centre));
    for (const [cand, e] of Object.entries(p.roster)) expect(e).toEqual({ form: d.cands[cand].form, extraMs: d.cands[cand].extraMs, pseud: d.cands[cand].pseud, ...(e.acc ? { acc: e.acc } : {}) });
  }
});

test('pseudonyms come from a fresh control key, not the published DEV key', () => {
  const d = provision({ out, keys, cands });
  expect(readFileSync(join(out, FILES.pseudKey), 'utf8')).toMatch(/^[0-9a-f]{64}$/);
  expect(d.cands.C0001.pseud).toMatch(/^[0-9a-f]{64}$/);
  expect(d.cands.C0001.pseud).not.toBe(devPseud('C0001'));
});

test('refuses to provision over an existing exam directory', () => {
  provision({ out, keys, cands });
  expect(() => provision({ out, keys, cands })).toThrow(/already provisioned/);
  expect(existsSync(join(out, FILES.directory))).toBe(true);
});

test('provision --demo writes the DEMO ops into the directory; without it there are none (the defaults apply)', () => {
  const a = provision({ out: join(tmp, 'a'), keys, cands: [], ops: OPS_DEMO });
  expect(a.ops).toEqual(OPS_DEMO);
  expect(provision({ out: join(tmp, 'b'), keys, cands: [] }).ops).toBeUndefined();
});

test('Stage 5: each policy carries a signed integrity section; the review key is written once; the demo scribe seat has 2 faces', async () => {
  const d = provision({ out, keys, cands, relayHosts: { CEN042: '192.168.1.10:7070' } });
  const rk = JSON.parse(readFileSync(join(out, FILES.reviewKey), 'utf8'));
  const p = openPolicy(read<SignedPolicy>(FILES.policy('CEN042')), A, d);
  expect(p.integrity!.reviewPub).toBe(rk.pub);
  expect(p.integrity!.egress).toEqual(['192.168.1.10:7070']);
  const second = Object.keys(p.roster).sort()[1];
  expect(p.roster[second].acc).toEqual({ faces: 2, assistive: ['NVDA', 'VoiceOver'] });
  // "written once and reused if present" — provision() refuses to re-run over an already-provisioned exam directory
  // (existing invariant, pinned above), so exercise reuse against a fresh `out` that already has a review key on disk
  // (e.g. left over from a crashed/retried provisioning run) rather than re-provisioning the same directory.
  const out2 = join(tmp, 'retry');
  mkdirSync(join(out2, 'control'), { recursive: true });
  writeFileSync(join(out2, FILES.reviewKey), JSON.stringify({ priv: 'seed-priv', pub: 'seed-pub' }));
  provision({ out: out2, keys, cands });
  expect(JSON.parse(readFileSync(join(out2, FILES.reviewKey), 'utf8')).pub).toBe('seed-pub');
});

test('provision writes lang and pwd per candidate and creates a decision key', () => {
  const d = provision({ out, keys, cands });
  expect(d.cands.C00001.lang).toBe('en');
  expect(d.cands.C00001.pwd).toBe(0);
  expect(d.cands.C00002.lang).toBe('hi');
  expect(d.cands.C00002.pwd).toBe(1);
  expect(d.cands.C00003.lang).toBe('ta');
  expect(d.cands.C00003.pwd).toBe(0);
  const decKey = read<{ priv: string; pub: string }>(FILES.decisionKey);
  expect(decKey.priv).toMatch(/^[0-9a-f]{64}$/);
  expect(decKey.pub).toMatch(/^[0-9a-f]{130}$/);
  expect(existsSync(join(out, FILES.decisionKey))).toBe(true);
});
