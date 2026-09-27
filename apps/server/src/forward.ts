import type { WireBind } from '@saakshi/core/enrol';
import type { ReleaseMsg } from '@saakshi/core/paper';
import type { Ctx } from '@saakshi/core/protocol';
import type { RoundSample } from '@saakshi/core/ops';
import { LIMITS, streamKey, type Hello, type StreamView, type SyncReq, type SyncRes } from '@saakshi/core/wire';
import type { Ingest } from './ingest.ts';

export type CellSend = (req: SyncReq) => Promise<SyncRes | 'REBUILDING'>;
export type Round = 'idle' | 'busy' | 'error';

export function httpCellSend(base: string, timeoutMs = 5000): CellSend {
  const url = new URL('/v1/sync', base);
  return async (req) => {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(req), signal: AbortSignal.timeout(timeoutMs) });
    if (r.status === 503) return 'REBUILDING';
    if (!r.ok) throw new Error(`cell answered ${r.status}`);
    return (await r.json()) as SyncRes;
  };
}

const hello = (v: StreamView): Hello => ({ exam: v.exam, shift: v.shift, attempt: v.attempt, cand: v.cand, head: v.head });

export interface ForwardOpts {
  batch?: number; heartbeatMs?: number;
  /** Stage 3: where releases from the cell go, and how many signed ones this relay already holds. */
  releases?: { count(): number; accept(r: ReleaseMsg): unknown };
  /** Every binding of the stream, oldest epoch first (Stage 4: a moved candidate has several). */
  bindFor?: (c: Ctx) => WireBind[];
  /** Stage 4: one sample per send, for the relay's link monitor (SYNC_LAG). */
  onRound?: (r: RoundSample) => void;
}

/**
 * Relay → cell store-and-forward. Per stream it sends committed entries from cellHead+1 (a hello when the cell's
 * head is unknown), learns the cell's head and ack from the reply, and on 503 replays everything from genesis.
 * With nothing pending it still sends all hellos every `heartbeatMs`, so a restarted or wiped cell is noticed
 * even when no seat is answering.
 */
export class Forwarder {
  #relay: Ingest;
  #send: CellSend;
  #batch: number;
  #heartbeatMs: number;
  #lastContact = 0;
  #replaying = false;
  #stopped = true;
  #loop: Promise<void> | undefined;
  #releases?: ForwardOpts['releases'];
  #bindFor?: ForwardOpts['bindFor'];
  #onRound?: ForwardOpts['onRound'];

  constructor(relay: Ingest, send: CellSend, opts: ForwardOpts = {}) {
    this.#relay = relay;
    this.#send = send;
    this.#batch = opts.batch ?? 500;
    this.#heartbeatMs = opts.heartbeatMs ?? 2000;
    this.#releases = opts.releases;
    this.#bindFor = opts.bindFor;
    this.#onRound = opts.onRound;
  }

  get replaying(): boolean { return this.#replaying; }

  async round(): Promise<Round> {
    try {
      const req: SyncReq = { entries: [], streams: [] };
      if (this.#replaying) req.replay = true;
      const before = new Map<string, number>();
      const binds: WireBind[] = [];
      let backlog = 0;
      // ponytail: first streams first, no fairness; add round-robin if one centre's backlog starves the rest.
      for (const v of this.#relay.views()) {
        backlog += Math.max(0, v.head - Math.max(0, v.cellHead));
        if (req.entries.length >= this.#batch || req.streams.length >= 5000) continue;      // keep counting the backlog
        if (v.cellHead >= 0 && v.head <= v.cellHead) continue;
        // A stream's bindings travel with its entries while the cell rebuilds, or when the cell does not know the stream
        // (cellHead 0) — so a relay that missed a rebuild heals instead of being refused "no seat key".
        const bs = this.#bindFor && v.cellHead >= 0 && (this.#replaying || v.cellHead === 0) ? this.#bindFor(v) : [];
        if (binds.length + bs.length > LIMITS.entries) continue;
        binds.push(...bs);
        req.streams.push(hello(v));
        before.set(streamKey(v), v.cellHead);
        if (v.cellHead >= 0) req.entries.push(...this.#relay.entriesAfter(v, v.cellHead, this.#batch - req.entries.length));
      }
      if (binds.length) req.binds = binds;
      let heartbeat = false;
      if (!req.streams.length) {
        if (this.#replaying) {
          if ((await this.#send({ entries: [], streams: [], replay: true, done: true })) === 'REBUILDING') return 'error';
          this.#replaying = false;
          return 'busy';
        }
        if (Date.now() - this.#lastContact < this.#heartbeatMs) return 'idle';
        req.streams = this.#relay.views().slice(0, 5000).map(hello);
        if (!req.streams.length && !this.#releases) return 'idle';                  // with releases to learn, an empty heartbeat still asks
        heartbeat = true;
      }
      if (this.#releases) req.have = this.#releases.count();
      const t0 = Date.now();
      let res: SyncRes | 'REBUILDING';
      try { res = await this.#send(req); }
      catch (e) {
        this.#onRound?.({ at: Date.now(), ms: Date.now() - t0, ok: false, backlog, replaying: this.#replaying });
        this.#relay.forgetCell();                   // learn the cell's heads again (a hello round) before sending entries
        throw e;
      }
      this.#lastContact = Date.now();
      this.#onRound?.({ at: this.#lastContact, ms: this.#lastContact - t0, ok: true, backlog, replaying: this.#replaying || res === 'REBUILDING' });
      if (res === 'REBUILDING') {
        if (!this.#replaying) { this.#replaying = true; this.#relay.resetCell(); }
        return 'busy';
      }
      let progress = false;
      for (const st of res.streams) {
        if (before.get(streamKey(st)) !== st.head) progress = true;
        this.#relay.setCellStatus(st);
      }
      for (const r of res.releases ?? []) this.#releases?.accept(r);
      return heartbeat ? 'idle' : progress ? 'busy' : 'error';
    } catch {
      return 'error';
    }
  }

  start(idleMs = 50, errorMs = 500): void {
    if (!this.#stopped) return;
    this.#stopped = false;
    this.#loop = (async () => {
      while (!this.#stopped) {
        const r = await this.round();
        if (r !== 'busy') await Bun.sleep(r === 'idle' ? idleMs : errorMs);
      }
    })();
  }

  async stop(): Promise<void> {
    this.#stopped = true;
    await this.#loop;
  }
}
