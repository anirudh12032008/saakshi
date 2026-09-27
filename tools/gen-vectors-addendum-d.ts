// Writes fixtures/vectors/protocol-v1-addendum-d.json (protocol Addendum D). Run once; refuses to overwrite.
//   node tools/gen-vectors-addendum-d.ts
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { hexToBytes, toHex } from '../packages/core/src/bytes.ts';
import { canon } from '../packages/core/src/canon.ts';
import type { KeysFile } from '../packages/core/src/dev.ts';
import { msg } from '../packages/core/src/enrol.ts';
import { faceArray, findingsHash, INTEGRITY_DEFAULT, readinessArray, sealThumb, thumbHashOf, type FaceFlag, type Readiness } from '../packages/core/src/integrity.ts';
import { nativeBox, newKeyPair, signer } from '../packages/core/src/node.ts';
import type { Policy } from '../packages/core/src/policy.ts';

const OUT = 'fixtures/vectors/protocol-v1-addendum-d.json';
if (existsSync(OUT)) { console.log(`keep ${OUT} (frozen)`); process.exit(0); }
const keys = JSON.parse(readFileSync('fixtures/keys.json', 'utf8')) as KeysFile;
const seat = { priv: hexToBytes(keys.seats[0].priv), pub: hexToBytes(keys.seats[0].pub) }, sign = signer(seat);
const X = { exam: 'DEMO-2026', shift: 'S1', attempt: 1, cand: 'C0001' };
const review = newKeyPair();
const readiness: Readiness = { ...X, seatId: 'CEN042-S01', keyEpoch: 1, at: 1790000000000, verdict: 'block', findings: [
  { code: 'blocklisted', level: 'block', detail: 'AnyDesk (pid 4242)', names: ['AnyDesk'] },
  { code: 'capture-excluded', level: 'block', detail: 'a window of overlay-sim is hidden from screen capture', names: ['overlay-sim'] },
  { code: 'battery', level: 'amber', detail: 'running on battery', names: [] },
] };
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 0xff, 0xd9]);                     // a stand-in, not a real image
const thumb = sealThumb(review.pub, X, 1790000060000, jpeg, nativeBox);
const face: FaceFlag = { ...X, seatId: 'CEN042-S01', at: 1790000060000, code: 'face-none', faces: 0, expected: 1, thumb, thumbHash: thumbHashOf(thumb) };
const policy: Policy = { v: 1, exam: X.exam, shift: X.shift, centre: 'CEN042', cell: { id: 'cell-1', keyId: '0'.repeat(16), pub: keys.cells[0].pub },
  durationMs: 1_800_000, issuedAt: 1790000000000,
  roster: { C0001: { form: 'F1', extraMs: 0, pseud: '7'.repeat(64) }, C0002: { form: 'F2', extraMs: 600_000, pseud: '8'.repeat(64), acc: { faces: 2, assistive: ['NVDA', 'VoiceOver'] } } },
  integrity: { ...INTEGRITY_DEFAULT, egress: ['192.168.1.10:7070'], reviewPub: toHex(review.pub) } };
writeFileSync(OUT, JSON.stringify({
  reviewKey: { priv: toHex(review.priv), pub: toHex(review.pub) },
  readiness: { in: readiness, text: canon(readinessArray(readiness)), findingsHash: findingsHash(readiness.findings), sig: toHex(sign(msg(readinessArray(readiness)))) },
  face: { in: face, text: canon(faceArray(face)), jpeg: toHex(jpeg), sig: toHex(sign(msg(faceArray(face)))) },
  policy: { in: policy },
}, null, 2) + '\n');
console.log(`wrote ${OUT}`);
