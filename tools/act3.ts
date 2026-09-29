// Stage 4 end to end (Act 3) on real processes, supervised by tools/stack.ts's Stack (so control's chaos buttons are real):
// provision (DEMO ops) → package → 3 cells + the Centre 42 relay + control; the swarm (a small G1) and a real seat at Centre 42 (the
// seat's own code) → release → degrade Centre 42's link → SYNC_LAG predicts → cut → RELAY_WAN_DOWN (and how early it was predicted),
// the seat's banner, the ladder climbs, ack → pull the plug on Data Centre 2 and delete its DB → P1 with its blast radius, candidates keep
// answering → restart → rebuild → the P1 closes with answers lost 0 → sent = verified = stored → seat A at blue ✓✓, backlog 0, force-quit
// → seat B: PIN → the invigilator approves → resumes with the same answers and time, credited → seat A comes back: ORPHANED, "moved" →
// submit → seal → /verify of the moved candidate with only the authority key → archive to 2 stores → purge → rogue insider → TAMPER →
// the regulator rung drafts CERT-In → the public status carries no PII; a notice is approved.
// Needs local ports (run it unsandboxed) and uv (it generates a small G1 unless --cohort is given).
//   bun tools/act3.ts [--cohort path/to/cohort.jsonl]
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hexToBytes, toHex } from '../packages/core/src/bytes.ts';
import { DEV_EXAM, type KeysFile } from '../packages/core/src/dev.ts';
import type { FleetView, ReleaseStatus } from '../packages/core/src/directory.ts';
import type { BindReq } from '../packages/core/src/enrol.ts';
import { leafHashHex, sthId, sthMessage } from '../packages/core/src/log.ts';
import { rootOf } from '../packages/core/src/merkle.ts';
import { signer, verifier } from '../packages/core/src/node.ts';
import { OPS_DEMO, type Incident, type LinkView, type Notice, type PublicStatus, type TimeRow } from '../packages/core/src/ops.ts';
import { formsOf, type Proof, type ShiftExport, type SthRecord } from '../packages/core/src/sheet.ts';
import { verifyProof, verifySheet } from '../packages/core/src/verify.ts';
import type { EnrolResult } from '../apps/server/src/bindings.ts';
import { shareRequest, type ReleaseKey } from '../apps/server/src/custodian-view.ts';
import { httpCellSend } from '../apps/server/src/forward.ts';
import { blastText, mmss } from '../apps/server/src/incidents.ts';
import type { Wrapper } from '../apps/seat/src/main/journal-store.ts';
import { Seat } from '../apps/seat/src/main/seat.ts';
import { readCohort, type CohortRow } from './cohort.ts';
import { buildPackage, writePackage, zeroise } from './package.ts';
import { call, freePort, ROOT, until } from './procs.ts';
import { cohortCands, provision } from './provision.ts';
import { demoSpecs, Stack } from './stack.ts';
import { Swarm } from './swarm.ts';

const arg = (f: string) => { const i = process.argv.indexOf(f); return i > 0 ? process.argv[i + 1] : undefined; };
const read = (f: string) => JSON.parse(readFileSync(join(ROOT, f), 'utf8'));
const keys = read('fixtures/keys.json') as KeysFile;
const forms = formsOf(read('fixtures/paper/forms.json'));
const authority = { priv: hexToBytes(keys.authority.priv), pub: hexToBytes(keys.authority.pub) };
const onlyAuthority = { authority: keys.authority.pub, cells: {}, seats: {} };
const dir = mkdtempSync(join(tmpdir(), 'saakshi-act3-'));
const fail: (m: string) => never = (m) => { throw new Error(m); };
const step = (m: string) => console.log(`✓ ${m}`);
const PIN = '482913', ctx = { ...DEV_EXAM, cand: 'C0001' };
const wrap: Wrapper = { encryptString: (s) => Buffer.from(s), decryptString: (b) => b.toString() };
const numbers: Record<string, number> = {};

let cohort = arg('--cohort');
if (!cohort) {
  const out = join(dir, 'g1');
  const g = Bun.spawnSync(['uv', 'run', '--directory', join(ROOT, 'analytics'), 'python', '-m', 'saakshi_analytics.generate', out, '--n', '300', '--centres', '6', '--seed', '7'], { stdout: 'inherit', stderr: 'inherit' });
  if (g.exitCode !== 0) fail('uv could not generate the G1 cohort');
  cohort = join(out, 'cohort.jsonl');
}

