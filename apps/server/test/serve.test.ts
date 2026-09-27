import { afterEach, expect, test } from 'bun:test';
import type { NodeState, StreamView, SyncReq, SyncRes } from '@saakshi/core/wire';
import { serve, type Api } from '../src/serve.ts';
import { Hub } from '../src/sse.ts';

const servers: { stop(force?: boolean): void }[] = [];
afterEach(() => { for (const s of servers.splice(0)) s.stop(true); });

function fake(state: NodeState = 'LIVE'): Api & { got: SyncReq[] } {
  const got: SyncReq[] = [];
  return {
    mode: 'cell', got, state: () => state, views: (): StreamView[] => [],
    async sync(r: SyncReq): Promise<SyncRes | 'REBUILDING'> { got.push(r); return state === 'REBUILDING' && !r.replay ? 'REBUILDING' : { streams: [], rejected: [] }; },
  };
}
function start(api: Api, hub = new Hub(() => ({ mode: api.mode, state: api.state(), streams: [] })), idleTimeout?: number) {
  const s = serve(api, hub, { port: 0, hostname: '127.0.0.1', idleTimeout });
  servers.push(s);
  return { url: `http://127.0.0.1:${s.port}`, hub };
}
async function sse(url: string, lastId?: string) {
  const res = await fetch(url, { headers: lastId ? { 'last-event-id': lastId } : {} });
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = '';
  return {
    res,
    async until(pred: (b: string) => boolean, ms = 3000): Promise<string> {
      const t0 = Date.now();
      while (!pred(buf)) {
        const left = ms - (Date.now() - t0);
        if (left <= 0) throw new Error(`timed out; got: ${buf}`);
        const r = await Promise.race([reader.read(), Bun.sleep(left).then(() => null)]);
        if (r === null) continue;
        if (r.done) throw new Error(`stream closed; got: ${buf}`);
        buf += dec.decode(r.value);
      }
      return buf;
    },
    close: () => reader.cancel(),
  };
}
const post = (url: string, body: string) => fetch(`${url}/v1/sync`, { method: 'POST', headers: { 'content-type': 'application/json' }, body });

test('POST /v1/sync: 400 on bad JSON or shape, 200 with the result, 503 while REBUILDING (replay still accepted)', async () => {
  const api = fake();
  const { url } = start(api);
  expect((await post(url, '{nope')).status).toBe(400);
  const bad = await post(url, JSON.stringify({ entries: 'x' }));
  expect(bad.status).toBe(400);
  expect((await bad.json()).error).toMatch(/^sync:/);
  const good = await post(url, JSON.stringify({ entries: [], streams: [] }));
  expect(good.status).toBe(200);
  expect(await good.json()).toEqual({ streams: [], rejected: [] });

  const { url: rb } = start(fake('REBUILDING'));
  const r = await post(rb, JSON.stringify({ entries: [], streams: [] }));
  expect(r.status).toBe(503);
  expect(await r.json()).toEqual({ state: 'REBUILDING' });
  expect((await post(rb, JSON.stringify({ entries: [], streams: [], replay: true }))).status).toBe(200);
});

test('GET /v1/heads, 404 elsewhere, and no /console without a page', async () => {
  const { url } = start(fake());
  expect(await (await fetch(`${url}/v1/heads`)).json()).toEqual({ mode: 'cell', state: 'LIVE', streams: [] });
  expect((await fetch(`${url}/nope`)).status).toBe(404);
  expect((await fetch(`${url}/console`)).status).toBe(404);
});

test('SSE: retry, snapshot, live events with ids, and :ping frames', async () => {
  const api = fake();
  const hub = new Hub(() => ({ mode: 'cell', state: 'LIVE', streams: [] }), { pingMs: 100 });
  const { url } = start(api, hub);
  const s = await sse(`${url}/v1/events`);
  expect(s.res.headers.get('content-type')).toBe('text/event-stream');
  await s.until((b) => b.includes('event: snapshot'));
  hub.publish('stream', { cand: 'C0001', head: 1 });
  const b = await s.until((x) => x.includes('event: stream') && x.includes(':ping'));
  expect(b.startsWith('retry: 2000\n\n')).toBe(true);
  expect(b).toContain(`id: ${hub.boot}-1\nevent: stream\ndata: {"cand":"C0001","head":1}`);
  await s.close();
});

test('SSE outlives Bun\'s idle timeout (server.timeout(req, 0))', async () => {
  const hub = new Hub(() => ({}), { pingMs: 60_000 });
  const { url } = start(fake(), hub, 2);
  const s = await sse(`${url}/v1/events`);
  await s.until((b) => b.includes('event: snapshot'));
  await Bun.sleep(6_000);                                   // well past idleTimeout: 2
  hub.publish('state', { state: 'LIVE' });
  await s.until((b) => b.includes('event: state'));
  await s.close();
});

test('Last-Event-ID replays only the missed events over HTTP', async () => {
  const hub = new Hub(() => ({}));
  const { url } = start(fake(), hub);
  hub.publish('stream', { n: 1 });
  const seen = hub.lastId;
  hub.publish('stream', { n: 2 });
  hub.publish('stream', { n: 3 });
  const s = await sse(`${url}/v1/events`, seen);
  const b = await s.until((x) => x.includes('{"n":3}'));
  expect(b).not.toContain('{"n":1}');
  expect(b).not.toContain('event: snapshot');
  expect(b).toContain('{"n":2}');
  await s.close();
});
