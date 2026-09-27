// Swarm v1 (plan §5 Stage 3): the simulated centres in ONE process, in memory, replaying the G1 cohort. Each simulated centre
// runs the real relay code — createIngest('relay') on an in-memory DB, Bindings, ReleaseStore and the Forwarder — so what reaches
// the cells is exactly what a real relay sends. Only the seats are simulated: they enrol, wait for the release, run the seat's
// own kc_f check, then journal their G1 answers on G1's clock, sped up. Cells are the real processes over HTTP (or in-process
// ones in tests). The demo centre is real, so its G1 rows are skipped.
//   bun tools/swarm.ts --exam data/exam --cohort data/g1/cohort.jsonl [--speed 20]
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { hexToBytes, randomBytes, toHex } from '../packages/core/src/bytes.ts';
import type { KeysFile } from '../packages/core/src/dev.ts';
import { FILES, type Directory } from '../packages/core/src/directory.ts';
import type { BindReq } from '../packages/core/src/enrol.ts';
import { signedLine } from '../packages/core/src/journal.ts';
import { responsesOf } from '../packages/core/src/log.ts';
import { newKeyPair, sealBody, signer, verifier, type KeyPair } from '../packages/core/src/node.ts';
import { checkRelease, type ReleaseMsg, type SignedManifest } from '../packages/core/src/paper.ts';
import { entryHash, finalHash, genesisPrev, type Body, type Ctx, type Header, type Kind } from '../packages/core/src/protocol.ts';
import { formsOf, type Forms } from '../packages/core/src/sheet.ts';
import type { Verify } from '../packages/core/src/sig.ts';
import { toB64, type WireEntry } from '../packages/core/src/wire.ts';
import { Bindings, type EnrolResult } from '../apps/server/src/bindings.ts';
import { Forwarder, httpCellSend, type CellSend } from '../apps/server/src/forward.ts';
import { createIngest, type Ingest } from '../apps/server/src/ingest.ts';
import { ReleaseStore } from '../apps/server/src/release-store.ts';
import { openDb } from '../apps/server/src/store.ts';
import { readCohort, type CohortRow } from './cohort.ts';
import { simBindReq } from './sim-custody.ts';

export interface Step { at: number; kind: Kind; body: Body }
const EMPTY: Body = { item: '', state: '', answer: '', meta: [] };

export function plan(ctx: Ctx, form: string, items: readonly string[], rows: CohortRow[]): Step[] {
  const pos = new Map(items.map((id, i) => [id, i]));
  const steps: Step[] = [];
  let t = 0;
  for (const r of [...rows].filter((x) => pos.has(x.item)).sort((a, b) => pos.get(a.item)! - pos.get(b.item)!)) {
    if (r.state === 'NV') continue;
    t += Math.max(1000, r.dwellMs);
    const kind: Kind = r.state === 'A' ? 'answer' : r.state === 'NA' ? 'clear' : 'mark';
    steps.push({ at: t, kind, body: { item: r.item, state: r.state, answer: r.state === 'A' || r.state === 'AMR' ? r.answer : '', meta: [r.dwellMs, []] } });
  }
  steps.push({ at: t + 1000, kind: 'submit', body: { ...EMPTY, meta: [form, finalHash(ctx, form, responsesOf(items, steps.map((s) => s.body)))] } });
  return steps;
}

export interface SwarmCell { send: CellSend; enrol(reqs: BindReq[]): Promise<EnrolResult[]> }
export interface SwarmOpts {
  dir: Directory; manifest: SignedManifest; authorityPub: Uint8Array; rows: Iterable<CohortRow>; forms: Forms;
  cell(id: string): SwarmCell; speed?: number; tickMs?: number;
}
interface Sim { ctx: Ctx; form: string; seat: KeyPair; sign: (m: Uint8Array) => Uint8Array; steps: Step[]; next: number; hs: string[]; t0: number; bound: boolean; unlocked: boolean }
interface Centre { id: string; cellId: string; cellPub: Uint8Array; ingest: Ingest; bindings: Bindings; fwd: Forwarder; sims: Sim[] }

export class Swarm {
  readonly centres: Centre[] = [];
  #o: SwarmOpts;
  #authority: Verify;
  #timer?: ReturnType<typeof setInterval>;
  #sent = 0;
  #rejected = 0;
  #enrolFailed = 0;
  #rr = 0;

