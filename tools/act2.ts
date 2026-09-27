// Stage 3 end to end (Act 2) on real processes: provision → package → 3 cells + the Centre 42 relay + control; the swarm (a small
// G1) and a real seat at Centre 42 (the seat's own code) → cut Centre 42's link → two custodians release → every simulated centre
// goes green while Centre 42 stays locked → a typo and another centre's code fail → the phoned code unlocks Centre 42 → a forged
// key is rejected → a relay restart re-delivers the release without a second unlock → the link returns and the seat syncs.
// Needs local ports (run it unsandboxed) and uv (it generates a small G1 unless --cohort is given).
//   bun tools/act2.ts [--cohort path/to/cohort.jsonl]
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { hexToBytes } from '../packages/core/src/bytes.ts';
import { DEV_EXAM, type KeysFile } from '../packages/core/src/dev.ts';
import { FILES, type FleetView, type ReleaseStatus } from '../packages/core/src/directory.ts';
import type { BindReq } from '../packages/core/src/enrol.ts';
import { formsOf } from '../packages/core/src/sheet.ts';
import type { EnrolResult } from '../apps/server/src/bindings.ts';
import { shareRequest, type ReleaseKey } from '../apps/server/src/custodian-view.ts';
import { httpCellSend } from '../apps/server/src/forward.ts';
import type { Wrapper } from '../apps/seat/src/main/journal-store.ts';
import { Seat } from '../apps/seat/src/main/seat.ts';
import { readCohort, type CohortRow } from './cohort.ts';
import { buildPackage, writePackage, zeroise } from './package.ts';
import { cohortCands, provision } from './provision.ts';
import { Swarm } from './swarm.ts';

const root = resolve(import.meta.dir, '..');
const arg = (f: string) => { const i = process.argv.indexOf(f); return i > 0 ? process.argv[i + 1] : undefined; };
const read = (f: string) => JSON.parse(readFileSync(join(root, f), 'utf8'));
const keys = read('fixtures/keys.json') as KeysFile;
const forms = formsOf(read('fixtures/paper/forms.json'));
const authority = { priv: hexToBytes(keys.authority.priv), pub: hexToBytes(keys.authority.pub) };
const dir = mkdtempSync(join(tmpdir(), 'saakshi-act2-'));
const fail = (m: string): never => { throw new Error(m); };
const step = (m: string) => console.log(`✓ ${m}`);
const freePort = (): number => { const s = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Response() }); const p = s.port!; s.stop(true); return p; };

