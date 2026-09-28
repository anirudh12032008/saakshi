// Control's detection loop (plan §3.10). Every second: the fleet view, each cell's new evidence events, the demo relay's link and seat
// heads, and the release status go into the rules engine. The regulator rung writes a CERT-In draft; centre-level incidents get a
// notice draft for a human to approve. Incidents are rebuilt from live state (Decision 6); incidents.json records every change.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Directory, FleetView, ReleaseStatus } from '@saakshi/core/directory';
import type { Approval, CellEvent, Incident, LinkView, Ops } from '@saakshi/core/ops';
import type { Finding } from '@saakshi/core/sheet';
import type { HeadsRes } from '@saakshi/core/wire';
import { certInHtml } from './certin.ts';
import { draftNotice, NOTICE_KINDS, Outbox } from './comms.ts';
import { Incidents } from './incidents.ts';

export interface MonitorOpts {
  dir: Directory; ops: Ops; controlDir: string; fleet: () => FleetView; relayUrl?: string; witnessUrl?: string;
  release?: () => ReleaseStatus | undefined; fetch?: typeof fetch; now?: () => number; everyMs?: number;
}

export function opsMonitor(o: MonitorOpts) {
  const f = o.fetch ?? fetch, now = o.now ?? Date.now;
  mkdirSync(join(o.controlDir, 'certin'), { recursive: true });
  const outbox = new Outbox(join(o.controlDir, 'outbox.jsonl'));
  const incidents = new Incidents(o.dir, o.ops, { regulator: (i) => {
    const rel = `certin/${i.id}.html`;
    writeFileSync(join(o.controlDir, rel), certInHtml(i, { exam: o.dir.exam, shift: o.dir.shift, now: now() }));
    return rel;
  } });
  const approvalsPath = join(o.controlDir, 'approvals.jsonl');
  const approved: Approval[] = existsSync(approvalsPath) ? readFileSync(approvalsPath, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Approval) : [];
  const moves = new Map<string, Approval>();                                           // invigilators' approvals, from HANDOVER events
  const cursor = new Map<string, number>(o.dir.cells.map((c) => [c.id, 0]));
  let relayCursor = 0, witnessCursor = 0;                                                                   // ponytail: a spare relay restarts its ids; its first events below the cursor are missed until it passes it
  let link: LinkView | undefined, findings: Finding[] = [], timer: ReturnType<typeof setTimeout> | undefined;
  const get = async <T>(url: string): Promise<T | undefined> => {
    try { const r = await f(url, { signal: AbortSignal.timeout(2_000) }); return r.ok ? ((await r.json()) as T) : undefined; } catch { return undefined; }
  };

  async function tick(): Promise<Incident[]> {
    const fl = o.fleet(), fresh: CellEvent[] = [];
    for (const c of o.dir.cells) {
      const st = fl.cells.find((x) => x.id === c.id)?.state;
      if (st !== 'LIVE') { cursor.set(c.id, 0); continue; }                           // wiped or restarting: re-read from 0 (the rules dedupe)
      let after = cursor.get(c.id) ?? 0;
      for (let page = 0; page < 20; page++) {
        const r = await get<{ events: CellEvent[]; last: number }>(`${c.url}/v1/events?after=${after}`);
        if (!r) break;
        fresh.push(...r.events);
        after = r.last;
        if (r.events.length < 500) break;
      }
      cursor.set(c.id, after);
    }
    const [lk, heads] = o.relayUrl ? await Promise.all([get<LinkView>(`${o.relayUrl}/v1/link`), get<HeadsRes>(`${o.relayUrl}/v1/heads`)]) : [undefined, undefined];
    link = lk;
    if (o.relayUrl) {                                                                  // the relay's own evidence: an old seat's ORPHANED tail stops there
      const r = await get<{ events: CellEvent[]; last: number }>(`${o.relayUrl}/v1/evidence?after=${relayCursor}`);
      if (r) { fresh.push(...r.events); relayCursor = r.last; }
    }
    if (o.witnessUrl) {                                                                // S6: the witness's alerts (equivocation, rewritten history)
      const r = await get<{ events: CellEvent[]; last: number }>(`${o.witnessUrl}/v1/evidence?after=${witnessCursor}`);
      if (r) { fresh.push(...r.events); witnessCursor = r.last; }
    }
    for (const e of fresh) if (e.code === 'HANDOVER' && e.data?.approvedBy) {
      const a: Approval = { cand: e.cand, seq: Number(e.data.fromSeq) + 1, by: String(e.data.approvedBy), at: e.at };
      moves.set(`${a.cand}/${a.seq}`, a);
    }
    const changed = incidents.evaluate({ now: now(), fleet: fl, events: fresh, link, relay: heads, release: o.release?.(), findings });
    findings = [];
    for (const i of changed) if (!i.resolvedAt && NOTICE_KINDS.has(i.kind)) outbox.draft(draftNotice(i, o.dir.exam, o.dir.shift, now()));
    if (changed.length) writeFileSync(join(o.controlDir, 'incidents.json'), JSON.stringify(incidents.all(), null, 2));
    return changed;
  }

  return {
    tick, incidents, outbox,
    link: () => link,
    fleet: () => o.fleet(),
    approvals: (): Approval[] => [...approved, ...moves.values()],
    /** Control approves a gap's (or an old-key move's) credited time; the matching incident closes. */
    approve(cand: string, seq: number, by: string): Approval {
      const who = by.trim();
      if (!who || who.length > 64 || !o.dir.cands[cand] || !Number.isSafeInteger(seq) || seq < 1) throw new Error('need {cand, seq, by}');
      const a: Approval = { cand, seq, by: who, at: now() };
      appendFileSync(approvalsPath, JSON.stringify(a) + '\n');
      approved.push(a);
      for (const i of incidents.open()) if (i.cand === cand && ((i.kind === 'GAP' && i.data.seq === seq) || (i.kind === 'HANDOVER' && Number(i.data.fromSeq) + 1 === seq))) incidents.resolve(i.id, a.at);
      return a;
    },
    noteFindings(f2: Finding[]): void { findings = [...findings, ...f2]; },
    start(): void { const loop = async () => { await tick().catch(() => {}); timer = setTimeout(loop, o.everyMs ?? 1_000); }; void loop(); },
    stop(): void { clearTimeout(timer); },
  };
}
export type OpsMonitor = ReturnType<typeof opsMonitor>;
