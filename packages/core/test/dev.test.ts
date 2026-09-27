import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { toHex } from '../src/bytes.ts';
import { cellKey, devForm, devSeat, devSeatKey, type KeysFile } from '../src/dev.ts';

const keys = JSON.parse(readFileSync(new URL('../../../fixtures/keys.json', import.meta.url), 'utf8')) as KeysFile;

test('DEV roster: C000n signs with seats[n-1] at keyEpoch 1 only', () => {
  const s = devSeat(keys, 'C0001')!;
  assert.equal(s.seatId, 'CEN042-S01');
  assert.equal(toHex(s.pub), keys.seats[0].pub);
  assert.equal(toHex(devSeatKey(keys)('C0008', 1)!), keys.seats[7].pub);
  for (const [cand, ep] of [['C0001', 2], ['C0009', 1], ['C0000', 1], ['X0001', 1], ['C01', 1]] as const)
    assert.equal(devSeatKey(keys)(cand, ep), undefined, `${cand}/${ep}`);
});

test('cell keys come from the keys file; forms alternate', () => {
  assert.equal(toHex(cellKey(keys, 'cell-1').pub), keys.cells[0].pub);
  assert.throws(() => cellKey(keys, 'cell-9'), /cell-9/);
  assert.deepEqual(['C0001', 'C0002', 'C0003'].map(devForm), ['F1', 'F2', 'F1']);
});
