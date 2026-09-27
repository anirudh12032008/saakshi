// Control routes added in Stage 4 (plan §3.7, §3.10–§3.11): incidents and the ladder, CERT-In drafts, credited-time approvals, the time
// audit, the labelled chaos buttons (through the demo supervisor, tools/stack.ts), the two-store archive and the signed purge, the
// public status and the notice outbox. Errors are {error} with Stage 2's status rules.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Directory } from '@saakshi/core/directory';
import { sthId } from '@saakshi/core/log';
import { signer, verifier, type KeyPair } from '@saakshi/core/node';
import type { Incident, Ops, Severity } from '@saakshi/core/ops';
import type { Forms, ShiftExport, SthRecord } from '@saakshi/core/sheet';
import { signPurge, verifyArchive, writeArchive, type ArchiveBundle } from './archive.ts';
import type { OpsMonitor } from './ops-monitor.ts';
import type { Routes } from './serve.ts';
import { publicStatus } from './status-view.ts';
import { timeAudit } from './time-audit.ts';

export interface OpsRoutesOpts {
  monitor: OpsMonitor; dir: Directory; ops: Ops; controlDir: string; authority: KeyPair;
  cellUrl: string; relayUrl: string; stackUrl?: string; forms: Forms; roster: string[]; recPath: string; stores: [string, string];
  custody: (action: string, detail: Record<string, unknown>) => void; fetch?: typeof fetch; now?: () => number;
}
class HttpError extends Error { status: number; constructor(status: number, m: string) { super(m); this.status = status; } }
const json = (body: unknown, status = 200) => Response.json(body, { status });
const RANK: Record<Severity, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };

