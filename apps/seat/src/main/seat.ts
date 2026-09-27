// One seat, start to finish (plan §3.2, §3.3, §3.6): the package → enrolment → the key at T0 → the exam. Electron-free, so tests
// and tools/act2.ts drive it directly; index.ts only wires it to IPC.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { hexToBytes } from '@saakshi/core/bytes';
import { verifier } from '@saakshi/core/node';
import type { ReleaseMsg } from '@saakshi/core/paper';
import { kcf, type Ctx } from '@saakshi/core/protocol';
import type { Action, ActResult, EnrolInput, EnrolResult, ExamBoot, Paper, Phase, SubmitResult, SyncView } from '../shared/ipc.ts';
import { ExamSession } from './exam.ts';
import { httpPost, SeatIdentity } from './identity.ts';
import { writeDurable, type Wrapper } from './journal-store.ts';
import { loadPackage, type SeatPackage } from './pkg.ts';
import { acceptRelease, ReleaseWatcher } from './release.ts';
import { httpSend, SeatSync } from './sync.ts';

export interface SeatOpts {
  dir: string; relayUrl: string; ctx: Ctx; seatId: string; authorityPub: Uint8Array; wrap: Wrapper;
  camera: boolean; testMode: boolean;
  fetch?: typeof fetch; clock?: () => number; now?: () => number; retryMs?: number;
  onBoot?: (b: ExamBoot) => void; onSync?: (v: SyncView) => void;
}
interface Unlocked { form: string; key: string; via: 'push' | 'code' }

export class Seat {
  #o: SeatOpts;
  #base: string;
  #pkg?: SeatPackage;
  #id?: SeatIdentity;
  #unlocked?: Unlocked;
  #paper?: Paper;
  #exam?: ExamSession;
  #sync?: SeatSync;
  #watch?: ReleaseWatcher;
  #notice = '';
  #timer?: ReturnType<typeof setInterval>;
  #busy = false;
  #closed = false;

  constructor(o: SeatOpts) {
    this.#o = o;
    this.#base = join(o.dir, `${o.ctx.exam}_${o.ctx.shift}_${o.ctx.attempt}_${o.ctx.cand}`);
  }

