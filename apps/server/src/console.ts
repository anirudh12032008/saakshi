import type { StreamView } from '@saakshi/core/wire';
import type { ReleaseMsg } from '@saakshi/core/paper';
import type { CentreStatus } from '@saakshi/core/ops';
import { applyEvent, approveText, linkText, moveRow, paperStatus, tile, type PendingMove, type Tone } from './console-view.ts';

const views = new Map<string, StreamView>();
const grid = document.getElementById('grid') as HTMLUListElement;
const status = document.getElementById('status') as HTMLParagraphElement;
let head: { mode?: string; state?: string } = {};
let conn = 'connecting…';

function render(): void {
  const now = Date.now();
  const tiles = [...views.values()].map((v) => tile(v, now)).sort((a, b) => a.cand.localeCompare(b.cand));
  grid.replaceChildren(...tiles.map((t) => {
    const li = document.createElement('li');
    li.className = `tile ${t.tone}`;
    li.setAttribute('aria-label', t.aria);
    const name = document.createElement('strong');
    name.textContent = t.cand;
    const detail = document.createElement('span');
    detail.textContent = t.text;
    li.append(name, detail);
    return li;
  }));
  const n: Record<Tone, number> = { ok: 0, lag: 0, silent: 0 };
  for (const t of tiles) n[t.tone]++;
  status.textContent = `${head.mode ?? 'node'} · ${head.state ?? '…'} · ${conn} · ${tiles.length} seats: ${n.ok} in sync, ${n.lag} syncing, ${n.silent} silent`;
}

const es = new EventSource('/v1/events');           // reconnects by itself and sends Last-Event-ID
for (const ev of ['snapshot', 'stream', 'state']) {
  es.addEventListener(ev, (m) => { head = { ...head, ...applyEvent(views, ev, JSON.parse((m as MessageEvent<string>).data)) }; render(); });
}
es.onopen = () => { conn = 'live'; render(); };
es.onerror = () => { conn = 'reconnecting…'; render(); };
setInterval(render, 1000);                           // ages "silent" tiles between events

const paper = document.getElementById('paper') as HTMLParagraphElement;
const say = (id: string, text: string, tone: 'good' | 'bad') => { const el = document.getElementById(id)!; el.textContent = text; el.className = `out ${tone}`; };

async function paperTick(): Promise<void> {
  try {
    const r = await fetch('/release/current');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const s = paperStatus(((await r.json()) as { releases: ReleaseMsg[] }).releases);
    paper.textContent = s.text;
    paper.className = s.tone;
  } catch { paper.textContent = 'This relay has no exam package (it runs without EXAM).'; paper.className = 'locked'; }
}

document.getElementById('offline')!.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const code = (document.getElementById('code') as HTMLInputElement).value;
  const r = await fetch('/v1/release/offline', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code }) });
  const j = (await r.json().catch(() => ({}))) as { error?: string };
  say('offline-out', r.ok ? 'Unlocked: the key went to every seat at this centre, and each one checks it against the published commitment.' : (j.error ?? `HTTP ${r.status}`), r.ok ? 'good' : 'bad');
  void paperTick();
});

document.getElementById('forge')!.addEventListener('click', async () => {
  const r = await fetch('/v1/dev/forge', { method: 'POST' });
  say('forge-out', r.ok ? 'A forged key went out. Every seat should say it rejected a key.' : `Not available (HTTP ${r.status}).`, r.ok ? 'good' : 'bad');
});

void paperTick();
setInterval(paperTick, 2000);

const inv = document.getElementById('inv') as HTMLInputElement;
document.getElementById('inv-form')!.addEventListener('submit', (ev) => ev.preventDefault());   // Enter must not reload the console
async function decide(m: PendingMove, action: 'approve' | 'refuse'): Promise<void> {
  if (action === 'approve' && !inv.value.trim()) { say('moves-out', 'Enter your invigilator ID first.', 'bad'); inv.focus(); return; }
  const r = await fetch(`/v1/handover/${action}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cand: m.cand, key: m.key, invigilator: inv.value }) });
  const j = (await r.json().catch(() => ({}))) as { keyEpoch?: number; fromSeq?: number; creditedMs?: number; error?: string };
  const out = action === 'refuse' ? { text: r.ok ? `Refused the move of ${m.cand}.` : (j.error ?? `HTTP ${r.status}`), tone: r.ok ? 'good' as const : 'bad' as const } : approveText(r.status, j);
  say('moves-out', out.text, out.tone);
  void movesTick();
}
async function movesTick(): Promise<void> {
  try {
    const r = await fetch('/v1/handover/pending');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const { pending } = (await r.json()) as { pending: PendingMove[] };
    const now = Date.now();
    (document.getElementById('moves') as HTMLUListElement).replaceChildren(...pending.map((m) => {
      const row = moveRow(m, now), li = document.createElement('li'), span = document.createElement('span');
      li.setAttribute('aria-label', row.aria);
      span.textContent = row.text;
      const ok = document.createElement('button'), no = document.createElement('button');
      ok.className = 'primary'; ok.textContent = `Approve the move of ${m.cand}`; ok.addEventListener('click', () => void decide(m, 'approve'));
      no.textContent = 'Refuse'; no.addEventListener('click', () => void decide(m, 'refuse'));
      li.append(span, ok, no);
      return li;
    }));
  } catch { /* a relay without EXAM has no moves */ }
}
async function linkTick(): Promise<void> {
  const el = document.getElementById('link') as HTMLParagraphElement;
  try {
    const r = await fetch('/v1/status');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const s = linkText((await r.json()) as CentreStatus);
    el.textContent = s.text; el.className = s.tone;
  } catch { el.textContent = 'Link status unavailable.'; el.className = 'bad'; }
}
void movesTick(); void linkTick();
setInterval(movesTick, 2000); setInterval(linkTick, 2000);
