// MODE=witness (S6, protocol addendum F): poll control's GET /v1/sth with the last size it saw, check the authority signature and the
// RFC 9162 consistency proof, and cosign only heads that extend what it already cosigned. Anything else is an alert, which control's
// monitor reads from GET /v1/evidence like a cell's evidence and turns into a TAMPER incident.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { hexToBytes, toHex, utf8 } from '@saakshi/core/bytes';
import { canon } from '@saakshi/core/canon';
import { sthId, sthMessage, type SignedSth } from '@saakshi/core/log';
import { verifyConsistency } from '@saakshi/core/merkle';
import { newKeyPair, signer, verifier, type KeyPair } from '@saakshi/core/node';
import type { CellEvent } from '@saakshi/core/ops';
import type { SthHead } from './seal.ts';

export interface Cosig { sthId: string; size: number; root: string; ts: number; sig: string }
export interface Alert { at: number; reason: 'bad-signature' | 'shrunk' | 'equivocation' | 'inconsistent'; detail: string; seen: SignedSth; last?: SignedSth }
export interface WitnessState { last?: SignedSth; cosigs: Cosig[]; alerts: Alert[] }
export interface WitnessOpts { authorityPub: Uint8Array; key: KeyPair; now?: () => number }

/** F.2: the witness signs `["cosig",sthId,ts]`. */
export const cosigMessage = (id: string, ts: number): Uint8Array => utf8(canon(['cosig', id, ts]));

export function witnessStep(s: WitnessState, h: SthHead, o: WitnessOpts): WitnessState {
  const at = (o.now ?? Date.now)(), { sth } = h, last = s.last?.sth;
  const alert = (reason: Alert['reason'], detail: string): WitnessState => ({ ...s, alerts: [...s.alerts, { at, reason, detail, seen: h.sth, last: s.last }] });
  if (!verifier(o.authorityPub)(sthMessage(sth.sth), hexToBytes(sth.sig))) return alert('bad-signature', `STH of size ${sth.sth.size} is not signed by the exam authority`);
  if (last) {
    if (sth.sth.size < last.size) return alert('shrunk', `the log shrank from ${last.size} to ${sth.sth.size} leaves`);
    if (sth.sth.size === last.size && sth.sth.root !== last.root) return alert('equivocation', `two signed roots for ${last.size} leaves`);
    if (sth.sth.size === last.size) return s;                                   // nothing new
    if (!verifyConsistency(last.size, sth.sth.size, h.consistency.map(hexToBytes), hexToBytes(last.root), hexToBytes(sth.sth.root)))
      return alert('inconsistent', `the ${sth.sth.size}-leaf head does not extend the ${last.size}-leaf head the witness cosigned: history was rewritten`);
  }
  const id = sthId(sth.sth);
  return { ...s, last: sth, cosigs: [...s.cosigs, { sthId: id, size: sth.sth.size, root: sth.sth.root, ts: at, sig: toHex(signer(o.key)(cosigMessage(id, at))) }] };
}

/** The process: state and key under dir (DEV: the key is generated on first start). */
export function witness(o: { dir: string; controlUrl: string; authorityPub: Uint8Array; exam: string; shift: string; fetch?: typeof fetch; now?: () => number }) {
  const f = o.fetch ?? fetch;
  mkdirSync(o.dir, { recursive: true });
  const keyPath = join(o.dir, 'witness-key.json'), statePath = join(o.dir, `witness-${o.exam}-${o.shift}.json`);
  if (!existsSync(keyPath)) { const k = newKeyPair(); writeFileSync(keyPath, JSON.stringify({ priv: toHex(k.priv), pub: toHex(k.pub) })); }
  const k = JSON.parse(readFileSync(keyPath, 'utf8')) as { priv: string; pub: string };
  const key = { priv: hexToBytes(k.priv), pub: hexToBytes(k.pub) };
  let state: WitnessState = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : { cosigs: [], alerts: [] };
  let timer: ReturnType<typeof setTimeout> | undefined;

  async function tick(): Promise<void> {
    const r = await f(`${o.controlUrl}/v1/sth?from=${state.last?.sth.size ?? 0}`, { signal: AbortSignal.timeout(5_000) }).catch(() => undefined);
    if (!r?.ok) return;                                                           // not sealed yet, or control down: try again
    const next = witnessStep(state, (await r.json()) as SthHead, { authorityPub: o.authorityPub, key, now: o.now });
    if (next !== state) { state = next; writeFileSync(statePath, JSON.stringify(state, null, 2)); }
  }
  const events = (): CellEvent[] => state.alerts.map((a, i) => ({
    id: i + 1, at: a.at, cell: 'witness', code: 'EQUIVOCATION', cand: '', centre: '', seq: a.seen.sth.size, reason: `${a.reason}: ${a.detail}`,
  }));
  const json = (b: unknown) => Response.json(b);
  return {
    tick,
    state: () => state,
    start(everyMs = 2_000): void { const loop = async () => { await tick().catch(() => {}); timer = setTimeout(loop, everyMs); }; void loop(); },
    stop(): void { clearTimeout(timer); },
    routes: {
      '/v1/witness': { GET: () => json({ pub: k.pub, last: state.last, cosig: state.cosigs.at(-1), cosigs: state.cosigs.length, alerts: state.alerts }) },
      '/v1/evidence': { GET: (req: Request) => {
        const after = Number(new URL(req.url).searchParams.get('after') ?? 0), ev = events();
        return json({ events: ev.filter((e) => e.id > after), last: ev.length });
      } },
    },
  };
}
