import { randomBytes } from '@saakshi/core/bytes';
import type { Canon } from '@saakshi/core/canon';
import { signedLine } from '@saakshi/core/journal';
import { responsesOf } from '@saakshi/core/log';
import { sealBody, signer, verifier, type KeyPair } from '@saakshi/core/node';
import { counts, finalHash, genesisPrev, receiptCode, type Body, type Ctx, type Header, type Kind, type State } from '@saakshi/core/protocol';
import { toB64, type WireEntry } from '@saakshi/core/wire';
import type { Action, ActResult, ItemState, Receipt, SubmitResult } from '../shared/ipc.ts';
import { SeatJournal, type Wrapper } from './journal-store.ts';
import { TEST_MODE_NOTE } from './keystore.ts';
import type { SyncSource } from './sync.ts';

export interface SessionOpts {
  dir: string; ctx: Ctx; keyEpoch: number; seat: KeyPair; cellPub: Uint8Array; wrap: Wrapper;
  durationMs: number; items: readonly string[];
  /** The candidate's form (F1/F2) — goes into the submit's meta. */
  form: string;
  /** The candidate's pseudonym (Addendum A.4) — goes into receipt B. DEV: devPseud(cand). */
  pseud: string;
  clock?: () => number;
  /** DEV test keystore in use: journal it at unlock (never silent). */
  testMode?: boolean;
}

export const IDLE_MS = 60_000;
const OPTIONS = ['A', 'B', 'C', 'D'];
const EMPTY: Body = { item: '', state: '', answer: '', meta: [] };

/** One candidate's exam on this seat: builds, signs and seals entries, and keeps the active-time clock, and computes the receipt. */
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
  get submitted(): boolean { return this.journal.headers.at(-1)?.kind === 'submit'; }
  activeMs(): number { return this.started ? this.#activeBase + Math.round(this.#clock() - this.#runStart) : 0; }
  remainingMs(): number { return Math.max(0, this.#o.durationMs - this.activeMs()); }

  items(): Record<string, ItemState> {
    const out: Record<string, ItemState> = {};
    this.journal.recs.forEach((r, i) => { if (r.body.item) out[r.body.item] = { state: r.body.state as State, answer: r.body.answer, seq: i + 1 }; });
    return out;
  }

  /** Unlock: meta is [form, kc_f, via] (Addendum B.9). Idempotent. In test mode an integrity entry follows at once. */
  start(meta: Canon[] = []): ActResult {
    if (this.started) return { ok: true, seq: 1, activeMs: this.activeMs() };
    this.#runStart = this.#clock();
    this.#append('unlock', { ...EMPTY, meta });
    // ponytail: a crash between these two appends leaves no integrity entry; the banner and the chain's first entries still show it.
    if (this.#o.testMode) this.#append('integrity', { ...EMPTY, meta: ['test-mode', TEST_MODE_NOTE] });
    return { ok: true, seq: 1, activeMs: 0 };
  }

  act(a: Action): ActResult {
    const error = this.#check(a);
    if (error) return { ok: false, error };
    const seq = this.#append(a.kind, { item: a.item, state: a.state, answer: a.answer, meta: [Math.max(0, Math.round(a.dwellMs)), []] });
    return { ok: true, seq, activeMs: this.activeMs() };
  }

  /**
   * Close the chain (Addendum A.5): meta [form, finalHash] over every item of the form. Works offline — the receipt
   * comes from this seat's own journal. Idempotent: after a submit it returns the same receipt. Allowed after time is up.
   */
  submit(): SubmitResult {
    if (this.submitted) return { ok: true, receipt: this.receipt()! };
    if (!this.started) return { ok: false, error: 'exam not started' };
    const responses = responsesOf(this.#o.items, this.journal.recs.map((r) => r.body));
    this.#append('submit', { item: '', state: '', answer: '', meta: [this.#o.form, finalHash(this.ctx, this.#o.form, responses)] });
    return { ok: true, receipt: this.receipt()! };
  }

  /** The receipt, recomputed from the journal (so it survives a restart); undefined until submitted. */
  receipt(): Receipt | undefined {
    if (!this.submitted) return undefined;
    const n = this.journal.head;
    const [form, fh] = this.journal.recs[n - 1].body.meta as [string, string];
    const c = counts(responsesOf(this.#o.items, this.journal.recs.slice(0, n - 1).map((r) => r.body)));
    const h = this.journal.hashAt(n);
    const code = receiptCode({ exam: this.ctx.exam, shift: this.ctx.shift, attempt: this.ctx.attempt, pseud: this.#o.pseud, seq: n, h, finalHash: fh, ...c });
    return { exam: this.ctx.exam, shift: this.ctx.shift, cand: this.ctx.cand, form, code, seq: n, h, finalHash: fh, ...c, total: this.#o.items.length };
  }

  /** Called every few seconds: checkpoints activeMs with an idle entry after 60 s of silence. */
  tick(): void {
    if (this.started && !this.submitted && this.remainingMs() > 0 && this.#clock() - this.#lastEntryAt >= IDLE_MS) this.#append('idle', EMPTY);
  }

  head(): number { return this.journal.head; }
  hashAt(seq: number): string { return this.journal.hashAt(seq); }
  entriesAfter(after: number, limit: number): WireEntry[] {
    return this.journal.recs.slice(after, after + limit).map((r) => ({ line: r.line, env: toB64(r.env) }));
  }
  close(): void { this.journal.close(); }

  #check(a: Action): string {
    if (this.submitted) return 'exam submitted';
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
