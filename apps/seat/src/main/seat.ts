// One seat, start to finish (plan §3.2, §3.3, §3.6): the package → enrolment → the key at T0 → the exam. Electron-free, so tests
// and tools/act2.ts drive it directly; index.ts only wires it to IPC.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { hexToBytes, toHex } from '@saakshi/core/bytes';
import type { Canon } from '@saakshi/core/canon';
import { msg } from '@saakshi/core/enrol';
import { faceArray, integrityOf, readinessArray } from '@saakshi/core/integrity';
import { signer, verifier } from '@saakshi/core/node';
import type { CentreStatus } from '@saakshi/core/ops';
import type { ReleaseMsg } from '@saakshi/core/paper';
import { kcf, type Ctx } from '@saakshi/core/protocol';
import type { Action, ActResult, EnrolInput, EnrolResult, ExamBoot, FaceSample, GateView, Paper, Phase, SubmitResult, SyncView } from '../shared/ipc.ts';
import { ExamSession, type PauseCause } from './exam.ts';
import { Gate } from './gate.ts';
import type { ProbeSnapshot } from './integrity.ts';
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
  /** Stage 5: the integrity gate. Without it the seat behaves as in Stage 4 (act2/act3, older tests). */
  integrity?: { collect: () => Promise<ProbeSnapshot> };
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
  #status?: CentreStatus;
  #timer?: ReturnType<typeof setInterval>;
  #busy = false;
  #closed = false;
  #gate?: Gate;
  #polMs = 0;

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
      moveable: this.#id?.moveable ?? false, moveKey: this.#id?.state === 'moving' ? this.#id.moveKey : undefined,
      credited: this.#id?.credit, status: this.#status, paused: e?.paused ?? false,
      gate: this.#gate?.view(), faces: me?.acc?.faces ?? 1,
    };
  }

  async enrol(x: EnrolInput): Promise<EnrolResult> {
    if (!this.#id) return { ok: false, error: 'Waiting for the centre server.' };
    const r = await this.#id.enrol(x.pin, { operatorId: x.operatorId, method: x.method });
    this.#dropUnbound();
    this.#openExam();
    this.#emit();
    return r;
  }

  /** Move the candidate to this seat (Addendum C.3): waits for the invigilator, then continues from the grant. */
  async handover(pin: string): Promise<EnrolResult> {
    if (!this.#id) return { ok: false, error: 'Waiting for the centre server.' };
    const r = await this.#id.handover(pin);
    this.#openExam();
    this.#emit();
    return r;
  }
  /** The OS suspended or locked the screen (plan §3.6): the timer stops; resume journals a gap. */
  pause(cause: PauseCause): void { this.#exam?.pause(cause); this.#emit(); }
  resume(): void { if (this.#exam?.resume() !== undefined) this.#sync?.kick(); this.#emit(); }

  start(): ActResult {
    if (!this.#exam || !this.#unlocked) return { ok: false, error: 'The paper is locked until T0.' };
    if (!this.#exam.started && this.#gate?.blocked()) {        // only before start: a started exam is never refused for integrity
      const names = [...new Set(this.#gate.view().findings.filter((f) => f.level === 'block').flatMap((f) => f.names))].join(', ');
      return { ok: false, error: `This seat cannot start: ${names}. Close them and press Re-check.` };
    }
    const r = this.#exam.start([this.#unlocked.form, kcf(hexToBytes(this.#unlocked.key)), this.#unlocked.via]);
    this.#sync?.kick();
    this.#emit();
    return r;
  }

  act(a: Action): ActResult {
    if (this.#sync?.view().moved) return { ok: false, error: 'This candidate has moved to another seat. Please call the invigilator.' };
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

  /** Stage 5: run the gate now (the Re-check button). Without a gate: the empty view. */
  async recheck(): Promise<GateView> {
    if (!this.#gate) return { verdict: 'green', findings: [], checkedAt: 0 };
    const v = await this.#gate.check();
    this.#emit();
    return v;
  }
  faceSample(s: FaceSample): void { this.#gate?.faceSample(s); }
  blur(ms: number): void { this.#gate?.blur(ms); }

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
    if (this.#id?.state === 'moving') return 'moving';
    if (!this.#id?.key || (this.#id.state === 'refused' && this.#id.moveable)) return 'enrol';
    if (this.#sync?.view().moved) return 'moved';
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
      else if (this.#id?.state === 'moving') { await this.#id.poll(); if (this.#id.state !== 'moving') { this.#openExam(); this.#emit(); } }
      if (this.#pkg) await this.#pollStatus();
      if (this.#gate && this.#id?.key) {                          // from the locked phase on, every probeMs (checkedAt 0: right after enrolment)
        const g = this.#gate, was = g.view().verdict;
        if ((this.#o.now ?? Date.now)() - g.view().checkedAt >= this.#polMs) await g.check();
        await g.retry();
        if (g.view().verdict !== was) this.#emit();
      }
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
    if (this.#o.integrity) {
      const { pol, defaulted } = integrityOf(p.integrity), acc = p.roster[this.#o.ctx.cand]?.acc ?? {};
      this.#polMs = pol.probeMs;
      this.#gate = new Gate({ pol, acc, defaulted, testMode: this.#o.testMode, ctx: this.#o.ctx, seatId: this.#o.seatId, now: this.#o.now,
        collect: this.#o.integrity.collect, key: () => (this.#id?.key ? { keyEpoch: this.#id.keyEpoch } : undefined),
        journal: (f) => { const s = this.#exam?.note(f); if (s !== undefined) this.#sync?.kick(); return s; },
        report: (r) => this.#signedPost('/v1/readiness', { r, sig: this.#sign(readinessArray(r)) }),
        face: (f) => this.#signedPost('/v1/faces', { f, sig: this.#sign(faceArray(f)) }) });
    }
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

  /** The relay's view of its link and the exam server: the in-exam banner (plan §3.10). */
  async #pollStatus(): Promise<void> {
    try {
      const r = await (this.#o.fetch ?? fetch)(new URL('/v1/status', this.#o.relayUrl), { signal: AbortSignal.timeout(2_000) });
      if (!r.ok) return;
      const s = (await r.json()) as CentreStatus, o = this.#status;
      this.#status = s;
      if (s.link !== o?.link || s.cell !== o?.cell || s.etaMs !== o?.etaMs) this.#emit();
    } catch { /* keep the last status */ }
  }

  /** The key arrived while the check-in was in flight, then the cell refused it (bound elsewhere): an unstarted exam here must not
   *  start a chain of its own — the move continues the candidate's chain from the grant instead. */
  #dropUnbound(): void {
    const st = this.#id?.state;
    if (!this.#exam || this.#exam.started || (st !== 'refused' && st !== 'moving')) return;
    this.#sync?.stop(); this.#exam.close();
    this.#sync = undefined; this.#exam = undefined;
  }

  #openExam(): void {
    const id = this.#id;
    if (this.#exam || !this.#pkg || !this.#paper || !id?.key) return;
    if (id.state !== 'bound' && id.state !== 'provisional') return;       // a refused or moving seat must not start a chain of its own
    const p = this.#pkg.policy, me = p.roster[this.#o.ctx.cand], cellPub = hexToBytes(p.cell.pub);
    try {
      this.#exam = new ExamSession({ dir: this.#o.dir, ctx: this.#o.ctx, keyEpoch: id.keyEpoch, seat: id.key!, cellPub, wrap: this.#o.wrap, restore: id.restore,
        durationMs: p.durationMs + me.extraMs, items: this.#paper.items.map((i) => i.id), form: me.form, pseud: me.pseud, clock: this.#o.clock, wall: this.#o.now, testMode: this.#o.testMode });
    } catch (e) { this.#notice = `Journal problem — please call the invigilator: ${(e as Error).message}`; return; }
    if (this.#exam.resumed) this.#exam.restartGap();                     // the app restarted mid-exam: journal the gap (plan §2)
    this.#sync = new SeatSync(this.#exam, httpSend(this.#o.relayUrl, 5000, this.#o.fetch), verifier(cellPub), (v) => this.#o.onSync?.(v), { bind: () => id.bind });
    this.#sync.start(1000);
  }

  #sign(a: Canon[]): string { return toHex(signer(this.#id!.key!)(msg(a))); }
  async #signedPost(path: string, body: unknown): Promise<boolean> {
    return (await httpPost(this.#o.relayUrl, 5000, this.#o.fetch)(path, body)).status === 200;
  }

  #emit(): void { this.#o.onBoot?.(this.boot()); }
}
