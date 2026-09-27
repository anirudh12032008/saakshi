import type { SignedSth } from '@saakshi/core/log';
import type { Finding, ReconRow } from '@saakshi/core/sheet';
import { findingText, headline, reconCells } from './control-view.ts';

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
    say('recon-status', r.green ? 'Green: every count and every head agrees.' : 'Not green: see the red cells.', r.green ? 'ok' : 'bad');
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