  get exam(): ExamSession | undefined { return this.#exam; }

  async open(): Promise<void> {
    await this.#tryPackage();
    this.#timer = setInterval(() => void this.#tick(), this.#o.retryMs ?? 2000);
  }

  boot(): ExamBoot {
    const p = this.#pkg?.policy, me = p?.roster[this.#o.ctx.cand], e = this.#exam;
    return {
      phase: this.#phase(), cand: this.#o.ctx.cand, seatId: this.#o.seatId, centre: p?.centre ?? '', form: me?.form ?? 'F1',
      durationMs: p && me ? p.durationMs + me.extraMs : 0, activeMs: e?.activeMs() ?? 0, started: e?.started ?? false, items: e?.items() ?? {},
      sync: this.#sync?.view() ?? { local: 0, relay: 0, cell: 0, online: false, error: '', provisional: this.#id?.state !== 'bound' },
      receipt: e?.receipt(), camera: this.#o.camera, testMode: this.#o.testMode,
      bind: this.#id?.state ?? 'none', notice: this.#notice || this.#id?.error || '',
      commitment: this.#pkg?.manifest.forms.find((f) => f.form === me?.form)?.kcf,
      release: this.#unlocked && { via: this.#unlocked.via },
    };
  }

  async enrol(x: EnrolInput): Promise<EnrolResult> {
    if (!this.#id) return { ok: false, error: 'Waiting for the centre server.' };
    const r = await this.#id.enrol(x.pin, { operatorId: x.operatorId, method: x.method });
    this.#openExam();
    this.#emit();
    return r;
  }

  start(): ActResult {
    if (!this.#exam || !this.#unlocked) return { ok: false, error: 'The paper is locked until T0.' };
    const r = this.#exam.start([this.#unlocked.form, kcf(hexToBytes(this.#unlocked.key)), this.#unlocked.via]);
    this.#sync?.kick();
    this.#emit();
    return r;
  }

  act(a: Action): ActResult {
    if (!this.#exam) return { ok: false, error: 'exam not started' };
    const r = this.#exam.act(a);
    if (r.ok) this.#sync?.kick();
    return r;
  }

  submit(): SubmitResult {
    if (!this.#exam) return { ok: false, error: 'exam not started' };
    const r = this.#exam.submit();
    this.#sync?.kick();
    this.#emit();
    return r;
  }

  paper(): Paper | null { return this.#paper ?? null; }

  close(): void {
    this.#closed = true;
    clearInterval(this.#timer);
    this.#watch?.stop();
    this.#sync?.stop();
    this.#exam?.close();
  }

  #phase(): Phase {
    if (!this.#pkg) return 'connecting';
    if (!this.#id?.key) return 'enrol';
    if (!this.#exam) return 'locked';
    if (this.#exam.submitted) return 'submitted';
    return this.#exam.started ? 'exam' : 'ready';
  }

  async #tick(): Promise<void> {
    if (this.#closed || this.#busy) return;
    this.#busy = true;
    try {
      if (!this.#pkg) await this.#tryPackage();
      else if (this.#id?.state === 'provisional') { await this.#id.retry(); if (this.#id.state !== 'provisional') this.#emit(); }
      this.#exam?.tick();
    } finally { this.#busy = false; }
  }

  async #tryPackage(): Promise<void> {
    const { exam, shift, cand } = this.#o.ctx;
    try { this.#pkg = await loadPackage({ path: `${this.#base}.package.json`, relayUrl: this.#o.relayUrl, authorityPub: this.#o.authorityPub, want: { exam, shift, cand }, fetch: this.#o.fetch }); }
    catch (e) { this.#notice = `Waiting for the centre server: ${(e as Error).message}`; this.#emit(); return; }
    this.#notice = '';
    const p = this.#pkg.policy;
    this.#id = SeatIdentity.open({ path: `${this.#base}.identity`, ctx: this.#o.ctx, seatId: this.#o.seatId, wrap: this.#o.wrap,
      cell: { id: p.cell.id, pub: hexToBytes(p.cell.pub) }, post: httpPost(this.#o.relayUrl, 5000, this.#o.fetch), now: this.#o.now });
    const saved = `${this.#base}.release`;
    if (existsSync(saved)) this.#unlock(JSON.parse(this.#o.wrap.decryptString(readFileSync(saved))) as Unlocked);
    this.#watch = new ReleaseWatcher({ relayUrl: this.#o.relayUrl, fetch: this.#o.fetch, retryMs: this.#o.retryMs, onRelease: (r) => this.#onRelease(r) });
    this.#watch.start();
    this.#emit();
  }

  #onRelease(r: ReleaseMsg): void {
    if (r.form !== this.#pkg?.policy.roster[this.#o.ctx.cand]?.form) return;     // the other form's key is not this seat's business
    if (this.#unlocked?.key === r.key) return;                                     // the same key again: reconnect, snapshot, pull, push after code
    this.#unlock({ form: r.form, key: r.key, via: r.via }, r);
  }

  /** B.7 on every path. Without r, this restores a key the seat accepted before a restart. */
  #unlock(u: Unlocked, r?: ReleaseMsg): void {
    const pkg = this.#pkg!;
    const a = acceptRelease(r ?? { exam: pkg.manifest.exam, shift: pkg.manifest.shift, form: u.form, kcf: '', ts: 0, key: u.key, sig: '', via: u.via }, pkg, u.form, this.#o.authorityPub);
    if (!a.ok) { this.#notice = `Rejected a key: ${a.error}.`; this.#emit(); return; }
    if (this.#unlocked) return;
    if (r) writeDurable(`${this.#base}.release`, this.#o.wrap.encryptString(JSON.stringify(u)));
    this.#unlocked = u;
    this.#paper = a.paper;
    this.#notice = '';
    this.#openExam();
    this.#emit();
  }

  #openExam(): void {
    if (this.#exam || !this.#pkg || !this.#paper || !this.#id?.key) return;
    const p = this.#pkg.policy, me = p.roster[this.#o.ctx.cand], cellPub = hexToBytes(p.cell.pub), id = this.#id;
    try {
      this.#exam = new ExamSession({ dir: this.#o.dir, ctx: this.#o.ctx, keyEpoch: 1, seat: id.key!, cellPub, wrap: this.#o.wrap,
        durationMs: p.durationMs + me.extraMs, items: this.#paper.items.map((i) => i.id), form: me.form, pseud: me.pseud, clock: this.#o.clock, testMode: this.#o.testMode });
    } catch (e) { this.#notice = `Journal problem — please call the invigilator: ${(e as Error).message}`; return; }
    this.#sync = new SeatSync(this.#exam, httpSend(this.#o.relayUrl, 5000, this.#o.fetch), verifier(cellPub), (v) => this.#o.onSync?.(v), { bind: () => id.bind });
    this.#sync.start(1000);
  }

  #emit(): void { this.#o.onBoot?.(this.boot()); }
}
