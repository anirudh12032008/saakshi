import { randomBytes } from '@saakshi/core/bytes';
import type { Canon } from '@saakshi/core/canon';
import { signedLine } from '@saakshi/core/journal';
import { responsesOf } from '@saakshi/core/log';
import { sealBody, signer, verifier, type KeyPair } from '@saakshi/core/node';
import { counts, finalHash, receiptCode, type Body, type Ctx, type Header, type Kind, type Response, type State } from '@saakshi/core/protocol';
import { toB64, type WireEntry } from '@saakshi/core/wire';
import type { Action, ActResult, ItemState, Receipt, SubmitResult } from '../shared/ipc.ts';
import { SeatJournal, type Wrapper } from './journal-store.ts';
import { TEST_MODE_NOTE } from './keystore.ts';
import type { SyncSource } from './sync.ts';

/** Addendum C.5–C.6: where a moved candidate's chain continues, what the exam server restored, and how the move happened. */
export interface Restore { seq: number; head: string; activeMs: number; responses: Response[]; via: 'pin' | 'key'; creditedMs: number }
export type PauseCause = 'suspend' | 'lock-screen';

export interface SessionOpts {
  dir: string; ctx: Ctx; keyEpoch: number; seat: KeyPair; cellPub: Uint8Array; wrap: Wrapper;
  durationMs: number; items: readonly string[];
  /** The candidate's form (F1/F2) — goes into the submit's meta. */
  form: string;
  /** The candidate's pseudonym (Addendum A.4) — goes into receipt B. */
  pseud: string;
  clock?: () => number;
  /** Wall clock, for how long a pause lasted (Addendum C.9). */
  wall?: () => number;
  /** DEV test keystore in use: journal it at unlock (never silent). */
  testMode?: boolean;
  /** Stage 4: continue a moved candidate's chain (keyEpoch is the new epoch). */
  restore?: Restore;
}

export const IDLE_MS = 60_000;
const OPTIONS = ['A', 'B', 'C', 'D'];
const EMPTY: Body = { item: '', state: '', answer: '', meta: [] };

/** One candidate's exam on this seat: builds, signs and seals entries, keeps the active-time clock, and computes the receipt. */
export class ExamSession implements SyncSource {
  readonly ctx: Ctx;
  readonly journal: SeatJournal;
  /** The journal already held entries when this session opened: the app restarted mid-exam. */
  readonly resumed: boolean;
  #o: SessionOpts;
  #sign: (m: Uint8Array) => Uint8Array;
  #clock: () => number;
  #wall: () => number;
  #activeBase = 0;
  #monoBase = 0;
  #runStart: number;
  #lastEntryAt: number;
  #lastActive = 0;
  #restored: Body[];
  #paused?: { at: number; wall: number; cause: PauseCause };

