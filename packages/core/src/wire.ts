import { Buffer } from 'node:buffer';
import type { Ctx } from './protocol.ts';
import type { BindReq, WireBind } from './enrol.ts';
import type { HandoverProof, HandoverReq } from './handover.ts';
import type { ReleaseMsg } from './paper.ts';

/** One journal entry on the wire: the §11 signed line, the §8 envelope (padded base64), and — relay → cell only — the relay's rxWall (C.7). */
export interface WireEntry { line: string; env: string; rx?: number }
/** The sender's own head for a stream: a heartbeat and a status request in one. */
export interface Hello extends Ctx { head: number }
/** POST /v1/sync. `replay`/`done` are sent only relay → cell while the cell is REBUILDING. */
export interface SyncReq {
  entries: WireEntry[]; streams: Hello[]; replay?: true; done?: true;
  /** Stage 3: cell-signed bindings — seat → relay on first contact, relay → cell on a REBUILDING replay. Processed before entries. */
  binds?: WireBind[];
  /** Stage 3, relay → cell: how many signed releases the relay already holds for this shift. */
  have?: number;
}
/** A cell signature (hex) over ackMessage({...ctx, keyEpoch, seq, h}) — see ack.ts. */
export interface WireAck { keyEpoch: number; seq: number; h: string; sig: string }
/** head: highest contiguous seq committed here; headH: its h ('' when head = 0); need: a gap was seen, resend from head+1. */
export interface StreamStatus extends Ctx { head: number; headH: string; need: boolean; ack?: WireAck }
export type RejectCode = 'BAD_SUBMISSION' | 'FORK' | 'ORPHANED' | 'LATE';
export interface Rejection { index: number; code: RejectCode; reason: string }
export interface SyncRes { streams: StreamStatus[]; rejected: Rejection[]; /** Stage 3, cell → relay: every release, when the relay has fewer. */ releases?: ReleaseMsg[] }
/** One seat-grid tile. cellHead −1 = not yet known (relay); senderHead −1 = never heard; seenAt = epoch ms of the last hello, 0 = never. */
export interface StreamView extends Ctx {
  head: number; cellHead: number; senderHead: number; seenAt: number;
  /** Stage 4: the chain ends in a submit. */
  submitted?: true;
}
export type NodeState = 'LIVE' | 'REBUILDING';
export interface HeadsRes { mode: 'cell' | 'relay'; state: NodeState; streams: StreamView[] }

export const LIMITS = { entries: 500, streams: 5000, line: 4096, env: 16384, field: 64, pinBox: 2048 } as const;
export const streamKey = (c: Ctx): string => JSON.stringify([c.exam, c.shift, c.attempt, c.cand]);

