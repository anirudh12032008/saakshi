// Stage 4 chaos (the plan's Stage 4 exit check: `bun tools/chaos.ts --runs 20`). Each run spawns a real cell and a real relay (DEV
// mode, its own temp dir), streams entries from simulated seats through the seat's own sync loop, injects one failure mid-stream,
// recovers, and counts what is on the cell's disk:
//   kill-cell    SIGKILL the cell; restart it on the same DB
//   wipe-cell    SIGKILL the cell and delete its DB; it restarts REBUILDING and the relay replays from genesis
//   spare-relay  SIGKILL the relay and delete its DB; a spare (the same binary, the same port, an empty DB) starts; seats resend from their journals
// Measured per run: sent / relay-acked / cell-acked / stored / lost; RPO = entries the cell had acknowledged before the failure that are
// missing afterwards; RTO = the failure → every sent entry acknowledged by the cell again. One `CHAOS {…}` line per run; exit 1 on any loss.
//   bun tools/chaos.ts [--runs 20] [--seats 8] [--entries 100] [--out docs/evidence/stage4-chaos.jsonl]
import { Database } from 'bun:sqlite';
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cellKey, devSeat, type KeysFile } from '../packages/core/src/dev.ts';
import { parseSignedLine, verifyChain } from '../packages/core/src/journal.ts';
import { openBody, verifier } from '../packages/core/src/node.ts';
import type { Verify } from '../packages/core/src/sig.ts';
import { freePort, ROOT, spawnNode, type Proc } from './procs.ts';
import { SimSeat } from './sim-seat.ts';

export type Scenario = 'kill-cell' | 'wipe-cell' | 'spare-relay';
export const SCENARIOS: Scenario[] = ['kill-cell', 'wipe-cell', 'spare-relay'];
export interface RunLog { run: number; scenario: Scenario; seats: number; sent: number; relayAcked: number; cellAcked: number; stored: number; lost: number; rpo: number; rtoMs: number; ok: boolean }

export function summarise(runs: RunLog[]) {
  const rtoMs = {} as Record<Scenario, { n: number; p50: number; max: number }>;
  for (const sc of SCENARIOS) {
    const xs = runs.filter((r) => r.scenario === sc).map((r) => r.rtoMs).sort((a, b) => a - b);
    if (xs.length) rtoMs[sc] = { n: xs.length, p50: xs[Math.floor((xs.length - 1) / 2)], max: xs[xs.length - 1] };
  }
  const lost = runs.reduce((n, r) => n + r.lost, 0);
  return { runs: runs.length, ok: runs.every((r) => r.ok), lost, rtoMs };
}

const keys = JSON.parse(readFileSync(join(ROOT, 'fixtures/keys.json'), 'utf8')) as KeysFile;
const cell = cellKey(keys, 'cell-1');
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const rmDb = (p: string) => { for (const f of [p, `${p}-wal`, `${p}-shm`]) rmSync(f, { force: true }); };
// The seat's own sync loop, loaded at run time: tsc sees apps/seat as CommonJS, so a static import would pull it into the server
// typecheck (this file is imported by apps/server/test/tools-stage4.test.ts) and fail there.
interface SyncLike { round(): Promise<void>; view(): { local: number; relay: number; cell: number } }
type SeatSyncMod = { httpSend: (url: string, timeoutMs: number) => unknown; SeatSync: new (src: unknown, send: unknown, verify: Verify) => SyncLike };
const seatSync = () => import(new URL('../apps/seat/src/main/sync.ts', import.meta.url).href) as Promise<SeatSyncMod>;

