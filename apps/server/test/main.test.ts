import { expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hexToBytes } from '@saakshi/core/bytes';
import type { KeysFile } from '@saakshi/core/dev';
import { FILES } from '@saakshi/core/directory';
import { newKeyPair, verifier } from '@saakshi/core/node';
import { openPolicy } from '@saakshi/core/policy';
import { buildPackage, writePackage } from '../../../tools/package.ts';
import { provision } from '../../../tools/provision.ts';
import { simBindReq } from '../../../tools/sim-custody.ts';

const MAIN = join(import.meta.dir, '../src/main.ts');

async function ready(stdout: ReadableStream<Uint8Array>): Promise<{ port: number; mode: string; state: string }> {
  const reader = stdout.getReader();
  let buf = '';
  while (!buf.includes('\n')) {
    const { value, done } = await reader.read();
    if (done) throw new Error(`exited before READY: ${buf}`);
    buf += new TextDecoder().decode(value);
  }
  const m = /^READY (.*)$/m.exec(buf);
  if (!m) throw new Error(`no READY line: ${buf}`);
  return JSON.parse(m[1]);
}

test('relay boots with DEV=1, prints READY, serves /console and /v1/heads', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'saakshi-main-'));
  const p = Bun.spawn(['bun', MAIN], { cwd: dir, stdout: 'pipe', stderr: 'pipe', env: { ...process.env, MODE: 'relay', DEV: '1', PORT: '0', HOST: '127.0.0.1', DB: join(dir, 'r.db'), CELL_URL: 'http://127.0.0.1:9' } });
  try {
    const r = await ready(p.stdout);
    expect(r).toMatchObject({ mode: 'relay', state: 'LIVE' });
    const page = await fetch(`http://127.0.0.1:${r.port}/console`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('Seat grid');
    expect(await (await fetch(`http://127.0.0.1:${r.port}/v1/heads`)).json()).toEqual({ mode: 'relay', state: 'LIVE', streams: [] });
  } finally { p.kill(); await p.exited; rmSync(dir, { recursive: true, force: true }); }
});

test('a cell on a fresh DB starts REBUILDING', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'saakshi-main-'));
  const p = Bun.spawn(['bun', MAIN], { cwd: dir, stdout: 'pipe', stderr: 'pipe', env: { ...process.env, MODE: 'cell', DEV: '1', PORT: '0', DB: join(dir, 'c.db') } });
  try { expect((await ready(p.stdout)).state).toBe('REBUILDING'); } finally { p.kill(); await p.exited; rmSync(dir, { recursive: true, force: true }); }
});

test('refuses to start without DEV=1 (no enrolment until Stage 3)', async () => {
  const env: Record<string, string | undefined> = { ...process.env, MODE: 'relay', PORT: '0' };
  delete env.DEV;
  const p = Bun.spawn(['bun', MAIN], { stdout: 'pipe', stderr: 'pipe', env });
  expect(await p.exited).toBe(2);
});

test('control boots with DEV=1, prints READY, serves /control and reports an unreachable cell as 502', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'saakshi-main-'));
  const p = Bun.spawn(['bun', MAIN], { cwd: dir, stdout: 'pipe', stderr: 'pipe', env: { ...process.env, MODE: 'control', DEV: '1', PORT: '0', DIR: join(dir, 'control'), CELL_URL: 'http://127.0.0.1:9', RELAY_URL: 'http://127.0.0.1:9' } });
  try {
    const r = await ready(p.stdout);
    expect(r).toMatchObject({ mode: 'control', state: 'LIVE' });
    expect(await (await fetch(`http://127.0.0.1:${r.port}/control`)).text()).toContain('Rogue insider edits an answer');
    expect((await fetch(`http://127.0.0.1:${r.port}/v1/recon`)).status).toBe(502);
  } finally { p.kill(); await p.exited; rmSync(dir, { recursive: true, force: true }); }
});

test('a cell serves its response sheets at /v1/shift (400 without exam and shift)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'saakshi-main-'));
  const p = Bun.spawn(['bun', MAIN], { cwd: dir, stdout: 'pipe', stderr: 'pipe', env: { ...process.env, MODE: 'cell', DEV: '1', PORT: '0', DB: join(dir, 'c.db') } });
  try {
    const { port } = await ready(p.stdout);
    expect((await fetch(`http://127.0.0.1:${port}/v1/shift`)).status).toBe(400);
    expect(await (await fetch(`http://127.0.0.1:${port}/v1/shift?exam=DEMO-2026&shift=S1`)).json()).toEqual({ cell: 'cell-1', exam: 'DEMO-2026', shift: 'S1', sheets: [] });
  } finally { p.kill(); await p.exited; rmSync(dir, { recursive: true, force: true }); }
});

test('cell and control refuse a non-loopback HOST (their routes are unauthenticated until control↔cell auth)', async () => {
  for (const mode of ['cell', 'control']) {
    const p = Bun.spawn(['bun', MAIN], { stdout: 'pipe', stderr: 'pipe', env: { ...process.env, MODE: mode, DEV: '1', PORT: '0', HOST: '0.0.0.0' } });
    expect(await p.exited).toBe(2);
    expect(await new Response(p.stderr).text()).toContain('must bind loopback');
  }
});

