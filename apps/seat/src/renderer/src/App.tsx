import { useEffect, useRef, useState } from 'react';
import bankJson from '../../../../../fixtures/paper/bank.json';
import formsJson from '../../../../../fixtures/paper/forms.json';
import type { Action, ExamBoot, ItemState, Lang, SeatApi, SyncView } from '../../shared/ipc.ts';
import { clearResponse, fmtRemaining, GLYPH, markAndNext, saveAndNext, tickOf } from './exam-state.ts';
import { FaceChip } from './FaceChip.tsx';
import { T, type Strings } from './i18n.ts';
import { Palette } from './Palette.tsx';

declare global { interface Window { saakshi: SeatApi } }

interface BankItem { id: string; subject: string; en: { q: string; o: string[] }; hi: { q: string; o: string[] } }
const BANK = new Map((bankJson as { items: BankItem[] }).items.map((i) => [i.id, i]));
const FORMS = formsJson as unknown as Record<'F1' | 'F2', string[]>;
const LETTERS = ['A', 'B', 'C', 'D'] as const;

export function App() {
  const [boot, setBoot] = useState<ExamBoot | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => { window.saakshi.load().then(setBoot, (e) => setErr(String(e))); }, []);
  if (err) return <p role="alert">{err}</p>;
  return boot ? <Exam boot={boot} /> : <p>…</p>;
}