const ports = { cells: [freePort(), freePort(), freePort()], relay: freePort(), control: freePort(), witness: freePort(), stack: freePort() };
const R = `http://127.0.0.1:${ports.relay}`, C = `http://127.0.0.1:${ports.control}`;
console.log(`CONTROL ${C}`);   // tools/record.ts attaches its browser here
const exam = join(dir, 'exam');
let stack: Stack | undefined, swarm: Swarm | undefined, supervisor: ReturnType<Stack['serve']> | undefined;
const seats: Seat[] = [];
const newSeat = (sub: string, seatId: string) => { mkdirSync(join(dir, sub), { recursive: true }); const s = new Seat({ dir: join(dir, sub), relayUrl: R, ctx, seatId, authorityPub: authority.pub, wrap, camera: false, testMode: true, retryMs: 200 }); seats.push(s); return s; };
let next = 0;
const answer = (s: Seat, n: number) => {
  const items = s.paper()!.items;
  for (let i = 0; i < n; i++) { const r = s.act({ kind: 'answer', item: items[next++ % items.length].id, state: 'A', answer: 'A', dwellMs: 1_000 }); if (!r.ok) fail(`answer refused: ${r.error}`); }
};
const blue = (s: Seat) => s.boot().sync.cell >= s.exam!.head() && s.boot().sync.relay >= s.exam!.head();
const incidents = async () => (await call<{ incidents: Incident[] }>(`${C}/v1/incidents`)).incidents;
const openOf = async (kind: Incident['kind'], cand?: string) => (await incidents()).find((i) => i.kind === kind && !i.resolvedAt && (!cand || i.cand === cand));

