// Writes fixtures/vectors/protocol-v1-addendum-b.json (protocol Addendum B). Run once; refuses to overwrite.
//   node tools/gen-vectors-addendum-b.ts
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { hexToBytes, toHex, utf8 } from '../packages/core/src/bytes.ts';
import { sealBox } from '../packages/core/src/box.ts';
import { canon } from '../packages/core/src/canon.ts';
import type { KeysFile } from '../packages/core/src/dev.ts';
import { attestHash, bindArray, cellKeyArray, cellKeyId, makeBindReq, msg, pinRecord } from '../packages/core/src/enrol.ts';
import { nativeBox, signer } from '../packages/core/src/node.ts';
import { ciphertextHash, manifestArray, releaseArray, sealCodes, sealPaper, sealShareFile, shareInfo } from '../packages/core/src/paper.ts';
import { signPolicy, type Policy } from '../packages/core/src/policy.ts';
import { kcf } from '../packages/core/src/protocol.ts';

const OUT = 'fixtures/vectors/protocol-v1-addendum-b.json';
if (existsSync(OUT)) { console.log(`keep ${OUT} (frozen)`); process.exit(0); }
const keys = JSON.parse(readFileSync('fixtures/keys.json', 'utf8')) as KeysFile;
const auth = { priv: hexToBytes(keys.authority.priv), pub: hexToBytes(keys.authority.pub) };
const cell = { priv: hexToBytes(keys.cells[0].priv), pub: hexToBytes(keys.cells[0].pub) };
const signA = signer(auth), signC = signer(cell);
const X = { exam: 'DEMO-2026', shift: 'S1' };

const attest = { ...X, operatorId: 'GATE-42-OP7', time: 1790000000000, method: 'aadhaar-face' as const, cand: 'C0001' };
const bind = { ...X, attempt: 1, cand: 'C0001', seatId: 'CEN042-S01', pub: keys.seats[0].pub, keyEpoch: 1, fromSeq: 0, attestHash: attestHash(attest) };
const bindText = canon(bindArray(bind));
const cellkey = { exam: X.exam, cellId: 'cell-1', keyId: cellKeyId(cell.pub), pub: keys.cells[0].pub };
const pin = { pin: '123456', salt: '01'.repeat(16) };
const record = pinRecord(pin.pin, hexToBytes(pin.salt));
const K1 = new Uint8Array(32).fill(0x11), K2 = new Uint8Array(32).fill(0x22), L = new Uint8Array(32).fill(0x33);
const paperText = JSON.stringify({ exam: X.exam, form: 'F1', items: [{ id: 'I01', subject: 'physics', en: { q: 'What is the SI unit of force?', o: ['Joule', 'Watt', 'Pascal', 'Newton'] }, hi: { q: 'बल का SI मात्रक क्या है?', o: ['जूल', 'वाट', 'पास्कल', 'न्यूटन'] } }] });
const ct1 = sealPaper(K1, { ...X, form: 'F1' }, utf8(paperText));
const manifest = { ...X, forms: [{ form: 'F1', ciphertextHash: ciphertextHash(ct1), kcf: kcf(K1) }, { form: 'F2', ciphertextHash: '0'.repeat(64), kcf: kcf(K2) }], ts: 1790000000000 };
const release = { ...X, form: 'F1', kcf: kcf(K1), ts: 1790000100000 };
const policy: Policy = { v: 1, ...X, centre: 'CEN042', cell: { id: 'cell-1', keyId: cellkey.keyId, pub: cellkey.pub }, durationMs: 1_800_000, roster: { C0001: { form: 'F1', extraMs: 0, pseud: '7'.repeat(64) } }, issuedAt: 1790000000000 };
const codes = { CEN042: 'N5JY1E59BR0FGNVQW' };
const share = Uint8Array.from({ length: 97 }, (_, i) => i);
const releaseKeyId = 'feedfacecafebeef', recipientSeat = 7;

writeFileSync(OUT, JSON.stringify({
  _note: 'Protocol v1 Addendum B. Signatures, nonces, salts of boxes and ephemeral keys are random: verify or open them, never compare bytes.',
  attest: { in: attest, attestHash: attestHash(attest) },
  cellkey: { in: cellkey, text: canon(cellKeyArray(cellkey)), sig: toHex(signA(msg(cellKeyArray(cellkey)))) },
  bind: { in: bind, text: bindText, sig: toHex(signC(utf8(bindText))) },
  pin: { ...pin, record, box: makeBindReq(bind, cell.pub, record, nativeBox).pinBox },
  policy: { signed: signPolicy(policy, signA) },
  paper: { K: toHex(K1), text: paperText, ct: toHex(ct1) },
  manifest: { in: manifest, text: canon(manifestArray(manifest)), sig: toHex(signA(msg(manifestArray(manifest)))) },
  release: { in: release, text: canon(releaseArray(release)), sig: toHex(signA(msg(releaseArray(release)))), key: toHex(K1) },
  codes: { L: toHex(L), codes, ct: toHex(sealCodes(L, X.exam, X.shift, codes)) },
  shareFile: { pass: 'TESTPASSPHRASE01', share: toHex(share), file: sealShareFile(share, 'TESTPASSPHRASE01', { ...X, custodian: 'NTA' }) },
  shareBox: { keyId: releaseKeyId, custodian: 'NTA', recipientSeat, box: toHex(sealBox(hexToBytes(keys.seats[recipientSeat].pub), shareInfo(X.exam, X.shift, 'NTA', releaseKeyId), share, nativeBox)) },
}, null, 2) + '\n');
console.log(`wrote ${OUT}`);
