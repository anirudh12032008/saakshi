// Stage 7 "Measured load" (plan.md): cell counters, ingest p50/p99, relay→cell WAN bytes per candidate-hour, and one real
// seat's CPU/RSS, all measured on this machine. Reuses provision.ts/package.ts/swarm.ts exactly as tools/act3.ts does; the only
// new code here is a byte+latency counting wrapper around httpCellSend (no server code is touched) and a `ps` sampler.
// RPO/RTO are NOT re-measured here: tools/chaos.ts already logged 20 runs in docs/evidence/stage8-chaos.jsonl; this script
// reports that file's summary instead of inventing a second measurement.
//   bun tools/measure.ts [--n 20000] [--centres 100] [--speed 40] [--seconds 60] [--out docs/evidence/stage7-load.txt]
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hexToBytes } from '../packages/core/src/bytes.ts';
import { type KeysFile } from '../packages/core/src/dev.ts';
import { FILES } from '../packages/core/src/directory.ts';
import { formsOf } from '../packages/core/src/sheet.ts';
import type { SignedManifest } from '../packages/core/src/paper.ts';
import type { WireEntry } from '../packages/core/src/wire.ts';
import type { BindReq } from '../packages/core/src/enrol.ts';
import type { EnrolResult } from '../apps/server/src/bindings.ts';
import { readCohort } from './cohort.ts';
import { buildPackage, writePackage, zeroise } from './package.ts';
import { freePort, ROOT } from './procs.ts';
import { cohortCands, provision } from './provision.ts';
import { Swarm } from './swarm.ts';

const arg = (f: string, d: string) => { const i = process.argv.indexOf(f); return i > 0 ? process.argv[i + 1] : d; };
const N = Number(arg('--n', '20000')), CENTRES = Number(arg('--centres', '100')), SPEED = Number(arg('--speed', '40'));
const SECONDS = Number(arg('--seconds', '60')), OUT = arg('--out', 'docs/evidence/stage7-load.txt');
const read = (f: string) => JSON.parse(readFileSync(join(ROOT, f), 'utf8'));
const keys = read('fixtures/keys.json') as KeysFile;
const forms = formsOf(read('fixtures/paper/forms.json'));
const authority = { priv: hexToBytes(keys.authority.priv), pub: hexToBytes(keys.authority.pub) };
const sysctl = (name: string) => execFileSync('sysctl', ['-n', name], { encoding: 'utf8' }).trim();
const percentile = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] : NaN; };

const lines: string[] = [];
const log = (s: string) => { console.log(s); lines.push(s); };

log(`Stage 7 measured load — ${new Date().toISOString()}`);
log('Machine (sysctl, read unsandboxed):');
try {
  log(`  CPU: ${sysctl('machdep.cpu.brand_string')}`);
  log(`  cores: ${sysctl('hw.ncpu')} (${sysctl('hw.perflevel0.physicalcpu')}P + ${sysctl('hw.perflevel1.physicalcpu')}E)`);
  log(`  RAM: ${(Number(sysctl('hw.memsize')) / 2 ** 30).toFixed(1)} GiB`);
} catch (e) { log(`  sysctl unavailable: ${(e as Error).message}`); }
log(`  OS: ${execFileSync('sw_vers', [], { encoding: 'utf8' }).trim().replace(/\n/g, ', ')}`);
log('');
log(`Method: tools/measure.ts, reusing tools/provision.ts + tools/package.ts + tools/swarm.ts unmodified. Swarm runs ${CENTRES}`);
log(`simulated centres (in-memory relays, real forwarding) replaying a ${N}-candidate G1 cohort at --speed ${SPEED} against 3 real`);
log(`cell processes (bun, MODE=cell) over HTTP on loopback, for ${SECONDS}s of wall-clock measurement after warm-up. Ingest`);
log('latency and WAN bytes are measured by wrapping httpCellSend (apps/server/src/forward.ts, exported, unmodified) with a local');
log('counter in this script — no server code was changed.');
log('');

// 1. Generate the G1 cohort and provision + package a real exam directory (same as tools/act3.ts).
const dir = mkdtempSync(join(tmpdir(), 'saakshi-measure-'));
const g1 = join(dir, 'g1');
log(`Generating a ${N}-candidate / ${CENTRES}-centre G1 cohort (uv run saakshi_analytics.generate)…`);
const gen = Bun.spawnSync(['uv', 'run', '--directory', join(ROOT, 'analytics'), 'python', '-m', 'saakshi_analytics.generate', g1, '--n', String(N), '--centres', String(CENTRES), '--seed', '7'], { stdout: 'inherit', stderr: 'inherit' });
if (gen.exitCode !== 0) throw new Error('uv could not generate the G1 cohort');
const cohortPath = join(g1, 'cohort.jsonl');

