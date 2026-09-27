import { afterAll, beforeAll, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Database } from 'bun:sqlite';
import { hexToBytes } from '@saakshi/core/bytes';
import { cellKey, devForm, devPseud, devRoster, devSeatKey, trustFromKeys, type KeysFile } from '@saakshi/core/dev';
import { formsOf, type Finding, type Proof, type ReconRow } from '@saakshi/core/sheet';
import { mismatchText, verifyProof } from '@saakshi/core/verify';
import page from '../src/control.html';
import { controlRoutes } from '../src/control.ts';
import { createIngest, type Ingest } from '../src/ingest.ts';
import { rogueEdit, shiftExport } from '../src/sheet-export.ts';
import { openDb } from '../src/store.ts';
import { FORMS, SimSeat } from '../../../tools/sim-seat.ts';

const keys = JSON.parse(readFileSync(new URL('../../../fixtures/keys.json', import.meta.url), 'utf8')) as KeysFile;
const cell = cellKey(keys, 'cell-1');
const forms = formsOf(FORMS), trust = trustFromKeys(keys);
const dir = mkdtempSync(join(tmpdir(), 'saakshi-control-'));
let n: Ingest, db: Database, seat: SimSeat;
const relayHead = 22;                                              // = the seat's head
const servers: ReturnType<typeof Bun.serve>[] = [];
let C = '';
const nf = () => Response.json({ error: 'not found' }, { status: 404 });

beforeAll(async () => {
  ({ db } = openDb(join(dir, 'cell.db')));
  n = createIngest({ mode: 'cell', db, fresh: false, seatKey: devSeatKey(keys), cell, forms, formOf: devForm, pseud: devPseud });
  seat = new SimSeat(keys, 'C0001', cell.pub);
  seat.add(21); seat.submit();                                      // I17 answered C at seq 18
  await n.sync({ entries: seat.entries, streams: [{ ...seat.ctx, head: seat.head }] });
  const EX = { exam: 'DEMO-2026', shift: 'S1', cell: 'cell-1', formOf: devForm, pseud: devPseud, seatKey: devSeatKey(keys) };
  const cellSrv = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: nf, routes: {
    '/v1/shift': { GET: () => Response.json(shiftExport(db, EX)) },
    '/v1/dev/rogue': { POST: async (req) => Response.json(rogueEdit(db, await req.json())) },
  } });
  const relaySrv = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: nf, routes: {
    '/v1/heads': { GET: () => Response.json({ mode: 'relay', state: 'LIVE', streams: [{ ...seat.ctx, head: relayHead, cellHead: relayHead, senderHead: relayHead, seenAt: 1 }] }) },
  } });
  const ctl = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: nf, routes: controlRoutes({
    dir: join(dir, 'control'), authority: { priv: hexToBytes(keys.authority.priv), pub: hexToBytes(keys.authority.pub) }, trust, forms,
    formOf: devForm, pseud: devPseud, roster: devRoster(keys), centre: 'CEN-01', exam: 'DEMO-2026', shift: 'S1',
    cellUrl: `http://127.0.0.1:${cellSrv.port}`, relayUrl: `http://127.0.0.1:${relaySrv.port}`, now: () => Date.UTC(2026, 8, 27, 10, 30),
  }, page) });
  servers.push(cellSrv, relaySrv, ctl);
  C = `http://127.0.0.1:${ctl.port}`;
});
afterAll(() => { for (const s of servers) s.stop(true); n.close(); rmSync(dir, { recursive: true, force: true }); });

const get = async <T>(p: string) => { const r = await fetch(C + p); return { status: r.status, body: (await r.json()) as T }; };
const post = async <T>(p: string, body?: unknown) => { const r = await fetch(C + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: r.status, body: (await r.json()) as T }; };

test('Act 4 through the control routes: seal → green → rogue → audit locates → proof shows it → evidence exports', async () => {
  expect((await get('/v1/proof?cand=C0001')).status).toBe(404);                          // not sealed yet
  expect((await get<ReconRow>('/v1/recon')).body.green).toBe(false);                     // leaves 0

  const sealed = await post<{ sth: { sth: { size: number } }; added: string[] }>('/v1/seal');
  expect([sealed.body.sth.sth.size, sealed.body.added]).toEqual([1, ['C0001']]);
  expect(existsSync(join(dir, 'control', 'sth-DEMO-2026-S1.json'))).toBe(true);
  expect(existsSync(join(dir, 'control', 'archive', 'DEMO-2026-S1-1.json'))).toBe(true);
  expect((await get<ReconRow>('/v1/recon')).body).toMatchObject({ registered: 8, checkedIn: 1, unlocked: 1, submitted: 1, receipts: 1, leaves: 1, headsEqual: true, green: true });
  expect((await post<{ findings: Finding[] }>('/v1/audit')).body.findings).toEqual([]);

  const rogue = await post<{ seq: number; from: string; to: string; q: number; sql: string }>('/v1/rogue', { cand: 'C0001', q: 17, answer: 'B' });
  expect(rogue.body).toMatchObject({ seq: 18, from: 'C', to: 'B', q: 17 });
  const { findings } = (await post<{ findings: Finding[] }>('/v1/audit')).body;
  expect(findings).toEqual([{ cand: 'C0001', seq: 18, kind: 'body', detail: 'Q17: record says B — the seat committed C', recovered: { from: 'archive', value: 'C' } }]);
  expect((await get<ReconRow>('/v1/recon')).body.green).toBe(true);                      // counts are untouched by an edit

  const proof = (await get<Proof>('/v1/proof?cand=C0001')).body;
  expect(mismatchText(verifyProof(proof, forms, trust).mismatches[0])).toBe('Q17: record says B — the seat committed C');

  const ev = await fetch(`${C}/v1/evidence?cand=C0001`);
  expect(ev.headers.get('content-type')).toBe('application/gzip');
  expect(ev.headers.get('content-disposition')).toBe('attachment; filename="evidence-DEMO-2026-S1-C0001-20260927T103000Z.tar.gz"');
  const files = await new Bun.Archive(new Uint8Array(await ev.arrayBuffer())).files();
  expect(await files.get('evidence-DEMO-2026-S1-C0001-20260927T103000Z/report.html')!.text()).toContain('Q17: record says B — the seat committed C');
  expect(existsSync(join(dir, 'control', 'evidence', 'evidence-DEMO-2026-S1-C0001-20260927T103000Z', 'manifest.sha256'))).toBe(true);
  const custody = readFileSync(join(dir, 'control', 'custody.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l).action);
  expect(custody).toEqual(['seal', 'audit', 'rogue-simulated', 'audit', 'evidence-export']);

  const v = await fetch(`${C}/verify`);
  expect(v.headers.get('content-type')).toBe('text/html; charset=utf-8');
  expect(await v.text()).toContain('Saakshi · Verify');
  expect((await fetch(`${C}/control`)).status).toBe(200);
});

test('bad input is 400, an unreachable cell or relay is 502', async () => {
  expect((await get('/v1/proof?cand=C9999')).status).toBe(400);
  expect((await post('/v1/rogue', { cand: 'C0001', q: 99, answer: 'B' })).status).toBe(400);
  expect((await post('/v1/rogue', { cand: 'C0001', q: 1, answer: 'Z' })).status).toBe(400);
  servers[1].stop(true);                                            // the relay goes away
  const r = await get<{ error: string }>('/v1/recon');
  expect(r.status).toBe(502);
  expect(r.body.error).toContain('unreachable');
});