function Exam({ boot }: { boot: ExamBoot }) {
  const order = FORMS[boot.form];
  const [lang, setLang] = useState<Lang>(() => { try { return localStorage.getItem('lang') === 'hi' ? 'hi' : 'en'; } catch { return 'en'; } });
  const [started, setStarted] = useState(boot.started);
  const [items, setItems] = useState<Record<string, ItemState>>(boot.items);
  const [visited, setVisited] = useState<Set<string>>(() => new Set([...Object.keys(boot.items), ...(boot.started ? [order[0]] : [])]));
  const [idx, setIdx] = useState(0);
  const [selected, setSelected] = useState(boot.items[order[0]]?.answer ?? '');
  const [sync, setSync] = useState<SyncView>(boot.sync);
  const [notice, setNotice] = useState('');
  const [clock, setClock] = useState({ base: boot.activeMs, at: performance.now() });
  const [now, setNow] = useState(performance.now());
  const shownAt = useRef(performance.now());
  const heading = useRef<HTMLHeadingElement>(null);
  const t = T[lang];

  useEffect(() => window.saakshi.onSync(setSync), []);
  useEffect(() => { const id = setInterval(() => setNow(performance.now()), 250); return () => clearInterval(id); }, []);
  useEffect(() => { try { localStorage.setItem('lang', lang); } catch { /* per-viewer convenience only */ } document.documentElement.lang = lang; }, [lang]);

  const remaining = boot.durationMs - (started ? clock.base + (now - clock.at) : 0);
  const timeUp = started && remaining <= 0;
  const item = order[idx];

  function go(i: number, its: Record<string, ItemState> = items) {
    const n = (i + order.length) % order.length, next = order[n];
    setIdx(n);
    setVisited((v) => new Set(v).add(next));
    setSelected(its[next]?.answer ?? '');
    shownAt.current = performance.now();
    requestAnimationFrame(() => heading.current?.focus());
  }

  async function commit(a: Action | null, advance: boolean) {
    let its = items;
    if (a) {
      const r = await window.saakshi.act(a);
      if (!r.ok) { setNotice(r.error); return; }
      its = { ...items, [a.item]: { state: a.state, answer: a.answer, seq: r.seq } };
      setItems(its);
      setClock({ base: r.activeMs, at: performance.now() });
      setNotice(`${t.saved} ✓`);
    }
    if (advance) go(idx + 1, its); else setSelected(its[item]?.answer ?? '');
  }
  const dwell = () => performance.now() - shownAt.current;

  if (!started) {
    return (
      <main className="start">
        <h1>{t.title}</h1>
        <p>{t.candidate}: {boot.cand} · {boot.seatId} · {t.form} {boot.form}</p>
        <LangToggle lang={lang} setLang={setLang} t={t} />
        <p>{t.startNote}</p>
        <button className="primary" onClick={async () => {
          const r = await window.saakshi.start();
          if (!r.ok) { setNotice(r.error); return; }
          setStarted(true);
          setClock({ base: r.activeMs, at: performance.now() });
          setVisited((v) => new Set(v).add(order[0]));
          shownAt.current = performance.now();
        }}>{t.start}</button>
        <p role="status">{notice}</p>
      </main>
    );
  }

  const q = BANK.get(item)![lang];
  const tick = tickOf(items[item]?.seq ?? 0, sync);
  return (
    <div className="exam">
      <header className="bar">
        <div><strong>{t.title}</strong> · {boot.cand} · {t.form} {boot.form}</div>
        <div role="timer" aria-live="off" className={remaining < 5 * 60_000 ? 'timer low' : 'timer'}>
          <span className="sr-only">{t.timeLeft} </span>{fmtRemaining(remaining)}
        </div>
        <LangToggle lang={lang} setLang={setLang} t={t} />
        <SyncStatus v={sync} t={t} />
        <FaceChip label={t.faces} unavailable={t.cameraOff} />
      </header>
      <main className="question" aria-labelledby="qh">
        <h2 id="qh" ref={heading} tabIndex={-1}>
          {t.question} {idx + 1}
          {tick !== 'none' && <span className={`tick ${tick}`} title={t.tick[tick]}><span aria-hidden="true">{GLYPH[tick]}</span><span className="sr-only">, {t.tick[tick]}</span></span>}
        </h2>
        <fieldset disabled={timeUp}>
          <legend className="q-text">{q.q}</legend>
          {q.o.map((o, i) => (
            <label key={LETTERS[i]} className="opt">
              <input type="radio" name="opt" value={LETTERS[i]} checked={selected === LETTERS[i]} onChange={() => setSelected(LETTERS[i])} />
              <span className="letter">{LETTERS[i]}</span> {o}
            </label>
          ))}
        </fieldset>
        <div className="actions">
          <button className="primary" disabled={timeUp} onClick={() => commit(saveAndNext(item, selected, items[item], dwell()), true)}>{t.saveNext}</button>
          <button className="mark" disabled={timeUp} onClick={() => commit(markAndNext(item, selected, items[item], dwell()), true)}>{t.markNext}</button>
          <button disabled={timeUp} onClick={() => { setSelected(''); void commit(clearResponse(item, items[item], dwell()), false); }}>{t.clear}</button>
        </div>
        <p role="status" className="notice">{timeUp ? t.timeUp : notice}</p>
      </main>
      <Palette order={order} items={items} visited={visited} current={idx} sync={sync} t={t} onPick={(i) => go(i)} />
    </div>
  );
}

function LangToggle({ lang, setLang, t }: { lang: Lang; setLang: (l: Lang) => void; t: Strings }) {
  return (
    <div className="lang" role="group" aria-label={t.lang}>
      <button aria-pressed={lang === 'en'} lang="en" onClick={() => setLang('en')}>English</button>
      <button aria-pressed={lang === 'hi'} lang="hi" onClick={() => setLang('hi')}>हिन्दी</button>
    </div>
  );
}

function SyncStatus({ v, t }: { v: SyncView; t: Strings }) {
  return (
    <div className="sync">
      <span><span aria-hidden="true">✓</span> {v.local}<span className="sr-only"> {t.tick.local}</span></span>
      <span><span aria-hidden="true">✓✓</span> {v.relay}<span className="sr-only"> {t.tick.relay}</span></span>
      <span className="cell"><span aria-hidden="true">✓✓</span> {v.cell}<span className="sr-only"> {t.tick.cell}</span></span>
      <span role="status" className={v.online ? 'online' : 'offline'}>{v.online ? t.online : t.offline}</span>
    </div>
  );
}
