import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { hexToBytes, toHex } from '@saakshi/core/bytes';
import { cellKey, devPseud, trustFromKeys, type KeysFile } from '@saakshi/core/dev';
import { leafHashHex, sthId, sthMessage } from '@saakshi/core/log';
import { rootOf } from '@saakshi/core/merkle';
import { newKeyPair, signer, verifier } from '@saakshi/core/node';
import type { ShiftExport, SthRecord } from '@saakshi/core/sheet';
import { headFrom, seal } from '../src/seal.ts';
import { cosigMessage, witnessStep, type WitnessState } from '../src/witness.ts';
import { SimSeat } from '../../../tools/sim-seat.ts';

const keys = JSON.parse(readFileSync(new URL('../../../fixtures/keys.json', import.meta.url), 'utf8')) as KeysFile;
const cell = cellKey(keys, 'cell-1');
const authority = { priv: hexToBytes(keys.authority.priv), pub: hexToBytes(keys.authority.pub) };
const o = { authority, trust: trustFromKeys(keys), pseud: devPseud, now: () => 1_790_000_000_000 };
const wkey = newKeyPair();
const w = { authorityPub: authority.pub, key: wkey, now: () => 1_790_000_001_000 };
const seat = (cand: string) => { const s = new SimSeat(keys, cand, cell.pub); s.add(3); s.submit(); return s; };
const exp = (...seats: SimSeat[]): ShiftExport => ({ cell: 'cell-1', exam: 'DEMO-2026', shift: 'S1', sheets: seats.map((s) => s.sheet()) });
const fresh: WitnessState = { alerts: [], cosigs: [] };

test('the witness cosigns the first head, then each head that is consistent with the last one it saw', () => {
  const a = seat('C0001'), b = seat('C0002'), c = seat('C0003');
  const r1 = seal(undefined, exp(a, b), o).rec;
  let s = witnessStep(fresh, headFrom(r1, 0)!, w);
  expect(s.alerts).toEqual([]);
  expect(s.last?.sth.size).toBe(2);
  const cs = s.cosigs.at(-1)!;
  expect(verifier(wkey.pub)(cosigMessage(cs.sthId, cs.ts), hexToBytes(cs.sig))).toBe(true);
  const r2 = seal(r1, exp(a, b, c), o).rec;
  s = witnessStep(s, headFrom(r2, 2)!, w);
  expect(s.alerts).toEqual([]);
  expect(s.cosigs.map((x) => x.size)).toEqual([2, 3]);
  expect(witnessStep(s, headFrom(r2, 3)!, w).cosigs.length).toBe(2);      // same head again: nothing new to cosign
});

test('a control that rewrites history is caught: the consistency proof cannot bridge the old root', () => {
  const a = seat('C0001'), b = seat('C0002'), c = seat('C0003');
  const r1 = seal(undefined, exp(a, b), o).rec;
  const s = witnessStep(fresh, headFrom(r1, 0)!, w);
  // An insider swaps leaf 0 for another candidate's chain and re-signs a bigger head with the authority key.
  const leaves = [{ ...r1.leaves[0], finalHash: 'f'.repeat(64) }, ...r1.leaves.slice(1), ...seal(undefined, exp(c), o).rec.leaves];
  const sth = { ...r1.sths[0].sth, size: 3, root: toHex(rootOf(leaves.map((l) => hexToBytes(leafHashHex(l))))), prevSTH: sthId(r1.sths[0].sth) };
  const forged: SthRecord = { ...r1, leaves, sths: [...r1.sths, { sth, sig: toHex(signer(authority)(sthMessage(sth))) }] };
  const out = witnessStep(s, headFrom(forged, 2)!, w);
  expect(out.alerts.map((x) => x.reason)).toEqual(['inconsistent']);
  expect(out.last?.sth.size).toBe(2);                                        // it keeps the last good head
  expect(out.cosigs.length).toBe(1);
});

test('equivocation (same size, other root), a shrinking log and a bad authority signature all alert', () => {
  const a = seat('C0001'), b = seat('C0002');
  const r1 = seal(undefined, exp(a, b), o).rec;
  const s = witnessStep(fresh, headFrom(r1, 0)!, w);
  const other = { ...r1.sths[0].sth, root: 'a'.repeat(64) };
  const eq = { sth: { sth: other, sig: toHex(signer(authority)(sthMessage(other))) }, consistency: [] };
  expect(witnessStep(s, eq, w).alerts.at(-1)?.reason).toBe('equivocation');
  const small = seal(undefined, exp(a), o).rec;
  expect(witnessStep(s, headFrom(small, 0)!, w).alerts.at(-1)?.reason).toBe('shrunk');
  const bad = { sth: { ...r1.sths[0], sig: '00'.repeat(64) }, consistency: [] };
  expect(witnessStep(fresh, bad, w).alerts.at(-1)?.reason).toBe('bad-signature');
});