  constructor(o: SessionOpts) {
    this.#o = o;
    this.ctx = o.ctx;
    this.#clock = o.clock ?? (() => performance.now());
    this.#wall = o.wall ?? Date.now;
    this.#sign = signer(o.seat);
    const r = o.restore;
    this.journal = SeatJournal.open(o.dir, o.ctx, o.wrap, verifier(o.seat.pub), r && { seq: r.seq, head: r.head });
    this.#restored = (r?.responses ?? []).map(([item, state, answer]): Body => ({ item, state, answer, meta: [] }));
    this.resumed = this.journal.recs.length > 0;
    this.#runStart = this.#lastEntryAt = this.#clock();
    const last = this.journal.headers.at(-1);
    // Resume: time between the last entry and the crash is not charged (at most IDLE_MS, thanks to idle entries).
    if (last) { this.#activeBase = this.#lastActive = last.activeMs; this.#monoBase = last.tMonoMs; }
    else if (r) this.#activeBase = this.#lastActive = r.activeMs;
    // Addendum C.6: a new key epoch starts with a handover entry that says how the candidate got here.
    if (r && r.seq > 0 && !this.resumed) this.#append('handover', { ...EMPTY, meta: [r.via, r.seq, r.creditedMs] });
  }

  get started(): boolean { return this.journal.head > 0; }
  get submitted(): boolean { return this.journal.headers.at(-1)?.kind === 'submit'; }
  get paused(): boolean { return !!this.#paused; }
  /** Active time (plan §3.6): monotonic within this key epoch, frozen while the OS has the seat suspended or locked. */
  activeMs(): number {
    if (!this.started) return 0;
    const t = this.#paused ? this.#paused.at : this.#clock();
    return (this.#lastActive = Math.max(this.#lastActive, this.#activeBase + Math.round(t - this.#runStart)));
  }
  remainingMs(): number { return Math.max(0, this.#o.durationMs - this.activeMs()); }

  items(): Record<string, ItemState> {
    const out: Record<string, ItemState> = {}, base = this.journal.base;
    for (const b of this.#restored) out[b.item] = { state: b.state as State, answer: b.answer, seq: base };
    this.journal.recs.forEach((r, i) => { if (r.body.item) out[r.body.item] = { state: r.body.state as State, answer: r.body.answer, seq: base + i + 1 }; });
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

  /** Close the chain (Addendum A.5) over the restored answers and this seat's own. Works offline; idempotent; allowed after time is up. */
  submit(): SubmitResult {
    if (this.submitted) return { ok: true, receipt: this.receipt()! };
    if (!this.started) return { ok: false, error: 'exam not started' };
    const responses = responsesOf(this.#o.items, this.#bodies());
    this.#append('submit', { item: '', state: '', answer: '', meta: [this.#o.form, finalHash(this.ctx, this.#o.form, responses)] });
    return { ok: true, receipt: this.receipt()! };
  }

  /** The receipt, recomputed from the journal (so it survives a restart); undefined until submitted. */
  receipt(): Receipt | undefined {
    if (!this.submitted) return undefined;
    const n = this.journal.head;
    const [form, fh] = this.journal.recAt(n)!.body.meta as [string, string];
    const c = counts(responsesOf(this.#o.items, this.#bodies().slice(0, -1)));
    const h = this.journal.hashAt(n);
    const code = receiptCode({ exam: this.ctx.exam, shift: this.ctx.shift, attempt: this.ctx.attempt, pseud: this.#o.pseud, seq: n, h, finalHash: fh, ...c });
    return { exam: this.ctx.exam, shift: this.ctx.shift, cand: this.ctx.cand, form, code, seq: n, h, finalHash: fh, ...c, total: this.#o.items.length };
  }

  /** The OS suspended the seat or locked the screen: the active clock stops (plan §3.6). */
  pause(cause: PauseCause): void {
    if (!this.started || this.submitted || this.#paused) return;
    this.#paused = { at: this.#clock(), wall: this.#wall(), cause };
  }
  /** Back: the pause is journaled as a gap (Addendum C.9) with the wall time it lasted. Returns the gap's seq. */
  resume(): number | undefined {
    const p = this.#paused;
    if (!p) return undefined;
    this.activeMs();                                              // pin lastActive at the pause
    this.#paused = undefined;
    this.#runStart += this.#clock() - p.at;                       // the pause is not active time
    return this.#append('gap', { ...EMPTY, meta: [p.cause, Math.max(0, Math.round(this.#wall() - p.wall))] });
  }
  /** After an app restart mid-exam: journal the gap (its length is measured by the relay's clock, Addendum C.9). */
  restartGap(): number | undefined {
    if (!this.started || this.submitted || this.#paused) return undefined;
    return this.#append('gap', { ...EMPTY, meta: ['restart', 0] });
  }

  /** Called every few seconds: checkpoints activeMs with an idle entry after 60 s of silence. */
  tick(): void {
    if (this.started && !this.submitted && !this.#paused && this.remainingMs() > 0 && this.#clock() - this.#lastEntryAt >= IDLE_MS) this.#append('idle', EMPTY);
  }

  head(): number { return this.journal.head; }
  hashAt(seq: number): string { return this.journal.hashAt(seq); }
  entriesAfter(after: number, limit: number): WireEntry[] {
    const from = Math.max(0, after - this.journal.base);        // ponytail: a relay that knows less than the base (a spare after a move) cannot be refilled from here
    return this.journal.recs.slice(from, from + limit).map((r) => ({ line: r.line, env: toB64(r.env) }));
  }
  close(): void { this.journal.close(); }

  #bodies(): Body[] { return [...this.#restored, ...this.journal.recs.map((r) => r.body)]; }

  #check(a: Action): string {
    if (this.submitted) return 'exam submitted';
    if (!this.started) return 'exam not started';
    if (this.#paused) return 'the exam is paused';
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
    const prev = this.journal.hashAt(seq - 1);                   // the genesis at seq 1; the grant's head after a move
    const salt = randomBytes(16);
    const { envelope, bodyCommit } = sealBody(this.#o.cellPub, { ...this.ctx, seq }, salt, body);
    const now = this.#clock();
    const header: Header = { ...this.ctx, keyEpoch: this.#o.keyEpoch, seq, prev, kind, tMonoMs: this.#monoBase + Math.round(now - this.#runStart), activeMs: this.activeMs(), bodyCommit };
    this.journal.append({ line: signedLine(header, this.#sign), env: envelope, salt, body });
    this.#lastEntryAt = now;
    return seq;
  }
}