const KEYS = JSON.parse(readFileSync(new URL('../../../fixtures/keys.json', import.meta.url), 'utf8')) as KeysFile;
const paperFx = (f: string) => JSON.parse(readFileSync(new URL(`../../../fixtures/paper/${f}`, import.meta.url), 'utf8'));
async function examDir(dir: string): Promise<string> {
  const out = join(dir, 'exam');
  const d = provision({ out, keys: KEYS, cands: [{ cand: 'C00001', centre: 'CEN001', form: 'F1', pwd: 0 }], cellUrls: ['http://127.0.0.1:9', 'http://127.0.0.1:9', 'http://127.0.0.1:9'] });
  writePackage(out, await buildPackage(d, { bank: paperFx('bank.json'), forms: paperFx('forms.json') }, { priv: hexToBytes(KEYS.authority.priv), pub: hexToBytes(KEYS.authority.pub) }));
  return out;
}
const post = (url: string, body: unknown) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('EXAM: a cell boots with its certified key file, enrols a seat of its centre, and reports per-centre stats', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'saakshi-main-'));
  const p = Bun.spawn(['bun', MAIN], { cwd: dir, stdout: 'pipe', stderr: 'pipe', env: { ...process.env, MODE: 'cell', DEV: '1', PORT: '0', DB: join(dir, 'c.db'), EXAM: await examDir(dir), CELL_ID: 'cell-1' } });
  try {
    const u = `http://127.0.0.1:${(await ready(p.stdout)).port}`;
    await post(`${u}/v1/sync`, { entries: [], streams: [], replay: true, done: true });            // a fresh cell rebuilds until a relay says done
    const r = (await (await post(`${u}/v1/enrol`, { enrols: [simBindReq('C0001', newKeyPair(), hexToBytes(KEYS.cells[0].pub))] })).json()) as { results: { ok: boolean }[] };
    expect(r.results[0].ok).toBe(true);
    const s = (await (await fetch(`${u}/v1/stats`)).json()) as { centres: Record<string, { registered: number; bound: number }> };
    expect(Object.keys(s.centres).sort()).toEqual(['CEN001', 'CEN042']);
    expect(s.centres.CEN042).toMatchObject({ registered: 8, bound: 1 });
  } finally { p.kill(); await p.exited; rmSync(dir, { recursive: true, force: true }); }
});

test('EXAM: a cell refuses to start with a key file the directory does not certify', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'saakshi-main-')), exam = await examDir(dir);
  const f = join(exam, FILES.cellKey('cell-1'));
  writeFileSync(f, JSON.stringify({ ...JSON.parse(readFileSync(f, 'utf8')), pub: KEYS.cells[1].pub }));
  const p = Bun.spawn(['bun', MAIN], { cwd: dir, stdout: 'pipe', stderr: 'pipe', env: { ...process.env, MODE: 'cell', DEV: '1', PORT: '0', DB: join(dir, 'c.db'), EXAM: exam } });
  try {
    expect(await p.exited).not.toBe(0);
    expect(await new Response(p.stderr).text()).toContain('is not the key the directory certifies');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('EXAM: a relay serves its centre\'s signed package, and with no reachable cell answers enrolment as provisional', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'saakshi-main-'));
  const p = Bun.spawn(['bun', MAIN], { cwd: dir, stdout: 'pipe', stderr: 'pipe', env: { ...process.env, MODE: 'relay', DEV: '1', PORT: '0', HOST: '127.0.0.1', DB: join(dir, 'r.db'), EXAM: await examDir(dir), CENTRE: 'CEN042' } });
  try {
    const u = `http://127.0.0.1:${(await ready(p.stdout)).port}`;
    const pkg = (await (await fetch(`${u}/v1/package`)).json()) as { policy: { text: string; sig: string } };
    expect(openPolicy(pkg.policy, verifier(hexToBytes(KEYS.authority.pub)), { exam: 'DEMO-2026', shift: 'S1' }).centre).toBe('CEN042');
    const r = await post(`${u}/v1/enrol`, simBindReq('C0001', newKeyPair(), hexToBytes(KEYS.cells[0].pub)));
    expect([r.status, ((await r.json()) as { provisional: boolean }).provisional]).toEqual([202, true]);
    expect(await (await fetch(`${u}/release/current`)).json()).toEqual({ releases: [] });
  } finally { p.kill(); await p.exited; rmSync(dir, { recursive: true, force: true }); }
});

test('EXAM: control serves /custodian, its release key, the public manifest and the fleet view (cells down)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'saakshi-main-')), exam = await examDir(dir);
  const p = Bun.spawn(['bun', MAIN], { cwd: dir, stdout: 'pipe', stderr: 'pipe', env: { ...process.env, MODE: 'control', DEV: '1', PORT: '0', DIR: join(dir, 'control'), EXAM: exam, RELAY_URL: 'http://127.0.0.1:9' } });
  try {
    const u = `http://127.0.0.1:${(await ready(p.stdout)).port}`;
    expect(await (await fetch(`${u}/custodian`)).text()).toContain('Custodian — release the paper');
    expect(((await (await fetch(`${u}/v1/release/key`)).json()) as { keyId: string }).keyId).toMatch(/^[0-9a-f]{16}$/);
    expect(await (await fetch(`${u}/v1/manifest`)).json()).toEqual(JSON.parse(readFileSync(join(exam, FILES.manifest), 'utf8')));
    await Bun.sleep(2500);
    expect(((await (await fetch(`${u}/v1/fleet`)).json()) as { cells: { state: string }[] }).cells.map((c) => c.state)).toEqual(['DOWN', 'DOWN', 'DOWN']);
  } finally { p.kill(); await p.exited; rmSync(dir, { recursive: true, force: true }); }
});
