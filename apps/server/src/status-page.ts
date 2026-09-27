// /status: the public page. Everything it shows comes from /v1/status/public, which carries no PII. Text only, never HTML.
import type { PublicStatus } from '@saakshi/core/ops';

type Lang = 'en' | 'hi';
const L = {
  en: { title: 'Exam status', incidents: 'Current issues', none: 'No current issues.', notices: 'Notices', noNotices: 'No notices.', centres: 'Centres', updated: 'Updated' },
  hi: { title: 'परीक्षा की स्थिति', incidents: 'वर्तमान समस्याएँ', none: 'कोई वर्तमान समस्या नहीं।', notices: 'सूचनाएँ', noNotices: 'कोई सूचना नहीं।', centres: 'केंद्र', updated: 'अद्यतन' },
};
const $ = (id: string) => document.getElementById(id)!;
let lang: Lang = new URLSearchParams(location.search).get('lang') === 'hi' ? 'hi' : 'en';
let last: PublicStatus | undefined;
const li = (text: string, cls = '') => { const x = document.createElement('li'); x.textContent = text; if (cls) x.className = cls; return x; };

function render(): void {
  const t = L[lang];
  document.documentElement.lang = lang;
  for (const l of ['en', 'hi'] as const) $(l).setAttribute('aria-pressed', String(l === lang));
  $('title').textContent = t.title; $('h-incidents').textContent = t.incidents; $('h-notices').textContent = t.notices; $('h-centres').textContent = t.centres;
  if (!last) return;
  $('summary').textContent = last.summary[lang];
  $('incidents').replaceChildren(...(last.incidents.length ? last.incidents.map((i) => li(i[lang])) : [li(t.none)]));
  $('notices').replaceChildren(...(last.notices.length ? last.notices.map((n) => li(`${new Date(n.at).toLocaleTimeString()} — ${n[lang]}`)) : [li(t.noNotices)]));
  $('centres').replaceChildren(...last.centres.map((c) => li(`${c.centre}: ${c[lang]}`, `tile ${c.tone}`)));
  $('updated').textContent = `${t.updated} ${new Date(last.at).toLocaleTimeString()} · ${last.exam} ${last.shift}`;
}
async function tick(): Promise<void> {
  try { const r = await fetch('/v1/status/public'); if (r.ok) last = (await r.json()) as PublicStatus; } catch { /* keep the last view */ }
  render();
}
for (const l of ['en', 'hi'] as const) $(l).addEventListener('click', () => { lang = l; render(); });
void tick();
setInterval(tick, 5_000);
