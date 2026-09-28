// MODE=control (Stage 2 minimum): seal the shift, audit, reconcile, the DEV rogue button, proofs, evidence packs, /verify.
// State is plain files under o.dir (see the plan's Global Constraints). GET /v1/sth feeds the witness (S6, MODE=witness).
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type { HTMLBundle } from 'bun';
import type { CellCert } from '@saakshi/core/handover';
import type { KeyPair } from '@saakshi/core/node';
import type { Finding, Forms, Proof, ShiftExport, SthRecord, Trust } from '@saakshi/core/sheet';
import type { HeadsRes } from '@saakshi/core/wire';
import { audit } from './audit.ts';
import { buildPack } from './evidence.ts';
import { reconcile } from './recon.ts';
import { headFrom, proofFor, seal } from './seal.ts';
import { verifyHtml } from './verify-build.ts';

export interface ControlOpts {
  dir: string; authority: KeyPair; trust: Trust; forms: Forms;
  formOf: (cand: string) => string | undefined; pseud: (cand: string) => string;
  roster: string[]; centre: string; exam: string; shift: string;
  cellUrl: string; relayUrl: string; now?: () => number;
  /** Stage 3: the demo cell's enrolled seat keys (`${cand}/${keyEpoch}` → pub), each already checked against that cell's certificate. */
  seatKeys?: () => Promise<Record<string, string>>;
  /** Addendum C.1: every cell's key certificate, for proofs. */
  cells?: CellCert[];
  /** Stage 4: every audit's findings go to the incident engine (TAMPER). */
  onFindings?: (f: Finding[]) => void;
  /** S6: the witness, whose cosign status GET /v1/witness relays. */
  witnessUrl?: string;
}

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
const json = (body: unknown, status = 200) => Response.json(body, { status });
const sha = (s: string | Uint8Array) => createHash('sha256').update(s).digest('hex');

