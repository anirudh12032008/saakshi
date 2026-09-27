// The cell's side of a move (plan §3.2, protocol Addendum C.2–C.5). Pure over its inputs: the bindings, one stream's snapshot and a
// clock. Synchronous from the snapshot to issue(), so no sync request interleaves between the head check and the new binding.
import { hexToBytes, toHex } from '@saakshi/core/bytes';
import { checkPin, isP256Pub, msg, openPinBox, type Bind } from '@saakshi/core/enrol';
import { grantArray, handoverArray, openHandoverPin, respHash, sealRestore, type Grant, type HandoverApproval, type HandoverGrant, type HandoverReq, type StreamSnap } from '@saakshi/core/handover';
import { responsesOf } from '@saakshi/core/log';
import { nativeBox, signer, verifier } from '@saakshi/core/node';
import { genesisPrev, type Ctx } from '@saakshi/core/protocol';
import type { Forms } from '@saakshi/core/sheet';
import type { Bindings } from './bindings.ts';

export type HandoverCode = 'NOT_BOUND' | 'BEHIND' | 'AHEAD' | 'SUBMITTED' | 'PIN_WRONG' | 'PIN_LOCKED' | 'BAD';
export type HandoverResult = { ok: true; grant: HandoverGrant } | { ok: false; code: HandoverCode; error: string; left?: number };
export interface CellHandoverOpts {
  exam: string; shift: string; cell: { id: string; pub: Uint8Array; priv: Uint8Array };
  bindings: Bindings; forms: Forms; formOf: (cand: string) => string | undefined;
  stream: (c: Ctx) => StreamSnap | undefined;
  /** One HANDOVER event per new binding (the ingest's note). */
  record: (c: Ctx, seq: number, data: Record<string, string | number>) => void;
  pinTries: number; now?: () => number;
}

export function cellHandover(o: CellHandoverOpts) {
  const now = o.now ?? Date.now, sign = signer(o.cell);
  return (req: HandoverReq, from: { fromSeq: number; fromHead: string } | undefined, approval: HandoverApproval | undefined): HandoverResult => {
    const no = (code: HandoverCode, error: string, left?: number): HandoverResult => ({ ok: false, code, error, ...(left !== undefined ? { left } : {}) });
    if (req.exam !== o.exam || req.shift !== o.shift || req.attempt !== 1) return no('BAD', `this cell moves ${o.exam} ${o.shift} attempt 1 only`);
    if (!isP256Pub(req.pub)) return no('BAD', 'pub is not a P-256 public key');
    const cur = o.bindings.latest(req.cand);
    if (!cur) return no('NOT_BOUND', `${req.cand} has no seat binding at this cell`);
    const prior = o.bindings.grantFor(req.cand, req.pub);
    if (prior) return { ok: true, grant: prior };                                   // the same move again: the same grant
    if (cur.bind.pub === req.pub) return no('BAD', 'this key is already the candidate\'s current seat key');
    let record: string;
    try { record = openPinBox(o.cell.priv, req, nativeBox); } catch { return no('BAD', 'the new seat\'s PIN record does not open with this cell key'); }
    const E = cur.bind.keyEpoch;
    let at: { fromSeq: number; fromHead: string }, via: 'pin' | 'key', approvedBy = '';
    if (req.proof.via === 'key') {
      const p = req.proof;
      if (p.keyEpoch !== E) return no('BAD', `the old-key claim is for keyEpoch ${p.keyEpoch}; the current one is ${E}`);
      const claim = { exam: req.exam, shift: req.shift, attempt: req.attempt, cand: req.cand, keyEpoch: E, fromSeq: p.fromSeq, fromHead: p.fromHead, newPub: req.pub };
      if (!verifier(hexToBytes(cur.bind.pub))(msg(handoverArray(claim)), hexToBytes(p.sig))) return no('BAD', 'the old seat key did not sign this move');
      at = { fromSeq: p.fromSeq, fromHead: p.fromHead }; via = 'key';                  // no human approval: the credited time waits for control
    } else {
      if (!approval?.by) return no('BAD', 'a PIN move needs the invigilator\'s approval');
      if (!from) return no('BAD', 'a PIN move needs the relay\'s fromSeq and fromHead');
      if (o.bindings.pinFailures(req.cand) >= o.pinTries) return no('PIN_LOCKED', 'too many wrong PINs — control must verify the candidate');
      let pin: string;
      try { pin = openHandoverPin(o.cell.priv, req, req.seatId, req.pub, req.proof.pin, nativeBox); } catch { return no('BAD', 'the PIN box does not open with this cell key'); }
      if (!checkPin(openPinBox(o.cell.priv, { ...cur.bind, pinBox: cur.wire.pinBox }, nativeBox), pin)) {
        const n = o.bindings.failPin(req.cand), left = o.pinTries - n;
        return left > 0 ? no('PIN_WRONG', `wrong PIN — ${left} ${left === 1 ? 'try' : 'tries'} left`, left) : no('PIN_LOCKED', 'too many wrong PINs — control must verify the candidate');
      }
      if (!checkPin(record, pin)) return no('BAD', 'the new seat\'s PIN record does not hold the same PIN');
      at = from; via = 'pin'; approvedBy = approval.by;
    }
    const s = o.stream(req);
    const head = s?.head ?? 0, headH = s && head ? s.headH : genesisPrev(req);
    if (s?.submitted) return no('SUBMITTED', `${req.cand} has already submitted`);
    if (at.fromSeq > head || (s?.pending ?? 0) > 0) return no('BEHIND', `the exam server has ${head} of ${at.fromSeq} entries — retry when it catches up`);
    if (at.fromSeq < head) return no('AHEAD', `the exam server already holds ${head} entries; the move must start there`);
    if (at.fromHead !== headH) return no('BAD', 'fromHead is not the exam server\'s head for this candidate');
    const items = o.forms[o.formOf(req.cand) ?? ''];
    if (!items) return no('BAD', `no form for ${req.cand}`);
    let rs;
    try { rs = responsesOf(items, s?.bodies ?? []).filter((r) => r[1] !== 'NV'); } catch (e) { return no('BAD', `cannot replay: ${(e as Error).message}`); }
    const c: Ctx = { exam: req.exam, shift: req.shift, attempt: req.attempt, cand: req.cand };
    const bind: Bind = { ...c, seatId: req.seatId, pub: req.pub, keyEpoch: E + 1, fromSeq: head, attestHash: req.attestHash };
    const grant: Grant = { ...c, keyEpoch: E + 1, fromSeq: head, fromHead: headH, activeMs: s?.activeMs ?? 0,
      creditedMs: head ? Math.max(0, now() - s!.rxAt(head)) : 0, respHash: respHash(rs) };
    const g: HandoverGrant = {
      bind: o.bindings.issue(bind, req.pinBox), grant, sig: toHex(sign(msg(grantArray(grant)))),
      restore: sealRestore(hexToBytes(req.pub), c, E + 1, head, rs, nativeBox), via, approvedBy,
    };
    o.bindings.saveGrant(g);
    o.record(c, head, { keyEpoch: E + 1, fromSeq: head, via, approvedBy, creditedMs: grant.creditedMs, seatId: req.seatId });
    return { ok: true, grant: g };
  };
}
