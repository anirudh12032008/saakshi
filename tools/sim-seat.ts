// A scripted seat for server tests, seat sync tests and tools/chaos-kill.ts: a valid signed chain for one
// DEV candidate, with every body sealed to the cell exactly as the real seat does it.
import { randomBytes, toHex } from '../packages/core/src/bytes.ts';
import { DEV_EXAM, devSeat, type KeysFile } from '../packages/core/src/dev.ts';
import { signedLine } from '../packages/core/src/journal.ts';
import { sealBody, signer } from '../packages/core/src/node.ts';
import { entryHash, genesisPrev, type Body, type Ctx, type Header } from '../packages/core/src/protocol.ts';
import { toB64, type WireEntry } from '../packages/core/src/wire.ts';

export class SimSeat {
  readonly ctx: Ctx;
  readonly entries: WireEntry[] = [];
  readonly hs: string[] = [];
  readonly headers: Header[] = [];
  #sign: (m: Uint8Array) => Uint8Array;
  #cellPub: Uint8Array;
  #keyEpoch: number;

  constructor(keys: KeysFile, cand: string, cellPub: Uint8Array, keyEpoch = 1) {
    const k = devSeat(keys, cand);
    if (!k) throw new Error(`no DEV seat key for ${cand}`);
    this.ctx = { ...DEV_EXAM, cand };
    this.#sign = signer(k);
    this.#cellPub = cellPub;
    this.#keyEpoch = keyEpoch;
  }

  get head(): number { return this.hs.length; }

  /** Append n entries: an unlock first, then answers cycling through I01…I20. */
  add(n = 1): WireEntry[] {
    const out: WireEntry[] = [];
    for (let i = 0; i < n; i++) {
      const seq = this.hs.length + 1;
      const { entry, header, h } = this.make(seq, this.hs.at(-1) ?? genesisPrev(this.ctx), 'ABCD'[seq % 4]);
      this.entries.push(entry); this.headers.push(header); this.hs.push(h); out.push(entry);
    }
    return out;
  }

  /** A validly signed entry at an existing seq with different content — what a forking seat would send. */
  alt(seq: number): WireEntry {
    return this.make(seq, seq === 1 ? genesisPrev(this.ctx) : this.hs[seq - 2], 'Z').entry;
  }

  /** The entries after `acked`, at most `limit` — what a sender resends. */
  after(acked: number, limit = 500): WireEntry[] {
    const from = Math.max(0, acked);
    return this.entries.slice(from, from + limit);
  }

  make(seq: number, prev: string, answer: string, body?: Body): { entry: WireEntry; header: Header; h: string } {
    const b: Body = body ?? (seq === 1 ? { item: '', state: '', answer: '', meta: [] }
      : { item: `I${String(((seq - 2) % 20) + 1).padStart(2, '0')}`, state: 'A', answer, meta: [1000, []] });
    const { envelope, bodyCommit } = sealBody(this.#cellPub, { ...this.ctx, seq }, randomBytes(16), b);
    const header: Header = { ...this.ctx, keyEpoch: this.#keyEpoch, seq, prev, kind: seq === 1 ? 'unlock' : 'answer', tMonoMs: seq * 1000, activeMs: seq * 1000, bodyCommit };
    return { entry: { line: signedLine(header, this.#sign), env: toB64(envelope) }, header, h: toHex(entryHash(header)) };
  }
}
