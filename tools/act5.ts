// Stage 6 end to end (Act 5) on real processes: a G1 twin (2k, or 20k with --full) and G1's 100-item paper → provision (DEMO ops)
// → package → 3 cells + the Centre 42 relay + control (templates) + the swarm, replaying every candidate on G1's own clock →
// release → every simulated candidate submits → the cells' export equals the replayed cohort on every radar field → run the
// pipeline on it: the headline equals the pinned golden, every planted leak centre is flagged, no honest candidate is → history
// (REGISTRY) only annotates → the T−1 scorecard puts CEN042 at "add observer" → an invigilator's power report is classified and
// linked to the open outage → the outage notice is redrafted, approved, and shown in EN/HI/TA → the decision is signed off and
// the signature checks with the decision key. Needs local ports and uv (run it unsandboxed).
//   bun tools/act5.ts [--full]
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decisionArray, type AnalyticsRun, type Classification, type InvReport, type RadarFlag, type ScoreRow, type SignedDecision } from '../packages/core/src/analytics.ts';
import { hexToBytes } from '../packages/core/src/bytes.ts';
import { DEV_EXAM, type KeysFile } from '../packages/core/src/dev.ts';
import { FILES, type FleetView, type ReleaseStatus } from '../packages/core/src/directory.ts';
import { msg } from '../packages/core/src/enrol.ts';
import { verifier } from '../packages/core/src/node.ts';
import { OPS_DEMO, type Incident, type Notice, type PublicStatus } from '../packages/core/src/ops.ts';
import { formsOf, type ShiftExport } from '../packages/core/src/sheet.ts';
import { cohortRows } from '../apps/server/src/cohort-export.ts';
import { shareRequest, type ReleaseKey } from '../apps/server/src/custodian-view.ts';
import { readCohort } from './cohort.ts';
import { buildPackage, writePackage, zeroise } from './package.ts';
import { call, freePort, ROOT, until } from './procs.ts';
import { cohortCands, provision } from './provision.ts';
import { demoSpecs, Stack } from './stack.ts';
import { swarmCohort } from './swarm.ts';

const full = process.argv.includes('--full');
const readJson = (p: string) => JSON.parse(readFileSync(p, 'utf8'));
const keys = readJson(join(ROOT, 'fixtures/keys.json')) as KeysFile;
const authority = { priv: hexToBytes(keys.authority.priv), pub: hexToBytes(keys.authority.pub) };
const dir = mkdtempSync(join(tmpdir(), 'saakshi-act5-'));
const fail = (m: string): never => { throw new Error(m); };
const step = (m: string) => console.log(`✓ ${m}`);
const uv = (args: string[]) => {
  const g = Bun.spawnSync(['uv', 'run', '--directory', join(ROOT, 'analytics'), ...args], { stdout: 'inherit', stderr: 'inherit' });
  if (g.exitCode !== 0) fail(`uv ${args.join(' ')} failed`);
};
const RADAR = ['cand', 'centre', 'shift', 'form', 'lang', 'pwd', 'item', 'state', 'answer', 'dwellMs', 'tFirstMs'] as const;
const flagKey = (f: RadarFlag) => JSON.stringify([f.cand, f.centre, f.shift, f.level, f.signals]);
const t0 = Date.now();

