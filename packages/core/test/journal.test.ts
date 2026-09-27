import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toHex, utf8 } from '../src/bytes.ts';
import { entryHash } from '../src/protocol.ts';
import { nobleVerifier } from '../src/sig.ts';
import { newKeyPair, signer, verifier } from '../src/node.ts';
import { buildChain, demoEntries, verifyChain } from '../src/journal.ts';

const ctx = { exam: 'DEMO-2026', shift: 'S1', attempt: 1, cand: 'C0001' };
const key = newKeyPair();
const { headers, lines } = buildChain(ctx, 1, demoEntries(50), signer(key));
const verify = verifier(key.pub);
const rng = (seed: number) => () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = (r: ReturnType<typeof verifyChain>) => (r.ok ? ['ok'] : [r.index, r.fault]);

test('an honest chain verifies under native and noble; head = last entry hash', () => {
  for (const v of [verify, nobleVerifier(key.pub)])
    assert.deepEqual(verifyChain(ctx, lines, v), { ok: true, head: toHex(entryHash(headers[49])), count: 50 });
});

test('1,000 random byte flips are all detected at the exact entry', () => {
  const text = lines.join('\n') + '\n';
  const rand = rng(20260927);
  for (let i = 0; i < 1000; i++) {
    const bytes = utf8(text);
    const p = Math.floor(rand() * bytes.length);
    let expected = 0;
    for (let j = 0; j < p; j++) if (bytes[j] === 10) expected++; // a newline belongs to its own line
    bytes[p] ^= 1 + Math.floor(rand() * 255);
    const got = new TextDecoder().decode(bytes).split('\n');
    if (got.at(-1) === '') got.pop();
    const r = verifyChain(ctx, got, verify);
    assert.equal(r.ok, false, `flip ${i} at byte ${p} went undetected`);
    assert.equal(!r.ok && r.index, expected, `flip ${i} at byte ${p}: located ${!r.ok && r.index}, expected ${expected}`);
  }
});

test('deleted, swapped, foreign-signed and out-of-context entries are located', () => {
  const del = [...lines]; del.splice(10, 1);
  assert.deepEqual(pick(verifyChain(ctx, del, verify)), [10, 'seq']);
  const swp = [...lines]; [swp[20], swp[21]] = [swp[21], swp[20]];
  assert.deepEqual(pick(verifyChain(ctx, swp, verify)), [20, 'seq']);
  const mix = [...lines]; mix[30] = buildChain(ctx, 1, demoEntries(50), signer(newKeyPair())).lines[30];
  assert.deepEqual(pick(verifyChain(ctx, mix, verify)), [30, 'sig']);
  assert.deepEqual(pick(verifyChain({ ...ctx, cand: 'C0002' }, lines, verify)), [0, 'context']);
});

test('truncation verifies as a shorter chain, but its head no longer matches', () => {
  const full = verifyChain(ctx, lines, verify), cut = verifyChain(ctx, lines.slice(0, 40), verify);
  assert.ok(full.ok && cut.ok && cut.head !== full.head, 'Stage 2 catches truncation by comparing heads with the receipt and the leaf');
});
