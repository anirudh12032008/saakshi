import { sha256 } from '@noble/hashes/sha2.js';
import { canon, type Canon } from './canon.ts';
import { concat, crockford80, toHex, utf8 } from './bytes.ts';

export const V = 1;
export const D = { LEAF: 0x00, NODE: 0x01, ENTRY: 0x02, GENESIS: 0x03, BODY: 0x04, RECEIPT: 0x05, FINAL: 0x06, KEYCOMMIT: 0x07 } as const;

/** The exact bytes that get hashed and signed: domain byte ‖ UTF-8 canonical JSON. */
export const tagged = (domain: number, v: Canon[]): Uint8Array => concat(Uint8Array.of(domain), utf8(canon(v)));
export const hashTagged = (domain: number, v: Canon[]): Uint8Array => sha256(tagged(domain, v));

export const KINDS = ['unlock', 'answer', 'clear', 'mark', 'integrity', 'gap', 'handover', 'idle', 'submit'] as const;
export type Kind = (typeof KINDS)[number];
export const STATES = ['NV', 'NA', 'A', 'MR', 'AMR'] as const;
export type State = (typeof STATES)[number];

export interface Ctx { exam: string; shift: string; attempt: number; cand: string }
export interface Header extends Ctx { keyEpoch: number; seq: number; prev: string; kind: Kind; tMonoMs: number; activeMs: number; bodyCommit: string }
/** item/state/answer are '' for entries that are not about an item (unlock, integrity, gap, submit…). */
export interface Body { item: string; state: State | ''; answer: string; meta: Canon[] }
export type Response = [item: string, state: State, answer: string];

const isStr = (x: unknown): x is string => typeof x === 'string';
const isNat = (x: unknown): x is number => typeof x === 'number' && Number.isSafeInteger(x) && x >= 0;
const HEX32 = /^[0-9a-f]{64}$/;

export const headerArray = (h: Header): Canon[] =>
  ['entry', V, h.exam, h.shift, h.attempt, h.cand, h.keyEpoch, h.seq, h.prev, h.kind, h.tMonoMs, h.activeMs, h.bodyCommit];

export function headerFromArray(a: Canon[]): Header {
  if (a.length !== 13 || a[0] !== 'entry' || a[1] !== V) throw new Error('header: bad tag, version or length');
  const [, , exam, shift, attempt, cand, keyEpoch, seq, prev, kind, tMonoMs, activeMs, bodyCommit] = a;
  if (!isStr(exam) || !isStr(shift) || !isNat(attempt) || !isStr(cand) || !isNat(keyEpoch) || !isNat(seq) || !isNat(tMonoMs) || !isNat(activeMs))
    throw new Error('header: bad field type');
  if (!isStr(prev) || !HEX32.test(prev) || !isStr(bodyCommit) || !HEX32.test(bodyCommit)) throw new Error('header: bad hash');
  if (!isStr(kind) || !(KINDS as readonly string[]).includes(kind)) throw new Error('header: bad kind');
  return { exam, shift, attempt, cand, keyEpoch, seq, prev, kind: kind as Kind, tMonoMs, activeMs, bodyCommit };
}

export const entryHash = (h: Header): Uint8Array => hashTagged(D.ENTRY, headerArray(h));
export const genesisPrev = (c: Ctx): string => toHex(hashTagged(D.GENESIS, ['saakshi-genesis', V, c.exam, c.shift, c.attempt, c.cand]));

export const bodyArray = (b: Body): Canon[] => ['body', b.item, b.state, b.answer, b.meta];

export function bodyFromArray(a: Canon[]): Body {
  const [tag, item, state, answer, meta] = a;
  if (a.length !== 5 || tag !== 'body' || !isStr(item) || !isStr(state) || !isStr(answer) || !Array.isArray(meta)) throw new Error('body: bad shape');
  if (state !== '' && !(STATES as readonly string[]).includes(state)) throw new Error('body: bad state');
  return { item, state: state as State | '', answer, meta };
}

export function bodyCommit(salt: Uint8Array, b: Body): string {
  if (salt.length !== 16) throw new Error('salt must be 16 bytes');
  return toHex(sha256(concat(Uint8Array.of(D.BODY), salt, utf8(canon(bodyArray(b))))));
}

export function finalHash(c: Ctx, form: string, responses: Response[]): string {
  const sorted = [...responses].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  for (let i = 1; i < sorted.length; i++) if (sorted[i][0] === sorted[i - 1][0]) throw new Error(`duplicate item ${sorted[i][0]}`);
  return toHex(hashTagged(D.FINAL, ['final', c.exam, c.shift, c.attempt, c.cand, form, sorted]));
}

/** attempted = visited (not NV); answered = A or AMR (NTA evaluates both); marked = MR or AMR. */
export function counts(responses: Response[]): { attempted: number; answered: number; marked: number } {
  let attempted = 0, answered = 0, marked = 0;
  for (const [, s] of responses) {
    if (s !== 'NV') attempted++;
    if (s === 'A' || s === 'AMR') answered++;
    if (s === 'MR' || s === 'AMR') marked++;
  }
  return { attempted, answered, marked };
}

export interface ReceiptIn { exam: string; shift: string; attempt: number; pseud: string; seq: number; h: string; finalHash: string; attempted: number; answered: number; marked: number }
export const receiptArray = (r: ReceiptIn): Canon[] => ['receipt', r.exam, r.shift, r.attempt, r.pseud, r.seq, r.h, r.finalHash, r.attempted, r.answered, r.marked];
export const receiptCode = (r: ReceiptIn): string => crockford80(hashTagged(D.RECEIPT, receiptArray(r)));

export const leafArray = (x: { exam: string; shift: string; attempt: number; pseud: string; h: string; finalHash: string }): Canon[] =>
  ['leaf', x.exam, x.shift, x.attempt, x.pseud, x.h, x.finalHash];

export const kcf = (K: Uint8Array): string => toHex(sha256(concat(Uint8Array.of(D.KEYCOMMIT), K)));
