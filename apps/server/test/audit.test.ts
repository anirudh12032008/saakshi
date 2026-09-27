import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { hexToBytes } from '@saakshi/core/bytes';
import { cellKey, devPseud, trustFromKeys, type KeysFile } from '@saakshi/core/dev';
import { formsOf, type ShiftExport } from '@saakshi/core/sheet';
import type { HeadsRes } from '@saakshi/core/wire';
import { audit } from '../src/audit.ts';
import { seal } from '../src/seal.ts';
import { FORMS, SimSeat } from '../../../tools/sim-seat.ts';

const keys = JSON.parse(readFileSync(new URL('../../../fixtures/keys.json', import.meta.url), 'utf8')) as KeysFile;
const cell = cellKey(keys, 'cell-1');
const trust = trustFromKeys(keys), forms = formsOf(FORMS);
const authority = { priv: hexToBytes(keys.authority.priv), pub: hexToBytes(keys.authority.pub) };
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

/** C0001 answers all 20 items (I17 at seq 18 = 'C') and submits (seq 22); C0002 is still sitting (5 entries, no submit). */
function shift() {
  const a = new SimSeat(keys, 'C0001', cell.pub); a.add(21); a.submit();
  const b = new SimSeat(keys, 'C0002', cell.pub); b.add(5);
  const exp: ShiftExport = { cell: 'cell-1', exam: 'DEMO-2026', shift: 'S1', sheets: [a.sheet(), b.sheet()] };
  const relay: HeadsRes = { mode: 'relay', state: 'LIVE', streams: [a, b].map((s) => ({ ...s.ctx, head: s.head, cellHead: s.head, senderHead: s.head, seenAt: 1 })) };
  const { rec } = seal(undefined, exp, { authority, trust, pseud: devPseud });
  return { exp, relay, rec, archive: clone(exp) };
}
const run = (x: ReturnType<typeof shift>, cellExp: ShiftExport, o: { archive?: ShiftExport | null } = {}) =>
  audit({ cell: cellExp, relay: x.relay, archive: o.archive === null ? undefined : (o.archive ?? x.archive), rec: x.rec, trust, forms });
const kinds = (fs: { kind: string; seq: number }[]) => fs.map((f) => [f.kind, f.seq]);

test('an honest shift audits clean', () => {
  const x = shift();
  expect(run(x, x.exp)).toEqual([]);
});

test('an in-progress candidate is not called truncated or missing; a hello-only relay stream is ignored', () => {
  const x = shift();
  x.relay.streams.push({ exam: 'DEMO-2026', shift: 'S1', attempt: 1, cand: 'C0005', head: 0, cellHead: 0, senderHead: 0, seenAt: 1 });
  expect(run(x, x.exp)).toEqual([]);
});

test('an edited answer is located and recovered from the archive', () => {
  const x = shift(), cur = clone(x.exp);
  cur.sheets[0].entries[17].body = ['body', 'I17', 'A', 'B', [1000, []]];
  expect(run(x, cur)).toEqual([{ cand: 'C0001', seq: 18, kind: 'body', detail: 'Q17: record says B — the seat committed C', recovered: { from: 'archive', value: 'C' } }]);
});

test('without an archive an answer-only edit is recovered by option search; a meta edit is only located', () => {
  const x = shift(), cur = clone(x.exp);
  cur.sheets[0].entries[17].body = ['body', 'I17', 'A', 'B', [1000, []]];
  expect(run(x, cur, { archive: null })[0].recovered).toEqual({ from: 'option-search', value: 'C' });
  cur.sheets[0].entries[17].body = ['body', 'I17', 'A', 'B', [1, []]];
  const [f] = run(x, cur, { archive: null });
  expect([f.kind, f.seq, f.recovered]).toEqual(['body', 18, undefined]);
  expect(run(x, cur)[0].recovered).toEqual({ from: 'archive', value: 'C' });
});

test('an archive copy that fails its own commitment (edited before the seal) is never used for recovery', () => {
  const x = shift(), cur = clone(x.exp);
  cur.sheets[0].entries[17].body = ['body', 'I17', 'A', 'B', [1000, []]];
  expect(run(x, cur, { archive: clone(cur) })[0].recovered).toEqual({ from: 'option-search', value: 'C' });
});

test('a deleted row: counts disagree with relay and archive, and the gap is located and restored from the archive', () => {
  const x = shift(), cur = clone(x.exp);
  cur.sheets[0].entries.splice(4, 1);                                          // seq 5 gone
  const fs = run(x, cur);
  expect(kinds(fs)).toEqual([['count', 0], ['count', 0], ['chain', 5]]);
  expect(fs[0].detail).toBe('relay holds 22 entries, cell holds 21');
  expect(fs[2].recovered).toEqual({ from: 'archive', value: 'seq 5 restored from the sealed archive' });
  expect(run(x, cur, { archive: null }).at(-1)!.recovered?.from).toBe('next.prev');
});

test('a changed signature is located at its seq', () => {
  const x = shift(), cur = clone(x.exp);
  cur.sheets[0].entries[6].line = cur.sheets[0].entries[6].line.replace(/"([0-9a-f]{127})([0-9a-f])"\]$/, (_m, a, z) => `"${a}${z === '0' ? '1' : '0'}"]`);
  const fs = run(x, cur);
  expect(kinds(fs)).toEqual([['chain', 7]]);
  expect(fs[0].detail).toStartWith('entry 7: sig');
  expect(fs[0].recovered?.from).toBe('archive');
});

test('truncation: the register\'s leaf catches a chain cut before its submit, even with no relay or archive', () => {
  const x = shift(), cur = clone(x.exp);
  cur.sheets[0].entries.splice(19);                                            // keep seq 1–19
  const fs = audit({ cell: cur, relay: { mode: 'relay', state: 'LIVE', streams: [] }, rec: x.rec, trust, forms });
  expect(kinds(fs)).toEqual([['truncated', 19]]);
  expect(fs[0].detail).toBe('the chain ends at seq 19 without the submit the register (or receipt) commits to');
});

test('a candidate the cell has lost entirely is "missing", recovered from the archive', () => {
  const x = shift(), cur = clone(x.exp);
  cur.sheets.splice(0, 1);
  const fs = run(x, cur);
  expect(kinds(fs)).toEqual([['missing', 0]]);
  expect(fs[0].recovered).toEqual({ from: 'archive', value: '22 entries' });
});
