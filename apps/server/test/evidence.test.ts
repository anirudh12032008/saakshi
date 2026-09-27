import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { hexToBytes } from '@saakshi/core/bytes';
import { cellKey, devPseud, trustFromKeys, type KeysFile } from '@saakshi/core/dev';
import { formsOf } from '@saakshi/core/sheet';
import { buildPack, esc } from '../src/evidence.ts';
import { proofFor, seal } from '../src/seal.ts';
import { FORMS, SimSeat } from '../../../tools/sim-seat.ts';

const keys = JSON.parse(readFileSync(new URL('../../../fixtures/keys.json', import.meta.url), 'utf8')) as KeysFile;
const cell = cellKey(keys, 'cell-1');
const trust = trustFromKeys(keys), forms = formsOf(FORMS);
const sha = (s: string | Uint8Array) => createHash('sha256').update(s).digest('hex');
const FILES = ['README.txt', 'audit.json', 'certificate-s63.html', 'custody.jsonl', 'manifest.sha256', 'proof.json', 'report.html', 'sth.json', 'verify.html'];

function proof() {
  const s = new SimSeat(keys, 'C0001', cell.pub);
  s.add(21); s.submit();
  const exp = { cell: 'cell-1', exam: 'DEMO-2026', shift: 'S1', sheets: [s.sheet()] };
  const { rec } = seal(undefined, exp, { authority: { priv: hexToBytes(keys.authority.priv), pub: hexToBytes(keys.authority.pub) }, trust, pseud: devPseud });
  return proofFor(rec, exp.sheets[0])!;
}
const input = (p = proof()) => ({ proof: p, findings: [], custody: ['{"at":"2026-09-27T10:00:00.000Z","action":"seal"}'], verifyHtml: '<!doctype html><title>Saakshi · Verify</title>', forms, trust, now: Date.UTC(2026, 8, 27, 10, 30, 0) });

test('the pack holds every file, the manifest hashes each of them, and the tar.gz carries the same bytes under <name>/', async () => {
  const pack = await buildPack(input());
  expect(pack.name).toBe('evidence-DEMO-2026-S1-C0001-20260927T103000Z');
  expect(Object.keys(pack.files).sort()).toEqual(FILES);
  const lines = pack.files['manifest.sha256'].trim().split('\n');
  expect(lines.length).toBe(FILES.length - 1);
  for (const l of lines) { const [h, f] = l.split('  '); expect(sha(pack.files[f])).toBe(h); }
  const files = await new Bun.Archive(pack.tgz).files();
  for (const f of FILES) expect(await files.get(`${pack.name}/${f}`)!.text()).toBe(pack.files[f]);
  expect(JSON.parse(pack.files['proof.json']).v).toBe(1);
});

test('the report states the verdict and the certificate cites s.63 with the file hashes', async () => {
  const p = proof();
  p.sheet.entries[17].body = ['body', 'I17', 'A', 'B', [1000, []]];
  const pack = await buildPack(input(p));
  expect(pack.files['report.html']).toContain('Q17: record says B — the seat committed C');
  const cert = pack.files['certificate-s63.html'];
  expect(cert).toContain('Section 63');
  expect(cert).toContain('Bharatiya Sakshya Adhiniyam, 2023');
  expect(cert).toContain(sha(pack.files['proof.json']));
  expect(cert).toContain('SHA-256');
});

test('report.html escapes recorded strings, so a hostile record cannot inject markup', async () => {
  const p = proof();
  p.sheet.entries[2].body = ['body', 'I01', 'A', '<img src=x onerror=alert(1)>', [1000, []]];
  const html = (await buildPack(input(p))).files['report.html'];
  expect(html).not.toContain('<img src=x');
  expect(html).toContain('&#60;img src=x onerror=alert(1)&#62;');
  expect(esc(`<"'&>`)).toBe('&#60;&#34;&#39;&#38;&#62;');
});
