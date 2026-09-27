// Enrolment (protocol Addendum B.1–B.5): the gate attestation, the cell key certificate, the cell-signed bind certificate
// and the PIN record sealed to the cell. Browser-safe; server and seat pass nativeBox / verifier from node.ts for speed.
import { p256 } from '@noble/curves/nist.js';
import { scrypt } from '@noble/hashes/scrypt.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { hexToBytes, randomBytes, toHex, utf8 } from './bytes.ts';
import { nobleBox, openBox, sealBox, type BoxKeys } from './box.ts';
import { canon, parseCanon, type Canon } from './canon.ts';
import type { Ctx } from './protocol.ts';
import { nobleVerifier, type Verify } from './sig.ts';

/** Addendum A.1 / B.1: structures that are not entries are signed as UTF-8(canon(array)), with no domain byte. */
export const msg = (a: Canon[]): Uint8Array => utf8(canon(a));

const HEX64 = /^[0-9a-f]{64}$/, PUB = /^04[0-9a-f]{128}$/, SIG = /^[0-9a-f]{128}$/;
const nat = (x: unknown): x is number => typeof x === 'number' && Number.isSafeInteger(x) && x >= 0;
const str = (x: unknown): x is string => typeof x === 'string' && x.length > 0 && x.length <= 64;
/** A 65-byte uncompressed P-256 key, in hex, that is really on the curve. */
export const isP256Pub = (hex: string): boolean => { if (!PUB.test(hex)) return false; try { p256.Point.fromHex(hex); return true; } catch { return false; } };

export const GATE_METHODS = ['aadhaar-face', 'aadhaar-fingerprint', 'id-document'] as const;
export type GateMethod = (typeof GATE_METHODS)[number];
export interface Attest { exam: string; shift: string; operatorId: string; time: number; method: GateMethod; cand: string }
/** B.3: the gate's existing check, as one hash the bind certificate carries. */
export const attestHash = (a: Attest): string => toHex(sha256(msg(['attest', a.exam, a.shift, a.operatorId, a.time, a.method, a.cand])));

/** B.2: cellKeyId = the first 16 hex of hex(SHA-256(pub)); the certificate is signed by the exam authority. */
export const cellKeyId = (pub: Uint8Array): string => toHex(sha256(pub)).slice(0, 16);
export const cellKeyArray = (c: { exam: string; cellId: string; keyId: string; pub: string }): Canon[] => ['cellkey', c.exam, c.cellId, c.keyId, c.pub];

export interface Bind extends Ctx { seatId: string; pub: string; keyEpoch: number; fromSeq: number; attestHash: string }
/** protocol-v1 §5 reserved layout, signed by the cell (B.1). The new key signs entries with seq > fromSeq. */
export const bindArray = (b: Bind): Canon[] => ['bind', b.exam, b.shift, b.attempt, b.cand, b.seatId, b.pub, b.keyEpoch, b.fromSeq, b.attestHash];
export function bindFromArray(a: Canon[]): Bind {
  const [tag, exam, shift, attempt, cand, seatId, pub, keyEpoch, fromSeq, ah] = a;
  if (a.length !== 10 || tag !== 'bind' || !str(exam) || !str(shift) || !nat(attempt) || !str(cand) || !str(seatId)
    || typeof pub !== 'string' || !PUB.test(pub) || !nat(keyEpoch) || keyEpoch < 1 || !nat(fromSeq) || typeof ah !== 'string' || !HEX64.test(ah))
    throw new Error('bind: bad shape');
  return { exam, shift, attempt, cand, seatId, pub, keyEpoch, fromSeq, attestHash: ah };
}

/** What a seat sends to enrol (non-normative JSON): the bind fields and its PIN record sealed to the cell, as hex. */
export interface BindReq extends Bind { pinBox: string }
/** A binding on the wire: the cell's certificate (its exact canonical text), the signing cell and the sealed PIN record. */
export interface WireBind { cert: string; sig: string; cell: string; pinBox: string }

/** Verify a binding against the cell's public key and return it. Throws on any fault. */
export function checkWireBind(wb: WireBind, cellPub: Uint8Array, mk: (pub: Uint8Array) => Verify = nobleVerifier): Bind {
  if (typeof wb?.cert !== 'string' || typeof wb.sig !== 'string' || !SIG.test(wb.sig)) throw new Error('bind: bad shape');
  const b = bindFromArray(parseCanon(wb.cert));
  if (!mk(cellPub)(utf8(wb.cert), hexToBytes(wb.sig))) throw new Error('bind: the cell signature does not verify');
  return b;
}

export const SCRYPT = { N: 16384, r: 8, p: 1, dkLen: 32 } as const;
export const isPin = (s: string): boolean => /^[0-9]{6}$/.test(s);
const PIN_RECORD = /^\["pin","[0-9a-f]{32}",16384,8,1,"[0-9a-f]{64}"\]$/;
export const isPinRecord = (text: string): boolean => PIN_RECORD.test(text);
/** B.5: canon(["pin", salt hex, N, r, p, scrypt(UTF-8(pin), salt) hex]). */
export function pinRecord(pin: string, salt: Uint8Array = randomBytes(16)): string {
  if (!isPin(pin)) throw new Error('the PIN must be exactly 6 digits');
  if (salt.length !== 16) throw new Error('the PIN salt is 16 bytes');
  return canon(['pin', toHex(salt), SCRYPT.N, SCRYPT.r, SCRYPT.p, toHex(scrypt(utf8(pin), salt, SCRYPT))]);
}
/** Stage 4 (handover by PIN) uses this; Stage 3 tests prove the record matches the PIN. */
export function checkPin(record: string, pin: string): boolean {
  if (!isPinRecord(record)) throw new Error('not a PIN record');
  const [, salt, , , , hash] = parseCanon(record) as [string, string, number, number, number, string];
  return isPin(pin) && toHex(scrypt(utf8(pin), hexToBytes(salt), SCRYPT)) === hash;
}

export const pinInfo = (b: Ctx & { seatId: string }): Canon[] => ['saakshi-pin', 1, b.exam, b.shift, b.attempt, b.cand, b.seatId];
export function makeBindReq(b: Bind, cellPub: Uint8Array, pinRec: string, k: BoxKeys = nobleBox): BindReq {
  return { ...b, pinBox: toHex(sealBox(cellPub, pinInfo(b), utf8(pinRec), k)) };
}
/** Cell: open a seat's PIN box. Throws unless it holds a well-formed PIN record. */
export function openPinBox(cellPriv: Uint8Array, b: Ctx & { seatId: string; pinBox: string }, k: BoxKeys = nobleBox): string {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(openBox(cellPriv, pinInfo(b), hexToBytes(b.pinBox), k));
  if (!isPinRecord(text)) throw new Error('pin box: not a PIN record');
  return text;
}
