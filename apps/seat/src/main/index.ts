import { app, BrowserWindow, dialog, ipcMain, Menu, powerMonitor, protocol, safeStorage, screen, session, systemPreferences } from 'electron';
import { url as inspectorUrl } from 'node:inspector';
import { readFile, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { hexToBytes } from '@saakshi/core/bytes';
import { DEV_EXAM } from '@saakshi/core/dev';
import trustJson from '../../../../fixtures/trust-dev.json';
import type { Action, EnrolInput, FaceSample } from '../shared/ipc.ts';
import { resolveAppPath } from './app-path.ts';
import { cameraEnabled } from './camera.ts';
import type { Wrapper } from './journal-store.ts';
import { pickWrapper, testMode } from './keystore.ts';
import { argValue as argOf, E2E, launchRefusal, windowMode } from './hardening.ts';
import { collect, type HostInputs } from './probe-host.ts';
import { runGateSelftest, runSelftest } from './probes.ts';
import { Seat } from './seat.ts';

const argValue = (flag: string): string | undefined => argOf(process.argv, flag);
const setting = (flag: string, envName: string, dflt: string): string => argValue(flag) ?? process.env[envName] ?? dflt;

// A crash in main must say why, not exit silently (Windows CI saw a bare exit -1). SAAKSHI_TRACE=1 also logs start-up steps.
const trace = (m: string): void => { if (process.env.SAAKSHI_TRACE === '1') process.stderr.write(`[saakshi] ${m}\n`); };
process.on('uncaughtException', (e) => { process.stderr.write(`[saakshi] fatal: ${e.stack ?? e}\n`); app.exit(70); });
process.on('unhandledRejection', (e) => { process.stderr.write(`[saakshi] fatal (promise): ${(e as Error)?.stack ?? e}\n`); app.exit(70); });
app.on('child-process-gone', (_e, d) => process.stderr.write(`[saakshi] child gone: ${d.type} ${d.reason} ${d.exitCode}\n`));
app.on('render-process-gone', (_e, _w, d) => process.stderr.write(`[saakshi] renderer gone: ${d.reason} ${d.exitCode}\n`));
trace(`main loaded; argv ${JSON.stringify(process.argv.slice(1))}`);

const refusal = launchRefusal(process.argv, E2E);
if (refusal) { process.stderr.write(refusal + '\n'); app.exit(3); }
else if (process.argv.includes('--probe-selftest')) {
  runSelftest().then(async (r) => {
    const json = JSON.stringify(r, null, 2);
    process.stdout.write(json + '\n');
    const out = argValue('--out');
    if (out) await writeFile(out, json);
    app.exit(r.ok ? 0 : 1);
  }, (e) => { process.stderr.write(String(e) + '\n'); app.exit(2); });
} else if (process.argv.includes('--gate-selftest')) {
  const expect = (argValue('--expect') ?? '').split(',').filter(Boolean);
  runGateSelftest(expect).then(async (r) => {
    const j = JSON.stringify(r, null, 2);
    process.stdout.write(j + '\n');
    const out = argValue('--out');
    if (out) await writeFile(out, j);
    app.exit(r.ok ? 0 : 1);
  }, (e) => { process.stderr.write(String(e) + '\n'); app.exit(2); });
} else if (process.argv.includes('--fuse-check')) {
  writeFile(argValue('--out') ?? 'fuse-check.json', JSON.stringify({ execArgv: process.execArgv, inspectorUrl: inspectorUrl() ?? null, runAsNode: !!process.env.ELECTRON_RUN_AS_NODE, e2e: E2E }))
    .then(() => app.exit(0), () => app.exit(2));
} else if (process.argv.includes('--overlay-sim')) overlaySim();
else if (!app.requestSingleInstanceLock()) { trace('another instance holds the lock'); app.exit(0); }
else { trace('start'); start(); }

// A capture-excluded window for the Act 1 demo and the CI gate self-test. Never starts a seat; skips the single-instance lock.
function overlaySim(): void {
  app.whenReady().then(() => {
    const w = new BrowserWindow({ width: 360, height: 120, frame: false, alwaysOnTop: true, webPreferences: { sandbox: true, contextIsolation: true } });
    w.setContentProtection(true);             // Windows: WDA_EXCLUDEFROMCAPTURE; macOS: NSWindowSharingNone
    void w.loadURL('data:text/html,' + encodeURIComponent('<body style="font:16px system-ui;margin:1rem">overlay-sim (hidden from screen capture)</body>'));
  });
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
  app.on('second-instance', () => { win?.focus(); });
  let skew: number | null = null, cameraSeen = false, blurAt = 0;
  const host: HostInputs = { displays: () => screen.getAllDisplays().length, onBattery: () => powerMonitor.isOnBatteryPower(),
    camera: () => (camera ? (cameraSeen ? 'on' : 'none') : 'off'), skewMs: () => skew, dataDir: app.getPath('userData') };
  const skewCheck = () => fetch(new URL('/v1/status', relayUrl), { method: 'HEAD' }).then((res) => {
    const d = Date.parse(res.headers.get('date') ?? '');
    if (!Number.isNaN(d)) skew = Date.now() - d;
  }, () => {});

  const guard = <T>(fn: () => T): T | { ok: false; error: string } => { try { return fn(); } catch (e) { return { ok: false, error: (e as Error).message }; } };
  ipcMain.handle('exam:load', () => seat!.boot());
  ipcMain.handle('exam:enrol', (_e, x: EnrolInput) => seat!.enrol(x));
  ipcMain.handle('exam:paper', () => seat!.paper());
  ipcMain.handle('exam:start', () => guard(() => seat!.start()));
  ipcMain.handle('exam:act', (_e, a: Action) => guard(() => seat!.act(a)));
  ipcMain.handle('exam:submit', () => guard(() => seat!.submit()));
  ipcMain.handle('exam:handover', (_e, pin: string) => seat!.handover(String(pin)));
  ipcMain.handle('gate:recheck', () => seat!.recheck());
  ipcMain.on('face:sample', (_e, s: FaceSample) => {
    if (Number.isInteger(s?.faces) && s.faces >= 0 && s.faces <= 20 && typeof s.at === 'number'
      && (s.thumb === undefined || (typeof s.thumb === 'string' && s.thumb.length <= 20_000))) { cameraSeen = true; seat?.faceSample(s); }
  });
  ipcMain.on('gate:blur', () => {});   // kept for API stability; main measures blur itself, so a starved renderer cannot hide it

  app.whenReady().then(async () => {
    trace('ready');
    let wrap: Wrapper;
    try { wrap = pickWrapper({ testMode: test, safeStorage, dir: app.getPath('userData') }); }
    catch (e) { dialog.showErrorBox('Saakshi', (e as Error).message); app.exit(1); return; }
    if (test) console.warn('SAAKSHI TEST MODE — not for real exams (journal key not in the OS keychain)');
    seat = new Seat({ dir: join(app.getPath('userData'), 'journal'), relayUrl, ctx: { ...DEV_EXAM, cand }, seatId, authorityPub, wrap, camera, testMode: test,
      integrity: { collect: () => collect(host) },
      onBoot: (b) => win?.webContents.send('boot', b), onSync: (v) => win?.webContents.send('sync', v) });
    await seat.open();
    trace('seat open');
    void skewCheck(); setInterval(skewCheck, 30_000).unref();
    // plan §3.6: suspend and screen lock pause the timer and become gap entries on resume (powerMonitor only after whenReady).
    powerMonitor.on('suspend', () => seat?.pause('suspend'));
    powerMonitor.on('lock-screen', () => seat?.pause('lock-screen'));
    powerMonitor.on('resume', () => seat?.resume());
    powerMonitor.on('unlock-screen', () => seat?.resume());

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

    // Renderer egress: only the app's own scheme (and the dev server when unpackaged). Main-process fetch goes only to relayUrl.
    const dev = !app.isPackaged ? process.env.ELECTRON_RENDERER_URL : undefined;
    session.defaultSession.webRequest.onBeforeRequest((d, cb) => cb({ cancel: !/^(app|devtools|data|blob):/.test(d.url) && !(dev && d.url.startsWith(dev)) }));

    const m = windowMode({ test, e2e: E2E, platform: process.platform });
    if (!E2E) Menu.setApplicationMenu(null);
    win = new BrowserWindow({
      width: 1200, height: 800, kiosk: m.kiosk, fullscreen: m.fullscreen,
      webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, sandbox: true, nodeIntegration: false, devTools: m.devtools },
    });
    if (m.alwaysOnTop) win.setAlwaysOnTop(true, 'screen-saver');
    if (m.contentProtection) win.setContentProtection(true);
    if (!m.devtools) win.webContents.on('devtools-opened', () => win!.webContents.closeDevTools());
    win.on('blur', () => { blurAt = Date.now(); });
    win.on('focus', () => { if (blurAt) seat?.blur(Date.now() - blurAt); blurAt = 0; });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('app://')) e.preventDefault(); });
    const zoom = Number(process.env.SAAKSHI_ZOOM ?? 1);
    if (zoom !== 1) win.webContents.on('did-finish-load', () => win!.webContents.setZoomFactor(zoom));
    await (dev ? win.loadURL(dev) : win.loadURL('app://seat/index.html'));
  });
  app.on('window-all-closed', () => { seat?.close(); app.quit(); });
}
