import { afterAll, beforeAll, expect, test } from 'bun:test';
import type { Database } from 'bun:sqlite';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hexToBytes } from '@saakshi/core/bytes';
import type { KeysFile } from '@saakshi/core/dev';
import type { CellStats, Directory } from '@saakshi/core/directory';
import type { BindReq } from '@saakshi/core/enrol';
import { verifier } from '@saakshi/core/node';
import { formsOf } from '@saakshi/core/sheet';
import { Bindings, type EnrolResult } from '../src/bindings.ts';
import { cellRoutes } from '../src/cell-routes.ts';
import { createIngest, type Ingest } from '../src/ingest.ts';
import { ReleaseStore } from '../src/release-store.ts';
import { openDb } from '../src/store.ts';
import type { CohortRow } from '../../../tools/cohort.ts';
import { provision } from '../../../tools/provision.ts';
import { simCustody } from '../../../tools/sim-custody.ts';
import { plan, Swarm } from '../../../tools/swarm.ts';
import { FORMS } from '../../../tools/sim-seat.ts';

const keys = JSON.parse(readFileSync(new URL('../../../fixtures/keys.json', import.meta.url), 'utf8')) as KeysFile;
const forms = formsOf(FORMS), cust = simCustody(keys), A = verifier(hexToBytes(keys.authority.pub));
const STATES = ['A', 'A', 'NA', 'MR', 'AMR', 'NV', 'A'] as const;
/** 3 simulated centres × 4 candidates, 20 demo items each (the G1 shape, small), plus rows at CEN042 that must be skipped. */
function cohort(): CohortRow[] {
  const rows: CohortRow[] = [];
  let k = 0;
  for (const centre of ['CEN001', 'CEN002', 'CEN003', 'CEN042']) for (let i = 0; i < 4; i++) {
    const cand = `C9${String(++k).padStart(4, '0')}`, form = k % 2 ? 'F1' : 'F2';
    forms[form].forEach((item, j) => {
      const state = STATES[(k + j) % STATES.length];
      rows.push({ cand, centre, shift: 'S1', form, lang: 'en', pwd: 0, item, state, answer: state === 'A' || state === 'AMR' ? 'ABCD'[j % 4] : '', dwellMs: 20_000 + j * 1000, visits: 1, changes: 0, tFirstMs: -1 });
    });
  }
  return rows;
}
let tmp: string, dir: Directory, swarm: Swarm;
const cells: { id: string; db: Database; ingest: Ingest; releases: ReleaseStore; routes: ReturnType<typeof cellRoutes> }[] = [];

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'saakshi-swarm-'));
  const rows = cohort();
  dir = provision({ out: join(tmp, 'exam'), keys, cands: [...new Map(rows.map((r) => [r.cand, { cand: r.cand, centre: r.centre, form: r.form, pwd: r.pwd }])).values()] });
  for (const c of dir.cells) {
    const k = keys.cells.find((x) => x.id === c.id)!, cell = { id: c.id, priv: hexToBytes(k.priv), pub: hexToBytes(k.pub) };
    const { db } = openDb(join(tmp, `${c.id}.db`));
    const bindings = new Bindings(db, { exam: dir.exam, shift: dir.shift, cell });
    const releases = new ReleaseStore(db, { exam: dir.exam, shift: dir.shift, manifest: cust.manifest.manifest, authority: A, requireSig: true });
    const ingest = createIngest({ mode: 'cell', db, fresh: false, seatKey: bindings.seatKey, acceptBinds: (b) => bindings.acceptAll(b), releases: () => releases.list(),
      cell, forms, formOf: (x) => dir.cands[x]?.form, pseud: (x) => dir.cands[x]?.pseud ?? '', cellId: c.id });
    const routes = cellRoutes({ cellId: c.id, dir, bindings, releases, state: () => ingest.state(), views: () => ingest.views(),
      submitted: () => (db.query('SELECT cand FROM receipts').all() as { cand: string }[]).map((r) => r.cand) });
    cells.push({ id: c.id, db, ingest, releases, routes });
  }
  const cellOf = (id: string) => cells.find((c) => c.id === id)!;
  swarm = await Swarm.start({
    dir, manifest: cust.manifest, authorityPub: hexToBytes(keys.authority.pub), rows, forms, speed: 2000, tickMs: 20,
    cell: (id) => ({
      send: (req) => cellOf(id).ingest.sync(req),
      enrol: async (reqs: BindReq[]) => ((await (await cellOf(id).routes['/v1/enrol'].POST!(new Request('http://cell/v1/enrol', { method: 'POST', body: JSON.stringify({ enrols: reqs }) }), { timeout() {} })).json()) as { results: EnrolResult[] }).results,
    }),
  });
});
afterAll(async () => { await swarm.stop(); for (const c of cells) c.ingest.close(); rmSync(tmp, { recursive: true, force: true }); });
const stats = async (c: (typeof cells)[number]) => (await (await c.routes['/v1/stats'].GET!(new Request('http://cell/v1/stats'), { timeout() {} })).json()) as CellStats;
const receipts = () => cells.reduce((n, c) => n + (c.db.query('SELECT count(*) AS n FROM receipts').get() as { n: number }).n, 0);

test('plan: G1 rows become the seat\'s entries in form order, NV skipped, active time monotonic, ending in the replayed submit', () => {
  const rows = cohort().filter((r) => r.cand === 'C90001');
  const steps = plan({ exam: 'DEMO-2026', shift: 'S1', attempt: 1, cand: 'C90001' }, 'F1', forms.F1, rows);
  expect(steps.length).toBe(rows.filter((r) => r.state !== 'NV').length + 1);
  expect(steps.at(-1)!.kind).toBe('submit');
  expect(steps.map((s) => s.at)).toEqual([...steps.map((s) => s.at)].sort((a, b) => a - b));
  expect(steps.filter((s) => s.kind === 'clear').every((s) => s.body.state === 'NA' && s.body.answer === '')).toBe(true);
});

test('the swarm in miniature: every simulated seat enrols; nothing moves before the release; after it every centre goes green and every answer reaches its cell', async () => {
  expect(swarm.stats()).toMatchObject({ centres: 3, cands: 12, bound: 12, unlocked: 0, enrolFailed: 0 });
  await Bun.sleep(200);
  expect(cells.reduce((n, c) => n + c.ingest.views().filter((v) => v.head > 0).length, 0)).toBe(0);
  for (const c of cells) for (const f of ['F1', 'F2'] as const) expect(c.releases.accept(cust.release(f))).toBeUndefined();   // control's push
  for (let i = 0; i < 1000 && receipts() < 12; i++) await Bun.sleep(20);
  expect(receipts()).toBe(12);
  expect(swarm.stats()).toMatchObject({ unlocked: 12, done: 12, rejected: 0 });
  const tiles = (await Promise.all(cells.map(stats))).flatMap((s) => Object.entries(s.centres)).filter(([c]) => c !== 'CEN042');
  expect(tiles.map(([, t]) => [t.registered, t.unlocked, t.submitted])).toEqual(tiles.map(() => [4, 4, 4]));
});
