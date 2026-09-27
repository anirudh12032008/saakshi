import { hexToBytes } from './bytes.ts';
import type { KeyPair } from './node.ts';

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
