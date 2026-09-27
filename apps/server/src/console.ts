import type { StreamView } from '@saakshi/core/wire';
import { applyEvent, tile, type Tone } from './console-view.ts';

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
