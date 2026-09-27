import { afterEach, beforeEach, expect, test } from 'bun:test';
import type { Database } from 'bun:sqlite';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hexToBytes, randomBytes, toHex } from '@saakshi/core/bytes';
import type { KeysFile } from '@saakshi/core/dev';
import { verifier } from '@saakshi/core/node';
import type { ReleaseMsg } from '@saakshi/core/paper';
import { ReleaseStore, type ReleaseStoreOpts } from '../src/release-store.ts';
import { openDb } from '../src/store.ts';
import { simCustody } from '../../../tools/sim-custody.ts';

const keys = JSON.parse(readFileSync(new URL('../../../fixtures/keys.json', import.meta.url), 'utf8')) as KeysFile;
const cust = simCustody(keys), A = verifier(hexToBytes(keys.authority.pub));
let dir: string;
const dbs: Database[] = [];
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'saakshi-rel-')); });
afterEach(() => { for (const d of dbs.splice(0)) d.close(); rmSync(dir, { recursive: true, force: true }); });
const open = (name: string, o: Partial<ReleaseStoreOpts> = {}) => {
  const { db } = openDb(join(dir, `${name}.db`));
  dbs.push(db);
  return new ReleaseStore(db, { exam: 'DEMO-2026', shift: 'S1', manifest: cust.manifest.manifest, authority: A, ...o });
};
const code = (f: 'F1' | 'F2'): ReleaseMsg => ({ ...cust.release(f), sig: '', via: 'code' });

test('keeps control\'s signed release; the same again is a no-op; a key off kc_f or a forged signature is refused', () => {
  const seen: ReleaseMsg[] = [];
  const s = open('r', { onNew: (r) => seen.push(r) });
  const r = cust.release('F1');
  expect(s.accept(r)).toBeUndefined();
  expect(s.accept(r)).toBeUndefined();
  expect(seen).toEqual([r]);
  expect(s.accept({ ...cust.release('F2'), key: toHex(randomBytes(32)) })).toMatch(/kc_f/);
  expect(s.accept({ ...cust.release('F2'), ts: 5 })).toMatch(/signature/);
  expect([s.list(), s.count()]).toEqual([[r], 1]);
});

test('a cell takes only control\'s signed release; a relay keeps the phoned-code release, and control\'s signed one replaces it', () => {
  expect(open('cell', { requireSig: true }).accept(code('F1'))).toMatch(/signed by control/);
  const seen: string[] = [];
  const relay = open('relay', { onNew: (r) => seen.push(r.via) });
  expect(relay.accept(code('F1'))).toBeUndefined();
  expect(relay.count()).toBe(0);                                                   // `have` counts signed releases only
  expect(relay.accept(cust.release('F1'))).toBeUndefined();
  expect(relay.accept(code('F1'))).toBeUndefined();                               // the signed one stays
  expect([seen, relay.count(), relay.list()[0].via]).toEqual([['code', 'push'], 1, 'push']);
});

test('releases survive a restart', () => {
  const r2 = cust.release('F2');                                                  // signatures are random: keep the one we stored
  open('r').accept(r2);
  expect(open('r').list()).toEqual([r2]);
});
