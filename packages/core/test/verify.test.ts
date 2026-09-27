import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { hexToBytes, toHex } from '../src/bytes.ts';
import { cellKey, trustFromKeys, type KeysFile } from '../src/dev.ts';
import { leafHashHex, sthMessage, NO_PREV_STH, type Sth } from '../src/log.ts';
import { inclusionProof, rootOf } from '../src/merkle.ts';
import { signer } from '../src/node.ts';
import { formsOf, type Proof, type ResponseSheet } from '../src/sheet.ts';
import { mismatchText, parseProof, verifyProof, verifySheet } from '../src/verify.ts';
import { SimSeat } from '../../../tools/sim-seat.ts';

const root = new URL('../../../', import.meta.url);
const read = (p: string) => JSON.parse(readFileSync(new URL(p, root), 'utf8'));
const keys = read('fixtures/keys.json') as KeysFile;
const forms = formsOf(read('fixtures/paper/forms.json'));
const trust = trustFromKeys(keys);
const cell = cellKey(keys, 'cell-1');
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

/** C0001 (form F1): unlock, visit Q17, answer Q17 = B, answer Q1 = D, submit. */
function honest(): ResponseSheet {
  const s = new SimSeat(keys, 'C0001', cell.pub);
  s.add(1);
  s.append('clear', { item: 'I17', state: 'NA', answer: '', meta: [0, []] });
  s.append('answer', { item: 'I17', state: 'A', answer: 'B', meta: [4000, []] });
  s.append('answer', { item: 'I01', state: 'A', answer: 'D', meta: [2000, []] });
  s.submit();
  return s.sheet();
}

/** A proof for `sheet`: its leaf at index 1 of 3, under an STH signed by the authority. */
function proofOf(sheet: ResponseSheet, signKey = keys.authority): Proof {
  const r = verifySheet(sheet, forms, trust);
  const leaves = [leafHashHex({ ...r.leaf!, pseud: 'a'.repeat(64) }), leafHashHex(r.leaf!), leafHashHex({ ...r.leaf!, pseud: 'b'.repeat(64) })].map(hexToBytes);
  const sth: Sth = { exam: 'DEMO-2026', shift: 'S1', size: 3, root: toHex(rootOf(leaves)), prevSTH: NO_PREV_STH, ts: 1 };
  const sig = toHex(signer({ priv: hexToBytes(signKey.priv), pub: hexToBytes(signKey.pub) })(sthMessage(sth)));
  return { v: 1, sheet, sth: { sth, sig }, index: 1, inclusion: inclusionProof(leaves, 1).map(toHex) };
}
const failed = (r: { checks: { name: string; ok: boolean }[] }) => r.checks.filter((c) => !c.ok).map((c) => c.name);

test('an honest sheet verifies: keys, chain, bodies, finalHash and receipt', () => {
  const r = verifySheet(honest(), forms, trust);
  assert.deepEqual(failed(r), []);
  assert.equal(r.ok, true);
  assert.deepEqual(r.mismatches, []);
  assert.equal(r.submit?.seq, 5);
  assert.match(r.receipt!.code, /^[0-9A-Z*~$=]{17}$/);
  assert.deepEqual([r.receipt!.attempted, r.receipt!.answered, r.receipt!.marked], [2, 2, 0]);
});

test('an edited answer: "Q17: record says C — the seat committed B"; finalHash and receipt still verify from the committed bodies', () => {
  const sheet = honest();
  sheet.entries[2].body = ['body', 'I17', 'A', 'C', [4000, []]];
  const r = verifySheet(sheet, forms, trust);
  assert.equal(r.ok, false);
  assert.deepEqual(failed(r), ['bodies']);
  assert.equal(r.mismatches.length, 1);
  assert.equal(mismatchText(r.mismatches[0]), 'Q17: record says C — the seat committed B');
});

test('an edit that also changes meta cannot be recovered by option search, and finalHash cannot be replayed', () => {
  const sheet = honest();
  sheet.entries[2].body = ['body', 'I17', 'A', 'C', [1, []]];
  const r = verifySheet(sheet, forms, trust);
  assert.equal(r.mismatches[0].committed, null);
  assert.equal(mismatchText(r.mismatches[0]), 'Q17: record says C — what the seat committed cannot be recovered');
  assert.deepEqual(failed(r), ['bodies', 'finalHash', 'receipt']);
});

test('a deleted row, a truncated chain and a changed signature are each located', () => {
  const del = honest(); del.entries.splice(2, 1);
  assert.deepEqual(verifySheet(del, forms, trust).fault, { seq: 3, fault: 'seq', detail: 'expected seq 3, found 4' });

  const cut = honest(); cut.entries.pop();
  const rc = verifySheet(cut, forms, trust);
  assert.deepEqual(failed(rc), ['finalHash', 'receipt']);
  assert.match(rc.checks.find((c) => c.name === 'finalHash')!.detail, /does not end in a submit/);

  const sig = honest();
  sig.entries[3].line = sig.entries[3].line.replace(/"([0-9a-f]{127})([0-9a-f])"\]$/, (_m, a, z) => `"${a}${z === '0' ? '1' : '0'}"]`);
  const rs = verifySheet(sig, forms, trust);
  assert.equal(rs.fault?.seq, 4);
  assert.equal(rs.fault?.fault, 'sig');
});

test('a key that is not the pinned key for (cand, keyEpoch) fails keys and chain', () => {
  const sheet = honest();
  sheet.keys = [{ keyEpoch: 1, pub: keys.seats[5].pub }];
  assert.deepEqual(failed(verifySheet(sheet, forms, trust)).slice(0, 2), ['keys', 'chain']);
});

test('verifyProof: STH signature and inclusion verify; a wrong signer or index fails', () => {
  const p = proofOf(honest());
  assert.deepEqual(failed(verifyProof(p, forms, trust)), []);
  assert.deepEqual(failed(verifyProof(proofOf(honest(), keys.cells[0]), forms, trust)), ['sth']);
  assert.deepEqual(failed(verifyProof({ ...p, index: 0 }, forms, trust)), ['inclusion']);
});

test('slip: lowercase, dashes and O-for-0 still match; a one-symbol typo asks to re-type', () => {
  const p = proofOf(honest());
  const code = verifySheet(p.sheet, forms, trust).receipt!.code;
  const typed = code.toLowerCase().replace(/(.{4})/g, '$1-').replace(/0/g, 'o');
  assert.equal(verifyProof(p, forms, trust, typed).ok, true);
  const other = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'.split('').find((c) => c !== code[0])!;
  const r = verifyProof(p, forms, trust, other + code.slice(1));
  const slip = r.checks.find((c) => c.name === 'slip')!;
  assert.equal(slip.ok, false);
  assert.match(slip.detail, /re-type/);
});

test('parseProof rejects malformed proofs and accepts a JSON round trip of a good one', () => {
  const good = proofOf(honest());
  assert.deepEqual(parseProof(JSON.parse(JSON.stringify(good))), good);
  const bad: unknown[] = [null, {}, { ...good, v: 2 }];
  const b1 = clone(good); b1.sheet.entries[0].salt = 'xyz'; bad.push(b1);
  const b2 = clone(good); b2.sth.sig = 'ab'; bad.push(b2);
  const b3 = clone(good); (b3.sheet.entries[0] as { body: unknown }).body = { a: 1 }; bad.push(b3);
  const b4 = clone(good); b4.inclusion = ['<script>']; bad.push(b4);
  for (const x of bad) assert.throws(() => parseProof(x), /^Error: proof: /);
});
