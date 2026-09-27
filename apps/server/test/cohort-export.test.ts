import { readFileSync } from 'node:fs';
import { expect, test } from 'bun:test';
import { randomBytes, toHex } from '@saakshi/core/bytes';
import type { Directory } from '@saakshi/core/directory';
import { signedLine } from '@saakshi/core/journal';
import { newKeyPair, signer } from '@saakshi/core/node';
import { bodyArray, bodyCommit, entryHash, genesisPrev, type Body, type Header, type Kind } from '@saakshi/core/protocol';
import type { Forms, ResponseSheet, ShiftExport } from '@saakshi/core/sheet';
import { cohortRows, deviceEvidence, toJsonl } from '../src/cohort-export.ts';

const E: Body = { item: '', state: '', answer: '', meta: [] };
const ans = (item: string, answer: string, dwell = 1000): Body => ({ item, state: 'A', answer, meta: [dwell, []] });
type Step = { kind: Kind; active: number; rx: number; body?: Body };

/** A chain with chosen activeMs and relay rxWall per entry (copied from time-audit.test.ts's `sheet` helper, plus `cand`). */
function sheet(cand: string, steps: Step[]): ResponseSheet {
  const ctx = { exam: 'DEMO-2026', shift: 'S1', attempt: 1, cand };
  const sign = signer(newKeyPair());
  let prev = genesisPrev(ctx);
  const entries = steps.map((s, i) => {
    const salt = randomBytes(16), body = s.body ?? E;
    const h: Header = { ...ctx, keyEpoch: 1, seq: i + 1, prev, kind: s.kind, tMonoMs: s.active, activeMs: s.active, bodyCommit: bodyCommit(salt, body) };
    prev = toHex(entryHash(h));
    return { line: signedLine(h, sign), salt: toHex(salt), body: bodyArray(body), rx: [s.rx, s.rx + 5] as [number, number] };
  });
  return { ctx, form: 'F1', pseud: '7'.repeat(64), keys: [], entries };
}

const form: Forms = { F1: ['I01', 'I02', 'I03', 'I04'] };
const dirFor = (cands: Record<string, { centre: string; form: 'F1' | 'F2'; lang?: string; pwd?: 0 | 1 }>): Directory =>
  ({ cands: Object.fromEntries(Object.entries(cands).map(([c, d]) => [c, { ...d, extraMs: 0, pseud: '' }])) } as unknown as Directory);

test('E.1 vector: the reference sheet derives exactly the reference rows', () => {
  const V = JSON.parse(readFileSync(new URL('../../../fixtures/vectors/protocol-v1-addendum-e.json', import.meta.url), 'utf8')).export;
  const dir = dirFor({ [V.sheet.ctx.cand]: { centre: V.dir.centre, form: V.dir.form, lang: V.dir.lang, pwd: V.dir.pwd } });
  const exports: ShiftExport[] = [{ cell: 'cell-1', exam: 'DEMO-2026', shift: 'S1', sheets: [V.sheet] }];
  expect(cohortRows(exports, dir, { F1: V.form })).toEqual(V.rows);
});

test('tFirstMs is the activeMs of the first entry with an answer; a mark with an answer counts; dwell sums', () => {
  const s = sheet('C0002', [
    { kind: 'unlock', active: 0, rx: 0 },
    { kind: 'answer', active: 10_000, rx: 0, body: ans('I01', 'A', 5000) },
    { kind: 'mark', active: 20_000, rx: 0, body: { item: 'I01', state: 'AMR', answer: 'A', meta: [3000, []] } },
  ]);
  const dir = dirFor({ C0002: { centre: 'CEN042', form: 'F1' } });
  const rows = cohortRows([{ cell: 'cell-1', exam: 'DEMO-2026', shift: 'S1', sheets: [s] }], dir, form);
  const r = rows.find((x) => x.item === 'I01')!;
  expect(r.tFirstMs).toBe(10_000);
  expect(r.dwellMs).toBe(8000);
  expect(r.visits).toBe(2);
  expect(r.changes).toBe(0);
  expect(r.state).toBe('AMR');
  expect(r.answer).toBe('A');
});

test('an unvisited item is NV with tFirstMs -1 and a 64-zero h', () => {
  const s = sheet('C0003', [{ kind: 'unlock', active: 0, rx: 0 }]);
  const dir = dirFor({ C0003: { centre: 'CEN042', form: 'F1' } });
  const rows = cohortRows([{ cell: 'cell-1', exam: 'DEMO-2026', shift: 'S1', sheets: [s] }], dir, form);
  for (const r of rows) {
    expect(r.state).toBe('NV');
    expect(r.tFirstMs).toBe(-1);
    expect(r.h).toBe('0'.repeat(64));
    expect(r.seq).toBe(0);
    expect(r.rxWall).toBe(0);
  }
});

