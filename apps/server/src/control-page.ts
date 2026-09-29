import type { SignedSth } from '@saakshi/core/log';
import type { Finding, ReconRow } from '@saakshi/core/sheet';
import type { FleetView, ReleaseStatus } from '@saakshi/core/directory';
import type { ArchiveReport, Incident, LinkView, Notice, Severity, TimeRow } from '@saakshi/core/ops';
import type { AnalyticsRun, Classification, IncidentIn, InvReport, ScoreRow, SignedDecision } from '@saakshi/core/analytics';
import type { ReadinessBoard } from './readiness-view.ts';
import { seatLine } from './readiness-view.ts';
import type { ReviewItem } from './review.ts';
import { archiveLines, commitment, findingText, flagRows, fleetSummary, group, headline, incidentCard, kpis, linkLine, noticeCard, noticeText, reconCells, releaseLines, readinessTile, reviewCard, riskChip, tileText, timeCells, witnessLine } from './control-view.ts';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const say = (id: string, text: string, tone = '') => { const el = $(id); el.textContent = text; el.className = `out ${tone}`.trim(); };

async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const r = await fetch(path, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as { error?: string }).error ?? `HTTP ${r.status}`);
  return j as T;
}

async function recon(): Promise<void> {
  try {
    const r = await call<ReconRow>('GET', '/v1/recon');
    $('recon-row').replaceChildren(...[{ value: `${r.centre} · ${r.shift}`, ok: true }, ...reconCells(r)].map((c) => {
      const td = document.createElement('td'); td.textContent = c.value; td.className = c.ok ? 'ok' : 'bad'; return td;
    }));
    if (r.submitted === 0) say('recon-status', 'Nothing submitted yet.');
    else say('recon-status', r.green ? 'Green: every count and every head agrees.' : 'Not green: see the red cells.', r.green ? 'ok' : 'bad');
  } catch (e) { say('recon-status', `Cannot reconcile: ${(e as Error).message}`, 'bad'); }
}

$('seal').addEventListener('click', async () => {
  try {
    const r = await call<{ sth: SignedSth; added: string[]; skipped: { cand: string; reason: string }[] }>('POST', '/v1/seal');
    const s = r.sth.sth;
    say('seal-out', `Register head: ${s.size} leaves · root ${s.root.slice(0, 16)}… · ${new Date(s.ts).toLocaleTimeString()}`
      + (r.added.length ? ` · added ${r.added.join(', ')}` : ' · nothing new')
      + (r.skipped.length ? ` · not logged: ${r.skipped.map((x) => `${x.cand} (${x.reason})`).join(', ')}` : ''), 'ok');
    void recon();
  } catch (e) { say('seal-out', (e as Error).message, 'bad'); }
});

$('rogue').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const f = new FormData(ev.target as HTMLFormElement);
  try {
    const r = await call<{ sql: string; from: string; to: string; q: number }>('POST', '/v1/rogue', { cand: f.get('cand'), q: Number(f.get('q')), answer: f.get('answer') });
    say('rogue-out', `${r.sql}\n(Q${r.q}: ${r.from || 'no answer'} → ${r.to})`, 'bad');
  } catch (e) { say('rogue-out', (e as Error).message, 'bad'); }
});

$('audit').addEventListener('click', async () => {
  try {
    const r = await call<{ findings: Finding[] }>('POST', '/v1/audit');
    $('audit-headline').textContent = headline(r.findings);
    $('audit-headline').className = r.findings.length ? 'bad' : 'ok';
    $('audit-list').replaceChildren(...r.findings.map((x) => { const li = document.createElement('li'); li.textContent = findingText(x); return li; }));
  } catch (e) { $('audit-headline').textContent = (e as Error).message; }
});

