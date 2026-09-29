import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { hexToBytes } from '@saakshi/core/bytes';
import { cellKey, devPseud, trustFromKeys, type KeysFile } from '@saakshi/core/dev';
import { formsOf } from '@saakshi/core/sheet';
import { verifyProof } from '@saakshi/core/verify';
import { proofFor, seal } from '../src/seal.ts';
import { verifyHtml } from '../src/verify-build.ts';
import { witnessLine } from '../src/control-view.ts';
import { viewOf } from '../src/verify-view.ts';
import { FORMS, SimSeat } from '../../../tools/sim-seat.ts';

const keys = JSON.parse(readFileSync(new URL('../../../fixtures/keys.json', import.meta.url), 'utf8')) as KeysFile;
const cell = cellKey(keys, 'cell-1');
const trust = trustFromKeys(keys), forms = formsOf(FORMS);
const src = readFileSync(join(import.meta.dir, '../src/verify-page.ts'), 'utf8');

function proof() {
  const s = new SimSeat(keys, 'C0001', cell.pub);
  s.add(21); s.submit();
  const exp = { cell: 'cell-1', exam: 'DEMO-2026', shift: 'S1', sheets: [s.sheet()] };
  const { rec } = seal(undefined, exp, { authority: { priv: hexToBytes(keys.authority.priv), pub: hexToBytes(keys.authority.pub) }, trust, pseud: devPseud });
  return proofFor(rec, exp.sheets[0])!;
}

test('verify.html compiles to one self-contained page with no network, no Node and no private keys', async () => {
  const html = await verifyHtml();
  expect(html).toContain('<title>Saakshi · Verify</title>');
  expect(html).not.toMatch(/<script[^>]*\ssrc=/i);
  expect(html).not.toMatch(/<link[^>]*\shref=/i);
  expect(html).not.toMatch(/https?:\/\/(?!www\.w3\.org)/);                     // no CDN or remote URL (SVG namespaces are fine)
  expect(html).not.toContain('createPrivateKey');
  expect(html).not.toContain('node:crypto');
  for (const k of [keys.authority, ...keys.cells, ...keys.seats]) expect(html).not.toContain(k.priv);
  expect(html).toContain(keys.authority.pub);                                    // the pinned trust anchor is inside
  expect(await verifyHtml()).toBe(html);                                         // cached
});

test('the page renders untrusted text with textContent only, and fetches only its own /v1/proof and /v1/witness', () => {
  expect(src).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
  expect([...src.matchAll(/fetch\(/g)].length).toBe(2);
  expect(src).toContain('/v1/proof?cand=');
});

test('viewOf: an honest proof is a match; an edited answer is "altered" with the headline', () => {
  const p = proof();
  const ok = viewOf(verifyProof(p, forms, trust));
  expect(ok.verdict).toBe('match');
  expect(ok.rows.every((r) => r.ok)).toBe(true);
  p.sheet.entries[17].body = ['body', 'I17', 'A', 'B', [1000, []]];
  const bad = viewOf(verifyProof(p, forms, trust));
  expect(bad.verdict).toBe('altered');
  expect(bad.title).toBe('The record was altered after the seat committed it');
  expect(bad.headline).toBe('Q17: record says B — the seat committed C');
  expect(bad.rows.find((r) => r.label.startsWith('Answers'))!.ok).toBe(false);
});

test('viewOf: a proof that does not verify for other reasons is "invalid"', () => {
  const p = proof();
  p.sth.sig = p.sth.sig.replace(/^./, (c) => (c === '0' ? '1' : '0'));
  const v = viewOf(verifyProof(p, forms, trust));
  expect(v.verdict).toBe('invalid');
  expect(v.headline).toMatch(/register head/);
});

test('the cosign status line reads GET /v1/witness', () => {
  expect(witnessLine({ cosig: { size: 7, ts: Date.UTC(2026, 8, 29, 10, 0, 0) } })).toBe('Witness cosigned STH #7 at 2026-09-29T10:00:00.000Z');
  expect(witnessLine({})).toBe('Witness: not cosigned');
  expect(witnessLine(undefined)).toBe('Witness: not cosigned');
});

test('/verify (served) and the control dashboard both show the cosign status', () => {
  expect(src).toContain("fetch('/v1/witness')");
  expect(src).toContain('`Witness cosigned STH #${w.cosig.size} at ${new Date(w.cosig.ts).toISOString()}` : \'Witness: not cosigned\'');
  expect(readFileSync(join(import.meta.dir, '../src/control-page.ts'), 'utf8')).toContain("'/v1/witness'");
  for (const f of ['verify.html', 'control.html']) expect(readFileSync(join(import.meta.dir, `../src/${f}`), 'utf8')).toContain('id="witness"');
});