test('Review Focus #5: one candidate in two exports yields one set of rows; missing bodies are no entry', () => {
  const fuller = sheet('C0004', [
    { kind: 'unlock', active: 0, rx: 0 },
    { kind: 'answer', active: 10_000, rx: 0, body: ans('I01', 'B') },
    { kind: 'answer', active: 20_000, rx: 0, body: ans('I02', 'C') },
  ]);
  const thinner = sheet('C0004', [{ kind: 'unlock', active: 0, rx: 0 }]);
  thinner.entries[0].body = ['missing'];
  const exports: ShiftExport[] = [
    { cell: 'cell-1', exam: 'DEMO-2026', shift: 'S1', sheets: [fuller] },
    { cell: 'cell-2', exam: 'DEMO-2026', shift: 'S1', sheets: [thinner] },
  ];
  const dir = dirFor({ C0004: { centre: 'CEN042', form: 'F1' } });
  const rows = cohortRows(exports, dir, form);
  expect(rows.filter((r) => r.item === 'I01').length).toBe(1);
  const i01 = rows.find((r) => r.item === 'I01')!;
  expect(i01.answer).toBe('B');
  // The thinner sheet's missing body would have made I01 NV; it must not have won.
  expect(i01.state).toBe('A');
});

test('a missing body on an item counts as no entry (state NV)', () => {
  const s = sheet('C0005', [
    { kind: 'unlock', active: 0, rx: 0 },
    { kind: 'answer', active: 10_000, rx: 0, body: ans('I02', 'B') },
  ]);
  s.entries[1].body = ['missing'];
  const dir = dirFor({ C0005: { centre: 'CEN042', form: 'F1' } });
  const rows = cohortRows([{ cell: 'cell-1', exam: 'DEMO-2026', shift: 'S1', sheets: [s] }], dir, form);
  const i02 = rows.find((r) => r.item === 'I02')!;
  expect(i02.state).toBe('NV');
  expect(i02.tFirstMs).toBe(-1);
});

test('lang and pwd come from the directory, defaulting to en and 0', () => {
  const s = sheet('C0006', [{ kind: 'unlock', active: 0, rx: 0 }]);
  const dirDefault = dirFor({ C0006: { centre: 'CEN042', form: 'F1' } });
  const rows1 = cohortRows([{ cell: 'cell-1', exam: 'DEMO-2026', shift: 'S1', sheets: [s] }], dirDefault, form);
  expect(rows1[0].lang).toBe('en');
  expect(rows1[0].pwd).toBe(0);

  const dirSet = dirFor({ C0006: { centre: 'CEN042', form: 'F1', lang: 'ta', pwd: 1 } });
  const rows2 = cohortRows([{ cell: 'cell-1', exam: 'DEMO-2026', shift: 'S1', sheets: [s] }], dirSet, form);
  expect(rows2[0].lang).toBe('ta');
  expect(rows2[0].pwd).toBe(1);
});

test('a candidate not in the directory is not analysed', () => {
  const s = sheet('C0999', [{ kind: 'unlock', active: 0, rx: 0 }]);
  const dir = dirFor({});
  const rows = cohortRows([{ cell: 'cell-1', exam: 'DEMO-2026', shift: 'S1', sheets: [s] }], dir, form);
  expect(rows).toEqual([]);
});

test('deviceEvidence: a blocklisted finding or untrusted input names the candidate; a clean sheet does not', () => {
  const flagged = sheet('C0007', [
    { kind: 'unlock', active: 0, rx: 0 },
    { kind: 'integrity', active: 5000, rx: 0, body: { item: '', state: '', answer: '', meta: ['blocklisted', 'block', 'remote tool seen', []] } },
  ]);
  const untrusted = sheet('C0008', [
    { kind: 'unlock', active: 0, rx: 0 },
    { kind: 'answer', active: 5000, rx: 0, body: { item: 'I01', state: 'A', answer: 'B', meta: [1000, ['prov', 5, 100, 3, 2, 4, 1000]] } },
  ]);
  const clean = sheet('C0009', [
    { kind: 'unlock', active: 0, rx: 0 },
    { kind: 'answer', active: 5000, rx: 0, body: { item: 'I01', state: 'A', answer: 'B', meta: [1000, ['prov', 5, 100, 3, 2, 0, 1000]] } },
  ]);
  const exports: ShiftExport[] = [{ cell: 'cell-1', exam: 'DEMO-2026', shift: 'S1', sheets: [flagged, untrusted, clean] }];
  expect(deviceEvidence(exports)).toEqual(['C0007', 'C0008']);
});

test('toJsonl keeps schema key order', () => {
  const s = sheet('C0010', [{ kind: 'unlock', active: 0, rx: 0 }]);
  const dir = dirFor({ C0010: { centre: 'CEN042', form: 'F1' } });
  const rows = cohortRows([{ cell: 'cell-1', exam: 'DEMO-2026', shift: 'S1', sheets: [s] }], dir, form);
  const lines = toJsonl(rows).split('\n');
  expect(lines.at(-1)).toBe('');
  expect(lines[0].startsWith('{"cand":')).toBe(true);
  expect(Object.keys(JSON.parse(lines[0]))).toEqual(['cand', 'centre', 'shift', 'form', 'lang', 'pwd', 'item', 'state', 'answer', 'dwellMs', 'visits', 'changes', 'tFirstMs', 'seq', 'rxWall', 'h']);
});
