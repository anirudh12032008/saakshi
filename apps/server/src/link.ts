// SYNC_LAG (plan §3.10): the relay's view of its WAN link, from one sample per forwarder round. A threshold on EWMA-smoothed round
// time and failure rate, plus a growing backlog, warns that the link is likely to fail; no answer for `downMs` after a failure is
// down. Honest claim: it warned before the cut in our chaos drills; it is not validated on real WAN data.
import type { CentreStatus, LinkView, RoundSample } from '@saakshi/core/ops';

export interface LinkOpts { centre: string; alpha?: number; warnRttMs?: number; warnErr?: number; downMs?: number; growRounds?: number }

export class LinkMonitor {
  #o: LinkOpts;
  #rtt = 0; #err = 0; #n = 0; #lastOk = 0; #first = 0; #grow = 0;
  #last?: RoundSample;
  #recent: { at: number; backlog: number }[] = [];

  constructor(o: LinkOpts) { this.#o = o; }

  record(r: RoundSample): void {
    const a = this.#o.alpha ?? 0.3;
    if (!this.#n) this.#first = r.at;
    this.#rtt = this.#n ? a * r.ms + (1 - a) * this.#rtt : r.ms;
    this.#err = this.#n ? a * (r.ok ? 0 : 1) + (1 - a) * this.#err : r.ok ? 0 : 1;
    this.#n++;
    if (r.ok) this.#lastOk = r.at;
    const prev = this.#last?.backlog ?? 0;
    this.#grow = r.backlog > prev ? this.#grow + 1 : r.backlog > 0 && r.backlog === prev ? this.#grow : 0;
    this.#last = r;
    this.#recent.push({ at: r.at, backlog: r.backlog });
    if (this.#recent.length > 10) this.#recent.shift();
  }

  view(now: number, x: { cut: boolean; degraded: boolean }): LinkView {
    const l = this.#last, why: string[] = [], okAt = this.#lastOk || this.#first;     // never reached yet: count from the first try
    let risk: LinkView['risk'] = 'ok';
    if (x.cut) { risk = 'down'; why.push('the link is cut'); }
    else if (l && !l.ok && now - okAt > (this.#o.downMs ?? 10_000)) { risk = 'down'; why.push(`no answer from the exam server for ${Math.round((now - okAt) / 1000)} s`); }
    else {
      if (this.#n >= 3 && this.#rtt > (this.#o.warnRttMs ?? 1_500)) why.push(`round trips ${(this.#rtt / 1000).toFixed(1)} s (smoothed)`);
      if (this.#n >= 3 && this.#err > (this.#o.warnErr ?? 0.3)) why.push(`${Math.round(this.#err * 100)}% of rounds failing (smoothed)`);
      if (this.#grow >= (this.#o.growRounds ?? 5)) why.push(`backlog growing for ${this.#grow} rounds (${l?.backlog ?? 0} entries)`);
      if (why.length) risk = 'warn';
    }
    const reason = risk === 'warn' ? `WAN failure likely: ${why.join('; ')}` : why.join('; ') || (this.#n ? 'healthy' : 'no traffic yet');
    const eta = l?.replaying ? this.#eta() : undefined;
    return {
      centre: this.#o.centre, up: !x.cut, cut: x.cut, degraded: x.degraded, rttMs: Math.round(this.#rtt), errRate: Math.round(this.#err * 100) / 100,
      backlog: l?.backlog ?? 0, lastContactAt: this.#lastOk, risk, reason, ...(eta !== undefined ? { etaMs: eta } : {}),
      cell: !l ? 'LIVE' : l.replaying ? 'REBUILDING' : risk === 'down' ? 'unreachable' : 'LIVE',
    };
  }

  /** Remaining backlog over the recent drain rate; undefined while it is not draining. */
  #eta(): number | undefined {
    const a = this.#recent[0], b = this.#recent.at(-1)!;
    if (!a || b.at <= a.at || a.backlog <= b.backlog) return undefined;
    return Math.round(b.backlog / ((a.backlog - b.backlog) / (b.at - a.at)));
  }
}

/** What the relay tells its seats (the in-exam banner). */
export const statusOf = (v: LinkView, now: number): CentreStatus => ({
  link: v.risk === 'down' ? 'down' : v.risk === 'warn' || v.degraded ? 'degraded' : 'up', cell: v.cell, ...(v.etaMs !== undefined ? { etaMs: v.etaMs } : {}), at: now,
});
