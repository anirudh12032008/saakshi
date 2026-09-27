// Stage 6 Task 11: run the analytics pipeline (radar -> history annotation -> decision engine) via `uv`, keep the last
// good run when a run fails, sign it off (Addendum E.2), and serve the once-computed T-1 scorecard (plan §3.10, §3.11).
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AnalyticsRun, IncidentIn, ScoreRow, SignedDecision } from '@saakshi/core/analytics';
import { decisionArray } from '@saakshi/core/analytics';
import type { Directory } from '@saakshi/core/directory';
import { msg } from '@saakshi/core/enrol';
import { signer, type KeyPair } from '@saakshi/core/node';
import type { Incident, TimeRow } from '@saakshi/core/ops';
import type { Forms, ShiftExport } from '@saakshi/core/sheet';
import { cohortRows, deviceEvidence, toJsonl } from './cohort-export.ts';
import { buildIncident } from './incident-builder.ts';
import type { Routes } from './serve.ts';

class HttpError extends Error { status: number; constructor(status: number, m: string) { super(m); this.status = status; } }
const json = (body: unknown, status = 200) => Response.json(body, { status });
const sha256Hex = (b: string | Buffer) => createHash('sha256').update(b).digest('hex');

/** One `uv run python -m <module> <args>` call. Injected so tests never spawn a process. */
export type RunUv = (module: string, args: string[]) => Promise<{ code: number; stdout: string; stderr: string }>;

export function bunRunUv(o: { uv?: string; cwd: string; timeoutMs: number }): RunUv {
  return async (module, args) => {
    const proc = Bun.spawn([o.uv ?? 'uv', 'run', 'python', '-m', module, ...args], { cwd: o.cwd, stdout: 'pipe', stderr: 'pipe' });
    const timer = setTimeout(() => proc.kill(), o.timeoutMs);
    try {
      const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
      return { code: await proc.exited, stdout, stderr };
    } finally { clearTimeout(timer); }
  };
}

export interface AnalyticsRoutesOpts {
  dir: Directory; forms: Forms; controlDir: string; analyticsDir: string;
  decisionKey: KeyPair; startMs: number;
  policyPath: string; keyPath: string; registryPath?: string; drillPath: string;
  /** Every open + closed incident (for CENTRE_OUTAGE / RELAY_WAN_DOWN disruptions). */
  incidents: () => Incident[];
  /** The time audit rows for this shift's roster (approved gaps, RETEST_ELIGIBLE). */
  timeRows: () => Promise<TimeRow[]>;
  /** Candidates with a human-confirmed face flag in the Stage 5 review queue (the other half of the `escalate` evidence). */
  confirmedFaces?: () => string[];
  runUv?: RunUv;
  fetch?: typeof fetch;
  now?: () => number;
  custody?: (action: string, detail: Record<string, unknown>) => void;
}

