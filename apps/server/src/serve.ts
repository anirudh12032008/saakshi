import type { HTMLBundle } from 'bun';
import { parseSyncReq, type HeadsRes, type NodeState, type StreamView, type SyncReq, type SyncRes } from '@saakshi/core/wire';
import type { Hub } from './sse.ts';

export interface Api {
  readonly mode: 'cell' | 'relay';
  state(): NodeState;
  sync(req: SyncReq): Promise<SyncRes | 'REBUILDING'>;
  views(): StreamView[];
}
export interface ServeOpts { port: number; hostname?: string; idleTimeout?: number; consoleHtml?: HTMLBundle }

export const heads = (api: Api): HeadsRes => ({ mode: api.mode, state: api.state(), streams: api.views() });
const json = (body: unknown, status = 200) => Response.json(body, { status });
const notFound = () => json({ error: 'not found' }, 404);

export function serve(api: Api, hub: Hub, o: ServeOpts) {
  return Bun.serve({
    port: o.port,
    hostname: o.hostname ?? '127.0.0.1',
    idleTimeout: o.idleTimeout ?? 10,
    maxRequestBodySize: 16 * 1024 * 1024,           // 500 × (4 KB line + 16 KB envelope) fits
    routes: {
      '/v1/sync': {
        POST: async (req) => {
          let body: SyncReq;
          try { body = parseSyncReq(await req.json()); } catch (e) { return json({ error: (e as Error).message }, 400); }
          const r = await api.sync(body);
          return r === 'REBUILDING' ? json({ state: 'REBUILDING' }, 503) : json(r);
        },
      },
      '/v1/heads': { GET: () => json(heads(api)) },
      '/v1/events': { GET: (req, server) => hub.response(req, server) },
      '/console': o.consoleHtml ?? notFound,
    },
    fetch: notFound,
  });
}
