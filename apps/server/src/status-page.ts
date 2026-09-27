// /status: the public page. Everything it shows comes from /v1/status/public, which carries no PII. Text only, never HTML.
import type { PublicStatus } from '@saakshi/core/ops';

type Lang = 'en' | 'hi' | 'ta';
const L = {
  en: { title: 'Exam status', incidents: 'Current issues', none: 'No current issues.', notices: 'Notices', noNotices: 'No notices.', centres: 'Centres', updated: 'Updated' },
  hi: { title: 'परीक्षा की स्थिति', incidents: 'वर्तमान समस्याएँ', none: 'कोई वर्तमान समस्या नहीं।', notices: 'सूचनाएँ', noNotices: 'कोई सूचना नहीं।', centres: 'केंद्र', updated: 'अद्यतन' },
  ta: { title: 'தேர்வு நிலை', incidents: 'நடப்பு பிரச்சினைகள்', none: 'நடப்பு பிரச்சினைகள் இல்லை.', notices: 'அறிவிப்புகள்', noNotices: 'அறிவிப்புகள் இல்லை.', centres: 'மையங்கள்', updated: 'புதுப்பிக்கப்பட்டது' },
};
const $ = (id: string) => document.getElementById(id)!;
let lang: Lang = (['en', 'hi', 'ta'] as const).includes(new URLSearchParams(location.search).get('lang') as Lang) ? (new URLSearchParams(location.search).get('lang') as Lang) : 'en';
let last: PublicStatus | undefined;
const li = (text: string, cls = '') => { const x = document.createElement('li'); x.textContent = text; if (cls) x.className = cls; return x; };
/** A missing `ta` (old data) falls back to `en` with a note, rather than showing blank text. */
const at = (x: { en: string; hi: string; ta?: string }): string => (lang === 'ta' ? x.ta ?? `${x.en} (English)` : x[lang]);

function render(): void {
  const t = L[lang];
  document.documentElement.lang = lang;
  for (const l of ['en', 'hi', 'ta'] as const) $(l).setAttribute('aria-pressed', String(l === lang));
  $('title').textContent = t.title; $('h-incidents').textContent = t.incidents; $('h-notices').textContent = t.notices; $('h-centres').textContent = t.centres;
  if (!last) return;
  $('summary').textContent = at(last.summary);
  $('incidents').replaceChildren(...(last.incidents.length ? last.incidents.map((i) => li(at(i))) : [li(t.none)]));
  $('notices').replaceChildren(...(last.notices.length ? last.notices.map((n) => li(`${new Date(n.at).toLocaleTimeString()} — ${at(n)}`)) : [li(t.noNotices)]));
  $('centres').replaceChildren(...last.centres.map((c) => li(`${c.centre}: ${at(c)}`, `tile ${c.tone}`)));
  $('updated').textContent = `${t.updated} ${new Date(last.at).toLocaleTimeString()} · ${last.exam} ${last.shift}`;
}
async function tick(): Promise<void> {
  try { const r = await fetch('/v1/status/public'); if (r.ok) last = (await r.json()) as PublicStatus; } catch { /* keep the last view */ }
  render();
}
for (const l of ['en', 'hi', 'ta'] as const) $(l).addEventListener('click', () => { lang = l; render(); });
void tick();
setInterval(tick, 5_000);
