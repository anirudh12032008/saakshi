import { ackMessage } from '@saakshi/core/ack';
import { hexToBytes } from '@saakshi/core/bytes';
import type { Ctx } from '@saakshi/core/protocol';
import type { Verify } from '@saakshi/core/sig';
import { streamKey, type SyncReq, type SyncRes, type WireEntry } from '@saakshi/core/wire';
import type { SyncView } from '../shared/ipc.ts';

export interface SyncSource { ctx: Ctx; head(): number; hashAt(seq: number): string; entriesAfter(after: number, limit: number): WireEntry[] }
export type Send = (req: SyncReq) => Promise<SyncRes>;

const BATCH = 500;
const SIG_HEX = /^[0-9a-f]{128}$/;

export function httpSend(relayUrl: string, timeoutMs = 5000): Send {
  const url = new URL('/v1/sync', relayUrl);
  return async (req) => {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(req), signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok) throw new Error(`relay answered ${r.status}`);
    return (await r.json()) as SyncRes;
  };
}

/**
 * Seat → relay sync. The send cursor is the relay's *current* head for us (−1 = ask first), so a spare relay with an
 * empty DB gets everything again. Ticks: ✓✓ only when the relay's headH is our own h; blue only for a cell
 * signature over our own h. The relay is untrusted for both.
 */
export class SeatSync {
  #src: SyncSource;
  #send: Send;
  #cellVerify: Verify;
  #onView: (v: SyncView) => void;
  #cursor = -1;
  #relay = 0;
  #cell = 0;
  #online = false;
  #error = '';
  #busy = false;
  #again = false;
  #timer: ReturnType<typeof setInterval> | undefined;

  constructor(src: SyncSource, send: Send, cellVerify: Verify, onView: (v: SyncView) => void = () => {}) {
    this.#src = src; this.#send = send; this.#cellVerify = cellVerify; this.#onView = onView;
  }

  view(): SyncView { return { local: this.#src.head(), relay: this.#relay, cell: this.#cell, online: this.#online, error: this.#error }; }

  async round(): Promise<void> {
    const s = this.#src;
    const entries = this.#cursor < 0 ? [] : s.entriesAfter(this.#cursor, BATCH);
    let res: SyncRes;
    try { res = await this.#send({ entries, streams: [{ ...s.ctx, head: s.head() }] }); }
    catch (e) { this.#online = false; this.#error = (e as Error).message; this.#onView(this.view()); return; }
    this.#online = true;
    this.#error = res.rejected.map((r) => `${r.code}: ${r.reason}`).join('; ');
    const st = res.streams.find((x) => streamKey(x) === streamKey(s.ctx));
    if (st) {
      const mine = st.head === 0 ? '' : st.head <= s.head() ? s.hashAt(st.head) : undefined;
      if (st.headH === mine) { this.#cursor = st.head; this.#relay = Math.max(this.#relay, st.head); }
      else this.#error ||= `relay disagrees with this seat at seq ${st.head}`;
      const a = st.ack;
      if (a && a.seq >= 1 && a.seq <= s.head() && a.h === s.hashAt(a.seq) && SIG_HEX.test(a.sig)
        && this.#cellVerify(ackMessage({ ...s.ctx, keyEpoch: a.keyEpoch, seq: a.seq, h: a.h }), hexToBytes(a.sig))) {
        this.#cell = Math.max(this.#cell, a.seq);
      }
    }
    this.#onView(this.view());
  }

  /** Run a round now; coalesces concurrent kicks and keeps going while a backlog is draining. */
  kick(): void {
    if (this.#busy) { this.#again = true; return; }
    this.#busy = true;
    const before = this.#cursor;
    void this.round().finally(() => {
      this.#busy = false;
      const draining = this.#online && this.#cursor !== before && this.#cursor < this.#src.head();
      if (this.#again || draining) { this.#again = false; this.kick(); }
    });
  }

  start(everyMs = 1000): void {
    this.stop();
    this.#timer = setInterval(() => this.kick(), everyMs);
    this.kick();
  }

  stop(): void { clearInterval(this.#timer); this.#timer = undefined; }
}
