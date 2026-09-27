import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { hexToBytes, toHex } from '@saakshi/core/bytes';
import { cellKey, devForm, devPseud, type KeysFile } from '@saakshi/core/dev';
import { cellKeyArray, cellKeyId, msg } from '@saakshi/core/enrol';
import { newKeyPair, signer } from '@saakshi/core/node';
import { formsOf } from '@saakshi/core/sheet';
import { verifyProof } from '@saakshi/core/verify';
import { Bindings } from '../src/bindings.ts';
import { createIngest } from '../src/ingest.ts';
import { proofFor, seal } from '../src/seal.ts';
import { shiftExport } from '../src/sheet-export.ts';
import { openDb } from '../src/store.ts';
import { viewOf } from '../src/verify-view.ts';
import { FORMS, SimSeat } from '../../../tools/sim-seat.ts';
import { simBindReq } from '../../../tools/sim-custody.ts';

const keys = JSON.parse(readFileSync(new URL('../../../fixtures/keys.json', import.meta.url), 'utf8')) as KeysFile;
const cell = cellKey(keys, 'cell-1'), forms = formsOf(FORMS);
const authority = { priv: hexToBytes(keys.authority.priv), pub: hexToBytes(keys.authority.pub) };
const onlyAuthority = { authority: keys.authority.pub, cells: {}, seats: {} };
const cert = (id: string) => {
  const c = keys.cells.find((x) => x.id === id)!, keyId = cellKeyId(hexToBytes(c.pub));
  return { id, keyId, pub: c.pub, cert: toHex(signer(authority)(msg(cellKeyArray({ exam: 'DEMO-2026', cellId: id, keyId, pub: c.pub })))) };
};

test('the Stage 3 fix through the real cell: an enrolled candidate\'s proof verifies with only the authority key pinned', async () => {
  const { db } = openDb(':memory:');
  const b = new Bindings(db, { exam: 'DEMO-2026', shift: 'S1', cell });
  const n = createIngest({ mode: 'cell', db, fresh: false, seatKey: b.seatKey, acceptBinds: (x) => b.acceptAll(x), cell, forms, formOf: devForm, pseud: devPseud });
  const key = newKeyPair();
  const e = b.enrol(simBindReq('C0001', key, cell.pub, 'CEN042-S01'), true);
  if (!e.ok) throw new Error(e.error);
  const seat = new SimSeat(keys, 'C0001', cell.pub, 1, key);
  seat.add(21); seat.submit();
  const r = await n.sync({ entries: seat.entries, streams: [{ ...seat.ctx, head: seat.head }] });
  expect(r !== 'REBUILDING' && r.rejected).toEqual([]);
  const exp = shiftExport(db, { exam: 'DEMO-2026', shift: 'S1', cell: 'cell-1', formOf: devForm, pseud: devPseud, seatKey: b.seatKey, binds: (c) => b.forCand(c) });
  expect(exp.sheets[0].binds?.length).toBe(1);
  expect(exp.sheets[0].binds![0].pinBox).toBe('');                               // the proof never carries the sealed PIN record
  const { rec } = seal(undefined, exp, { authority, trust: { ...onlyAuthority, seats: { 'C0001/1': toHex(key.pub) } }, pseud: devPseud });
  const proof = proofFor(rec, exp.sheets[0], [cert('cell-1')])!;
  const v = verifyProof(proof, forms, onlyAuthority);
  expect(v.checks.filter((c) => !c.ok)).toEqual([]);
  expect(viewOf(v).rows[0].detail).toMatch(/certified by cell-1/);
  const before = verifyProof({ ...proof, cells: undefined }, forms, onlyAuthority);   // exactly the Stage 3 symptom
  expect(before.checks.find((c) => c.name === 'keys')!.ok).toBe(false);
  n.close();
});
