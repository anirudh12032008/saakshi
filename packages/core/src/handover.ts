// Addendum C (Stage 4): moving a candidate to another seat. The old key's signed claim, or the candidate's PIN sealed to the cell
// plus the invigilator's approval; the cell's keyEpoch E+1 bind certificate and its signed grant; the answers restored sealed to the
// new seat's key. Also the cell key certificate check /verify uses, epochAt, and the purge order. Browser-safe: seat and server pass
// nativeBox / verifier from node.ts.
import { sha256 } from '@noble/hashes/sha2.js';
import { hexToBytes, toHex, utf8 } from './bytes.ts';
import { nobleBox, openBox, sealBox, type BoxKeys } from './box.ts';
import { canon, parseCanon, type Canon } from './canon.ts';
import { cellKeyArray, cellKeyId, checkWireBind, isP256Pub, msg, type Bind, type WireBind } from './enrol.ts';
import { STATES, type Body, type Ctx, type Response, type State } from './protocol.ts';
import { nobleVerifier, type Verify } from './sig.ts';

const HEX64 = /^[0-9a-f]{64}$/, SIG = /^[0-9a-f]{128}$/, PIN = /^[0-9]{6}$/;
const text = (b: Uint8Array): string => new TextDecoder('utf-8', { fatal: true }).decode(b);

/** C.2 — signed by the key of `keyEpoch`, the OLD epoch. */
export interface HandoverClaim extends Ctx { keyEpoch: number; fromSeq: number; fromHead: string; newPub: string }
export const handoverArray = (h: HandoverClaim): Canon[] => ['handover', h.exam, h.shift, h.attempt, h.cand, h.keyEpoch, h.fromSeq, h.fromHead, h.newPub];

/** C.5 — signed by the cell. `keyEpoch` is the NEW epoch. */
export interface Grant extends Ctx { keyEpoch: number; fromSeq: number; fromHead: string; activeMs: number; creditedMs: number; respHash: string }
export const grantArray = (g: Grant): Canon[] =>
  ['grant', g.exam, g.shift, g.attempt, g.cand, g.keyEpoch, g.fromSeq, g.fromHead, g.activeMs, g.creditedMs, g.respHash];

const respText = (rs: Response[]): string => canon(['responses', rs.map((r) => [r[0], r[1], r[2]])]);
export const respHash = (rs: Response[]): string => toHex(sha256(utf8(respText(rs))));
export const restoreInfo = (c: Ctx, keyEpoch: number, fromSeq: number): Canon[] => ['saakshi-restore', 1, c.exam, c.shift, c.attempt, c.cand, keyEpoch, fromSeq];
export const handoverPinInfo = (c: Ctx, seatId: string, newPub: string): Canon[] => ['saakshi-handover-pin', 1, c.exam, c.shift, c.attempt, c.cand, seatId, newPub];

export function sealRestore(newPub: Uint8Array, c: Ctx, keyEpoch: number, fromSeq: number, rs: Response[], k: BoxKeys = nobleBox): string {
  return toHex(sealBox(newPub, restoreInfo(c, keyEpoch, fromSeq), utf8(respText(rs)), k));
}
export function openRestore(priv: Uint8Array, c: Ctx, keyEpoch: number, fromSeq: number, box: string, k: BoxKeys = nobleBox): Response[] {
  const a = parseCanon(text(openBox(priv, restoreInfo(c, keyEpoch, fromSeq), hexToBytes(box), k)));
  if (a.length !== 2 || a[0] !== 'responses' || !Array.isArray(a[1])) throw new Error('restore: not a responses list');
  return (a[1] as Canon[]).map((r): Response => {
    if (!Array.isArray(r) || r.length !== 3 || typeof r[0] !== 'string' || typeof r[2] !== 'string' || !(STATES as readonly string[]).includes(r[1] as string))
      throw new Error('restore: bad row');
    return [r[0], r[1] as State, r[2]];
  });
}

export function sealHandoverPin(cellPub: Uint8Array, c: Ctx, seatId: string, newPub: string, pin: string, k: BoxKeys = nobleBox): string {
  if (!PIN.test(pin)) throw new Error('the PIN must be exactly 6 digits');
  return toHex(sealBox(cellPub, handoverPinInfo(c, seatId, newPub), utf8(pin), k));
}
export function openHandoverPin(cellPriv: Uint8Array, c: Ctx, seatId: string, newPub: string, box: string, k: BoxKeys = nobleBox): string {
  const pin = text(openBox(cellPriv, handoverPinInfo(c, seatId, newPub), hexToBytes(box), k));
  if (!PIN.test(pin)) throw new Error('handover: the box does not hold a PIN');
  return pin;
}

