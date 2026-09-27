import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test } from 'bun:test';
import type { AnalyticsRun } from '@saakshi/core/analytics';
import type { Directory } from '@saakshi/core/directory';
import { newKeyPair } from '@saakshi/core/node';
import type { Incident, TimeRow } from '@saakshi/core/ops';
import type { Forms, ShiftExport } from '@saakshi/core/sheet';
import { analyticsRoutes, type RunUv } from '../src/analytics-routes.ts';
import type { Routes } from '../src/serve.ts';

const NOOP = {} as Parameters<NonNullable<Routes[string]['GET']>>[1];
const post = (routes: Routes, path: string, body: unknown) => routes[path].POST!(new Request('http://x', { method: 'POST', body: JSON.stringify(body) }), NOOP);
const get = (routes: Routes, path: string) => routes[path].GET!(new Request('http://x'), NOOP);

const dir: Directory = {
  v: 1, exam: 'DEMO-2026', shift: 'S1', durationMs: 180 * 60_000, demoCentre: 'CEN001', issuedAt: 0,
  cells: [{ id: 'CELL-A', url: 'http://cell-a', keyId: 'k1', pub: '', cert: '' }],
  centres: { CEN001: { cell: 'CELL-A' } },
  cands: { C0001: { pseud: 'p1', form: 'F1', centre: 'CEN001' } as Directory['cands'][string] },
};
const forms: Forms = { F1: ['I01'] };
const emptyExport: ShiftExport = { cell: 'CELL-A', exam: 'DEMO-2026', shift: 'S1', sheets: [] };

let scratch: string;
beforeEach(() => { scratch = mkdtempSync(join(tmpdir(), 'analytics-routes-')); });
afterEach(() => {});

function opts(o: {
  fetchImpl?: typeof fetch; runUv?: RunUv; incidents?: Incident[]; time?: TimeRow[];
} = {}) {
  const controlDir = mkdtempSync(join(tmpdir(), 'control-'));
  writeFileSync(join(controlDir, 'policy.json'), '{}');
  writeFileSync(join(controlDir, 'key.json'), '{}');
  writeFileSync(join(controlDir, 'drill.json'), '[]');
  const custody: { action: string; detail: Record<string, unknown> }[] = [];
  return {
    routes: analyticsRoutes({
      dir, forms, controlDir, analyticsDir: scratch, decisionKey: newKeyPair(), startMs: 0,
      policyPath: join(controlDir, 'policy.json'), keyPath: join(controlDir, 'key.json'), drillPath: join(controlDir, 'drill.json'),
      incidents: () => o.incidents ?? [], timeRows: async () => o.time ?? [],
      fetch: (o.fetchImpl ?? defaultFetch) as typeof fetch, runUv: o.runUv,
      custody: (action, detail) => custody.push({ action, detail }),
    }),
    custody,
  };
}

const defaultFetch = (async (url: string) => {
  if (url.includes('/v1/heads')) return Response.json({ mode: 'cell', state: 'LIVE', streams: [] });
  if (url.includes('/v1/shift')) return Response.json(emptyExport);
  return Response.json({ error: 'not found' }, { status: 404 });
}) as unknown as typeof fetch;

function outRun(): AnalyticsRun {
  return {
    v: 1, incident: 'INC-1', headline: 'Compensated 0 · Re-tested 0 · Re-conducted 0 centres · Spared 0 · ₹ avoided 0',
    inputs: { rows: 0, cands: 0, centres: 0, evidence: 0, sha256: {} },
    flags: [], history: { annotated: 0, corroborated: 0 },
    summary: { compensated: 0, retested: 0, reconductedCentres: 0, reconductedCentreShifts: 0, reconductedCandidates: 0, baseline: 0, spared: 0, inrAvoided: 0, extraMinTotal: 0, rescored: 0, openTickets: 0 },
    decision: {}, report: 'report text',
  };
}

const runUvOk: RunUv = async (module, args) => {
  if (module === 'saakshi_analytics.pipeline') {
    const outPath = args[args.indexOf('--json') + 1];
    writeFileSync(outPath, JSON.stringify(outRun()));
    return { code: 0, stdout: '', stderr: '' };
  }
  if (module === 'saakshi_analytics.scorecard') {
    const outPath = args[args.indexOf('--json') + 1];
    writeFileSync(outPath, JSON.stringify({ scorecard: [{ centre: 'CEN001', risk: 0.1, decision: 'allot', reasons: [], rank: 1, note: '', telemetry: {} }], precision: { threshold: 0.2 } }));
    return { code: 0, stdout: '', stderr: '' };
  }
  throw new Error(`unexpected module ${module}`);
};

test('a missing/unreachable cell is 409 and never runs the pipeline', async () => {
  const noPipeline: RunUv = async (module, args) => module === 'saakshi_analytics.pipeline' ? Promise.reject(new Error('must not run')) : runUvOk(module, args);
  const { routes } = opts({ fetchImpl: (async () => { throw new Error('ECONNREFUSED'); }) as unknown as typeof fetch, runUv: noPipeline });
  const res = await post(routes, '/v1/analytics/run', { id: 'INC-1' });
  expect(res.status).toBe(409);
  const body = await res.json();
  expect(body.error).toMatch(/CELL-A/);
});

