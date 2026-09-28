// Stage 7 measured load, seat half: one real Seat (apps/seat/src/main/seat.ts, Electron-free) enrolled and released for real
// against real cells+relay+control+witness (tools/stack.ts, unmodified), then sampled with `ps` on THIS process's own pid
// while it answers. Run as its own process (spawned by tools/measure.ts) so the sample isn't contaminated by the 20k-candidate
// swarm's retained heap. Prints one line: SEAT_SAMPLE {...} and exits.
//   bun tools/measure-seat.ts
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hexToBytes } from '../packages/core/src/bytes.ts';
import { DEV_EXAM, type KeysFile } from '../packages/core/src/dev.ts';
import { Seat } from '../apps/seat/src/main/seat.ts';
import { buildPackage, writePackage, zeroise } from './package.ts';
import { freePort, ROOT } from './procs.ts';
import { provision } from './provision.ts';
import { demoSpecs, Stack } from './stack.ts';
import { shareRequest } from '../apps/server/src/custodian-view.ts';

const read = (f: string) => JSON.parse(readFileSync(join(ROOT, f), 'utf8'));
const keys = read('fixtures/keys.json') as KeysFile;
const authority = { priv: hexToBytes(keys.authority.priv), pub: hexToBytes(keys.authority.pub) };
const percentile = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] : NaN; };

const sdir = mkdtempSync(join(tmpdir(), 'saakshi-measure-seat-'));
const ports = { cells: [freePort(), freePort(), freePort()], relay: freePort(), control: freePort(), witness: freePort(), stack: freePort() };
const exam = join(sdir, 'exam');
const X = provision({ out: exam, keys, cands: [{ cand: 'C0001', centre: 'CEN042', form: 'F1', pwd: 0 }], cellUrls: ports.cells.map((p) => `http://127.0.0.1:${p}`) });
const pkg = await buildPackage(X, { bank: read('fixtures/paper/bank.json'), forms: read('fixtures/paper/forms.json') }, authority);
writePackage(exam, pkg);
const custodians = { NTA: { file: pkg.shares.NTA, pass: pkg.passphrases.NTA }, NIC: { file: pkg.shares.NIC, pass: pkg.passphrases.NIC } };
zeroise(pkg);

const specs = demoSpecs({ exam, data: join(sdir, 'data'), stackUrl: `http://127.0.0.1:${ports.stack}`, cellPorts: ports.cells, relayPort: ports.relay, controlPort: ports.control, witnessPort: ports.witness });
specs.find((s) => s.name === 'relay')!.env.HOST = '127.0.0.1';
mkdirSync(join(sdir, 'data'), { recursive: true });
const stack = new Stack(specs, { cwd: sdir });
for (const s of specs) await stack.start(s.name);
const R = `http://127.0.0.1:${ports.relay}`, C = `http://127.0.0.1:${ports.control}`;
const wrap = { encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() };
mkdirSync(join(sdir, 'seat'), { recursive: true });
const seat = new Seat({ dir: join(sdir, 'seat'), relayUrl: R, ctx: { ...DEV_EXAM, cand: 'C0001' }, seatId: 'CEN042-S01', authorityPub: authority.pub, wrap, camera: false, testMode: true, retryMs: 200 });
await seat.open();
const waitFor = async (ok: () => boolean, ms: number) => { const t = Date.now(); while (!ok()) { if (Date.now() - t > ms) throw new Error('seat measurement setup timed out'); await new Promise((r) => setTimeout(r, 100)); } };
await waitFor(() => seat.boot().phase === 'enrol', 15_000);
await seat.enrol({ pin: '482913', operatorId: 'GATE-42-OP7', method: 'aadhaar-face' });
await waitFor(() => seat.boot().bind === 'bound', 20_000);
const callJson = async <T>(url: string, method = 'GET', body?: unknown): Promise<T> => { const r = await fetch(url, { method, headers: body === undefined ? {} : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }); if (!r.ok) throw new Error(`${method} ${url} → ${r.status}`); return r.json() as Promise<T>; };
const key = await callJson<{ exam: string; shift: string; keyId: number; pub: string }>(`${C}/v1/release/key`);
for (const c of ['NTA', 'NIC'] as const) await callJson(`${C}/v1/release/share`, 'POST', shareRequest(custodians[c].file, custodians[c].pass, key));
await waitFor(() => seat.boot().phase === 'ready', 30_000);
seat.start();

// Idle a moment so the process's RSS settles after setup, before sampling.
await new Promise((r) => setTimeout(r, 1_000));
const samples: { cpu: number; rssKb: number }[] = [];
const pid = process.pid;
const sample = () => { try { const out = execFileSync('ps', ['-o', '%cpu=,rss=', '-p', String(pid)], { encoding: 'utf8' }).trim().split(/\s+/); samples.push({ cpu: Number(out[0]), rssKb: Number(out[1]) }); } catch { /* process gone */ } };
const items = seat.paper()?.items ?? [];
const t1 = Date.now();
let i = 0;
while (Date.now() - t1 < 10_000 && items.length) {
  for (let k = 0; k < 10; k++, i++) seat.act({ kind: 'answer', item: items[i % items.length]!.id, state: 'A', answer: 'ABCD'[i % 4]!, dwellMs: 1000 });
  sample();
  await new Promise((r) => setTimeout(r, 200));
}
const cpus = samples.map((s) => s.cpu), rss = samples.map((s) => s.rssKb);
console.log(`SEAT_SAMPLE ${JSON.stringify({
  n: samples.length, seconds: (Date.now() - t1) / 1000,
  cpuPct: { p50: percentile(cpus, 50), max: samples.length ? Math.max(...cpus) : NaN },
  rssMiB: { p50: percentile(rss, 50) / 1024, max: samples.length ? Math.max(...rss) / 1024 : NaN },
})}`);
await stack.stopAll();
rmSync(sdir, { recursive: true, force: true });
process.exit(0);
