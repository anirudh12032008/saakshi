// Invigilator reports (plan §3.10, Task 10): a free-text report from an invigilator is classified into a closed ReportKind and
// linked (display only) to a matching open incident. Reports never act on an incident — no ack/resolve is ever called here. A
// draft notice can be redrafted by the provider (Task 9's Outbox.redraft); a human still approves it separately.
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type { Classification, InvReport, NoticeFacts, Provider } from '@saakshi/core/analytics';
import type { Directory } from '@saakshi/core/directory';
import { redact } from './llm.ts';
import type { OpsMonitor } from './ops-monitor.ts';
import type { Routes } from './serve.ts';

export interface ReportRoutesOpts {
  monitor: OpsMonitor; dir: Directory; provider: Provider; controlDir: string; now?: () => number;
}
class HttpError extends Error { status: number; constructor(status: number, m: string) { super(m); this.status = status; } }
const json = (body: unknown, status = 200) => Response.json(body, { status });
const idOf = (centre: string, at: number, text: string): string =>
  'R-' + createHash('sha256').update(`${centre}|${at}|${text}`).digest('hex').slice(0, 10);

export function reportRoutes(o: ReportRoutesOpts): Routes {
  const now = o.now ?? Date.now, path = join(o.controlDir, 'reports.jsonl');
  const items: { report: InvReport; cls: Classification }[] =
    existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  const handle = (fn: (req: Request) => Promise<Response>) => async (req: Request) => {
    try { return await fn(req); } catch (e) { return json({ error: (e as Error).message }, e instanceof HttpError ? e.status : 500); }
  };
  const body = async (req: Request) => ((await req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;

  return {
    '/v1/reports': {
      GET: () => json({ items: [...items].reverse() }),
      POST: handle(async (req) => {
        const b = await body(req);
        const centre = String(b.centre ?? '');
        if (!o.dir.centres[centre]) throw new HttpError(400, `unknown centre ${centre}`);
        const text = String(b.text ?? '');
        if (!text.trim() || text.length > 500) throw new HttpError(400, 'need {centre, by, text} (text 1–500 characters)');
        const by = String(b.by ?? '');
        if (!by.trim() || by.length > 64) throw new HttpError(400, 'need {centre, by, text} (by 1–64 characters)');
        const at = now(), redacted = redact(text, o.dir);
        const report: InvReport = { id: idOf(centre, at, redacted), at, centre, by, text: redacted };
        const open = o.monitor.incidents.all().filter((i) => !i.resolvedAt).map((i) => ({ id: i.id, kind: i.kind, centres: i.blast.centres }));
        const cls = await o.provider.classify(report, open);
        items.push({ report, cls });
        appendFileSync(path, JSON.stringify({ report, cls }) + '\n');
        return json({ report, cls });
      }),
    },
    '/v1/notices/redraft': { POST: handle(async (req) => {
      const b = await body(req);
      const id = String(b.id ?? '');
      const n = o.monitor.outbox.drafts().find((d) => d.id === id);
      if (!n) throw new HttpError(404, `no draft ${id}`);
      const inc = o.monitor.incidents.get(n.incident);
      const facts: NoticeFacts = {
        exam: o.dir.exam, shift: o.dir.shift, kind: n.kind, centres: [...n.centres], audience: n.audience,
        answersLost: inc?.blast.answersLost ?? null,
      };
      const text = await o.provider.draftNotice(facts);
      try { return json(o.monitor.outbox.redraft(id, text, o.provider.name)); }
      catch (e) { throw new HttpError(404, (e as Error).message); }
    }) },
  };
}
