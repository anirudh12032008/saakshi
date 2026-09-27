// The paper key at T0 (plan §3.3). The seat listens to its relay over SSE and falls back to pulling /release/current; it never
// talks to the national cells. Every key — pushed by control or unlocked at the centre with the phoned code — must match kc_f in
// the signed manifest before the paper opens (protocol Addendum B.7).
import { verifier } from '@saakshi/core/node';
import { checkRelease, openPaper, parseReleaseMsg, type ReleaseMsg } from '@saakshi/core/paper';
import type { Paper } from '../shared/ipc.ts';
import type { SeatPackage } from './pkg.ts';

export type Accepted = { ok: true; key: Uint8Array; paper: Paper } | { ok: false; error: string };
export function acceptRelease(r: ReleaseMsg, pkg: SeatPackage, form: string, authorityPub: Uint8Array): Accepted {
  const c = checkRelease(r, pkg.manifest, form, verifier(authorityPub));
  if (!c.ok) return c;
  let paper: Paper;
  try { paper = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(openPaper(c.key, { exam: pkg.manifest.exam, shift: pkg.manifest.shift, form }, pkg.papers[form]))) as Paper; }
  catch { return { ok: false, error: 'the key matches kc_f but does not open the paper' }; }
  if (paper.form !== form || !Array.isArray(paper.items) || !paper.items.every((i) => typeof i?.id === 'string' && !!i.en && !!i.hi)) return { ok: false, error: 'the paper is malformed' };
  return { ok: true, key: c.key, paper };
}

export interface SseEvent { id: string; event: string; data: string }
/** Split an SSE text buffer into complete events; returns the incomplete rest. Comments (":ping") and data-less blocks are skipped. */
export function parseSse(buf: string): { events: SseEvent[]; rest: string } {
  const blocks = buf.split(/\r?\n\r?\n/);
  const rest = blocks.pop() ?? '';
  const events: SseEvent[] = [];
  for (const b of blocks) {
    const e: SseEvent = { id: '', event: 'message', data: '' }, data: string[] = [];
    for (const line of b.split(/\r?\n/)) {
      if (!line || line.startsWith(':')) continue;
      const i = line.indexOf(':'), k = i < 0 ? line : line.slice(0, i), v = i < 0 ? '' : line.slice(i + 1).replace(/^ /, '');
      if (k === 'id') e.id = v; else if (k === 'event') e.event = v; else if (k === 'data') data.push(v);
    }
    if (data.length) { e.data = data.join('\n'); events.push(e); }
  }
  return { events, rest };
}

export interface WatchOpts { relayUrl: string; onRelease: (r: ReleaseMsg) => void; fetch?: typeof fetch; retryMs?: number; onError?: (e: string) => void }
export class ReleaseWatcher {
  #o: WatchOpts;
  #stopped = false;
  #ctl?: AbortController;
  #lastId = '';

  constructor(o: WatchOpts) { this.#o = o; }
  start(): void { void this.#loop(); }
  stop(): void { this.#stopped = true; this.#ctl?.abort(); }

  /** The pull fallback: GET /release/current on the relay. */
  async pull(): Promise<void> {
    const r = await (this.#o.fetch ?? fetch)(new URL('/release/current', this.#o.relayUrl), { signal: AbortSignal.timeout(5000) });
    if (!r.ok) throw new Error(`/release/current answered ${r.status}`);
    this.#deliver(((await r.json()) as { releases?: unknown[] }).releases);
  }

  #deliver(xs: unknown[] | undefined): void {
    for (const x of xs ?? []) {
      let r: ReleaseMsg;
      try { r = parseReleaseMsg(x); } catch { continue; }                          // malformed: ignored; the seat acts only on keys that verify
      this.#o.onRelease(r);
    }
  }

  async #loop(): Promise<void> {
    while (!this.#stopped) {
      try { await this.pull(); } catch (e) { this.#o.onError?.((e as Error).message); }
      if (this.#stopped) return;
      try {
        this.#ctl = new AbortController();
        const r = await (this.#o.fetch ?? fetch)(new URL('/v1/release/events', this.#o.relayUrl), { headers: this.#lastId ? { 'last-event-id': this.#lastId } : {}, signal: this.#ctl.signal });
        if (!r.ok || !r.body) throw new Error(`/v1/release/events answered ${r.status}`);
        const dec = new TextDecoder();
        let buf = '';
        for await (const chunk of r.body as unknown as AsyncIterable<Uint8Array>) {
          const p = parseSse(buf + dec.decode(chunk, { stream: true }));
          buf = p.rest;
          for (const e of p.events) {
            if (e.id) this.#lastId = e.id;
            const d = JSON.parse(e.data) as { releases?: unknown[] };
            if (e.event === 'snapshot') this.#deliver(d.releases);
            else if (e.event === 'release') this.#deliver([d]);
          }
        }
      } catch (e) { if (!this.#stopped) this.#o.onError?.((e as Error).message); }
      if (!this.#stopped) await new Promise((res) => setTimeout(res, this.#o.retryMs ?? 2000));
    }
  }
}
