// Relay routes added in Stage 3 (plan §3.2–§3.3): the paper package for seats (T−1 h), the enrolment proxy (the PIN stays sealed
// to the cell), the release to seats by SSE push with a pull fallback, the superintendent's phoned code, and DEV chaos (cut the
// link; push a forged key). The relay is untrusted: every key it passes on is checked by the seat against kc_f.
import { decodeCrockford80, randomBytes, toHex } from '@saakshi/core/bytes';
import { unwrapForCentre } from '@saakshi/core/custody';
import type { ReleaseMsg, SignedManifest } from '@saakshi/core/paper';
import type { SignedPolicy } from '@saakshi/core/policy';
import { kcf } from '@saakshi/core/protocol';
import { parseBindReq, toB64 } from '@saakshi/core/wire';
import type { Bindings, EnrolResult } from './bindings.ts';
import type { CellSend } from './forward.ts';
import type { ReleaseStore } from './release-store.ts';
import type { Routes } from './serve.ts';
import type { Hub } from './sse.ts';

/** DEV chaos: "Cut Centre 42's link" (up = false) and "Degrade Centre 42's link" (a growing delay, some requests lost). */
export class Wan {
  up = true;
  degraded = false;
  #delay = 0;
  #rand: () => number;
  #sleep: (ms: number) => Promise<unknown>;
  constructor(o: { rand?: () => number; sleep?: (ms: number) => Promise<unknown> } = {}) { this.#rand = o.rand ?? Math.random; this.#sleep = o.sleep ?? ((ms) => Bun.sleep(ms)); }
  wrap(send: CellSend): CellSend {
    return async (req) => {
      if (!this.up) throw new Error('WAN down (DEV chaos)');
      if (!this.degraded) { this.#delay = 0; return send(req); }
      this.#delay = Math.min(4_000, this.#delay + 250);                               // under httpCellSend's 5 s timeout
      await this.#sleep(this.#delay);
      if (this.#rand() < 0.3) throw new Error('WAN degraded (DEV chaos): request lost');
      return send(req);
    };
  }
}

export interface RelayOpts {
  exam: string; shift: string; centre: string;
  policy: SignedPolicy; manifest: SignedManifest; papers: Record<string, Uint8Array>; wrap: Uint8Array;
  cellUrl: string; bindings: Bindings; releases: ReleaseStore; hub: Hub; wan: Wan; dev: boolean;
  now?: () => number; log?: (line: string) => void; fetch?: typeof fetch; timeoutMs?: number;
}
const json = (body: unknown, status = 200) => Response.json(body, { status });

export function relayRoutes(o: RelayOpts): Routes {
  const now = o.now ?? Date.now, log = o.log ?? ((l: string) => console.log(l)), f = o.fetch ?? fetch;
  const pkg = { policy: o.policy, manifest: o.manifest, paper: Object.fromEntries(Object.entries(o.papers).map(([form, b]) => [form, toB64(b)])) };
  const provisional = (reason: string) => json({ provisional: true, reason }, 202);

  const routes: Routes = {
    '/v1/package': { GET: () => json(pkg) },

    '/v1/enrol': { POST: async (req) => {
      let r;
      try { r = parseBindReq(await req.json()); } catch (e) { return json({ error: (e as Error).message }, 400); }
      if (!o.wan.up) return provisional('the centre has no WAN link');
      let res: Response;
      try {
        res = await f(`${o.cellUrl}/v1/enrol`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enrols: [r] }), signal: AbortSignal.timeout(o.timeoutMs ?? 5000) });
      } catch (e) { return provisional(`the exam server is unreachable: ${(e as Error).message}`); }
      if (!res.ok) return provisional(`the exam server answered ${res.status}`);
      const out = ((await res.json()) as { results?: EnrolResult[] }).results?.[0];
      if (!out) return provisional('the exam server gave no answer');
      if (!out.ok) return json({ error: out.error, code: out.code }, out.code === 'BAD' ? 400 : 409);
      const err = o.bindings.accept(out.bind);                                     // the relay checks the cell's certificate too
      if (err) return json({ error: `the exam server's certificate does not verify here: ${err}` }, 502);
      return json({ bind: out.bind });
    } },

    '/release/current': { GET: () => json({ releases: o.releases.list() }) },
    '/v1/release/events': { GET: (req, server) => o.hub.response(req, server) },

    '/v1/release/offline': { POST: async (req) => {
      const b = (await req.json().catch(() => null)) as { code?: unknown } | null;
      const code = typeof b?.code === 'string' ? b.code.replace(/\s+/g, '') : '';
      try { decodeCrockford80(code); } catch { return json({ error: 'That code has a typo (its check symbol does not match). Read it back to control and type it again.' }, 400); }
      let k: { kF1: Uint8Array; kF2: Uint8Array };
      try { k = unwrapForCentre(code, { exam: o.exam, shift: o.shift, centre: o.centre }, o.wrap); }
      catch { return json({ error: `This code does not open ${o.centre}'s paper for ${o.shift}. Check the centre and shift with control.` }, 400); }
      const keys: Record<string, Uint8Array> = { F1: k.kF1, F2: k.kF2 };
      for (const form of ['F1', 'F2']) {
        const r: ReleaseMsg = { exam: o.exam, shift: o.shift, form, kcf: kcf(keys[form]), ts: now(), key: toHex(keys[form]), sig: '', via: 'code' };
        const err = o.releases.accept(r);
        if (err) return json({ error: `the unwrapped ${form} key does not match the manifest: ${err}` }, 500);
      }
      log(`OFFLINE-UNLOCK ${JSON.stringify({ centre: o.centre, shift: o.shift, at: new Date(now()).toISOString() })}`);
      return json({ released: ['F1', 'F2'] });
    } },
  };

  if (o.dev) {
    routes['/v1/dev/wan'] = { POST: async (req) => {
      const b = (await req.json().catch(() => null)) as { up?: unknown } | null;
      if (typeof b?.up !== 'boolean') return json({ error: 'need {up: boolean}' }, 400);
      o.wan.up = b.up;
      log(`WAN ${b.up ? 'UP' : 'DOWN'} (DEV chaos)`);
      return json({ up: o.wan.up });
    } };
    routes['/v1/dev/forge'] = { POST: () => {
      const key = randomBytes(32);
      const forged: ReleaseMsg = { exam: o.exam, shift: o.shift, form: 'F1', kcf: kcf(key), ts: now(), key: toHex(key), sig: '', via: 'code' };
      o.hub.publish('release', forged);                                           // not stored: only the seats' check stands in the way
      log('FORGED-KEY pushed to the seats (DEV chaos): every seat must reject it (kc_f)');
      return json({ published: true });
    } };
  }
  return routes;
}
