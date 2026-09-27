import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
