// Relay routes added in Stage 5 (plan §3.4–§3.5): seats' signed readiness reports (latest per candidate, for control's readiness board)
// and signed face flags (append-only faces.jsonl, for control's review queue). The relay cannot read a thumbnail: it is sealed to
// control's review key. It checks every signature against the seat's cell-certified binding.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { hexToBytes } from '@saakshi/core/bytes';
import { checkWireBind, msg } from '@saakshi/core/enrol';
import { faceArray, readinessArray, type SignedFace, type SignedReadiness } from '@saakshi/core/integrity';
import { verifier } from '@saakshi/core/node';
import { parseSignedFace, parseSignedReadiness } from '@saakshi/core/wire';
import type { Bindings } from './bindings.ts';
import type { Routes } from './serve.ts';

const json = (body: unknown, status = 200) => Response.json(body, { status });

export function relayIntegrity(o: { exam: string; shift: string; dir: string; bindings: Bindings; cellPub: Uint8Array; now?: () => number }): Routes {
  const now = o.now ?? Date.now;
  mkdirSync(o.dir, { recursive: true });
  const path = join(o.dir, 'faces.jsonl');
  const faces: (SignedFace & { id: number })[] = existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  const latest = new Map<string, SignedReadiness>();
  const pubFor = (cand: string, keyEpoch?: number): Uint8Array | undefined => {
    const wb = keyEpoch === undefined ? o.bindings.latest(cand)?.wire : o.bindings.get(cand, keyEpoch);
    if (!wb) return undefined;
    try { return hexToBytes(checkWireBind(wb, o.cellPub, verifier).pub); } catch { return undefined; }
  };
  const read = async (req: Request) => req.json().catch(() => null);

  return {
    '/v1/readiness': {
      POST: async (req) => {
        let s: SignedReadiness;
        try { s = parseSignedReadiness(await read(req)); } catch (e) { return json({ error: (e as Error).message }, 400); }
        if (s.r.exam !== o.exam || s.r.shift !== o.shift) return json({ error: 'another exam or shift' }, 400);
        const pub = pubFor(s.r.cand, s.r.keyEpoch);
        if (!pub || !verifier(pub)(msg(readinessArray(s.r)), hexToBytes(s.sig))) return json({ error: 'unknown seat key' }, 403);
        const old = latest.get(s.r.cand);
        if (!old || old.r.at < s.r.at) latest.set(s.r.cand, s);
        return json({ ok: true });
      },
      GET: () => json({ at: now(), seats: [...latest.values()].sort((a, b) => a.r.cand.localeCompare(b.r.cand)) }),
    },
    '/v1/faces': {
      POST: async (req) => {
        let s: SignedFace;
        try { s = parseSignedFace(await read(req)); } catch (e) { return json({ error: (e as Error).message }, 400); }
        if (s.f.exam !== o.exam || s.f.shift !== o.shift) return json({ error: 'another exam or shift' }, 400);
        const pub = pubFor(s.f.cand);
        if (!pub || !verifier(pub)(msg(faceArray(s.f)), hexToBytes(s.sig))) return json({ error: 'unknown seat key' }, 403);
        const dup = faces.find((x) => x.f.cand === s.f.cand && x.f.at === s.f.at);
        if (dup) return json({ id: dup.id });
        const row = { ...s, id: faces.length + 1 };
        appendFileSync(path, JSON.stringify(row) + '\n');                  // ponytail: appendFileSync without fsync; the journal entry is the durable record
        faces.push(row);
        return json({ id: row.id });
      },
      GET: (req) => {
        const after = Number(new URL(req.url).searchParams.get('after') ?? 0) || 0;
        const page = faces.filter((x) => x.id > after).slice(0, 200);
        return json({ flags: page, last: page.at(-1)?.id ?? after });
      },
    },
  };
}
