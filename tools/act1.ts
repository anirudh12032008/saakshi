// Stage 5 end to end (Act 1) on real processes, seats in-process with injected probe snapshots (CI has no AnyDesk and no camera):
// provision (DEMO ops, integrity probeMs 2 s, the scribe seat) → 3 cells + the Centre 42 relay + control → seats A, B (scribe, NVDA), C enrol
// → the readiness board: Centre 42 AMBER (seat C on battery) → seat A runs AnyDesk + overlay-sim → BLOCKED naming both; start() refused
// with the names → closed → re-check → green → release → all start → during the exam AnyDesk returns: one integrity entry (not one per
// probe), INTEGRITY_CRITICAL names AnyDesk, seat A keeps answering → seat B: NVDA allowed, 2 faces nothing, 3 faces one face-extra flag →
// the review queue shows it with its thumbnail → a reviewer clears it → answers carry provenance → submit → seal → /verify green.
// Needs local ports (run it unsandboxed). The camera is never touched.
//   bun tools/act1.ts [--cohort path/to/cohort.jsonl]
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hexToBytes } from '../packages/core/src/bytes.ts';
import { DEV_EXAM, type KeysFile } from '../packages/core/src/dev.ts';
import type { ReleaseStatus } from '../packages/core/src/directory.ts';
import type { SignedFace } from '../packages/core/src/integrity.ts';
import { OPS_DEMO, type CellEvent, type Incident } from '../packages/core/src/ops.ts';
import { formsOf, type Proof } from '../packages/core/src/sheet.ts';
import { verifyProof } from '../packages/core/src/verify.ts';
import { shareRequest, type ReleaseKey } from '../apps/server/src/custodian-view.ts';
import { seatLine, type ReadinessBoard } from '../apps/server/src/readiness-view.ts';
import type { ReviewItem } from '../apps/server/src/review.ts';
import type { ProbeSnapshot } from '../apps/seat/src/main/integrity.ts';
import type { Wrapper } from '../apps/seat/src/main/journal-store.ts';
import { Seat } from '../apps/seat/src/main/seat.ts';
import { buildPackage, writePackage, zeroise } from './package.ts';
import { call, freePort, ROOT, until } from './procs.ts';
import { cohortCands, provision } from './provision.ts';
import { demoSpecs, Stack } from './stack.ts';

const arg = (f: string) => { const i = process.argv.indexOf(f); return i > 0 ? process.argv[i + 1] : undefined; };
const read = (f: string) => JSON.parse(readFileSync(join(ROOT, f), 'utf8'));
const keys = read('fixtures/keys.json') as KeysFile;
const forms = formsOf(read('fixtures/paper/forms.json'));
const authority = { priv: hexToBytes(keys.authority.priv), pub: hexToBytes(keys.authority.pub) };
const onlyAuthority = { authority: keys.authority.pub, cells: {}, seats: {} };
const dir = mkdtempSync(join(tmpdir(), 'saakshi-act1-'));
const fail: (m: string) => never = (m) => { throw new Error(m); };
const step = (m: string) => console.log(`✓ ${m}`);
const wrap: Wrapper = { encryptString: (s) => Buffer.from(s), decryptString: (b) => b.toString() };
const PIN = '482913', PROBE_MS = 2_000;
const JPEG_1x1 = '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';

const ok = <T>(value: T) => ({ status: 'ok' as const, value });
const clean = (x: Partial<ProbeSnapshot> = {}): ProbeSnapshot => ({
  platform: 'win32', at: Date.now(), procs: ok([{ pid: 1, name: 'C:\\Windows\\explorer.exe' }]), captureExcluded: ok([]), remoteSession: ok(false),
  vm: ok({ hv: false, model: 'Latitude 5420', bios: 'Dell Inc.', macs: ['a4:83:e7:00:00:01'] }), egress: ok([]),
  displays: 1, camera: 'on', onBattery: false, freeBytes: 50e9, skewMs: 200, ...x });
const withAnyDesk = (overlay: boolean) => clean({ procs: ok([{ pid: 1, name: 'C:\\Windows\\explorer.exe' }, { pid: 4242, name: 'C:\\t\\AnyDesk.exe' },
  ...(overlay ? [{ pid: 77, name: 'C:\\s\\overlay-sim.exe' }] : [])]), captureExcluded: ok(overlay ? [77] : []) });
