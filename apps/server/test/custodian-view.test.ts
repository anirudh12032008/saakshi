import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { hexToBytes, randomBytes, toHex } from '@saakshi/core/bytes';
import { openBox } from '@saakshi/core/box';
import type { ReleaseStatus } from '@saakshi/core/directory';
import { cellKeyId } from '@saakshi/core/enrol';
import { newKeyPair } from '@saakshi/core/node';
import { sealShareFile, shareInfo } from '@saakshi/core/paper';
import { fingerprint, parseShareFile, shareRequest, statusText } from '../src/custodian-view.ts';

const share = randomBytes(97), pass = 'N5JY1E59BR0FGNVQW';
const file = sealShareFile(share, pass, { exam: 'DEMO-2026', shift: 'S1', custodian: 'NIC' });
const eph = newKeyPair(), key = { exam: 'DEMO-2026', shift: 'S1', keyId: cellKeyId(eph.pub), pub: toHex(eph.pub) };
function typeScaleOk(html: string): boolean {
  const steps = [...html.matchAll(/--s-?\d:\s*([\d.]+)rem/g)].map((m) => Number(m[1])).sort((a, b) => a - b);
  const ratios = steps.slice(1).map((s, i) => s / steps[i]);
  const decls = [...html.matchAll(/font(-size)?:\s*([^;}]+)/g)].map((m) => m[2]);
  return steps.length >= 3 && ratios.every((r) => r >= 1.249) && decls.every((d) => d.trim() === 'inherit' || d.includes('var(--s'));
}

test('the share is decrypted here and leaves only sealed to control\'s release key', () => {
  const req = shareRequest(parseShareFile(JSON.stringify(file)), 'n5jy-1e59 br0f-gnvq-w', key);
  expect([req.custodian, req.keyId]).toEqual(['NIC', key.keyId]);
  expect(req.box.includes(toHex(share))).toBe(false);
  expect(openBox(eph.priv, shareInfo('DEMO-2026', 'S1', 'NIC', key.keyId), hexToBytes(req.box))).toEqual(share);
  expect(() => openBox(newKeyPair().priv, shareInfo('DEMO-2026', 'S1', 'NIC', key.keyId), hexToBytes(req.box))).toThrow();
});

test('clear errors: not a share file, a wrong passphrase, a share for another exam or shift', () => {
  expect(() => parseShareFile('hello')).toThrow(/not a share file/);
  expect(() => parseShareFile('{"v":2}')).toThrow(/not a Saakshi share file/);
  expect(() => shareRequest(file, 'WRONGPASSPHRASE00', key)).toThrow(/wrong passphrase/);
  expect(() => shareRequest(file, pass, { ...key, shift: 'S2' })).toThrow('This share is for DEMO-2026 S1; control is releasing DEMO-2026 S2.');
});

test('status reads plainly, and the fingerprint is grouped for reading aloud', () => {
  const s = { exam: 'DEMO-2026', shift: 'S1', keyId: 'k', custodians: ['NTA', 'NIC', 'OBS'], received: ['NTA'], needed: 2, pushed: {}, zeroised: false, reveals: [] } as unknown as ReleaseStatus;
  expect(statusText(s)).toBe('Control has 1 of 2 shares (NTA). 1 more needed.');
  expect(statusText({ ...s, released: { at: Date.UTC(2026, 8, 27, 4, 30, 3), custodians: ['NTA', 'NIC'], forms: [] } })).toBe('Released at 04:30:03 UTC by NTA + NIC. Thank you.');
  expect(fingerprint('feedfacecafebeef')).toBe('feed face cafe beef');
});

test('the page builds for the browser without Node built-ins or remote scripts, keeps a 1.25 type scale, and renders text safely', async () => {
  const out = await Bun.build({ entrypoints: [join(import.meta.dir, '../src/custodian.html')], target: 'browser', minify: true, throw: false });
  expect(out.success).toBe(true);
  const text = (await Promise.all(out.outputs.map((o) => o.text()))).join('\n');
  expect(text).not.toMatch(/<script[^>]*\ssrc=["']https?:/i);
  expect(text).not.toContain('createPrivateKey');
  const html = readFileSync(join(import.meta.dir, '../src/custodian.html'), 'utf8');
  expect(typeScaleOk(html)).toBe(true);
  expect(readFileSync(join(import.meta.dir, '../src/custodian-page.ts'), 'utf8')).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write|localStorage/);
});
