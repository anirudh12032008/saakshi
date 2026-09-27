import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { hexToBytes } from '@saakshi/core/bytes';
import { cellKey, devPseud, trustFromKeys, type KeysFile } from '@saakshi/core/dev';
import { leafHashHex, NO_PREV_STH, sthId, sthMessage } from '@saakshi/core/log';
import { consistencyProof, rootOf, verifyConsistency, verifyInclusion } from '@saakshi/core/merkle';
import { verifier } from '@saakshi/core/node';
import type { ShiftExport } from '@saakshi/core/sheet';
import { leafOf, proofFor, seal } from '../src/seal.ts';
import { SimSeat } from '../../../tools/sim-seat.ts';

const keys = JSON.parse(readFileSync(new URL('../../../fixtures/keys.json', import.meta.url), 'utf8')) as KeysFile;
const cell = cellKey(keys, 'cell-1');
const authority = { priv: hexToBytes(keys.authority.priv), pub: hexToBytes(keys.authority.pub) };
const o = { authority, trust: trustFromKeys(keys), pseud: devPseud, now: () => 1_790_000_000_000 };
const seat = (cand: string, submit = true) => { const s = new SimSeat(keys, cand, cell.pub); s.add(5); if (submit) s.submit(); return s; };
const exp = (...seats: SimSeat[]): ShiftExport => ({ cell: 'cell-1', exam: 'DEMO-2026', shift: 'S1', sheets: seats.map((s) => s.sheet()) });
const hashes = (rec: { leaves: Parameters<typeof leafHashHex>[0][] }) => rec.leaves.map((l) => hexToBytes(leafHashHex(l)));

test('the first seal logs every submitted chain, skips the rest, and signs an STH with prevSTH = zeros', () => {
  const a = seat('C0002'), b = seat('C0001'), c = seat('C0003', false);
  const r = seal(undefined, exp(a, b, c), o);
  expect(r.added).toEqual(['C0001', 'C0002']);                                   // sorted by candidate
  expect(r.skipped).toEqual([{ cand: 'C0003', reason: 'not submitted' }]);
  expect(r.rec.leaves.map((l) => [l.cand, l.h, l.pseud])).toEqual([['C0001', b.hs[5], devPseud('C0001')], ['C0002', a.hs[5], devPseud('C0002')]]);   // seq 6 = the submit
  const { sth, sig } = r.rec.sths[0];
  expect(sth).toMatchObject({ exam: 'DEMO-2026', shift: 'S1', size: 2, prevSTH: NO_PREV_STH, ts: 1_790_000_000_000 });
  expect(sth.root).toBe(Buffer.from(rootOf(hashes(r.rec))).toString('hex'));
  expect(verifier(authority.pub)(sthMessage(sth), hexToBytes(sig))).toBe(true);
});

test('re-sealing with nothing new returns the same record; a late submit appends, chains prevSTH and stays consistent', () => {
  const a = seat('C0001'), c = seat('C0003', false);
  const first = seal(undefined, exp(a, c), o).rec;
  expect(seal(first, exp(a, c), o).rec).toBe(first);
  c.submit();
  const second = seal(first, exp(a, c), o);
  expect(second.added).toEqual(['C0003']);
  expect(second.rec.leaves.map((l) => l.cand)).toEqual(['C0001', 'C0003']);    // append-only: never reordered
  const [s1, s2] = second.rec.sths.map((x) => x.sth);
  expect(s2.prevSTH).toBe(sthId(s1));
  const hs = hashes(second.rec);
  expect(verifyConsistency(1, 2, consistencyProof(hs, 1), hexToBytes(s1.root), hexToBytes(s2.root))).toBe(true);
});

test('proofFor gives an inclusion proof under the latest STH, and nothing for a candidate not in the log', () => {
  const a = seat('C0001'), b = seat('C0002'), c = seat('C0003', false);
  const { rec } = seal(undefined, exp(a, b, c), o);
  const p = proofFor(rec, b.sheet())!;
  expect(p.index).toBe(1);
  expect(verifyInclusion(p.index, p.sth.sth.size, hexToBytes(leafHashHex(rec.leaves[1])), p.inclusion.map(hexToBytes), hexToBytes(p.sth.sth.root))).toBe(true);
  expect(proofFor(rec, c.sheet())).toBeUndefined();
});

test('a sheet whose submit body was altered, or whose chain is broken, is not logged', () => {
  const a = seat('C0001');
  const sh = a.sheet();
  sh.entries[5].body = ['body', '', '', '', ['F1', '0'.repeat(64)]];
  expect(leafOf(sh, o)).toBe('submit body does not match its commitment');
  const cut = a.sheet();
  cut.entries.splice(2, 1);
  expect(leafOf(cut, o)).toBe('chain fails at seq 3 (seq)');
});
