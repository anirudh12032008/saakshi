// The control room's live numbers (plan §3.10–§3.11): every cell's /v1/stats each second, one tile per centre, and entries/s.
import type { CellEntry, CellStats, CentreStats, CentreTile, Directory, FleetView, TileTone } from '@saakshi/core/directory';
import type { Routes } from './serve.ts';

export const tone = (s: { registered: number; unlocked: number }, down: boolean): TileTone =>
  down ? 'down' : s.registered > 0 && s.unlocked === s.registered ? 'green' : s.unlocked > 0 ? 'partial' : 'locked';

export async function httpStats(c: CellEntry): Promise<CellStats> {
  const r = await fetch(`${c.url}/v1/stats`, { signal: AbortSignal.timeout(2000) });
  if (!r.ok) throw new Error(`${c.id} answered ${r.status}`);
  return (await r.json()) as CellStats;
}

export function fleet(o: { dir: Directory; stats?: (c: CellEntry) => Promise<CellStats>; now?: () => number; everyMs?: number }) {
  const now = o.now ?? Date.now, stats = o.stats ?? httpStats;
  const registered: Record<string, number> = {};
  for (const c of Object.values(o.dir.cands)) registered[c.centre] = (registered[c.centre] ?? 0) + 1;
  const lastEntries: Record<string, number> = Object.fromEntries(o.dir.cells.map((c) => [c.id, 0]));
  const empty = (centre: string): CentreStats => ({ registered: registered[centre] ?? 0, bound: 0, unlocked: 0, submitted: 0, entries: 0 });
  let prev: { at: number; entries: number } | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let view: FleetView = { at: 0, registered: Object.keys(o.dir.cands).length, bound: 0, unlocked: 0, submitted: 0, entries: 0, entriesPerSec: 0,
    cells: o.dir.cells.map((c) => ({ id: c.id, state: 'DOWN', entries: 0 })), centres: [] };

  async function poll(): Promise<FleetView> {
    const got = await Promise.allSettled(o.dir.cells.map((c) => stats(c)));
    const at = now();
    const byCell = new Map(o.dir.cells.map((c, i) => [c.id, got[i]]));
    const cells = o.dir.cells.map((c) => {
      const g = byCell.get(c.id)!;
      if (g.status === 'fulfilled') lastEntries[c.id] = g.value.entries;                  // a down cell keeps its last count
      return { id: c.id, state: g.status === 'fulfilled' ? g.value.state : ('DOWN' as const), entries: lastEntries[c.id],
        ...(g.status === 'fulfilled' && g.value.rebuild ? { rebuild: g.value.rebuild } : {}) };
    });
    const centres: CentreTile[] = Object.entries(o.dir.centres).sort(([a], [b]) => a.localeCompare(b)).map(([centre, { cell }]) => {
      const g = byCell.get(cell);
      const s = (g?.status === 'fulfilled' && g.value.centres[centre]) || empty(centre);
      return { centre, cell, ...s, tone: tone(s, g?.status !== 'fulfilled') };
    });
    const sum = (k: Exclude<keyof CentreStats, 'lastSeen'>) => centres.reduce((n, x) => n + x[k], 0);
    const entries = cells.reduce((n, x) => n + x.entries, 0);
    const entriesPerSec = prev && at > prev.at ? Math.max(0, Math.round(((entries - prev.entries) * 1000) / (at - prev.at))) : 0;
    prev = { at, entries };
    view = { at, registered: sum('registered'), bound: sum('bound'), unlocked: sum('unlocked'), submitted: sum('submitted'), entries, entriesPerSec, cells, centres };
    return view;
  }

  const routes: Routes = { '/v1/fleet': { GET: () => Response.json(view) } };
  return {
    routes, poll, view: () => view,
    start(): void { const loop = async () => { await poll().catch(() => {}); timer = setTimeout(loop, o.everyMs ?? 1000); }; void loop(); },
    stop(): void { clearTimeout(timer); },
  };
}