$('ev-cand').addEventListener('input', () => { $<HTMLAnchorElement>('verify-link').href = `/verify?cand=${encodeURIComponent($<HTMLInputElement>('ev-cand').value)}`; });
$('evidence').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const cand = $<HTMLInputElement>('ev-cand').value;
  const r = await fetch(`/v1/evidence?cand=${encodeURIComponent(cand)}`);
  if (!r.ok) { say('evidence-out', ((await r.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${r.status}`, 'bad'); return; }
  const name = /filename="([^"]+)"/.exec(r.headers.get('content-disposition') ?? '')?.[1] ?? 'evidence.tar.gz';
  const a = document.createElement('a');
  a.href = URL.createObjectURL(await r.blob());
  a.download = name;
  a.click();
  say('evidence-out', `Downloaded ${name}. The same files are under data/control/evidence/.`, 'ok');
});

void recon();
setInterval(recon, 2000);
const witnessTick = async () => say('witness', witnessLine(await call<Parameters<typeof witnessLine>[0]>('GET', '/v1/witness').catch(() => undefined)));
void witnessTick(); setInterval(witnessTick, 2000);

const li = (text: string): HTMLLIElement => { const x = document.createElement('li'); x.textContent = text; return x; };
let lastSummary = '';
let scoreByCentre = new Map<string, ScoreRow>();

async function scorecardTick(): Promise<void> {
  try { const { rows } = await call<{ rows: ScoreRow[] }>('GET', '/v1/scorecard'); scoreByCentre = new Map(rows.map((r) => [r.centre, r])); }
  catch { /* not computed yet: keep the last board */ }
}

async function fleetTick(): Promise<void> {
  try {
    const f = await call<FleetView>('GET', '/v1/fleet');
    $('kpis').replaceChildren(...kpis(f).map((k) => {
      const d = document.createElement('div'), dt = document.createElement('dt'), dd = document.createElement('dd');
      dt.textContent = k.label; dd.textContent = k.value; d.append(dt, dd); return d;
    }));
    $('tiles').replaceChildren(...f.centres.map((t) => {
      const x = tileText(t), item = document.createElement('li');
      item.className = `tile ${t.tone}`;
      item.setAttribute('aria-label', x.aria);
      const title = document.createElement('strong'), line = document.createElement('span'), word = document.createElement('span');
      title.textContent = x.title; line.textContent = x.line; word.textContent = x.word;
      item.append(title, line, word);
      const chip = riskChip(scoreByCentre.get(t.centre));
      if (chip) { const c = el('span', chip.text, `chip ${chip.tone} risk-line`); c.title = scoreByCentre.get(t.centre)?.reasons[0] ?? ''; item.append(c); }
      return item;
    }));
    const summary = fleetSummary(f);
    if (summary !== lastSummary) { $('fleet-summary').textContent = summary; lastSummary = summary; }   // the live region speaks only on change
    $('cells').textContent = f.cells.map((c) => `${c.id}: ${c.state === 'DOWN' ? 'down' : c.state.toLowerCase()} · ${c.entries.toLocaleString('en-IN')} entries`).join(' · ');
    const sel = $<HTMLSelectElement>('off-centre');
    if (!sel.options.length) sel.replaceChildren(...f.centres.map((t) => new Option(t.centre, t.centre)));
  } catch (e) { $('fleet-summary').textContent = `Fleet view unavailable: ${(e as Error).message}`; }
}

async function releaseTick(): Promise<void> {
  try {
    const s = await call<ReleaseStatus>('GET', '/v1/release/status');
    $('commitment').replaceChildren(...commitment(s.manifest).map(li));
    $('release').replaceChildren(...releaseLines(s).map(li));
  } catch { $('release').replaceChildren(li('No exam package loaded (control runs without EXAM).')); }
}

$('offline').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const f = new FormData(ev.target as HTMLFormElement);
  try {
    const r = await call<{ centre: string; shift: string; code: string }>('POST', '/v1/release/code', { centre: f.get('centre'), superintendent: f.get('superintendent'), callback: f.get('callback') === 'on' });
    $('off-code').textContent = group(r.code);
    say('off-out', `Read this to the superintendent of ${r.centre} for ${r.shift}. The reveal is logged.`, 'ok');
    void releaseTick();
  } catch (e) { $('off-code').textContent = ''; say('off-out', (e as Error).message, 'bad'); }
});

$('wan').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const up = ((ev as SubmitEvent).submitter as HTMLButtonElement).value === 'true';
  try {
    await call('POST', '/v1/chaos/wan', { up });
    say('wan-out', up ? "Centre 42's link is back." : "Centre 42's link is cut: its relay cannot reach the exam server.", up ? 'ok' : 'bad');
  } catch (e) { say('wan-out', (e as Error).message, 'bad'); }
});

void fleetTick();
void releaseTick();
void scorecardTick();
setInterval(fleetTick, 1000);
setInterval(releaseTick, 2000);
setInterval(scorecardTick, 5000);

const el = (tag: string, text = '', cls = ''): HTMLElement => { const x = document.createElement(tag); x.textContent = text; if (cls) x.className = cls; return x; };
async function incidentsTick(): Promise<void> {
  try {
    const r = await call<{ at: number; demo: boolean; ladderMs: Record<Severity, number>; incidents: Incident[] }>('GET', '/v1/incidents');
    $('ops-mode').textContent = r.demo ? 'DEMO timers: each unacknowledged rung escalates after 10 s.' : 'Production timers.';
    $('incidents').replaceChildren(...r.incidents.map((i) => {
      const c = incidentCard(i, r.at, r.ladderMs), li2 = el('li', '', `card ${c.tone}${i.resolvedAt ? ' closed' : ''}`);
      li2.append(el('span', c.badge, 'badge'), el('strong', c.title), el('span', c.blast), el('span', `${c.age} · ${c.ladder}`), el('span', c.next), el('span', c.detail));
      if (c.canAck) { const b = el('button', `Acknowledge ${i.id}`); b.addEventListener('click', () => void act('/v1/incidents/ack', { id: i.id, by: $<HTMLInputElement>('ack-by').value })); li2.append(b); }
      if (c.canResolve) { const b = el('button', `Resolve ${i.id}`); b.addEventListener('click', () => void act('/v1/incidents/resolve', { id: i.id })); li2.append(b); }
      if (i.certIn) { const a = el('a', 'CERT-In report draft (6-hour window)') as HTMLAnchorElement; a.href = `/v1/incidents/certin?id=${encodeURIComponent(i.id)}`; a.target = '_blank'; li2.append(a); }
      if ((i.kind === 'GAP' || (i.kind === 'HANDOVER' && !i.data.approvedBy)) && !i.resolvedAt) {
        const seq = i.kind === 'GAP' ? Number(i.data.seq) : Number(i.data.fromSeq) + 1;
        const b = el('button', `Approve credited time for ${i.cand}`); b.addEventListener('click', () => void act('/v1/gaps/approve', { cand: i.cand, seq, by: $<HTMLInputElement>('ack-by').value })); li2.append(b);
      }
      return li2;
    }));
  } catch (e) { $('incidents').replaceChildren(el('li', `Incidents unavailable: ${(e as Error).message}`)); }
}
async function act(path: string, body: unknown): Promise<void> {
  try { await call('POST', path, body); } catch (e) { say('chaos-out', (e as Error).message, 'bad'); }
  void incidentsTick();
}
async function linkTick(): Promise<void> {
  try { const l = linkLine(await call<LinkView>('GET', '/v1/link')); $('link').textContent = l.text; $('link').className = l.tone === 'good' ? 'ok' : 'bad'; }
  catch { $('link').textContent = 'The relay\'s link view is unavailable.'; }
}
async function timeTick(): Promise<void> {
  try {
    const { rows } = await call<{ rows: TimeRow[] }>('GET', '/v1/time');
    $('time').replaceChildren(...rows.map((r) => { const tr = document.createElement('tr'); tr.append(...timeCells(r).map((c) => el('td', c.value, c.ok ? 'ok' : 'bad'))); return tr; }));
  } catch { /* the cell may be down: keep the last table */ }
}
async function noticesTick(): Promise<void> {
  try {
    const { drafts, sent } = await call<{ drafts: Notice[]; sent: Notice[] }>('GET', '/v1/notices');
    $('notices').replaceChildren(...drafts.map((n) => {
      const li2 = el('li', noticeText(n)), b = el('button', `Approve and send notice ${n.id}`);
      b.addEventListener('click', () => void call('POST', '/v1/notices/approve', { id: n.id, by: $<HTMLInputElement>('ack-by').value }).then(noticesTick, (e) => say('chaos-out', (e as Error).message, 'bad')));
      li2.append(b);
      return li2;
    }), ...sent.map((n) => el('li', `Sent at ${new Date(n.approvedAt!).toLocaleTimeString()}, approved by ${n.approvedBy}: ${noticeText(n)}`)));
  } catch { /* retry next tick */ }
}
const chaos = (id: string, path: string, body: unknown, done: string): void => $(id).addEventListener('click', async () => {
  try { await call('POST', path, body); say('chaos-out', done, 'bad'); } catch (e) { say('chaos-out', (e as Error).message, 'bad'); }
});
chaos('plug', '/v1/chaos/plug', { cell: 'cell-2', wipe: true }, 'Data Centre 2: process killed, database deleted. Watch the P1 card.');
chaos('restart', '/v1/chaos/restart', { cell: 'cell-2' }, 'Data Centre 2 restarting: it rebuilds from the relays.');
chaos('degrade-on', '/v1/chaos/degrade', { on: true }, "Centre 42's link is degrading: watch for SYNC_LAG.");
chaos('degrade-off', '/v1/chaos/degrade', { on: false }, "Centre 42's link is no longer degraded.");
chaos('spare', '/v1/chaos/spare', {}, "Centre 42's relay replaced by the spare: seats resend from their journals.");
$('approve').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const f = new FormData(ev.target as HTMLFormElement);
  try { await call('POST', '/v1/gaps/approve', { cand: f.get('cand'), seq: Number(f.get('seq')), by: $<HTMLInputElement>('ack-by').value }); say('approve-out', 'Approved and logged.', 'ok'); void timeTick(); }
  catch (e) { say('approve-out', (e as Error).message, 'bad'); }
});
const showArchive = (r: ArchiveReport): void => $('archive-out').replaceChildren(...archiveLines(r).map((l) => el('li', l)));
$('archive').addEventListener('click', async () => { try { showArchive(await call<ArchiveReport>('POST', '/v1/archive')); } catch (e) { $('archive-out').replaceChildren(el('li', (e as Error).message)); } });
$('purge').addEventListener('click', async () => {
  try { const r = await call<{ purged: number; report: ArchiveReport }>('POST', '/v1/archive/purge'); showArchive(r.report); $('archive-out').append(el('li', `Relay purged ${r.purged} entries on a signed order.`)); }
  catch (e) { $('archive-out').replaceChildren(el('li', (e as Error).message)); }
});
for (const [fn, ms] of [[incidentsTick, 1_000], [linkTick, 2_000], [timeTick, 3_000], [noticesTick, 3_000]] as const) { void fn(); setInterval(fn, ms); }

async function readinessTick(): Promise<void> {
  try {
    const { centres } = await call<ReadinessBoard>('GET', '/v1/readiness');
    $('readiness').replaceChildren(...centres.map((c) => {
      const x = readinessTile(c), item = document.createElement('li');
      item.dataset.tone = x.tone;
      item.setAttribute('aria-label', x.aria);
      item.append(el('strong', x.title), el('span', x.line), el('span', x.word));
      return item;
    }));
    $('readiness-seats').replaceChildren(...centres.flatMap((c) => c.seats.filter((s) => s.verdict !== 'green')).map((s) => li(seatLine(s))));
  } catch (e) { $('readiness').replaceChildren(li(`Readiness board unavailable: ${(e as Error).message}`)); }
}

async function reviewTick(): Promise<void> {
  try {
    const { items } = await call<{ items: ReviewItem[] }>('GET', '/v1/review');
    $('review').replaceChildren(...items.map((i) => {
      const c = reviewCard(i, Date.now()), li2 = el('li');
      li2.append(el('strong', c.title), el('span', c.line));
      if (i.thumb.startsWith('data:image/jpeg;base64,')) { const img = document.createElement('img'); img.src = i.thumb; img.alt = c.alt; li2.append(img); }
      if (c.canDecide) {
        const clear = el('button', 'Clear (no concern)'), confirm = el('button', 'Confirm (refer to superintendent)');
        const by = () => $<HTMLInputElement>('review-by').value;
        clear.addEventListener('click', () => void call('POST', '/v1/review/decide', { id: i.id, decision: 'cleared', by: by() }).then(reviewTick));
        confirm.addEventListener('click', () => void call('POST', '/v1/review/decide', { id: i.id, decision: 'confirmed', by: by() }).then(reviewTick));
        li2.append(clear, confirm);
      }
      return li2;
    }));
  } catch (e) { $('review').replaceChildren(li(`Review queue unavailable: ${(e as Error).message}`)); }
}

void readinessTick();
void reviewTick();
setInterval(readinessTick, 2000);
setInterval(reviewTick, 2000);

// --- Decide fairly ---
let running = false;
function setDecideRunning(n: number): void {
  running = true;
  const b = $<HTMLButtonElement>('decide-run');
  b.disabled = true; b.textContent = `Running the pipeline on ${n} candidates…`;
}
function clearDecideRunning(): void {
  running = false;
  const b = $<HTMLButtonElement>('decide-run');
  b.disabled = false; b.textContent = 'Run';
}
function showRun(run: AnalyticsRun): void {
  $('headline').textContent = run.headline;
  $('flags').replaceChildren(...flagRows(run.flags).map((r) => {
    const li2 = el('li');
    li2.append(el('strong', `${r.cand} · ${r.centre}`), el('span', r.level, 'level'), el('span', r.signals), el('span', r.reasons.join('; ')));
    if (r.history) li2.append(el('span', r.history, 'note'));
    return li2;
  }));
  $('report').textContent = run.report;
}
async function analyticsTick(): Promise<void> {
  try {
    const { run, signoff, running: r } = await call<{ run?: AnalyticsRun; signoff?: SignedDecision; running: boolean }>('GET', '/v1/analytics');
    if (run) showRun(run);
    if (signoff) say('signoff-out', `Signed off by ${signoff.by} at ${new Date(signoff.at).toLocaleTimeString()}, report sha256 ${signoff.reportHash.slice(0, 16)}…`, 'ok');
    if (r && !running) setDecideRunning(0); else if (!r && running) clearDecideRunning();
  } catch { /* no run yet */ }
}
$('decide-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const f = new FormData(ev.target as HTMLFormElement);
  const perimeterText = String(f.get('perimeter') ?? '').trim();
  const items = String(f.get('items') ?? '').trim();
  const body: IncidentIn = {
    id: String(f.get('id')),
    breach: { perimeter: !perimeterText || perimeterText === 'unknown' ? 'unknown' : perimeterText.split(',').map((s) => s.trim()).filter(Boolean),
      systemic: f.get('systemic') === 'on', evidence: String(f.get('evidence') ?? ''), ...(items ? { items: items.split(',').map((s) => s.trim()).filter(Boolean) } : {}) },
  };
  setDecideRunning(0);
  try { showRun(await call<AnalyticsRun>('POST', '/v1/analytics/run', body)); say('decide-status', 'Run complete.', 'ok'); }
  catch (e) { say('decide-status', (e as Error).message, 'bad'); }
  finally { clearDecideRunning(); }
});
$('signoff').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const f = new FormData(ev.target as HTMLFormElement);
  try {
    const s = await call<SignedDecision>('POST', '/v1/analytics/signoff', { by: f.get('by') });
    say('signoff-out', `Signed off by ${s.by} at ${new Date(s.at).toLocaleTimeString()}, report sha256 ${s.reportHash.slice(0, 16)}…`, 'ok');
  } catch (e) { say('signoff-out', (e as Error).message, 'bad'); }
});
void analyticsTick();
setInterval(analyticsTick, 3000);

// --- Invigilator reports ---
async function reportsTick(): Promise<void> {
  try {
    const { items } = await call<{ items: { report: InvReport; cls: Classification }[] }>('GET', '/v1/reports');
    $('report-list').replaceChildren(...items.map(({ report, cls }) => {
      const li2 = el('li');
      li2.append(el('strong', `${cls.kind} · ${cls.seats} seats${cls.linked ? ` · linked ${cls.linked}` : ''}`), el('span', report.text));
      return li2;
    }));
  } catch (e) { $('report-list').replaceChildren(el('li', `Reports unavailable: ${(e as Error).message}`)); }
}
$('report-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const f = new FormData(ev.target as HTMLFormElement);
  try { await call('POST', '/v1/reports', { centre: f.get('centre'), by: f.get('by'), text: f.get('text') }); (ev.target as HTMLFormElement).reset(); void reportsTick(); }
  catch (e) { $('report-list').replaceChildren(el('li', (e as Error).message)); }
});
void reportsTick();
setInterval(reportsTick, 3000);
if (!$<HTMLSelectElement>('report-centre').options.length) fleetTick().then(() => {
  const sel = $<HTMLSelectElement>('off-centre');
  $<HTMLSelectElement>('report-centre').replaceChildren(...Array.from(sel.options).map((o) => new Option(o.value, o.value)));
});

// --- Notices in EN / HI / TA ---
async function noticeDraftsTick(): Promise<void> {
  try {
    const { drafts } = await call<{ drafts: Notice[] }>('GET', '/v1/notices');
    $('notice-drafts').replaceChildren(...drafts.map((n) => {
      const c = noticeCard(n), li2 = el('li'), langs = el('div', '', 'langs');
      const enP = el('p', c.en), hiP = el('p', c.hi), taP = el('p', c.ta || '— not yet drafted —');
      enP.lang = 'en'; hiP.lang = 'hi'; taP.lang = 'ta';
      langs.append(enP, hiP, taP);
      const redraft = el('button', 'Redraft with provider');
      redraft.addEventListener('click', () => void call('POST', '/v1/notices/redraft', { id: n.id }).then(noticeDraftsTick, (e: Error) => say('chaos-out', e.message, 'bad')));
      const approve = el('button', `Approve notice ${n.id}`, 'primary') as HTMLButtonElement;
      approve.disabled = !c.complete;
      if (!c.complete) approve.title = 'Needs all three languages before it can be approved.';
      approve.addEventListener('click', () => void call('POST', '/v1/notices/approve', { id: n.id, by: $<HTMLInputElement>('ack-by').value }).then(noticeDraftsTick, (e: Error) => say('chaos-out', e.message, 'bad')));
      li2.append(langs, redraft, approve);
      return li2;
    }));
  } catch { /* retry next tick */ }
}
void noticeDraftsTick();
setInterval(noticeDraftsTick, 3000);
