import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { hexToBytes } from '../src/bytes.ts';
import { DEV_PSEUD_KEY, devPseud, devRoster, trustFromKeys, type KeysFile } from '../src/dev.ts';
import { verifyChain, verifyChainKeyed } from '../src/journal.ts';
import { NO_PREV_STH, pseudOf, responsesOf, sthId, type Sth } from '../src/log.ts';
import { verifier } from '../src/node.ts';
import type { Body } from '../src/protocol.ts';
import { formsOf } from '../src/sheet.ts';

const root = new URL('../../../', import.meta.url);
const read = (p: string) => JSON.parse(readFileSync(new URL(p, root), 'utf8'));
const V = read('fixtures/vectors/protocol-v1.json');
const keys = read('fixtures/keys.json') as KeysFile;
const b = (item: string, state: Body['state'], answer = ''): Body => ({ item, state, answer, meta: [] });

test('responsesOf: last entry per item wins, untouched form items are NV, form order is kept', () => {
  const r = responsesOf(['I03', 'I01', 'I02', 'I04'], [b('', ''), b('I01', 'NA'), b('I01', 'A', 'C'), b('I03', 'AMR', 'B'), b('I01', 'A', 'D'), b('', '')]);
  assert.deepEqual(r, [['I03', 'AMR', 'B'], ['I01', 'A', 'D'], ['I02', 'NV', ''], ['I04', 'NV', '']]);
});

test('responsesOf rejects an item outside the form and an item entry with no state', () => {
  assert.throws(() => responsesOf(['I01'], [b('I99', 'A', 'B')]), /not in the form/);
  assert.throws(() => responsesOf(['I01'], [b('I01', '')]), /no state/);
});

test('pseudonyms are 64 hex, stable for a roll, and differ between rolls', () => {
  assert.match(devPseud('C0001'), /^[0-9a-f]{64}$/);
  assert.equal(devPseud('C0001'), pseudOf(DEV_PSEUD_KEY, 'C0001'));
  assert.notEqual(devPseud('C0001'), devPseud('C0002'));
});

test('sthId changes when any STH field changes', () => {
  const s: Sth = { exam: 'E', shift: 'S', size: 1, root: 'a'.repeat(64), prevSTH: NO_PREV_STH, ts: 1 };
  const base = sthId(s);
  for (const t of [{ exam: 'X' }, { shift: 'X' }, { size: 2 }, { root: 'b'.repeat(64) }, { prevSTH: 'c'.repeat(64) }, { ts: 2 }]) assert.notEqual(sthId({ ...s, ...t }), base);
});

test('verifyChainKeyed: same result as verifyChain with one key; a missing epoch key is a sig fault at the first line', () => {
  const v = verifier(hexToBytes(keys.seats[0].pub));
  assert.deepEqual(verifyChainKeyed(V.ctx, V.chain.lines, () => v), verifyChain(V.ctx, V.chain.lines, v));
  const r = verifyChainKeyed(V.ctx, V.chain.lines, () => undefined);
  assert.deepEqual(r.ok ? null : [r.index, r.fault], [0, 'sig']);
});

test('fixtures/trust-dev.json is exactly the public half of keys.json', () => {
  const t = read('fixtures/trust-dev.json');
  assert.deepEqual(t, trustFromKeys(keys));
  const text = JSON.stringify(t);
  for (const k of [keys.authority, ...keys.cells, ...keys.seats]) assert.ok(!text.includes(k.priv));
  assert.deepEqual(devRoster(keys), ['C0001', 'C0002', 'C0003', 'C0004', 'C0005', 'C0006', 'C0007', 'C0008']);
});

test('formsOf keeps the item lists and drops durationMin', () => {
  const f = formsOf(read('fixtures/paper/forms.json'));
  assert.deepEqual(Object.keys(f).sort(), ['F1', 'F2']);
  assert.equal(f.F1.length, 20);
});
