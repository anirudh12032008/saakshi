// Generates golden vectors for protocol v1. Refuses to overwrite: vectors are frozen with the protocol.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { hexToBytes, toHex, utf8 } from '../packages/core/src/bytes.ts';
import { canon } from '../packages/core/src/canon.ts';
import { D, bodyCommit, counts, entryHash, finalHash, genesisPrev, headerArray, kcf, leafArray, receiptCode, tagged, type Header, type Response } from '../packages/core/src/protocol.ts';
import { sealBody, signer } from '../packages/core/src/node.ts';
import { consistencyProof, inclusionProof, leafHash, rootOf } from '../packages/core/src/merkle.ts';
import { newOfflineCode, splitBundle, wrapForCentre } from '../packages/core/src/custody.ts';
import { buildChain, demoEntries } from '../packages/core/src/journal.ts';

const OUT = 'fixtures/vectors/protocol-v1.json';
if (existsSync(OUT)) { console.log(`keep ${OUT} (frozen)`); process.exit(0); }

const keys = JSON.parse(readFileSync('fixtures/keys.json', 'utf8'));
const seat = { priv: hexToBytes(keys.seats[0].priv), pub: hexToBytes(keys.seats[0].pub) };
const cellPub = hexToBytes(keys.cells[0].pub);
const sign = signer(seat);
const ctx = { exam: 'DEMO-2026', shift: 'S1', attempt: 1, cand: 'C0001' };
const salt = Uint8Array.from({ length: 16 }, (_, i) => i);
const body = { item: 'I17', state: 'A' as const, answer: 'B', meta: [4200, ['हिन्दी']] };
const bc = bodyCommit(salt, body);
const header: Header = { ...ctx, keyEpoch: 1, seq: 1, prev: genesisPrev(ctx), kind: 'answer', tMonoMs: 61000, activeMs: 60500, bodyCommit: bc };
const h = toHex(entryHash(header));
const responses: Response[] = [['I17', 'AMR', 'B'], ['I03', 'A', 'C'], ['I05', 'MR', '']];
const fh = finalHash(ctx, 'F1', responses);
const receiptIn = { exam: ctx.exam, shift: ctx.shift, attempt: 1, pseud: '7'.repeat(64), seq: 1, h, finalHash: fh, ...counts(responses) };
const leaves = Array.from({ length: 13 }, (_, i) => leafHash(utf8(canon(leafArray({ ...ctx, pseud: toHex(new Uint8Array(32).fill(i)), h, finalHash: fh })))));
const K = new Uint8Array(32).fill(0x11);
const bundle = { kF1: new Uint8Array(32).fill(0xf1), kF2: new Uint8Array(32).fill(0xf2), L: new Uint8Array(32).fill(0x1c) };
const code = newOfflineCode();
const centre = { exam: ctx.exam, shift: ctx.shift, centre: 'CEN042' };
const sealed = sealBody(cellPub, { ...ctx, seq: 1 }, salt, body);
const msgs = Array.from({ length: 16 }, (_, i) => tagged(D.ENTRY, headerArray({ ...header, seq: i + 1 })));

const vectors = {
  v: 1,
  _note: 'Normative. Signatures are non-deterministic: check that they VERIFY, never compare bytes.',
  canon: {
    accept: [[['x', 1, 'a', [2, ['b']]], '["x",1,"a",[2,["b"]]]'], [['x', 'हिन्दी'], '["x","हिन्दी"]']],
    reject: ['["x", 1]', '["x",1.0]', '["x",-0]', '["x",1e2]', '{"a":1}', '["x",null]', '["x",true]', '[1,"x"]'],
  },
  ctx, genesisPrev: genesisPrev(ctx),
  body: { salt: toHex(salt), body, bodyCommit: bc },
  entry: { header, m: toHex(tagged(D.ENTRY, headerArray(header))), h },
  final: { form: 'F1', responses, finalHash: fh },
  receipt: { in: receiptIn, code: receiptCode(receiptIn) },
  kcf: { K: toHex(K), kc: kcf(K) },
  merkle: {
    leafHashes: leaves.map(toHex),
    roots: leaves.map((_, i) => toHex(rootOf(leaves.slice(0, i + 1)))),
    inclusion: [0, 5, 12].map((index) => ({ size: 13, index, proof: inclusionProof(leaves, index).map(toHex) })),
    consistency: [[1, 13], [4, 13], [7, 13], [13, 13]].map(([m, n]) => ({ size1: m, size2: n, proof: consistencyProof(leaves.slice(0, n), m).map(toHex) })),
  },
  signatures: { pub: toHex(seat.pub), items: msgs.map((m) => ({ m: toHex(m), sig: toHex(sign(m)) })) },
  bodyEnvelope: { seq: 1, envelope: toHex(sealed.envelope), bodyCommit: sealed.bodyCommit },
  custody: {
    code, centre, wrap: toHex(wrapForCentre(code, centre, bundle.kF1, bundle.kF2)),
    kc: { F1: kcf(bundle.kF1), F2: kcf(bundle.kF2) }, L: toHex(bundle.L),
    shares: (await splitBundle(bundle)).map(toHex),
  },
  chain: { lines: buildChain(ctx, 1, demoEntries(5), sign).lines },
};
mkdirSync('fixtures/vectors', { recursive: true });
writeFileSync(OUT, JSON.stringify(vectors, null, 2) + '\n');
console.log(`wrote ${OUT}`);
