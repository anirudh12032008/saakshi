// Writes fixtures/vectors/protocol-v1-addendum-e.json (protocol Addendum E). Run once; refuses to overwrite.
//   bun tools/gen-vectors-addendum-e.ts
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { decisionArray, type ExportRow } from '../packages/core/src/analytics.ts';
import { hexToBytes, toHex } from '../packages/core/src/bytes.ts';
import { canon } from '../packages/core/src/canon.ts';
import type { KeysFile } from '../packages/core/src/dev.ts';
import { msg } from '../packages/core/src/enrol.ts';
import { signedLine } from '../packages/core/src/journal.ts';
import { signer } from '../packages/core/src/node.ts';
import { bodyArray, bodyCommit, entryHash, genesisPrev, type Body, type Header, type Kind } from '../packages/core/src/protocol.ts';
import type { ResponseSheet } from '../packages/core/src/sheet.ts';

const OUT = 'fixtures/vectors/protocol-v1-addendum-e.json';
if (existsSync(OUT)) { console.log(`keep ${OUT} (frozen)`); process.exit(0); }
const keys = JSON.parse(readFileSync('fixtures/keys.json', 'utf8')) as KeysFile;
const kp = (k: { priv: string; pub: string }) => ({ priv: hexToBytes(k.priv), pub: hexToBytes(k.pub) });

// E.2: the DEV fixture authority key stands in for control's decision key.
const din = { exam: 'DEMO-2026', shift: 'S1', reportHash: createHash('sha256').update('saakshi-e2-vector').digest('hex'), by: 'R. Iyer (committee chair)', at: 1790000000000 };
const decision = { in: din, text: canon(decisionArray(din)), sig: toHex(signer(kp(keys.authority))(msg(decisionArray(din)))) };

// E.1: one sheet (seat key seats[0], fixed salts), and its rows derived by hand from the E.1 rule.
const ctx = { exam: 'DEMO-2026', shift: 'S1', attempt: 1, cand: 'C0001' };
const T0 = 1_790_000_000_000, E: Body = { item: '', state: '', answer: '', meta: [] };
const steps: { kind: Kind; active: number; body: Body | 'missing' }[] = [
  { kind: 'unlock', active: 0, body: E },
  { kind: 'answer', active: 30_000, body: { item: 'I01', state: 'A', answer: 'B', meta: [30_000, []] } },
  { kind: 'answer', active: 45_000, body: { item: 'I01', state: 'A', answer: 'C', meta: [5_000, []] } },
  { kind: 'answer', active: 60_000, body: { item: 'I02', state: 'MR', answer: '', meta: [15_000, []] } },
  { kind: 'answer', active: 75_000, body: 'missing' },
];
const sign = signer(kp(keys.seats[0]));
let prev = genesisPrev(ctx);
const hs: string[] = [];
const entries = steps.map((s, i) => {
  const salt = new Uint8Array(16).fill(i + 1), body = s.body === 'missing' ? { item: 'I03', state: 'A' as const, answer: 'D', meta: [15_000, []] } : s.body;
  const h: Header = { ...ctx, keyEpoch: 1, seq: i + 1, prev, kind: s.kind, tMonoMs: s.active, activeMs: s.active, bodyCommit: bodyCommit(salt, body) };
  prev = toHex(entryHash(h)); hs.push(prev);
  return { line: signedLine(h, sign), salt: toHex(salt), body: s.body === 'missing' ? ['missing'] : bodyArray(body), rx: [T0 + s.active, T0 + s.active + 5] as [number, number] };
});
const sheet: ResponseSheet = { ctx, form: 'F1', pseud: '7'.repeat(64), keys: [], entries };
const form = ['I01', 'I02', 'I03', 'I04'], dir = { centre: 'CEN042', form: 'F1' as const, lang: 'en', pwd: 0 as const };
const base = { cand: ctx.cand, centre: dir.centre, shift: ctx.shift, form: dir.form, lang: dir.lang, pwd: dir.pwd };
const none = { state: 'NV' as const, answer: '', dwellMs: 0, visits: 0, changes: 0, tFirstMs: -1, seq: 0, rxWall: 0, h: '0'.repeat(64) };
const rows: ExportRow[] = [
  { ...base, item: 'I01', state: 'A', answer: 'C', dwellMs: 35_000, visits: 2, changes: 1, tFirstMs: 30_000, seq: 3, rxWall: T0 + 45_000, h: hs[2] },
  { ...base, item: 'I02', state: 'MR', answer: '', dwellMs: 15_000, visits: 1, changes: 0, tFirstMs: -1, seq: 4, rxWall: T0 + 60_000, h: hs[3] },
  { ...base, item: 'I03', ...none },   // its only entry's body is 'missing': no entry
  { ...base, item: 'I04', ...none },
];
writeFileSync(OUT, JSON.stringify({
  note: 'DEV ONLY: decisionKey is the fixture authority key from fixtures/keys.json. P-256 signatures are randomised: verify, do not compare bytes.',
  decisionKey: { pub: keys.authority.pub },
  decision,
  export: { sheet, form, dir, rows },
}, null, 2) + '\n');
console.log(`wrote ${OUT}`);
