// Relay routes added in Stage 4: its link view for control (SYNC_LAG), the status its seats show in the banner, and DEV chaos
// ("Degrade Centre 42's link").
import type { CellEvent } from '@saakshi/core/ops';
import { statusOf, type LinkMonitor } from './link.ts';
import type { Wan } from './relay-routes.ts';
import type { Routes } from './serve.ts';

const json = (body: unknown, status = 200) => Response.json(body, { status });
export function relayOps(o: { centre: string; link: LinkMonitor; wan: Wan; dev: boolean; now?: () => number; log?: (line: string) => void;
  events?: (after: number, limit?: number) => CellEvent[] }): Routes {
  const now = o.now ?? Date.now, log = o.log ?? ((l: string) => console.log(l));
  const view = () => o.link.view(now(), { cut: !o.wan.up, degraded: o.wan.degraded });
  const routes: Routes = {
    '/v1/link': { GET: () => json(view()) },
    '/v1/status': { GET: () => json(statusOf(view(), now())) },
    // The relay's own evidence (an old seat's ORPHANED tail never reaches the cell), for control's monitor. `/v1/events` is the console's SSE.
    '/v1/evidence': { GET: (req) => {
      const u = new URL(req.url), after = Math.max(0, Number(u.searchParams.get('after') ?? 0) || 0);
      const events = (o.events?.(after, 500) ?? []).map((e) => ({ ...e, centre: o.centre }));
      return json({ events, last: events.at(-1)?.id ?? after });
    } },
  };
  if (o.dev) routes['/v1/dev/degrade'] = { POST: async (req) => {
    const b = (await req.json().catch(() => null)) as { on?: unknown } | null;
    if (typeof b?.on !== 'boolean') return json({ error: 'need {on: boolean}' }, 400);
    o.wan.degraded = b.on;
    log(b.on ? 'WAN DEGRADED (DEV chaos)' : 'WAN RESTORED from degraded (DEV chaos)');
    return json({ degraded: o.wan.degraded });
  } };
  return routes;
}
