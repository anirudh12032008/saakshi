import { randomBytes } from '@saakshi/core/bytes';
import { signedLine } from '@saakshi/core/journal';
import { sealBody, signer, verifier, type KeyPair } from '@saakshi/core/node';
import { genesisPrev, type Body, type Ctx, type Header, type Kind, type State } from '@saakshi/core/protocol';
import { toB64, type WireEntry } from '@saakshi/core/wire';
import type { Action, ActResult, ItemState } from '../shared/ipc.ts';
import { SeatJournal, type Wrapper } from './journal-store.ts';
import type { SyncSource } from './sync.ts';

export interface SessionOpts {
  dir: string; ctx: Ctx; keyEpoch: number; seat: KeyPair; cellPub: Uint8Array; wrap: Wrapper;
  durationMs: number; items: readonly string[]; clock?: () => number;
}

export const IDLE_MS = 60_000;
const OPTIONS = ['A', 'B', 'C', 'D'];
const EMPTY: Body = { item: '', state: '', answer: '', meta: [] };

/** One candidate's exam on this seat: builds, signs and seals entries, and keeps the active-time clock. */
export class ExamSession implements SyncSource {
  readonly ctx: Ctx;
  readonly journal: SeatJournal;
  #o: SessionOpts;
  #sign: (m: Uint8Array) => Uint8Array;
  #clock: () => number;
  #activeBase = 0;
  #monoBase = 0;
  #runStart: number;
  #lastEntryAt: number;

  constructor(o: SessionOpts) {
    this.#o = o;
    this.ctx = o.ctx;
    this.#clock = o.clock ?? (() => performance.now());
    this.#sign = signer(o.seat);
    this.journal = SeatJournal.open(o.dir, o.ctx, o.wrap, verifier(o.seat.pub));
    this.#runStart = this.#lastEntryAt = this.#clock();
    const last = this.journal.headers.at(-1);
    // Resume: time between the last entry and the crash is not charged (at most IDLE_MS, thanks to idle entries).
    if (last) { this.#activeBase = last.activeMs; this.#monoBase = last.tMonoMs; }
  }

  get started(): boolean { return this.journal.head > 0; }
  activeMs(): number { return this.started ? this.#activeBase + Math.round(this.#clock() - this.#runStart) : 0; }
  remainingMs(): number { return Math.max(0, this.#o.durationMs - this.activeMs()); }

  items(): Record<string, ItemState> {
    const out: Record<string, ItemState> = {};
    this.journal.recs.forEach((r, i) => { if (r.body.item) out[r.body.item] = { state: r.body.state as State, answer: r.body.answer, seq: i + 1 }; });
    return out;
  }

  /** Stage 1 unlock: the candidate presses Start (custody release arrives in Stage 3). */
  start(): ActResult {
    if (this.started) return { ok: true, seq: 1, activeMs: this.activeMs() };
    this.#runStart = this.#clock();
    return { ok: true, seq: this.#append('unlock', EMPTY), activeMs: 0 };
  }

  act(a: Action): ActResult {
    const error = this.#check(a);
    if (error) return { ok: false, error };
    const seq = this.#append(a.kind, { item: a.item, state: a.state, answer: a.answer, meta: [Math.max(0, Math.round(a.dwellMs)), []] });
    return { ok: true, seq, activeMs: this.activeMs() };
  }

  /** Called every few seconds: checkpoints activeMs with an idle entry after 60 s of silence. */
  tick(): void {
    if (this.started && this.remainingMs() > 0 && this.#clock() - this.#lastEntryAt >= IDLE_MS) this.#append('idle', EMPTY);
  }

  head(): number { return this.journal.head; }
  hashAt(seq: number): string { return this.journal.hashAt(seq); }
  entriesAfter(after: number, limit: number): WireEntry[] {
    return this.journal.recs.slice(after, after + limit).map((r) => ({ line: r.line, env: toB64(r.env) }));
  }
  close(): void { this.journal.close(); }

  #check(a: Action): string {
    if (!this.started) return 'exam not started';
    if (this.remainingMs() <= 0) return 'time is up';
    if (!this.#o.items.includes(a.item)) return 'unknown item';
    if (!Number.isFinite(a.dwellMs)) return 'bad dwell time';
    const ok = a.kind === 'answer' ? a.state === 'A' && OPTIONS.includes(a.answer)
      : a.kind === 'mark' ? (a.state === 'MR' && a.answer === '') || (a.state === 'AMR' && OPTIONS.includes(a.answer))
      : a.kind === 'clear' ? a.state === 'NA' && a.answer === ''
      : false;
    return ok ? '' : 'action does not match the NTA rules';
  }

  #append(kind: Kind, body: Body): number {
    const seq = this.journal.head + 1;
    const prev = seq === 1 ? genesisPrev(this.ctx) : this.journal.hashAt(seq - 1);
    const salt = randomBytes(16);
    const { envelope, bodyCommit } = sealBody(this.#o.cellPub, { ...this.ctx, seq }, salt, body);
    const now = this.#clock();
    const header: Header = { ...this.ctx, keyEpoch: this.#o.keyEpoch, seq, prev, kind, tMonoMs: this.#monoBase + Math.round(now - this.#runStart), activeMs: this.activeMs(), bodyCommit };
    this.journal.append({ line: signedLine(header, this.#sign), env: envelope, salt, body });
    this.#lastEntryAt = now;
    return seq;
  }
}
