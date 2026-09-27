import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canon, parseCanon, type Canon } from '../src/canon.ts';

test('canon emits compact JSON for tagged arrays', () => {
  assert.equal(canon(['x', 1, 'a', [2, ['b']]]), '["x",1,"a",[2,["b"]]]');
  assert.equal(canon(['x', 'हिन्दी']), '["x","हिन्दी"]');
});

test('canon rejects everything outside the allowed value set', () => {
  const bad: unknown[] = [['x', 1.5], ['x', -0], ['x', 2 ** 53], ['x', null], ['x', true], ['x', {}], [1, 'x'], [], 'x'];
  for (const v of bad) assert.throws(() => canon(v as Canon[]), /canon/, JSON.stringify(v));
  // eslint-disable-next-line no-sparse-arrays
  assert.throws(() => canon(['x', , 1] as Canon[]), /sparse/);
});

test('parseCanon accepts only the exact canonical text', () => {
  assert.deepEqual(parseCanon('["x",1,["y"]]'), ['x', 1, ['y']]);
  for (const t of ['["x", 1]', '["x",1.0]', '["x",-0]', '["x",1e2]', '{"a":1}', '["x",null]'])
    assert.throws(() => parseCanon(t), t);
});