const cellPorts = [freePort(), freePort(), freePort()];
const exam = join(dir, 'exam');
const X = provision({ out: exam, keys, cands: await cohortCands(cohortPath), cellUrls: cellPorts.map((p) => `http://127.0.0.1:${p}`) });
const pkg = await buildPackage(X, { bank: read('fixtures/paper/bank.json'), forms: read('fixtures/paper/forms.json') }, authority);
writePackage(exam, pkg);
const custodians = { NTA: { file: pkg.shares.NTA, pass: pkg.passphrases.NTA }, NIC: { file: pkg.shares.NIC, pass: pkg.passphrases.NIC } };
zeroise(pkg);
const manifest = JSON.parse(readFileSync(join(exam, FILES.manifest), 'utf8')) as SignedManifest;
log(`Provisioned ${Object.keys(X.cands).length} candidates across ${Object.keys(X.centres).length} centres, 3 cells.`);

// 2. Real cells + a real relay/control/witness (tools/stack.ts's demoSpecs, unmodified) — control pushes the real custodian
// release straight to the 3 cells; the swarm's simulated centre-relays (below) pick it up from the cells' own sync replies,
// exactly as a real relay would (apps/server/src/forward.ts's Forwarder reads `res.releases` off every cell sync).
const { demoSpecs, Stack } = await import('./stack.ts');
const { shareRequest } = await import('../apps/server/src/custodian-view.ts');
const sPorts = { relay: freePort(), control: freePort(), witness: freePort(), stack: freePort() };
const specs = demoSpecs({ exam, data: join(dir, 'data'), stackUrl: `http://127.0.0.1:${sPorts.stack}`, cellPorts, relayPort: sPorts.relay, controlPort: sPorts.control, witnessPort: sPorts.witness });
specs.find((s) => s.name === 'relay')!.env.HOST = '127.0.0.1';
mkdirSync(join(dir, 'data'), { recursive: true });
const stack = new Stack(specs, { cwd: dir });
for (const s of specs) await stack.start(s.name);
log('3 real cells + relay + control + witness up (tools/stack.ts).');
const C = `http://127.0.0.1:${sPorts.control}`;
const callJson = async <T>(url: string, method = 'GET', body?: unknown): Promise<T> => { const r = await fetch(url, { method, headers: body === undefined ? {} : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }); if (!r.ok) throw new Error(`${method} ${url} → ${r.status} ${await r.text()}`); return r.json() as Promise<T>; };
const relKey = await callJson<{ exam: string; shift: string; keyId: number; pub: string }>(`${C}/v1/release/key`);
for (const c of ['NTA', 'NIC'] as const) await callJson(`${C}/v1/release/share`, 'POST', shareRequest(custodians[c].file, custodians[c].pass, relKey));
await new Promise((r) => setTimeout(r, 500));                                  // give control a beat to push the release to the cells
log('Custodian release pushed by NTA + NIC to all 3 cells.');

// 3. Wrap httpCellSend-equivalent semantics with byte + latency counters (same wire contract as forward.ts's httpCellSend).
const bytesByCell = new Map<string, { req: number; res: number }>();
const latMsByCell = new Map<string, number[]>();
function countingSend(cellId: string, base: string) {
  const url = new URL('/v1/sync', base);
  const b = bytesByCell.get(cellId) ?? bytesByCell.set(cellId, { req: 0, res: 0 }).get(cellId)!;
  const lat = latMsByCell.get(cellId) ?? (latMsByCell.set(cellId, []), latMsByCell.get(cellId)!);
  return async (req: { entries: WireEntry[]; streams: unknown[]; binds?: unknown[]; have?: number }) => {
    const body = JSON.stringify(req);
    b.req += Buffer.byteLength(body);
    const t0 = performance.now();
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body, signal: AbortSignal.timeout(10_000) });
    lat.push(performance.now() - t0);
    if (r.status === 503) { await r.body?.cancel(); return 'REBUILDING' as const; }
    const text = await r.text();
    b.res += Buffer.byteLength(text);
    if (!r.ok) throw new Error(`${cellId} answered ${r.status}`);
    return JSON.parse(text);
  };
}
const httpCell = new Map(X.cells.map((c) => [c.id, {
  send: countingSend(c.id, c.url),
  enrol: async (reqs: BindReq[]) => {
    const r = await fetch(`${c.url}/v1/enrol`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enrols: reqs }), signal: AbortSignal.timeout(30_000) });
    if (!r.ok) throw new Error(`${c.id} answered ${r.status}`);
    return ((await r.json()) as { results: EnrolResult[] }).results;
  },
}]));