try {
  // 1. Provision with the DEMO ops (10 s ladder), package, keep two custodians' files.
  const X = provision({ out: exam, keys, cands: await cohortCands(cohort), cellUrls: ports.cells.map((p) => `http://127.0.0.1:${p}`), ops: OPS_DEMO });
  const pkg = await buildPackage(X, { bank: read('fixtures/paper/bank.json'), forms: read('fixtures/paper/forms.json') }, authority);
  writePackage(exam, pkg);
  const custodians = { NTA: { file: pkg.shares.NTA, pass: pkg.passphrases.NTA }, NIC: { file: pkg.shares.NIC, pass: pkg.passphrases.NIC } };
  zeroise(pkg);
  const onCell2 = Object.entries(X.centres).filter(([, c]) => c.cell === 'cell-2').map(([id]) => id);
  if (!onCell2.length) fail('this cohort puts no centre on cell-2');

  // 2. The processes, under the supervisor control's chaos buttons talk to.
  const specs = demoSpecs({ exam, data: join(dir, 'data'), stackUrl: `http://127.0.0.1:${ports.stack}`, cellPorts: ports.cells, relayPort: ports.relay, controlPort: ports.control, witnessPort: ports.witness });
  specs.find((s) => s.name === 'relay')!.env.HOST = '127.0.0.1';
  mkdirSync(join(dir, 'data'), { recursive: true });
  stack = new Stack(specs, { cwd: dir, log: (n, l) => { if (/PLUG|HANDOVER|WAN|PURGED|ROGUE/.test(l)) console.log(`  [${n}] ${l}`); } });
  for (const s of specs) await stack.start(s.name);
  supervisor = stack.serve(ports.stack);
  step(`stack up: 3 cells, ${X.demoCentre}'s relay, control (DEMO timers), supervisor on :${ports.stack}`);

  // 3. Seat A at Centre 42 (the seat's own code), the swarm, the release.
  const seatA = newSeat('seatA', 'CEN042-S01');
  await seatA.open();
  await until(() => seatA.boot().phase === 'enrol', 15_000, 'seat A loading its package');
  await seatA.enrol({ pin: PIN, operatorId: 'GATE-42-OP7', method: 'aadhaar-face' });
  await until(() => seatA.boot().bind === 'bound', 20_000, 'seat A enrolment');
  const rows: CohortRow[] = [];
  for await (const r of readCohort(cohort)) if (X.cands[r.cand] && forms[r.form]?.includes(r.item)) rows.push({ ...r, shift: X.shift });
  swarm = await Swarm.start({ dir: X, manifest: pkg.manifest, authorityPub: authority.pub, rows, forms, speed: 50, cell: (id) => {
    const url = X.cells.find((c) => c.id === id)!.url;
    return { send: httpCellSend(url, 10_000), enrol: async (reqs: BindReq[]) => ((await call<{ results: EnrolResult[] }>(`${url}/v1/enrol`, 'POST', { enrols: reqs })).results) };
  } });
  const key = await call<ReleaseKey>(`${C}/v1/release/key`);
  for (const c of ['NTA', 'NIC'] as const) await call(`${C}/v1/release/share`, 'POST', shareRequest(custodians[c].file, custodians[c].pass, key));
  await until(async () => (await call<ReleaseStatus>(`${C}/v1/release/status`)).zeroised, 30_000, 'the release reaching every cell');
  await until(() => seatA.boot().phase === 'ready', 30_000, 'seat A unlocking');
  seatA.start();
  answer(seatA, 5);
  await until(() => blue(seatA), 30_000, 'seat A at blue ✓✓');
  step(`released by NTA + NIC; seat A answering at ${X.demoCentre}; swarm: ${swarm.stats().cands} candidates`);

  // 4. Degrade Centre 42's link: SYNC_LAG predicts; then the cut; the banner; the ladder climbs; ack; restore.
  await call(`${C}/v1/chaos/degrade`, 'POST', { on: true });
  const tDegrade = Date.now();
  await until(async () => { answer(seatA, 1); return !!(await openOf('SYNC_LAG')); }, 120_000, 'SYNC_LAG predicting the failure', 1_000);
  numbers.syncLagAfterDegradeMs = Date.now() - tDegrade;
  const lk = await call<LinkView>(`${C}/v1/link`);
  if (lk.cut) fail('SYNC_LAG must come before the cut');
  step(`SYNC_LAG: "${lk.reason}" — ${Math.round(numbers.syncLagAfterDegradeMs / 1000)} s after the link began to degrade, before it was cut`);
  await call(`${C}/v1/chaos/wan`, 'POST', { up: false });
  await until(async () => !!(await openOf('RELAY_WAN_DOWN')), 30_000, 'RELAY_WAN_DOWN');
  const rwd = (await openOf('RELAY_WAN_DOWN'))!;
  if (!(Number(rwd.data.warnedMs) > 0)) fail('RELAY_WAN_DOWN did not record the earlier prediction');
  numbers.predictedBeforeDownMs = Number(rwd.data.warnedMs);
  await until(() => seatA.boot().status?.link === 'down', 15_000, 'the seat\'s banner status');
  if (!(await call<PublicStatus>(`${C}/v1/status/public`)).incidents.some((i) => i.kind === 'RELAY_WAN_DOWN')) fail('the public page does not show the outage');
  await until(async () => ((await openOf('RELAY_WAN_DOWN'))?.ladder.length ?? 0) >= 2, 25_000, 'the unacknowledged alert climbing the ladder');
  const climbed = (await openOf('RELAY_WAN_DOWN'))!;
  await call(`${C}/v1/incidents/ack`, 'POST', { id: climbed.id, by: 'SUP-42' });
  step(`cut: RELAY_WAN_DOWN predicted ${Math.round(numbers.predictedBeforeDownMs / 1000)} s earlier; banner at the seat; unacknowledged, it climbed to ${climbed.ladder.at(-1)!.rung}; acknowledged by SUP-42`);
  await call(`${C}/v1/chaos/wan`, 'POST', { up: true });
  await call(`${C}/v1/chaos/degrade`, 'POST', { on: false });
  await until(() => blue(seatA), 90_000, 'seat A at blue ✓✓ after the link returned');

  // 5. Pull the plug on Data Centre 2 and delete its database.
  const tPlug = Date.now();
  await call(`${C}/v1/chaos/plug`, 'POST', { cell: 'cell-2', wipe: true });
  await until(async () => !!(await openOf('CELL_DOWN')), 15_000, 'the P1 card');
  const p1 = (await openOf('CELL_DOWN'))!;
  if (p1.severity !== 'P1' || p1.blast.cells[0] !== 'cell-2' || p1.blast.centres.length !== onCell2.length || p1.blast.candidates < 1) fail(`the P1 card: ${JSON.stringify(p1)}`);
  step(`P1 "${p1.title}": ${blastText(p1.blast)}`);
  const sentBefore = swarm.stats().sent;
  answer(seatA, 2);
  await Bun.sleep(3_000);
  if (swarm.stats().sent <= sentBefore) fail('candidates stopped answering while cell-2 was down');
  step(`candidates keep answering: the swarm sent ${swarm.stats().sent - sentBefore} more entries while Data Centre 2 was down`);
  await call(`${C}/v1/chaos/restart`, 'POST', { cell: 'cell-2' });
  await until(async () => (await call<FleetView>(`${C}/v1/fleet`)).cells.find((c) => c.id === 'cell-2')?.state === 'LIVE', 180_000, 'cell-2 LIVE again');
  numbers.cell2LiveMs = Date.now() - tPlug;
  await until(async () => !!(await incidents()).find((i) => i.id === p1.id)?.resolvedAt, 60_000, 'the P1 closing');
  const closed = (await incidents()).find((i) => i.id === p1.id)!;
  if (closed.blast.answersLost !== 0) fail(`answers lost: ${closed.blast.answersLost}`);
  step(`Data Centre 2 rebuilt from the relays: LIVE ${Math.round((Date.now() - tPlug) / 1000)} s after the plug; the P1 closed with answers lost 0`);

  // 6. sent = verified = stored, once every simulated candidate has submitted.
  await until(() => swarm!.stats().done >= swarm!.stats().cands, 240_000, 'every simulated candidate submitting');
  const sentNow = async () => swarm!.centres.reduce((n, c) => n + c.ingest.views().reduce((m, v) => m + v.head, 0), 0)
    + (await call<{ streams: { head: number }[] }>(`${R}/v1/heads`)).streams.reduce((m, v) => m + v.head, 0);
  const storedNow = async () => (await call<FleetView>(`${C}/v1/fleet`)).cells.reduce((n, c) => n + c.entries, 0);
  await until(async () => (await storedNow()) === (await sentNow()), 180_000, 'sent = stored');
  numbers.caughtUpMs = Date.now() - tPlug;
  // The fleet view is a polled snapshot, so the counts can agree for a moment while entries are still in flight: retry until one pass agrees.
  let sent = 0, verified = 0, stored = 0;
  await until(async () => {
    sent = await sentNow();
    verified = 0;
    for (const c of X.cells) {
      const exp = await call<ShiftExport>(`${c.url}/v1/shift?exam=${X.exam}&shift=${X.shift}`);
      for (const s of exp.sheets) {
        const v = verifySheet(s, forms, onlyAuthority, verifier, X.cells);
        if (['keys', 'chain', 'bodies'].every((n) => v.checks.find((x) => x.name === n)?.ok)) verified += s.entries.length;
      }
    }
    stored = await storedNow();
    return sent === verified && verified === stored;
  }, 60_000, 'sent = verified = stored', 1_000).catch(() => fail(`sent ${sent} · verified ${verified} · stored ${stored}`));
  step(`sent = verified = stored = ${stored} entries (verified: every chain, key certificate and body checked with only the authority key pinned); lost 0`);

  // 7. Seat A at blue ✓✓, backlog 0 → force-quit → seat B, PIN, the invigilator approves → resumes; seat A returns → ORPHANED.
  await until(() => blue(seatA), 60_000, 'seat A at blue ✓✓, backlog 0');
  const itemsA = seatA.boot().items, activeA = seatA.exam!.activeMs();
  seatA.close();
  const seatB = newSeat('seatB', 'CEN042-S02');
  await seatB.open();
  await until(() => seatB.boot().phase === 'enrol', 15_000, 'seat B loading its package');
  await seatB.enrol({ pin: PIN, operatorId: 'GATE-42-OP7', method: 'aadhaar-face' });
  await until(() => !!seatB.boot().moveable, 15_000, 'seat B refused: bound elsewhere');
  await seatB.handover(PIN);
  const moveKey = seatB.boot().moveKey!;
  // The seat's first POST can miss the relay (it is still draining the swarm); the seat resends on its own poll, so wait for it.
  await until(async () => (await call<{ pending: { cand: string; key: string }[] }>(`${R}/v1/handover/pending`)).pending.some((p) => p.cand === 'C0001' && p.key === moveKey),
    15_000, 'the move waiting at the relay console').catch(async (e) => fail(`the move is not waiting at the relay console: ${(e as Error).message}; key ${moveKey}; seat: ${seatB.boot().notice ?? ''}; relay: ${JSON.stringify(await call(`${R}/v1/handover/pending`))}`));
  await call(`${R}/v1/handover/approve`, 'POST', { cand: 'C0001', key: moveKey, invigilator: 'INV-42-A' });
  await until(() => seatB.boot().phase === 'exam', 30_000, 'seat B resuming');
  const b = seatB.boot();
  for (const [item, st] of Object.entries(itemsA)) if (b.items[item]?.state !== st.state || b.items[item]?.answer !== st.answer) fail(`${item} did not come back`);
  // The timer resumes at entry F's activeMs (C.5); the time seat A ran after F comes back as credit, measured by the relay's clock
  // from when the relay received F, so F's seat→relay delay (up to ~0.5 s here while the swarm loads the machine) is not credited.
  if (!b.credited || b.credited.approvedBy !== 'INV-42-A' || b.activeMs > activeA || b.activeMs + b.credited.ms < activeA - 2_000) fail(`time or credit: ${JSON.stringify({ activeA, b: b.activeMs, credited: b.credited })}`);
  numbers.moveCreditedMs = b.credited.ms;
  step(`seat B resumed C0001: ${Object.keys(itemsA).length} answers restored, timer ${mmss(b.activeMs)}, +${mmss(b.credited.ms)} credited · approved by INV-42-A`);
  answer(seatB, 2);
  await until(() => blue(seatB), 60_000, 'seat B at blue ✓✓');
  await until(async () => !!(await openOf('HANDOVER', 'C0001')), 15_000, 'the HANDOVER incident');
  const seatA2 = newSeat('seatA', 'CEN042-S01');                                       // seat A's laptop comes back
  await seatA2.open();
  await until(() => seatA2.boot().phase === 'moved', 30_000, 'seat A told it has moved');
  await until(async () => !!(await openOf('ORPHANED', 'C0001')), 15_000, 'the ORPHANED incident');
  const row = (await call<{ rows: TimeRow[] }>(`${C}/v1/time`)).rows.find((r) => r.cand === 'C0001')!;
  if (!row.gaps.some((g) => g.kind === 'handover' && g.approvedBy === 'INV-42-A')) fail(`time audit: ${JSON.stringify(row)}`);
  step('seat A came back: its tail is ORPHANED evidence (not tampering) and it says "moved"; the time audit shows the move, approved');

  // 8. Submit, seal, and /verify the moved candidate with only the authority key (Addendum C.1).
  const rc = seatB.submit();
  if (!rc.ok) fail(rc.error);
  await until(() => blue(seatB), 60_000, 'the submit at the cell');
  await call(`${C}/v1/seal`, 'POST');
  const proof = await call<Proof>(`${C}/v1/proof?cand=C0001`);
  const v = verifyProof(proof, forms, onlyAuthority, rc.receipt.code);
  if (!v.ok) fail(`/verify: ${JSON.stringify(v.checks.filter((c) => !c.ok))}`);
  step(`/verify, pinning only the authority key: ${v.checks.find((c) => c.name === 'keys')!.detail}; receipt ${rc.receipt.code}`);

  // 9. Archive to two stores; purge only after both verify.
  const ar = await call<{ ok: boolean; writtenMs: number; verifyMs: number }>(`${C}/v1/archive`, 'POST');
  if (!ar.ok) fail('the archive did not verify');
  const pg = await call<{ purged: number }>(`${C}/v1/archive/purge`, 'POST');
  Object.assign(numbers, { archiveWriteMs: ar.writtenMs, archiveVerifyMs: ar.verifyMs, purged: pg.purged });
  step(`archived to 2 write-once stores (written ${ar.writtenMs} ms, verified ${ar.verifyMs} ms); relay purged ${pg.purged} entries on a signed order`);

  // 10. Rogue insider → audit → TAMPER → the regulator rung drafts CERT-In.
  await call(`${C}/v1/rogue`, 'POST', { cand: 'C0001', q: 1, answer: 'D' });
  await call(`${C}/v1/audit`, 'POST');
  await until(async () => !!(await openOf('TAMPER', 'C0001'))?.certIn, 40_000, 'TAMPER reaching the regulator rung');
  const t = (await openOf('TAMPER', 'C0001'))!;
  const draft = await fetch(`${C}/v1/incidents/certin?id=${t.id}`).then((r) => r.text());
  if (!draft.includes('DRAFT TEMPLATE')) fail('no CERT-In draft');
  step(`TAMPER (P0) for C0001 climbed to the regulator; the CERT-In 6-hour report draft is at ${t.certIn}`);

  // 11. Notices and the public page: approve one; no PII anywhere on it.
  const { drafts } = await call<{ drafts: Notice[] }>(`${C}/v1/notices`);
  if (!drafts.length) fail('no notice drafted');
  await call(`${C}/v1/notices/approve`, 'POST', { id: drafts[0].id, by: 'CONTROL-1' });
  const pub = await call<PublicStatus>(`${C}/v1/status/public`);
  if (!pub.notices.length || /C0\d{3}|INV-42-A|SUP-42|CEN042-S0|CONTROL-1/.test(JSON.stringify(pub))) fail('the public page: no notice, or PII');
  step(`notice ${drafts[0].id} approved and sent to the outbox (mock); the public page shows it, with no PII`);

  // 12. The witness (S6): it cosigned the sealed head. An insider at control rewrites leaf 0 of the log file and re-signs a longer
  // head with the authority key; the witness refuses to cosign it and control raises a P0 TAMPER:log.
  type WitnessView = { cosig?: { size: number; ts: number }; alerts: unknown[] };
  await until(async () => !!(await call<WitnessView>(`${C}/v1/witness`)).cosig, 20_000, 'the witness cosigning the sealed head');
  const cs = (await call<WitnessView>(`${C}/v1/witness`)).cosig!;
  step(`Witness cosigned STH #${cs.size} at ${new Date(cs.ts).toISOString()}`);
  const controlDir = join(dir, 'data', 'control'), recPath = join(controlDir, readdirSync(controlDir).find((f) => /^sth-.*\.json$/.test(f))!);
  const rec = JSON.parse(readFileSync(recPath, 'utf8')) as SthRecord, head = rec.sths.at(-1)!.sth;
  const leaves = [{ ...rec.leaves[0], finalHash: 'f'.repeat(64) }, ...rec.leaves.slice(1, head.size), rec.leaves[0]];
  const sth = { ...head, size: leaves.length, root: toHex(rootOf(leaves.map((l) => hexToBytes(leafHashHex(l))))), prevSTH: sthId(head) };
  writeFileSync(recPath, JSON.stringify({ ...rec, leaves, sths: [...rec.sths, { sth, sig: toHex(signer(authority)(sthMessage(sth))) }] }));
  await until(async () => (await incidents()).some((i) => i.key === 'TAMPER:log' && i.severity === 'P0'), 30_000, 'P0 TAMPER:log');
  const tl = (await incidents()).find((i) => i.key === 'TAMPER:log')!;
  step(`control rewrote the log and re-signed a ${sth.size}-leaf head: P0 TAMPER:log "${tl.title}" (${tl.detail})`);

  console.log(`ACT3-NUMBERS ${JSON.stringify({ ...numbers, host: `${process.platform}-${process.arch}`, candidates: swarm.stats().cands + 1 })}`);
  console.log('PASS');
} finally {
  if (process.env.VIDEO_HOLD) { console.log('HOLD'); await Bun.stdin.text(); }   // tools/record.ts tours the final state, then closes stdin
  for (const s of seats) { try { s.close(); } catch { /* closed already (the force-quit) */ } }
  await swarm?.stop();
  await stack?.stopAll();
  supervisor?.stop(true);                                                               // else its listener keeps this process alive
  rmSync(dir, { recursive: true, force: true });
}
