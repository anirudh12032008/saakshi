// Relay routes added in Stage 4: its link view for control (SYNC_LAG), the status its seats show in the banner, and DEV chaos
// ("Degrade Centre 42's link").
import { statusOf, type LinkMonitor } from './link.ts';
import type { Wan } from './relay-routes.ts';
import type { Routes } from './serve.ts';

const json = (body: unknown, status = 200) => Response.json(body, { status });
export function relayOps(o: { centre: string; link: LinkMonitor; wan: Wan; dev: boolean; now?: () => number; log?: (line: string) => void }): Routes {
  const now = o.now ?? Date.now, log = o.log ?? ((l: string) => console.log(l));
  const view = () => o.link.view(now(), { cut: !o.wan.up, degraded: o.wan.degraded });
  const routes: Routes = {
    '/v1/link': { GET: () => json(view()) },
    '/v1/status': { GET: () => json(statusOf(view(), now())) },
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
