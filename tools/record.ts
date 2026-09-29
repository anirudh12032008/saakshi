// Records the demo video's screen clips with no human in the loop (docs/video/REHEARSAL.md). For each act it runs the real act
// script with VIDEO_HOLD=1, attaches Chrome (playwright-core, channel "chrome") to control's UIs while the act runs, then — while the
// act holds its final state — tours the pages that tell the story, plus a terminal view of the act's own stdout. Outputs:
//   docs/video/clips/act{N}-live.webm, act{N}-tour.webm, act{N}.log      and  act0.png / close.png (title cards from the README)
// Needs local ports and Chrome (run it unsandboxed).  bun tools/record.ts [--acts 1,2,3,4,5,cards]
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';

const ROOT = join(import.meta.dirname, '..');
const CLIPS = join(ROOT, 'docs/video/clips');
const size = { width: 1280, height: 720 };
mkdirSync(CLIPS, { recursive: true });

// A tour step: open a URL (or HTML), optionally scroll to a selector / heading text, optionally run an action, then hold.
type Step = { url?: string; html?: string; to?: string; text?: string; secs: number; act?: (p: Page) => Promise<void> };
const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);

// The act's own stdout, shown as a terminal: real lines only, typed out one per ~0.5 s.
function terminal(title: string, lines: string[]) {
  return `<!doctype html><meta charset=utf-8><body style="margin:0;background:#0d1117;color:#c9d1d9;font:17px/1.55 Menlo,monospace">
<div style="background:#161b22;padding:8px 16px;color:#8b949e;font-size:14px">● ● ●&nbsp;&nbsp; ${esc(title)}</div>
<pre id=t style="margin:0;padding:16px 24px;white-space:pre-wrap;word-break:break-word"></pre><script>
const L=${JSON.stringify(lines)};let i=0;const t=document.getElementById('t');
const tick=()=>{if(i>=L.length)return;const d=document.createElement('div');d.textContent=L[i++];
if(/ROGUE|TAMPER|BLOCKED|PLUG|DOWN/.test(d.textContent))d.style.color='#ff7b72';else if(d.textContent.startsWith('✓')||d.textContent==='PASS')d.style.color='#7ee787';
t.appendChild(d);window.scrollTo(0,document.body.scrollHeight);setTimeout(tick,300)};tick();</script>`;
}

async function goTo(p: Page, s: Step) {
  if (s.to) await p.locator(s.to).first().scrollIntoViewIfNeeded().catch(() => {});
  if (s.text) await p.getByText(s.text, { exact: false }).first().evaluate((e) => e.scrollIntoView({ block: 'start', behavior: 'smooth' })).catch(() => {});
}

async function tour(browser: Browser, name: string, steps: Step[]) {
  const tmp = mkdtempSync(join(tmpdir(), 'rec-'));
  const ctx = await browser.newContext({ viewport: size, recordVideo: { dir: tmp, size } });
  const p = await ctx.newPage();
  for (const s of steps) {
    if (s.url) await p.goto(s.url, { waitUntil: 'load' }).catch((e) => console.error(`[record] ${s.url}: ${e.message}`));
    if (s.html) await p.setContent(s.html);
    await p.waitForTimeout(600);
    await goTo(p, s);
    if (s.act) await s.act(p).catch((e) => console.error(`[record] action: ${e.message}`));
    await p.waitForTimeout(s.secs * 1000);
  }
  await ctx.close();
  const f = readdirSync(tmp).find((x) => x.endsWith('.webm'))!;
  renameSync(join(tmp, f), join(CLIPS, `${name}.webm`));
  rmSync(tmp, { recursive: true, force: true });
  console.log(`[record] ${name}.webm`);
}

