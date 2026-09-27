import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { hexToBytes } from '@saakshi/core/bytes';
import { cellKey, devPseud, devSeat, type KeysFile } from '@saakshi/core/dev';
import { parseSignedLine, verifyChain } from '@saakshi/core/journal';
import { responsesOf } from '@saakshi/core/log';
import { openBody, verifier } from '@saakshi/core/node';
import { bodyCommit, bodyFromArray, finalHash } from '@saakshi/core/protocol';
import { fromB64 } from '@saakshi/core/wire';
import { FORMS, SimSeat } from '../../../tools/sim-seat.ts';

const keys = JSON.parse(readFileSync(new URL('../../../fixtures/keys.json', import.meta.url), 'utf8')) as KeysFile;
const cell = cellKey(keys, 'cell-1');

test('SimSeat builds a chain the seat key verifies and envelopes only the cell can open', () => {
  const s = new SimSeat(keys, 'C0003', cell.pub);
  s.add(25);
  const r = verifyChain(s.ctx, s.entries.map((e) => e.line), verifier(devSeat(keys, 'C0003')!.pub));
  expect(r).toEqual({ ok: true, head: s.hs[24], count: 25 });
  s.entries.forEach((e, i) => {
    const p = parseSignedLine(e.line);
    if (!p.ok) throw new Error(p.detail);
    const { body } = openBody(cell.priv, { ...s.ctx, seq: i + 1 }, fromB64(e.env), p.header.bodyCommit);
    expect(body.item).toBe(i === 0 ? '' : `I${String((i - 1) % 20 + 1).padStart(2, '0')}`);
  });
  expect(s.after(20).length).toBe(5);
  expect(s.after(-1, 3).length).toBe(3);
});

test('alt() is validly signed at an existing seq but hashes differently', () => {
  const s = new SimSeat(keys, 'C0001', cell.pub);
  s.add(3);
  const p = parseSignedLine(s.alt(2).line);
  if (!p.ok) throw new Error(p.detail);
  expect(p.header.seq).toBe(2);
  expect(p.header.prev).toBe(s.hs[0]);
  expect(verifier(devSeat(keys, 'C0001')!.pub)(p.m, p.sig)).toBe(true);
  expect(s.alt(2).line).not.toBe(s.entries[1].line);
});

test('submit() closes the chain with [form, finalHash] of the replayed responses; sheet() is the honest record', () => {
  const s = new SimSeat(keys, 'C0002', cell.pub);
  s.add(4);
  s.append('clear', { item: 'I19', state: 'NA', answer: '', meta: [0, []] });
  s.submit();
  const last = parseSignedLine(s.entries.at(-1)!.line);
  if (!last.ok) throw new Error(last.detail);
  expect(last.header.kind).toBe('submit');
  const fh = finalHash(s.ctx, 'F2', responsesOf(FORMS.F2, s.bodies.slice(0, -1)));
  expect(s.bodies.at(-1)!.meta).toEqual(['F2', fh]);
  const sh = s.sheet();
  expect(sh).toMatchObject({ ctx: s.ctx, form: 'F2', pseud: devPseud('C0002'), keys: [{ keyEpoch: 1, pub: keys.seats[1].pub }] });
  expect(sh.entries.length).toBe(6);
  sh.entries.forEach((e, i) => {
    const p = parseSignedLine(e.line);
    if (!p.ok) throw new Error(p.detail);
    expect(e.line).toBe(s.entries[i].line);
    expect(bodyCommit(hexToBytes(e.salt), bodyFromArray(e.body))).toBe(p.header.bodyCommit);
  });
});
