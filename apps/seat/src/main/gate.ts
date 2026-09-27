// The integrity gate and in-exam monitor (plan §3.4–§3.5). Before start a `block` verdict refuses start(); during the exam findings are
// only journaled (never auto-submit, never lock out). Each distinct finding (code + names) is journaled once until it clears. Face flags
// carry one thumbnail sealed to control's review key; undelivered flags are retried.
import { hexToBytes } from '@saakshi/core/bytes';
import { findingKey, sealThumb, thumbHashOf, verdictOf, type Accommodation, type FaceFlag, type IntegrityFinding, type IntegrityPolicy, type Readiness } from '@saakshi/core/integrity';
import type { Ctx } from '@saakshi/core/protocol';
import type { FaceSample, GateView } from '../shared/ipc.ts';
import { FaceMonitor } from './face.ts';
import { evaluate, type ProbeSnapshot } from './integrity.ts';

export interface GateOpts {
  pol: IntegrityPolicy; acc: Accommodation; defaulted: boolean; testMode: boolean; ctx: Ctx; seatId: string;
  collect: () => Promise<ProbeSnapshot>; now?: () => number;
  journal: (f: IntegrityFinding) => number | undefined; report: (r: Readiness) => Promise<boolean>; face: (f: FaceFlag) => Promise<boolean>;
  key: () => { keyEpoch: number } | undefined;
}
const unknownAll = (): IntegrityFinding[] => [{ code: 'probe-unknown', level: 'review', detail: 'the seat check did not finish in time', names: ['all'] }];

export class Gate {
  #o: GateOpts; #now: () => number; #view: GateView = { verdict: 'review', findings: [], checkedAt: 0 };
  #journaled = new Set<string>(); #faces: FaceMonitor; #outbox: FaceFlag[] = []; #lastReport?: Readiness; #reported = true; #busy?: Promise<GateView>; #started = false;
  constructor(o: GateOpts) {
    this.#o = o; this.#now = o.now ?? Date.now;
    this.#faces = new FaceMonitor({ expected: o.acc.faces ?? 1, ...o.pol.face });
  }
  view(): GateView { return this.#view; }
  /** Only before the exam: once the journal accepts an entry the exam has started, and a started exam is never blocked. */
  blocked(): boolean { return !this.#started && this.#view.verdict === 'block'; }
  #journal(f: IntegrityFinding): number | undefined { const s = this.#o.journal(f); if (s !== undefined) this.#started = true; return s; }

  check(): Promise<GateView> { return (this.#busy ??= this.#check().finally(() => { this.#busy = undefined; })); }
  async #check(): Promise<GateView> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<undefined>((r) => { timer = setTimeout(() => r(undefined), this.#o.pol.probeMs); });
    const snap = await Promise.race([this.#o.collect().catch(() => undefined), timeout]);
    clearTimeout(timer);
    const findings = snap ? evaluate(snap, this.#o.pol, this.#o.acc, { testMode: this.#o.testMode, defaulted: this.#o.defaulted }) : unknownAll();
    const now = new Set(findings.map(findingKey));
    for (const f of findings) {
      const k = findingKey(f);
      if (f.level !== 'info' && !this.#journaled.has(k) && this.#journal(f) !== undefined) this.#journaled.add(k);
    }
    for (const k of [...this.#journaled]) if (!now.has(k) && !k.startsWith('face-') && !k.startsWith('blur')) this.#journaled.delete(k);   // cleared: may be journaled again
    this.#view = { verdict: verdictOf(findings), findings, checkedAt: this.#now() };
    const key = this.#o.key();
    if (key) { this.#lastReport = { ...this.#o.ctx, seatId: this.#o.seatId, keyEpoch: key.keyEpoch, at: this.#view.checkedAt, verdict: this.#view.verdict, findings }; this.#reported = await this.#o.report(this.#lastReport).catch(() => false); }
    return this.#view;
  }

  blur(ms: number): void {
    if (ms < this.#o.pol.blurMs) return;
    this.#journal({ code: 'blur', level: 'review', detail: `the exam window lost focus for ${Math.round(ms / 1000)} s`, names: [] });
  }

  faceSample(s: FaceSample): void {
    const d = this.#faces.sample(s);
    if (!d) return;
    const thumb = d.thumb && this.#o.pol.reviewPub ? sealThumb(hexToBytes(this.#o.pol.reviewPub), this.#o.ctx, d.at, Buffer.from(d.thumb, 'base64')) : '';
    const flag: FaceFlag = { ...this.#o.ctx, seatId: this.#o.seatId, at: d.at, code: d.code, faces: d.faces, expected: d.expected, thumb, thumbHash: thumbHashOf(thumb) };
    this.#journal({ code: d.code, level: 'review', detail: d.code === 'face-none' ? 'no face for 10 s or more' : `${d.faces} faces, ${d.expected} expected`, names: flag.thumbHash ? [flag.thumbHash] : [] });
    this.#outbox.push(flag);
    void this.retry();
  }

  async retry(): Promise<void> {
    const pending = this.#outbox.splice(0);
    for (const f of pending) if (!(await this.#o.face(f).catch(() => false))) this.#outbox.push(f);
    if (!this.#reported && this.#lastReport) this.#reported = await this.#o.report(this.#lastReport).catch(() => false);
  }
}
