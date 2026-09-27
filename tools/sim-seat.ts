// A scripted seat for server tests, seat sync tests and tools: a valid signed chain for one DEV candidate,
// with every body sealed to the cell exactly as the real seat does it, and the salts and bodies kept so a test
// can build the honest response sheet a cell should export.
import { readFileSync } from 'node:fs';
import { randomBytes, toHex } from '../packages/core/src/bytes.ts';
import { DEV_EXAM, devForm, devPseud, devSeat, type KeysFile } from '../packages/core/src/dev.ts';
import { signedLine } from '../packages/core/src/journal.ts';
import { responsesOf } from '../packages/core/src/log.ts';
import { sealBody, signer } from '../packages/core/src/node.ts';
import { bodyArray, entryHash, finalHash, genesisPrev, type Body, type Ctx, type Header, type Kind } from '../packages/core/src/protocol.ts';
import type { ResponseSheet } from '../packages/core/src/sheet.ts';
import { toB64, type WireEntry } from '../packages/core/src/wire.ts';

export const FORMS = JSON.parse(readFileSync(new URL('../fixtures/paper/forms.json', import.meta.url), 'utf8')) as Record<'F1' | 'F2', string[]>;
export interface Made { entry: WireEntry; header: Header; h: string; salt: Uint8Array; body: Body }

export class SimSeat {
  readonly ctx: Ctx;
  readonly entries: WireEntry[] = [];
  readonly hs: string[] = [];
  readonly headers: Header[] = [];
  readonly salts: Uint8Array[] = [];
  readonly bodies: Body[] = [];
  #sign: (m: Uint8Array) => Uint8Array;
  #pub: Uint8Array;
  #cellPub: Uint8Array;
  #keyEpoch: number;

  constructor(keys: KeysFile, cand: string, cellPub: Uint8Array, keyEpoch = 1) {
    const k = devSeat(keys, cand);
    if (!k) throw new Error(`no DEV seat key for ${cand}`);
    this.ctx = { ...DEV_EXAM, cand };
    this.#sign = signer(k);
    this.#pub = k.pub;
    this.#cellPub = cellPub;
    this.#keyEpoch = keyEpoch;
  }

  get head(): number { return this.hs.length; }
  get #prev(): string { return this.hs.at(-1) ?? genesisPrev(this.ctx); }

  /** Append n entries: an unlock first, then answers cycling through I01…I20. */
  add(n = 1): WireEntry[] {
    const out: WireEntry[] = [];
    for (let i = 0; i < n; i++) { const seq = this.head + 1; out.push(this.#push(this.make(seq, this.#prev, 'ABCD'[seq % 4]))); }
    return out;
  }

  /** Append one entry with an explicit kind and body (a first-visit clear/NA, a mark, a bad submit…). */
  append(kind: Kind, body: Body): WireEntry { return this.#push(this.make(this.head + 1, this.#prev, '', body, kind)); }

  /** Append a submit: meta [form, finalHash] over every item of the form (protocol Addendum A.5). */
  submit(form: 'F1' | 'F2' = devForm(this.ctx.cand)): WireEntry {
    const fh = finalHash(this.ctx, form, responsesOf(FORMS[form], this.bodies));
    return this.append('submit', { item: '', state: '', answer: '', meta: [form, fh] });
  }

  /** The honest response sheet a cell should export for this seat (no receipt: the cell adds that). */
  sheet(form: 'F1' | 'F2' = devForm(this.ctx.cand)): ResponseSheet {
    return {
      ctx: this.ctx, form, pseud: devPseud(this.ctx.cand), keys: [{ keyEpoch: this.#keyEpoch, pub: toHex(this.#pub) }],
      entries: this.entries.map((e, i) => ({ line: e.line, salt: toHex(this.salts[i]), body: bodyArray(this.bodies[i]) })),
    };
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

  make(seq: number, prev: string, answer: string, body?: Body, kind?: Kind): Made {
    const b: Body = body ?? (seq === 1 ? { item: '', state: '', answer: '', meta: [] }
      : { item: `I${String(((seq - 2) % 20) + 1).padStart(2, '0')}`, state: 'A', answer, meta: [1000, []] });
    const salt = randomBytes(16);
    const { envelope, bodyCommit } = sealBody(this.#cellPub, { ...this.ctx, seq }, salt, b);
    const header: Header = { ...this.ctx, keyEpoch: this.#keyEpoch, seq, prev, kind: kind ?? (seq === 1 ? 'unlock' : 'answer'), tMonoMs: seq * 1000, activeMs: seq * 1000, bodyCommit };
    return { entry: { line: signedLine(header, this.#sign), env: toB64(envelope) }, header, h: toHex(entryHash(header)), salt, body: b };
  }

  #push(m: Made): WireEntry {
    this.entries.push(m.entry); this.headers.push(m.header); this.hs.push(m.h); this.salts.push(m.salt); this.bodies.push(m.body);
    return m.entry;
  }
}
