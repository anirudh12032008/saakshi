import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, copyFileSync, mkdtempSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from '@saakshi/core/bytes';
import { buildChain, demoEntries } from '@saakshi/core/journal';
import { newKeyPair, signer, verifier } from '@saakshi/core/node';
import { SeatJournal, type Rec, type Wrapper } from '../src/main/journal-store.ts';

const ctx = { exam: 'DEMO-2026', shift: 'S1', attempt: 1, cand: 'C0001' };
const key = newKeyPair();
const wrap: Wrapper = { encryptString: (s) => Buffer.from('W' + s), decryptString: (b) => b.toString().slice(1) };
const entries = demoEntries(6);
const { lines } = buildChain(ctx, 1, entries, signer(key));
const recs: Rec[] = lines.map((line, i) => ({ line, env: randomBytes(150), salt: entries[i].salt, body: entries[i].body }));
const base = (dir: string, cand = 'C0001') => join(dir, `DEMO-2026_S1_1_${cand}`);

function fresh(n: number): { dir: string; path: string } {
  const dir = mkdtempSync(join(tmpdir(), 'saakshi-journal-'));
  const j = SeatJournal.open(dir, ctx, wrap, verifier(key.pub));
  for (const r of recs.slice(0, n)) j.append(r);
  j.close();
  return { dir, path: `${base(dir)}.journal` };
}
const reopen = (dir: string, c = ctx) => SeatJournal.open(dir, c, wrap, verifier(key.pub));

test('appends survive a reopen byte-for-byte; hashAt follows the chain', () => {
  const { dir } = fresh(5);
  const j = reopen(dir);
  assert.equal(j.head, 5);
  assert.deepEqual(j.recs, recs.slice(0, 5));
  assert.equal(j.headers[4].seq, 5);
  assert.equal(j.hashAt(2), j.headers[2].prev);
  j.close();
  rmSync(dir, { recursive: true });
});

test('encrypted at rest: no header, context or answer text on disk; the session key is stored wrapped', () => {
  const { dir, path } = fresh(5);
  const text = readFileSync(path, 'latin1');
  // Lines are base64(ciphertext): a short string like I01 can occur there by chance, so check the decoded bytes too.
  const raw = text.split('\n').map((l) => Buffer.from(l, 'base64').toString('latin1')).join('');
  for (const s of ['DEMO-2026', '"answer"', 'signed']) assert.equal(text.includes(s), false, s);
  for (const s of ['DEMO-2026', '"answer"', 'signed', '"I01"']) assert.equal(raw.includes(s), false, s);
  const k = readFileSync(`${base(dir)}.key`, 'utf8');
  assert.equal(k[0], 'W');
  assert.equal(k.length, 65);
  rmSync(dir, { recursive: true });
});

test('a torn tail is cut back to the last whole line, and appending continues', () => {
  for (const tail of [Buffer.from(readFileSync(fresh(1).path, 'latin1').slice(0, 40)), Buffer.alloc(300)]) {
    const { dir, path } = fresh(4);
    const clean = statSync(path).size;
    appendFileSync(path, tail);                      // power cut mid-write: partial line or zero-filled blocks
    const j = reopen(dir);
    assert.equal(j.head, 4);
    assert.equal(statSync(path).size, clean);
    j.append(recs[4]);
    j.close();
    assert.equal(reopen(dir).head, 5);
    rmSync(dir, { recursive: true });
  }
});

test('damage before the tail refuses to open (corrupt line, reordered lines, another candidate)', () => {
  const { dir, path } = fresh(4);
  const good = readFileSync(path, 'latin1').split('\n');
  const flipped = [...good];
  flipped[1] = flipped[1].slice(0, 5) + (flipped[1][5] === 'A' ? 'B' : 'A') + flipped[1].slice(6);
  writeFileSync(path, flipped.join('\n'), 'latin1');
  assert.throws(() => reopen(dir), /line 2/);
  writeFileSync(path, [good[1], good[0], ...good.slice(2)].join('\n'), 'latin1');
  assert.throws(() => reopen(dir), /line 1/);
  writeFileSync(path, good.join('\n'), 'latin1');
  copyFileSync(path, `${base(dir, 'C0002')}.journal`);
  copyFileSync(`${base(dir)}.key`, `${base(dir, 'C0002')}.key`);
  assert.throws(() => reopen(dir, { ...ctx, cand: 'C0002' }), /line 1/);
  rmSync(dir, { recursive: true });
});

test('a journal whose session key is gone refuses to start a second journal', () => {
  const { dir } = fresh(2);
  unlinkSync(`${base(dir)}.key`);
  assert.throws(() => reopen(dir), /session key/);
  rmSync(dir, { recursive: true });
});

test('append refuses anything that does not extend the chain', () => {
  const { dir } = fresh(2);
  const j = reopen(dir);
  assert.throws(() => j.append(recs[3]), /seq 3/);
  assert.throws(() => j.append(recs[1]), /seq 3/);
  j.close();
  rmSync(dir, { recursive: true });
});
