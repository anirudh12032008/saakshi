import { utf8 } from './bytes.ts';
import { canon, type Canon } from './canon.ts';
import type { Ctx } from './protocol.ts';

export interface Ack extends Ctx { keyEpoch: number; seq: number; h: string }

/** Reserved in protocol-v1 §5. */
export const ackArray = (a: Ack): Canon[] => ['ack', a.exam, a.shift, a.attempt, a.cand, a.keyEpoch, a.seq, a.h];

/**
 * The signed message. §5 names no domain byte for acks, so the cell signs the canonical UTF-8 alone;
 * the 'ack' tag keeps it apart from entry messages, which start with 0x02. (Flagged for the protocol doc.)
 */
export const ackMessage = (a: Ack): Uint8Array => utf8(canon(ackArray(a)));