export type HandoverProof = { via: 'pin'; pin: string } | { via: 'key'; keyEpoch: number; fromSeq: number; fromHead: string; sig: string };
/** Seat → relay → cell. pinBox: the new seat's B.5 record sealed to the cell (it carries the PIN to the next move). */
export interface HandoverReq extends Ctx { seatId: string; pub: string; attestHash: string; pinBox: string; proof: HandoverProof }
export interface HandoverApproval { by: string; at: number }
export interface HandoverGrant { bind: WireBind; grant: Grant; sig: string; restore: string; via: 'pin' | 'key'; approvedBy: string }

/** The new seat's check (C.5). Throws on any fault; returns the restored answers. */
export function checkGrant(g: HandoverGrant, want: Ctx & { seatId: string; pub: string }, cellPub: Uint8Array, seatPriv: Uint8Array,
  mk: (pub: Uint8Array) => Verify = nobleVerifier, k: BoxKeys = nobleBox): { bind: Bind; grant: Grant; responses: Response[] } {
  const bind = checkWireBind(g.bind, cellPub, mk);
  for (const f of ['exam', 'shift', 'attempt', 'cand', 'seatId', 'pub'] as const) if (bind[f] !== want[f]) throw new Error(`grant: the certificate's ${f} is not this seat's`);
  const gr = g.grant;
  if (!gr || gr.exam !== bind.exam || gr.shift !== bind.shift || gr.attempt !== bind.attempt || gr.cand !== bind.cand || gr.keyEpoch !== bind.keyEpoch || gr.fromSeq !== bind.fromSeq)
    throw new Error('grant: it does not match the certificate');
  if (!HEX64.test(gr.fromHead ?? '') || !HEX64.test(gr.respHash ?? '') || !SIG.test(g.sig ?? '') || !mk(cellPub)(msg(grantArray(gr)), hexToBytes(g.sig)))
    throw new Error('grant: the cell signature does not verify');
  const responses = openRestore(seatPriv, want, gr.keyEpoch, gr.fromSeq, g.restore, k);
  if (respHash(responses) !== gr.respHash) throw new Error('grant: the restored answers do not match the signed hash');
  return { bind, grant: gr, responses };
}

/** C.1 — a B.2 cell key certificate, as a proof carries it. Returns the cell's public key; throws unless the authority signed it. */
export interface CellCert { id: string; keyId: string; pub: string; cert: string }
export function checkCellCert(c: CellCert, exam: string, authority: Verify): Uint8Array {
  if (typeof c?.id !== 'string' || typeof c.pub !== 'string' || !isP256Pub(c.pub) || typeof c.cert !== 'string' || !SIG.test(c.cert)) throw new Error('cell certificate: bad shape');
  const pub = hexToBytes(c.pub);
  if (cellKeyId(pub) !== c.keyId) throw new Error(`cell certificate: keyId does not match ${c.id}'s key`);
  if (!authority(msg(cellKeyArray({ exam, cellId: c.id, keyId: c.keyId, pub: c.pub })), hexToBytes(c.cert))) throw new Error(`cell certificate: ${c.id} is not certified by the exam authority`);
  return pub;
}

/** C.4 — the epoch that signs `seq`: the highest keyEpoch whose fromSeq < seq. */
export interface Epoch { keyEpoch: number; fromSeq: number }
export function epochAt(epochs: Epoch[], seq: number): number | undefined {
  let e: number | undefined;
  for (const x of epochs) if (x.fromSeq < seq && (e === undefined || x.keyEpoch > e)) e = x.keyEpoch;
  return e;
}

/** What a cell knows about one stream when it grants a move (Stage 4 contract; ingest implements it). */
export interface StreamSnap { head: number; headH: string; activeMs: number; pending: number; submitted: boolean; bodies: Body[]; rxAt(seq: number): number }

/** C.10 — authority-signed; a relay deletes a shift's entries only on one. */
export interface PurgeOrder { exam: string; shift: string; sthId: string; ts: number }
export const purgeArray = (p: PurgeOrder): Canon[] => ['purge', p.exam, p.shift, p.sthId, p.ts];
