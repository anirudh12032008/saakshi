// Stage 2 end-to-end (Act 4) on real processes: the real seat session → relay → cell; submit; seal; the rogue insider;
// audit; /verify's logic on the served proof; the evidence pack. Needs local ports (run it unsandboxed).
//   bun tools/act4.ts
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { cellKey, DEV_EXAM, devForm, devPseud, devSeat, trustFromKeys, type KeysFile } from '../packages/core/src/dev.ts';
import { verifier } from '../packages/core/src/node.ts';
import { formsOf, type Finding, type Proof, type ReconRow, type ShiftExport } from '../packages/core/src/sheet.ts';
import { mismatchText, verifyProof } from '../packages/core/src/verify.ts';
import { ExamSession } from '../apps/seat/src/main/exam.ts';
import type { Wrapper } from '../apps/seat/src/main/journal-store.ts';
import { httpSend, SeatSync } from '../apps/seat/src/main/sync.ts';

const root = resolve(import.meta.dir, '..');
const keys = JSON.parse(readFileSync(join(root, 'fixtures/keys.json'), 'utf8')) as KeysFile;
const forms = formsOf(JSON.parse(readFileSync(join(root, 'fixtures/paper/forms.json'), 'utf8')));
const cell = cellKey(keys, 'cell-1');
const dir = mkdtempSync(join(tmpdir(), 'saakshi-act4-'));
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

const [cellPort, relayPort, controlPort] = [freePort(), freePort(), freePort()];
const cellP = await spawnServer({ MODE: 'cell', PORT: String(cellPort), DB: join(dir, 'cell.db') });
const relayP = await spawnServer({ MODE: 'relay', PORT: String(relayPort), HOST: '127.0.0.1', DB: join(dir, 'relay.db'), CELL_URL: `http://127.0.0.1:${cellPort}` });
const controlP = await spawnServer({ MODE: 'control', PORT: String(controlPort), DIR: join(dir, 'control'), CELL_URL: `http://127.0.0.1:${cellPort}`, RELAY_URL: `http://127.0.0.1:${relayPort}` });
const C = `http://127.0.0.1:${controlPort}`;
console.log(`CONTROL ${C}`);   // tools/record.ts attaches its browser here
let exam: ExamSession | undefined;