// What to watch live, and what to tour at the end, per act. C = control's origin; log = the act's stdout so far.
const PLAN: Record<number, { live: string[]; tour: (C: string, log: string[]) => Promise<Step[]> }> = {
  1: { live: ['#readiness', '#review'], tour: async (C, log) => [
    { url: `${C}/control`, to: '#readiness', secs: 7 },
    { to: '#review', secs: 5 },
    { html: terminal('bun tools/act1.ts', log.filter((l) => l.startsWith('✓') || l === 'PASS')), secs: 7 },
  ] },
  2: { live: ['#kpis', '#tiles', '#release', '#offline'], tour: async (C, log) => [
    { url: `${C}/control`, to: '#kpis', secs: 6 },
    { to: '#tiles', secs: 6 },
    { to: '#release', secs: 5 },
    { to: '#offline', secs: 5 },
    { html: terminal('bun tools/act2.ts', log.filter((l) => l.startsWith('✓') || l === 'PASS')), secs: 8 },
  ] },
  3: { live: ['#incidents', '#link', '#time'], tour: async (C, log) => [
    { url: `${C}/control`, to: '#incidents', secs: 7 },
    { to: '#link', secs: 4 },
    { to: '#time', secs: 5 },
    { url: `${C}/status`, secs: 6 },
    { html: terminal('bun tools/act3.ts', log.filter((l) => l.startsWith('✓') || /PLUG|HANDOVER|WAN DOWN|ROGUE/.test(l) || l === 'PASS').map((l) => l.replace(/; deleted .*/, '; deleted cell-2.db'))), secs: 12 },
  ] },
  4: { live: ['#recon-row', '#audit'], tour: async (C, log) => {
    const code = log.find((l) => l.startsWith('seat slip: '))?.split(' ')[2] ?? '';
    // The evidence pack, fetched from control and opened as its own files.
    const dir = mkdtempSync(join(tmpdir(), 'pack-'));
    writeFileSync(join(dir, 'pack.tar.gz'), new Uint8Array(await (await fetch(`${C}/v1/evidence?cand=C0002`)).arrayBuffer()));
    Bun.spawnSync(['tar', '-xzf', 'pack.tar.gz'], { cwd: dir });
    const top = readdirSync(dir).find((f) => f !== 'pack.tar.gz')!;
    const pack = join(dir, top);
    const listing = terminal(`tar -tzf ${top}.tar.gz && shasum -a 256 -c manifest.sha256`,
      [...readdirSync(pack).map((f) => `${top}/${f}`), ...Bun.spawnSync(['shasum', '-a', '256', '-c', 'manifest.sha256'], { cwd: pack }).stdout.toString().trim().split('\n')]);
    return [
      { html: terminal('bun tools/act4.ts', log.filter((l) => l.startsWith('✓') || l.startsWith('seat slip') || l === 'PASS')), secs: 9 },
      { url: `${C}/control`, to: '#recon-row', secs: 4 },
      { to: '#audit', secs: 5 },
      { url: `${C}/verify?cand=C0002`, secs: 2, act: async (p) => { await p.fill('#code', code); await p.locator('#code').press('Enter'); await p.waitForTimeout(800); await goTo(p, { to: '#verdict', secs: 0 }); } },
      { secs: 6, act: async (p) => { await goTo(p, { to: '#rows', secs: 0 }); } },
      { html: listing, secs: 7 },
      { url: `file://${pack}/certificate-s63.html`, secs: 5 },
      { url: `file://${pack}/report.html`, secs: 5 },
    ];
  } },
  5: { live: ['#kpis'], tour: async (C, log) => [
    { html: terminal('bun tools/act5.ts', log.filter((l) => l.startsWith('✓') || l === 'PASS')), secs: 12 },
    { url: `${C}/control`, text: 'Decide fairly', secs: 8 },
    { text: 'Invigilator reports', secs: 5 },
    { text: 'Notices — EN / HI / TA', secs: 6 },
    { url: `${C}/status`, secs: 4 },
    { secs: 3, act: async (p) => { await p.getByText('हिन्दी').first().click(); } },
    { secs: 3, act: async (p) => { await p.getByText('தமிழ்').first().click(); } },
  ] },
};

