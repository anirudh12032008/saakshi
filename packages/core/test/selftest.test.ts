import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { goldenSelfTest } from '../src/selftest.ts';

const read = (p: string) => JSON.parse(readFileSync(new URL(`../../../${p}`, import.meta.url), 'utf8'));

test('the golden self-test /verify runs in the browser passes on the frozen vectors', () => {
  const r = goldenSelfTest(read('fixtures/vectors/protocol-v1.json'), read('fixtures/vectors/protocol-v1-addendum-a.json'));
  assert.deepEqual(r.fail, []);
  assert.ok(r.pass >= 30, `only ${r.pass} checks ran`);
});

test('the self-test notices a corrupted vector', () => {
  const V = read('fixtures/vectors/protocol-v1.json');
  V.genesisPrev = V.genesisPrev.replace(/^./, (c: string) => (c === '0' ? '1' : '0'));
  const r = goldenSelfTest(V, read('fixtures/vectors/protocol-v1-addendum-a.json'));
  assert.deepEqual(r.fail, ['genesis prev']);
});
