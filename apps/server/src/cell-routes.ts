// Cell routes added in Stage 3: enrolment in batches, control's release push, the bindings (for control's trust) and per-centre stats.
import type { Directory } from '@saakshi/core/directory';
import { parseReleaseMsg } from '@saakshi/core/paper';
import { parseBindReq, type NodeState, type StreamView } from '@saakshi/core/wire';
import type { Bindings, EnrolResult } from './bindings.ts';
import type { ReleaseStore } from './release-store.ts';
import type { Routes } from './serve.ts';
import { cellStats } from './stats.ts';

export interface CellRoutesOpts {
  cellId: string; dir: Directory; bindings: Bindings; releases: ReleaseStore;
  state: () => NodeState; views: () => StreamView[]; submitted: () => string[];
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
    '/v1/stats': { GET: () => json(cellStats({ cellId: o.cellId, state: o.state(), dir: o.dir, views: o.views(), bound: o.bindings.cands(), submitted: o.submitted() })) },
  };
}
