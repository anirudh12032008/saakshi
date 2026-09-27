import { Buffer } from 'node:buffer';
import type { Ctx } from './protocol.ts';

/** One journal entry on the wire: the protocol §11 signed line, plus the §8 body envelope as standard padded base64. */
export interface WireEntry { line: string; env: string }
/** The sender's own head for a stream: a heartbeat and a status request in one. */
export interface Hello extends Ctx { head: number }
/** POST /v1/sync. `replay`/`done` are sent only relay → cell while the cell is REBUILDING. */
export interface SyncReq { entries: WireEntry[]; streams: Hello[]; replay?: true; done?: true }
/** A cell signature (hex) over ackMessage({...ctx, keyEpoch, seq, h}) — see ack.ts. */
export interface WireAck { keyEpoch: number; seq: number; h: string; sig: string }
/** head: highest contiguous seq committed here; headH: its h ('' when head = 0); need: a gap was seen, resend from head+1. */
export interface StreamStatus extends Ctx { head: number; headH: string; need: boolean; ack?: WireAck }
export type RejectCode = 'BAD_SUBMISSION' | 'FORK';
export interface Rejection { index: number; code: RejectCode; reason: string }
export interface SyncRes { streams: StreamStatus[]; rejected: Rejection[] }
/** One seat-grid tile. cellHead −1 = not yet known (relay); senderHead −1 = never heard; seenAt = epoch ms of the last hello, 0 = never. */
export interface StreamView extends Ctx { head: number; cellHead: number; senderHead: number; seenAt: number }
export type NodeState = 'LIVE' | 'REBUILDING';
export interface HeadsRes { mode: 'cell' | 'relay'; state: NodeState; streams: StreamView[] }

export const LIMITS = { entries: 500, streams: 5000, line: 4096, env: 16384, field: 64 } as const;
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
  const { entries, streams = [], replay, done } = x;
  if (!Array.isArray(entries) || entries.length > LIMITS.entries) throw new Error(`sync: entries must be an array of at most ${LIMITS.entries}`);
  if (!Array.isArray(streams) || streams.length > LIMITS.streams) throw new Error(`sync: streams must be an array of at most ${LIMITS.streams}`);
  if (replay !== undefined && replay !== true) throw new Error('sync: replay must be true or absent');
  if (done !== undefined && (done !== true || replay !== true)) throw new Error('sync: done must be true and needs replay');
  const out: SyncReq = {
    entries: entries.map((e, i) => {
      if (!isObj(e) || typeof e.line !== 'string' || e.line.length > LIMITS.line || typeof e.env !== 'string'
        || e.env.length > LIMITS.env || e.env.length % 4 !== 0 || !B64.test(e.env)) throw new Error(`sync: entries[${i}] must be {line, env: base64}`);
      return { line: e.line, env: e.env };
    }),
    streams: streams.map((h, i) => {
      if (!isObj(h) || !field(h.exam) || !field(h.shift) || !nat(h.attempt) || !field(h.cand) || !nat(h.head))
        throw new Error(`sync: streams[${i}] must be {exam, shift, attempt, cand, head}`);
      return { exam: h.exam, shift: h.shift, attempt: h.attempt, cand: h.cand, head: h.head };
    }),
  };
  if (replay) out.replay = true;
  if (done) out.done = true;
  return out;
}