const snaps: Record<string, ProbeSnapshot> = {};

const ports = { cells: [freePort(), freePort(), freePort()], relay: freePort(), control: freePort(), stack: freePort() };
const R = `http://127.0.0.1:${ports.relay}`, C = `http://127.0.0.1:${ports.control}`;
const exam = join(dir, 'exam');
let stack: Stack | undefined, supervisor: ReturnType<Stack['serve']> | undefined;
const seats: Seat[] = [];
const newSeat = (cand: string, seatId: string) => {
  snaps[cand] ??= clean();
  mkdirSync(join(dir, 'seats', cand), { recursive: true });
  const s = new Seat({ dir: join(dir, 'seats', cand), relayUrl: R, ctx: { ...DEV_EXAM, cand }, seatId, authorityPub: authority.pub, wrap,
    camera: false, testMode: false, retryMs: 500, integrity: { collect: async () => ({ ...snaps[cand], at: Date.now() }) } });
  seats.push(s);
  return s;
};
const board = () => call<ReadinessBoard>(`${C}/v1/readiness`);
const incidents = async () => (await call<{ incidents: Incident[] }>(`${C}/v1/incidents`)).incidents;

try {
  // 1. Provision (DEMO ops, probe every 2 s; the scribe seat is the demo centre's second candidate), package, the stack.
  const cands = arg('--cohort') ? await cohortCands(arg('--cohort')!) : [];
  const X = provision({ out: exam, keys, cands, cellUrls: ports.cells.map((p) => `http://127.0.0.1:${p}`), ops: OPS_DEMO, integrity: { probeMs: PROBE_MS } });
  const pkg = await buildPackage(X, { bank: read('fixtures/paper/bank.json'), forms: read('fixtures/paper/forms.json') }, authority);
  writePackage(exam, pkg);
  const custodians = { NTA: { file: pkg.shares.NTA, pass: pkg.passphrases.NTA }, NIC: { file: pkg.shares.NIC, pass: pkg.passphrases.NIC } };
  zeroise(pkg);
  const demoRoster = Object.entries(X.cands).filter(([, c]) => c.centre === X.demoCentre).map(([c]) => c).sort();
  const [candA, candB, candC] = demoRoster;
  const cellUrl = X.cells.find((c) => c.id === X.centres[X.demoCentre].cell)!.url;
  const specs = demoSpecs({ exam, data: join(dir, 'data'), stackUrl: `http://127.0.0.1:${ports.stack}`, cellPorts: ports.cells, relayPort: ports.relay, controlPort: ports.control });
  specs.find((s) => s.name === 'relay')!.env.HOST = '127.0.0.1';
  mkdirSync(join(dir, 'data'), { recursive: true });
  stack = new Stack(specs, { cwd: dir, log: () => {} });
  for (const s of specs) await stack.start(s.name);
  supervisor = stack.serve(ports.stack);
  step(`stack up: 3 cells, ${X.demoCentre}'s relay, control (DEMO timers, probe every ${PROBE_MS / 1000} s)`);

  // 2. Three seats enrol; seat B is the scribe seat running NVDA; seat C is on battery → the board shows the centre AMBER.
  snaps[candB] = clean({ procs: ok([{ pid: 1, name: 'C:\\Windows\\explorer.exe' }, { pid: 555, name: 'C:\\Program Files\\NVDA\\nvda.exe' }]) });
  snaps[candC] = clean({ onBattery: true });
  const seatA = newSeat(candA, 'CEN042-S01'), seatB = newSeat(candB, 'CEN042-S02'), seatC = newSeat(candC, 'CEN042-S03');
  for (const s of [seatA, seatB, seatC]) {
    await s.open();
    await until(() => s.boot().phase === 'enrol', 15_000, `${s.boot().cand} loading its package`);
    await s.enrol({ pin: PIN, operatorId: 'GATE-42-OP7', method: 'aadhaar-face' });
    await until(() => s.boot().bind === 'bound', 20_000, `${s.boot().cand} enrolment`);
  }
  await until(async () => (await board()).centres[0]?.seats.length === 3, 30_000, 'three readiness reports on the board', 500);
  const b1 = (await board()).centres[0];
  if (b1.verdict !== 'amber') fail(`the board: ${JSON.stringify(b1)}`);
  step(`readiness board: ${b1.centre} AMBER (${b1.seats.map(seatLine).join(' | ')})`);

  // 3. Seat A runs AnyDesk and overlay-sim (capture-excluded): BLOCKED naming both; the board says so; after the release start() refuses.
  snaps[candA] = withAnyDesk(true);
  const vA = await seatA.recheck();
  const namesA = [...new Set(vA.findings.filter((f) => f.level === 'block').flatMap((f) => f.names))].sort();
  if (vA.verdict !== 'block' || namesA.join() !== 'AnyDesk,overlay-sim') fail(`seat A: ${JSON.stringify(vA)}`);
  await until(async () => (await board()).centres[0].verdict === 'block', 15_000, 'the board showing the block', 500);
  const lineA = (await board()).centres[0].seats.map(seatLine).find((l) => l.startsWith(candA))!;
  if (!lineA.includes('AnyDesk, overlay-sim')) fail(`board line: ${lineA}`);
  step(`seat A BLOCKED by name: ${lineA}`);
  const key = await call<ReleaseKey>(`${C}/v1/release/key`);
  for (const c of ['NTA', 'NIC'] as const) await call(`${C}/v1/release/share`, 'POST', shareRequest(custodians[c].file, custodians[c].pass, key));
  await until(async () => (await call<ReleaseStatus>(`${C}/v1/release/status`)).zeroised, 30_000, 'the release reaching every cell');
  for (const s of [seatA, seatB, seatC]) await until(() => s.boot().phase === 'ready', 30_000, `${s.boot().cand} unlocking`);
  const refused = seatA.start();
  if (refused.ok || !refused.error.includes('AnyDesk') || !refused.error.includes('overlay-sim')) fail(`start() while blocked: ${JSON.stringify(refused)}`);
  step(`released by NTA + NIC; seat A's start() refused: "${refused.error}"`);

  // 4. The tools are closed → re-check → green → every seat starts.
  snaps[candA] = clean();
  const vA2 = await seatA.recheck();
  if (vA2.verdict !== 'green') fail(`seat A after closing: ${JSON.stringify(vA2)}`);
  for (const s of [seatA, seatB, seatC]) { const r = s.start(); if (!r.ok) fail(`${s.boot().cand} start: ${r.error}`); }
  step('seat A closed both tools → re-check → green; all three seats started');

  // 5. Seat B: NVDA allowed (info); 2 faces is expected; 3 faces in 3 of 5 samples → one face-extra flag → review queue → cleared.
  const vB = await seatB.recheck();
  const nvda = vB.findings.find((f) => f.code === 'assistive');
  if (vB.verdict === 'block' || nvda?.level !== 'info' || !nvda.names.includes('NVDA') || seatB.boot().faces !== 2) fail(`seat B: ${JSON.stringify(vB)}`);
  let t = Date.now();
  for (let i = 0; i < 20; i++) seatB.faceSample({ faces: 2, at: (t += 500) });
  await Bun.sleep(1_000);
  if ((await call<{ flags: SignedFace[] }>(`${R}/v1/faces`)).flags.length) fail('2 faces at the scribe seat raised a flag');
  for (let i = 0; i < 5; i++) seatB.faceSample({ faces: 3, at: (t += 500), thumb: JPEG_1x1 });
  await until(async () => (await call<{ flags: SignedFace[] }>(`${R}/v1/faces`)).flags.length > 0, 15_000, 'the face flag at the relay', 500);
  await Bun.sleep(1_000);
  const flags = (await call<{ flags: SignedFace[] }>(`${R}/v1/faces`)).flags;
  if (flags.length !== 1 || flags[0].f.code !== 'face-extra') fail(`relay faces: ${JSON.stringify(flags.map((f) => f.f.code))}`);
  await until(async () => (await call<{ items: ReviewItem[] }>(`${C}/v1/review`)).items.length > 0, 15_000, 'the review queue', 500);
  const items = (await call<{ items: ReviewItem[] }>(`${C}/v1/review`)).items;
  const it = items[0];
  if (items.length !== 1 || it.code !== 'face-extra' || it.expected !== 2 || !it.thumb.startsWith('data:image/jpeg;base64,')) fail(`review: ${JSON.stringify(items.map((i) => ({ ...i, thumb: i.thumb.slice(0, 30) })))}`);
  const decided = await call<ReviewItem>(`${C}/v1/review/decide`, 'POST', { id: it.id, decision: 'cleared', by: 'REVIEWER-1' });
  if (decided.decision !== 'cleared') fail(`decide: ${JSON.stringify(decided)}`);
  step(`seat B (scribe): NVDA allowed (info); 20 × 2 faces → nothing; 5 × 3 faces → 1 face-extra flag, ${it.faces} faces / ${it.expected} expected, thumbnail opened with the review key → cleared by REVIEWER-1`);

  // 6. During the exam AnyDesk comes back: journaled once (not once per probe), INTEGRITY_CRITICAL names it; seat A keeps answering.
  const items0 = seatA.paper()!.items;
  snaps[candA] = withAnyDesk(false);
  const t0 = Date.now();
  await Bun.sleep(PROBE_MS * 3 + 1_000);
  const probes = Math.floor((Date.now() - t0) / PROBE_MS);
  const integrityOf = async () => (await call<{ events: CellEvent[] }>(`${cellUrl}/v1/events?after=0`)).events.filter((e) => e.code === 'INTEGRITY' && e.cand === candA);
  await until(async () => (await integrityOf()).length > 0, 20_000, 'the INTEGRITY event at the cell', 500);
  const evs = await integrityOf();
  const names = (e: CellEvent) => String(e.data?.names ?? JSON.parse(e.reason || '{}').names ?? '');
  if (evs.length !== 1 || names(evs[0]) !== 'AnyDesk') fail(`INTEGRITY events for ${candA}: ${JSON.stringify(evs)}`);
  await until(async () => (await incidents()).some((i) => i.kind === 'INTEGRITY_CRITICAL' && !i.resolvedAt && i.title.includes('AnyDesk')), 20_000, 'INTEGRITY_CRITICAL', 500);
  const ic = (await incidents()).find((i) => i.kind === 'INTEGRITY_CRITICAL' && i.title.includes('AnyDesk'))!;
  const still = seatA.act({ kind: 'answer', item: items0[0].id, state: 'A', answer: 'A', dwellMs: 1_000 });
  if (!still.ok || seatA.boot().phase !== 'exam') fail(`seat A was stopped: ${JSON.stringify(still)}`);
  step(`in-exam: AnyDesk for ${probes} probes → 1 integrity entry; ${ic.severity} INTEGRITY_CRITICAL "${ic.title}"; seat A keeps answering`);

  // 7. Answers with provenance → submit → seal → /verify with only the authority key.
  snaps[candA] = clean();
  for (let i = 1; i <= 5; i++) {
    const r = seatA.act({ kind: 'answer', item: items0[i % items0.length].id, state: 'A', answer: 'B', dwellMs: 2_000, prov: { moves: 40 + i, pathPx: 900, clicks: 2, keys: 0, untrusted: 0, lastMoveMs: 120 } });
    if (!r.ok) fail(`answer: ${r.error}`);
  }
  const rc = seatA.submit();
  if (!rc.ok) fail(rc.error);
  await until(() => seatA.boot().sync.cell >= seatA.exam!.head(), 60_000, 'the submit at the cell');
  await call(`${C}/v1/seal`, 'POST');
  const proof = await call<Proof>(`${C}/v1/proof?cand=${candA}`);
  const v = verifyProof(proof, forms, onlyAuthority, rc.receipt.code);
  if (!v.ok) fail(`/verify: ${JSON.stringify(v.checks.filter((c) => !c.ok))}`);
  if (!JSON.stringify(proof).includes('"prov"')) fail('the answers carry no provenance');
  step(`answers carry provenance; submitted, sealed; /verify green with only the authority key; receipt ${rc.receipt.code}`);

  console.log(`Act 1: blocked by name (AnyDesk, overlay-sim) → green; ${X.demoCentre} amber; 1 integrity entry for ${probes} probes; INTEGRITY_CRITICAL; face-extra → review → cleared; submitted and verified`);
  console.log('PASS');
} finally {
  for (const s of seats) { try { s.close(); } catch { /* closed already */ } }
  await stack?.stopAll();
  supervisor?.stop(true);
  rmSync(dir, { recursive: true, force: true });
}
