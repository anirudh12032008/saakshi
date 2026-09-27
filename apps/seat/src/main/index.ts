import { app, BrowserWindow, dialog, ipcMain, protocol, safeStorage, session, systemPreferences } from 'electron';
import { readFile, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { hexToBytes } from '@saakshi/core/bytes';
import { DEV_EXAM } from '@saakshi/core/dev';
import trustJson from '../../../../fixtures/trust-dev.json';
import type { Action, EnrolInput } from '../shared/ipc.ts';
import { resolveAppPath } from './app-path.ts';
import { cameraEnabled } from './camera.ts';
import type { Wrapper } from './journal-store.ts';
import { pickWrapper, testMode } from './keystore.ts';
import { runSelftest } from './probes.ts';
import { Seat } from './seat.ts';

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

  // Stage 3: the app carries only the exam authority's PUBLIC key. The seat key is made at enrolment; the cell key, D_i and the
  // roster come from the signed policy; the paper comes encrypted and opens only with a key that matches kc_f.
  const authorityPub = hexToBytes((trustJson as { authority: string }).authority);
  const cand = setting('--cand', 'SAAKSHI_CAND', 'C0001');
  const seatId = setting('--seat', 'SAAKSHI_SEAT', 'CEN042-S01');
  const relayUrl = setting('--relay', 'SAAKSHI_RELAY', 'http://127.0.0.1:7070');
  const camera = cameraEnabled(process.argv, process.env);
  const test = testMode(process.argv, process.env);
  let seat: Seat | undefined;
  let win: BrowserWindow | undefined;

  const guard = <T>(fn: () => T): T | { ok: false; error: string } => { try { return fn(); } catch (e) { return { ok: false, error: (e as Error).message }; } };
  ipcMain.handle('exam:load', () => seat!.boot());
  ipcMain.handle('exam:enrol', (_e, x: EnrolInput) => seat!.enrol(x));
  ipcMain.handle('exam:paper', () => seat!.paper());
  ipcMain.handle('exam:start', () => guard(() => seat!.start()));
  ipcMain.handle('exam:act', (_e, a: Action) => guard(() => seat!.act(a)));
  ipcMain.handle('exam:submit', () => guard(() => seat!.submit()));

  app.whenReady().then(async () => {
    let wrap: Wrapper;
    try { wrap = pickWrapper({ testMode: test, safeStorage, dir: app.getPath('userData') }); }
    catch (e) { dialog.showErrorBox('Saakshi', (e as Error).message); app.exit(1); return; }
    if (test) console.warn('SAAKSHI TEST MODE — not for real exams (journal key not in the OS keychain)');
    seat = new Seat({ dir: join(app.getPath('userData'), 'journal'), relayUrl, ctx: { ...DEV_EXAM, cand }, seatId, authorityPub, wrap, camera, testMode: test,
      onBoot: (b) => win?.webContents.send('boot', b), onSync: (v) => win?.webContents.send('sync', v) });
    await seat.open();

    protocol.handle('app', async (req) => {
      const p = resolveAppPath(RENDERER, new URL(req.url).pathname);
      if (!p) return new Response('not found', { status: 404 });
      try {
        return new Response(await readFile(p), { headers: { 'content-type': MIME[extname(p)] ?? 'application/octet-stream', 'content-security-policy': CSP } });
      } catch { return new Response('not found', { status: 404 }); }
    });
    // Camera off (--no-camera or test mode): no permission and no macOS prompt.
    session.defaultSession.setPermissionRequestHandler((_wc, perm, cb) => cb(camera && perm === 'media'));
    session.defaultSession.setPermissionCheckHandler((_wc, perm) => camera && perm === 'media');
    if (camera && process.platform === 'darwin') await systemPreferences.askForMediaAccess('camera');

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
  app.on('window-all-closed', () => { seat?.close(); app.quit(); });
}