async function spawnServer(env: Record<string, string>) {
  const proc = Bun.spawn(['bun', join(root, 'apps/server/src/main.ts')], { cwd: dir, env: { ...process.env, DEV: '1', ...env }, stdout: 'pipe', stderr: 'inherit' });
  const out: string[] = [];
  void (async () => {
    const dec = new TextDecoder();
    let buf = '';
    for await (const chunk of proc.stdout) {
      buf += dec.decode(chunk);
      for (let i = buf.indexOf('\n'); i >= 0; i = buf.indexOf('\n')) { out.push(buf.slice(0, i)); buf = buf.slice(i + 1); }
    }
  })();
  const deadline = Date.now() + 15_000;
  while (!out.some((l) => l.startsWith('READY '))) {
    if (Date.now() > deadline) fail(`${env.MODE} did not start`);
    await Bun.sleep(20);
  }
  return { proc, out };
}
async function call<T>(url: string, method = 'GET', body?: unknown): Promise<T> {
  const r = await fetch(url, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  if (!r.ok) fail(`${method} ${url} → ${r.status} ${await r.text()}`);
  return (await r.json()) as T;
}
async function until(ok: () => boolean | Promise<boolean>, ms: number, what: string): Promise<void> {
  const end = Date.now() + ms;
  while (!(await ok())) { if (Date.now() > end) fail(`timed out: ${what}`); await Bun.sleep(100); }
}

// 0. A small G1 cohort, unless one is given.
let cohort = arg('--cohort');
if (!cohort) {
  const out = join(dir, 'g1');
  const g = Bun.spawnSync(['uv', 'run', '--directory', join(root, 'analytics'), 'python', '-m', 'saakshi_analytics.generate', out, '--n', '300', '--centres', '6', '--seed', '7'], { stdout: 'inherit', stderr: 'inherit' });
  if (g.exitCode !== 0) fail('uv could not generate the G1 cohort');
  cohort = join(out, 'cohort.jsonl');
}

const ports = { cells: [freePort(), freePort(), freePort()], relay: freePort(), control: freePort() };
const R = `http://127.0.0.1:${ports.relay}`, C = `http://127.0.0.1:${ports.control}`;
const exam = join(dir, 'exam');
const procs: { proc: ReturnType<typeof Bun.spawn> }[] = [];
let swarm: Swarm | undefined, seat: Seat | undefined;

try {
  // 1. Provision and package (the packager zeroises; the custodians keep their files and passphrases).
  const X = provision({ out: exam, keys, cands: await cohortCands(cohort), cellUrls: ports.cells.map((p) => `http://127.0.0.1:${p}`) });
  const pkg = await buildPackage(X, { bank: read('fixtures/paper/bank.json'), forms: read('fixtures/paper/forms.json') }, authority);
  writePackage(exam, pkg);
  const custodians = { NTA: { file: pkg.shares.NTA, pass: pkg.passphrases.NTA }, NIC: { file: pkg.shares.NIC, pass: pkg.passphrases.NIC } };
  zeroise(pkg);
  const sim = Object.keys(X.centres).filter((c) => c !== X.demoCentre);
  step(`provisioned ${Object.keys(X.cands).length} candidates at ${Object.keys(X.centres).length} centres (${sim.length} simulated + ${X.demoCentre}) on 3 cells; packaged; packager secrets zeroised`);

  // 2. Before T0 the paper is ciphertext.
  const ct = readFileSync(join(exam, FILES.paper('F1')));
  if ((read('fixtures/paper/bank.json') as { items: { en: { q: string } }[] }).items.some((i) => ct.includes(Buffer.from(i.en.q)))) fail('paper-F1.bin contains question text');
  console.log(`  hexdump package/paper-F1.bin: ${ct.subarray(0, 24).toString('hex').replace(/(.{4})/g, '$1 ')}…`);
  step('the paper on disk is ciphertext: no question text in it');

  // 3. The servers: three cells, Centre 42's relay, control.
  for (const [i, port] of ports.cells.entries()) procs.push(await spawnServer({ MODE: 'cell', PORT: String(port), EXAM: exam, CELL_ID: `cell-${i + 1}`, DB: join(dir, `cell-${i + 1}.db`) }));
  const relayEnv = { MODE: 'relay', PORT: String(ports.relay), HOST: '127.0.0.1', EXAM: exam, CENTRE: X.demoCentre, DB: join(dir, 'relay.db') };
  let relayP = await spawnServer(relayEnv);
  procs.push(relayP);
  procs.push(await spawnServer({ MODE: 'control', PORT: String(ports.control), EXAM: exam, DIR: join(dir, 'control'), RELAY_URL: R }));

  // 4. A real seat at Centre 42, run by the seat's own code (package → enrolment → release watcher → exam).
  const wrap: Wrapper = { encryptString: (s) => Buffer.from(s), decryptString: (b) => b.toString() };
  mkdirSync(join(dir, 'seat'));                                                      // the app's userData exists; here we make it
  seat = new Seat({ dir: join(dir, 'seat'), relayUrl: R, ctx: { ...DEV_EXAM, cand: 'C0001' }, seatId: 'CEN042-S01', authorityPub: authority.pub, wrap, camera: false, testMode: true, retryMs: 200 });
  await seat.open();
  await until(() => seat!.boot().phase === 'enrol', 10_000, 'the seat loading its package').catch((e) => fail(`${(e as Error).message} (${seat!.boot().notice})`));
  await seat.enrol({ pin: '482913', operatorId: 'GATE-42-OP7', method: 'aadhaar-face' });
  await until(() => seat!.boot().bind === 'bound', 20_000, 'the seat enrolment');
  if (seat.start().ok || seat.paper()) fail('the seat started before T0');
  step(`seat C0001 enrolled at ${X.demoCentre}: its bind certificate verified against the policy-pinned cell key; the paper stays locked`);

  // 5. The swarm: the simulated centres run the real relay code in this process; the cells are the real processes.
  const rows: CohortRow[] = [];
  for await (const r of readCohort(cohort)) if (X.cands[r.cand] && forms[r.form]?.includes(r.item)) rows.push({ ...r, shift: X.shift });
  swarm = await Swarm.start({ dir: X, manifest: pkg.manifest, authorityPub: authority.pub, rows, forms, speed: 200, cell: (id) => {
    const url = X.cells.find((c) => c.id === id)!.url;
    return {
      send: httpCellSend(url, 10_000),
      enrol: async (reqs: BindReq[]) => {
        const r = await fetch(`${url}/v1/enrol`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enrols: reqs }) });
        if (!r.ok) throw new Error(`${id} answered ${r.status}`);
        return ((await r.json()) as { results: EnrolResult[] }).results;
      },
    };
  } });
  const s0 = swarm.stats();
  if (!s0.cands || s0.bound !== s0.cands) fail(`swarm enrolment: ${JSON.stringify(s0)}`);
  step(`swarm: ${s0.centres} simulated centres, ${s0.cands} candidates enrolled`);

  // 6. Cut Centre 42's link (DEV chaos, through control).
  await call(`${C}/v1/chaos/wan`, 'POST', { up: false });
  step(`${X.demoCentre}'s link cut`);

  // 7. Two custodians release — exactly what /custodian runs in their browsers.
  const key = await call<ReleaseKey>(`${C}/v1/release/key`);
  for (const c of ['NTA', 'NIC'] as const) await call(`${C}/v1/release/share`, 'POST', shareRequest(custodians[c].file, custodians[c].pass, key));
  await until(async () => (await call<ReleaseStatus>(`${C}/v1/release/status`)).zeroised, 30_000, 'the release reaching every cell');
  const rs = await call<ReleaseStatus>(`${C}/v1/release/status`);
  step(`released by ${rs.released!.custodians.join(' + ')}; pushed to ${Object.keys(rs.pushed).join(', ')}; keys zeroised at control`);

  // 8. Every simulated centre goes green; Centre 42 stays locked.
  await until(async () => (await call<FleetView>(`${C}/v1/fleet`)).centres.filter((t) => t.centre !== X.demoCentre).every((t) => t.tone === 'green'), 90_000, 'every simulated centre green');
  const f1 = await call<FleetView>(`${C}/v1/fleet`);
  const t42 = f1.centres.find((t) => t.centre === X.demoCentre)!;
  if (t42.unlocked !== 0 || seat.paper()) fail(`${X.demoCentre} unlocked without its link: ${JSON.stringify(t42)}`);
  step(`${f1.centres.filter((t) => t.tone === 'green').length} of ${f1.centres.length} centres green; ${X.demoCentre} locked (link cut); ${f1.registered} candidates registered`);

  // 9. A code with a typo, and another centre's code, do not open Centre 42's paper.
  const other = await call<{ code: string }>(`${C}/v1/release/code`, 'POST', { centre: sim[0], superintendent: 'SUP-1', callback: true });
  const typo = other.code.slice(0, 5) + (other.code[5] === 'A' ? 'B' : 'A') + other.code.slice(6);
  for (const [code, want] of [[typo, /typo/], [other.code, /does not open/]] as const) {
    const r = await fetch(`${R}/v1/release/offline`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code }) });
    if (r.status !== 400 || !want.test(((await r.json()) as { error: string }).error)) fail(`the relay did not refuse ${code}`);
  }
  step(`a typo and ${sim[0]}'s code are refused at ${X.demoCentre}`);

  // 10. The superintendent phones in: control reveals only Centre 42's code (logged); the relay console unwraps and pushes it.
  const phoned = await call<{ code: string }>(`${C}/v1/release/code`, 'POST', { centre: X.demoCentre, superintendent: 'SUP-42', callback: true });
  await call(`${R}/v1/release/offline`, 'POST', { code: phoned.code.toLowerCase().replace(/(.{4})/g, '$1 ') });
  await until(() => seat!.boot().phase === 'ready', 20_000, 'the seat unlocking with the phoned code');
  if (seat.boot().release?.via !== 'code') fail('the seat did not record the offline path');
  if (!seat.start().ok) fail('start failed after the unlock');
  seat.paper()!.items.slice(0, 5).forEach((it, i) => seat!.act({ kind: 'answer', item: it.id, state: 'A', answer: 'ABCD'[i % 4], dwellMs: 1000 }));
  const meta = seat.exam!.journal.recs[0].body.meta;
  if (meta[2] !== 'code' || meta[1] !== rs.released!.forms.find((f) => f.form === 'F1')!.kcf) fail(`unlock meta ${JSON.stringify(meta)}`);
  step(`${X.demoCentre} unlocked with the phoned code: the seat checked kc_f and journaled the unlock via "code"`);

  // 11. A forged key is rejected by the seat.
  await call(`${R}/v1/dev/forge`, 'POST');
  await until(() => /Rejected a key/.test(seat!.boot().notice ?? ''), 10_000, 'the seat rejecting a forged key');
  step('a forged key pushed by the relay was rejected by the seat (it does not match kc_f)');

  // 12. The relay restarts: the seat reconnects (a new boot → a snapshot), the signed release arrives too; still one unlock.
  relayP.proc.kill();
  await relayP.proc.exited;
  relayP = await spawnServer(relayEnv);                                             // the DEV WAN switch is in memory: the link is back
  procs.push(relayP);
  await Bun.sleep(3000);
  const unlocks = seat.exam!.journal.headers.filter((h) => h.kind === 'unlock').length;
  if (unlocks !== 1) fail(`${unlocks} unlock entries after the relay restart`);
  step('relay restarted: the release reached the seat again by snapshot and by push; exactly one unlock');

  // 13. The link is back: the seat's answers reach its cell; the custody log records the fallback.
  await until(() => seat!.boot().sync.cell >= seat!.exam!.head(), 30_000, "the seat's entries reaching cell-1");
  const log = readFileSync(join(dir, 'control', 'custody.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { action: string; centre?: string });
  for (const a of ['chaos-wan', 'share-received', 'release', 'keys-zeroised', 'offline-code-revealed']) if (!log.some((l) => l.action === a)) fail(`the custody log lacks ${a}`);
  const reveals = log.filter((l) => l.action === 'offline-code-revealed').map((l) => l.centre);
  if (reveals.join() !== [sim[0], X.demoCentre].join()) fail(`reveals: ${reveals.join()}`);
  step(`custody log: 2 custodians released, keys zeroised, codes revealed for ${reveals.join(' and ')}, each logged`);

  // 14. The swarm's answers flow into the cells and every simulated candidate submits.
  await until(async () => (await call<FleetView>(`${C}/v1/fleet`)).submitted >= s0.cands, 120_000, 'every simulated candidate submitting');
  const f2 = await call<FleetView>(`${C}/v1/fleet`);
  step(`${f2.entries} entries committed at the cells; ${f2.submitted} candidates submitted`);
  console.log('PASS');
} finally {
  seat?.close();
  await swarm?.stop();
  for (const p of procs) p.proc.kill();
  await Promise.all(procs.map((p) => p.proc.exited));
  rmSync(dir, { recursive: true, force: true });
}
