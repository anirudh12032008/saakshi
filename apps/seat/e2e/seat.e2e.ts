// Plan §9 path on the packaged e2e build (fuses off; camera off): enrol → unlock → answer offline → sync → submit → /verify green.
// Build first: pnpm --filter @saakshi/seat pack:e2e (pack:e2e:win on Windows). Needs local ports (run unsandboxed):
//   node --test --test-timeout=180000 apps/seat/e2e/seat.e2e.ts
// Node, not Bun: Playwright's Electron driver hangs under Bun, so the stack (Bun-only tools) runs as a child: e2e/stack.ts.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { test } from 'node:test';
import { _electron as electron, type ElectronApplication } from 'playwright-core';

const HERE = import.meta.dirname;
const EXE = process.platform === 'win32' ? join(HERE, '../release-e2e/win-unpacked/Saakshi.exe')   // win.executableName comes from the parent config
  : join(HERE, `../release-e2e/mac-${process.arch}/Saakshi-E2E.app/Contents/MacOS/Saakshi-E2E`);

function bunStack() {
  const p = spawn('bun', [join(HERE, 'stack.ts')], { stdio: ['pipe', 'pipe', 'inherit'], shell: process.platform === 'win32' });
  const lines = createInterface({ input: p.stdout! })[Symbol.asyncIterator]();
  const next = async () => { const r = await lines.next(); if (r.done) throw new Error('the e2e stack exited'); return JSON.parse(r.value); };
  const cmd = async (c: string) => { p.stdin!.write(c + '\n'); const r = await next(); if (!r.ok) throw new Error(`${c}: ${r.error}`); return r.value; };
  const stop = () => new Promise<void>((res) => { if (p.exitCode !== null) return res(); p.once('exit', () => res()); p.stdin!.write('stop\n'); });
  return { next, cmd, stop };
}

// When Playwright can't attach, run the exe the way it does and show why it exited (CI has no other window into it).
function launchDiag(args: string[]): Promise<string> {
  return new Promise((res) => {
    const p = spawn(EXE, args, { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1', ELECTRON_ENABLE_STACK_DUMPING: '1' } });
    let out = '';
    p.stdout!.on('data', (d) => { out += d; }); p.stderr!.on('data', (d) => { out += d; });
    const t = setTimeout(() => { p.kill(); res(`launch diag [${args.slice(0, 3).join(' ')}]: still running after 15 s\n${out}`); }, 15_000);
    p.on('exit', (code, sig) => { clearTimeout(t); res(`launch diag [${args.slice(0, 3).join(' ')}]: exit ${code} ${sig ?? ''}\n${out}`); });
    p.on('error', (e) => { clearTimeout(t); res(`launch diag: spawn error ${e.message}`); });
  });
}

test('enrol → unlock → answer offline → sync → submit → /verify green (e2e build, camera off)', async () => {
  const s = bunStack();
  const data = mkdtempSync(join(tmpdir(), 'saakshi-e2e-seat-'));             // a fresh journal every run
  let app: ElectronApplication | undefined;
  try {
    const { relayUrl } = await s.next() as { relayUrl: string };
    const args = [`--user-data-dir=${data}`, '--test-mode', '--no-camera',
      '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--relay', relayUrl, '--cand', 'C0001', '--seat', 'CEN042-S01'];
    try { app = await electron.launch({ executablePath: EXE, args }); }
    catch (e) {
      console.error(await launchDiag(['--inspect=0', '--remote-debugging-port=0', '--enable-logging=stderr', ...args]));
      console.error(await launchDiag(['--enable-logging=stderr', ...args]));
      throw e;
    }
    const w = await app.firstWindow();
    w.setDefaultTimeout(30_000);
    await w.getByLabel('New PIN (6 digits)').fill('482913');
    await w.getByLabel('Type the PIN again').fill('482913');
    await w.getByLabel('Gate operator ID').fill('GATE-42-OP7');
    await w.getByRole('button', { name: 'Check in' }).click();
    await w.getByRole('heading', { name: 'Paper locked until T0' }).waitFor();
    await s.cmd('release');
    await w.getByRole('heading', { name: 'Integrity check' }).waitFor();         // the gate panel on the unlocked screen
    await w.getByRole('button', { name: 'Start exam' }).click();
    await s.cmd('wan-down');                                                     // answer while the centre's WAN is down
    for (const opt of ['B', 'C', 'A']) {
      await w.getByRole('radio', { name: new RegExp(`^${opt}\\b`) }).check();
      await w.getByRole('button', { name: 'Save & Next' }).click();
    }
    await s.cmd('wan-up');
    await w.getByRole('button', { name: 'Submit', exact: true }).click();
    await w.getByRole('button', { name: 'Submit now' }).click();
    await w.getByRole('heading', { name: 'Submission receipt' }).waitFor();
    const code = ((await w.locator('.slip .code').textContent()) ?? '').replace(/\s+/g, '');
    await s.cmd('seal');
    assert.equal(await s.cmd(`verified C0001 ${code}`), true, '/verify with only the authority key');
  } catch (e) {
    const page = app?.windows()[0];
    console.error('seat screen at failure:\n' + (await page?.locator('body').innerText().catch(() => '') ?? ''));
    throw e;
  } finally {
    await app?.close().catch(() => {});
    await s.stop();
    rmSync(data, { recursive: true, force: true });
  }
});