let stack: Stack | undefined, supervisor: ReturnType<Stack['serve']> | undefined;
try {
  // 1. The G1 twin and G1's 100-item paper.
  const g1 = join(dir, 'g1'), paper = join(dir, 'paper');
  uv(['python', '-m', 'saakshi_analytics.generate', g1, ...(full ? [] : ['--n', '2000', '--centres', '10']), '--seed', '7']);
  const gp = Bun.spawnSync(['bun', join(ROOT, 'tools/gen-paper-g1.ts'), '--key', join(g1, 'key.json'), '--out', paper], { stdout: 'inherit', stderr: 'inherit' });
  if (gp.exitCode !== 0) fail('gen-paper-g1 failed');
  const cohort = join(g1, 'cohort.jsonl'), truth = readJson(join(g1, 'truth.json'));
  const forms = formsOf(readJson(join(paper, 'forms.json')));
  step(`G1 twin (${full ? '20k' : '2k'}, seed 7) and its 100-item paper`);

  // 2. Provision (DEMO ops), package with the G1 paper, start the stack with the swarm; the custodians release.
  const ports = { cells: [freePort(), freePort(), freePort()], relay: freePort(), control: freePort(), witness: freePort(), stack: freePort() };
  const C = `http://127.0.0.1:${ports.control}`;
  const exam = join(dir, 'exam'), data = join(dir, 'data');
  const X = provision({ out: exam, keys, cands: await cohortCands(cohort), cellUrls: ports.cells.map((p) => `http://127.0.0.1:${p}`), ops: OPS_DEMO });
  const pkg = await buildPackage(X, { bank: readJson(join(paper, 'bank.json')), forms: readJson(join(paper, 'forms.json')) }, authority);
  writePackage(exam, pkg);
  const custodians = { NTA: { file: pkg.shares.NTA, pass: pkg.passphrases.NTA }, NIC: { file: pkg.shares.NIC, pass: pkg.passphrases.NIC } };
  zeroise(pkg);
  const specs = demoSpecs({ exam, data, cohort, paper, speed: full ? 2000 : 1000, stackUrl: `http://127.0.0.1:${ports.stack}`, cellPorts: ports.cells, relayPort: ports.relay, controlPort: ports.control, witnessPort: ports.witness });
  specs.find((s) => s.name === 'relay')!.env.HOST = '127.0.0.1';
  const control = specs.find((s) => s.name === 'control')!;
  control.env.SAAKSHI_LLM = 'template';
  mkdirSync(data, { recursive: true });
  let swarmStats = { cands: 0, done: 0, sent: 0, rejected: 0, enrolFailed: 0 };
  stack = new Stack(specs, { cwd: dir, log: (n, l) => { if (n === 'swarm' && l.startsWith('SWARM ')) swarmStats = JSON.parse(l.slice(6)); } });
  for (const s of specs) await stack.start(s.name);
  supervisor = stack.serve(ports.stack);
  if (!swarmStats.cands || swarmStats.enrolFailed) fail(`swarm enrolment: ${JSON.stringify(swarmStats)}`);
  const key = await call<ReleaseKey>(`${C}/v1/release/key`);
  for (const c of ['NTA', 'NIC'] as const) await call(`${C}/v1/release/share`, 'POST', shareRequest(custodians[c].file, custodians[c].pass, key));
  await until(async () => (await call<ReleaseStatus>(`${C}/v1/release/status`)).zeroised, 60_000, 'the release reaching every cell');
  step(`stack up (3 cells, ${X.demoCentre}'s relay, control on templates, the swarm: ${swarmStats.cands} candidates); released by NTA + NIC`);

  // 3. Every simulated candidate submits.
  const tSwarm = Date.now();
  await until(() => swarmStats.done >= swarmStats.cands, full ? 3_600_000 : 900_000, 'every simulated candidate submitting', 500);
  if (swarmStats.rejected) fail(`the cells rejected ${swarmStats.rejected} entries`);
  const stored = async () => (await call<FleetView>(`${C}/v1/fleet`)).cells.reduce((n, c) => n + c.entries, 0);
  await until(async () => (await stored()) >= swarmStats.sent, full ? 1_800_000 : 600_000, 'every entry reaching the cells', 1_000);   // done = journaled at the relay
  step(`${swarmStats.done} candidates submitted on G1's clock (${swarmStats.sent} entries, ${Math.round((Date.now() - tSwarm) / 1000)} s)`);

  // 4. Review Focus #5: the export rows equal the replayed cohort's rows on every radar field.
  const exports = await Promise.all(X.cells.map((c) => call<ShiftExport>(`${c.url}/v1/shift?exam=${X.exam}&shift=${X.shift}`)));
  const want = await swarmCohort(readCohort(cohort), X, forms);
  const pick = (r: Record<string, unknown>) => JSON.stringify(RADAR.map((k) => r[k]));
  const byKey = (rs: Record<string, unknown>[]) => new Map(rs.map((r) => [`${r.cand}|${r.item}`, pick(r)]));
  const got = byKey(cohortRows(exports, X, forms) as unknown as Record<string, unknown>[]), exp = byKey(want as unknown as Record<string, unknown>[]);
  if (got.size !== exp.size) fail(`export rows ${got.size} ≠ swarmCohort rows ${exp.size}`);
  for (const [k, v] of exp) if (got.get(k) !== v) fail(`row ${k}: export ${got.get(k)} ≠ cohort ${v}`);
  step(`export rows equal swarmCohort rows on radar fields: ${got.size} rows, every one equal`);

  // 5. The pipeline on the cells' export: the pinned headline, every planted leak centre flagged, no honest candidate flagged.
  const tRun = Date.now();
  const run = await call<AnalyticsRun>(`${C}/v1/analytics/run`, 'POST', readJson(join(ROOT, 'analytics/golden', full ? 'act5.incident.json' : 'act5-small.incident.json')));
  const runSeconds = (Date.now() - tRun) / 1000;
  const pinned = new RegExp(`^${full ? 'FULL' : 'SMALL'}_HEADLINE = "(.*)"$`, 'm').exec(readFileSync(join(ROOT, 'analytics/tests/test_act5.py'), 'utf8'))?.[1] ?? fail('no pinned headline');
  if (run.headline !== pinned) fail(`headline "${run.headline}" ≠ pinned "${pinned}"`);
  const leakFlagged = new Set(run.flags.filter((f) => f.signals.some((s) => s.signal === 'speed-accuracy' || s.signal === 'cusum')).map((f) => f.centre));
  const leakCentres = [...new Set<string>([...truth.leak.centres, truth.midLeak.centre])].filter((c) => c !== X.demoCentre);
  const missed = leakCentres.filter((c) => !leakFlagged.has(c));
  if (missed.length) fail(`planted leak centres not flagged: ${missed.join(', ')}`);
  const planted = new Set<string>([...truth.leak.cands, ...truth.midLeak.cands, ...truth.rings.flatMap((r: { members: string[] }) => r.members)]);
  const honest = run.flags.filter((f) => !planted.has(f.cand));
  if (honest.length) fail(`honest candidates flagged: ${honest.map((f) => f.cand).join(', ')}`);
  step(`"${run.headline}" (= pinned); ${run.flags.length} flags; leak centres ${leakCentres.join(', ')} flagged; no honest candidate flagged (${runSeconds.toFixed(1)} s)`);

  // 6. History only annotates: rerun with the registry; the flag set is unchanged and at least one flag is corroborated.
  await stack.kill('control');
  control.env.REGISTRY = join(g1, 'registry.json');
  await stack.start('control');
  const run2 = await call<AnalyticsRun>(`${C}/v1/analytics/run`, 'POST', readJson(join(ROOT, 'analytics/golden', full ? 'act5.incident.json' : 'act5-small.incident.json')));
  if (JSON.stringify(run2.flags.map(flagKey)) !== JSON.stringify(run.flags.map(flagKey))) fail('the registry changed the flag set');
  if (run2.headline !== run.headline) fail('the registry changed the headline');
  if (!(run2.history.corroborated >= 1)) fail(`history: ${JSON.stringify(run2.history)}`);
  step(`history: ${run2.history.annotated} flags annotated, ${run2.history.corroborated} corroborated; the flag set and the headline unchanged`);

  // 7. The T−1 scorecard.
  const sc = await call<{ rows: ScoreRow[] }>(`${C}/v1/scorecard`);
  const c42 = sc.rows.find((r) => r.centre === 'CEN042');
  if (c42?.decision !== 'add observer') fail(`CEN042: ${JSON.stringify(c42)}`);
  step(`scorecard: ${sc.rows.length} centres; CEN042 → add observer (risk ${c42!.risk.toFixed(2)})`);

  // 8. The invigilator's report, linked to the open outage at the demo centre.
  const openOf = async (kind: Incident['kind']) => (await call<{ incidents: Incident[] }>(`${C}/v1/incidents`)).incidents.find((i) => i.kind === kind && !i.resolvedAt);
  await call(`${C}/v1/chaos/degrade`, 'POST', { on: true });
  await call(`${C}/v1/chaos/wan`, 'POST', { up: false });
  await until(async () => !!(await openOf('RELAY_WAN_DOWN')), 60_000, 'RELAY_WAN_DOWN at the demo centre');
  const outage = (await openOf('RELAY_WAN_DOWN'))!;
  const rep = await call<{ report: InvReport; cls: Classification }>(`${C}/v1/reports`, 'POST', { centre: X.demoCentre, by: 'inv-7', text: 'lab 2 power gone, 14 seats' });
  if (rep.cls.kind !== 'CENTRE_OUTAGE' || rep.cls.seats !== 14 || rep.cls.linked !== outage.id) fail(`classification: ${JSON.stringify(rep.cls)}`);
  step(`report ${rep.report.id}: CENTRE_OUTAGE, 14 seats, linked to ${outage.id} (${outage.kind}); nothing acked or resolved by it`);

  // 9. The outage notice: redraft, approve; the public page shows it in EN/HI/TA.
  await until(async () => (await call<{ drafts: Notice[] }>(`${C}/v1/notices`)).drafts.some((d) => d.kind === 'RELAY_WAN_DOWN'), 30_000, 'the outage notice draft');
  const draft = (await call<{ drafts: Notice[] }>(`${C}/v1/notices`)).drafts.find((d) => d.kind === 'RELAY_WAN_DOWN')!;
  const red = await call<Notice>(`${C}/v1/notices/redraft`, 'POST', { id: draft.id });
  await call(`${C}/v1/notices/approve`, 'POST', { id: red.id, by: 'CONTROL-1' });
  const pub = await call<PublicStatus>(`${C}/v1/status/public`);
  const shown = pub.notices.find((n) => n.en === red.en);
  if (!shown?.en || !shown.hi || !/[஀-௿]/.test(shown.ta ?? '')) fail(`public notice: ${JSON.stringify(shown)}`);
  const page = await fetch(`${C}/status?lang=ta`).then((r) => r.text());
  if (!page.includes('id="ta"')) fail('the status page has no Tamil toggle');
  await call(`${C}/v1/chaos/wan`, 'POST', { up: true });
  await call(`${C}/v1/chaos/degrade`, 'POST', { on: false });
  step(`notice ${red.id} redrafted, approved; the public page shows it in EN, HI and TA (Tamil script); the TA toggle is on /status`);

  // 10. The human sign-off, checked with the decision key's public half and the exact report bytes.
  const so = await call<SignedDecision>(`${C}/v1/analytics/signoff`, 'POST', { by: 'Act 5 script' });
  const pubKey = hexToBytes((readJson(join(exam, FILES.decisionKey)) as { pub: string }).pub);
  const { sig, ...d } = so;
  if (!verifier(pubKey)(msg(decisionArray(d)), hexToBytes(sig))) fail('the sign-off signature does not verify');
  const reportHash = createHash('sha256').update(readFileSync(join(data, 'control', 'analytics-run', 'run.json'))).digest('hex');
  if (so.reportHash !== reportHash || so.exam !== DEV_EXAM.exam) fail(`sign-off: ${JSON.stringify(so)} vs ${reportHash}`);
  step(`signed off by "${so.by}" over report ${so.reportHash.slice(0, 12)}…; the signature verifies with the decision key`);

  console.log(`ACT5-NUMBERS ${JSON.stringify({ twin: full ? '20k' : '2k', headline: run.headline, flags: run.flags.length, annotated: run2.history.annotated,
    corroborated: run2.history.corroborated, rows: got.size, runSeconds, totalSeconds: Math.round((Date.now() - t0) / 1000), host: `${process.platform}-${process.arch}` })}`);
  console.log('PASS');
} finally {
  await stack?.stopAll();
  supervisor?.stop(true);
  rmSync(dir, { recursive: true, force: true });
}
