// Golden vectors for protocol-v1 Addendum A (Stage 2). Refuses to overwrite: frozen once written.
//   node tools/gen-vectors-addendum.ts
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { ackArray, ackMessage } from '../packages/core/src/ack.ts';
import { hexToBytes, toHex } from '../packages/core/src/bytes.ts';
import { canon } from '../packages/core/src/canon.ts';
import { DEV_PSEUD_KEY, devPseud } from '../packages/core/src/dev.ts';
import { NO_PREV_STH, leafHashHex, receiptMessage, responsesOf, sthArray, sthId, sthMessage, type Sth } from '../packages/core/src/log.ts';
import { signer } from '../packages/core/src/node.ts';
import { bodyArray, counts, finalHash, receiptArray, type Body } from '../packages/core/src/protocol.ts';

const OUT = 'fixtures/vectors/protocol-v1-addendum-a.json';
if (existsSync(OUT)) { console.log(`keep ${OUT} (frozen)`); process.exit(0); }
const V = JSON.parse(readFileSync('fixtures/vectors/protocol-v1.json', 'utf8'));
const keys = JSON.parse(readFileSync('fixtures/keys.json', 'utf8'));
const pair = (k: { priv: string; pub: string }) => ({ priv: hexToBytes(k.priv), pub: hexToBytes(k.pub) });
const authority = signer(pair(keys.authority)), cell = signer(pair(keys.cells[0]));
const ctx = V.ctx;

// A visit (NA), an answer then a re-answer (last wins), a mark with an answer, and an untouched item (NV).
const bodies: Body[] = [
  { item: '', state: '', answer: '', meta: [] },
  { item: 'I02', state: 'NA', answer: '', meta: [0, []] },
  { item: 'I01', state: 'A', answer: 'C', meta: [900, []] },
  { item: 'I01', state: 'A', answer: 'D', meta: [400, []] },
  { item: 'I03', state: 'AMR', answer: 'B', meta: [700, []] },
];
const form = ['I01', 'I02', 'I03', 'I04'];
const responses = responsesOf(form, bodies);
const fh = finalHash(ctx, 'F1', responses);
const sth: Sth = { exam: ctx.exam, shift: ctx.shift, size: 13, root: V.merkle.roots[12], prevSTH: NO_PREV_STH, ts: 1790000000000 };
const ack = { ...ctx, keyEpoch: 1, seq: 1, h: V.entry.h };
const leafIn = { exam: ctx.exam, shift: ctx.shift, attempt: ctx.attempt, pseud: devPseud('C0001'), h: V.entry.h, finalHash: fh };

writeFileSync(OUT, JSON.stringify({
  _note: 'protocol-v1 Addendum A (docs/protocol-v1.md §14). Signatures are random: verify them, never compare bytes.',
  ctx,
  pseud: { key: toHex(DEV_PSEUD_KEY), roll: 'C0001', pseud: devPseud('C0001') },
  responses: { formName: 'F1', form, bodies: bodies.map(bodyArray), responses, finalHash: fh, counts: counts(responses) },
  sth: { sth, canon: canon(sthArray(sth)), id: sthId(sth), pub: keys.authority.pub, sig: toHex(authority(sthMessage(sth))) },
  receiptSig: { in: V.receipt.in, canon: canon(receiptArray(V.receipt.in)), pub: keys.cells[0].pub, sig: toHex(cell(receiptMessage(V.receipt.in))) },
  ack: { in: ack, canon: canon(ackArray(ack)), pub: keys.cells[0].pub, sig: toHex(cell(ackMessage(ack))) },
  leaf: { in: leafIn, hash: leafHashHex(leafIn) },
}, null, 2) + '\n');
console.log(`wrote ${OUT}`);
