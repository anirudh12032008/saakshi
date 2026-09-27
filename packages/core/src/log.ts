import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { toHex, utf8 } from './bytes.ts';
import { canon, type Canon } from './canon.ts';
import { leafHash } from './merkle.ts';
import { leafArray, receiptArray, type Body, type ReceiptIn, type Response } from './protocol.ts';

/** Signed tree head, protocol-v1 §5 layout with Addendum A.2 field types. */
export interface Sth { exam: string; shift: string; size: number; root: string; prevSTH: string; ts: number }
export interface SignedSth { sth: Sth; sig: string }
export interface Leaf { exam: string; shift: string; attempt: number; pseud: string; h: string; finalHash: string }

export const NO_PREV_STH = '0'.repeat(64);
export const sthArray = (s: Sth): Canon[] => ['sth', s.exam, s.shift, s.size, s.root, s.prevSTH, s.ts];
/** Addendum A.1: non-entry structures sign their canonical UTF-8 with no domain byte. */
export const sthMessage = (s: Sth): Uint8Array => utf8(canon(sthArray(s)));
/** What the next STH's prevSTH holds. */
export const sthId = (s: Sth): string => toHex(sha256(sthMessage(s)));
/** The message a cell signs to countersign receipt B (Addendum A.1). */
export const receiptMessage = (r: ReceiptIn): Uint8Array => utf8(canon(receiptArray(r)));
export const leafHashHex = (l: Leaf): string => toHex(leafHash(utf8(canon(leafArray(l)))));
/** Addendum A.4: pseud = hex(HMAC-SHA256(K_pseud, UTF-8(roll))). */
export const pseudOf = (key: Uint8Array, roll: string): string => toHex(hmac(sha256, key, utf8(roll)));

/**
 * Addendum A.5 replay: for every item of the form, the state and answer of the last body naming it,
 * or NV when none does. Bodies with item '' (unlock, idle, submit…) are skipped. Seat, cell and /verify all use this.
 */
export function responsesOf(form: readonly string[], bodies: readonly Body[]): Response[] {
  const last = new Map<string, Response>();
  for (const b of bodies) {
    if (!b.item) continue;
    if (!form.includes(b.item)) throw new Error(`item ${b.item} is not in the form`);
    if (b.state === '') throw new Error(`item ${b.item} has no state`);
    last.set(b.item, [b.item, b.state, b.answer]);
  }
  return form.map((i) => last.get(i) ?? [i, 'NV', '']);
}