const B64 = /^[A-Za-z0-9+/]*={0,2}$/;
export const toB64 = (b: Uint8Array): string => Buffer.from(b.buffer, b.byteOffset, b.byteLength).toString('base64');
export function fromB64(s: string): Uint8Array {
  if (s.length % 4 !== 0 || !B64.test(s)) throw new Error('not base64');
  return new Uint8Array(Buffer.from(s, 'base64'));
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const nat = (x: unknown): x is number => Number.isSafeInteger(x) && (x as number) >= 0;
const field = (x: unknown): x is string => typeof x === 'string' && x.length > 0 && x.length <= LIMITS.field;

/** Validate an untrusted POST /v1/sync body; returns a clean copy with only the contract fields. */
export function parseSyncReq(x: unknown): SyncReq {
  if (!isObj(x)) throw new Error('sync: body must be an object');
  const { entries, streams = [], replay, done, binds, have } = x;
  if (!Array.isArray(entries) || entries.length > LIMITS.entries) throw new Error(`sync: entries must be an array of at most ${LIMITS.entries}`);
  if (!Array.isArray(streams) || streams.length > LIMITS.streams) throw new Error(`sync: streams must be an array of at most ${LIMITS.streams}`);
  if (replay !== undefined && replay !== true) throw new Error('sync: replay must be true or absent');
  if (done !== undefined && (done !== true || replay !== true)) throw new Error('sync: done must be true and needs replay');
  const out: SyncReq = {
    entries: entries.map((e, i) => {
      if (!isObj(e) || typeof e.line !== 'string' || e.line.length > LIMITS.line || typeof e.env !== 'string'
        || e.env.length > LIMITS.env || e.env.length % 4 !== 0 || !B64.test(e.env)) throw new Error(`sync: entries[${i}] must be {line, env: base64}`);
      if (e.rx !== undefined && !nat(e.rx)) throw new Error(`sync: entries[${i}].rx must be a count of ms`);
      return e.rx === undefined ? { line: e.line, env: e.env } : { line: e.line, env: e.env, rx: e.rx };
    }),
    streams: streams.map((h, i) => {
      if (!isObj(h) || !field(h.exam) || !field(h.shift) || !nat(h.attempt) || !field(h.cand) || !nat(h.head))
        throw new Error(`sync: streams[${i}] must be {exam, shift, attempt, cand, head}`);
      return { exam: h.exam, shift: h.shift, attempt: h.attempt, cand: h.cand, head: h.head };
    }),
  };
  if (binds !== undefined) {
    if (!Array.isArray(binds) || binds.length > LIMITS.entries) throw new Error(`sync: binds must be an array of at most ${LIMITS.entries}`);
    out.binds = binds.map((b, i) => {
      if (!isObj(b) || typeof b.cert !== 'string' || b.cert.length > LIMITS.line || typeof b.sig !== 'string' || !/^[0-9a-f]{128}$/.test(b.sig)
        || !field(b.cell) || typeof b.pinBox !== 'string' || b.pinBox.length > LIMITS.pinBox || !/^[0-9a-f]*$/.test(b.pinBox)) throw new Error(`sync: binds[${i}] must be {cert, sig, cell, pinBox}`);
      return { cert: b.cert, sig: b.sig, cell: b.cell, pinBox: b.pinBox };
    });
  }
  if (have !== undefined) { if (!nat(have)) throw new Error('sync: have must be a count'); out.have = have; }
  if (replay) out.replay = true;
  if (done) out.done = true;
  return out;
}

/** Validate an untrusted enrolment request (seat → relay → cell); returns a clean copy. */
export function parseBindReq(x: unknown): BindReq {
  if (!isObj(x)) throw new Error('enrol: body must be an object');
  const { exam, shift, attempt, cand, seatId, pub, keyEpoch, fromSeq, attestHash, pinBox } = x;
  if (!field(exam) || !field(shift) || !nat(attempt) || !field(cand) || !field(seatId)) throw new Error('enrol: need exam, shift, attempt, cand, seatId');
  if (typeof pub !== 'string' || !/^04[0-9a-f]{128}$/.test(pub)) throw new Error('enrol: pub must be a 65-byte uncompressed P-256 key in hex');
  if (!nat(keyEpoch) || keyEpoch < 1 || !nat(fromSeq)) throw new Error('enrol: bad keyEpoch or fromSeq');
  if (typeof attestHash !== 'string' || !/^[0-9a-f]{64}$/.test(attestHash)) throw new Error('enrol: attestHash must be 64 hex');
  if (typeof pinBox !== 'string' || pinBox.length > LIMITS.pinBox || !/^[0-9a-f]+$/.test(pinBox)) throw new Error('enrol: pinBox must be hex');
  return { exam, shift, attempt, cand, seatId, pub, keyEpoch, fromSeq, attestHash, pinBox };
}

/** Validate an untrusted handover request (seat → relay → cell, Addendum C.2/C.3); returns a clean copy. */
export function parseHandoverReq(x: unknown): HandoverReq {
  if (!isObj(x)) throw new Error('handover: body must be an object');
  const { exam, shift, attempt, cand, seatId, pub, attestHash, pinBox, proof } = x;
  if (!field(exam) || !field(shift) || !nat(attempt) || !field(cand) || !field(seatId)) throw new Error('handover: need exam, shift, attempt, cand, seatId');
  if (typeof pub !== 'string' || !/^04[0-9a-f]{128}$/.test(pub)) throw new Error('handover: pub must be a 65-byte uncompressed P-256 key in hex');
  if (typeof attestHash !== 'string' || !/^[0-9a-f]{64}$/.test(attestHash)) throw new Error('handover: attestHash must be 64 hex');
  if (typeof pinBox !== 'string' || pinBox.length > LIMITS.pinBox || !/^[0-9a-f]+$/.test(pinBox)) throw new Error('handover: pinBox must be hex');
  let p: HandoverProof;
  if (isObj(proof) && proof.via === 'pin' && typeof proof.pin === 'string' && proof.pin.length <= LIMITS.pinBox && /^[0-9a-f]+$/.test(proof.pin)) p = { via: 'pin', pin: proof.pin };
  else if (isObj(proof) && proof.via === 'key' && nat(proof.keyEpoch) && proof.keyEpoch >= 1 && nat(proof.fromSeq)
    && typeof proof.fromHead === 'string' && /^[0-9a-f]{64}$/.test(proof.fromHead) && typeof proof.sig === 'string' && /^[0-9a-f]{128}$/.test(proof.sig))
    p = { via: 'key', keyEpoch: proof.keyEpoch, fromSeq: proof.fromSeq, fromHead: proof.fromHead, sig: proof.sig };
  else throw new Error('handover: proof must be {via:"pin", pin} or {via:"key", keyEpoch, fromSeq, fromHead, sig}');
  return { exam, shift, attempt, cand, seatId, pub, attestHash, pinBox, proof: p };
}
