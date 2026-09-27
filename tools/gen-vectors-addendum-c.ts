// Writes fixtures/vectors/protocol-v1-addendum-c.json (protocol Addendum C). Run once; refuses to overwrite.
//   node tools/gen-vectors-addendum-c.ts
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { hexToBytes, toHex } from '../packages/core/src/bytes.ts';
import { canon } from '../packages/core/src/canon.ts';
import type { KeysFile } from '../packages/core/src/dev.ts';
import { attestHash, bindArray, cellKeyArray, cellKeyId, msg, type Bind } from '../packages/core/src/enrol.ts';
import { grantArray, handoverArray, purgeArray, respHash, sealHandoverPin, sealRestore, type CellCert, type Grant, type HandoverClaim, type PurgeOrder } from '../packages/core/src/handover.ts';
import { leafHashHex, NO_PREV_STH, receiptMessage, responsesOf, sthId, sthMessage, type Sth } from '../packages/core/src/log.ts';
import { nativeBox, signer, type KeyPair } from '../packages/core/src/node.ts';
import { counts, receiptCode, type Response } from '../packages/core/src/protocol.ts';
import type { Proof, ResponseSheet } from '../packages/core/src/sheet.ts';
import { FORMS, SimSeat } from './sim-seat.ts';

const OUT = 'fixtures/vectors/protocol-v1-addendum-c.json';
if (existsSync(OUT)) { console.log(`keep ${OUT} (frozen)`); process.exit(0); }
const keys = JSON.parse(readFileSync('fixtures/keys.json', 'utf8')) as KeysFile;
const pair = (x: { priv: string; pub: string }): KeyPair => ({ priv: hexToBytes(x.priv), pub: hexToBytes(x.pub) });
const auth = pair(keys.authority), cell = pair(keys.cells[0]), oldSeat = pair(keys.seats[0]), newSeat = pair(keys.seats[1]);
const signA = signer(auth), signC = signer(cell);
const X = { exam: 'DEMO-2026', shift: 'S1', attempt: 1, cand: 'C0001' };

// Seat A (keyEpoch 1, seats[0]) journals unlock + 4 answers; the candidate moves at seq 5; seat B (keyEpoch 2, seats[1]) continues.
const s = new SimSeat(keys, 'C0001', cell.pub);
s.add(5);
const fromSeq = 5, fromHead = s.hs[4], activeMs = s.headers[4].activeMs, creditedMs = 108_000;
const R = responsesOf(FORMS.F1, s.bodies).filter((r) => r[1] !== 'NV') as Response[];
s.rekey(2, newSeat);
s.append('handover', { item: '', state: '', answer: '', meta: ['pin', fromSeq, creditedMs] });
s.add(3);
s.submit('F1');

const attest = attestHash({ exam: X.exam, shift: X.shift, operatorId: 'GATE-42-OP7', time: 1790000000000, method: 'aadhaar-face', cand: X.cand });
const bind1: Bind = { ...X, seatId: 'CEN042-S01', pub: keys.seats[0].pub, keyEpoch: 1, fromSeq: 0, attestHash: attest };
const bind2: Bind = { ...X, seatId: 'CEN042-S02', pub: keys.seats[1].pub, keyEpoch: 2, fromSeq, attestHash: attest };
const wb = (b: Bind) => ({ cert: canon(bindArray(b)), sig: toHex(signC(msg(bindArray(b)))), cell: 'cell-1', pinBox: '' });
const claim: HandoverClaim = { ...X, keyEpoch: 1, fromSeq, fromHead, newPub: keys.seats[1].pub };
const grant: Grant = { ...X, keyEpoch: 2, fromSeq, fromHead, activeMs, creditedMs, respHash: respHash(R) };
const cells: CellCert[] = keys.cells.map((c) => {
  const keyId = cellKeyId(hexToBytes(c.pub));
  return { id: c.id, keyId, pub: c.pub, cert: toHex(signA(msg(cellKeyArray({ exam: X.exam, cellId: c.id, keyId, pub: c.pub })))) };
});

// The proof: both bind certificates, the cell's countersigned receipt, a one-leaf register signed by the authority.
const n = s.head, [form, fh] = s.bodies[n - 1].meta as [string, string];
if (form !== 'F1') throw new Error('the submit names the wrong form');
const sheet: ResponseSheet = { ...s.sheet('F1'), binds: [wb(bind1), wb(bind2)] };
const B = { exam: X.exam, shift: X.shift, attempt: 1, pseud: sheet.pseud, seq: n, h: s.hs[n - 1], finalHash: fh, ...counts(responsesOf(FORMS.F1, s.bodies.slice(0, n - 1))) };
sheet.receipt = { cell: 'cell-1', seq: n, h: B.h, code: receiptCode(B), sig: toHex(signC(receiptMessage(B))) };
const leaf = { exam: X.exam, shift: X.shift, attempt: 1, pseud: sheet.pseud, h: B.h, finalHash: fh };
const sth: Sth = { exam: X.exam, shift: X.shift, size: 1, root: leafHashHex(leaf), prevSTH: NO_PREV_STH, ts: 1790000900000 };
const proof: Proof = { v: 1, sheet, sth: { sth, sig: toHex(signA(sthMessage(sth))) }, index: 0, inclusion: [], cells: [cells[0]] };
const purge: PurgeOrder = { exam: X.exam, shift: X.shift, sthId: sthId(sth), ts: 1790001000000 };

writeFileSync(OUT, JSON.stringify({
  _note: 'Protocol v1 Addendum C. Signatures, box nonces and ephemeral keys are random: verify or open them, never compare bytes.',
  keys: { authority: keys.authority.pub, cell: keys.cells[0].pub, oldSeat: keys.seats[0].pub, newSeat: keys.seats[1].pub },
  claim: { in: claim, text: canon(handoverArray(claim)), sig: toHex(signer(oldSeat)(msg(handoverArray(claim)))) },
  pin: { pin: '482913', seatId: bind2.seatId, box: sealHandoverPin(cell.pub, X, bind2.seatId, bind2.pub, '482913', nativeBox) },
  responses: { rows: R, text: canon(['responses', R]), hash: respHash(R) },
  restore: { keyEpoch: 2, fromSeq, box: sealRestore(newSeat.pub, X, 2, fromSeq, R, nativeBox) },
  grant: { in: grant, text: canon(grantArray(grant)), sig: toHex(signC(msg(grantArray(grant)))) },
  bind2: { in: bind2, text: canon(bindArray(bind2)), sig: wb(bind2).sig },
  purge: { in: purge, text: canon(purgeArray(purge)), sig: toHex(signA(msg(purgeArray(purge)))) },
  cells, forms: { F1: FORMS.F1 }, proof,
}, null, 2) + '\n');
console.log(`wrote ${OUT}`);
