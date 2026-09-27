// Control routes added in Stage 5 (plan §3.11): the readiness board and the face review queue, fed by polling the demo relay.
import { join } from 'node:path';
import { rosterOf, type Directory } from '@saakshi/core/directory';
import type { SignedFace, SignedReadiness } from '@saakshi/core/integrity';
import { readinessBoard } from './readiness-view.ts';
import { ReviewQueue } from './review.ts';
import type { Routes } from './serve.ts';

const json = (body: unknown, status = 200) => Response.json(body, { status });

export function integrityRoutes(o: { relayUrl: string; dir: Directory; centre: string; controlDir: string; reviewPriv: Uint8Array; retentionMs: number;
  fetch?: typeof fetch; now?: () => number; staleMs?: number }) {
  const f = o.fetch ?? fetch, now = o.now ?? Date.now;
  const queue = new ReviewQueue({ dir: join(o.controlDir, 'review'), reviewPriv: o.reviewPriv, retentionMs: o.retentionMs, now });
  let seats: SignedReadiness[] = [], reachable = false, cursor = 0, timer: ReturnType<typeof setInterval> | undefined;
  const get = async <T>(path: string): Promise<T> => {
    const r = await f(`${o.relayUrl}${path}`, { signal: AbortSignal.timeout(2_000) });
    if (!r.ok) throw new Error(`${path} answered ${r.status}`);
    return (await r.json()) as T;
  };
  async function poll(): Promise<void> {
    try {
      seats = (await get<{ seats: SignedReadiness[] }>('/v1/readiness')).seats;
      for (;;) {
        const page = await get<{ flags: (SignedFace & { id: number })[]; last: number }>(`/v1/faces?after=${cursor}`);
        for (const x of page.flags) queue.add(x);
        if (!page.flags.length || page.last <= cursor) break;
        cursor = page.last;
      }
      reachable = true;
    } catch { reachable = false; }
  }
  const routes: Routes = {
    '/v1/readiness': { GET: () => json({ at: now(), relayReachable: reachable,
      centres: [readinessBoard({ at: now(), centre: o.centre, roster: rosterOf(o.dir, o.centre), seats, staleMs: o.staleMs ?? 60_000 })] }) },
    '/v1/review': { GET: () => json({ items: queue.items() }) },
    '/v1/review/decide': { POST: async (req) => {
      const b = (await req.json().catch(() => ({}))) as { id?: unknown; decision?: unknown; by?: unknown };
      if (typeof b.id !== 'string' || (b.decision !== 'cleared' && b.decision !== 'confirmed') || typeof b.by !== 'string' || !b.by.trim() || b.by.length > 64)
        return json({ error: 'need {id, decision: cleared|confirmed, by}' }, 400);
      try { return json(queue.decide(b.id, b.decision, b.by.trim())); } catch (e) { return json({ error: (e as Error).message }, (e as Error).message === 'no such item' ? 404 : 409); }
    } },
  };
  return { routes, poll, start: (everyMs = 1_000) => { timer = setInterval(() => void poll(), everyMs); }, stop: () => clearInterval(timer) };
}
