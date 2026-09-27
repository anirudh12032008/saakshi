// Cell routes added in Stage 3: enrolment in batches, control's release push, the bindings (for control's trust) and per-centre stats.
import type { Directory } from '@saakshi/core/directory';
import { parseReleaseMsg } from '@saakshi/core/paper';
import type { HandoverApproval, HandoverReq } from '@saakshi/core/handover';
import type { CellEvent } from '@saakshi/core/ops';
import { parseBindReq, parseHandoverReq, type NodeState, type StreamView } from '@saakshi/core/wire';
import type { Bindings, EnrolResult } from './bindings.ts';
import type { HandoverResult } from './handover.ts';
import type { ReleaseStore } from './release-store.ts';
import type { Routes } from './serve.ts';
import { cellStats } from './stats.ts';

export interface CellRoutesOpts {
  cellId: string; dir: Directory; bindings: Bindings; releases: ReleaseStore;
  state: () => NodeState; views: () => StreamView[]; submitted: () => string[];
  /** Stage 4 */
  handover?: (req: HandoverReq, from: { fromSeq: number; fromHead: string } | undefined, approval: HandoverApproval | undefined) => HandoverResult;
  events?: (after: number, limit: number) => CellEvent[];
  rebuild?: () => { done: number; expected: number };
}
const json = (body: unknown, status = 200) => Response.json(body, { status });

export function cellRoutes(o: CellRoutesOpts): Routes {
  const serves = (cand: string): boolean => { const c = o.dir.cands[cand]; return !!c && o.dir.centres[c.centre]?.cell === o.cellId; };
  return {
    '/v1/enrol': { POST: async (req) => {
      if (o.state() === 'REBUILDING') return json({ state: 'REBUILDING' }, 503);
      const b = (await req.json().catch(() => null)) as { enrols?: unknown } | null;
      if (!b || !Array.isArray(b.enrols) || b.enrols.length > 500) return json({ error: 'need {enrols: BindReq[]} (at most 500)' }, 400);
      const enrols = b.enrols;
      const results = o.bindings.tx(() => enrols.map((x): EnrolResult => {
        try { const r = parseBindReq(x); return o.bindings.enrol(r, serves(r.cand)); }
        catch (e) { return { ok: false, code: 'BAD', error: (e as Error).message }; }
      }));
      return json({ results });
    } },
    '/v1/release': { POST: async (req) => {
      const b = (await req.json().catch(() => null)) as { releases?: unknown } | null;
      if (!b || !Array.isArray(b.releases) || b.releases.length > 10) return json({ error: 'need {releases: ReleaseMsg[]} (at most 10)' }, 400);
      const errors: string[] = [];
      let accepted = 0;
      for (const x of b.releases) {
        let err: string | undefined;
        try { err = o.releases.accept(parseReleaseMsg(x)); } catch (e) { err = (e as Error).message; }
        if (err) errors.push(err); else accepted++;
      }
      return json({ accepted, errors }, errors.length && !accepted ? 400 : 200);
    } },
    '/v1/binds': { GET: () => json({ binds: o.bindings.all() }) },
    '/v1/handover': { POST: async (req) => {
      if (o.state() === 'REBUILDING') return json({ state: 'REBUILDING' }, 503);
      if (!o.handover) return json({ error: 'moves need EXAM mode' }, 404);
      const b = (await req.json().catch(() => null)) as { req?: unknown; approval?: { by?: unknown }; fromSeq?: unknown; fromHead?: unknown } | null;
      let hr: HandoverReq;
      try { hr = parseHandoverReq(b?.req); } catch (e) { return json({ error: (e as Error).message, code: 'BAD' }, 400); }
      const from = Number.isSafeInteger(b?.fromSeq) && (b!.fromSeq as number) >= 0 && typeof b?.fromHead === 'string' && /^[0-9a-f]{64}$/.test(b.fromHead)
        ? { fromSeq: b.fromSeq as number, fromHead: b.fromHead } : undefined;
      const by = typeof b?.approval?.by === 'string' ? b.approval.by.trim() : '';
      const r = o.handover(hr, from, by && by.length <= 64 ? { by, at: Date.now() } : undefined);
      if (r.ok) return json(r.grant);
      return json({ error: r.error, code: r.code, ...(r.left !== undefined ? { left: r.left } : {}) }, r.code === 'PIN_LOCKED' ? 423 : r.code === 'BAD' ? 400 : 409);
    } },
    '/v1/events': { GET: (req) => {
      const u = new URL(req.url), after = Math.max(0, Number(u.searchParams.get('after') ?? 0) || 0), limit = Math.min(500, Number(u.searchParams.get('limit') ?? 500) || 500);
      const events = (o.events?.(after, limit) ?? []).map((e) => ({ ...e, centre: o.dir.cands[e.cand]?.centre ?? '' }));
      return json({ events, last: events.at(-1)?.id ?? after });
    } },
    '/v1/stats': { GET: () => json(cellStats({ cellId: o.cellId, state: o.state(), dir: o.dir, views: o.views(), bound: o.bindings.cands(), submitted: o.submitted(),
      rebuild: o.state() === 'REBUILDING' ? o.rebuild?.() : undefined })) },
  };
}