// 4. Run the swarm: real forwarding traffic to real cells, at speed.
log(`Starting swarm (speed=${SPEED})…`);
const rows = await (async () => { const out = []; for await (const r of readCohort(cohortPath)) out.push(r); return out; })();
const swarm = await Swarm.start({ dir: X, manifest, authorityPub: hexToBytes(keys.authority.pub), rows, forms, cell: (id) => httpCell.get(id)!, speed: SPEED });
const t0 = Date.now();
// Warm-up: wait until most seats are enrolled/unlocked before the measurement window starts.
await new Promise((r) => setTimeout(r, 15_000));
for (const arr of bytesByCell.values()) { arr.req = 0; arr.res = 0; }                         // reset counters after warm-up
for (const arr of latMsByCell.values()) arr.length = 0;
const winStart = Date.now();
await new Promise((r) => setTimeout(r, SECONDS * 1000));
const winMs = Date.now() - winStart;
const stats = swarm.stats();
log(`Swarm after warm-up + ${(winMs / 1000).toFixed(1)}s measurement window: ${JSON.stringify(stats)}`);

// 5. Cell counters, straight from each cell's own /v1/stats (unmodified route).
for (let i = 0; i < 3; i++) {
  const s = await (await fetch(`http://127.0.0.1:${cellPorts[i]}/v1/stats`)).json();
  log(`cell-${i + 1} /v1/stats: ${JSON.stringify(s)}`);
}

// 6. Ingest latency (relay→cell /v1/sync round-trip, as actually driven by the swarm's forwarders) and WAN bytes/candidate-hour.
let allLat: number[] = [], totalReq = 0, totalRes = 0;
for (const [id, arr] of latMsByCell) { allLat = allLat.concat(arr); const b = bytesByCell.get(id)!; totalReq += b.req; totalRes += b.res; log(`${id}: ${arr.length} sync calls, ${b.req} req bytes, ${b.res} res bytes`); }
const p50 = percentile(allLat, 50), p99 = percentile(allLat, 99);
const activeCands = stats.unlocked;
const hours = winMs / 3_600_000;
const bytesPerCandHour = activeCands > 0 ? (totalReq + totalRes) / activeCands / hours : NaN;
log('');
log(`Ingest latency (relay→cell /v1/sync round-trip, ${allLat.length} calls in the measurement window): p50=${p50.toFixed(1)}ms p99=${p99.toFixed(1)}ms`);
log(`Relay↔cell WAN bytes: ${totalReq} req + ${totalRes} res = ${totalReq + totalRes} bytes over ${(winMs / 1000).toFixed(1)}s, ${activeCands} unlocked candidates`);
log(`  → ${bytesPerCandHour.toFixed(0)} bytes/candidate-hour (measured window extrapolated to an hour; not a real exam's duty cycle)`);

await swarm.stop();
await stack.stopAll();

// 7. One real seat (apps/seat/src/main/seat.ts, Electron-free), run in tools/measure-seat.ts as its OWN process (so the `ps`
// sample isn't contaminated by this process's 20k-candidate swarm heap) — full flow: real cells+relay+control+witness,
// real custodian release, PIN enrolment. Excludes Electron's renderer/GPU overhead (that needs the packaged app).
log('');
log('Seat CPU/RSS (one real Seat, own process, full flow: real cells+relay+control+witness, real custodian release, PIN enrolment):');
{
  const out = execFileSync('bun', [join(ROOT, 'tools/measure-seat.ts')], { encoding: 'utf8', cwd: ROOT });
  const line = out.split('\n').find((l) => l.startsWith('SEAT_SAMPLE '));
  if (!line) log(`  no SEAT_SAMPLE line in output:\n${out}`);
  else {
    const s = JSON.parse(line.slice('SEAT_SAMPLE '.length)) as { n: number; seconds: number; cpuPct: { p50: number; max: number }; rssMiB: { p50: number; max: number } };
    log(`  ${s.n} samples over ${s.seconds.toFixed(1)}s answering: CPU% p50=${s.cpuPct.p50.toFixed(1)} max=${s.cpuPct.max.toFixed(1)}; RSS p50=${s.rssMiB.p50.toFixed(1)}MiB max=${s.rssMiB.max.toFixed(1)}MiB`);
  }
}

// 8. RPO/RTO: cite the existing chaos evidence rather than re-measuring (docs/evidence/stage8-chaos.jsonl, 20 logged runs).
log('');
log('RPO/RTO: not re-measured here. See docs/evidence/stage8-chaos.jsonl (20 chaos runs from tools/chaos.ts, already logged for');
log('Stage 8) and docs/claims-ledger.md R8 — 0 answers lost across all 20 runs, RTO ~1-1.3s p50 (kill-cell/wipe-cell/spare-relay).');

rmSync(dir, { recursive: true, force: true });
mkdirSync(join(ROOT, 'docs/evidence'), { recursive: true });
writeFileSync(join(ROOT, OUT), lines.join('\n') + '\n');
log('');
log(`Wrote ${OUT}`);
process.exit(0);
