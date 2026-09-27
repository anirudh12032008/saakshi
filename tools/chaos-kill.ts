// Stage 1 kill test. Spawns a real cell and relay, pumps entries from simulated seats through the seat's own sync
// loop, SIGKILLs the cell mid-stream, restarts it, then wipes its DB (REBUILDING) and restarts again.
// Asserts: nothing the cell acknowledged is lost, the relay keeps acking while the cell is down, and at the end
// sent = relay-acked = cell-acked = stored, lost = 0, with every stored chain verifying and every body opening.
//   bun tools/chaos-kill.ts [--seats 8] [--entries 200]
import { Database } from 'bun:sqlite';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { cellKey, devSeat, type KeysFile } from '../packages/core/src/dev.ts';
import { parseSignedLine, verifyChain } from '../packages/core/src/journal.ts';
import { openBody, verifier } from '../packages/core/src/node.ts';
import type { HeadsRes } from '../packages/core/src/wire.ts';
import { httpSend, SeatSync } from '../apps/seat/src/main/sync.ts';
import { SimSeat } from './sim-seat.ts';

const { values } = parseArgs({ options: { seats: { type: 'string', default: '8' }, entries: { type: 'string', default: '200' } } });
const SEATS = Number(values.seats), TARGET = Number(values.entries);
const root = resolve(import.meta.dir, '..');
const keys = JSON.parse(readFileSync(join(root, 'fixtures/keys.json'), 'utf8')) as KeysFile;
const cell = cellKey(keys, 'cell-1');
const dir = mkdtempSync(join(tmpdir(), 'saakshi-kill-'));
const cellDb = join(dir, 'cell.db');
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const fail = (m: string): never => { throw new Error(m); };

const freePort = (): number => { const s = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Response() }); const p = s.port!; s.stop(true); return p; };

async function spawnServer(env: Record<string, string>) {
  const proc = Bun.spawn(['bun', join(root, 'apps/server/src/main.ts')], { cwd: dir, env: { ...process.env, DEV: '1', ...env }, stdout: 'pipe', stderr: 'inherit' });
  const reader = proc.stdout.getReader();
  let buf = '';
  const deadline = Date.now() + 15_000;
  while (!buf.includes('READY ')) {
    if (Date.now() > deadline) fail(`${env.MODE} did not start`);
    const { value, done } = await reader.read();
    if (done) fail(`${env.MODE} exited before READY: ${buf}`);
    buf += new TextDecoder().decode(value);
  }
  void (async () => { try { while (!(await reader.read()).done); } catch { /* process gone */ } })();
  return proc;
}

const cellPort = freePort(), relayPort = freePort();
const cellEnv = { MODE: 'cell', PORT: String(cellPort), DB: cellDb };
let cellProc = await spawnServer(cellEnv);
const relayProc = await spawnServer({ MODE: 'relay', PORT: String(relayPort), HOST: '127.0.0.1', DB: join(dir, 'relay.db'), CELL_URL: `http://127.0.0.1:${cellPort}` });
const relayUrl = `http://127.0.0.1:${relayPort}`;

const seats = Array.from({ length: SEATS }, (_, i) => {
  const sim = new SimSeat(keys, `C${String(i + 1).padStart(4, '0')}`, cell.pub);
  const src = { ctx: sim.ctx, head: () => sim.head, hashAt: (s: number) => sim.hs[s - 1], entriesAfter: (a: number, l: number) => sim.after(a, l) };
  return { sim, sync: new SeatSync(src, httpSend(relayUrl, 2000), verifier(cell.pub)) };
});
const produce = (n: number) => { for (const s of seats) s.sim.add(Math.max(0, Math.min(n, TARGET - s.sim.head))); };
const round = () => Promise.all(seats.map((s) => s.sync.round()));
const views = () => seats.map((s) => s.sync.view());
async function until(pred: () => boolean | Promise<boolean>, what: string, ms = 60_000): Promise<number> {
  const t0 = Date.now();
  while (!(await pred())) {
    if (Date.now() - t0 > ms) fail(`timed out waiting for ${what}: ${JSON.stringify(views())}`);
    await round();
    await Bun.sleep(20);
  }
  return Date.now() - t0;
}
function storedCounts(): Map<string, number> {
  const db = new Database(cellDb);                    // read-write open: a crashed WAL needs recovery
  try { return new Map((db.query('SELECT cand, count(*) AS n FROM entries GROUP BY cand').all() as { cand: string; n: number }[]).map((r) => [r.cand, r.n])); }
  finally { db.close(); }
}
const cellHeads = async (): Promise<HeadsRes> => (await (await fetch(`http://127.0.0.1:${cellPort}/v1/heads`)).json()) as HeadsRes;