async function run(n: number, scenario: Scenario, SEATS: number, TARGET: number): Promise<RunLog> {
  const dir = mkdtempSync(join(tmpdir(), 'saakshi-chaos-'));
  const cellDb = join(dir, 'cell.db'), relayDb = join(dir, 'relay.db'), cellPort = freePort(), relayPort = freePort();
  const cellEnv = { MODE: 'cell', PORT: String(cellPort), DB: cellDb };
  const relayEnv = { MODE: 'relay', PORT: String(relayPort), HOST: '127.0.0.1', DB: relayDb, CELL_URL: `http://127.0.0.1:${cellPort}` };
  let cellP: Proc = await spawnNode({ env: cellEnv, cwd: dir }), relayP: Proc = await spawnNode({ env: relayEnv, cwd: dir });
  const relayUrl = `http://127.0.0.1:${relayPort}`;
  const { httpSend, SeatSync } = await seatSync();
  const seats = Array.from({ length: SEATS }, (_, i) => {
    const sim = new SimSeat(keys, `C${String(i + 1).padStart(4, '0')}`, cell.pub);
    const src = { ctx: sim.ctx, head: () => sim.head, hashAt: (s: number) => sim.hs[s - 1], entriesAfter: (a: number, l: number) => sim.after(a, l) };
    return { sim, sync: new SeatSync(src, httpSend(relayUrl, 2_000), verifier(cell.pub)) };
  });
  const produce = (k: number) => { for (const s of seats) s.sim.add(Math.max(0, Math.min(k, TARGET - s.sim.head))); };
  const round = () => Promise.all(seats.map((s) => s.sync.round()));
  const views = () => seats.map((s) => s.sync.view());
  async function until(pred: () => boolean, what: string, ms = 90_000): Promise<void> {
    const t0 = Date.now();
    while (!pred()) { if (Date.now() - t0 > ms) throw new Error(`run ${n} (${scenario}): timed out waiting for ${what}`); await round(); await Bun.sleep(20); }
  }
  try {
    while (seats[0].sim.head < TARGET * 0.4) { produce(2); await round(); await Bun.sleep(10); }
    await until(() => views().every((v) => v.cell > 0), 'first cell acks');
    const ackedBefore = views().map((v) => v.cell);
    const t0 = Date.now();
    if (scenario === 'spare-relay') { relayP.proc.kill('SIGKILL'); await relayP.proc.exited; rmDb(relayDb); }
    else { cellP.proc.kill('SIGKILL'); await cellP.proc.exited; if (scenario === 'wipe-cell') rmDb(cellDb); }
    for (let i = 0; i < 20; i++) { produce(1); await round(); await Bun.sleep(20); }       // the exam goes on during the failure
    if (scenario === 'spare-relay') relayP = await spawnNode({ env: relayEnv, cwd: dir });
    else cellP = await spawnNode({ env: cellEnv, cwd: dir });
    while (seats.some((s) => s.sim.head < TARGET)) { produce(3); await round(); await Bun.sleep(10); }
    await until(() => views().every((v) => v.cell === TARGET && v.relay === TARGET), 'every entry acknowledged by the cell again');
    const rtoMs = Date.now() - t0;
    cellP.proc.kill('SIGKILL'); await cellP.proc.exited;
    const db = new Database(cellDb);                                                  // read-write open: a crashed WAL needs recovery
    let stored = 0, rpo = 0;
    seats.forEach((s, i) => {
      const rows = db.query('SELECT line, env FROM entries WHERE cand = ? ORDER BY seq').all(s.sim.ctx.cand) as { line: string; env: Uint8Array }[];
      const chain = verifyChain(s.sim.ctx, rows.map((r) => r.line), verifier(devSeat(keys, s.sim.ctx.cand)!.pub));
      if (!chain.ok || chain.head !== s.sim.hs[rows.length - 1]) throw new Error(`${s.sim.ctx.cand}: the stored chain is not what was sent`);
      rows.forEach((r, k) => { const p = parseSignedLine(r.line); if (!p.ok) throw new Error('unparseable stored line'); openBody(cell.priv, { ...s.sim.ctx, seq: k + 1 }, r.env, p.header.bodyCommit); });
      stored += rows.length;
      rpo += Math.max(0, ackedBefore[i] - rows.length);
    });
    db.close();
    const sent = SEATS * TARGET, relayAcked = sum(views().map((v) => v.relay)), cellAcked = sum(views().map((v) => v.cell));
    const lost = sent - stored;
    return { run: n, scenario, seats: SEATS, sent, relayAcked, cellAcked, stored, lost, rpo, rtoMs, ok: lost === 0 && rpo === 0 && relayAcked === sent && cellAcked === sent };
  } finally {
    for (const p of [cellP, relayP]) if (p.proc.exitCode === null) p.proc.kill();
    await Promise.all([cellP.proc.exited, relayP.proc.exited]);
    rmSync(dir, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const arg = (f: string, d: string) => { const i = process.argv.indexOf(f); return i > 0 ? process.argv[i + 1] : d; };
  const RUNS = Number(arg('--runs', '20')), SEATS = Number(arg('--seats', '8')), TARGET = Number(arg('--entries', '100')), out = arg('--out', '');
  const logs: RunLog[] = [];
  for (let i = 1; i <= RUNS; i++) {
    let r: RunLog;
    try { r = await run(i, SCENARIOS[(i - 1) % SCENARIOS.length], SEATS, TARGET); }
    catch (e) { console.error(`run ${i}: ${(e as Error).message}`); r = { run: i, scenario: SCENARIOS[(i - 1) % SCENARIOS.length], seats: SEATS, sent: SEATS * TARGET, relayAcked: 0, cellAcked: 0, stored: 0, lost: SEATS * TARGET, rpo: -1, rtoMs: -1, ok: false }; }
    logs.push(r);
    const line = JSON.stringify({ ...r, at: new Date().toISOString(), host: `${process.platform}-${process.arch}` });
    console.log(`CHAOS ${line}`);
    if (out) appendFileSync(out, line + '\n');
  }
  const s = summarise(logs);
  console.log(`CHAOS-SUMMARY ${JSON.stringify(s)}`);
  console.log(s.ok ? 'PASS' : 'FAIL');
  process.exitCode = s.ok ? 0 : 1;
}
