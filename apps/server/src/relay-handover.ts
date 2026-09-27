// Relay routes for moving a candidate to another seat (plan §3.2, Addendum C). The relay is untrusted: it cannot read the PIN (sealed
// to the cell) or the restored answers (sealed to the new seat), and cannot forge the cell's certificate or grant. It holds PIN moves
// until an invigilator approves, adds its own head (fromSeq, fromHead: what the old seat delivered, ✓✓), forwards to the cell, and keeps
// the new binding so it can verify the new seat's entries. ponytail: pending moves live in memory; after a relay restart the seat asks again.
import type { HandoverApproval, HandoverGrant, HandoverReq } from '@saakshi/core/handover';
import type { Ctx } from '@saakshi/core/protocol';
import { parseHandoverReq } from '@saakshi/core/wire';
import type { Bindings } from './bindings.ts';
import type { Routes } from './serve.ts';

export interface RelayHandoverOpts {
  exam: string; shift: string; cellUrl: string; bindings: Bindings;
  /** The relay's committed head for the stream. */
  head: (c: Ctx) => { seq: number; h: string };
  fetch?: typeof fetch; now?: () => number; log?: (line: string) => void; retryMs?: number; tries?: number; timeoutMs?: number;
}
interface Move { req: HandoverReq; at: number; state: 'pending' | 'granted' | 'refused'; grant?: HandoverGrant; error?: string; code?: string; busy?: Promise<void> }
/** What the console shows and the invigilator approves: 16 hex of the new seat's key (the seat shows the same). */
export const moveKey = (pub: string): string => pub.slice(2, 18);
const json = (body: unknown, status = 200) => Response.json(body, { status });

export function relayHandover(o: RelayHandoverOpts): Routes {
  const f = o.fetch ?? fetch, now = o.now ?? Date.now, log = o.log ?? ((l: string) => console.log(l));
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const moves = new Map<string, Move>();                                              // `${cand}/${pub}`
  const find = (cand: string, key: string) => [...moves.values()].find((m) => m.req.cand === cand && moveKey(m.req.pub) === key);
  const seatReply = (m: Move) => m.state === 'granted' ? json({ state: 'granted', grant: m.grant })
    : m.state === 'refused' ? json({ state: 'refused', error: m.error, code: m.code }, 409) : json({ state: 'pending', ...(m.error ? { error: m.error } : {}) }, 202);

  async function forward(m: Move, approval?: HandoverApproval): Promise<void> {
    const h = o.head(m.req);
    const body = JSON.stringify({ req: m.req, ...(approval ? { approval } : {}), ...(m.req.proof.via === 'pin' ? { fromSeq: h.seq, fromHead: h.h } : {}) });
    for (let i = 0; i < (o.tries ?? 20); i++) {
      let r: Response;
      try { r = await f(`${o.cellUrl}/v1/handover`, { method: 'POST', headers: { 'content-type': 'application/json' }, body, signal: AbortSignal.timeout(o.timeoutMs ?? 5000) }); }
      catch (e) { m.error = `the exam server is unreachable (${(e as Error).message})`; return; }
      const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
      if (r.status === 200) {
        const g = j as unknown as HandoverGrant;
        const err = o.bindings.accept(g.bind);
        if (err) { Object.assign(m, { state: 'refused', error: `the exam server's certificate does not verify here: ${err}`, code: 'BAD' }); return; }
        Object.assign(m, { state: 'granted', grant: g, error: undefined });
        log(`HANDOVER-GRANTED ${JSON.stringify({ cand: m.req.cand, seat: m.req.seatId, keyEpoch: g.grant.keyEpoch, fromSeq: g.grant.fromSeq, via: g.via, approvedBy: g.approvedBy, creditedMs: g.grant.creditedMs })}`);
        return;
      }
      if (r.status === 503 || j.code === 'BEHIND') { m.error = String(j.error ?? 'the exam server is catching up'); await sleep(o.retryMs ?? 500); continue; }
      Object.assign(m, { state: 'refused', error: String(j.error ?? `the exam server answered ${r.status}`), code: String(j.code ?? r.status) });
      return;
    }
  }
  // Two approvals (or a double click) share one forward.
  const once = (m: Move, approval?: HandoverApproval): Promise<void> => (m.busy ??= forward(m, approval).finally(() => { m.busy = undefined; }));

  return {
    '/v1/handover': { POST: async (req) => {
      let r: HandoverReq;
      try { r = parseHandoverReq(await req.json()); } catch (e) { return json({ error: (e as Error).message }, 400); }
      if (r.exam !== o.exam || r.shift !== o.shift) return json({ error: `this relay serves ${o.exam} ${o.shift}` }, 400);
      const k = `${r.cand}/${r.pub}`;
      let m = moves.get(k);
      if (m && m.state !== 'refused') return seatReply(m);
      m = { req: r, at: now(), state: 'pending' };
      moves.set(k, m);
      if (r.proof.via === 'key') await once(m);
      else log(`HANDOVER-REQUEST ${JSON.stringify({ cand: r.cand, seat: r.seatId, key: moveKey(r.pub) })}`);
      return seatReply(m);
    } },
    '/v1/handover/pending': { GET: () => json({ pending: [...moves.values()].filter((m) => m.state === 'pending').sort((a, b) => a.at - b.at)
      .map((m) => ({ cand: m.req.cand, seatId: m.req.seatId, key: moveKey(m.req.pub), at: m.at, error: m.error ?? '' })) }) },
    '/v1/handover/approve': { POST: async (req) => {
      const b = (await req.json().catch(() => null)) as { cand?: unknown; key?: unknown; invigilator?: unknown } | null;
      const by = typeof b?.invigilator === 'string' ? b.invigilator.trim() : '';
      if (typeof b?.cand !== 'string' || typeof b.key !== 'string' || !by || by.length > 64) return json({ error: 'need {cand, key, invigilator}' }, 400);
      const m = find(b.cand, b.key);
      if (!m) return json({ error: `no move for ${b.cand} with key ${b.key}` }, 404);
      if (m.state === 'pending') await once(m, { by, at: now() });
      if (m.state === 'granted') return json({ state: 'granted', keyEpoch: m.grant!.grant.keyEpoch, fromSeq: m.grant!.grant.fromSeq, creditedMs: m.grant!.grant.creditedMs });
      return m.state === 'refused' ? json({ state: 'refused', error: m.error, code: m.code }, 409) : json({ state: 'pending', error: m.error ?? '' }, 202);
    } },
    '/v1/handover/refuse': { POST: async (req) => {
      const b = (await req.json().catch(() => null)) as { cand?: unknown; key?: unknown } | null;
      const m = typeof b?.cand === 'string' && typeof b.key === 'string' ? find(b.cand, b.key) : undefined;
      if (!m || m.state !== 'pending') return json({ error: 'no such pending move' }, 404);
      Object.assign(m, { state: 'refused', error: 'the invigilator refused this move', code: 'REFUSED' });
      log(`HANDOVER-REFUSED ${JSON.stringify({ cand: m.req.cand, seat: m.req.seatId })}`);
      return json({ state: 'refused' });
    } },
  };
}