async function recordAct(browser: Browser, n: number) {
  const log: string[] = [];
  const child = spawn('bun', [join(ROOT, `tools/act${n}.ts`)], { cwd: ROOT, env: { ...process.env, VIDEO_HOLD: '1' }, stdio: ['pipe', 'pipe', 'inherit'] });
  let control = '', held = false, exited = false;
  let buf = '';
  child.stdout.on('data', (d) => {
    buf += d.toString();
    for (let i = buf.indexOf('\n'); i >= 0; i = buf.indexOf('\n')) {
      const l = buf.slice(0, i); buf = buf.slice(i + 1);
      console.log(`[act${n}] ${l}`);
      if (l.startsWith('CONTROL ')) control = l.slice(8);
      else if (l === 'HOLD') held = true;
      else log.push(l);
    }
  });
  child.on('exit', () => { exited = true; });
  while (!control && !exited) await Bun.sleep(100);

  // Live: control's dashboard as the act drives it, cycling the act's sections.
  const tmp = mkdtempSync(join(tmpdir(), 'rec-'));
  const ctx = await browser.newContext({ viewport: size, recordVideo: { dir: tmp, size } });
  const p = await ctx.newPage();
  while (!held && !exited) { if (await p.goto(`${control}/control`).then(() => true, () => false)) break; await Bun.sleep(500); }
  for (let k = 0; !held && !exited; k++) {
    await goTo(p, { to: PLAN[n].live[k % PLAN[n].live.length], secs: 0 });
    await Bun.sleep(4000);
  }
  await ctx.close();
  const f = readdirSync(tmp).find((x) => x.endsWith('.webm'))!;
  renameSync(join(tmp, f), join(CLIPS, `act${n}-live.webm`));
  if (!log.includes('PASS')) throw new Error(`act${n} did not pass`);
  writeFileSync(join(CLIPS, `act${n}.log`), log.join('\n') + '\n');

  await tour(browser, `act${n}-tour`, await PLAN[n].tour(control, log));
  child.stdin.end();   // releases the hold; the act cleans up
  await new Promise((r) => (exited ? r(null) : child.on('exit', r)));
}

// Title cards: Act 0 (the pitch) and the close (the measured-numbers table), text straight from README.md.
async function cards(browser: Browser) {
  const p = await browser.newPage({ viewport: size });
  const style = `<meta charset=utf-8><body style="margin:0;width:1280px;height:720px;background:#101418;color:#e6edf3;font-family:Helvetica,Arial,sans-serif;display:flex;flex-direction:column;justify-content:center;padding:0 90px;box-sizing:border-box">`;
  await p.setContent(`${style}<div style="font-size:30px;color:#8b949e">Saakshi (साक्षी, "witness") · Challenge 6</div>
<div style="font-size:52px;font-weight:700;line-height:1.2;margin:24px 0">We can't promise zero failures.<br>We make every failure <span style="color:#7ee787">recoverable, contained, provable.</span></div>
<div style="font-size:24px;color:#c9d1d9;line-height:1.5">Signs and hash-chains every answer at the seat · keeps working through relay, cell and link failures · makes tampering locatable and recoverable · analytics that never auto-penalise a candidate</div>`);
  await p.screenshot({ path: join(CLIPS, 'act0.png') });
  const rows: [string, string][] = [
    ['Ingest latency, relay to cell (3,697 calls)', 'p50 44.1 ms, p99 168.1 ms'],
    ['Entries stored / rejected at 20k candidates', '227,882 / 0'],
    ['Candidates unlocked', '19,803 of 19,803'],
    ['Relay-to-cell traffic', 'about 1.06 MB per candidate-hour'],
    ['Seat CPU / RSS', '2.3% median (max 4.3%) / 166 MiB'],
    ['Chaos drill (kill-cell, wipe-cell, spare-relay)', '20/20 pass, 0 of 16,000 answers lost, RTO median 0.96 to 1.23 s'],
    ['Offline-start act', 'PASS, 308 candidates at 7 centres, 6,586 entries committed'],
  ];
  await p.setContent(`${style}<div style="font-size:36px;font-weight:700">Measured numbers</div>
<div style="font-size:18px;color:#8b949e;margin:6px 0 18px">One Apple M5 Mac (16 GiB), 3 real cells on loopback, 99 simulated centres, synthetic G1 cohort. Not real WAN.</div>
<table style="font-size:20px;border-collapse:collapse">${rows.map(([a, b]) => `<tr><td style="padding:7px 28px 7px 0;color:#c9d1d9;border-bottom:1px solid #30363d">${esc(a)}</td><td style="padding:7px 0;color:#7ee787;border-bottom:1px solid #30363d">${esc(b)}</td></tr>`).join('')}</table>
<div style="font-size:22px;margin-top:26px">A protocol, not a product · Apache-2.0 · tested on macOS and in Windows CI · every number cited in docs/evidence/</div>`);
  await p.screenshot({ path: join(CLIPS, 'close.png') });
  await p.close();
  console.log('[record] act0.png, close.png');
}

const arg = process.argv.find((a) => a.startsWith('--acts='))?.split('=')[1] ?? '1,2,3,4,5,cards';
const browser = await chromium.launch({ channel: 'chrome' });
try {
  for (const a of arg.split(',')) if (a === 'cards') await cards(browser); else await recordAct(browser, Number(a));
} finally {
  await browser.close();
}