  private constructor(o: SwarmOpts) { this.#o = o; this.#authority = verifier(o.authorityPub); }

  static async start(o: SwarmOpts): Promise<Swarm> {
    const s = new Swarm(o);
    const byCand = new Map<string, CohortRow[]>();
    for (const r of o.rows) {
      const c = o.dir.cands[r.cand];
      if (!c || c.centre === o.dir.demoCentre || !o.forms[c.form]?.includes(r.item)) continue;
      let a = byCand.get(r.cand);
      if (!a) byCand.set(r.cand, (a = []));
      a.push(r);
    }
    const byCentre = new Map<string, string[]>();
    for (const cand of byCand.keys()) {
      const id = o.dir.cands[cand].centre;
      let a = byCentre.get(id);
      if (!a) byCentre.set(id, (a = []));
      a.push(cand);
    }
    for (const [id, cands] of [...byCentre].sort(([a], [b]) => a.localeCompare(b))) s.centres.push(s.#centre(id, cands, byCand));
    await Promise.all(s.centres.map((c) => s.#enrol(c)));
    s.#timer = setInterval(() => s.#tick(), o.tickMs ?? 100);
    return s;
  }

  stats() {
    let cands = 0, bound = 0, unlocked = 0, done = 0;
    for (const c of this.centres) for (const s of c.sims) { cands++; if (s.bound) bound++; if (s.unlocked) unlocked++; if (s.unlocked && s.next >= s.steps.length) done++; }
    return { centres: this.centres.length, cands, bound, unlocked, done, sent: this.#sent, rejected: this.#rejected, enrolFailed: this.#enrolFailed };
  }

  async stop(): Promise<void> {
    clearInterval(this.#timer);
    await Promise.all(this.centres.map((c) => c.fwd.stop()));
    for (const c of this.centres) c.ingest.close();
  }

  #centre(id: string, cands: string[], byCand: Map<string, CohortRow[]>): Centre {
    const o = this.#o, X = { exam: o.dir.exam, shift: o.dir.shift };
    const cellId = o.dir.centres[id].cell, cellPub = hexToBytes(o.dir.cells.find((c) => c.id === cellId)!.pub);
    const { db } = openDb(':memory:');                                                         // simulated centres live in memory
    const bindings = new Bindings(db, { ...X, cell: { id: cellId, pub: cellPub } });
    const releases = new ReleaseStore(db, { ...X, manifest: o.manifest.manifest, authority: this.#authority, onNew: (r) => this.#unlock(id, r) });
    const ingest = createIngest({ mode: 'relay', db, fresh: false, seatKey: bindings.seatKey, acceptBinds: (b) => bindings.acceptAll(b), cell: { pub: cellPub } });
    const fwd = new Forwarder(ingest, o.cell(cellId).send, { releases, bindFor: (c) => bindings.get(c.cand, 1) });
    const sims = cands.map((cand): Sim => {
      const e = o.dir.cands[cand], ctx = { ...X, attempt: 1, cand }, seat = newKeyPair();
      return { ctx, form: e.form, seat, sign: signer(seat), steps: plan(ctx, e.form, o.forms[e.form], byCand.get(cand)!), next: 0, hs: [], t0: 0, bound: false, unlocked: false };
    });
    fwd.start();
    return { id, cellId, cellPub, ingest, bindings, fwd, sims };
  }

  /** One batch per 500 seats through the cell's /v1/enrol, retried while the cell is still starting (503 or unreachable). */
  async #enrol(c: Centre): Promise<void> {
    for (let i = 0; i < c.sims.length; i += 500) {
      const batch = c.sims.slice(i, i + 500);
      const reqs = batch.map((s) => simBindReq(s.ctx.cand, s.seat, c.cellPub, `${c.id}-SIM`, s.ctx));
      let res: EnrolResult[] | undefined;
      for (let attempt = 0; attempt < 20 && !res; attempt++) {
        try { res = await this.#o.cell(c.cellId).enrol(reqs); } catch { await new Promise((r) => setTimeout(r, 500)); }
      }
      if (!res) { this.#enrolFailed += batch.length; continue; }
      res.forEach((r, j) => { if (r.ok && !c.bindings.accept(r.bind)) batch[j].bound = true; else this.#enrolFailed++; });
    }
  }

  /** The release reached this centre's relay: every bound seat runs the seat's own check, then journals its unlock. */
  #unlock(centreId: string, r: ReleaseMsg): void {
    const c = this.centres.find((x) => x.id === centreId);
    if (!c) return;
    const now = Date.now();
    for (const s of c.sims) {
      if (s.unlocked || !s.bound || s.form !== r.form || !checkRelease(r, this.#o.manifest.manifest, s.form, this.#authority).ok) continue;
      s.unlocked = true;
      s.t0 = now;
      s.steps.unshift({ at: 0, kind: 'unlock', body: { ...EMPTY, meta: [s.form, r.kcf, r.via] } });
    }
  }

  /** Journal what G1's clock says is due. Half of each tick is the CPU budget for signing and sealing, so the event loop
   *  keeps serving the Forwarders; the next tick resumes at the centre this one stopped at, so no centre starves. */
  #tick(): void {
    const speed = this.#o.speed ?? 20, now = Date.now(), until = performance.now() + (this.#o.tickMs ?? 100) / 2, n = this.centres.length;
    let k = 0;
    for (; k < n && performance.now() < until; k++) {
      const c = this.centres[(this.#rr + k) % n];
      const entries: WireEntry[] = [];
      for (const s of c.sims) {
        if (!s.unlocked) continue;
        const clock = (now - s.t0) * speed;
        while (s.next < s.steps.length && s.steps[s.next].at <= clock && entries.length < 500 && performance.now() < until) entries.push(this.#entry(c, s, s.steps[s.next++]));
      }
      if (entries.length) void c.ingest.sync({ entries, streams: [] }).then((r) => {
        if (r === 'REBUILDING') return;
        this.#sent += entries.length - r.rejected.length;
        this.#rejected += r.rejected.length;
      });
    }
    if (k) this.#rr = (this.#rr + k - 1) % n;                                                  // the last centre may be cut short
  }


  #entry(c: Centre, s: Sim, st: Step): WireEntry {
    const seq = s.hs.length + 1;
    const { envelope, bodyCommit } = sealBody(c.cellPub, { ...s.ctx, seq }, randomBytes(16), st.body);
    const h: Header = { ...s.ctx, keyEpoch: 1, seq, prev: s.hs.at(-1) ?? genesisPrev(s.ctx), kind: st.kind, tMonoMs: st.at, activeMs: st.at, bodyCommit };
    s.hs.push(toHex(entryHash(h)));
    return { line: signedLine(h, s.sign), env: toB64(envelope) };
  }
}

if (import.meta.main) {
  const arg = (f: string) => { const i = process.argv.indexOf(f); return i > 0 ? process.argv[i + 1] : undefined; };
  const root = resolve(arg('--exam') ?? 'data/exam'), cohort = arg('--cohort');
  if (!cohort) throw new Error('need --cohort <G1 cohort.jsonl>');
  const fx = resolve(import.meta.dirname, '../fixtures');
  const keys = JSON.parse(readFileSync(join(fx, 'keys.json'), 'utf8')) as KeysFile;
  const forms = formsOf(JSON.parse(readFileSync(join(fx, 'paper/forms.json'), 'utf8')));
  const dir = JSON.parse(readFileSync(join(root, FILES.directory), 'utf8')) as Directory;
  const manifest = JSON.parse(readFileSync(join(root, FILES.manifest), 'utf8')) as SignedManifest;
  const rows: CohortRow[] = [];
  for await (const r of readCohort(cohort)) if (dir.cands[r.cand] && forms[r.form]?.includes(r.item)) rows.push({ ...r, shift: dir.shift });   // G1's sittings merged into the demo shift
  const httpCell = new Map(dir.cells.map((c) => [c.id, {
    send: httpCellSend(c.url, 10_000),
    enrol: async (reqs: BindReq[]) => {
      const r = await fetch(`${c.url}/v1/enrol`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enrols: reqs }), signal: AbortSignal.timeout(30_000) });
      if (!r.ok) throw new Error(`${c.id} answered ${r.status}`);
      return ((await r.json()) as { results: EnrolResult[] }).results;
    },
  }]));
  const swarm = await Swarm.start({ dir, manifest, authorityPub: hexToBytes(keys.authority.pub), rows, forms, cell: (id) => httpCell.get(id)!, speed: Number(arg('--speed') ?? 20) });
  console.log(`SWARM ${JSON.stringify(swarm.stats())}`);
  const t = setInterval(() => console.log(`SWARM ${JSON.stringify(swarm.stats())}`), 2000);
  const stop = async () => { clearInterval(t); await swarm.stop(); process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