export function controlRoutes(o: ControlOpts, page: HTMLBundle) {
  const now = o.now ?? Date.now;
  const tag = `${o.exam}-${o.shift}`;
  mkdirSync(join(o.dir, 'archive'), { recursive: true });
  mkdirSync(join(o.dir, 'evidence'), { recursive: true });
  const recPath = join(o.dir, `sth-${tag}.json`), custodyPath = join(o.dir, 'custody.jsonl');
  const archivePath = (size: number) => join(o.dir, 'archive', `${tag}-${size}.json`);
  const readJson = <T>(p: string): T | undefined => (existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as T) : undefined);
  const readRec = () => readJson<SthRecord>(recPath);
  const readArchive = (rec?: SthRecord) => { const size = rec?.sths.at(-1)?.sth.size; return size === undefined ? undefined : readJson<ShiftExport>(archivePath(size)); };
  const custody = (action: string, detail: Record<string, unknown>) =>
    appendFileSync(custodyPath, JSON.stringify({ at: new Date(now()).toISOString(), actor: 'control (DEV)', action, exam: o.exam, shift: o.shift, ...detail }) + '\n');
  const custodyLines = () => (existsSync(custodyPath) ? readFileSync(custodyPath, 'utf8').split('\n').filter(Boolean) : []);

  async function upstream<T>(url: string, init?: RequestInit): Promise<T> {
    let r: Response;
    try { r = await fetch(url, { ...init, signal: AbortSignal.timeout(5000) }); }
    catch (e) { throw new HttpError(502, `${new URL(url).origin} unreachable: ${(e as Error).message}`); }
    if (!r.ok) throw new HttpError(502, `${new URL(url).pathname} answered ${r.status}: ${await r.text()}`);
    return (await r.json()) as T;
  }
  const cellExport = () => upstream<ShiftExport>(`${o.cellUrl}/v1/shift?exam=${encodeURIComponent(o.exam)}&shift=${encodeURIComponent(o.shift)}`);
  const relayHeads = () => upstream<HeadsRes>(`${o.relayUrl}/v1/heads`);
  const seats = async (): Promise<Record<string, string> | undefined> => {
    if (!o.seatKeys) return undefined;
    try { return await o.seatKeys(); } catch (e) { throw new HttpError(502, `the cell's bindings are unavailable: ${(e as Error).message}`); }
  };
  const trustNow = async (): Promise<Trust> => { const s = await seats(); return s ? { ...o.trust, seats: { ...o.trust.seats, ...s } } : o.trust; };
  const handle = (fn: (req: Request) => Promise<Response>) => async (req: Request): Promise<Response> => {
    try { return await fn(req); } catch (e) { return json({ error: (e as Error).message }, e instanceof HttpError ? e.status : 500); }
  };
  const candOf = (req: Request): string => {
    const c = new URL(req.url).searchParams.get('cand') ?? '';
    if (!o.roster.includes(c)) throw new HttpError(400, `unknown candidate ${c || '(none)'}`);
    return c;
  };
  async function findings(): Promise<Finding[]> {
    const rec = readRec();
    const [cell, relay] = await Promise.all([cellExport(), relayHeads()]);
    return audit({ cell, relay, archive: readArchive(rec), rec, trust: await trustNow(), forms: o.forms });
  }
  async function proof(cand: string): Promise<Proof> {
    const rec = readRec();
    const sheet = (await cellExport()).sheets.find((s) => s.ctx.cand === cand);
    const p = rec && sheet ? proofFor(rec, sheet, o.cells) : undefined;
    if (!p) throw new HttpError(404, `${cand} is not in the sealed register yet — seal the shift first`);
    return p;
  }

  return {
    '/control': page,
    '/verify': { GET: handle(async () => new Response(await verifyHtml(), { headers: { 'content-type': 'text/html; charset=utf-8' } })) },
    '/v1/recon': { GET: handle(async () => {
      const [cell, relay, s] = await Promise.all([cellExport(), relayHeads(), seats()]);
      const bound = s && Object.keys(s).filter((k) => k.endsWith('/1')).map((k) => k.slice(0, -2));
      return json(reconcile({ centre: o.centre, exam: o.exam, shift: o.shift, roster: o.roster, relay, cell, rec: readRec(), bound }));
    }) },
    '/v1/seal': { POST: handle(async () => {
      const exp = await cellExport();
      const before = readRec();
      const r = seal(before, exp, { authority: o.authority, trust: await trustNow(), pseud: o.pseud, now });
      const signed = r.rec.sths.at(-1)!;
      if (r.rec !== before) {
        writeFileSync(recPath, JSON.stringify(r.rec, null, 2));
        writeFileSync(archivePath(signed.sth.size), JSON.stringify(exp));
        custody('seal', { size: signed.sth.size, root: signed.sth.root, added: r.added, skipped: r.skipped });
      }
      return json({ sth: signed, added: r.added, skipped: r.skipped });
    }) },
    '/v1/audit': { POST: handle(async () => {
      const f = await findings();
      o.onFindings?.(f);
      custody('audit', { findings: f.length, sha256: sha(JSON.stringify(f)) });
      return json({ at: now(), findings: f });
    }) },
    '/v1/rogue': { POST: handle(async (req) => {
      const b = (await req.json().catch(() => ({}))) as { cand?: unknown; q?: unknown; answer?: unknown };
      const cand = typeof b.cand === 'string' ? b.cand : '';
      const items = o.forms[o.formOf(cand) ?? ''];
      const q = b.q as number;
      if (!o.roster.includes(cand) || !items || !Number.isSafeInteger(q) || q < 1 || q > items.length || !['A', 'B', 'C', 'D'].includes(b.answer as string))
        throw new HttpError(400, 'need {cand, q: 1…n, answer: A|B|C|D}');
      const out = await upstream<Record<string, unknown>>(`${o.cellUrl}/v1/dev/rogue`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ exam: o.exam, shift: o.shift, attempt: 1, cand, item: items[q - 1], answer: b.answer }),
      });
      custody('rogue-simulated', { cand, item: items[q - 1], note: 'DEV chaos button: an insider edit, simulated on purpose' });
      return json({ ...out, q });
    }) },
    '/v1/chaos/wan': { POST: handle(async (req) => {
      const b = (await req.json().catch(() => ({}))) as { up?: unknown };
      if (typeof b.up !== 'boolean') throw new HttpError(400, 'need {up: boolean}');
      const out = await upstream<{ up: boolean }>(`${o.relayUrl}/v1/dev/wan`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ up: b.up }) });
      custody('chaos-wan', { centre: o.centre, up: b.up, note: "DEV chaos: the demo centre's WAN link" });
      return json(out);
    }) },
    '/v1/sth': { GET: handle(async (req) => {
      const rec = readRec(), h = rec && headFrom(rec, Number(new URL(req.url).searchParams.get('from') ?? 0));
      if (!h) throw new HttpError(404, 'seal the shift first');
      return json(h);
    }) },
    '/v1/witness': { GET: handle(async () => {
      if (!o.witnessUrl) throw new HttpError(404, 'no witness configured (WITNESS_URL)');
      return json(await upstream(`${o.witnessUrl}/v1/witness`));
    }) },
    '/v1/proof': { GET: handle(async (req) => json(await proof(candOf(req)))) },
    '/v1/evidence': { GET: handle(async (req) => {
      const cand = candOf(req);
      const p = await proof(cand);
      const mine = (await findings()).filter((f) => f.cand === cand);
      const pack = await buildPack({ proof: p, findings: mine, custody: custodyLines(), verifyHtml: await verifyHtml(), forms: o.forms, trust: await trustNow(), now: now() });
      const out = join(o.dir, 'evidence', pack.name);
      mkdirSync(out, { recursive: true });
      for (const [f, c] of Object.entries(pack.files)) writeFileSync(join(out, f), c);
      writeFileSync(`${out}.tar.gz`, pack.tgz);
      custody('evidence-export', { cand, name: pack.name, manifestSha256: sha(pack.files['manifest.sha256']), tgzSha256: sha(pack.tgz) });
      return new Response(pack.tgz as Uint8Array<ArrayBuffer>, { headers: { 'content-type': 'application/gzip', 'content-disposition': `attachment; filename="${pack.name}.tar.gz"` } });
    }) },
  };
}
