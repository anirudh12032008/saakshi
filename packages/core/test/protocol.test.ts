import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crockford80, decodeCrockford80, hexToBytes, toHex } from '../src/bytes.ts';
import { bodyCommit, counts, entryHash, finalHash, genesisPrev, headerArray, headerFromArray, kcf, receiptCode, type Header, type Response } from '../src/protocol.ts';

const ctx = { exam: 'DEMO-2026', shift: 'S1', attempt: 1, cand: 'C0001' };
const salt = Uint8Array.from({ length: 16 }, (_, i) => i);

test('known-answer hashes match the Python reference', () => {
  const gen = genesisPrev(ctx);
  assert.equal(gen, '5d69bc2c61786a76aca971f7b9dce3b2d12f9e592b92cc102720078d6564fd8a');
  const bc = bodyCommit(salt, { item: 'I17', state: 'A', answer: 'B', meta: [4200, []] });
  assert.equal(bc, 'b4997b8f90d9bd710864ddc02d92c38dda34fa89f51f5cc98bfeb61174539751');
  assert.equal(bodyCommit(salt, { item: 'I17', state: 'A', answer: 'B', meta: [4200, ['हिन्दी']] }),
    '569ca0a8b89f49a2bb9114f5a1b01af2ce890d59cc7677990b83ea7f7d0315d4');
  const h: Header = { ...ctx, keyEpoch: 1, seq: 1, prev: gen, kind: 'answer', tMonoMs: 61000, activeMs: 60500, bodyCommit: bc };
  const eh = toHex(entryHash(h));
  assert.equal(eh, 'f5f6406a4576292cf2ece742bb5898f0de9ff0b9279c660e2de3a558e9683afa');
  const resp: Response[] = [['I17', 'AMR', 'B'], ['I03', 'A', 'C'], ['I05', 'MR', '']];
  const fh = finalHash(ctx, 'F1', resp);
  assert.equal(fh, '57c9e6df0d30bdcdef888cd1ae4e0212692ca58d6d7000bfd9eba519af561752');
  assert.deepEqual(counts(resp), { attempted: 3, answered: 2, marked: 2 });
  const code = receiptCode({ exam: 'DEMO-2026', shift: 'S1', attempt: 1, pseud: '7'.repeat(64), seq: 1, h: eh, finalHash: fh, attempted: 3, answered: 2, marked: 2 });
  assert.equal(code, '8Q6GQ5AZGKYFPVZKR');
  assert.equal(kcf(new Uint8Array(32).fill(0x11)), '6065a397d8b6299bbacba68453af1f9920929f4f02b067fd04f86d7ad43f0ba5');
});

test('crockford80 encodes 80 bits plus a mod-37 check symbol', () => {
  const b = Uint8Array.from({ length: 10 }, (_, i) => i);
  assert.equal(crockford80(b), '000G40R40M30E209Y');
  assert.deepEqual(decodeCrockford80('000g-40r4-0m30-e209-y'), b);
  assert.deepEqual(decodeCrockford80('OOOG40R4OM3OE2O9Y'), b);
  assert.throws(() => decodeCrockford80('000G40R40M30E209Z'), /check/);
  assert.throws(() => decodeCrockford80('000G40R40M30E209'), /17/);
});

test('headerFromArray round-trips and rejects malformed headers', () => {
  const h: Header = { ...ctx, keyEpoch: 1, seq: 3, prev: 'a'.repeat(64), kind: 'mark', tMonoMs: 5, activeMs: 4, bodyCommit: 'b'.repeat(64) };
  assert.deepEqual(headerFromArray(headerArray(h)), h);
  const a = headerArray(h);
  assert.throws(() => headerFromArray([...a.slice(0, 9), 'teleport', ...a.slice(10)]), /kind/);
  assert.throws(() => headerFromArray([...a.slice(0, 8), 'A'.repeat(64), ...a.slice(9)]), /hash/);
  assert.throws(() => headerFromArray(a.slice(0, 12)), /length/);
});

test('finalHash rejects duplicate items; bodyCommit rejects short salts', () => {
  assert.throws(() => finalHash(ctx, 'F1', [['I01', 'A', 'B'], ['I01', 'A', 'C']]), /duplicate/);
  assert.throws(() => bodyCommit(new Uint8Array(8), { item: '', state: '', answer: '', meta: [] }), /16/);
  assert.equal(toHex(hexToBytes('00ff')), '00ff');
});