export function opsRoutes(o: OpsRoutesOpts): Routes {
  const f = o.fetch ?? fetch, now = o.now ?? Date.now, m = o.monitor;
  const handle = (fn: (req: Request) => Promise<Response>) => async (req: Request) => {
    try { return await fn(req); } catch (e) { return json({ error: (e as Error).message }, e instanceof HttpError ? e.status : 500); }
  };
  const body = async (req: Request) => ((await req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
  async function upstream<T>(url: string, payload?: unknown): Promise<T> {
    let r: Response;
    try { r = await f(url, { method: payload === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json' }, body: payload === undefined ? undefined : JSON.stringify(payload), signal: AbortSignal.timeout(10_000) }); }
    catch (e) { throw new HttpError(502, `${new URL(url).origin} unreachable: ${(e as Error).message}`); }
    if (!r.ok) throw new HttpError(502, `${new URL(url).pathname} answered ${r.status}: ${await r.text()}`);
    return (await r.json()) as T;
  }
  const stack = (path: string, payload: unknown) => {
    if (!o.stackUrl) throw new HttpError(409, 'chaos needs the demo supervisor: start the demo with `bun tools/stack.ts` (it sets STACK_URL)');
    return upstream<Record<string, unknown>>(`${o.stackUrl}${path}`, payload);
  };
  const cellOf = (x: unknown): string => { if (typeof x !== 'string' || !o.dir.cells.some((c) => c.id === x)) throw new HttpError(400, 'need {cell: one of the directory\'s cells}'); return x; };
  const exportNow = () => upstream<ShiftExport>(`${o.cellUrl}/v1/shift?exam=${encodeURIComponent(o.dir.exam)}&shift=${encodeURIComponent(o.dir.shift)}`);
  const sealed = () => {
    const rec = existsSync(o.recPath) ? (JSON.parse(readFileSync(o.recPath, 'utf8')) as SthRecord) : undefined;
    const sth = rec?.sths.at(-1);
    if (!rec || !sth) throw new HttpError(409, 'seal the shift first');
    return { rec, sth };
  };
  const verify = () => { const { sth } = sealed(); return verifyArchive(o.stores, { exam: o.dir.exam, shift: o.dir.shift, sth }, verifier(o.authority.pub)); };

  return {
    '/v1/incidents': { GET: () => {
      const all = m.incidents.all();
      const open = all.filter((i) => !i.resolvedAt).sort((a, b) => RANK[a.severity] - RANK[b.severity] || a.openedAt - b.openedAt);
      const closed = all.filter((i) => i.resolvedAt).sort((a, b) => b.resolvedAt! - a.resolvedAt!).slice(0, 20);
      return json({ at: now(), demo: o.ops.demo, ladderMs: o.ops.ladderMs, incidents: [...open, ...closed] });
    } },
    '/v1/incidents/ack': { POST: handle(async (req) => {
      const b = await body(req);
      if (typeof b.id !== 'string' || !m.incidents.get(b.id)) throw new HttpError(404, `no incident ${String(b.id)}`);
      let i: Incident;
      try { i = m.incidents.ack(b.id, String(b.by ?? ''), now()); } catch (e) { throw new HttpError(400, (e as Error).message); }
      o.custody('incident-ack', { id: i.id, kind: i.kind, by: i.ack!.by, rung: i.ack!.rung });
      return json(i);
    }) },
    '/v1/incidents/resolve': { POST: handle(async (req) => {
      const b = await body(req);
      if (typeof b.id !== 'string' || !m.incidents.get(b.id)) throw new HttpError(404, `no incident ${String(b.id)}`);
      try { return json(m.incidents.resolve(b.id, now())); } catch (e) { throw new HttpError(409, (e as Error).message); }
    }) },
    '/v1/incidents/certin': { GET: handle(async (req) => {
      const i = m.incidents.get(new URL(req.url).searchParams.get('id') ?? '');
      if (!i?.certIn) throw new HttpError(404, 'no CERT-In draft for that incident');
      return new Response(readFileSync(join(o.controlDir, i.certIn), 'utf8'), { headers: { 'content-type': 'text/html; charset=utf-8' } });
    }) },
    '/v1/gaps/approve': { POST: handle(async (req) => {
      const b = await body(req);
      let a;
      try { a = m.approve(String(b.cand ?? ''), Number(b.seq), String(b.by ?? '')); } catch (e) { throw new HttpError(400, (e as Error).message); }
      o.custody('credit-approved', { ...a });
      return json(a);
    }) },
    '/v1/time': { GET: handle(async () => {
      const exp = await exportNow();
      const rows = exp.sheets.filter((s) => o.roster.includes(s.ctx.cand)).map((s) => timeAudit(s, o.forms[s.form] ?? [], m.approvals(), o.ops));
      return json({ rows });
    }) },
    '/v1/link': { GET: () => { const l = m.link(); return l ? json(l) : json({ error: 'the relay\'s link view is unavailable' }, 502); } },
    '/v1/chaos/plug': { POST: handle(async (req) => {
      const b = await body(req), cell = cellOf(b.cell), wipe = b.wipe === true;
      const out = await stack('/kill', { node: cell, wipe });
      o.custody('chaos-plug', { cell, wipe, note: `DEV chaos: "Pull the plug on ${cell}"${wipe ? ' and delete its database' : ''}` });
      return json(out);
    }) },
    '/v1/chaos/restart': { POST: handle(async (req) => {
      const cell = cellOf((await body(req)).cell);
      const out = await stack('/start', { node: cell });
      o.custody('chaos-restart', { cell });
      return json(out);
    }) },
    '/v1/chaos/spare': { POST: handle(async () => {
      const killed = await stack('/kill', { node: 'relay', wipe: true });
      const started = await stack('/start', { node: 'relay' });
      o.custody('chaos-spare-relay', { note: 'DEV chaos: the centre relay replaced by a spare with an empty database; seats resend from their journals' });
      return json({ ...killed, ...started });
    }) },
    '/v1/chaos/degrade': { POST: handle(async (req) => {
      const b = await body(req);
      if (typeof b.on !== 'boolean') throw new HttpError(400, 'need {on: boolean}');
      const out = await upstream<{ degraded: boolean }>(`${o.relayUrl}/v1/dev/degrade`, { on: b.on });
      o.custody('chaos-degrade', { centre: o.dir.demoCentre, on: b.on });
      return json(out);
    }) },
    '/v1/archive': { POST: handle(async () => {
      const { rec, sth } = sealed();
      const bundle: ArchiveBundle = { v: 1, exam: o.dir.exam, shift: o.dir.shift, sth, leaves: rec.leaves.slice(0, sth.sth.size), export: await exportNow() };
      const t0 = performance.now();
      const written = writeArchive(o.stores, bundle);
      const writtenMs = Math.round(performance.now() - t0);
      const report = { ...verify(), writtenMs };
      o.custody('archive-write', { sthId: sthId(sth.sth), size: sth.sth.size, stores: written.map((w) => ({ store: w.store, sha256: w.sha256, detail: w.detail })), ok: report.ok });
      return json(report);
    }) },
    '/v1/archive/verify': { GET: handle(async () => json(verify())) },
    '/v1/archive/purge': { POST: handle(async () => {
      const report = verify();
      if (!report.ok) return json({ error: 'both archive stores must verify against the signed register head before any purge', report }, 409);
      const { sth } = sealed();
      const order = signPurge({ exam: o.dir.exam, shift: o.dir.shift, sthId: sthId(sth.sth), ts: now() }, signer(o.authority));
      const out = await upstream<{ purged: number }>(`${o.relayUrl}/v1/purge`, order);
      o.custody('purge-ordered', { sthId: order.order.sthId, purged: out.purged });
      return json({ purged: out.purged, report });
    }) },
    '/v1/status/public': { GET: () => json(publicStatus({ exam: o.dir.exam, shift: o.dir.shift, now: now(), fleet: m.fleet(), incidents: m.incidents.all(), notices: m.outbox.sent() })) },
    '/v1/notices': { GET: () => json({ drafts: m.outbox.drafts(), sent: m.outbox.sent() }) },
    '/v1/notices/approve': { POST: handle(async (req) => {
      const b = await body(req);
      let n;
      try { n = m.outbox.approve(String(b.id ?? ''), String(b.by ?? ''), now()); } catch (e) { throw new HttpError(400, (e as Error).message); }
      o.custody('notice-sent', { id: n.id, channels: n.channels, audience: n.audience, centres: n.centres });
      return json(n);
    }) },
  };
}