test('a REBUILDING cell is 409', async () => {
  const fetchImpl = (async (url: string) => (url.includes('/v1/heads') ? Response.json({ state: 'REBUILDING' }) : Response.json(emptyExport))) as unknown as typeof fetch;
  const noPipeline: RunUv = async (module, args) => module === 'saakshi_analytics.pipeline' ? Promise.reject(new Error('must not run')) : runUvOk(module, args);
  const { routes } = opts({ fetchImpl, runUv: noPipeline });
  const res = await post(routes, '/v1/analytics/run', { id: 'INC-1' });
  expect(res.status).toBe(409);
  expect((await res.json()).error).toMatch(/REBUILDING/);
});

test('a successful run returns the AnalyticsRun and GET reflects it', async () => {
  const { routes } = opts({ runUv: runUvOk });
  const res = await post(routes, '/v1/analytics/run', { id: 'INC-1' });
  expect(res.status).toBe(200);
  const run = await res.json();
  expect(run.incident).toBe('INC-1');

  const gres = await get(routes, '/v1/analytics');
  const state = await gres.json();
  expect(state.run.incident).toBe('INC-1');
  expect(state.running).toBe(false);
  expect(state.signoff).toBeUndefined();
});

test('Review Focus #4: a failing pipeline is 502 and keeps the last good run', async () => {
  let fail = false;
  const flaky: RunUv = (module, args) => {
    if (module === 'saakshi_analytics.pipeline' && fail) return Promise.resolve({ code: 1, stdout: '', stderr: 'boom: pipeline crashed' });
    return runUvOk(module, args);
  };
  const { routes } = opts({ runUv: flaky });
  const ok = await post(routes, '/v1/analytics/run', { id: 'INC-1' });
  expect(ok.status).toBe(200);

  fail = true;
  const bad = await post(routes, '/v1/analytics/run', { id: 'INC-2' });
  expect(bad.status).toBe(502);
  expect((await bad.json()).error).toMatch(/boom/);

  const gres = await get(routes, '/v1/analytics');
  const state = await gres.json();
  expect(state.run.incident).toBe('INC-1'); // the previous good run, untouched
  expect(state.running).toBe(false);
});

test('sign-off needs a run first, then signs the exact run.json bytes', async () => {
  const { routes } = opts({ runUv: runUvOk });
  const noRun = await post(routes, '/v1/analytics/signoff', { by: 'CONTROL-1' });
  expect(noRun.status).toBe(409);

  await post(routes, '/v1/analytics/run', { id: 'INC-1' });
  const res = await post(routes, '/v1/analytics/signoff', { by: 'CONTROL-1' });
  expect(res.status).toBe(200);
  const so = await res.json();
  expect(so.by).toBe('CONTROL-1');
  expect(so.exam).toBe('DEMO-2026');
  expect(typeof so.reportHash).toBe('string');
  expect(so.reportHash).toHaveLength(64);
});

test('sign-off rejects a bad by', async () => {
  const { routes } = opts({ runUv: runUvOk });
  await post(routes, '/v1/analytics/run', { id: 'INC-1' });
  const res = await post(routes, '/v1/analytics/signoff', { by: '' });
  expect(res.status).toBe(400);
});

test('a second run in progress is 409 (guarded by the running flag)', async () => {
  let resolveFirst!: () => void;
  const slow: RunUv = (module, args) => {
    if (module === 'saakshi_analytics.pipeline') {
      return new Promise((resolve) => {
        resolveFirst = () => { const outPath = args[args.indexOf('--json') + 1]; writeFileSync(outPath, JSON.stringify(outRun())); resolve({ code: 0, stdout: '', stderr: '' }); };
      });
    }
    return runUvOk(module, args);
  };
  const { routes } = opts({ runUv: slow });
  const p1 = post(routes, '/v1/analytics/run', { id: 'INC-1' });
  await Bun.sleep(10);
  const res2 = await post(routes, '/v1/analytics/run', { id: 'INC-2' });
  expect(res2.status).toBe(409);
  resolveFirst();
  await p1;
});

test('scorecard: 200 with rows and precision on success', async () => {
  const { routes } = opts({ runUv: runUvOk });
  const res = await get(routes, '/v1/scorecard');
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.rows[0].centre).toBe('CEN001');
  expect(body.precision).toBeDefined();
});

test('scorecard: 503 if uv failed', async () => {
  const failScorecard: RunUv = async (module, args) => module === 'saakshi_analytics.scorecard' ? { code: 1, stdout: '', stderr: 'no uv' } : runUvOk(module, args);
  const { routes } = opts({ runUv: failScorecard });
  const res = await get(routes, '/v1/scorecard');
  expect(res.status).toBe(503);
});
