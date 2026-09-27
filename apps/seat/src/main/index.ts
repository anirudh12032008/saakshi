import { app, BrowserWindow, dialog, ipcMain, protocol, safeStorage, session, systemPreferences } from 'electron';
import { readFile, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { cellKey, DEV_EXAM, devForm, devSeat, type KeysFile } from '@saakshi/core/dev';
import { verifier } from '@saakshi/core/node';
import keysJson from '../../../../fixtures/keys.json';
import formsJson from '../../../../fixtures/paper/forms.json';
import type { Action, ActResult, ExamBoot } from '../shared/ipc.ts';
import { resolveAppPath } from './app-path.ts';
import { ExamSession } from './exam.ts';
import { runSelftest } from './probes.ts';
import { httpSend, SeatSync } from './sync.ts';

const argValue = (flag: string): string | undefined => { const i = process.argv.indexOf(flag); return i > 0 ? process.argv[i + 1] : undefined; };
const setting = (flag: string, envName: string, dflt: string): string => argValue(flag) ?? process.env[envName] ?? dflt;

if (process.argv.includes('--probe-selftest')) {
  runSelftest().then(async (r) => {
    const json = JSON.stringify(r, null, 2);
    process.stdout.write(json + '\n');
    const out = argValue('--out');
    if (out) await writeFile(out, json);
    app.exit(r.ok ? 0 : 1);
  }, (e) => { process.stderr.write(String(e) + '\n'); app.exit(2); });
} else {
  start();
}

function start(): void {
  protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
  const RENDERER = join(__dirname, '../renderer');
  const MIME: Record<string, string> = {
    '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
    '.wasm': 'application/wasm', '.tflite': 'application/octet-stream', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2',
    '.ttf': 'font/ttf', '.txt': 'text/plain; charset=utf-8',
  };
  const CSP = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'";

  // DEV until Stage 3: the seat key and pinned cell key come from the bundled demo fixtures (which also hold private keys).
  const keys = keysJson as KeysFile;
  const forms = formsJson as unknown as Record<'F1' | 'F2', string[]> & { durationMin: number };
  const cand = setting('--cand', 'SAAKSHI_CAND', 'C0001');
  const relayUrl = setting('--relay', 'SAAKSHI_RELAY', 'http://127.0.0.1:7070');
  const seat = devSeat(keys, cand);
  const cell = cellKey(keys, 'cell-1');
  const form = devForm(cand);
  const durationMs = forms.durationMin * 60_000;
  let exam: ExamSession | undefined;
  let sync: SeatSync | undefined;
  let win: BrowserWindow | undefined;

  const guard = (fn: () => ActResult): ActResult => { try { return fn(); } catch (e) { return { ok: false, error: (e as Error).message }; } };
  ipcMain.handle('exam:load', (): ExamBoot => ({
    cand, seatId: seat!.seatId, form, durationMs, activeMs: exam!.activeMs(), started: exam!.started, items: exam!.items(), sync: sync!.view(),
  }));
  ipcMain.handle('exam:start', () => guard(() => { const r = exam!.start(); sync!.kick(); return r; }));
  ipcMain.handle('exam:act', (_e, a: Action) => guard(() => { const r = exam!.act(a); if (r.ok) sync!.kick(); return r; }));

  app.whenReady().then(async () => {
    if (!seat) { dialog.showErrorBox('Saakshi', `No DEV seat key for candidate ${cand}`); app.exit(1); return; }
    if (!safeStorage.isEncryptionAvailable()) { dialog.showErrorBox('Saakshi', 'OS key storage (safeStorage) is unavailable, so the journal cannot be encrypted.'); app.exit(1); return; }
    try {
      exam = new ExamSession({ dir: join(app.getPath('userData'), 'journal'), ctx: { ...DEV_EXAM, cand }, keyEpoch: 1, seat, cellPub: cell.pub, wrap: safeStorage, durationMs, items: forms[form] });
    } catch (e) { dialog.showErrorBox('Saakshi — journal problem, please call the invigilator', (e as Error).message); app.exit(1); return; }
    sync = new SeatSync(exam, httpSend(relayUrl), verifier(cell.pub), (v) => win?.webContents.send('sync', v));
    sync.start(1000);
    setInterval(() => exam!.tick(), 5000);

    protocol.handle('app', async (req) => {
      const p = resolveAppPath(RENDERER, new URL(req.url).pathname);
      if (!p) return new Response('not found', { status: 404 });
      try {
        return new Response(await readFile(p), { headers: { 'content-type': MIME[extname(p)] ?? 'application/octet-stream', 'content-security-policy': CSP } });
      } catch { return new Response('not found', { status: 404 }); }
    });
    session.defaultSession.setPermissionRequestHandler((_wc, perm, cb) => cb(perm === 'media'));
    session.defaultSession.setPermissionCheckHandler((_wc, perm) => perm === 'media');
    if (process.platform === 'darwin') await systemPreferences.askForMediaAccess('camera');

    win = new BrowserWindow({
      width: 1200, height: 800,
      webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, sandbox: true, nodeIntegration: false },
    });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('app://')) e.preventDefault(); });
    const zoom = Number(process.env.SAAKSHI_ZOOM ?? 1);
    if (zoom !== 1) win.webContents.on('did-finish-load', () => win!.webContents.setZoomFactor(zoom));
    const dev = process.env.ELECTRON_RENDERER_URL;
    await (dev && !app.isPackaged ? win.loadURL(dev) : win.loadURL('app://seat/index.html'));
  });
  app.on('window-all-closed', () => { sync?.stop(); exam?.close(); app.quit(); });
}