try {
  // Phase 1: stream, then SIGKILL the cell mid-stream.
  while (seats[0].sim.head < TARGET * 0.4) { produce(2); await round(); await Bun.sleep(10); }
  await until(() => views().every((v) => v.cell > 0), 'first cell acks');
  cellProc.kill('SIGKILL');
  await cellProc.exited;
  const acked = views().map((v) => v.cell);
  const onDisk = storedCounts();
  seats.forEach((s, i) => { if ((onDisk.get(s.sim.ctx.cand) ?? 0) < acked[i]) fail(`${s.sim.ctx.cand}: cell acked ${acked[i]} but only ${onDisk.get(s.sim.ctx.cand) ?? 0} are on disk`); });
  console.log(`kill -9 cell: ${sum(acked)} entries acknowledged by the cell, all on its disk`);

  // Cell down: seats keep getting ✓✓ from the relay.
  const relayBefore = sum(views().map((v) => v.relay));
  for (let i = 0; i < 20; i++) { produce(1); await round(); await Bun.sleep(20); }
  if (sum(views().map((v) => v.relay)) <= relayBefore) fail('the relay stopped acking while the cell was down');
  console.log(`cell down: relay acked ${sum(views().map((v) => v.relay)) - relayBefore} more entries`);

  // Restart on the same DB and port; finish the stream.
  const t0 = Date.now();
  cellProc = await spawnServer(cellEnv);
  while (seats.some((s) => s.sim.head < TARGET)) { produce(3); await round(); await Bun.sleep(10); }
  await until(() => views().every((v) => v.cell === TARGET && v.relay === TARGET), 'cell catch-up after kill -9');
  const rtoKill = Date.now() - t0;

  // Phase 2: wipe the cell DB → REBUILDING → the relay replays from genesis.
  cellProc.kill('SIGKILL');
  await cellProc.exited;
  for (const f of [cellDb, `${cellDb}-wal`, `${cellDb}-shm`]) rmSync(f, { force: true });
  const t1 = Date.now();
  cellProc = await spawnServer(cellEnv);
  await until(async () => { const h = await cellHeads(); return h.state === 'LIVE' && h.streams.length === SEATS && h.streams.every((s) => s.head === TARGET); }, 'rebuild from the relay');
  const rebuild = Date.now() - t1;
  cellProc.kill('SIGKILL');
  await cellProc.exited;

  // Final accounting on the cell's own disk.
  const db = new Database(cellDb);
  let stored = 0;
  for (const s of seats) {
    const rows = db.query('SELECT line, env FROM entries WHERE cand = ? ORDER BY seq').all(s.sim.ctx.cand) as { line: string; env: Uint8Array }[];
    const chain = verifyChain(s.sim.ctx, rows.map((r) => r.line), verifier(devSeat(keys, s.sim.ctx.cand)!.pub));
    if (!chain.ok || chain.count !== TARGET || chain.head !== s.sim.hs[TARGET - 1]) fail(`${s.sim.ctx.cand}: stored chain differs from what was sent`);
    rows.forEach((r, i) => {
      const p = parseSignedLine(r.line);
      if (!p.ok) fail(`${s.sim.ctx.cand}: unparseable stored line`);
      else openBody(cell.priv, { ...s.sim.ctx, seq: i + 1 }, r.env, p.header.bodyCommit);
    });
    stored += rows.length;
  }
  db.close();
  const sent = SEATS * TARGET, relayAcked = sum(views().map((v) => v.relay)), cellAcked = sum(views().map((v) => v.cell));
  console.log(`sent=${sent} relay-acked=${relayAcked} cell-acked=${cellAcked} stored=${stored} lost=${sent - stored} rto-kill=${rtoKill}ms rebuild=${rebuild}ms`);
  if (relayAcked !== sent || cellAcked !== sent || stored !== sent) fail('counts differ');
  console.log('PASS');
} catch (e) {
  console.error(`FAIL: ${(e as Error).message}`);
  process.exitCode = 1;
} finally {
  relayProc.kill();
  cellProc.kill();
  await Promise.all([relayProc.exited, cellProc.exited]);
  rmSync(dir, { recursive: true, force: true });
}