try {
  // 1. The real seat session: C0002 sits form F2 (reversed order, so Q17 is I04).
  const cand = 'C0002', form = devForm(cand), items = forms[form];
  const wrap: Wrapper = { encryptString: (s) => Buffer.from(s), decryptString: (b) => b.toString() };
  let t = 0;
  exam = new ExamSession({ dir: join(dir, 'seat'), ctx: { ...DEV_EXAM, cand }, keyEpoch: 1, seat: devSeat(keys, cand)!, cellPub: cell.pub, wrap, durationMs: 30 * 60_000, items, form, pseud: devPseud(cand), clock: () => t });
  const sync = new SeatSync(exam, httpSend(`http://127.0.0.1:${relayPort}`), verifier(cell.pub));
  exam.start();
  const q = (n: number) => items[n - 1];
  const act = (kind: 'answer' | 'mark' | 'clear', n: number, state: 'A' | 'NA' | 'MR' | 'AMR', answer: string) => {
    t += 5_000;
    const r = exam!.act({ kind, item: q(n), state, answer, dwellMs: 5_000 });
    if (!r.ok) fail(`act ${kind} Q${n}: ${r.error}`);
  };
  act('clear', 1, 'NA', ''); act('answer', 1, 'A', 'D');                       // visit, then answer
  act('clear', 2, 'NA', ''); act('answer', 2, 'A', 'A'); act('answer', 2, 'A', 'C'); // re-answer: last wins
  act('mark', 3, 'MR', '');
  act('mark', 4, 'AMR', 'B');
  act('answer', 5, 'A', 'B'); act('clear', 5, 'NA', '');                       // answered, then cleared
  act('clear', 17, 'NA', ''); act('answer', 17, 'A', 'B');                     // Q17 = B
  const sub = exam.submit();
  if (!sub.ok) fail(sub.error);
  const slip = sub.receipt;
  console.log(`seat slip: ${slip.code} · attempted ${slip.attempted} · answered ${slip.answered} · marked ${slip.marked} of ${slip.total}`);
  if (slip.attempted !== 6 || slip.answered !== 4 || slip.marked !== 2 || slip.total !== 20) fail('slip counts are wrong');

  // 2. Sync until the cell has acknowledged the submit (blue ✓✓ on the last entry).
  const deadline = Date.now() + 20_000;
  while (sync.view().cell < exam.head()) {
    if (Date.now() > deadline) fail(`the cell never acknowledged the submit: ${JSON.stringify(sync.view())}`);
    await sync.round();
    await Bun.sleep(100);
  }
  const cellSheet = (await call<ShiftExport>(`http://127.0.0.1:${cellPort}/v1/shift?exam=DEMO-2026&shift=S1`)).sheets.find((s) => s.ctx.cand === cand);
  if (cellSheet?.receipt?.code !== slip.code) fail(`seat slip code ${slip.code} ≠ cell countersigned code ${cellSheet?.receipt?.code}`);
  step('seat slip code equals the cell\'s countersigned code');

  // 3. Seal → reconciliation green.
  await call(`${C}/v1/seal`, 'POST');
  const recon = await call<ReconRow>(`${C}/v1/recon`);
  if (!recon.green) fail(`reconciliation is not green: ${JSON.stringify(recon)}`);
  step(`sealed; reconciliation green (${recon.registered} registered · ${recon.submitted} submitted · ${recon.receipts} receipts · ${recon.leaves} leaves)`);

  // 4. The rogue insider; the cell's terminal shows the UPDATE.
  const rogue = await call<{ sql: string }>(`${C}/v1/rogue`, 'POST', { cand, q: 17, answer: 'C' });
  await Bun.sleep(100);
  if (!cellP.out.some((l) => l === `ROGUE ${rogue.sql}`)) fail('the cell did not print the UPDATE');
  step(`rogue insider: ${rogue.sql}`);

  // 5. The audit locates it and recovers the original from the archive.
  const want = 'Q17: record says C — the seat committed B';
  const { findings } = await call<{ findings: Finding[] }>(`${C}/v1/audit`, 'POST');
  if (findings.length !== 1 || findings[0].detail !== want || findings[0].recovered?.value !== 'B') fail(`audit: ${JSON.stringify(findings)}`);
  step(`audit: ${findings[0].detail} (recovered from ${findings[0].recovered?.from})`);

  // 6. /verify's logic on the served proof, with the code typed the way a candidate copies it.
  const proof = await call<Proof>(`${C}/v1/proof?cand=${cand}`);
  const rep = verifyProof(proof, forms, trustFromKeys(keys), slip.code.toLowerCase().replace(/(.{4})/g, '$1-'));
  const failed = rep.checks.filter((c) => !c.ok).map((c) => c.name);
  if (rep.ok || mismatchText(rep.mismatches[0]) !== want || failed.join() !== 'bodies') fail(`verify: ${failed.join()} ${rep.mismatches.map(mismatchText)}`);
  step(`/verify: ${mismatchText(rep.mismatches[0])}; chain, keys, finalHash, receipt, slip, STH and inclusion all pass`);
  const page = await fetch(`${C}/verify`);
  if (!(await page.text()).includes('Saakshi · Verify')) fail('/verify is not served');

  // 7. Reconciliation stays green; the evidence pack exports and its manifest holds.
  if (!(await call<ReconRow>(`${C}/v1/recon`)).green) fail('reconciliation went red after an answer-only edit');
  const ev = await fetch(`${C}/v1/evidence?cand=${cand}`);
  if (!ev.ok) fail(`evidence: ${ev.status}`);
  const files = await new Bun.Archive(new Uint8Array(await ev.arrayBuffer())).files();
  const names = [...files.keys()];
  const prefix = names[0].slice(0, names[0].indexOf('/') + 1);
  const manifest = await files.get(`${prefix}manifest.sha256`)!.text();
  for (const line of manifest.trim().split('\n')) {
    const [h, f] = line.split('  ');
    const got = createHash('sha256').update(new Uint8Array(await files.get(prefix + f)!.arrayBuffer())).digest('hex');
    if (got !== h) fail(`manifest mismatch for ${f}`);
  }
  for (const f of ['proof.json', 'report.html', 'certificate-s63.html', 'verify.html', 'custody.jsonl', 'sth.json', 'audit.json', 'README.txt'])
    if (!names.includes(prefix + f)) fail(`the pack lacks ${f}`);
  step(`evidence pack ${prefix.slice(0, -1)}.tar.gz: ${names.length} files, manifest verifies`);
  console.log('PASS');
} finally {
  if (process.env.VIDEO_HOLD) { console.log('HOLD'); await Bun.stdin.text(); }   // tools/record.ts tours the final state, then closes stdin
  exam?.close();
  for (const p of [controlP, relayP, cellP]) p.proc.kill();
  await Promise.all([controlP, relayP, cellP].map((p) => p.proc.exited));
  rmSync(dir, { recursive: true, force: true });
}
