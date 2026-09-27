import { expect, test } from 'bun:test';
import type { SyncReq } from '@saakshi/core/wire';
import { LinkMonitor, statusOf } from '../src/link.ts';
import { relayOps } from '../src/relay-ops.ts';
import { Wan } from '../src/relay-routes.ts';

const req: SyncReq = { entries: [], streams: [] };

test('SYNC_LAG: a degrading link warns before it goes down; a cut is down at once; no traffic is not an alarm', () => {
  let t = 0;
  const m = new LinkMonitor({ centre: 'CEN042' });
  const view = () => m.view(t, { cut: false, degraded: true });
  expect(view()).toMatchObject({ risk: 'ok', reason: 'no traffic yet', cell: 'LIVE' });
  for (let i = 0; i < 5; i++) { t += 2_000; m.record({ at: t, ms: 40, ok: true, backlog: 0, replaying: false }); }
  expect(view()).toMatchObject({ risk: 'ok', reason: 'healthy' });
  let warnAt = 0;
  for (let i = 1; i <= 20 && !warnAt; i++) { t += 2_000 + 250 * i; m.record({ at: t, ms: 250 * i, ok: true, backlog: 3 * i, replaying: false }); if (view().risk === 'warn') warnAt = t; }
  expect(warnAt).toBeGreaterThan(0);
  expect(view().reason).toMatch(/^WAN failure likely: /);
  for (let i = 0; i < 3; i++) { t += 5_000; m.record({ at: t, ms: 5_000, ok: false, backlog: 80, replaying: false }); }
  expect(view()).toMatchObject({ risk: 'down', cell: 'unreachable', reason: expect.stringContaining('no answer from the exam server for 15 s') });
  expect(m.view(t, { cut: true, degraded: false })).toMatchObject({ risk: 'down', up: false, cut: true, reason: 'the link is cut' });
});

test('a rebuilding cell: the view says REBUILDING, with an ETA from the drain rate', () => {
  const m = new LinkMonitor({ centre: 'CEN042' });
  [1_000, 800, 600].forEach((backlog, i) => m.record({ at: 10_000 + 2_000 * i, ms: 30, ok: true, backlog, replaying: true }));
  expect(m.view(14_000, { cut: false, degraded: false })).toMatchObject({ cell: 'REBUILDING', etaMs: 6_000, backlog: 600 });
  expect(statusOf(m.view(14_000, { cut: false, degraded: false }), 14_000)).toEqual({ link: 'up', cell: 'REBUILDING', etaMs: 6_000, at: 14_000 });
});

test('Wan: cut rejects at once; degrade adds a growing delay and loses some requests; clearing it removes the delay', async () => {
  const sleeps: number[] = [];
  let r = 0.5;
  const w = new Wan({ rand: () => r, sleep: async (ms) => { sleeps.push(ms); } });
  const send = w.wrap(async () => ({ streams: [], rejected: [] }));
  w.degraded = true;
  await send(req); await send(req);
  expect(sleeps).toEqual([250, 500]);
  r = 0.1;
  await expect(send(req)).rejects.toThrow(/degraded/);
  w.degraded = false; r = 0.5;
  await send(req);
  expect(sleeps.length).toBe(3);
  w.up = false;
  await expect(send(req)).rejects.toThrow(/WAN down/);
});

test('relay ops routes: /v1/link, /v1/status for the seats, and the DEV degrade switch (logged)', async () => {
  const logs: string[] = [];
  const w = new Wan(), link = new LinkMonitor({ centre: 'CEN042' });
  const routes = relayOps({ centre: 'CEN042', link, wan: w, dev: true, now: () => 7, log: (l) => logs.push(l) });
  const get = async (p: string) => (await routes[p].GET!(new Request(`http://r${p}`), { timeout() {} })).json();
  const post = async (p: string, b: unknown) => routes[p].POST!(new Request(`http://r${p}`, { method: 'POST', body: JSON.stringify(b) }), { timeout() {} });
  expect(await get('/v1/status')).toEqual({ link: 'up', cell: 'LIVE', at: 7 });
  expect((await post('/v1/dev/degrade', { on: 'yes' })).status).toBe(400);
  expect(await (await post('/v1/dev/degrade', { on: true })).json()).toEqual({ degraded: true });
  expect([w.degraded, logs]).toEqual([true, ['WAN DEGRADED (DEV chaos)']]);
  expect(await get('/v1/status')).toEqual({ link: 'degraded', cell: 'LIVE', at: 7 });
  expect(await get('/v1/link')).toMatchObject({ centre: 'CEN042', degraded: true, risk: 'ok' });
  expect(relayOps({ centre: 'CEN042', link, wan: w, dev: false })['/v1/dev/degrade']).toBeUndefined();
});
