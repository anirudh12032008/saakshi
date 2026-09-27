import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateRow, type FieldSpec } from '../src/schema.ts';

const root = new URL('../../../', import.meta.url);
const spec = JSON.parse(readFileSync(new URL('fixtures/schemas/v1.json', root), 'utf8')) as { cohort: Record<string, FieldSpec>; export: Record<string, FieldSpec> };

test('every stub cohort row matches the frozen v1 schema', () => {
  const rows = readFileSync(new URL('fixtures/cohort-stub.jsonl', root), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(rows.length, 60);
  for (const r of rows) assert.deepEqual(validateRow(r, spec.cohort), [], JSON.stringify(r));
});

test('validateRow reports unexpected, mistyped and missing fields', () => {
  const s: Record<string, FieldSpec> = { a: 'string', n: 'int', e: ['x', 'y'], h: 'hex64' };
  assert.deepEqual(validateRow({ a: 'q', n: 1, e: 'x', h: 'f'.repeat(64) }, s), []);
  assert.deepEqual(validateRow({ a: 1, n: 1.5, e: 'z', extra: 0 }, s), ['unexpected field extra', 'bad a: 1', 'bad n: 1.5', 'bad e: "z"', 'missing h']);
});

test('an export row is the cohort fields plus the export fields', () => {
  const row = { cand: 'C0001', centre: 'CEN042', shift: 'S1', form: 'F1', lang: 'hi', pwd: 0, item: 'I17', state: 'A', answer: 'B', dwellMs: 1, visits: 1, changes: 0, tFirstMs: 5, seq: 9, rxWall: 1790000000000, h: 'a'.repeat(64) };
  assert.deepEqual(validateRow(row, { ...spec.cohort, ...spec.export }), []);
});
