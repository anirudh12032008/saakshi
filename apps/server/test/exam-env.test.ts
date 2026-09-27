import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hexToBytes } from '@saakshi/core/bytes';
import type { KeysFile } from '@saakshi/core/dev';
import { FILES } from '@saakshi/core/directory';
import { codesFile, loadCellKey, loadExam, relayFiles } from '../src/exam-env.ts';
import { buildPackage, writePackage } from '../../../tools/package.ts';
import { provision } from '../../../tools/provision.ts';

const keys = JSON.parse(readFileSync(new URL('../../../fixtures/keys.json', import.meta.url), 'utf8')) as KeysFile;
const fx = (f: string) => JSON.parse(readFileSync(new URL(`../../../fixtures/paper/${f}`, import.meta.url), 'utf8'));
const authority = { priv: hexToBytes(keys.authority.priv), pub: hexToBytes(keys.authority.pub) };
let tmp: string, out: string;
beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'saakshi-env-'));
  out = join(tmp, 'exam');
  const d = provision({ out, keys, cands: [{ cand: 'C00001', centre: 'CEN001', form: 'F1', pwd: 0 }] });
  writePackage(out, await buildPackage(d, { bank: fx('bank.json'), forms: fx('forms.json') }, authority));
});
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

test('loads a provisioned, packaged exam: the certified cell key, the relay\'s own files, control\'s code list', () => {
  const X = loadExam(out, authority.pub);
  expect([X.dir.demoCentre, X.manifest.manifest.forms.length]).toEqual(['CEN042', 2]);
  expect(loadCellKey(X, 'cell-1').keyId).toBe(X.dir.cells[0].keyId);
  const rf = relayFiles(X, 'CEN042');
  expect([rf.cell.id, rf.wrap.length, Object.keys(rf.papers)]).toEqual(['cell-1', 104, ['F1', 'F2']]);
  expect(codesFile(X).length).toBeGreaterThan(40);
  expect(() => relayFiles(X, 'CEN999')).toThrow(/no centre CEN999/);
});

test('refuses a tampered cell certificate, a tampered manifest, or a key file the directory does not certify', () => {
  const edit = (rel: string, f: (x: any) => void) => { const p = join(out, rel), orig = readFileSync(p, 'utf8'), x = JSON.parse(orig); f(x); writeFileSync(p, JSON.stringify(x)); return () => writeFileSync(p, orig); };
  let undo = edit(FILES.directory, (d) => { d.cells[1].cert = '0'.repeat(128); });
  expect(() => loadExam(out, authority.pub)).toThrow(/certificate for cell-2/);
  undo();
  undo = edit(FILES.manifest, (m) => { m.manifest.ts++; });
  expect(() => loadExam(out, authority.pub)).toThrow(/manifest signature/);
  undo();
  undo = edit(FILES.cellKey('cell-1'), (k) => { k.pub = keys.cells[1].pub; });
  expect(() => loadCellKey(loadExam(out, authority.pub), 'cell-1')).toThrow(/not the key the directory certifies/);
  undo();
});