export function analyticsRoutes(o: AnalyticsRoutesOpts): Routes {
  const f = o.fetch ?? fetch, now = o.now ?? Date.now;
  const runUv = o.runUv ?? bunRunUv({ cwd: o.analyticsDir, timeoutMs: 600_000 });
  const scratch = join(o.controlDir, 'analytics-run');
  mkdirSync(scratch, { recursive: true });

  const handle = (fn: (req: Request) => Promise<Response>) => async (req: Request) => {
    try { return await fn(req); } catch (e) { return json({ error: (e as Error).message }, e instanceof HttpError ? e.status : 500); }
  };
  const body = async (req: Request) => ((await req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;

  let running = false;
  let last: { run: AnalyticsRun; bytes: Buffer } | undefined;
  let signoff: SignedDecision | undefined;

  async function cellExport(cell: { id: string; url: string }): Promise<ShiftExport> {
    let state: string | undefined;
    try {
      const r = await f(`${cell.url}/v1/heads`, { signal: AbortSignal.timeout(5_000) });
      state = ((await r.json()) as { state?: string }).state;
    } catch (e) { throw new HttpError(409, `cell ${cell.id} unreachable: ${(e as Error).message}`); }
    if (state === 'REBUILDING') throw new HttpError(409, `cell ${cell.id} is REBUILDING`);
    try {
      const url = `${cell.url}/v1/shift?exam=${encodeURIComponent(o.dir.exam)}&shift=${encodeURIComponent(o.dir.shift)}`;
      const r = await f(url, { signal: AbortSignal.timeout(30_000) });
      if (!r.ok) throw new Error(`answered ${r.status}`);
      return (await r.json()) as ShiftExport;
    } catch (e) { throw new HttpError(409, `cell ${cell.id} unreachable: ${(e as Error).message}`); }
  }

  async function run(input: IncidentIn): Promise<AnalyticsRun> {
    const exports = await Promise.all(o.dir.cells.map(cellExport));
    const rows = cohortRows(exports, o.dir, o.forms);
    const cohortPath = join(scratch, 'cohort.jsonl');
    writeFileSync(cohortPath, toJsonl(rows));

    const time = await o.timeRows();
    const incidentIn = buildIncident({ input, time, incidents: o.incidents(), dir: o.dir, startMs: o.startMs });
    const incidentPath = join(scratch, 'incident.json');
    writeFileSync(incidentPath, JSON.stringify(incidentIn));

    const evidence = [...new Set([...deviceEvidence(exports), ...(o.confirmedFaces?.() ?? [])])].sort();
    const evidencePath = join(scratch, 'evidence.json');
    writeFileSync(evidencePath, JSON.stringify(evidence));

    const outPath = join(scratch, 'run.json');
    const args = ['--cohort', cohortPath, '--key', o.keyPath, '--policy', o.policyPath, '--incident', incidentPath, '--json', outPath, '--evidence', evidencePath];
    if (o.registryPath) args.push('--registry', o.registryPath);
    const r = await runUv('saakshi_analytics.pipeline', args);
    if (r.code !== 0) throw new HttpError(502, `pipeline failed: ${r.stderr.trim().split('\n').slice(-20).join('\n') || `exit ${r.code}`}`);

    const bytes = readFileSync(outPath);
    const run = JSON.parse(bytes.toString('utf8')) as AnalyticsRun;
    last = { run, bytes };
    signoff = undefined; // a new report needs its own sign-off
    return run;
  }

  // Scorecard: computed once, kicked off now, cached (success or failure) for every GET.
  const scorecardOnce = (async () => {
    const outPath = join(scratch, 'scorecard.json');
    const r = await runUv('saakshi_analytics.scorecard', ['--telemetry', o.drillPath, '--json', outPath]);
    if (r.code !== 0) throw new Error(`scorecard failed: ${r.stderr.trim().split('\n').slice(-20).join('\n') || `exit ${r.code}`}`);
    return JSON.parse(readFileSync(outPath, 'utf8')) as { scorecard: ScoreRow[]; precision: unknown };
  })();

  return {
    '/v1/analytics/run': { POST: handle(async (req) => {
      const input = await body(req) as unknown as IncidentIn;
      if (typeof input.id !== 'string' || !input.id) throw new HttpError(400, 'need {id, ...IncidentIn}');
      if (running) throw new HttpError(409, 'a run is already in progress');
      running = true;
      try { return json(await run(input)); }
      finally { running = false; }
    }) },
    '/v1/analytics': { GET: () => json({ run: last?.run, signoff, running }) },
    '/v1/analytics/signoff': { POST: handle(async (req) => {
      if (!last) throw new HttpError(409, 'no run to sign off');
      const b = await body(req);
      const by = typeof b.by === 'string' ? b.by.trim() : '';
      if (!by || by.length > 64) throw new HttpError(400, 'need {by} (1-64 characters)');
      const d: Omit<SignedDecision, 'sig'> = { exam: o.dir.exam, shift: o.dir.shift, reportHash: sha256Hex(last.bytes), by, at: now() };
      const sig = Buffer.from(signer(o.decisionKey)(msg(decisionArray(d)))).toString('hex');
      signoff = { ...d, sig };
      o.custody?.('analytics-signoff', { by, reportHash: d.reportHash });
      return json(signoff);
    }) },
    '/v1/scorecard': { GET: handle(async () => {
      try { const s = await scorecardOnce; return json({ rows: s.scorecard, precision: s.precision }); }
      catch (e) { return json({ error: (e as Error).message }, 503); }
    }) },
  };
}
