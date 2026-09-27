import { sha256 } from '@noble/hashes/sha2.js';
import { hexToBytes, utf8 } from './bytes.ts';
import { pseudOf } from './log.ts';
import type { KeyPair } from './node.ts';
import type { Trust } from './sheet.ts';

/** Shape of fixtures/keys.json. DEMO KEYS — published in the repo. */
export interface KeysFile {
  authority: { priv: string; pub: string };
  cells: { id: string; priv: string; pub: string }[];
  seats: { seatId: string; priv: string; pub: string }[];
}

export const DEV_EXAM = { exam: 'DEMO-2026', shift: 'S1', attempt: 1 } as const;

const index = (cand: string): number => { const m = /^C(\d{4})$/.exec(cand); return m ? Number(m[1]) - 1 : -1; };
const pair = (x: { priv: string; pub: string }): KeyPair => ({ priv: hexToBytes(x.priv), pub: hexToBytes(x.pub) });

/** DEV roster until Stage 3 enrolment: candidate C000n signs with seats[n-1]. */
export function devSeat(keys: KeysFile, cand: string): (KeyPair & { seatId: string }) | undefined {
  const s = keys.seats[index(cand)];
  return s && { seatId: s.seatId, ...pair(s) };
}

/** The key a relay or cell trusts for (cand, keyEpoch). DEV: epoch 1 only. */
export const devSeatKey = (keys: KeysFile) => (cand: string, keyEpoch: number): Uint8Array | undefined =>
  keyEpoch === 1 ? devSeat(keys, cand)?.pub : undefined;

/** Cell keys live in the keys file, never in the cell DB, so acks stay valid after a rebuild. */
export function cellKey(keys: KeysFile, id: string): KeyPair & { id: string } {
  const c = keys.cells.find((x) => x.id === id);
  if (!c) throw new Error(`no cell key ${id}`);
  return { id, ...pair(c) };
}

export const devForm = (cand: string): 'F1' | 'F2' => (index(cand) % 2 === 0 ? 'F1' : 'F2');

/** DEV K_pseud (Addendum A.4). Published, so DEV pseudonyms are not private; Stage 3 moves the real key to control. */
export const DEV_PSEUD_KEY: Uint8Array = sha256(utf8('saakshi-dev-pseud'));
export const devPseud = (cand: string): string => pseudOf(DEV_PSEUD_KEY, cand);
export const DEV_CENTRE = 'CEN-01';
/** Registered candidates: one per fixture seat key. */
export const devRoster = (keys: KeysFile): string[] => keys.seats.map((_, i) => `C${String(i + 1).padStart(4, '0')}`);

/** The public half of the keys file: what /verify pins. DEV: every seat key is keyEpoch 1. */
export function trustFromKeys(keys: KeysFile): Trust {
  return {
    authority: keys.authority.pub,
    cells: Object.fromEntries(keys.cells.map((c) => [c.id, c.pub])),
    seats: Object.fromEntries(devRoster(keys).map((cand, i) => [`${cand}/1`, keys.seats[i].pub])),
  };
}
